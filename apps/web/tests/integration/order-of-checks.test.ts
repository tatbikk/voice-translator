// Contract §6, order of checks: each step fails closed, the first failing step
// decides the answer, and every refusal leaves an access.denied event naming
// its step. Each test makes two checks fail at once and asserts which one wins.
//   1 body size and method  2 access gate  3 mode (demo endpoints)  4 CSRF
//   5 session  6 rate limit  7 params  8 authorization  9 re-authentication
//   10 body  11 handler
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accountDraft, adminSession, createAccount } from '../helpers/admin';
import { login, visitor } from '../helpers/auth';
import { capturingEvents, sql, type EventRow } from '../helpers/db';
import { overrideEnv } from '../helpers/env';
import { createCaseFile, createUser, theCourt } from '../helpers/factories';
import { Client, describeResponse, type ApiResponse } from '../helpers/http';
import { closeAppDb, useFreshDatabase } from '../helpers/reset';

function expectAnswer(res: ApiResponse, status: number, code: string): void {
  expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status, code });
}

function expectStepLogged(events: readonly EventRow[], step: string): void {
  const steps = events.filter((e) => e.action === 'access.denied').map((e) => e.details.step);
  expect(steps, `access.denied steps appended: ${JSON.stringify(steps)}`).toContain(step);
}

