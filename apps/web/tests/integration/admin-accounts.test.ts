// Memo rows 10, 25 and 26, contract §6 (POST /api/v1/admin/accounts and
// /api/v1/auth/activate) and §5 (activation): creating an account requires a
// re-authentication within 10 minutes and a documented request reference,
// never combines an exclusive role, notifies every other administrator, logs
// only the hash of the reference; the activation link is built from APP_URL,
// carries its token in the fragment, is consumed once atomically, expires,
// is voided by a new link, and opens no session.
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@mahkama/core';
import {
  accountDraft,
  activate,
  activationLinkFor,
  adminSession,
  createAccount,
  emailIds,
  expectedLinkPrefix,
  reissueActivation,
  type AdminSession,
} from '../helpers/admin';
import { login, reauthenticate, startLogin, visitor } from '../helpers/auth';
import { capturingEvents, count, eventsAfter, headSeq, notificationsOf, one, sql } from '../helpers/db';
import { appUrl } from '../helpers/env';
import { createUser, newPassword, theCourt, userIdByEmail, type TestUser } from '../helpers/factories';
import { COOKIE, describeResponse, type ApiResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

let primary!: AdminSession;
let secondAdmin!: TestUser;
let validator!: TestUser;

const userCount = () => count('SELECT count(*)::text AS n FROM "User"');
const roleCountOf = (userId: string) => count('SELECT count(*)::text AS n FROM "RoleAssignment" WHERE "userId" = $1', [userId]);

function expectCreated(res: ApiResponse): void {
  expect(res.status, describeResponse(res)).toBeGreaterThanOrEqual(200);
  expect(res.status, describeResponse(res)).toBeLessThan(300);
}

function expectRefused(res: ApiResponse): void {
  expect(res.status, describeResponse(res)).toBeGreaterThanOrEqual(400);
  expect(res.status, describeResponse(res)).toBeLessThan(500);
  expect(res.envelope?.ok).toBe(false);
}

async function newAccount(): Promise<{ userId: string; token: string; email: string }> {
  const draft = accountDraft();
  expectCreated(await createAccount(primary.client, draft));
  const userId = await userIdByEmail(draft.email);
  const { token } = await activationLinkFor(userId);
  return { userId, token, email: draft.email };
}

describe('account administration (memo rows 10, 25, 26)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    primary = await adminSession();
    secondAdmin = await createUser({ roles: ['SYSTEM_ADMIN'] });
    validator = await createUser({ roles: ['RULES_LEGAL_VALIDATOR'] });
  });

  // Keeps the main administrator's re-authentication recent, whatever the duration of the run.
  beforeEach(async () => {
    const res = await reauthenticate(primary.client, primary.admin.password ?? '');
    expect(res.status, describeResponse(res)).toBe(200);
  });

  describe('row 26: an abandoned administrator session', () => {
    it('row 26: creating an account requires a re-authentication within ten minutes', async () => {
      const { admin, client } = await adminSession({ reauth: false });
      const users = await userCount();
      const refused = await createAccount(client, accountDraft());
      expect({ status: refused.status, code: refused.code }, describeResponse(refused)).toEqual({ status: 403, code: 'REAUTH_REQUIRED' });
      expect(await userCount()).toBe(users);

      expect((await reauthenticate(client, admin.password ?? '')).status).toBe(200);
      expectCreated(await createAccount(client, accountDraft()));

      await sql(`UPDATE "Session" SET "reauthAt" = now() - interval '11 minutes' WHERE "userId" = $1 AND "revokedAt" IS NULL`, [admin.id]);
      const stale = await createAccount(client, accountDraft());
      expect({ status: stale.status, code: stale.code }, describeResponse(stale)).toEqual({ status: 403, code: 'REAUTH_REQUIRED' });
    });

    it('row 26: a session opened by the account switcher carries no re-authentication', async () => {
      const admin = await createUser({ roles: ['SYSTEM_ADMIN'], isDemo: true });
      const client = await visitor();
      const switched = await client.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId: admin.roleAssignmentId } });
      expect(switched.status, describeResponse(switched)).toBe(200);
      const res = await createAccount(client, accountDraft());
      expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'REAUTH_REQUIRED' });
    });

    it('row 26: failed re-authentications count toward the lock, and that lock ends the session', async () => {
      const { admin, client } = await adminSession({ reauth: false });
      const since = await headSeq();
      for (let i = 0; i < 5; i += 1) await reauthenticate(client, `Wrong-password-${String(i)}-xyz`);
      expect((await eventsAfter(since, 'auth.reauth.failed')).length).toBeGreaterThanOrEqual(4);
      expect((await eventsAfter(since, 'auth.account.locked')).some((e) => e.details.cause === 'REAUTH')).toBe(true);
      expect((await eventsAfter(since, 'auth.session.revoked')).some((e) => e.details.cause === 'REAUTH_LOCK')).toBe(true);
      const after = await client.get('/api/v1/notifications');
      expect({ status: after.status, code: after.code }).toEqual({ status: 401, code: 'SESSION_REQUIRED' });
      const relogin = await (await visitor()).post('/api/v1/auth/login', { email: admin.email, password: admin.password });
      expect(relogin.status, 'the account is locked').toBe(423);
    });
  });

  describe('row 10: an administrator granting himself a judicial role', () => {
    it('row 10: an account is refused without a documented request reference (8 to 64 characters)', async () => {
      const users = await userCount();
      const { requestReference: _omitted, ...withoutReference } = accountDraft();
      const missing = await createAccount(primary.client, withoutReference);
      expect({ status: missing.status, code: missing.code }, describeResponse(missing)).toEqual({ status: 422, code: 'INVALID_INPUT' });
      expect(Object.keys(missing.error?.fields ?? {})).toContain('requestReference');
      for (const requestReference of ['REQ-123', 'R'.repeat(65), '        ']) {
        const res = await createAccount(primary.client, accountDraft({ requestReference }));
        expect({ status: res.status, code: res.code }, `reference of ${String(requestReference.length)} characters`).toEqual({
          status: 422,
          code: 'INVALID_INPUT',
        });
      }
      expect(await userCount(), 'no account was created').toBe(users);
    });

    it('row 10: a second role is refused to the holder of an exclusive role, and an exclusive role to the holder of another', async () => {
      const lawyer = await createUser({ roles: ['LAWYER'] });
      const cases: [string, TestUser, RoleCode][] = [
        ['a judicial role for an administrator', secondAdmin, 'JUDGE_RAPPORTEUR'],
        ['a judicial role for the administrator himself', primary.admin, 'JUDGE_RAPPORTEUR'],
        ['the rules validation for an administrator', secondAdmin, 'RULES_LEGAL_VALIDATOR'],
        ['the administration for the rules validator', validator, 'SYSTEM_ADMIN'],
        ['the administration for a lawyer', lawyer, 'SYSTEM_ADMIN'],
      ];
      for (const [label, holder, role] of cases) {
        const before = await roleCountOf(holder.id);
        const res = await createAccount(primary.client, accountDraft({ email: holder.email, role }));
        expectRefused(res);
        expect(await roleCountOf(holder.id), label).toBe(before);
      }
    });

    it('row 10: every other administrator is notified of each creation; the creation is logged with the hash of the reference', async () => {
      const othersBefore = (await notificationsOf(secondAdmin.id)).length;
      const validatorBefore = (await notificationsOf(validator.id)).length;
      const draft = accountDraft({ role: 'LAWYER' });
      const { result: res, events } = await capturingEvents(() => createAccount(primary.client, draft));
      expectCreated(res);
      const newUserId = await userIdByEmail(draft.email);

      expect((await notificationsOf(secondAdmin.id)).length, 'the other administrator is notified').toBe(othersBefore + 1);
      expect((await notificationsOf(validator.id)).length, 'the rules validator is not an administrator').toBe(validatorBefore);

      const created = events.filter((e) => e.action === 'admin.account.created');
      expect(created.length).toBe(1);
      const details = created[0]?.details ?? {};
      expect(details.newUserId).toBe(newUserId);
      expect(details.role).toBe('LAWYER');
      expect(details.requestReferenceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(created)).not.toContain(draft.requestReference ?? '\u0000');
      expect(created[0]?.legalBasis, 'a lawyer account rests on article 625').toEqual({ kind: 'LAW', law: '58.25', articles: [625] });
      expect(created[0]?.actorUserId).toBe(primary.admin.id);
    });

    it('row 10, row 19: an account created by the administrator is not a demo account, carries the simulated verification and has no password yet', async () => {
      const court = await theCourt();
      const draft = accountDraft({ role: 'BAILIFF', courtId: court.id });
      expectCreated(await createAccount(primary.client, draft));
      const user = await one<{ id: string; isDemo: boolean; passwordHash: string | null }>(
        'SELECT id, "isDemo", "passwordHash" FROM "User" WHERE lower(email) = lower($1)',
        [draft.email],
      );
      expect(user.isDemo).toBe(false);
      expect(user.passwordHash).toBeNull();
      const role = await one<{ role: string; verificationStatus: string }>(
        'SELECT role::text, "verificationStatus"::text FROM "RoleAssignment" WHERE "userId" = $1',
        [user.id],
      );
      expect(role).toEqual({ role: 'BAILIFF', verificationStatus: 'VERIFIED_SIMULATED' });
    });

    it('the accounts list shows the accounts and never a password hash', async () => {
      const res = await primary.client.get('/api/v1/admin/accounts');
      expect(res.status, describeResponse(res)).toBe(200);
      expect(res.text).toContain(secondAdmin.email);
      expect(res.text).not.toMatch(/\$argon2|passwordHash|tokenHash|codeMac/);
    });
  });

  describe('row 25: the activation link', () => {
    it('row 25: the link is built from APP_URL and carries its token in the fragment only', async () => {
      const draft = accountDraft();
      expectCreated(await createAccount(primary.client, draft));
      const { link, token } = await activationLinkFor(await userIdByEmail(draft.email));
      expect(link.startsWith(expectedLinkPrefix()), link.replace(token, '<token>')).toBe(true);
      expect(new URL(link).search).toBe('');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    });

    it('row 25: a forged Host header does not change the link', async () => {
      const draft = accountDraft();
      const res = await createAccount(primary.client, draft, {
        baseUrl: 'http://evil.example',
        headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https', Forwarded: 'host=evil.example;proto=https' },
      });
      expectCreated(res);
      const { link, token } = await activationLinkFor(await userIdByEmail(draft.email));
      expect(link.startsWith(expectedLinkPrefix()), link.replace(token, '<token>')).toBe(true);
      expect(link).not.toContain('evil.example');
      expect(new URL(appUrl()).host).not.toBe('evil.example');
    });

    it('row 25: two simultaneous uses of one link succeed once', async () => {
      const { userId, token } = await newAccount();
      const [a, b] = [await visitor(), await visitor()];
      await Promise.all([a.csrf(), b.csrf()]);
      const since = await headSeq();
      const answers = await Promise.all([activate(a, token, newPassword()), activate(b, token, newPassword())]);
      expect(answers.filter((r) => r.status >= 200 && r.status < 300).length, answers.map(describeResponse).join(' | ')).toBe(1);
      const loser = answers.find((r) => r.status >= 300);
      expect(loser?.code).toBe('INVALID_TOKEN');
      expect((await eventsAfter(since, 'account.activated')).length).toBe(1);
      const used = await one<{ n: string }>('SELECT count(*)::text AS n FROM "ActivationToken" WHERE "userId" = $1 AND "usedAt" IS NOT NULL', [userId]);
      expect(used.n).toBe('1');
    });

    it('row 25: an expired link is refused exactly like an unknown or an already used one', async () => {
      const expired = await newAccount();
      await sql(`UPDATE "ActivationToken" SET "expiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [expired.userId]);
      const used = await newAccount();
      expect((await activate(await visitor(), used.token, newPassword())).status).toBeLessThan(300);

      const answers = [
        await activate(await visitor(), expired.token, newPassword()),
        await activate(await visitor(), used.token, newPassword()),
        await activate(await visitor(), randomBytes(32).toString('base64url'), newPassword()),
      ];
      for (const res of answers) {
        expect(res.code, describeResponse(res)).toBe('INVALID_TOKEN');
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
      expect(new Set(answers.map((r) => `${String(r.status)} ${r.text}`)).size, 'one identical answer').toBe(1);
      const stillPending = await one<{ passwordHash: string | null }>('SELECT "passwordHash" FROM "User" WHERE id = $1', [expired.userId]);
      expect(stillPending.passwordHash).toBeNull();
    });

    it('row 25: a new link voids the older ones', async () => {
      const { userId, token: first } = await newAccount();
      const before = await emailIds(userId);
      const reissued = await reissueActivation(primary.client, userId);
      expect(reissued.status, describeResponse(reissued)).toBeLessThan(300);
      const { token: second } = await activationLinkFor(userId, before);
      expect(second).not.toBe(first);
      expect((await activate(await visitor(), first, newPassword())).code).toBe('INVALID_TOKEN');
      expect((await activate(await visitor(), second, newPassword())).status).toBeLessThan(300);
    });

    it('row 25: the token is stored as a digest only', async () => {
      const { userId, token } = await newAccount();
      const rows = await sql<{ tokenHash: string }>('SELECT "tokenHash" FROM "ActivationToken" WHERE "userId" = $1', [userId]);
      expect(rows.length).toBe(1);
      expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(await sql('SELECT * FROM "ActivationToken"'))).not.toContain(token);
    });

    it('row 25: the activation enforces the password policy and opens no session; the account can then log in', async () => {
      const { userId, token, email } = await newAccount();
      const localPart = email.split('@')[0] ?? '';
      const client = await visitor();
      for (const password of ['Short-pw-1', `${localPart}-Pw-2026`, 'x'.repeat(129)]) {
        const res = await activate(client, token, password);
        expect(res.status, `password of ${String(password.length)} characters: ${describeResponse(res)}`).toBeGreaterThanOrEqual(400);
      }
      const password = newPassword();
      const ok = await activate(client, token, password);
      expect(ok.status, describeResponse(ok)).toBeLessThan(300);
      expect(client.cookie(COOKIE.session), 'no session after activation').toBeUndefined();
      expect(await count('SELECT count(*)::text AS n FROM "Session" WHERE "userId" = $1', [userId])).toBe(0);

      const pending = await startLogin({ id: userId, email, password, fullName: '', phone: '', isDemo: false, roles: [], roleAssignmentId: '' });
      expect(pending.response.status).toBe(200);
    });

    it('a link can be reissued only for an account not yet activated', async () => {
      const { userId, token } = await newAccount();
      expect((await activate(await visitor(), token, newPassword())).status).toBeLessThan(300);
      const res = await reissueActivation(primary.client, userId);
      expect(res.status, describeResponse(res)).toBe(403);
      expect(res.code).toBe('FORBIDDEN');
      const unknown = await reissueActivation(primary.client, randomUUID());
      expect(unknown.status, describeResponse(unknown)).toBe(404);
    });
  });

  it('the rules validator, who is not an administrator, cannot create accounts', async () => {
    const client = await login(validator);
    expect((await reauthenticate(client, validator.password ?? '')).status).toBe(200);
    const res = await createAccount(client, accountDraft());
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'FORBIDDEN' });
  });
});
