// Provisions the runtime database role and its grants (contract §8).
// Runs with the OWNER connection (MIGRATION_DATABASE_URL) after every
// `prisma migrate deploy`, locally, in CI and in the Railway pre-deploy step.
//
// The runtime role (the user of DATABASE_URL) owns nothing, cannot create
// objects, and holds only SELECT and INSERT on the event log, so it can neither
// rewrite the log, nor disable its triggers, nor drop the table.
import { z } from 'zod';
import pg from 'pg';

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const schema = z.object({
  APP_MODE: z.enum(['demo', 'production']),
  MIGRATION_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_DB_PASSWORD: z.string().min(12).max(128),
});

function fail(code: string): never {
  // Names only, never values.
  console.error(JSON.stringify({ level: 'error', msg: 'db-roles failed', code }));
  process.exit(1);
}

async function main(): Promise<void> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    fail(`INVALID_ENV:${parsed.error.issues.map((i) => i.path.join('.')).join(',')}`);
  }
  const env = parsed.data;
  const runtimeRole = decodeURIComponent(new URL(env.DATABASE_URL).username);
  const ownerRole = decodeURIComponent(new URL(env.MIGRATION_DATABASE_URL).username);
  if (!ROLE_NAME.test(runtimeRole)) fail('RUNTIME_ROLE_NAME_INVALID');
  if (runtimeRole === ownerRole) fail('RUNTIME_ROLE_IS_OWNER');

  const client = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const ident = (await client.query<{ q: string }>('SELECT quote_ident($1) AS q', [runtimeRole])).rows[0]?.q;
    if (!ident) fail('QUOTE_FAILED');

    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [runtimeRole]);
    if (exists.rowCount === 0) {
      const create = await client.query<{ sql: string }>(
        `SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L', $1::text, $2::text) AS sql`,
        [runtimeRole, env.APP_DB_PASSWORD],
      );
      await client.query(create.rows[0]!.sql);
    } else {
      const alter = await client.query<{ sql: string }>(
        // Only a superuser may restate SUPERUSER/REPLICATION, even to "NO": the
        // attributes are verified by the final check instead.
        `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql`,
        [runtimeRole, env.APP_DB_PASSWORD],
      );
      await client.query(alter.rows[0]!.sql);
    }

    const db = (await client.query<{ d: string }>('SELECT quote_ident(current_database()) AS d')).rows[0]!.d;

    await client.query('BEGIN');
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${ident}`);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ident}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${ident}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ident}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident}`);
    await client.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "Event" FROM ${ident}`);
    await client.query(`REVOKE ALL ON "_prisma_migrations" FROM ${ident}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident}`);

    // Production: an empty, unstamped database is stamped once, here. Demo
    // databases are stamped by the seed. The stamp never changes afterwards
    // (trigger "system_state_stamp_guard").
    if (env.APP_MODE === 'production') {
      const state = await client.query<{ databaseMode: string | null }>('SELECT "databaseMode" FROM "SystemState" WHERE id = 1');
      const users = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM "User"');
      const events = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM "Event"');
      if (state.rows[0]?.databaseMode == null && users.rows[0]?.n === '0' && events.rows[0]?.n === '0') {
        await client.query(`UPDATE "SystemState" SET "databaseMode" = 'production', "updatedAt" = now() WHERE id = 1`);
      }
    }
    await client.query('COMMIT');

    const check = await client.query<{ super: boolean; owns: boolean; modify: boolean }>(
      `SELECT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls) AS super,
              (SELECT c.relowner = r.oid FROM pg_class c WHERE c.oid = '"Event"'::regclass) AS owns,
              (has_table_privilege(r.oid, '"Event"', 'UPDATE')
               OR has_table_privilege(r.oid, '"Event"', 'DELETE')
               OR has_table_privilege(r.oid, '"Event"', 'TRUNCATE')) AS modify
         FROM pg_roles r WHERE r.rolname = $1`,
      [runtimeRole],
    );
    const row = check.rows[0];
    if (!row || row.super || row.owns || row.modify) fail('RUNTIME_ROLE_TOO_POWERFUL');
    console.log(JSON.stringify({ level: 'info', msg: 'db-roles applied', runtimeRole }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'UNKNOWN';
    fail(`SQL_${code}`);
  } finally {
    await client.end();
  }
}

await main();
