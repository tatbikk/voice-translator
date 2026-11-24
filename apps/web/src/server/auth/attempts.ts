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

export async function attemptsFor(kind: AttemptKind, identifierHash: string, bucket: Bucket, windowMs: number): Promise<Attempt[]> {
  const since = new Date(clock.systemNow().getTime() - windowMs);
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
