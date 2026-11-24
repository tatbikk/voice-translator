// Memo rows 13 (session fixation), 14 (abandoned sessions, revoked roles,
// disabled users) and 8 (a holder of two roles acting with the other one),
// with the session rules of contract §5: opaque token stored as SHA-256,
// rotated at the second factor, at role selection and at a demo switch; idle
// timeout not renewed by background refresh; absolute lifetime of 12 hours;
// the guard re-reads the user and the role on every request.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ageSessions, currentSession, login, selectRole, startLogin, submitCode, visitor } from '../helpers/auth';
import { capturingEvents, eventsAfter, headSeq, liveSession, notificationsOf, one, sessionsOf, sql } from '../helpers/db';
import { idleMinutes } from '../helpers/env';
import { createNotification, createUser, disableUser, revokeRole, roleAssignmentOf } from '../helpers/factories';
import { COOKIE, Client, describeResponse, type ApiResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

function expectNoSession(res: ApiResponse): void {
  expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 401, code: 'SESSION_REQUIRED' });
}

/** A request carrying an older session token. */
function withToken(client: Client, token: string): Promise<ApiResponse> {
  return client.get('/api/v1/notifications', { cookies: { [COOKIE.session]: token } });
}

const BACKGROUND = { 'X-Background-Refresh': '1' };

