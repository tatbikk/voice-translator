import 'server-only';
import { SECURITY_POLICY } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { getEnv } from '../config/env';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendEvent, eventTransaction } from '../events/append';
import { appendRefusalEvent } from '../security/refusals';
import { consume } from '../security/rate-limit';
import { acceptablePassword, hashPassword } from './passwords';
import { randomToken, sha256Hex } from './tokens';

// Account activation (contract §5). The token travels in the URL fragment
// (/activate#token=…), which browsers never send to the server and which does
// not reach logs or Referer headers; the page posts it in the request body. The
// link is built from APP_URL, never from the request's Host header.

type Tx = Prisma.TransactionClient;

/** When an activation link issued now stops working: real time, like every security timer. */
export function activationExpiresAt(): Date {
  return new Date(clock.systemNow().getTime() + SECURITY_POLICY.activation.ttlMs);
}

export async function createActivationToken(tx: Tx, userId: string, createdByUserId: string | null): Promise<string> {
  const now = clock.systemNow();
  await tx.activationToken.updateMany({
    where: { userId, usedAt: null, voidedAt: null },
    data: { voidedAt: now },
  });
  const token = randomToken(32);
  await tx.activationToken.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SECURITY_POLICY.activation.ttlMs),
      createdByUserId,
    },
  });
  return token;
}

export function activationLink(token: string): string {
  return `${getEnv().appOrigin}/activate#token=${token}`;
}

export type ActivationResult =
  | { kind: 'ok' }
  | { kind: 'invalid-token' }
  | { kind: 'password-policy' }
  | { kind: 'throttled'; retryAfterSeconds: number };

export async function activateAccount(clientIdHash: string, token: string, password: string): Promise<ActivationResult> {
  const throttle = await consume(`activation:client:${clientIdHash}`, SECURITY_POLICY.activationPerClient);
  if (throttle.limited) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'account.activation.failed', details: { reason: 'THROTTLED' }, clientIdHash });
    return { kind: 'throttled', retryAfterSeconds: throttle.retryAfterSeconds };
  }
  const db = getDb();
  const now = clock.systemNow();
  const row = /^[A-Za-z0-9_-]{40,64}$/.test(token)
    ? await db.activationToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } })
    : null;
  const valid =
    row !== null && row.usedAt === null && row.voidedAt === null && row.expiresAt > now && row.user.disabledAt === null;
  if (!valid) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'account.activation.failed', details: { reason: 'INVALID_TOKEN' }, clientIdHash });
    return { kind: 'invalid-token' };
  }
  if (!acceptablePassword(password, row.user.email)) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'account.activation.failed', details: { reason: 'PASSWORD_POLICY' }, clientIdHash });
    return { kind: 'password-policy' };
  }
  const passwordHash = await hashPassword(password);
  const done = await eventTransaction(async (tx) => {
    const consumed = await tx.activationToken.updateMany({
      where: { id: row.id, usedAt: null, voidedAt: null, expiresAt: { gt: clock.systemNow() } },
      data: { usedAt: clock.systemNow() },
    });
    if (consumed.count !== 1) return false;
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await appendEvent(tx, {
      action: 'account.activated',
      details: { userId: row.userId },
      actor: { userId: row.userId, roleAssignmentId: null, role: null, viaDemoSwitch: false },
      clientIdHash,
    });
    return true;
  });
  if (!done) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'account.activation.failed', details: { reason: 'INVALID_TOKEN' }, clientIdHash });
    return { kind: 'invalid-token' };
  }
  return { kind: 'ok' };
}
