// Memo rows 7 and 24, and the cookie table of contract §6: guessing the visitor
// passphrase (per-client limit: 10 failures / 15 min ⇒ blocked 15 min), cookies
// issued before a change of ACCESS_CODE refused afterwards, a cookie that
// cannot be forged, and the "next" parameter of /api/v1/access passed through
// safeInternalPath (an open redirect is impossible).
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { moroccoCalendarDate } from '@mahkama/core';
import { accessCode, passGate, visitor } from '../helpers/auth';
import { capturingEvents, eventsAfter, headSeq } from '../helpers/db';
import { appOrigin, appUrl, overrideEnv } from '../helpers/env';
import { theCourt, type CourtFixture } from '../helpers/factories';
import { COOKIE, Client, describeResponse, type ApiResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { trackSensitive } from '../helpers/sensitive';

let court!: CourtFixture;

const wrongPassphrase = () => `not-the-passphrase-${randomBytes(6).toString('hex')}`;

/** A gate-level request: refused with ACCESS_CODE_REQUIRED unless the client holds a valid access cookie. */
function gateProbe(client: Client, cookies?: Record<string, string | null>): Promise<ApiResponse> {
  return client.get('/api/v1/public/hearings', {
    query: { courtId: court.id, date: moroccoCalendarDate(new Date()) },
    ...(cookies ? { cookies } : {}),
  });
}

function expectPastGate(res: ApiResponse): void {
  expect(res.code, describeResponse(res)).not.toBe('ACCESS_CODE_REQUIRED');
  expect(res.status, describeResponse(res)).toBeLessThan(500);
}

function expectGateRefusal(res: ApiResponse): void {
  expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 401, code: 'ACCESS_CODE_REQUIRED' });
}

/** Where /api/v1/access sends the visitor: data.next, or the Location of a redirect. */
function redirectTarget(res: ApiResponse): string | null {
  const data = res.data as { next?: unknown } | undefined;
  if (typeof data?.next === 'string') return data.next;
  const location = res.headers.get('Location');
  if (location) {
    const url = new URL(location, appUrl());
    return url.origin === appOrigin() ? `${url.pathname}${url.search}${url.hash}` : url.href;
  }
  return null;
}

