// Review S-12: the role-provisioning step (src/cli/db-roles.ts) sends a
// SCRAM-SHA-256 verifier in CREATE ROLE / ALTER ROLE instead of the password.
// What matters at run time: the runtime role still logs in with its password,
// whether the step created the role or altered it.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { provisionRoles } from '../helpers/cli';
import { sql } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { useFreshDatabase } from '../helpers/reset';

const FRESH_ROLE = 'mahkama_scram_probe';

async function loginAs(url: string): Promise<string> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ who: string }>('SELECT current_user AS who');
    return rows[0]?.who ?? '';
  } finally {
    await client.end();
  }
}

function withRole(url: string, role: string): string {
  const u = new URL(url);
  u.username = role;
  return u.toString();
}

async function dropFreshRole(): Promise<void> {
  const exists = await sql('SELECT 1 FROM pg_roles WHERE rolname = $1', [FRESH_ROLE]);
  if (exists.length === 0) return;
  const db = (await sql<{ d: string }>('SELECT quote_ident(current_database()) AS d'))[0]?.d ?? '';
  await sql(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${FRESH_ROLE}`);
  await sql(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${FRESH_ROLE}`);
  await sql(`REVOKE ALL ON SCHEMA public FROM ${FRESH_ROLE}`);
  await sql(`REVOKE ALL ON DATABASE ${db} FROM ${FRESH_ROLE}`);
  await sql(`DROP ROLE ${FRESH_ROLE}`);
}

describe('runtime role password (review S-12)', () => {
  useFreshDatabase();
  afterAll(dropFreshRole);

  it('after ALTER ROLE with a SCRAM verifier, the runtime role logs in with its password', async () => {
    provisionRoles();
    const url = requireEnv('DATABASE_URL');
    expect(await loginAs(url)).toBe(decodeURIComponent(new URL(url).username));
  });

  it('after CREATE ROLE with a SCRAM verifier, the new role logs in with the password', async () => {
    await dropFreshRole();
    const url = withRole(requireEnv('DATABASE_URL'), FRESH_ROLE);
    provisionRoles({ ...process.env, DATABASE_URL: url });
    expect(await loginAs(url)).toBe(FRESH_ROLE);
  });

  it('a wrong password is refused: the verifier is not a password', async () => {
    const url = new URL(requireEnv('DATABASE_URL'));
    url.password = 'not-the-runtime-role-password';
    await expect(loginAs(url.toString())).rejects.toThrow();
  });
});
