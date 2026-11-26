// The guard the release runs before `prisma migrate deploy` (reviews P2-A-12 and
// IR-43, decision 83). Prisma applies every pending migration in the order of its
// name, after those already applied: a migration named before the last one
// applied would run last on a database that holds the others, and in its place on
// a fresh one, so that two databases of the same version would differ. The
// architecture test cannot tell a new migration from an old one; the database
// can. The guard reads "_prisma_migrations" with the owner connection and writes
// nothing. It refuses the first case, and reports, without refusing, an applied
// migration whose migration.sql no longer has the checksum Prisma recorded
// (IR-43, remainder: refusing it waits for the owner's reading of a first report).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export interface MigrationOnDisk {
  readonly name: string;
  /** SHA-256 of its migration.sql: the checksum Prisma records when it applies it */
  readonly sha256: string;
}

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationGuard {
  /** pending migrations named before the last one applied: the release refuses */
  readonly datedBeforeApplied: readonly { readonly migration: string; readonly lastApplied: string }[];
  /** applied migrations whose text changed since: reported */
  readonly changedAfterApplied: readonly string[];
}

/** The migrations of a prisma/migrations folder, in the order Prisma applies them. */
export function migrationsOnDisk(dir: string): MigrationOnDisk[] {
  // The folder is the image's own prisma/migrations (or a test's copy), never a request's input.
  /* eslint-disable security/detect-non-literal-fs-filename */
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory() && existsSync(join(dir, entry, 'migration.sql')))
    .sort()
    .map((name) => ({ name, sha256: createHash('sha256').update(readFileSync(join(dir, name, 'migration.sql'))).digest('hex') }));
  /* eslint-enable security/detect-non-literal-fs-filename */
}

export function guardMigrations(onDisk: readonly MigrationOnDisk[], applied: readonly AppliedMigration[]): MigrationGuard {
  const appliedNames = new Set(applied.map((m) => m.name));
  const lastApplied = [...appliedNames].sort().at(-1) ?? null;
  const datedBeforeApplied =
    lastApplied === null ? [] : onDisk.filter((m) => !appliedNames.has(m.name) && m.name < lastApplied).map((m) => ({ migration: m.name, lastApplied }));
  const text = new Map(onDisk.map((m) => [m.name, m.sha256]));
  const changedAfterApplied = applied
    .filter((m) => text.has(m.name) && text.get(m.name) !== m.checksum)
    .map((m) => m.name)
    .sort();
  return { datedBeforeApplied, changedAfterApplied };
}

/** The migrations Prisma applied to the database; none on a database it never migrated. */
export async function appliedMigrations(db: pg.Pool | pg.Client): Promise<AppliedMigration[]> {
  const table = await db.query<{ t: string | null }>(`SELECT to_regclass('public._prisma_migrations')::text AS t`);
  if (!table.rows[0]?.t) return [];
  const rows = await db.query<AppliedMigration>(
    `SELECT migration_name AS name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows.rows;
}

/**
 * Reads the database and the migrations folder, logs what the guard finds on the
 * step's error stream, and says whether `prisma migrate deploy` may run.
 */
export async function migrationsMayDeploy(connectionString: string, migrationsDir: string, step: string): Promise<boolean> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  let applied: AppliedMigration[];
  try {
    applied = await appliedMigrations(client);
  } finally {
    await client.end();
  }
  const guard = guardMigrations(migrationsOnDisk(migrationsDir), applied);
  for (const migration of guard.changedAfterApplied) {
    console.error(JSON.stringify({ level: 'warn', msg: 'applied migration changed since it was applied', code: 'MIGRATION_CHANGED_AFTER_APPLIED', step, migration }));
  }
  for (const found of guard.datedBeforeApplied) {
    console.error(JSON.stringify({ level: 'error', msg: 'migration dated before one already applied', code: 'MIGRATION_DATED_BEFORE_APPLIED', step, ...found }));
  }
  return guard.datedBeforeApplied.length === 0;
}
