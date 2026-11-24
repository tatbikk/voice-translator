// Review S-03: the queue of password hashing calls is bounded. At most
// SECURITY_POLICY.argon2.concurrency hashes run at once and at most
// SECURITY_POLICY.argon2.maxWaiting wait for a slot; any call beyond fails at
// once with HashingBusyError (answered 503 by the endpoints) instead of
// waiting in memory.
import { describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@mahkama/core';
import { HashingBusyError, hashPassword, hashingLoad, verifyPassword } from '@/server/auth/passwords';

const { concurrency, maxWaiting } = SECURITY_POLICY.argon2;

describe('password hashing queue (review S-03)', () => {
  it('has a bound', () => {
    expect(maxWaiting).toBeGreaterThan(0);
    expect(maxWaiting).toBeLessThanOrEqual(256);
  });

  it('refuses the calls beyond the running and waiting ones, and never runs more than the concurrency', async () => {
    const extra = 5;
    const calls = Array.from({ length: concurrency + maxWaiting + extra }, (_, i) => hashPassword(`queue-test-password-${String(i)}`));
    expect(hashingLoad()).toEqual({ running: concurrency, waiting: maxWaiting });
    const results = await Promise.allSettled(calls);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused.length).toBe(extra);
    for (const r of refused) expect(r.reason).toBeInstanceOf(HashingBusyError);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(concurrency + maxWaiting);
    expect(hashingLoad(), 'every slot is given back').toEqual({ running: 0, waiting: 0 });
  }, 60_000);

  it('a full queue is not a wrong password: the verification fails with HashingBusyError', async () => {
    const stored = await hashPassword('queue-test-stored-password');
    const fillers = Array.from({ length: concurrency + maxWaiting }, (_, i) => hashPassword(`queue-filler-${String(i)}`));
    await expect(verifyPassword(stored, 'queue-test-stored-password')).rejects.toBeInstanceOf(HashingBusyError);
    await Promise.all(fillers);
    await expect(verifyPassword(stored, 'queue-test-stored-password')).resolves.toBe(true);
    await expect(verifyPassword(stored, 'another-password-entirely')).resolves.toBe(false);
  }, 60_000);
});
