// Memo row 20 and contract §4.4, §13 item 6: APP_MODE=production refuses to
// boot — with simulated components, DEMO_TOOLS=true, demo routes built, a seed
// password, a database not stamped production, demo rows, an advanced clock,
// an http APP_URL — and any mode refuses a runtime role that owns the event
// log, an unreachable database, weak or equal secrets. The bundled boot-check
// CLI (dist-server/boot-check.mjs) logs violation codes, never values, and
// exits non-zero.
import { describe, expect, it } from 'vitest';
import { runBundled, type ProcessResult } from '../helpers/cli';
import { requireEnv } from '../helpers/env';
import { createUser, stampDatabase } from '../helpers/factories';
import { sql } from '../helpers/db';
import { resetDatabase, useFreshDatabase } from '../helpers/reset';
import { findLeaks } from '../helpers/sensitive';

function bootCheck(overrides: Record<string, string | undefined> = {}): ProcessResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(env, name);
    else env[name] = value;
  }
  const result = runBundled('boot-check', [], env);
  expect(findLeaks(result.output, ['secret', 'password', 'code', 'token']), 'the boot check prints names and codes, never values').toEqual([]);
  return result;
}

/** A production configuration that differs from the test one only where production requires it. */
const PRODUCTION_LIKE: Record<string, string | undefined> = {
  APP_MODE: 'production',
  DEMO_TOOLS: 'false',
  SEED_DEMO_PASSWORD: undefined,
  APP_URL: 'https://platform.example',
  DEMO_ROUTES_BUILT: 'false',
};

const OTHER_KEY = Buffer.alloc(32, 7).toString('base64');

describe('boot check (memo row 20, contract §13.6)', () => {
  useFreshDatabase();

  it('row 20: demo mode with the test configuration boots (exit 0)', () => {
    const result = bootCheck();
    expect(result.status, result.output.slice(-3000)).toBe(0);
  });

  it('row 20: APP_MODE=production with the test configuration refuses to boot', () => {
    const result = bootCheck({ APP_MODE: 'production' });
    expect(result.status).not.toBe(0);
    for (const code of ['SIMULATED_COMPONENT', 'DEMO_TOOLS_ENABLED', 'SEED_PASSWORD_SET', 'APP_URL_NOT_HTTPS', 'DATABASE_NOT_STAMPED_PRODUCTION']) {
      expect(result.output, code).toContain(code);
    }
  });

  it('row 20: production refuses because of the simulated components alone, every other condition being met', () => {
    const result = bootCheck(PRODUCTION_LIKE);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('SIMULATED_COMPONENT');
    for (const code of ['DEMO_TOOLS_ENABLED', 'SEED_PASSWORD_SET', 'APP_URL_NOT_HTTPS', 'DEMO_ROUTES_BUILT', 'DEMO_ROWS_PRESENT']) {
      expect(result.output, `${code} must not be reported here`).not.toContain(code);
    }
  });

  it('row 20: production refuses DEMO_TOOLS=true', () => {
    const result = bootCheck({ ...PRODUCTION_LIKE, DEMO_TOOLS: 'true' });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('DEMO_TOOLS_ENABLED');
  });

  it('row 20: production refuses demo routes in the build', () => {
    const result = bootCheck({ ...PRODUCTION_LIKE, DEMO_ROUTES_BUILT: 'true' });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('DEMO_ROUTES_BUILT');
  });

  it('row 20: production refuses a seed password in its environment', () => {
    const result = bootCheck({ ...PRODUCTION_LIKE, SEED_DEMO_PASSWORD: requireEnv('SEED_DEMO_PASSWORD') });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('SEED_PASSWORD_SET');
  });

  it('row 20: production refuses a database holding demo rows', async () => {
    await createUser({ roles: ['LAWYER'], isDemo: true });
    const result = bootCheck(PRODUCTION_LIKE);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('DEMO_ROWS_PRESENT');
  });

  it('row 20: demo mode refuses DEMO_TOOLS=false (no channel could deliver the codes)', () => {
    const result = bootCheck({ DEMO_TOOLS: 'false' });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('DEMO_WITHOUT_TOOLS');
  });

  it('row 20: demo mode refuses a visitor passphrase under 20 characters', () => {
    const result = bootCheck({ ACCESS_CODE: 'short-passphrase-19' });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('ACCESS_CODE');
    expect(result.output).not.toContain('short-passphrase-19');
  });

  it('row 20: any mode refuses equal secrets', () => {
    const result = bootCheck({ SESSION_SECRET: OTHER_KEY, SECRETS_MASTER_KEY: OTHER_KEY });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/SECRETS_EQUAL|SESSION_SECRET|SECRETS_MASTER_KEY/);
  });

  it('row 20: any mode refuses an unreachable database', () => {
    const url = new URL(requireEnv('DATABASE_URL'));
    url.port = '1';
    const result = bootCheck({ DATABASE_URL: url.toString() });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('DB_UNREACHABLE');
  });

  it('rows 15 and 20: a runtime role that owns the event log is refused in both modes', () => {
    const owner = requireEnv('MIGRATION_DATABASE_URL');
    const demo = bootCheck({ DATABASE_URL: owner });
    expect(demo.status, 'demo mode').not.toBe(0);
    expect(demo.output).toMatch(/RUNTIME_ROLE_OWNS_EVENT|RUNTIME_ROLE_TOO_POWERFUL|RUNTIME_ROLE_CAN_MODIFY_EVENT/);
    const production = bootCheck({ ...PRODUCTION_LIKE, DATABASE_URL: owner });
    expect(production.status, 'production mode').not.toBe(0);
    expect(production.output).toMatch(/RUNTIME_ROLE_OWNS_EVENT|RUNTIME_ROLE_TOO_POWERFUL|RUNTIME_ROLE_CAN_MODIFY_EVENT/);
  });

  it('row 20: a runtime role granted UPDATE on the event log is refused', async () => {
    await sql('GRANT UPDATE ON "Event" TO mahkama_app');
    try {
      const result = bootCheck();
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('RUNTIME_ROLE_CAN_MODIFY_EVENT');
    } finally {
      await sql('REVOKE UPDATE ON "Event" FROM mahkama_app');
    }
  });

  it('row 20: demo mode refuses a database stamped production', async () => {
    await stampDatabase('production');
    try {
      const result = bootCheck();
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('DATABASE_STAMPED_PRODUCTION');
    } finally {
      await resetDatabase();
    }
  });

  it('row 20: production refuses an advanced platform clock', async () => {
    await sql('UPDATE "PlatformClock" SET "offsetSeconds" = 3600 WHERE id = 1');
    try {
      const result = bootCheck(PRODUCTION_LIKE);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('CLOCK_OFFSET_NONZERO');
    } finally {
      await resetDatabase();
    }
  });
});
