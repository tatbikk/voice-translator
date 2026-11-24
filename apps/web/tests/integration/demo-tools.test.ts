// Memo rows 18 and 19, contract §6 and §9: the demo tools. With the tools off
// every demo endpoint answers exactly like an unknown path. The outbox shows
// messages to accounts flagged isDemo to every visitor, and messages to any
// other account only to the session that asked for them. The account switcher
// refuses accounts that are not flagged demo with the same 404 as an unknown
// one, renews the token, revokes the previous session, opens an ACTIVE
// session with origin DEMO_SWITCH and no re-authentication, marks its events
// viaDemoSwitch, and every use is logged.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accountDraft, activationLinkFor, adminSession, createAccount } from '../helpers/admin';
import { codesIn, login, startLogin, visitor } from '../helpers/auth';
import { capturingEvents, eventsAfter, headSeq, liveSession, notificationsOf, outboundTo } from '../helpers/db';
import { overrideEnv } from '../helpers/env';
import { createUser, userIdByEmail } from '../helpers/factories';
import { COOKIE, Client, describeResponse, nextIp, type ApiResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { awayFromMinuteBoundary } from '../helpers/time';

function outbox(client: Client): Promise<ApiResponse> {
  return client.get('/api/demo/outbox');
}

function switchTo(client: Client, roleAssignmentId: string): Promise<ApiResponse> {
  return client.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId } });
}

