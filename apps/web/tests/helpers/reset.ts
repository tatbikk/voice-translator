// Per-file database reset and the end-of-file leak checks (memo rows 16, 17).
import { afterAll, beforeAll, expect } from 'vitest';
import { closePools, sql } from './db';
import { forgetDefaults } from './factories';
import { recordedResponses } from './http';
import { capturedLogs } from './log-capture';
import { recreateSchema } from './schema';
import { findLeaks } from './sensitive';

function isModuleMissing(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find (module|package)|Failed to load url/.test(String(e.message));
}

/** Closes the application's database pool (getDb), so that it reconnects to the new schema. */
export async function closeAppDb(): Promise<void> {
  let mod: { closeDb?: () => Promise<void> };
  try {
    mod = await import('@/server/db');
  } catch (error) {
    if (isModuleMissing(error)) return; // no application pool exists yet
    throw error;
  }
  await mod.closeDb?.();
}

/** Drops the platform-clock cache of the application, when it exposes one. */
export async function forgetAppClockCache(): Promise<void> {
  try {
    const mod = (await import('@/server/clock')) as unknown as { invalidateClockCache?: unknown };
    const invalidate = mod.invalidateClockCache;
    if (typeof invalidate === 'function') Reflect.apply(invalidate, undefined, []);
  } catch (error) {
    if (!isModuleMissing(error)) throw error;
  }
}

export async function resetDatabase(): Promise<void> {
  await closeAppDb();
  await closePools();
  await recreateSchema();
  forgetDefaults();
  await forgetAppClockCache();
}

/**
 * Leak checks at the end of a test file:
 * - row 16: the whole "Event" table holds no secret, code, token, password,
 *   e-mail, name, phone number or request reference used by the file;
 * - row 17: neither does the technical log, and no API answer carries a
 *   secret, password, code or token (the outbox is the only place meant to
 *   show codes and links, and Set-Cookie headers are where cookies belong).
 */
export async function assertNoLeaks(): Promise<void> {
  const dump = JSON.stringify(await sql('SELECT * FROM "Event" ORDER BY seq'));
  expect(findLeaks(dump), 'values found in the event log').toEqual([]);

  expect(findLeaks(capturedLogs()), 'values found in the technical log').toEqual([]);

  const leaks: string[] = [];
  for (const res of recordedResponses()) {
    if (res.endpointId.startsWith('demo.outbox') || res.path === '/api/demo/outbox') continue;
    for (const leak of findLeaks(`${res.headers}\n${res.text}`, ['secret', 'password', 'code', 'token'])) {
      leaks.push(`${res.method} ${res.path} (${String(res.status)}): ${leak}`);
    }
  }
  expect(leaks, 'values found in API answers').toEqual([]);
}

/**
 * Recreates the schema before the tests of the file, and checks for leaks and
 * closes every connection after them.
 */
export function useFreshDatabase(options: { leakChecks?: boolean } = {}): void {
  beforeAll(async () => {
    await resetDatabase();
  }, 180_000);
  afterAll(async () => {
    try {
      if (options.leakChecks ?? true) await assertNoLeaks();
    } finally {
      await closeAppDb();
      await closePools();
    }
  }, 60_000);
}
