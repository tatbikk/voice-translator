// Memo row 12: cross-site request forgery. Non-GET requests need Origin equal
// to the APP_URL origin, Sec-Fetch-Site (when present) same-origin, and a
// token = HMAC(csrf key, binding) where the binding is the session id, or the
// server-issued __Host-mr-csrf id when there is no session (contract §5, §6).
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { login, visitor } from '../helpers/auth';
import { capturingEvents, notificationsOf } from '../helpers/db';
import { appOrigin } from '../helpers/env';
import { createUser, type TestUser } from '../helpers/factories';
import { COOKIE, Client, describeResponse, type ApiResponse, type RequestOptions } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

let user!: TestUser;
let client!: Client;
let notificationId!: string;

function markRead(c: Client, options: RequestOptions = {}): Promise<ApiResponse> {
  return c.post(`/api/v1/notifications/${notificationId}/read`, undefined, options);
}

async function expectCsrfRefusal(run: () => Promise<ApiResponse>): Promise<void> {
  const { result: res, events } = await capturingEvents(run);
  expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  expect(events.some((e) => e.action === 'access.denied' && e.details.step === 'CSRF'), 'the refusal is logged').toBe(true);
  expect((await notificationsOf(user.id))[0]?.readAt ?? null, 'nothing was changed').toBeNull();
}

describe('cross-site request forgery (memo row 12)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    user = await createUser({ roles: ['LAWYER'] });
    client = await login(user);
    notificationId = (await notificationsOf(user.id))[0]?.id ?? '';
  });

  it('row 12: a request without a token is refused', async () => {
    await expectCsrfRefusal(() => markRead(client, { csrf: 'none' }));
  });

  it('row 12: a wrong token is refused', async () => {
    await expectCsrfRefusal(() => markRead(client, { csrf: randomBytes(32).toString('base64url') }));
  });

  it("row 12: another session's token is refused", async () => {
    const other = await login(await createUser({ roles: ['LAWYER'] }));
    const foreign = await other.csrf();
    expect(foreign).toEqual(expect.any(String));
    await expectCsrfRefusal(() => markRead(client, { csrf: foreign ?? '' }));
  });

  it('row 12: a binding cookie chosen by the client is refused', async () => {
    const attacker = await visitor();
    const chosen = `attacker-chosen-${randomBytes(8).toString('hex')}`;
    const res = await attacker.post('/api/v1/preferences', { locale: 'fr' }, {
      cookies: { [COOKIE.csrf]: chosen },
      csrf: randomBytes(32).toString('base64url'),
    });
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'CSRF_REJECTED' });

    const own = attacker.cookie(COOKIE.csrf) ?? '';
    const forged = `${own.split('.')[0] ?? own}.${randomBytes(32).toString('base64url')}`;
    const token = await attacker.csrf();
    const res2 = await attacker.post('/api/v1/preferences', { locale: 'fr' }, { cookies: { [COOKIE.csrf]: forged }, csrf: token ?? '' });
    expect({ status: res2.status, code: res2.code }, describeResponse(res2)).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  });

  it("row 12: a visitor's valid binding cookie and token do not authorise a request carrying a session", async () => {
    const attacker = await visitor();
    const token = await attacker.csrf();
    const binding = attacker.cookie(COOKIE.csrf) ?? '';
    await expectCsrfRefusal(() => markRead(client, { cookies: { [COOKIE.csrf]: binding }, csrf: token ?? '' }));
  });

  it('row 12: the token issued before the login is no longer valid once the session exists', async () => {
    const someone = await createUser({ roles: ['LAWYER'] });
    const browser = await visitor();
    const before = await browser.csrf();
    await login(someone, { client: browser });
    const id = (await notificationsOf(someone.id))[0]?.id ?? '';
    const res = await browser.post(`/api/v1/notifications/${id}/read`, undefined, { csrf: before ?? '' });
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'CSRF_REJECTED' });
  });

  it('row 12: a foreign Origin is refused, even with a valid token', async () => {
    await expectCsrfRefusal(() => markRead(client, { origin: 'https://evil.example' }));
  });

  it('row 12: an Origin that only begins like the platform origin is refused', async () => {
    await expectCsrfRefusal(() => markRead(client, { origin: `${appOrigin()}.evil.example` }));
  });

  it('row 12: a request without Origin is refused', async () => {
    await expectCsrfRefusal(() => markRead(client, { origin: null }));
  });

  it('row 12: Sec-Fetch-Site cross-site or same-site is refused', async () => {
    await expectCsrfRefusal(() => markRead(client, { headers: { 'Sec-Fetch-Site': 'cross-site' } }));
    await expectCsrfRefusal(() => markRead(client, { headers: { 'Sec-Fetch-Site': 'same-site' } }));
  });

  it('row 12: the visitor passphrase form itself is protected', async () => {
    const fresh = new Client();
    const res = await fresh.post('/api/v1/access', { code: process.env.ACCESS_CODE }, { csrf: 'none' });
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 403, code: 'CSRF_REJECTED' });
    expect(fresh.cookie(COOKIE.access)).toBeUndefined();
    const foreign = await fresh.post('/api/v1/access', { code: process.env.ACCESS_CODE }, { origin: 'https://evil.example' });
    expect(foreign.code).toBe('CSRF_REJECTED');
  });

  it('with the token, the same Origin and no Sec-Fetch-Site header, the request succeeds', async () => {
    const res = await markRead(client, { headers: { 'Sec-Fetch-Site': null } });
    expect(res.status, describeResponse(res)).toBe(200);
    expect((await notificationsOf(user.id))[0]?.readAt).not.toBeNull();
  });
});
