// Memo rows 16 and 17: a secret or a personal datum reaching the event log
// (which can never be erased), the technical log, an API answer or a table in
// clear; and the encrypted settings store (AES-256-GCM, AAD = setting name)
// refusing a tampered ciphertext and showing only the last four characters.
// Every test file also runs the event-log, technical-log and answer checks in
// its afterAll (tests/helpers/reset.ts); this file exercises every flow first.
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { moroccoCalendarDate } from '@mahkama/core';
import { accountDraft, activate, activationLinkFor, adminSession, createAccount } from '../helpers/admin';
import { login, passGate, resendCode, startLogin, submitCode, visitor, wrongCode } from '../helpers/auth';
import { one, sql } from '../helpers/db';
import { overrideEnv } from '../helpers/env';
import { createCaseFile, createUser, newPassword, theCourt, userIdByEmail } from '../helpers/factories';
import { Client, recordedResponses } from '../helpers/http';
import { capturedLogs } from '../helpers/log-capture';
import { closeAppDb, useFreshDatabase } from '../helpers/reset';
import { findLeaks, trackSensitive } from '../helpers/sensitive';

/** Runs every Phase 0 flow once, successes and refusals alike. */
async function runEveryFlow(): Promise<void> {
  await passGate(new Client(), `wrong-passphrase-${randomBytes(6).toString('hex')}`);
  const court = await theCourt();
  const caseFile = await createCaseFile({ courtId: court.id });

  const lawyer = await createUser({ roles: ['LAWYER'], isDemo: true });
  const pending = await startLogin(lawyer);
  await submitCode(pending.client, wrongCode(pending.code));
  await resendCode(pending.client);
  const client = await login(lawyer);
  await client.post('/api/v1/auth/reauth', { password: 'Wrong-password-2026' });
  await client.get('/api/v1/public/case-status', { query: { courtId: court.id, number: caseFile.number, code: caseFile.code, year: caseFile.year } });
  await client.get('/api/v1/public/hearings', { query: { courtId: court.id, date: moroccoCalendarDate(new Date()) } });
  await client.post('/api/v1/preferences', { locale: 'fr', readingSize: 2, readingContrast: 1 });
  await client.get('/api/v1/notifications', { headers: { 'X-Background-Refresh': '1' } });

  const victim = await createUser({ roles: ['BAILIFF'] });
  const attacker = await visitor();
  for (let i = 0; i < 6; i += 1) await attacker.post('/api/v1/auth/login', { email: victim.email, password: `Wrong-password-${String(i)}-x` });

  const { client: admin } = await adminSession();
  const draft = accountDraft({ role: 'EXPERT' });
  await createAccount(admin, draft);
  const userId = await userIdByEmail(draft.email);
  const { token } = await activationLinkFor(userId);
  const password = newPassword();
  await activate(await visitor(), token, password);
  await activate(await visitor(), token, newPassword());
  await createAccount(admin, accountDraft({ email: lawyer.email, role: 'SYSTEM_ADMIN' }));

  const demoTarget = await createUser({ roles: ['LITIGANT'], isDemo: true });
  const someone = await visitor();
  await someone.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId: demoTarget.roleAssignmentId } });
  await someone.get('/api/demo/outbox');
  await someone.get('/api/demo/accounts');
  await someone.post('/api/v1/auth/logout');

  await sql('ALTER ROLE mahkama_app NOLOGIN');
  await closeAppDb();
  try {
    await client.get('/api/v1/notifications');
    await new Client().get('/healthz');
  } finally {
    await sql('ALTER ROLE mahkama_app LOGIN');
    await closeAppDb();
  }
}

interface LooseStore {
  put?: (name: string, value: string, actor?: string | null) => Promise<unknown>;
  putSecret?: (name: string, value: string, actor?: string | null) => Promise<unknown>;
  getPlaintextForUse?: (name: string) => Promise<unknown>;
  getSecretForUse?: (name: string) => Promise<unknown>;
  describe?: (name: string) => Promise<unknown>;
  describeSecret?: (name: string) => Promise<unknown>;
}

/** A tampered record must make the read throw (fail closed), not answer a value or null. */
async function refusedToDecrypt(read: (name: string) => Promise<unknown>, name: string): Promise<boolean> {
  try {
    await read(name);
    return false;
  } catch {
    return true;
  }
}

