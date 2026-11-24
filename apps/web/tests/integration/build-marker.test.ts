// Review A-15: the build writes a marker, dist-server/build-info.json, that
// every process reads at boot. In production mode a demo build or a missing
// marker is refused by the web and worker boot check and by every
// command-line tool (seed, db-roles, verify-events, release) before it does
// anything.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runBundled, startWorker, type ProcessResult } from '../helpers/cli';
import { count } from '../helpers/db';
import { WEB_ROOT } from '../helpers/env';
import { useFreshDatabase } from '../helpers/reset';

const MARKER = join(WEB_ROOT, 'dist-server', 'build-info.json');
const original = readFileSync(MARKER, 'utf8');

function setMarker(content: string | null): void {
  if (content === null) rmSync(MARKER, { force: true });
  else writeFileSync(MARKER, content);
}

function env(overrides: Record<string, string | undefined>, runtime: boolean): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...process.env };
  if (runtime) {
    for (const name of ['MIGRATION_DATABASE_URL', 'APP_DB_PASSWORD', 'SEED_DEMO_PASSWORD']) Reflect.deleteProperty(copy, name);
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(copy, name);
    else copy[name] = value;
  }
  return copy;
}

const PRODUCTION = { APP_MODE: 'production', DEMO_TOOLS: 'false', APP_URL: 'https://platform.example', DEMO_ROUTES_BUILT: 'false' };
const DEMO_MARKER = `${JSON.stringify({ demoBuild: true })}\n`;

function expectRefused(result: ProcessResult, code: string, what: string): void {
  expect(result.status, `${what}\n${result.output.slice(-2000)}`).not.toBe(0);
  expect(result.output, what).toContain(code);
}

describe('build marker (review A-15)', () => {
  useFreshDatabase();
  afterEach(() => {
    setMarker(original);
  });

  it('the bundle writes the marker of a non-demo build', () => {
    expect(existsSync(MARKER)).toBe(true);
    expect(JSON.parse(original)).toEqual({ demoBuild: false });
  });

  it('the boot check of the web and worker processes refuses a demo build in production, and a missing marker', () => {
    setMarker(DEMO_MARKER);
    expectRefused(runBundled('boot-check', [], env(PRODUCTION, true)), 'DEMO_ROUTES_BUILT', 'demo marker');
    setMarker(null);
    expectRefused(runBundled('boot-check', [], env(PRODUCTION, true)), 'BUILD_INFO_MISSING', 'no marker');
    setMarker('{"demoBuild":"maybe"}');
    expectRefused(runBundled('boot-check', [], env(PRODUCTION, true)), 'BUILD_INFO_MISSING', 'unreadable marker');
  });

  it('the worker refuses to start from a demo build in production', async () => {
    setMarker(DEMO_MARKER);
    const worker = startWorker(env(PRODUCTION, true));
    const code = await new Promise<number | null>((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (/boot refused/.test(worker.output()) || Date.now() - started > 20_000) {
          clearInterval(poll);
          void worker.stop().then(resolve);
        }
      }, 100);
    });
    expect(code, worker.output().slice(-2000)).not.toBe(0);
    expect(worker.output()).toContain('DEMO_ROUTES_BUILT');
  });

  it('db-roles, verify-events, seed and release refuse a demo build in production before doing anything', async () => {
    setMarker(DEMO_MARKER);
    const before = await count('SELECT count(*)::text AS n FROM "_prisma_migrations"');
    for (const name of ['db-roles', 'verify-events', 'seed', 'release'] as const) {
      const result = runBundled(name, [], env(PRODUCTION, false));
      expectRefused(result, 'DEMO_ROUTES_BUILT', name);
      expect(result.output, name).toContain(`"process":"${name}"`);
    }
    expect(await count('SELECT count(*)::text AS n FROM "_prisma_migrations"'), 'nothing was migrated').toBe(before);
    expect(await count(`SELECT count(*)::text AS n FROM "SystemState" WHERE "databaseMode" = 'production'`), 'nothing was stamped').toBe(0);
  });

  it('the command-line tools refuse a missing marker in production', () => {
    setMarker(null);
    for (const name of ['db-roles', 'verify-events', 'release'] as const) {
      expectRefused(runBundled(name, [], env(PRODUCTION, false)), 'BUILD_INFO_MISSING', name);
    }
  });

  it('in demo mode the tools run from either build', () => {
    setMarker(DEMO_MARKER);
    const result = runBundled('verify-events', [], env({}, false));
    expect(result.status, result.output.slice(-2000)).toBe(0);
  });
});
