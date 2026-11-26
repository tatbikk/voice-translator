// Reviews P2-A-12 and IR-43 (L7): a migration once listed is never edited, and
// every new one sorts after the last one listed.
// - prisma/migration-history.json lists every migration of prisma/migrations,
//   in order, with the SHA-256 of its migration.sql: the value Prisma records
//   as the checksum of the migration in "_prisma_migrations" when it applies
//   it. A deployed database can thus be compared with the list
//   (SELECT migration_name, checksum FROM "_prisma_migrations").
// - The text of a listed migration does not change: a change to the schema is
//   a new migration, added at the end of the list.
// - A new migration is named with a date after the last one listed, so that
//   `prisma migrate deploy` applies it last, on every database.
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
});
