import 'server-only';
import { hash, parseOptions, verify } from '@node-rs/argon2';
import { SECURITY_POLICY } from '@mahkama/core';

// Argon2id with explicit parameters. The library's Algorithm enum is an ambient
// const enum that cannot be referenced under isolatedModules: 2 is Argon2id.
const ARGON2ID = 2;
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: SECURITY_POLICY.argon2.memoryCost,
  timeCost: SECURITY_POLICY.argon2.timeCost,
  parallelism: SECURITY_POLICY.argon2.parallelism,
  outputLen: SECURITY_POLICY.argon2.outputLen,
} as const;

/**
 * Thrown when the hashing queue is full (review S-03): the request is answered
 * 503 instead of waiting in memory behind an unbounded queue.
 */
export class HashingBusyError extends Error {
  constructor() {
    super('password hashing queue is full');
    this.name = 'HashingBusyError';
  }
}

// At most a few hashes at a time, so that login floods cannot exhaust memory,
// and at most a bounded number of calls waiting for a slot.
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= SECURITY_POLICY.argon2.concurrency) {
    if (waiting.length >= SECURITY_POLICY.argon2.maxWaiting) throw new HashingBusyError();
    // The slot is handed over by the finishing task: running stays counted.
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** Test hook: the number of hashing calls running and waiting. */
export function hashingLoad(): { running: number; waiting: number } {
  return { running, waiting: waiting.length };
}

export function hashPassword(password: string): Promise<string> {
  return withSlot(() => hash(password, OPTIONS));
}

let dummyHash: Promise<string> | null = null;

/**
 * Verifies a password. With a null hash (unknown account, account not yet
 * activated, disabled account) a dummy verification still runs, so that the
 * answer takes about the same time whatever the case.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (stored === null) {
    dummyHash ??= hash('dummy-password-for-timing-equalisation', OPTIONS);
    const dummy = await dummyHash;
    await withSlot(() => verify(dummy, password).catch(() => false));
    return false;
  }
  // Only a malformed stored hash reads as a wrong password; a full queue is not one.
  return withSlot(() => verify(stored, password).catch(() => false));
}

export function needsRehash(stored: string): boolean {
  try {
    const options = parseOptions(stored);
    const algorithm: number = options.algorithm;
    return (
      algorithm !== ARGON2ID ||
      options.memoryCost !== OPTIONS.memoryCost ||
      options.timeCost !== OPTIONS.timeCost ||
      options.parallelism !== OPTIONS.parallelism
    );
  } catch {
    return true;
  }
}

export function acceptablePassword(password: string, email: string): boolean {
  const { passwordMin, passwordMax } = SECURITY_POLICY.fields;
  if (password.length < passwordMin || password.length > passwordMax) return false;
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return local.length < 3 || !password.toLowerCase().includes(local);
}
