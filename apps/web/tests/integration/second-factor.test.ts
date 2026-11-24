// Memo row 1: guessing the second-factor code, including by asking for a new
// code or logging in again after every four attempts. Wrong codes are counted
// per account across every challenge and session within 15 minutes; the fifth
// voids every open challenge, revokes every pending session and locks the
// account; the count is reset only by a successful second factor; issuance is
// capped; one pending session per account; codes are keyed hashes consumed
// once (contract §4.5).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  codesIn,
  newCodeFor,
  resendCode,
  selectRole,
  smsIds,
  startLogin,
  submitCode,
  visitor,
  wrongCode,
} from '../helpers/auth';
import {
  activeLockouts,
  capturingEvents,
  challengesOf,
  events,
  eventsAfter,
  headSeq,
  liveSessions,
  outboundTo,
  sessionsOf,
  sql,
} from '../helpers/db';
import { createUser, type TestUser } from '../helpers/factories';
import { describeResponse, type ApiResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const FIFTEEN_MINUTES = 15 * 60_000;

function expectRefused(res: ApiResponse, what: string): void {
  expect(res.status, `${what}: ${describeResponse(res)}`).toBeGreaterThanOrEqual(400);
  expect(res.envelope?.ok, `${what}: ${describeResponse(res)}`).toBe(false);
}

/** The state that the fifth wrong code must leave behind. */
async function expectSecondFactorLock(user: TestUser, since: number): Promise<void> {
  const locked = (await eventsAfter(since, 'auth.account.locked')).filter((e) => e.details.cause === 'SECOND_FACTOR');
  expect(locked.length, 'one auth.account.locked event with cause SECOND_FACTOR').toBe(1);
  const until = Date.parse(String(locked[0]?.details.until));
  expect(until - Date.now()).toBeGreaterThan(FIFTEEN_MINUTES - 2 * 60_000);
  expect(until - Date.now()).toBeLessThanOrEqual(FIFTEEN_MINUTES + 60_000);
  const locks = await activeLockouts();
  expect(
    locks.some((l) => Math.abs(l.until.getTime() - until) < 2_000),
    'a lock in force until the time stated by the event',
  ).toBe(true);

  const challenges = await challengesOf(user.id);
  expect(challenges.length).toBeGreaterThan(0);
  for (const challenge of challenges) {
    const open = challenge.consumedAt === null && challenge.voidedAt === null;
    expect(open, `challenge ${challenge.id} must be voided`).toBe(false);
  }
  const pendings = (await liveSessions(user.id)).filter((s) => s.state !== 'ACTIVE');
  expect(pendings, 'every pending session of the account is revoked').toEqual([]);

  // The account is locked: even the right password now answers 423.
  const fresh = await visitor();
  const res = await fresh.post('/api/v1/auth/login', { email: user.email, password: user.password });
  expect(res.status, describeResponse(res)).toBe(423);
  expect(res.error?.retryAfterSeconds ?? 0).toBeGreaterThan(0);
}

describe('second factor (memo row 1)', () => {
  useFreshDatabase();

  it('row 1 (a): four wrong codes, a new code, one more wrong code locks the account', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const since = await headSeq();
    const pending = await startLogin(user);
    for (let i = 1; i <= 4; i += 1) {
      const res = await submitCode(pending.client, wrongCode(pending.code));
      expectRefused(res, `wrong code ${String(i)}`);
      expect(res.code, 'the pending session is still alive').not.toBe('SESSION_REQUIRED');
    }
    const before = await smsIds(user.id);
    const resent = await resendCode(pending.client);
    expect(resent.status, describeResponse(resent)).toBe(200);
    const fresh = await newCodeFor(user.id, before);

    expectRefused(await submitCode(pending.client, wrongCode(fresh)), 'fifth wrong code');
    expectRefused(await submitCode(pending.client, fresh), 'the right code after the lock');
    await expectSecondFactorLock(user, since);
  });

  it('row 1 (b): four wrong codes, a new login, one more wrong code locks the account', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const since = await headSeq();
    const first = await startLogin(user);
    for (let i = 1; i <= 4; i += 1) expectRefused(await submitCode(first.client, wrongCode(first.code)), `wrong code ${String(i)}`);

    const second = await startLogin(user);
    expect((await liveSessions(user.id)).filter((s) => s.state === 'PENDING_SECOND_FACTOR').length, 'one pending session per account').toBe(1);
    expectRefused(await submitCode(second.client, wrongCode(second.code)), 'fifth wrong code, in the new session');
    expectRefused(await submitCode(second.client, second.code), 'the right code after the lock');
    expectRefused(await submitCode(first.client, first.code), 'the first session after the lock');
    await expectSecondFactorLock(user, since);
  });

  it('row 1 (c): the sixth code within the window is refused and not sent', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user); // code 1
    for (let i = 2; i <= 5; i += 1) {
      const res = await resendCode(pending.client);
      expect(res.status, `code ${String(i)}: ${describeResponse(res)}`).toBe(200);
    }
    const sent = (await outboundTo(user.id, 'SMS')).length;
    expect(sent).toBe(5);

    const { result: sixth, events: appended } = await capturingEvents(() => resendCode(pending.client));
    expect(sixth.status, describeResponse(sixth)).toBe(423);
    expect((await outboundTo(user.id, 'SMS')).length, 'no sixth message').toBe(sent);
    expect(appended.some((e) => e.action === 'auth.second-factor.refused' && e.details.reason === 'ISSUANCE_CAP')).toBe(true);

    // A new login is an issuance too: the same 423, and still no message.
    const other = await visitor();
    const relogin = await other.post('/api/v1/auth/login', { email: user.email, password: user.password });
    expect(relogin.status, describeResponse(relogin)).toBe(423);
    expect((await outboundTo(user.id, 'SMS')).length, 'no message for the refused login either').toBe(sent);
  });

  it('row 1 (d): a session before the second factor that asks for role selection is refused', async () => {
    const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT'] });
    const pending = await startLogin(user);
    const { result: res, events: appended } = await capturingEvents(() => selectRole(pending.client, user.roleAssignmentId));
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 401, code: 'SESSION_REQUIRED' });
    expect(appended.map((e) => e.action)).not.toContain('auth.role.selected');
    expect(appended.some((e) => e.action === 'access.denied' && e.details.step === 'SESSION')).toBe(true);
    const sessions = await liveSessions(user.id);
    expect(sessions.map((s) => s.state)).toEqual(['PENDING_SECOND_FACTOR']);
    expect(sessions[0]?.roleAssignmentId ?? null).toBeNull();

    const dashboardData = await pending.client.get('/api/v1/notifications');
    expect({ status: dashboardData.status, code: dashboardData.code }).toEqual({ status: 401, code: 'SESSION_REQUIRED' });
  });

  it('a successful second factor resets the count: four wrong codes, success, then four more do not lock', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const locks = (await activeLockouts()).length;
    const first = await startLogin(user);
    for (let i = 0; i < 4; i += 1) expectRefused(await submitCode(first.client, wrongCode(first.code)), 'wrong code');
    expect((await submitCode(first.client, first.code)).status).toBe(200);

    const second = await startLogin(user);
    for (let i = 0; i < 4; i += 1) expectRefused(await submitCode(second.client, wrongCode(second.code)), 'wrong code');
    expect((await activeLockouts()).length, 'no new lock').toBe(locks);
    const ok = await submitCode(second.client, second.code);
    expect(ok.status, describeResponse(ok)).toBe(200);
  });

  it('wrong codes leave auth.second-factor.failed events counting down, never carrying the code', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    const guess = wrongCode(pending.code);
    const { events: appended } = await capturingEvents(() => submitCode(pending.client, guess));
    const failed = appended.filter((e) => e.action === 'auth.second-factor.failed');
    expect(failed.length).toBe(1);
    expect(failed[0]?.details.remaining).toBe(4);
    expect(JSON.stringify(appended)).not.toContain(guess);
    expect(JSON.stringify(appended)).not.toContain(pending.code);
  });

  it('a code is consumed once: two simultaneous submissions of the right code succeed once', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    const twin = pending.client.clone();
    await pending.client.csrf();
    await twin.csrf();
    const answers = await Promise.all([submitCode(pending.client, pending.code), submitCode(twin, pending.code)]);
    expect(answers.filter((r) => r.status === 200).length, answers.map(describeResponse).join(' | ')).toBe(1);
    const consumed = (await challengesOf(user.id)).filter((c) => c.consumedAt !== null);
    expect(consumed.length).toBe(1);
  });

  it('a code older than five minutes is refused', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    await sql(`UPDATE "SecondFactorChallenge" SET "expiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [user.id]);
    expectRefused(await submitCode(pending.client, pending.code), 'expired code');
    expect((await liveSessions(user.id)).some((s) => s.state === 'ACTIVE')).toBe(false);
  });

  it('a pending session lives ten minutes', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    const sessions = await sessionsOf(user.id);
    const lifetime = (sessions[0]?.pendingExpiresAt?.getTime() ?? 0) - (sessions[0]?.createdAt.getTime() ?? 0);
    expect(Math.abs(lifetime - 10 * 60_000)).toBeLessThan(2_000);
    await sql(`UPDATE "Session" SET "pendingExpiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [user.id]);
    const res = await submitCode(pending.client, pending.code);
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 401, code: 'SESSION_REQUIRED' });
  });

  it('the code is a six-digit number, stored only as a keyed hash, valid five minutes', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    expect(pending.code).toMatch(/^\d{6}$/);
    const rows = await sql<{ codeMac: string; createdAt: Date; expiresAt: Date }>(
      'SELECT "codeMac", "createdAt", "expiresAt" FROM "SecondFactorChallenge" WHERE "userId" = $1',
      [user.id],
    );
    expect(rows.length).toBe(1);
    const mac = rows[0]!.codeMac;
    expect(mac).toMatch(/^[0-9a-f]{64}$/);
    expect(mac).not.toContain(pending.code);
    expect(mac, 'a keyed hash, not a plain SHA-256 of the code').not.toBe(createHash('sha256').update(pending.code).digest('hex'));
    expect(Math.abs(rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime() - 5 * 60_000)).toBeLessThan(2_000);

    const sms = (await outboundTo(user.id, 'SMS')).at(-1);
    expect(sms && codesIn(sms.body)).toEqual([pending.code]);
    expect(sms?.holdsSecret, 'the message holding the code is marked as such').toBe(true);
    expect(sms?.expiresAt, 'the message holding the code expires').not.toBeNull();
  });

  it('after the lock, nothing reveals whether a guess was right', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    for (let i = 0; i < 5; i += 1) await submitCode(pending.client, wrongCode(pending.code));
    const other = await startLogin(await createUser({ roles: ['LAWYER'] }));
    const right = await submitCode(pending.client, pending.code);
    const wrong = await submitCode(pending.client, wrongCode(pending.code));
    expect({ status: right.status, body: right.text }).toEqual({ status: wrong.status, body: wrong.text });
    // An unrelated account is not affected.
    expect((await submitCode(other.client, other.code)).status).toBe(200);
    expect((await events('auth.second-factor.succeeded')).length).toBeGreaterThan(0);
  });
});
