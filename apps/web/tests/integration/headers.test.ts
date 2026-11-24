// Memo row 30 (integration part) and contract §6: what the route handlers
// themselves must put on their answers. Cache-Control: no-store on every /api
// answer, success or refusal; JSON envelopes; Retry-After on 429; and /healthz
// answering 200 {status:'ok'} without the access cookie, 503
// {status:'unavailable'} when the database refuses the connection.
// The static security headers (CSP, HSTS, nosniff, X-Robots-Tag…) are added by
// next.config.ts and src/proxy.ts, so they are asserted against the running
// server in tests/e2e/headers.spec.ts (page, API answer, 404 and /healthz).
import { describe, expect, it } from 'vitest';
import { login, visitor } from '../helpers/auth';
import { sql } from '../helpers/db';
import { createUser } from '../helpers/factories';
import { Client, describeResponse, type ApiResponse } from '../helpers/http';
import { closeAppDb, useFreshDatabase } from '../helpers/reset';

function expectNoStore(res: ApiResponse): void {
  expect(res.headers.get('Cache-Control') ?? '', describeResponse(res)).toMatch(/no-store/);
}

function expectJson(res: ApiResponse): void {
  expect(res.headers.get('Content-Type') ?? '', describeResponse(res)).toMatch(/^application\/json/);
  expect(res.envelope, `${describeResponse(res)} is an envelope`).not.toBeNull();
}

describe('answer headers of the API (memo row 30)', () => {
  useFreshDatabase();

  it('row 30: every API answer, success or refusal, carries Cache-Control: no-store and is a JSON envelope', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'] });
    const session = await login(lawyer);
    const answers = [
      await new Client().get('/api/v1/csrf'),
      await new Client().get('/api/v1/notifications'),
      await (await visitor()).get('/api/v1/notifications'),
      await session.get('/api/v1/notifications'),
      await session.get('/api/v1/admin/accounts'),
      await session.post('/api/v1/notifications/not-a-uuid/read'),
      await session.post('/api/v1/auth/reauth', { password: 'p'.repeat(200) }),
      await new Client().get('/api/v1/no-such-endpoint'),
      await new Client().post('/api/v1/access', { code: 'not-the-passphrase-0000' }),
    ];
    for (const res of answers) {
      expectNoStore(res);
      expectJson(res);
    }
  });

  it('row 30: answers never reveal the server software', async () => {
    const res = await new Client().get('/api/v1/csrf');
    expect(res.headers.get('X-Powered-By')).toBeNull();
    expect(res.headers.get('Server') ?? '').not.toMatch(/next|node|express/i);
  });

  it('/healthz answers 200 {status: "ok"} without the access cookie', async () => {
    const res = await new Client().get('/healthz');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'ok' });
  });

  it('/healthz answers 503 {status: "unavailable"} when the database refuses the runtime role, and nothing more', async () => {
    await sql('ALTER ROLE mahkama_app NOLOGIN');
    await closeAppDb();
    let res: ApiResponse;
    try {
      res = await new Client().get('/healthz');
    } finally {
      await sql('ALTER ROLE mahkama_app LOGIN');
      await closeAppDb();
    }
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ status: 'unavailable' });
    expect((await new Client().get('/healthz')).status, 'back once the database answers').toBe(200);
  });
});
