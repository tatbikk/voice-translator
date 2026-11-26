// Memo row 21 and contract §10: the seed (dist-server/seed.mjs) runs only in
// demo mode, on a database stamped demo or empty (which it then stamps demo);
// it refuses a database stamped production and a non-empty unstamped one; it
// is idempotent; --reset requires --confirm=<database name>, and carries the
// head of the old chain into the first event of the new one. The seeded data
// are those of the fixture apps/web/src/cli/seed-data/accounts.ts.
import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from '@mahkama/core';
import { DEMO_ACCOUNTS } from '@/cli/seed-data/accounts';
import { runBundled, type ProcessResult } from '../helpers/cli';
import { count, events, one, sql } from '../helpers/db';
import { databaseName, requireEnv } from '../helpers/env';
import { createUser, stampDatabase } from '../helpers/factories';
import { closeAppDb, resetDatabase, useFreshDatabase } from '../helpers/reset';
import { findLeaks, trackSensitive } from '../helpers/sensitive';

for (const account of DEMO_ACCOUNTS) trackSensitive('email', account.email);

async function seed(args: readonly string[] = [], overrides: Record<string, string | undefined> = {}): Promise<ProcessResult> {
  await closeAppDb();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(env, name);
    else env[name] = value;
  }
  const result = runBundled('seed', args, env, 300_000);
  expect(findLeaks(result.output), 'the seed output holds no secret, password or e-mail').toEqual([]);
  return result;
}

const users = () => count('SELECT count(*)::text AS n FROM "User"');
const stamp = async () => (await one<{ databaseMode: string | null }>('SELECT "databaseMode" FROM "SystemState" WHERE id = 1')).databaseMode;