describe('sessions (memo rows 8, 13, 14)', () => {
  useFreshDatabase();

  describe('row 13: session fixation', () => {
    it('row 13: the token of the pending session is refused after the second factor', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const pending = await startLogin(user);
      const before = pending.client.cookie(COOKIE.session) ?? '';
      expect(before.length).toBeGreaterThan(20);
      expect((await submitCode(pending.client, pending.code)).status).toBe(200);
      const after = pending.client.cookie(COOKIE.session) ?? '';
      expect(after).not.toBe(before);
      expectNoSession(await withToken(pending.client, before));
      expect((await pending.client.get('/api/v1/notifications')).status).toBe(200);
    });

    it('row 13: the token is renewed at role selection and the previous one is refused', async () => {
      const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT'] });
      const client = await login(user, { stopAtRole: true });
      const before = client.cookie(COOKIE.session) ?? '';
      expect((await selectRole(client, roleAssignmentOf(user, 'PANEL_PRESIDENT'))).status).toBe(200);
      expect(client.cookie(COOKIE.session)).not.toBe(before);
      expectNoSession(await withToken(client, before));
      expect((await client.get('/api/v1/notifications')).status).toBe(200);
    });

    it('row 13: the token is renewed when an active user switches role, and the previous one is refused', async () => {
      const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT'] });
      const client = await login(user, { role: 'JUDGE_RAPPORTEUR' });
      const before = client.cookie(COOKIE.session) ?? '';
      expect((await selectRole(client, roleAssignmentOf(user, 'PANEL_PRESIDENT'))).status).toBe(200);
      expect(client.cookie(COOKIE.session)).not.toBe(before);
      expectNoSession(await withToken(client, before));
    });

    it('row 13: the token is renewed at a demo account switch, and the previous session is revoked', async () => {
      const user = await createUser({ roles: ['LAWYER'], isDemo: true });
      const target = await createUser({ roles: ['EXPERT'], isDemo: true });
      const client = await login(user);
      const before = client.cookie(COOKIE.session) ?? '';
      const res = await client.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId: target.roleAssignmentId } });
      expect(res.status, describeResponse(res)).toBe(200);
      expect(client.cookie(COOKIE.session)).not.toBe(before);
      expectNoSession(await withToken(client, before));
      expect(await liveSession(user.id), 'the session switched from is revoked').toBeNull();
    });

    it('row 13: a session token chosen by the client is never adopted', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const browser = await visitor();
      const chosen = randomBytes(32).toString('base64url');
      browser.setCookie(COOKIE.session, chosen);
      await login(user, { client: browser });
      expect(browser.cookie(COOKIE.session)).not.toBe(chosen);
      expectNoSession(await withToken(browser, chosen));
    });

    it('row 13: the database keeps only a digest of the token', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      const token = client.cookie(COOKIE.session) ?? '';
      const rows = await sql<{ tokenHash: string }>('SELECT "tokenHash" FROM "Session" WHERE "userId" = $1', [user.id]);
      for (const row of rows) {
        expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.tokenHash).not.toBe(token);
      }
      const dump = JSON.stringify(await sql('SELECT * FROM "Session"'));
      expect(dump).not.toContain(token);
      const digests = [
        createHash('sha256').update(token).digest('hex'),
        createHash('sha256').update(Buffer.from(token, 'base64url')).digest('hex'),
      ];
      expect(rows.some((r) => digests.includes(r.tokenHash)), 'tokenHash is the SHA-256 of the token').toBe(true);
    });

    it('the session cookie is HttpOnly, Secure, host-only, SameSite=Lax and ends with the browser session', async () => {
      const client = await login(await createUser({ roles: ['LAWYER'] }));
      const attributes = client.cookieAttributes(COOKIE.session) ?? {};
      expect(attributes.httponly).toBe(true);
      expect(attributes.secure).toBe(true);
      expect(attributes.path).toBe('/');
      expect(attributes.domain).toBeUndefined();
      expect(String(attributes.samesite).toLowerCase()).toBe('lax');
      expect(attributes['max-age']).toBeUndefined();
      expect(attributes.expires).toBeUndefined();
    });

    it('the device cookie is HttpOnly, Secure, host-only, SameSite=Strict and lasts about 180 days', async () => {
      const client = await login(await createUser({ roles: ['LAWYER'] }));
      const attributes = client.cookieAttributes(COOKIE.device) ?? {};
      expect(client.cookie(COOKIE.device)).toBeDefined();
      expect(attributes.httponly).toBe(true);
      expect(attributes.secure).toBe(true);
      expect(attributes.path).toBe('/');
      expect(attributes.domain).toBeUndefined();
      expect(String(attributes.samesite).toLowerCase()).toBe('strict');
      const day = 24 * 3600;
      const maxAge = typeof attributes['max-age'] === 'string' ? Number(attributes['max-age']) : null;
      const expires = typeof attributes.expires === 'string' ? (Date.parse(attributes.expires) - Date.now()) / 1000 : null;
      const lifetime = maxAge ?? expires ?? 0;
      expect(lifetime).toBeGreaterThan(179 * day);
      expect(lifetime).toBeLessThanOrEqual(181 * day);
    });
  });

  describe('row 14: abandoned sessions, revoked roles, disabled users', () => {
    it('row 14: background polling does not keep a session alive: refused after the idle delay', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      const idle = idleMinutes();
      await ageSessions(user.id, idle - 1);
      const polled = await client.get('/api/v1/notifications', { headers: BACKGROUND });
      expect(polled.status, describeResponse(polled)).toBe(200);
      const session = await currentSession(user);
      expect(Date.now() - session.lastSeenAt.getTime(), 'background polling does not renew the activity').toBeGreaterThan((idle - 2) * 60_000);

      await ageSessions(user.id, 2);
      const since = await headSeq();
      expectNoSession(await client.get('/api/v1/notifications', { headers: BACKGROUND }));
      const expired = await eventsAfter(since, 'auth.session.expired');
      expect(expired.some((e) => e.details.kind === 'IDLE')).toBe(true);
    });

    it('row 14: an ordinary request renews the idle delay', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      const idle = idleMinutes();
      await ageSessions(user.id, idle - 1);
      expect((await client.get('/api/v1/notifications')).status).toBe(200);
      const session = await currentSession(user);
      expect(Date.now() - session.lastSeenAt.getTime()).toBeLessThan(60_000);
      await ageSessions(user.id, 2);
      expect((await client.get('/api/v1/notifications')).status).toBe(200);
    });

    it('row 14: the absolute lifetime of twelve hours ends a session even in constant use', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      const session = await currentSession(user);
      const lifetime = session.absoluteExpiresAt.getTime() - session.createdAt.getTime();
      expect(Math.abs(lifetime - 12 * 3600_000)).toBeLessThan(60_000);
      await sql(
        `UPDATE "Session" SET "createdAt" = now() - interval '12 hours 1 minute', "absoluteExpiresAt" = now() - interval '1 minute'
          WHERE id = $1`,
        [session.id],
      );
      const since = await headSeq();
      expectNoSession(await client.get('/api/v1/notifications'));
      expect((await eventsAfter(since, 'auth.session.expired')).some((e) => e.details.kind === 'ABSOLUTE')).toBe(true);
    });

    it('row 14: revoking the role ends the session at the next request', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      await revokeRole(user.roleAssignmentId);
      const since = await headSeq();
      expectNoSession(await client.get('/api/v1/notifications'));
      const revoked = await eventsAfter(since, 'auth.session.revoked');
      expect(revoked.some((e) => e.details.cause === 'ROLE_REVOKED')).toBe(true);
      expect(await liveSession(user.id)).toBeNull();
    });

    it('row 14: disabling the account ends the session at the next request', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      await disableUser(user.id);
      const since = await headSeq();
      expectNoSession(await client.get('/api/v1/notifications'));
      const revoked = await eventsAfter(since, 'auth.session.revoked');
      expect(revoked.some((e) => e.details.cause === 'USER_DISABLED')).toBe(true);
      expect(await liveSession(user.id)).toBeNull();
    });

    it('row 14: a session revoked once stays revoked when the role comes back', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      await revokeRole(user.roleAssignmentId);
      expectNoSession(await client.get('/api/v1/notifications'));
      await sql('UPDATE "RoleAssignment" SET "revokedAt" = NULL WHERE id = $1', [user.roleAssignmentId]);
      expectNoSession(await client.get('/api/v1/notifications'));
    });
  });

  describe('logout', () => {
    it('logout revokes the session, clears its cookies, keeps the device cookie and sends Clear-Site-Data', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await login(user);
      const token = client.cookie(COOKIE.session) ?? '';
      const keep = client.clone();
      const { result: res, events } = await capturingEvents(() => client.post('/api/v1/auth/logout'));
      expect(res.status, describeResponse(res)).toBe(200);
      const clear = res.headers.get('Clear-Site-Data') ?? '';
      expect(clear).toContain('"storage"');
      // "cookies" would erase the device cookie and undo decision 11 (reviews S-05, A-09).
      expect(clear).not.toContain('"cookies"');
      expect(client.cookie(COOKIE.session)).toBeUndefined();
      expect(client.cookie(COOKIE.device), 'the device cookie survives the logout').toBeDefined();
      expect(events.map((e) => e.action)).toContain('auth.logout');
      expectNoSession(await withToken(keep, token));
      expect(await liveSession(user.id)).toBeNull();
    });
  });

  describe('row 8: acting with the selected role only', () => {
    it('row 8: a user holding two roles acts with the role selected in the session, and switching changes it', async () => {
      const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT'] });
      const first = (await notificationsOf(user.id))[0]?.id ?? '';
      const second = await createNotification(user.id);
      const client = await login(user, { role: 'JUDGE_RAPPORTEUR' });
      const judge = roleAssignmentOf(user, 'JUDGE_RAPPORTEUR');
      const president = roleAssignmentOf(user, 'PANEL_PRESIDENT');

      const { events: asJudge } = await capturingEvents(() => client.post(`/api/v1/notifications/${first}/read`));
      const read = asJudge.find((e) => e.action === 'notification.read');
      expect(read?.actorUserId).toBe(user.id);
      expect(read?.actorRole).toBe('JUDGE_RAPPORTEUR');
      expect(read?.actorRoleAssignmentId).toBe(judge);

      const { result: switched, events: switching } = await capturingEvents(() => selectRole(client, president));
      expect(switched.status, describeResponse(switched)).toBe(200);
      expect(switching.some((e) => e.action === 'auth.role.selected' && e.details.roleAssignmentId === president)).toBe(true);

      const { events: asPresident } = await capturingEvents(() => client.post(`/api/v1/notifications/${second}/read`));
      const read2 = asPresident.find((e) => e.action === 'notification.read');
      expect(read2?.actorRole).toBe('PANEL_PRESIDENT');
      expect(read2?.actorRoleAssignmentId).toBe(president);
    });

    it("row 8: someone else's, an unknown or a revoked role assignment is refused with one 404", async () => {
      const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT', 'PANEL_MEMBER'] });
      const other = await createUser({ roles: ['PANEL_PRESIDENT'] });
      await sql('UPDATE "RoleAssignment" SET "revokedAt" = now() WHERE id = $1', [roleAssignmentOf(user, 'PANEL_MEMBER')]);
      const client = await login(user, { role: 'JUDGE_RAPPORTEUR' });
      const answers = [
        await selectRole(client, other.roleAssignmentId),
        await selectRole(client, randomUUID()),
        await selectRole(client, roleAssignmentOf(user, 'PANEL_MEMBER')),
      ];
      for (const res of answers) expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 404, code: 'NOT_FOUND' });
      expect(new Set(answers.map((r) => r.text)).size, 'one identical answer').toBe(1);
      expect((await currentSession(user)).roleAssignmentId).toBe(roleAssignmentOf(user, 'JUDGE_RAPPORTEUR'));
    });
  });

  describe('time of the last login', () => {
    it('a second login remembers the first; a demo switch does not count as a login', async () => {
      const user = await createUser({ roles: ['LAWYER'], isDemo: true });
      await login(user);
      const first = await one<{ lastLoginAt: Date | null }>('SELECT "lastLoginAt" FROM "User" WHERE id = $1', [user.id]);
      expect(first.lastLoginAt).not.toBeNull();
      await login(user);
      const sessions = await sessionsOf(user.id);
      const newest = sessions.filter((s) => s.revokedAt === null && s.state === 'ACTIVE').at(-1);
      expect(newest?.previousLoginAt?.getTime()).toBe(first.lastLoginAt?.getTime());
      const second = await one<{ lastLoginAt: Date | null }>('SELECT "lastLoginAt" FROM "User" WHERE id = $1', [user.id]);

      const someone = await visitor();
      const res = await someone.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId: user.roleAssignmentId } });
      expect(res.status, describeResponse(res)).toBe(200);
      const third = await one<{ lastLoginAt: Date | null }>('SELECT "lastLoginAt" FROM "User" WHERE id = $1', [user.id]);
      expect(third.lastLoginAt?.getTime()).toBe(second.lastLoginAt?.getTime());
    });
  });
});
