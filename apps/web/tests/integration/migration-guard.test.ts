// Review of IR-43 (P2-A-12), on PostgreSQL: the guard the release runs before
// `prisma migrate deploy` (decision 83) reads "_prisma_migrations" with the
// owner connection, refuses a pending migration dated before the last one
// applied, and writes nothing. The probe migrations live in a copy of
// prisma/migrations in a temporary directory, never in the repository.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { appliedMigrations, guardMigrations, migrationsMayDeploy, migrationsOnDisk } from '@/cli/migration-guard';
import { count, owner } from '../helpers/db';
import { WEB_ROOT, requireEnv } from '../helpers/env';

const MIGRATIONS = join(WEB_ROOT, 'prisma', 'migrations');
const scratch = mkdtempSync(join(tmpdir(), 'migration-guard-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A copy of prisma/migrations with one more migration of the given name. */
function migrationsWith(name: string): string {
  const dir = join(scratch, name);
  cpSync(MIGRATIONS, dir, { recursive: true });
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, 'migration.sql'), 'SELECT 1;\n');
  return dir;
}

/** The 14-digit date of a migration name, one second earlier (a real date, so a real name). */
function secondBefore(stamp: string): string {
  const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((i, k) => Number(stamp.slice(i, k === 0 ? 4 : i + 2)));
  const t = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s! - 1));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${two(t.getUTCMonth() + 1)}${two(t.getUTCDate())}${two(t.getUTCHours())}${two(t.getUTCMinutes())}${two(t.getUTCSeconds())}`;
}

async function logged(fn: () => Promise<boolean>): Promise<{ allowed: boolean; lines: Record<string, unknown>[] }> {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
  try {
    return { allowed: await fn(), lines };
  } finally {
    spy.mockRestore();
  }
}

describe('the migration guard of the release on the migrated database (review of IR-43, P2-A-12)', () => {
  it('reads every applied migration with the checksum the list holds, and lets the release migrate', async () => {
    const applied = await appliedMigrations(owner());
    expect(applied.map((m) => ({ name: m.name, sha256: m.checksum }))).toEqual(migrationsOnDisk(MIGRATIONS));
    expect(guardMigrations(migrationsOnDisk(MIGRATIONS), applied)).toEqual({ datedBeforeApplied: [], changedAfterApplied: [] });
    const { allowed, lines } = await logged(() => migrationsMayDeploy(requireEnv('MIGRATION_DATABASE_URL'), MIGRATIONS, 'test'));
    expect(allowed).toBe(true);
    expect(lines).toEqual([]);
  });

  it('refuses, and says why, a pending migration dated before the last one applied; writes nothing', async () => {
    const before = await count('SELECT count(*) FROM "_prisma_migrations"');
    // The last applied migration is read, not written here: the next phase's migrations keep this test true.
    const lastApplied = (await appliedMigrations(owner())).map((m) => m.name).sort().at(-1)!;
    const name = `${secondBefore(lastApplied.slice(0, 14))}_probe_earlier`;
    const { allowed, lines } = await logged(() => migrationsMayDeploy(requireEnv('MIGRATION_DATABASE_URL'), migrationsWith(name), 'test'));
    expect(allowed).toBe(false);
    expect(lines).toEqual([
      expect.objectContaining({ level: 'error', code: 'MIGRATION_DATED_BEFORE_APPLIED', step: 'test', migration: name, lastApplied }),
    ]);
    expect(await count('SELECT count(*) FROM "_prisma_migrations"')).toBe(before);
  });

  it('lets a pending migration dated after the last one applied through', async () => {
    const { allowed, lines } = await logged(() => migrationsMayDeploy(requireEnv('MIGRATION_DATABASE_URL'), migrationsWith('29991231235959_probe_later'), 'test'));
    expect(allowed).toBe(true);
    expect(lines).toEqual([]);
  });

  it('reports, without refusing, an applied migration whose text changed', async () => {
    const dir = migrationsWith('29991231235958_probe_later');
    const [first] = migrationsOnDisk(MIGRATIONS);
    writeFileSync(join(dir, first!.name, 'migration.sql'), '-- edited after it was applied\n', { flag: 'a' });
    const { allowed, lines } = await logged(() => migrationsMayDeploy(requireEnv('MIGRATION_DATABASE_URL'), dir, 'test'));
    expect(allowed).toBe(true);
    expect(lines).toEqual([expect.objectContaining({ level: 'warn', code: 'MIGRATION_CHANGED_AFTER_APPLIED', step: 'test', migration: first!.name })]);
  });
});