describe('seed (memo row 21)', () => {
  useFreshDatabase();

  it('row 21: the seed refuses a non-empty database that carries no stamp', async () => {
    await createUser({ roles: ['LAWYER'], isDemo: false });
    const before = await users();
    const result = await seed();
    expect(result.status, result.output.slice(-2000)).not.toBe(0);
    expect(await users()).toBe(before);
    expect(await stamp()).toBeNull();
  }, 120_000);

  it('row 21: the seed refuses a database stamped production', async () => {
    await resetDatabase();
    await stampDatabase('production');
    const result = await seed();
    expect(result.status, result.output.slice(-2000)).not.toBe(0);
    expect(await users()).toBe(0);
    expect(await stamp()).toBe('production');
  }, 120_000);

  it('the seed refuses to run with APP_MODE=production', async () => {
    await resetDatabase();
    const result = await seed([], { APP_MODE: 'production' });
    expect(result.status).not.toBe(0);
    expect(await users()).toBe(0);
  }, 120_000);

  it('row 21: on an empty database the seed stamps it demo and creates the demo data of the fixture', async () => {
    await resetDatabase();
    const result = await seed();
    expect(result.status, result.output.slice(-3000)).toBe(0);
    expect(await stamp()).toBe('demo');

    const seeded = await sql<{ email: string; isDemo: boolean; roles: string[] }>(
      `SELECT u.email, u."isDemo", array_agg(r.role::text ORDER BY r.role::text) AS roles
         FROM "User" u JOIN "RoleAssignment" r ON r."userId" = u.id GROUP BY u.id`,
    );
    expect(seeded.every((u) => u.isDemo), 'every seeded user is flagged demo').toBe(true);
    expect(seeded.every((u) => u.email.endsWith('@demo.mahkama.example')), 'fictitious e-mail addresses').toBe(true);
    const roles = new Set(seeded.flatMap((u) => u.roles));
    for (const role of ROLE_CODES) expect(roles.has(role), `an account holds ${role}`).toBe(true);
    expect(seeded.some((u) => u.roles.length === 2), 'one user holds two roles').toBe(true);
    const admins = seeded.filter((u) => u.roles.includes('SYSTEM_ADMIN'));
    const validators = seeded.filter((u) => u.roles.includes('RULES_LEGAL_VALIDATOR'));
    expect(admins.length).toBeGreaterThan(0);
    expect(validators.length).toBeGreaterThan(0);
    for (const admin of admins) {
      expect(admin.roles, 'the administrator holds no other role').toEqual(['SYSTEM_ADMIN']);
      expect(validators.map((v) => v.email)).not.toContain(admin.email);
    }

    // The fixture read by the end-to-end tests matches the database.
    for (const account of DEMO_ACCOUNTS) {
      const user = seeded.find((u) => u.email.toLowerCase() === account.email.toLowerCase());
      expect(user, account.email).toBeDefined();
      expect(user?.roles).toContain(account.role);
      expect(user?.roles.length).toBe(account.roleAssignmentCount);
    }
    expect(seeded.length).toBe(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size);

    expect(await count('SELECT count(*)::text AS n FROM "CaseFile"')).toBeGreaterThanOrEqual(6);
    expect(await count(`SELECT count(DISTINCT status)::text AS n FROM "CaseFile"`)).toBeGreaterThanOrEqual(5);
    expect(await count('SELECT count(*)::text AS n FROM "Hearing"')).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::text AS n FROM "Court" WHERE degree = 'FIRST_INSTANCE'`)).toBeGreaterThanOrEqual(1);
    expect(await count(`SELECT count(*)::text AS n FROM "Court" WHERE degree = 'APPEAL'`)).toBeGreaterThanOrEqual(1);
    const withoutNotice = await count(
      `SELECT count(*)::text AS n FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n."userId" = u.id AND n.kind = 'INFORMATION')`,
    );
    expect(withoutNotice, 'one INFORMATION notification per account').toBe(0);
    expect(await count(`SELECT count(*)::text AS n FROM "User" WHERE "passwordHash" NOT LIKE '$argon2id$v=19$m=19456,t=2,p=1$%'`)).toBe(0);
    expect((await events('demo.data.seeded')).length).toBe(1);
  }, 300_000);

  it('gives every demo party its quality, and every address of a place its locality and whether it lies within the court’s district, read from the districts table (independent review IR-08)', async () => {
    const places = await sql<{ quality: string | null; locality: string | null; within: boolean | null }>(
      `SELECT p.quality, a.locality, a."withinCourtDistrict" AS within
         FROM "PartyAddress" a JOIN "CaseParty" p ON p.id = a."partyId"
        WHERE a.kind IN ('DOMICILE', 'RESIDENCE', 'REGISTERED_OFFICE', 'BRANCH')`,
    );
    expect(places.length).toBeGreaterThan(0);
    expect(places.filter((p) => p.quality === null)).toEqual([]);
    expect(places.filter((p) => p.locality === null)).toEqual([]);
    // Rabat is a locality of the table outside the district of the appeal court: the appellant of
    // file 312 is not within it, which the seed no longer assumes; every other demo address is.
    expect(places.filter((p) => p.locality === 'rabat').map((p) => p.within)).toEqual([false]);
    expect(places.filter((p) => p.locality !== 'rabat').map((p) => p.within)).not.toContain(false);
    expect(places.filter((p) => p.locality !== 'rabat').map((p) => p.within)).not.toContain(null);
  });

  it('row 21: running the seed again changes nothing', async () => {
    const before = {
      users: await users(),
      roles: await count('SELECT count(*)::text AS n FROM "RoleAssignment"'),
      cases: await count('SELECT count(*)::text AS n FROM "CaseFile"'),
      notifications: await count('SELECT count(*)::text AS n FROM "Notification"'),
    };
    const result = await seed();
    expect(result.status, result.output.slice(-2000)).toBe(0);
    expect({
      users: await users(),
      roles: await count('SELECT count(*)::text AS n FROM "RoleAssignment"'),
      cases: await count('SELECT count(*)::text AS n FROM "CaseFile"'),
      notifications: await count('SELECT count(*)::text AS n FROM "Notification"'),
    }).toEqual(before);
  }, 300_000);

  it('row 21: --reset without the name of the database, or with another name, is refused', async () => {
    const before = await users();
    const head = (await events()).at(-1)?.hash;
    for (const args of [['--reset'], ['--reset', '--confirm=mahkama_prod'], ['--reset', '--confirm=']]) {
      const result = await seed(args);
      expect(result.status, args.join(' ')).not.toBe(0);
    }
    expect(await users()).toBe(before);
    expect((await events()).at(-1)?.hash).toBe(head);
  }, 300_000);

  it('row 21: --reset with the name of the database recreates the data and carries the old chain head into the first event', async () => {
    const old = (await events()).at(-1);
    expect(old).toBeDefined();
    const name = databaseName(requireEnv('MIGRATION_DATABASE_URL'));
    const result = await seed(['--reset', `--confirm=${name}`]);
    expect(result.status, result.output.slice(-3000)).toBe(0);
    expect(result.output, 'the old chain head is printed').toContain(old?.hash ?? '?');
    const first = (await events())[0];
    expect(first?.seq).toBe(1);
    expect(first?.action).toBe('demo.data.reset');
    expect(first?.details).toEqual({ previousHeadSeq: old?.seq, previousHeadHash: old?.hash });
    expect(await stamp()).toBe('demo');
    expect(await users()).toBe(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size);
  }, 300_000);
});
