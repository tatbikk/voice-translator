// Review S-03: when the password hashing queue is full, a login is answered
// 503 UNAVAILABLE with Retry-After, at once, instead of waiting in memory.
import { describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@mahkama/core';
import { hashPassword, hashingLoad } from '@/server/auth/passwords';
import { visitor } from '../helpers/auth';
import { createUser } from '../helpers/factories';
import { describeResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('password hashing queue (review S-03)', () => {
  useFreshDatabase();

  it('a login that finds the hashing queue full is answered 503 with Retry-After; once it drains, logins work again', async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const client = await visitor();
    await client.csrf();

    // Keeps the queue full for as long as the login runs.
    const state = { filling: true };
    const fillers: Promise<unknown>[] = [];
    const fill = (async () => {
      while (state.filling) {
        while (hashingLoad().waiting < SECURITY_POLICY.argon2.maxWaiting) {
          fillers.push(hashPassword(`filler-${String(fillers.length)}-password`).catch(() => undefined));
        }
        await pause(1);
      }
    })();
    await pause(5);
    const busy = await client.post('/api/v1/auth/login', { email: user.email, password: user.password });
    state.filling = false;
    await fill;
    await Promise.all(fillers);

    expect({ status: busy.status, code: busy.code }, describeResponse(busy)).toEqual({ status: 503, code: 'UNAVAILABLE' });
    expect(busy.error?.messageKey).toBe('errors.UNAVAILABLE');
    expect(Number(busy.headers.get('Retry-After'))).toBeGreaterThan(0);

    const later = await (await visitor()).post('/api/v1/auth/login', { email: user.email, password: user.password });
    expect(later.status, describeResponse(later)).toBe(200);
  }, 120_000);
});
