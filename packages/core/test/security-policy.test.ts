import { describe, expect, it } from 'vitest';
import {
  SECURITY_POLICY,
  activeLockUntil,
  clampIdleMinutes,
  failuresSinceLastSuccess,
  issuanceAllowed,
  secondFactorRemaining,
  shouldLock,
  wouldExceed,
  type Attempt,
} from '../src/index';

const t0 = new Date('2026-11-24T09:00:00.000Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const fail = (minutes: number): Attempt => ({ at: at(minutes), ok: false });
const success = (minutes: number): Attempt => ({ at: at(minutes), ok: true });

describe('password lock', () => {
  const rule = SECURITY_POLICY.password;

  it('locks after five failures within fifteen minutes', () => {
    const four = [fail(0), fail(1), fail(2), fail(3)];
    expect(shouldLock(four, at(4), rule)).toBe(false);
    expect(shouldLock([...four, fail(4)], at(4), rule)).toBe(true);
  });

  it('does not count failures older than the window', () => {
    expect(shouldLock([fail(0), fail(1), fail(20), fail(21), fail(22)], at(22), rule)).toBe(false);
  });

  it('is cleared by a success', () => {
    const attempts = [fail(0), fail(1), fail(2), fail(3), success(4), fail(5)];
    expect(failuresSinceLastSuccess(attempts, at(5), rule.windowMs)).toBe(1);
    expect(shouldLock(attempts, at(5), rule)).toBe(false);
  });

  it('reports the active lock, if any', () => {
    expect(activeLockUntil([{ until: at(15) }], at(10))).toEqual(at(15));
    expect(activeLockUntil([{ until: at(15) }], at(15))).toBeNull();
    expect(activeLockUntil([{ until: at(15) }, { until: at(30) }], at(10))).toEqual(at(30));
  });
});

describe('second factor', () => {
  it('counts wrong codes across challenges: a new code does not reset the count', () => {
    // The caller records wrong codes per account, whatever the challenge.
    const attempts = [fail(0), fail(1), fail(2), fail(3)];
    expect(secondFactorRemaining(attempts, at(3))).toBe(1);
    expect(shouldLock([...attempts, fail(4)], at(4), SECURITY_POLICY.secondFactor)).toBe(true);
  });

  it('caps the number of codes issued: five per fifteen minutes', () => {
    const issued = [at(0), at(1), at(2), at(3)];
    expect(issuanceAllowed(issued, at(4))).toBe(true);
    expect(issuanceAllowed([...issued, at(4)], at(5))).toBe(false);
    expect(issuanceAllowed([...issued, at(4)], at(20))).toBe(true);
  });

  it('caps the number of codes issued: twenty per day', () => {
    const issued = Array.from({ length: 20 }, (_, i) => at(i * 20));
    expect(issuanceAllowed(issued, at(20 * 20 + 1))).toBe(false);
  });
});

describe('request limits', () => {
  it('refuses the request that would exceed the limit', () => {
    const rule = { max: 3, windowMs: 60_000 };
    expect(wouldExceed([at(0), at(0.1)], at(0.2), rule)).toBe(false);
    expect(wouldExceed([at(0), at(0.1), at(0.2)], at(0.3), rule)).toBe(true);
    expect(wouldExceed([at(0), at(0.1), at(0.2)], at(2), rule)).toBe(false);
  });
});

describe('session idle timeout', () => {
  it('stays between five and sixty minutes', () => {
    expect(clampIdleMinutes(undefined)).toBe(30);
    expect(clampIdleMinutes(1)).toBe(5);
    expect(clampIdleMinutes(600)).toBe(60);
    expect(clampIdleMinutes(20)).toBe(20);
  });
});
