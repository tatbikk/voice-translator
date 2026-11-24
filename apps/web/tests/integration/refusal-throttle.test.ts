// Memo row 28, contract §4.5 and §13 item 3: flooding the event log with
// refused requests. Unauthenticated refusals are logged one by one up to 30 a
// minute per client, authenticated ones up to 60 a minute per session; beyond,
// the answer is 429 and a single access.throttled event per client (or
// session) and minute carries the number of refusals it replaced.
// One long test: the aggregated events can only be observed once the minute
// is over.
import { describe, expect, it } from 'vitest';
import { login } from '../helpers/auth';
import { eventsAfter, headSeq, type EventRow } from '../helpers/db';
import { startWorker } from '../helpers/cli';
import { createUser } from '../helpers/factories';
import { Client, nextIp } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { awayFromMinuteBoundary, sleep, untilNextWindow } from '../helpers/time';

describe('refusal throttle (memo row 28)', () => {
  useFreshDatabase();

  it('row 28: past the limit, refusals stop being logged one by one, answer 429, and one event per minute carries their number', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'] });
    const session = await login(lawyer);
    await awayFromMinuteBoundary(20_000);
    const since = await headSeq();
    const start = Date.now();

    // Without the access cookie, from one address: 30 logged refusals, then 10 throttled.
    const ip = nextIp();
    const anonymous: { status: number; code: string | null }[] = [];
    for (let i = 0; i < 40; i += 1) {
      const res = await new Client({ ip }).get('/api/v1/notifications');
      anonymous.push({ status: res.status, code: res.code });
    }
    expect(anonymous.slice(0, 30).every((r) => r.status === 401 && r.code === 'ACCESS_CODE_REQUIRED'), JSON.stringify(anonymous.slice(0, 30))).toBe(true);
    expect(anonymous.slice(30).every((r) => r.status === 429), JSON.stringify(anonymous.slice(30))).toBe(true);

    // With a session, refused by the authorization step: 60 logged refusals, then 10 throttled.
    const sinceSession = await headSeq();
    const authenticated: { status: number; code: string | null }[] = [];
    for (let i = 0; i < 70; i += 1) {
      const res = await session.get('/api/v1/admin/accounts');
      authenticated.push({ status: res.status, code: res.code });
    }
    expect(authenticated.slice(0, 60).every((r) => r.status === 403 && r.code === 'FORBIDDEN'), JSON.stringify(authenticated.slice(0, 60))).toBe(true);
    expect(authenticated.slice(60).every((r) => r.status === 429), JSON.stringify(authenticated.slice(60))).toBe(true);

    const deniedAnonymous = (await eventsAfter(since, 'access.denied')).filter((e) => e.seq <= sinceSession);
    expect(deniedAnonymous.length, 'exactly 30 individual refusals logged for the client').toBe(30);
    const deniedSession = (await eventsAfter(sinceSession, 'access.denied')).filter((e) => e.actorUserId === lawyer.id);
    expect(deniedSession.length, 'exactly 60 individual refusals logged for the session').toBe(60);

    // Once the minute is over, the next refusal of each opens a new window, and the
    // previous one is summarised.
    await untilNextWindow(start);
    const next = await new Client({ ip }).get('/api/v1/notifications');
    expect(next.code, 'a new minute logs refusals again').toBe('ACCESS_CODE_REQUIRED');
    const nextSession = await session.get('/api/v1/admin/accounts');
    expect(nextSession.code).toBe('FORBIDDEN');

    // The summaries may be written on the next refusal or by the worker: run it
    // and wait for them (at most 90 seconds).
    const worker = startWorker();
    let byClient: EventRow[] = [];
    let bySession: EventRow[] = [];
    try {
      for (let i = 0; i < 90 && (byClient.length === 0 || bySession.length === 0); i += 1) {
        const throttled = await eventsAfter(since, 'access.throttled');
        byClient = throttled.filter((e) => e.details.scope === 'client');
        bySession = throttled.filter((e) => e.details.scope === 'session');
        if (byClient.length === 0 || bySession.length === 0) await sleep(1_000);
      }
    } finally {
      await worker.stop();
    }
    expect(byClient.map((e) => e.details.suppressedCount), 'one summary for the client').toEqual([10]);
    expect(bySession.map((e) => e.details.suppressedCount), 'one summary for the session').toEqual([10]);
    for (const summary of [...byClient, ...bySession]) {
      const windowStart = Date.parse(String(summary.details.windowStart));
      expect(windowStart).toBeGreaterThanOrEqual(start - 60_000);
      expect(windowStart).toBeLessThanOrEqual(start + 60_000);
    }
  }, 300_000);
});
