// Recreates the test database schema exactly as contract §10 prescribes for the
// seed's --reset: DROP SCHEMA public CASCADE and CREATE SCHEMA public over pg
// with the owner connection, then `prisma migrate deploy`, then the
// role-provisioning step. Never `prisma migrate reset`, never `db push
// --force-reset`, never PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION.
import pg from 'pg';
import { migrateDeploy, provisionRoles } from './cli';
import { assertTestDatabase, requireEnv } from './env';

export async function recreateSchema(): Promise<void> {
  assertTestDatabase();
  const client = new pg.Client({ connectionString: requireEnv('MIGRATION_DATABASE_URL') });
  await client.connect();
  try {
    const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
    const name = rows[0]?.db ?? '';
    if (!name.endsWith('_test')) {
      throw new Error(`refusing to drop the schema of "${name}": not a test database`);
    }
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  migrateDeploy();
  provisionRoles();
}
