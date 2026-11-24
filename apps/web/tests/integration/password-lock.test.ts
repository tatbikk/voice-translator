// Memo rows 3, 4, 5 and 22: password guessing, locking someone else's account
// on purpose, discovering accounts from the login answers or the lock
// behaviour, and advancing the platform clock to drop a lock.
// Contract §4.5: failures keyed on HMAC(normalised e-mail) whether or not the
// account exists; 5 in 15 min lock 15 min; attempts during a lock are not
// counted and do not extend it; a success clears the count; the device cookie
// gives the owner's browser its own bucket; a lock never ends an ACTIVE session
// (except one caused by re-authentication failures).
import { describe, expect, it } from 'vitest';
import { login, visitor } from '../helpers/auth';
import {
  activeLockouts,
  allLockouts,
  authAttemptCount,
  events,
  eventsAfter,
  expireLockouts,
  headSeq,
  liveSession,
  notificationsOf,
  outboundTo,
  sql,
} from '../helpers/db';
import { createUser, disableUser, newEmail, revokeRole } from '../helpers/factories';
import { COOKIE, Client, describeResponse, parseSetCookie, type ApiResponse } from '../helpers/http';
import { forgetAppClockCache, useFreshDatabase } from '../helpers/reset';

const FIFTEEN_MINUTES = 15 * 60_000;

function attempt(client: Client, email: string, password: string | null): Promise<ApiResponse> {
  return client.post('/api/v1/auth/login', { email, password: password ?? 'No-password-at-all-1' });
}

let wrongCounter = 0;
function wrongPassword(): string {
  wrongCounter += 1;
  return `Wrong-password-${String(wrongCounter)}-xyz`;
}

async function lockByPasswords(email: string, client?: Client): Promise<ApiResponse[]> {
  const c = client ?? (await visitor());
  const answers: ApiResponse[] = [];
  for (let i = 0; i < 5; i += 1) answers.push(await attempt(c, email, wrongPassword()));
  return answers;
}

const shape = (res: ApiResponse) => ({ status: res.status, code: res.code, messageKey: res.error?.messageKey ?? null });
const cookieNames = (res: ApiResponse) => res.setCookies.map((h) => parseSetCookie(h).name).sort();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function elapsed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function lockUntil(since: number): Promise<number> {
  const locked = await eventsAfter(since, 'auth.account.locked');
  expect(locked.length, 'one auth.account.locked event').toBe(1);
  return Date.parse(String(locked[0]?.details.until));
}

