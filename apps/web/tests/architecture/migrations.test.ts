// Reviews P2-A-12 and IR-43 (L7): a migration once listed is never edited, and
// the list follows the order in which Prisma applies the migrations.
// - prisma/migration-history.json lists every migration of prisma/migrations,
//   in the order of their names, with the SHA-256 of its migration.sql: the
//   value Prisma records as the checksum of the migration in
//   "_prisma_migrations" when it applies it. A deployed database can thus be
//   compared with the list (SELECT migration_name, checksum FROM "_prisma_migrations").
// - The text of a listed migration does not change: a change to the schema is
//   a new migration, dated after the last one so that it is listed last.
// - This test cannot tell which migration is new: one dated before the last
//   one and listed in its sorted place passes it. What refuses it is the guard
//   the release runs before `prisma migrate deploy` (src/cli/migration-guard.ts,
//   decision 83), on a database that has already applied a later one; the last
//   case below checks that every path that deploys migrations runs it first.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_ROOT } from '../helpers/env';

const MIGRATIONS = join(WEB_ROOT, 'prisma', 'migrations');
const HISTORY = join(WEB_ROOT, 'prisma', 'migration-history.json');

interface Listed {
  readonly name: string;
  readonly sha256: string;
}

const history = JSON.parse(readFileSync(HISTORY, 'utf8')) as { migrations: Listed[] };
const folders = readdirSync(MIGRATIONS)
  .filter((entry) => statSync(join(MIGRATIONS, entry)).isDirectory())
  .sort();
const sha256Of = (name: string) => createHash('sha256').update(readFileSync(join(MIGRATIONS, name, 'migration.sql'))).digest('hex');

describe('the migrations of prisma/migrations (reviews P2-A-12, IR-43)', () => {
  it('are named <14-digit date>_<snake_case> and each holds its migration.sql', () => {
    expect(folders.length).toBeGreaterThan(0);
    for (const name of folders) {
      expect(name, name).toMatch(/^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(existsSync(join(MIGRATIONS, name, 'migration.sql')), name).toBe(true);
    }
  });

  it('are all listed in prisma/migration-history.json, in the order of their names, and nothing else is', () => {
    const listed = history.migrations.map((m) => m.name);
    expect(listed, 'add a new migration at the end of prisma/migration-history.json').toEqual(folders);
    for (let i = 1; i < listed.length; i += 1) {
      expect(listed[i]! > listed[i - 1]!, `${listed[i]!} is listed after ${listed[i - 1]!} and must be dated after it`).toBe(true);
    }
  });

  it('keep the text that was listed: a listed migration is never edited, the change is a new migration', () => {
    for (const m of history.migrations) {
      expect(m.sha256, m.name).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256Of(m.name), `${m.name}: its migration.sql changed after it was listed`).toBe(m.sha256);
    }
  });

  // This test cannot tell a new migration from an old one: a migration dated before the last one and
  // listed in its sorted place passes it. The release refuses it, before it migrates (decision 83).
  it('are applied, on every path that deploys them, only after the guard has let them through', () => {
    for (const file of ['src/cli/release.ts', 'src/cli/seed.ts']) {
      const source = readFileSync(join(WEB_ROOT, file), 'utf8');
      // The guard's answer is obeyed: a refusal stops the step before it migrates (review of the guard).
      const guard = source.search(/if \(!\(await migrationsMayDeploy\([^;]*\)\)\) (refuse|fail)\('MIGRATION_DATED_BEFORE_APPLIED'\);/);
      const deploy = source.indexOf("'migrate', 'deploy'");
      expect(deploy, `${file} runs prisma migrate deploy`).toBeGreaterThan(-1);
      expect(guard, `${file} runs the migration guard`).toBeGreaterThan(-1);
      expect(guard, `${file} runs the guard before prisma migrate deploy`).toBeLessThan(deploy);
      expect(source.indexOf("'migrate', 'deploy'", deploy + 1), `${file} deploys once`).toBe(-1);
    }
  });
});