describe('secrets and personal data (memo rows 16 and 17)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    const restore = await overrideEnv({ LOG_LEVEL: 'debug' });
    try {
      await runEveryFlow();
    } finally {
      await restore();
    }
  }, 120_000);

  it('row 16: the whole event log holds none of the secrets, codes, tokens, passwords, e-mails, names or references used', async () => {
    const dump = JSON.stringify(await sql('SELECT * FROM "Event" ORDER BY seq'));
    expect(dump.length).toBeGreaterThan(1000);
    expect(findLeaks(dump)).toEqual([]);
  });

  it('row 17: the technical log holds no secret, code, token, password, e-mail, name or phone number, even at debug level', () => {
    const logs = capturedLogs();
    expect(findLeaks(logs)).toEqual([]);
    expect(logs, 'paths are logged without their query string').not.toMatch(/case-status\?|hearings\?|roleAssignmentId=/);
    expect(logs, 'database errors are logged by class and code, not by message').not.toMatch(/not permitted to log in|password authentication failed/);
  });

  it('row 17: no API answer carries a secret, a password, a code or a token', () => {
    const leaks: string[] = [];
    for (const res of recordedResponses()) {
      if (res.path === '/api/demo/outbox') continue;
      for (const leak of findLeaks(`${res.headers}\n${res.text}`, ['secret', 'password', 'code', 'token'])) {
        leaks.push(`${res.method} ${res.path} ${String(res.status)}: ${leak}`);
      }
    }
    expect(recordedResponses().length).toBeGreaterThan(30);
    expect(leaks).toEqual([]);
  });

  it('no table holds a configuration secret or a password in clear; codes and tokens only in the outbox', async () => {
    const tables = await sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    for (const { tablename } of tables) {
      if (tablename === '_prisma_migrations') continue;
      const dump = JSON.stringify(await sql(`SELECT * FROM "${tablename.replace(/"/g, '')}"`));
      expect(findLeaks(dump, ['secret', 'password']), tablename).toEqual([]);
      if (tablename !== 'OutboundMessage') expect(findLeaks(dump, ['code', 'token']), tablename).toEqual([]);
    }
  });

  it('row 17: the encrypted settings store refuses a tampered ciphertext and shows only the last four characters', async () => {
    const store = (await import('@/server/secrets/store')) as unknown as LooseStore;
    const put = store.put ?? store.putSecret;
    const read = store.getPlaintextForUse ?? store.getSecretForUse;
    const describeSetting = store.describe ?? store.describeSecret;
    expect(put && read && describeSetting, 'secrets/store exports put, getPlaintextForUse and describe').toBeTruthy();
    if (!put || !read || !describeSetting) return;

    const name = 'providers.test.api-key';
    const value = `sk-test-${randomBytes(18).toString('hex')}`;
    trackSensitive('secret', value);
    await put(name, value, null);

    const row = await one<{ ciphertext: Buffer; iv: Buffer; tag: Buffer; last4: string; keyVersion: number }>(
      'SELECT ciphertext, iv, tag, last4, "keyVersion" FROM "SecretSetting" WHERE name = $1',
      [name],
    );
    expect(row.iv.length).toBe(12);
    expect(row.tag.length).toBe(16);
    expect(row.last4).toBe(value.slice(-4));
    expect(row.keyVersion).toBeGreaterThanOrEqual(1);
    expect(row.ciphertext.toString('utf8')).not.toContain(value.slice(8));
    expect(row.ciphertext.includes(Buffer.from(value.slice(8)))).toBe(false);

    expect(await read(name)).toBe(value);
    const description = JSON.stringify(await describeSetting(name));
    expect(description).toContain(value.slice(-4));
    expect(description).not.toContain(value.slice(0, -4));

    const flipped = Buffer.from(row.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;
    await sql('UPDATE "SecretSetting" SET ciphertext = $2 WHERE name = $1', [name, flipped]);
    expect(await refusedToDecrypt(read, name), 'a changed ciphertext is refused').toBe(true);

    const badTag = Buffer.from(row.tag);
    badTag[0] = (badTag[0] ?? 0) ^ 0x01;
    await sql('UPDATE "SecretSetting" SET ciphertext = $2, tag = $3 WHERE name = $1', [name, row.ciphertext, badTag]);
    expect(await refusedToDecrypt(read, name), 'a changed tag is refused').toBe(true);

    // A truncated authentication tag (GCM accepts short tags unless their length is fixed) is refused.
    await sql('UPDATE "SecretSetting" SET tag = $2 WHERE name = $1', [name, row.tag]);
    expect(await read(name)).toBe(value);
    await sql('UPDATE "SecretSetting" SET tag = substring(tag from 1 for 4) WHERE name = $1', [name]);
    expect(await refusedToDecrypt(read, name), 'a tag truncated to 4 bytes is refused').toBe(true);
    await sql('UPDATE "SecretSetting" SET iv = substring(iv from 1 for 8), tag = $2 WHERE name = $1', [name, row.tag]);
    expect(await refusedToDecrypt(read, name), 'an iv of 8 bytes is refused').toBe(true);

    // The setting name is the additional authenticated data: moving a ciphertext under another name fails.
    await sql('UPDATE "SecretSetting" SET iv = $2, tag = $3 WHERE name = $1', [name, row.iv, row.tag]);
    expect(await read(name)).toBe(value);
    const other = 'providers.other.api-key';
    await put(other, `sk-other-${randomBytes(18).toString('hex')}`, null);
    await sql(
      'UPDATE "SecretSetting" SET ciphertext = $2, iv = $3, tag = $4, last4 = $5 WHERE name = $1',
      [other, row.ciphertext, row.iv, row.tag, row.last4],
    );
    expect(await refusedToDecrypt(read, other), 'a ciphertext moved under another name is refused').toBe(true);
  });
});