describe('password attempts and locks (memo rows 3, 4, 5, 22)', () => {
  useFreshDatabase();

  describe('row 3: guessing the password', () => {
    it('row 3: the fifth wrong password locks the account; during the lock the right and the wrong password get the same answer', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await visitor();
      const since = await headSeq();
      const answers = await lockByPasswords(user.email, client);
      for (const res of answers.slice(0, 4)) {
        expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
      }
      const until = await lockUntil(since);
      expect(until - Date.now()).toBeGreaterThan(FIFTEEN_MINUTES - 2 * 60_000);
      expect(until - Date.now()).toBeLessThanOrEqual(FIFTEEN_MINUTES + 60_000);
      const lockedEvent = (await eventsAfter(since, 'auth.account.locked'))[0];
      expect(lockedEvent?.details.cause).toBe('PASSWORD');

      const recorded = await authAttemptCount('PASSWORD');
      const right = await attempt(client, user.email, user.password);
      const wrong = await attempt(client, user.email, wrongPassword());
      expect(right.status, describeResponse(right)).toBe(423);
      expect(shape(right)).toEqual(shape(wrong));
      const retryRight = right.error?.retryAfterSeconds ?? 0;
      const retryWrong = wrong.error?.retryAfterSeconds ?? 0;
      expect(retryRight).toBeGreaterThan(0);
      expect(retryRight).toBeLessThanOrEqual(15 * 60);
      expect(Math.abs(retryRight - retryWrong)).toBeLessThanOrEqual(2);
      expect(await authAttemptCount('PASSWORD'), 'attempts during a lock are not recorded').toBe(recorded);
      expect(cookieNames(right)).not.toContain(COOKIE.session);
      const codes = (await outboundTo(user.id, 'SMS')).filter((m) => /(?<!\d)\d{6}(?!\d)/.test(m.body));
      expect(codes, 'no code is sent during a lock (the lock notice carries none)').toEqual([]);
    });

    it('row 3: the lock ends after its delay', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      await lockByPasswords(user.email);
      const client = await visitor();
      expect((await attempt(client, user.email, user.password)).status).toBe(423);
      await expireLockouts();
      const res = await attempt(client, user.email, user.password);
      expect(res.status, describeResponse(res)).toBe(200);
    });

    it('row 3: a success clears the count of failures', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await visitor();
      const locks = (await activeLockouts()).length;
      for (let i = 0; i < 4; i += 1) await attempt(client, user.email, wrongPassword());
      expect((await attempt(client, user.email, user.password)).status).toBe(200);
      for (let i = 0; i < 4; i += 1) await attempt(client, user.email, wrongPassword());
      expect((await activeLockouts()).length, 'no new lock').toBe(locks);
      const again = await attempt(await visitor(), user.email, user.password);
      expect(again.status, describeResponse(again)).toBe(200);
    });
  });

  describe('row 4: locking another person out on purpose', () => {
    it('row 4: attempts during the lock neither count nor extend it', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const since = await headSeq();
      await lockByPasswords(user.email);
      const until = await lockUntil(since);
      const other = await visitor();
      const locks = await allLockouts();
      const attempts = await authAttemptCount('PASSWORD');
      const sinceLock = await headSeq();

      for (let i = 0; i < 6; i += 1) {
        const res = await attempt(other, user.email, i % 2 === 0 ? wrongPassword() : user.password);
        expect(res.status).toBe(423);
      }
      expect(await allLockouts(), 'no new lock, no lock moved').toEqual(locks);
      expect(await authAttemptCount('PASSWORD')).toBe(attempts);
      expect((await eventsAfter(since, 'auth.account.locked')).length).toBe(1);
      expect(locks.some((l) => Math.abs(l.until.getTime() - until) < 2_000)).toBe(true);
      expect((await eventsAfter(sinceLock, 'auth.login.blocked')).length, 'each refused attempt is logged').toBe(6);
    });

    it('row 4: a lock does not end a session already open', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const owner = await login(user);
      await lockByPasswords(user.email);
      const res = await owner.get('/api/v1/notifications');
      expect(res.status, describeResponse(res)).toBe(200);
      expect((await liveSession(user.id))?.state).toBe('ACTIVE');
    });

    it("row 4: the owner's usual browser, holding the device cookie, logs in while other browsers are locked out", async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const owner = await login(user);
      expect(owner.cookie(COOKIE.device), 'a device cookie after the second factor').toBeDefined();
      // The browser was closed: the session cookie is gone, the 180-day device cookie stays.
      owner.deleteCookie(COOKIE.session);

      await lockByPasswords(user.email);
      const stranger = await visitor();
      expect((await attempt(stranger, user.email, user.password)).status, 'another browser is locked out').toBe(423);

      const res = await attempt(owner, user.email, user.password);
      expect(res.status, describeResponse(res)).toBe(200);
    });

    it("row 4: the device cookie of another account opens nothing", async () => {
      const victim = await createUser({ roles: ['LAWYER'] });
      const attackerAccount = await createUser({ roles: ['LAWYER'] });
      const attacker = await login(attackerAccount);
      attacker.deleteCookie(COOKIE.session);
      await lockByPasswords(victim.email);
      expect((await attempt(attacker, victim.email, victim.password)).status).toBe(423);
    });

    it('row 4: the owner is told of the lock by a notification and a message', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const notifications = (await notificationsOf(user.id)).length;
      const messages = (await outboundTo(user.id)).length;
      await lockByPasswords(user.email);
      expect((await notificationsOf(user.id)).length).toBe(notifications + 1);
      const sent = await outboundTo(user.id);
      expect(sent.length).toBe(messages + 1);
      expect(sent.at(-1)?.body ?? '').not.toContain(user.password ?? '\u0000');
    });
  });

  describe('row 5: discovering accounts', () => {
    it('row 5: an unknown e-mail and a wrong password get exactly the same answer', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const known = await attempt(await visitor(), user.email, wrongPassword());
      const unknown = await attempt(await visitor(), newEmail('nobody'), wrongPassword());
      expect({ status: known.status, code: known.code }).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
      expect(unknown.status).toBe(known.status);
      expect(unknown.text).toBe(known.text);
      expect(cookieNames(unknown)).toEqual(cookieNames(known));
    });

    it('row 5: a disabled account, an account not activated and an account without a usable role answer like an unknown e-mail, even with the right password', async () => {
      const reference = await attempt(await visitor(), newEmail('nobody'), wrongPassword());
      const disabled = await createUser({ roles: ['LAWYER'] });
      await disableUser(disabled.id);
      const notActivated = await createUser({ roles: ['LAWYER'], password: null });
      const roleless = await createUser({ roles: ['LAWYER'] });
      await revokeRole(roleless.roleAssignmentId);
      for (const [label, user] of [
        ['disabled', disabled],
        ['not activated', notActivated],
        ['without a usable role', roleless],
      ] as const) {
        const res = await attempt(await visitor(), user.email, user.password);
        expect({ status: res.status, text: res.text }, label).toEqual({ status: reference.status, text: reference.text });
        expect(await outboundTo(user.id, 'SMS'), `${label}: no code sent`).toEqual([]);
      }
    });

    it('row 5: an unknown e-mail costs the same password verification as a known one', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const a = await visitor();
        known.push(await elapsed(() => attempt(a, user.email, wrongPassword())));
        const b = await visitor();
        unknown.push(await elapsed(() => attempt(b, newEmail('nobody'), wrongPassword())));
      }
      // Argon2id dominates both answers; without a dummy verification the
      // unknown e-mail would answer many times faster.
      expect(median(unknown)).toBeGreaterThan(median(known) / 3);
    });

    it('row 5: the two-client test: failures from two addresses add up on the e-mail, for an existing and an unknown account alike', async () => {
      const existing = await createUser({ roles: ['LAWYER'] });
      const sequences: string[][] = [];
      for (const email of [existing.email, newEmail('nobody')]) {
        const first = await visitor();
        const second = await visitor();
        const answers: ApiResponse[] = [];
        for (let i = 0; i < 3; i += 1) answers.push(await attempt(first, email, wrongPassword()));
        for (let i = 0; i < 2; i += 1) answers.push(await attempt(second, email, wrongPassword()));
        const third = await visitor();
        answers.push(await attempt(third, email, email === existing.email ? (existing.password ?? '') : wrongPassword()));
        sequences.push(answers.map((r) => `${String(r.status)} ${r.code ?? ''} ${r.error?.messageKey ?? ''}`));
        expect(answers.at(-1)?.status, `${email === existing.email ? 'existing' : 'unknown'} account locked`).toBe(423);
      }
      expect(sequences[1]).toEqual(sequences[0]);
    });

    it('row 5: four failures then one more give the same answers for an existing and an unknown account', async () => {
      const existing = await createUser({ roles: ['LAWYER'] });
      const sequences: string[][] = [];
      for (const email of [existing.email, newEmail('nobody')]) {
        const client = await visitor();
        const answers: ApiResponse[] = [];
        for (let i = 0; i < 4; i += 1) answers.push(await attempt(client, email, wrongPassword()));
        answers.push(await attempt(client, email, wrongPassword()));
        answers.push(await attempt(client, email, wrongPassword()));
        sequences.push(answers.map((r) => `${String(r.status)} ${r.code ?? ''} ${r.error?.messageKey ?? ''}`));
        expect(answers.at(-1)?.status).toBe(423);
      }
      expect(sequences[1]).toEqual(sequences[0]);
    });

    it('row 5: the count is kept on the normalised e-mail, whatever its letter case', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      const client = await visitor();
      for (let i = 0; i < 3; i += 1) await attempt(client, user.email, wrongPassword());
      for (let i = 0; i < 2; i += 1) await attempt(client, ` ${user.email.toUpperCase()} `, wrongPassword());
      expect((await attempt(await visitor(), user.email, user.password)).status).toBe(423);
    });

    it('row 5: failed logins are logged with the hash of the e-mail, never the e-mail', async () => {
      const email = newEmail('nobody');
      const since = await headSeq();
      await attempt(await visitor(), email, wrongPassword());
      const failed = await eventsAfter(since, 'auth.login.failed');
      expect(failed.length).toBe(1);
      expect(failed[0]?.details.identifierHash).toMatch(/^[0-9a-f]{64}$/);
      expect(failed[0]?.details.reason).toBe('INVALID_CREDENTIALS');
      expect(JSON.stringify(failed)).not.toContain(email);
    });
  });

  // Kept last: the platform clock only moves forward.
  describe('row 22: advancing the platform clock', () => {
    it('row 22: advancing the platform clock does not lift a lock', async () => {
      const user = await createUser({ roles: ['LAWYER'] });
      await lockByPasswords(user.email);
      await sql(`UPDATE "PlatformClock" SET "offsetSeconds" = 7200, "updatedAt" = now() WHERE id = 1`);
      await forgetAppClockCache();

      // Wait until platform time is two hours ahead (events carry platform time).
      let advanced = false;
      for (let i = 0; i < 40 && !advanced; i += 1) {
        await new Client().get('/api/v1/notifications');
        const last = (await events('access.denied')).at(-1);
        advanced = !!last && last.occurredAt.getTime() - last.recordedAt.getTime() >= 7_000_000;
        if (!advanced) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(advanced, 'the platform clock (event occurredAt) must read two hours ahead').toBe(true);

      const res = await attempt(await visitor(), user.email, user.password);
      expect(res.status, describeResponse(res)).toBe(423);
    });
  });
});