describe('order of checks (contract §6)', () => {
  useFreshDatabase();

  it('step 1 before step 2: an oversized body without the access cookie is refused for its size', async () => {
    const client = new Client();
    const body = JSON.stringify({ email: 'x@itest.mahkama.example', password: 'p'.repeat(17 * 1024) });
    const { result: res, events } = await capturingEvents(() =>
      client.post('/api/v1/auth/login', undefined, { rawBody: body, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(res.status, describeResponse(res)).toBe(413);
    expect(res.code).not.toBe('ACCESS_CODE_REQUIRED');
    expectStepLogged(events, 'BODY');
  });

  it('step 2 before step 3: a demo endpoint with the demo tools off and no access cookie answers ACCESS_CODE_REQUIRED', async () => {
    const restore = await overrideEnv({ DEMO_TOOLS: 'false' });
    try {
      const { result: res, events } = await capturingEvents(() => new Client().get('/api/demo/outbox'));
      expectAnswer(res, 401, 'ACCESS_CODE_REQUIRED');
      expectStepLogged(events, 'GATE');
    } finally {
      await restore();
    }
  });

  it('step 3 before step 4: with the demo tools off, a demo POST without a CSRF token answers 404 like an unknown path', async () => {
    const client = await visitor();
    const restore = await overrideEnv({ DEMO_TOOLS: 'false' });
    try {
      const { result: res, events } = await capturingEvents(() =>
        client.post('/api/demo/switch-account', undefined, { csrf: 'none', query: { roleAssignmentId: randomUUID() } }),
      );
      expectAnswer(res, 404, 'NOT_FOUND');
      const unknown = await client.post('/api/v1/no-such-endpoint', {}, { csrf: 'none' });
      expect(res.text).toBe(unknown.text);
      expectStepLogged(events, 'MODE');
    } finally {
      await restore();
    }
  });

  it('step 2 before step 4: no access cookie and no CSRF token answers ACCESS_CODE_REQUIRED', async () => {
    const { result: res, events } = await capturingEvents(() =>
      new Client().post('/api/v1/auth/login', { email: 'a@itest.mahkama.example', password: 'whatever-password' }, { csrf: 'none' }),
    );
    expectAnswer(res, 401, 'ACCESS_CODE_REQUIRED');
    expectStepLogged(events, 'GATE');
  });

  it('step 4 before step 5: no session and no CSRF token answers CSRF_REJECTED', async () => {
    const client = await visitor();
    const { result: res, events } = await capturingEvents(() => client.post('/api/v1/auth/logout', undefined, { csrf: 'none' }));
    expectAnswer(res, 403, 'CSRF_REJECTED');
    expectStepLogged(events, 'CSRF');
  });

  it('step 4 before step 8: a lawyer posting to the administration without a token answers CSRF_REJECTED', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'] });
    const client = await login(lawyer);
    const { result: res, events } = await capturingEvents(() => createAccount(client, accountDraft(), { csrf: 'none' }));
    expectAnswer(res, 403, 'CSRF_REJECTED');
    expectStepLogged(events, 'CSRF');
  });

  it('step 5 before step 8: no session on an administration endpoint answers SESSION_REQUIRED, not FORBIDDEN', async () => {
    const client = await visitor();
    const { result: res, events } = await capturingEvents(() => client.get('/api/v1/admin/accounts'));
    expectAnswer(res, 401, 'SESSION_REQUIRED');
    expectStepLogged(events, 'SESSION');
  });

  it('step 2 before step 6: a client over the lookup limit but without the access cookie answers ACCESS_CODE_REQUIRED', async () => {
    const court = await theCourt();
    const caseFile = await createCaseFile({ courtId: court.id });
    const client = await visitor();
    const query = { courtId: court.id, number: caseFile.number, code: caseFile.code, year: caseFile.year };
    for (let i = 0; i < 12; i += 1) await client.get('/api/v1/public/case-status', { query });
    const overLimit = await client.get('/api/v1/public/case-status', { query });
    expect(overLimit.status, describeResponse(overLimit)).toBe(429);
    const { result: res, events } = await capturingEvents(() =>
      client.get('/api/v1/public/case-status', { query, cookies: { '__Host-mr-access': null } }),
    );
    expectAnswer(res, 401, 'ACCESS_CODE_REQUIRED');
    expectStepLogged(events, 'GATE');
  });

  it('step 6 before steps 7 and 10: a client over the lookup limit sending a malformed query answers TOO_MANY_REQUESTS', async () => {
    const court = await theCourt();
    const caseFile = await createCaseFile({ courtId: court.id });
    const client = await visitor();
    const query = { courtId: court.id, number: caseFile.number, code: caseFile.code, year: caseFile.year };
    for (let i = 0; i < 12; i += 1) await client.get('/api/v1/public/case-status', { query });
    const { result: res, events } = await capturingEvents(() =>
      client.get('/api/v1/public/case-status', { query: { courtId: 'not-a-uuid', number: 'x', code: '', year: '20' } }),
    );
    expectAnswer(res, 429, 'TOO_MANY_REQUESTS');
    expect(Number(res.headers.get('Retry-After')), 'Retry-After header').toBeGreaterThan(0);
    expectStepLogged(events, 'RATE');
  });

  it('step 7 before step 8: a lawyer sending a malformed account id answers 404 (parameters), not FORBIDDEN', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'] });
    const client = await login(lawyer);
    const { result: res, events } = await capturingEvents(() => client.post('/api/v1/admin/accounts/not-a-uuid/activation'));
    expectAnswer(res, 404, 'NOT_FOUND');
    expectStepLogged(events, 'PARAMS');
  });

  it('step 8 before step 9: a lawyer without re-authentication answers FORBIDDEN, not REAUTH_REQUIRED', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'] });
    const client = await login(lawyer);
    const { result: res, events } = await capturingEvents(() => createAccount(client, accountDraft()));
    expectAnswer(res, 403, 'FORBIDDEN');
    expectStepLogged(events, 'AUTHZ');
  });

  it('step 8: a non-administrator gets the same answer for an existing and an unknown account id', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'] });
    const pending = await createUser({ roles: ['LITIGANT'], password: null, isDemo: false });
    const client = await login(lawyer);
    const existing = await client.post(`/api/v1/admin/accounts/${pending.id}/activation`);
    const unknown = await client.post(`/api/v1/admin/accounts/${randomUUID()}/activation`);
    expect({ status: existing.status, body: existing.text }).toEqual({ status: unknown.status, body: unknown.text });
    expect(existing.status).toBeGreaterThanOrEqual(403);
  });

  it('step 9 before step 10: the administrator without re-authentication and with an invalid body answers REAUTH_REQUIRED', async () => {
    const { client } = await adminSession({ reauth: false });
    const { result: res, events } = await capturingEvents(() => createAccount(client, {}));
    expectAnswer(res, 403, 'REAUTH_REQUIRED');
    expectStepLogged(events, 'REAUTH');
  });

  it('step 10: with a recent re-authentication, an invalid body answers INVALID_INPUT with the faulty fields', async () => {
    const { client } = await adminSession();
    const { result: res, events } = await capturingEvents(() =>
      createAccount(client, { fullName: '', email: 'not-an-email', phone: '', role: 'LAWYER' }),
    );
    expectAnswer(res, 422, 'INVALID_INPUT');
    const fields = res.error?.fields ?? {};
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(['email', 'requestReference']));
    for (const value of Object.values(fields)) expect(typeof value).toBe('string');
    expectStepLogged(events, 'BODY');
  });

  it('public endpoints skip the CSRF step: an unknown path answers 404 without a token or an Origin', async () => {
    const res = await new Client().post('/api/v1/no-such-endpoint', {}, { csrf: 'none', origin: null });
    expectAnswer(res, 404, 'NOT_FOUND');
  });

  it('step 11: an unexpected failure answers 500 INTERNAL with a correlation id and no detail of the cause', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const client = await login(user);
    await sql('ALTER ROLE mahkama_app NOLOGIN');
    await closeAppDb();
    let res: ApiResponse;
    try {
      res = await client.get('/api/v1/notifications');
    } finally {
      await sql('ALTER ROLE mahkama_app LOGIN');
      await closeAppDb();
    }
    expectAnswer(res, 500, 'INTERNAL');
    const everything = `${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${res.text}`;
    expect(everything, 'a correlation id in the answer').toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}/i);
    expect(res.text).not.toMatch(/mahkama_app|permission denied|not permitted to log in|ECONNREFUSED|password|stack|at .+\(.+:\d+:\d+\)/i);
  });
});