describe('visitor passphrase (memo rows 7 and 24)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    court = await theCourt();
  });

  it('the right passphrase sets the access cookie; the wrong one does not', async () => {
    const wrong = new Client();
    const { result: refused, events } = await capturingEvents(() => passGate(wrong, wrongPassphrase()));
    expect(refused.envelope?.ok, describeResponse(refused)).toBe(false);
    expect(wrong.cookie(COOKIE.access)).toBeUndefined();
    expect(events.map((e) => e.action)).toContain('access.code.rejected');

    const right = new Client();
    const { result: accepted, events: acceptedEvents } = await capturingEvents(() => passGate(right));
    expect(accepted.status, describeResponse(accepted)).toBe(200);
    expect(right.cookie(COOKIE.access)).toBeDefined();
    expect(acceptedEvents.map((e) => e.action)).toContain('access.code.accepted');
    expectPastGate(await gateProbe(right));
  });

  it('row 7: ten wrong passphrases from one client block it, even for the right passphrase', async () => {
    const client = new Client();
    const since = await headSeq();
    for (let i = 0; i < 10; i += 1) {
      const res = await passGate(client, wrongPassphrase());
      expect(res.envelope?.ok, describeResponse(res)).toBe(false);
    }
    const blocked = await passGate(client);
    expect({ status: blocked.status, code: blocked.code }, describeResponse(blocked)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
    const retry = Number(blocked.headers.get('Retry-After') ?? blocked.error?.retryAfterSeconds ?? 0);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    expect(client.cookie(COOKIE.access), 'no cookie while blocked').toBeUndefined();

    expect((await eventsAfter(since, 'access.code.rejected')).length).toBe(10);
    const blockedEvents = await eventsAfter(since, 'access.code.blocked');
    expect(blockedEvents.some((e) => e.details.scope === 'client')).toBe(true);

    // Another client is not affected by this client's block.
    expectPastGate(await gateProbe(await visitor()));
  });

  it('row 7: nine wrong passphrases do not block the client yet', async () => {
    const client = new Client();
    for (let i = 0; i < 9; i += 1) await passGate(client, wrongPassphrase());
    const res = await passGate(client);
    expect(res.status, describeResponse(res)).toBe(200);
    expect(client.cookie(COOKIE.access)).toBeDefined();
  });

  it('row 7: a cookie issued before the passphrase changed is refused afterwards', async () => {
    const before = await visitor();
    expectPastGate(await gateProbe(before));
    const original = accessCode();

    const changed = `changed-passphrase-${randomBytes(8).toString('hex')}`;
    trackSensitive('secret', changed);
    const restore = await overrideEnv({ ACCESS_CODE: changed });
    let after: Client;
    try {
      expectGateRefusal(await gateProbe(before));
      const old = new Client();
      expect((await passGate(old, original)).status, 'the former passphrase no longer opens the gate').not.toBe(200);
      expect(old.cookie(COOKIE.access)).toBeUndefined();
      after = new Client();
      expect((await passGate(after, changed)).status).toBe(200);
      expectPastGate(await gateProbe(after));
    } finally {
      await restore();
    }
    // Back to the first passphrase: the cookie issued under the other one is refused in turn.
    expectGateRefusal(await gateProbe(after));
  });

  it('row 7: an access cookie that was altered or invented is refused', async () => {
    const client = await visitor();
    const value = client.cookie(COOKIE.access) ?? '';
    expect(value.length).toBeGreaterThan(10);
    const middle = Math.floor(value.length / 2);
    const flip = (ch: string) => (ch === 'A' ? 'B' : 'A');
    const variants = [
      `${value.slice(0, middle)}${flip(value.charAt(middle))}${value.slice(middle + 1)}`,
      `${value.slice(0, -1)}${flip(value.slice(-1))}`,
      `${value}A`,
      value.slice(0, -4),
      'v1.9999999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '',
    ];
    const parts = value.split('.');
    if (parts.length === 3 && /^\d+$/.test(parts[1] ?? '')) {
      variants.push(`${parts[0] ?? ''}.${String(Number(parts[1]) + 30 * 24 * 3600 * 1000)}.${parts[2] ?? ''}`);
    }
    for (const variant of variants) {
      expectGateRefusal(await gateProbe(client, { [COOKIE.access]: variant }));
    }
  });

  it('the access cookie is HttpOnly, Secure, host-only, SameSite=Lax, Path=/ and lasts at most twelve hours', async () => {
    const client = await visitor();
    const attributes = client.cookieAttributes(COOKIE.access) ?? {};
    expect(attributes.httponly).toBe(true);
    expect(attributes.secure).toBe(true);
    expect(attributes.path).toBe('/');
    expect(attributes.domain).toBeUndefined();
    expect(String(attributes.samesite).toLowerCase()).toBe('lax');
    const maxAge = attributes['max-age'];
    if (typeof maxAge === 'string') expect(Number(maxAge)).toBeLessThanOrEqual(12 * 3600);
    const expires = attributes.expires;
    if (typeof expires === 'string') expect(Date.parse(expires)).toBeLessThanOrEqual(Date.now() + 12 * 3600_000 + 60_000);
  });

  it('the CSRF binding cookie is HttpOnly, Secure, host-only, SameSite=Lax and Path=/', async () => {
    const client = new Client();
    const token = await client.refreshCsrf();
    expect(token, 'GET /api/v1/csrf answers a token before the gate').toEqual(expect.any(String));
    const attributes = client.cookieAttributes(COOKIE.csrf) ?? {};
    expect(client.cookie(COOKIE.csrf)).toBeDefined();
    expect(attributes.httponly).toBe(true);
    expect(attributes.secure).toBe(true);
    expect(attributes.path).toBe('/');
    expect(attributes.domain).toBeUndefined();
    expect(String(attributes.samesite).toLowerCase()).toBe('lax');
  });

  describe('row 24: the return parameter of /api/v1/access', () => {
    const HOSTILE = ['//evil.example', '/\\evil.example', 'https://evil.example', '/%09/evil.example', 'javascript:alert(1)'];

    for (const next of HOSTILE) {
      it(`row 24: next=${JSON.stringify(next)} leads to the home page`, async () => {
        const res = await passGate(new Client(), accessCode(), next);
        expect(res.status, describeResponse(res)).toBe(200);
        expect(redirectTarget(res)).toBe('/');
      });
    }

    it('row 24: an internal path is kept as it is', async () => {
      for (const next of ['/track', '/login?next=%2Fdashboard']) {
        const res = await passGate(new Client(), accessCode(), next);
        expect(res.status, describeResponse(res)).toBe(200);
        expect(redirectTarget(res)).toBe(next);
      }
    });

    it('row 24: without next, the visitor goes to the home page', async () => {
      const res = await passGate(new Client());
      expect(redirectTarget(res)).toBe('/');
    });
  });
});
