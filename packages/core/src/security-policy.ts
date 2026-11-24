// Attempt limits, temporary locks and request limits (contract §4.5). These are
// technical values, not legal rules; they are recorded in docs/decisions.md.
// The functions are pure: the server feeds them the attempts it stored.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SECURITY_POLICY = {
  password: { maxFailures: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
  secondFactor: {
    codeDigits: 6,
    codeTtlMs: 5 * MINUTE,
    maxFailures: 5,
    windowMs: 15 * MINUTE,
    lockMs: 15 * MINUTE,
    issuePerWindow: 5,
    issueWindowMs: 15 * MINUTE,
    issuePerDay: 20,
    pendingSessionMs: 10 * MINUTE,
  },
  signaturePin: { maxFailures: 3, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
  reauth: { windowMs: 10 * MINUTE },
  accessCode: {
    perClient: { max: 10, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
    global: { max: 50, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE },
    cookieMs: 12 * HOUR,
  },
  loginPerClient: { max: 20, windowMs: 15 * MINUTE },
  activationPerClient: { max: 10, windowMs: 15 * MINUTE },
  caseLookup: { perClient: { max: 10, windowMs: 5 * MINUTE }, global: { max: 300, windowMs: 5 * MINUTE } },
  hearings: { perClient: { max: 30, windowMs: 5 * MINUTE }, daysBefore: 7, daysAfter: 60 },
  refusals: {
    unauthenticatedPerClient: { max: 30, windowMs: MINUTE },
    authenticatedPerSession: { max: 60, windowMs: MINUTE },
  },
  demoEndpoints: { perClient: { max: 60, windowMs: MINUTE } },
  body: { maxBytes: 16 * 1024 },
  fields: { passwordMin: 12, passwordMax: 128, email: 254, name: 120, phone: 32, requestReferenceMin: 8, requestReferenceMax: 64 },
  argon2: { concurrency: 4, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 },
  session: { absoluteMs: 12 * HOUR, idleDefaultMinutes: 30, idleMinMinutes: 5, idleMaxMinutes: 60 },
  deviceCookie: { lifetimeMs: 180 * DAY },
  activation: { ttlMs: DAY },
} as const;

export interface Attempt {
  readonly at: Date;
  readonly ok: boolean;
}

export interface LimitRule {
  readonly max: number;
  readonly windowMs: number;
}

/** Failures within the window that came after the most recent success. */
export function failuresSinceLastSuccess(attempts: readonly Attempt[], now: Date, windowMs: number): number {
  const since = now.getTime() - windowMs;
  const ordered = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime());
  let failures = 0;
  for (const attempt of ordered) {
    if (attempt.at.getTime() > now.getTime()) continue;
    if (attempt.ok) {
      failures = 0;
      continue;
    }
    if (attempt.at.getTime() >= since) failures += 1;
  }
  return failures;
}

/**
 * Whether a new lock must start after recording the latest attempt.
 * Attempts made while a lock is in force are never recorded (the caller checks
 * the lock first), so a lock cannot be extended by an attacker.
 */
export function shouldLock(
  attempts: readonly Attempt[],
  now: Date,
  rule: { readonly maxFailures: number; readonly windowMs: number },
): boolean {
  return failuresSinceLastSuccess(attempts, now, rule.windowMs) >= rule.maxFailures;
}

export function activeLockUntil(locks: readonly { readonly until: Date }[], now: Date): Date | null {
  let latest: Date | null = null;
  for (const lock of locks) {
    if (lock.until.getTime() > now.getTime() && (latest === null || lock.until.getTime() > latest.getTime())) {
      latest = lock.until;
    }
  }
  return latest;
}

export function countInWindow(timestamps: readonly Date[], now: Date, windowMs: number): number {
  const since = now.getTime() - windowMs;
  return timestamps.filter((t) => t.getTime() >= since && t.getTime() <= now.getTime()).length;
}

/** Whether one more event would exceed the limit. */
export function wouldExceed(timestamps: readonly Date[], now: Date, rule: LimitRule): boolean {
  return countInWindow(timestamps, now, rule.windowMs) >= rule.max;
}

/** Whether a new second-factor code may be issued for the account. */
export function issuanceAllowed(issued: readonly Date[], now: Date): boolean {
  const p = SECURITY_POLICY.secondFactor;
  return countInWindow(issued, now, p.issueWindowMs) < p.issuePerWindow && countInWindow(issued, now, DAY) < p.issuePerDay;
}

/** Remaining wrong codes before the account is locked. */
export function secondFactorRemaining(attempts: readonly Attempt[], now: Date): number {
  const p = SECURITY_POLICY.secondFactor;
  return Math.max(0, p.maxFailures - failuresSinceLastSuccess(attempts, now, p.windowMs));
}

export function clampIdleMinutes(value: number | undefined): number {
  const p = SECURITY_POLICY.session;
  if (value === undefined || !Number.isInteger(value)) return p.idleDefaultMinutes;
  return Math.min(p.idleMaxMinutes, Math.max(p.idleMinMinutes, value));
}
