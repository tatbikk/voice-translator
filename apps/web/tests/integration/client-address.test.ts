// Memo row 6: bypassing the attempt limits by forging the client address.
// Only X-Real-IP (set by the hosting edge) counts; X-Forwarded-For and
// Forwarded are ignored; without X-Real-IP every request falls into one
// shared bucket; the password lock is keyed on the e-mail, not the address.
// The global passphrase cap is tested in access-global-cap.test.ts.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { passGate, visitor } from '../helpers/auth';
import { eventsAfter, headSeq } from '../helpers/db';
import { createUser } from '../helpers/factories';
import { COOKIE, Client, describeResponse, nextIp } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const wrongPassphrase = () => `not-the-passphrase-${randomBytes(6).toString('hex')}`;
const randomAddress = () => `203.0.113.${String(1 + Math.floor(Math.random() * 250))}`;

describe('forged client addresses (memo row 6)', () => {
  useFreshDatabase();

  it('row 6: rotating X-Forwarded-For and X-Real-IP on every request does not lift the password lock', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    for (let i = 0; i < 5; i += 1) {
      const client = await visitor();
      const res = await client.post(
        '/api/v1/auth/login',
        { email: user.email, password: `Wrong-password-${String(i)}-xyz` },
        { headers: { 'X-Forwarded-For': randomAddress(), Forwarded: `for=${randomAddress()}` } },
      );
      expect(res.envelope?.ok).toBe(false);
    }
    const last = await visitor();
    const res = await last.post(
      '/api/v1/auth/login',
      { email: user.email, password: user.password },
      { headers: { 'X-Forwarded-For': randomAddress() } },
    );
    expect(res.status, describeResponse(res)).toBe(423);
  });

  it('row 6: X-Forwarded-For is ignored: rotating it behind one X-Real-IP keeps the per-client passphrase limit', async () => {
    const client = new Client({ ip: nextIp() });
    const since = await headSeq();
    for (let i = 0; i < 10; i += 1) {
      const res = await client.post(
        '/api/v1/access',
        { code: wrongPassphrase() },
        { headers: { 'X-Forwarded-For': randomAddress(), Forwarded: `for=${randomAddress()}` } },
      );
      expect(res.envelope?.ok, describeResponse(res)).toBe(false);
    }
    for (let i = 0; i < 2; i += 1) {
      const res = await client.post(
        '/api/v1/access',
        { code: process.env.ACCESS_CODE },
        { headers: { 'X-Forwarded-For': randomAddress(), Forwarded: `for=${randomAddress()}` } },
      );
      expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
    }
    expect(client.cookie(COOKIE.access)).toBeUndefined();
    expect((await eventsAfter(since, 'access.code.blocked')).some((e) => e.details.scope === 'client')).toBe(true);
  });

  it('row 6: requests without X-Real-IP share one bucket, whatever their X-Forwarded-For', async () => {
    for (let i = 0; i < 10; i += 1) {
      const anonymous = new Client({ ip: null });
      await anonymous.post('/api/v1/access', { code: wrongPassphrase() }, { headers: { 'X-Forwarded-For': randomAddress() } });
    }
    const another = new Client({ ip: null });
    const res = await another.post(
      '/api/v1/access',
      { code: process.env.ACCESS_CODE },
      { headers: { 'X-Forwarded-For': randomAddress() } },
    );
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
    expect(another.cookie(COOKIE.access)).toBeUndefined();

    // The shared bucket is the address-less one, not a global block.
    const addressed = new Client({ ip: nextIp() });
    expect((await passGate(addressed)).status).toBe(200);
  });

  it('row 6: the address is stored only as a keyed hash', async () => {
    const ip = nextIp();
    const since = await headSeq();
    const client = new Client({ ip });
    await passGate(client, wrongPassphrase());
    const appended = await eventsAfter(since);
    expect(appended.length).toBeGreaterThan(0);
    for (const event of appended) {
      expect(JSON.stringify(event)).not.toContain(ip);
      if (event.clientIdHash !== null) expect(event.clientIdHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(appended.some((e) => e.clientIdHash !== null), 'refusals carry the client hash').toBe(true);
  });

  it('row 6: two addresses of one IPv6 /64 network count as one client', async () => {
    const prefix = `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}`;
    for (let i = 0; i < 10; i += 1) {
      const client = new Client({ ip: `${prefix}::${(i + 1).toString(16)}` });
      await passGate(client, wrongPassphrase());
    }
    const neighbour = new Client({ ip: `${prefix}:ffff:ffff:ffff:fffe` });
    const res = await passGate(neighbour);
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
  });
});
