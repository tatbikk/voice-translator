import 'server-only';
import { activeLockUntil, type Attempt } from '@mahkama/core';
import type { AttemptKind, Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { sha256Hex } from './tokens';
import { deviceIdFromRequest, isKnownDevice } from './device-cookie';

// Attempts and temporary locks, keyed on the identifier hash of the account
// (the keyed hash of its e-mail, whether or not the account exists) and on a
// bucket: "default" for unknown browsers, "device:<hash>" for a browser that
// completed the second factor for this account before.

type Tx = Prisma.TransactionClient;

export interface Bucket {
  readonly storage: string;
  readonly kind: 'default' | 'device';
}

export const DEFAULT_BUCKET: Bucket = { storage: 'default', kind: 'default' };

export async function bucketFor(req: Request, userId: string | null): Promise<Bucket> {
  if (!userId) return DEFAULT_BUCKET;
  const deviceId = deviceIdFromRequest(req);
  if (deviceId && (await isKnownDevice(userId, deviceId))) {
    return { storage: `device:${sha256Hex(deviceId)}`, kind: 'device' };
  }
  return DEFAULT_BUCKET;
}

export async function activeLock(identifierHash: string, bucket: Bucket): Promise<Date | null> {
  const now = clock.systemNow();
  const locks = await getDb().lockout.findMany({
    where: { identifierHash, bucket: bucket.storage, until: { gt: now } },
    select: { until: true },
  });
  return activeLockUntil(locks, now);
}

export async function recordAttempt(
  kind: AttemptKind,
  input: { identifierHash: string | null; bucket?: Bucket; clientIdHash: string | null; ok: boolean },
  tx?: Tx,
): Promise<void> {
  await (tx ?? getDb()).authAttempt.create({
    data: {
      kind,
      identifierHash: input.identifierHash,
      bucket: (input.bucket ?? DEFAULT_BUCKET).storage,
      clientIdHash: input.clientIdHash,
      ok: input.ok,
      at: clock.systemNow(),
    },
  });
}

/**
 * Records an attempt as failed BEFORE the secret is checked, and returns its id.
 * Counting after this write bounds the number of secrets actually checked to the
 * policy limit, whatever the number of concurrent requests (each one counts its
 * own row and every row committed before it). A request that stops halfway
 * keeps its attempt counted: the fail-closed outcome.
 */
export async function reserveAttempt(
  kind: AttemptKind,
  input: { identifierHash: string; bucket: Bucket; clientIdHash: string | null },
): Promise<string> {
  const row = await getDb().authAttempt.create({
    data: {
      kind,
      identifierHash: input.identifierHash,
      bucket: input.bucket.storage,
      clientIdHash: input.clientIdHash,
      ok: false,
      at: clock.systemNow(),
    },
    select: { id: true },
  });
  return row.id;
}

/** The reserved attempt turned out to be right. */
export async function markAttemptSucceeded(attemptId: string, tx?: Tx): Promise<void> {
  await (tx ?? getDb()).authAttempt.update({ where: { id: attemptId }, data: { ok: true } });
}

/**
 * The moment the latest lock of these causes that has already ended was started,
 * plus a millisecond. The failures up to that moment are the ones that led to the
 * lock; once it is over they no longer count: an ended lock closes its count.
 */
export async function lastEndedLock(
  identifierHash: string,
  bucket: Bucket,
  causes: readonly ('PASSWORD' | 'SECOND_FACTOR' | 'REAUTH')[],
): Promise<Date | null> {
  const row = await getDb().lockout.findFirst({
    where: { identifierHash, bucket: bucket.storage, cause: { in: [...causes] }, until: { lte: clock.systemNow() } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row ? new Date(row.createdAt.getTime() + 1) : null;
}

export async function attemptsFor(
  kind: AttemptKind,
  identifierHash: string,
  bucket: Bucket,
  windowMs: number,
  notBefore: Date | null = null,
): Promise<Attempt[]> {
  const windowStart = new Date(clock.systemNow().getTime() - windowMs);
  const since = notBefore && notBefore > windowStart ? notBefore : windowStart;
  const rows = await getDb().authAttempt.findMany({
    where: { kind, identifierHash, bucket: bucket.storage, at: { gte: since } },
    select: { at: true, ok: true },
    orderBy: { at: 'asc' },
  });
  return rows;
}

export async function startLock(
  identifierHash: string,
  bucket: Bucket,
  cause: 'PASSWORD' | 'SECOND_FACTOR' | 'REAUTH',
  lockMs: number,
  tx?: Tx,
): Promise<Date> {
  const now = clock.systemNow();
  const until = new Date(now.getTime() + lockMs);
  await (tx ?? getDb()).lockout.create({ data: { identifierHash, bucket: bucket.storage, cause, createdAt: now, until } });
  return until;
}
