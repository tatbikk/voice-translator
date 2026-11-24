// Reviews S-03 and A-06: the attempt limits hold under concurrent requests. An
// attempt is written before the secret is checked and counted after: whatever
// the number of simultaneous requests, no more secrets are checked than the
// policy allows (decision 39).
import { describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@mahkama/core';
import { startLogin, submitCode, visitor, wrongCode } from '../helpers/auth';
import { eventsAfter, headSeq } from '../helpers/db';
import { createUser } from '../helpers/factories';
import { useFreshDatabase } from '../helpers/reset';

const BURST = 20;

describe('attempt limits under concurrent requests (reviews S-03, A-06)', () => {
  useFreshDatabase();

  it(`${String(BURST)} simultaneous wrong codes: at most ${String(SECURITY_POLICY.secondFactor.maxFailures)} are compared, one lock`, async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const pending = await startLogin(user);
    const since = await headSeq();
    const answers = await Promise.all(Array.from({ length: BURST }, () => submitCode(pending.client, wrongCode(pending.code))));
    expect(answers.every((r) => r.status === 401 || r.status === 423), answers.map((r) => r.status).join(',')).toBe(true);

    // Each comparison either fails (auth.second-factor.failed) or, for the one
    // reaching the limit, locks; the others are refused before any comparison.
    const failed = (await eventsAfter(since, 'auth.second-factor.failed')).length;
    const locks = (await eventsAfter(since, 'auth.account.locked')).filter((e) => e.details.cause === 'SECOND_FACTOR').length;
    expect(failed + locks).toBeLessThanOrEqual(SECURITY_POLICY.secondFactor.maxFailures);
    expect(locks).toBe(1);

    // Locked: even the right code is refused now.
    const right = await submitCode(pending.client, pending.code);
    expect(right.status).not.toBe(200);
  });

  it(`${String(BURST)} simultaneous wrong passwords from different addresses: at most ${String(SECURITY_POLICY.password.maxFailures)} are checked`, async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const clients = await Promise.all(Array.from({ length: BURST }, () => visitor()));
    const since = await headSeq();
    await Promise.all(clients.map((c) => c.post('/api/v1/auth/login', { email: user.email, password: 'Wrong-password-under-load' })));
    const failed = (await eventsAfter(since, 'auth.login.failed')).length;
    expect(failed).toBeLessThanOrEqual(SECURITY_POLICY.password.maxFailures);
    const locks = (await eventsAfter(since, 'auth.account.locked')).filter((e) => e.details.cause === 'PASSWORD').length;
    expect(locks).toBe(1);
  });
});
