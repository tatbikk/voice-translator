// Memo row 29, contract §4.5 and §6 step 1: exhausting the server with long
// passwords or large requests. A body over 16 KB is refused before it is
// parsed (with or without Content-Length); every field has a maximum length
// (password 128, e-mail 254, code exactly six digits, names 120) and an
// over-long password is refused before any hashing or counting.
import { beforeAll, describe, expect, it } from 'vitest';
import { accountDraft, adminSession, createAccount, type AdminSession } from '../helpers/admin';
import { login, startLogin, visitor } from '../helpers/auth';
import { authAttemptCount, capturingEvents } from '../helpers/db';
import { createUser } from '../helpers/factories';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const SIXTEEN_KB = 16 * 1024;

function streamOf(size: number): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode(`{"email":"a@itest.mahkama.example","password":"${'p'.repeat(size)}"}`);
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      sent = true;
      controller.enqueue(chunk);
    },
  });
}

function expectInvalid(res: ApiResponse, field: string): void {
  expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 422, code: 'INVALID_INPUT' });
  expect(Object.keys(res.error?.fields ?? {}), describeResponse(res)).toContain(field);
}

let gate!: Client;
let admin!: AdminSession;

describe('request and field limits (memo row 29)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    gate = await visitor();
    admin = await adminSession();
  });

  it('row 29: a body over 16 KB is refused before it is parsed', async () => {
    const attempts = await authAttemptCount();
    const body = JSON.stringify({ email: 'a@itest.mahkama.example', password: 'p'.repeat(SIXTEEN_KB) });
    const { result: res, events } = await capturingEvents(() =>
      gate.post('/api/v1/auth/login', undefined, { rawBody: body, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(res.status, describeResponse(res)).toBe(413);
    expect(res.envelope?.ok).toBe(false);
    expect(await authAttemptCount(), 'no login attempt was processed').toBe(attempts);
    expect(events.some((e) => e.action === 'access.denied' && e.details.step === 'BODY')).toBe(true);
  });

  it('row 29: a streamed body over 16 KB, without Content-Length, is refused as well', async () => {
    const attempts = await authAttemptCount();
    const res = await gate.post('/api/v1/auth/login', undefined, {
      rawBody: streamOf(20 * 1024),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status, describeResponse(res)).toBe(413);
    expect(await authAttemptCount()).toBe(attempts);
  });

  it('a body just under 16 KB is read (and refused only for its content)', async () => {
    const body = JSON.stringify({ email: 'a@itest.mahkama.example', password: 'p'.repeat(SIXTEEN_KB - 200) });
    const res = await gate.post('/api/v1/auth/login', undefined, { rawBody: body, headers: { 'Content-Type': 'application/json' } });
    expect(res.status, describeResponse(res)).toBe(422);
  });

  it('row 29: a password of 129 characters is refused before hashing, and is not counted as an attempt', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const attempts = await authAttemptCount();
    const start = performance.now();
    const res = await gate.post('/api/v1/auth/login', { email: user.email, password: 'p'.repeat(129) });
    const duration = performance.now() - start;
    expectInvalid(res, 'password');
    expect(await authAttemptCount()).toBe(attempts);
    expect(duration, 'answered without running Argon2id').toBeLessThan(2_000);
  });

  it('row 29: an e-mail of 255 characters is refused', async () => {
    const res = await gate.post('/api/v1/auth/login', { email: `${'a'.repeat(243)}@itest.example`, password: 'Some-password-2026' });
    expectInvalid(res, 'email');
  });

  it('row 29: the second-factor code is exactly six digits, and malformed codes are not counted', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    const attempts = await authAttemptCount('SECOND_FACTOR');
    for (const code of ['12345', '1234567', 'abcdef', '12 456', '١٢٣٤٥٦٧']) {
      expectInvalid(await pending.client.post('/api/v1/auth/second-factor', { code }), 'code');
    }
    expect(await authAttemptCount('SECOND_FACTOR')).toBe(attempts);
    expect((await pending.client.post('/api/v1/auth/second-factor', { code: pending.code })).status).toBe(200);
  });

  it('row 29: an over-long password is refused by the re-authentication and the activation without counting', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const client = await login(user);
    const attempts = await authAttemptCount();
    expectInvalid(await client.post('/api/v1/auth/reauth', { password: 'p'.repeat(129) }), 'password');
    expectInvalid(await gate.post('/api/v1/auth/activate', { token: 'A'.repeat(43), password: 'p'.repeat(129) }), 'password');
    expect(await authAttemptCount()).toBe(attempts);
  });

  it('row 29: names over 120 characters are refused', async () => {
    const res = await createAccount(admin.client, accountDraft({ fullName: 'ا'.repeat(121) }));
    expectInvalid(res, 'fullName');
  });

  it('a malformed JSON body is refused as invalid input', async () => {
    const res = await gate.post('/api/v1/auth/login', undefined, { rawBody: '{"email":', headers: { 'Content-Type': 'application/json' } });
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 422, code: 'INVALID_INPUT' });
  });
});