describe('demo tools (memo rows 18 and 19)', () => {
  useFreshDatabase();

  describe('row 18: the tools in a mode that does not allow them', () => {
    it('row 18: with DEMO_TOOLS=false every demo endpoint answers exactly like an unknown path', async () => {
      const target = await createUser({ roles: ['LAWYER'], isDemo: true });
      const client = await visitor();
      const restore = await overrideEnv({ DEMO_TOOLS: 'false' });
      try {
        const unknownGet = await client.get('/api/v1/no-such-endpoint');
        const unknownPost = await client.post('/api/v1/no-such-endpoint', {});
        expect({ status: unknownGet.status, code: unknownGet.code }).toEqual({ status: 404, code: 'NOT_FOUND' });
        for (const res of [await outbox(client), await client.get('/api/demo/accounts')]) {
          expect({ status: res.status, body: res.text }, describeResponse(res)).toEqual({ status: 404, body: unknownGet.text });
        }
        const switched = await switchTo(client, target.roleAssignmentId);
        expect({ status: switched.status, body: switched.text }, describeResponse(switched)).toEqual({ status: 404, body: unknownPost.text });
        expect(await liveSession(target.id), 'no session was opened').toBeNull();
      } finally {
        await restore();
      }
    });
  });

  describe('row 19: the outbox', () => {
    it('row 19: codes sent to a demo account are shown to every visitor; codes of other accounts only to the session that asked', async () => {
      const demoUser = await createUser({ roles: ['LAWYER'], isDemo: true });
      const realUser = await createUser({ roles: ['LAWYER'], isDemo: false });
      const demoLogin = await startLogin(demoUser);
      const realLogin = await startLogin(realUser);
      const bystander = await visitor();
      const otherSession = await login(await createUser({ roles: ['EXPERT'], isDemo: true }));

      const seenByBystander = codesIn((await outbox(bystander)).text);
      expect(seenByBystander, 'a demo account code is visible to every visitor').toContain(demoLogin.code);
      expect(seenByBystander, 'the code of a non-demo account is not visible to another visitor').not.toContain(realLogin.code);
      expect(codesIn((await outbox(otherSession)).text), 'nor to another session').not.toContain(realLogin.code);
      expect(codesIn((await outbox(realLogin.client)).text), 'the session that asked sees its code').toContain(realLogin.code);

      const sms = (await outboundTo(realUser.id, 'SMS')).at(-1);
      expect(sms?.visibleToSessionId, 'the message is bound to the pending session').toBe((await liveSession(realUser.id))?.id);
    });

    it("row 19: the activation link of an account created by the administrator is shown only to the administrator's session", async () => {
      const { client: adminClient } = await adminSession();
      const draft = accountDraft();
      const created = await createAccount(adminClient, draft);
      expect(created.status, describeResponse(created)).toBeLessThan(300);
      const userId = await userIdByEmail(draft.email);
      const { token } = await activationLinkFor(userId);

      expect((await outbox(adminClient)).text, "the administrator's session sees the link").toContain(token);
      expect((await outbox(await visitor())).text, 'another visitor does not').not.toContain(token);
      const { client: otherAdmin } = await adminSession({ reauth: false });
      expect((await outbox(otherAdmin)).text, 'another administrator does not').not.toContain(token);
    });

    it('row 19: every view of the outbox is logged', async () => {
      const client = await visitor();
      const { result: res, events } = await capturingEvents(() => outbox(client));
      expect(res.status, describeResponse(res)).toBe(200);
      expect(events.map((e) => e.action)).toContain('demo.outbox.viewed');
    });
  });

  describe('row 19: the account switcher', () => {
    it('row 19: an account that is not flagged demo is refused with the same 404 as an unknown or malformed one', async () => {
      const realUser = await createUser({ roles: ['LAWYER'], isDemo: false });
      const client = await visitor();
      const since = await headSeq();
      const answers = [
        await switchTo(client, realUser.roleAssignmentId),
        await switchTo(client, randomUUID()),
        await switchTo(client, 'not-a-uuid'),
      ];
      for (const res of answers) expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 404, code: 'NOT_FOUND' });
      expect(new Set(answers.map((r) => r.text)).size, 'one identical answer').toBe(1);
      expect(client.cookie(COOKIE.session)).toBeUndefined();
      expect(await liveSession(realUser.id)).toBeNull();
      expect(await eventsAfter(since, 'demo.account.switched')).toEqual([]);
    });

    it('row 19: the accounts list of the switcher holds demo accounts only', async () => {
      const demoUser = await createUser({ roles: ['BAILIFF'], isDemo: true });
      const realUser = await createUser({ roles: ['BAILIFF'], isDemo: false });
      const res = await (await visitor()).get('/api/demo/accounts');
      expect(res.status, describeResponse(res)).toBe(200);
      expect(res.text).toContain(demoUser.roleAssignmentId);
      expect(res.text).not.toContain(realUser.roleAssignmentId);
      expect(res.text).not.toContain(realUser.email);
      expect(res.text).not.toMatch(/\$argon2/);
    });

    it('row 19: every switch is logged, and the new session is an active demo-switch session without re-authentication', async () => {
      const first = await createUser({ roles: ['LAWYER'], isDemo: true });
      const second = await createUser({ roles: ['CLERK_REGISTRATION'], isDemo: true });
      const client = await visitor();

      const { result: res, events } = await capturingEvents(() => switchTo(client, first.roleAssignmentId));
      expect(res.status, describeResponse(res)).toBe(200);
      expect(client.cookie(COOKIE.session)).toBeDefined();
      const switched = events.filter((e) => e.action === 'demo.account.switched');
      expect(switched.length).toBe(1);
      expect(switched[0]?.details).toEqual({ fromUserId: null, toUserId: first.id });
      const session = await liveSession(first.id);
      expect(session?.state).toBe('ACTIVE');
      expect(session?.origin).toBe('DEMO_SWITCH');
      expect(session?.reauthAt ?? null).toBeNull();
      expect(session?.roleAssignmentId).toBe(first.roleAssignmentId);

      const notification = (await notificationsOf(first.id))[0]?.id ?? '';
      const { events: later } = await capturingEvents(() => client.post(`/api/v1/notifications/${notification}/read`));
      const read = later.find((e) => e.action === 'notification.read');
      expect(read?.viaDemoSwitch, 'events of a switched session carry viaDemoSwitch').toBe(true);
      expect(read?.actorUserId).toBe(first.id);

      const previousToken = client.cookie(COOKIE.session) ?? '';
      const { events: again } = await capturingEvents(() => switchTo(client, second.roleAssignmentId));
      expect(again.find((e) => e.action === 'demo.account.switched')?.details).toEqual({ fromUserId: first.id, toUserId: second.id });
      expect(await liveSession(first.id), 'the previous session is revoked').toBeNull();
      const stale = await client.get('/api/v1/notifications', { cookies: { [COOKIE.session]: previousToken } });
      expect({ status: stale.status, code: stale.code }).toEqual({ status: 401, code: 'SESSION_REQUIRED' });
    });

    it('row 19: a switched session does not open the account creation (no re-authentication)', async () => {
      const admin = await createUser({ roles: ['SYSTEM_ADMIN'], isDemo: true });
      const client = await visitor();
      expect((await switchTo(client, admin.roleAssignmentId)).status).toBe(200);
      const res = await createAccount(client, accountDraft());
      expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'REAUTH_REQUIRED' });
    });

    it('the demo endpoints are limited to 60 requests per minute per client', async () => {
      const client = await visitor();
      await awayFromMinuteBoundary();
      const answers: number[] = [];
      for (let i = 0; i < 61; i += 1) answers.push((await client.get('/api/demo/accounts')).status);
      expect(answers.slice(0, 60).every((s) => s === 200), `first 60: ${answers.slice(0, 60).join(',')}`).toBe(true);
      expect(answers[60]).toBe(429);
      const other = await visitor({ ip: nextIp() });
      expect((await other.get('/api/demo/accounts')).status).toBe(200);
    });
  });
});
