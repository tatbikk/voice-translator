import 'server-only';
import { randomInt } from 'node:crypto';
import {
  SECURITY_POLICY,
  formatMoroccoDate,
  formatMoroccoTime,
  issuanceAllowed,
  secondFactorRemaining,
  shouldLock,
} from '@mahkama/core';
import type { Prisma, User } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendEvent, appendStandaloneEvent } from '../events/append';
import { identifierHash, hmacHex, sessionKey } from '../keys';
import { messaging } from '../messaging';
import { createNotification } from '../notifications/service';
import { consume } from '../security/rate-limit';
import { activeLock, attemptsFor, bucketFor, recordAttempt, startLock, type Bucket } from './attempts';
import { deviceIdFromRequest, newDeviceId, rememberDevice } from './device-cookie';
import { needsRehash, hashPassword, verifyPassword } from './passwords';
import { createSession, revokeSession, rotateSession, type SessionContext } from './sessions';
import { safeEqual } from './tokens';

// The login path (contract §6): password, then the six-digit confirmation code
// delivered by the messaging service, then the choice of role for a user who
// holds several. Every step is logged; every limit is per account AND survives
// new codes and new logins.

type Tx = Prisma.TransactionClient;

const secondsUntil = (date: Date) => Math.max(1, Math.ceil((date.getTime() - clock.systemNow().getTime()) / 1000));

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(SECURITY_POLICY.secondFactor.codeDigits, '0');
}

function codeMac(challengeId: string, code: string): string {
  return hmacHex(sessionKey('second-factor'), `${challengeId}|${code}`);
}

async function issuedRecently(idHash: string): Promise<Date[]> {
  const since = new Date(clock.systemNow().getTime() - 24 * 60 * 60 * 1000);
  const rows = await getDb().authAttempt.findMany({
    where: { kind: 'SECOND_FACTOR_ISSUE', identifierHash: idHash, at: { gte: since } },
    select: { at: true },
  });
  return rows.map((r) => r.at);
}

async function notifyLock(user: User, until: Date): Promise<void> {
  const params = { date: formatMoroccoDate(until), time: formatMoroccoTime(until) };
  await getDb().$transaction((tx) =>
    createNotification(tx, { userId: user.id, kind: 'INFORMATION', templateKey: 'notifications.accountLocked', params }),
  );
  await messaging().send({
    channel: 'SMS',
    recipientUserId: user.id,
    recipientAddress: user.phone,
    templateKey: 'messages.sms.accountLocked',
    params,
    holdsSecret: false,
    visibleToSessionId: null,
  });
}

async function lockAccount(
  user: User | null,
  idHash: string,
  bucket: Bucket,
  cause: 'PASSWORD' | 'SECOND_FACTOR' | 'REAUTH',
  lockMs: number,
  inTx?: (tx: Tx) => Promise<void>,
): Promise<Date> {
  const until = await getDb().$transaction(async (tx) => {
    if (inTx) await inTx(tx);
    const lockedUntil = await startLock(idHash, bucket, cause, lockMs, tx);
    await appendEvent(tx, {
      action: 'auth.account.locked',
      details: { cause, bucket: bucket.kind, until: lockedUntil.toISOString() },
      actor: user ? { userId: user.id, roleAssignmentId: null, role: null, viaDemoSwitch: false } : null,
    });
    return lockedUntil;
  });
  if (user) await notifyLock(user, until);
  return until;
}

async function sendCode(user: User, sessionId: string, code: string, expiresAt: Date): Promise<void> {
  await messaging().send({
    channel: 'SMS',
    recipientUserId: user.id,
    recipientAddress: user.phone,
    templateKey: 'messages.sms.secondFactorCode',
    params: { code },
    holdsSecret: true,
    expiresAt,
    visibleToSessionId: sessionId,
  });
}

async function createChallenge(tx: Tx, userId: string, sessionId: string, idHash: string, clientIdHash: string) {
  const now = clock.systemNow();
  await tx.secondFactorChallenge.updateMany({
    where: { userId, consumedAt: null, voidedAt: null },
    data: { voidedAt: now },
  });
  const code = newCode();
  const challenge = await tx.secondFactorChallenge.create({
    data: {
      sessionId,
      userId,
      codeMac: '0'.repeat(64),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SECURITY_POLICY.secondFactor.codeTtlMs),
    },
  });
  await tx.secondFactorChallenge.update({ where: { id: challenge.id }, data: { codeMac: codeMac(challenge.id, code) } });
  await recordAttempt('SECOND_FACTOR_ISSUE', { identifierHash: idHash, clientIdHash, ok: true }, tx);
  return { challengeId: challenge.id, code, expiresAt: challenge.expiresAt };
}

// ---------------------------------------------------------------------------

export type LoginResult =
  | { kind: 'throttled'; retryAfterSeconds: number }
  | { kind: 'locked'; retryAfterSeconds: number }
  | { kind: 'invalid' }
  | { kind: 'pending'; token: string };

export async function loginWithPassword(
  req: Request,
  clientIdHash: string,
  emailInput: string,
  password: string,
): Promise<LoginResult> {
  const throttle = await consume(`login:client:${clientIdHash}`, SECURITY_POLICY.loginPerClient);
  if (throttle.limited) {
    await appendStandaloneEvent({ action: 'auth.login.throttled', details: {}, clientIdHash });
    return { kind: 'throttled', retryAfterSeconds: throttle.retryAfterSeconds };
  }

  const email = emailInput.trim().toLowerCase();
  const idHash = identifierHash(email);
  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });
  const bucket = await bucketFor(req, user?.id ?? null);

  // A lock is checked before the password: the answer is the same whether the
  // password is right or wrong, and the attempt is neither verified nor counted.
  const lockedUntil = await activeLock(idHash, bucket);
  if (lockedUntil) {
    await appendStandaloneEvent({
      action: 'auth.login.blocked',
      details: { identifierHash: idHash, bucket: bucket.kind },
      clientIdHash,
    });
    return { kind: 'locked', retryAfterSeconds: secondsUntil(lockedUntil) };
  }

  const usableRoles = user ? await db.roleAssignment.count({ where: { userId: user.id, revokedAt: null } }) : 0;
  const usable = user !== null && user.disabledAt === null && user.passwordHash !== null && usableRoles > 0;
  const ok = await verifyPassword(usable ? user.passwordHash : null, password);

  if (!ok || !user) {
    await recordAttempt('PASSWORD', { identifierHash: idHash, bucket, clientIdHash, ok: false });
    await appendStandaloneEvent({
      action: 'auth.login.failed',
      details: { identifierHash: idHash, reason: 'INVALID_CREDENTIALS' },
      clientIdHash,
    });
    const attempts = await attemptsFor('PASSWORD', idHash, bucket, SECURITY_POLICY.password.windowMs);
    if (shouldLock(attempts, clock.systemNow(), SECURITY_POLICY.password)) {
      await lockAccount(user, idHash, bucket, 'PASSWORD', SECURITY_POLICY.password.lockMs);
    }
    return { kind: 'invalid' };
  }

  await recordAttempt('PASSWORD', { identifierHash: idHash, bucket, clientIdHash, ok: true });
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }

  if (!issuanceAllowed(await issuedRecently(idHash), clock.systemNow())) {
    await appendStandaloneEvent({
      action: 'auth.second-factor.refused',
      details: { reason: 'ISSUANCE_CAP' },
      actor: { userId: user.id, roleAssignmentId: null, role: null, viaDemoSwitch: false },
      clientIdHash,
    });
    return { kind: 'locked', retryAfterSeconds: Math.ceil(SECURITY_POLICY.secondFactor.issueWindowMs / 1000) };
  }

  const result = await db.$transaction(async (tx) => {
    // One pending session per account: a new login closes the previous one.
    const pending = await tx.session.findMany({
      where: { userId: user.id, revokedAt: null, state: { not: 'ACTIVE' } },
      select: { id: true },
    });
    for (const p of pending) await revokeSession(tx, p.id, 'NEW_LOGIN');
    const { token, session } = await createSession(tx, {
      userId: user.id,
      state: 'PENDING_SECOND_FACTOR',
      previousLoginAt: user.lastLoginAt,
      clientIdHash,
    });
    const challenge = await createChallenge(tx, user.id, session.id, idHash, clientIdHash);
    const actor = { userId: user.id, roleAssignmentId: null, role: null, viaDemoSwitch: false };
    await appendEvent(tx, { action: 'auth.login.succeeded', details: { identifierHash: idHash }, actor, clientIdHash });
    await appendEvent(tx, {
      action: 'auth.second-factor.issued',
      details: { challengeId: challenge.challengeId },
      actor,
      clientIdHash,
    });
    return { token, sessionId: session.id, challenge };
  });

  await sendCode(user, result.sessionId, result.challenge.code, result.challenge.expiresAt);
  return { kind: 'pending', token: result.token };
}

// ---------------------------------------------------------------------------

export type SecondFactorResult =
  | { kind: 'locked'; retryAfterSeconds: number }
  | { kind: 'expired' }
  | { kind: 'invalid'; remaining: number }
  | { kind: 'ok'; token: string; next: 'dashboard' | 'role'; deviceId: string };

export async function verifySecondFactor(
  req: Request,
  context: SessionContext,
  clientIdHash: string,
  code: string,
): Promise<SecondFactorResult> {
  const { user, session, actor } = context;
  const idHash = identifierHash(user.email);
  const bucket = await bucketFor(req, user.id);
  const lockedUntil = await activeLock(idHash, bucket);
  if (lockedUntil) return { kind: 'locked', retryAfterSeconds: secondsUntil(lockedUntil) };

  const db = getDb();
  const now = clock.systemNow();
  const challenge = await db.secondFactorChallenge.findFirst({
    where: { sessionId: session.id, consumedAt: null, voidedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge || challenge.expiresAt.getTime() <= now.getTime()) {
    await appendStandaloneEvent({ action: 'auth.second-factor.refused', details: { reason: 'EXPIRED' }, actor, clientIdHash });
    return { kind: 'expired' };
  }

  if (!safeEqual(codeMac(challenge.id, code), challenge.codeMac)) {
    await recordAttempt('SECOND_FACTOR', { identifierHash: idHash, bucket, clientIdHash, ok: false });
    const attempts = await attemptsFor('SECOND_FACTOR', idHash, bucket, SECURITY_POLICY.secondFactor.windowMs);
    if (shouldLock(attempts, clock.systemNow(), SECURITY_POLICY.secondFactor)) {
      const until = await lockAccount(user, idHash, bucket, 'SECOND_FACTOR', SECURITY_POLICY.secondFactor.lockMs, async (tx) => {
        await tx.secondFactorChallenge.updateMany({
          where: { userId: user.id, consumedAt: null, voidedAt: null },
          data: { voidedAt: clock.systemNow() },
        });
        const pending = await tx.session.findMany({
          where: { userId: user.id, revokedAt: null, state: { not: 'ACTIVE' } },
          select: { id: true },
        });
        for (const p of pending) await revokeSession(tx, p.id, 'SECOND_FACTOR_LOCK');
      });
      return { kind: 'locked', retryAfterSeconds: secondsUntil(until) };
    }
    const remaining = secondFactorRemaining(attempts, clock.systemNow());
    await appendStandaloneEvent({ action: 'auth.second-factor.failed', details: { remaining }, actor, clientIdHash });
    return { kind: 'invalid', remaining };
  }

  const deviceId = deviceIdFromRequest(req) ?? newDeviceId();
  const outcome = await db.$transaction(async (tx) => {
    const consumed = await tx.secondFactorChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, voidedAt: null, expiresAt: { gt: clock.systemNow() } },
      data: { consumedAt: clock.systemNow() },
    });
    if (consumed.count !== 1) return null;
    await recordAttempt('SECOND_FACTOR', { identifierHash: idHash, bucket, clientIdHash, ok: true }, tx);
    const roles = await tx.roleAssignment.findMany({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: 'asc' } });
    const single = roles.length === 1 ? (roles[0] ?? null) : null;
    const rotated = await rotateSession(tx, session.id, {
      state: single ? 'ACTIVE' : 'PENDING_ROLE',
      roleAssignment: single ? { connect: { id: single.id } } : { disconnect: true },
      pendingExpiresAt: single ? null : new Date(clock.systemNow().getTime() + SECURITY_POLICY.secondFactor.pendingSessionMs),
      reauthAt: null,
    });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: clock.now() } });
    await rememberDevice(tx, user.id, deviceId);
    await appendEvent(tx, { action: 'auth.second-factor.succeeded', details: {}, actor, clientIdHash });
    if (single) {
      await appendEvent(tx, {
        action: 'auth.role.selected',
        details: { roleAssignmentId: single.id, role: single.role },
        actor: { ...actor, roleAssignmentId: single.id, role: single.role },
        clientIdHash,
      });
    }
    return { token: rotated.token, next: single ? ('dashboard' as const) : ('role' as const) };
  });
  if (!outcome) return { kind: 'expired' };
  return { kind: 'ok', ...outcome, deviceId };
}

export type ResendResult = { kind: 'ok' } | { kind: 'refused'; retryAfterSeconds: number };

export async function resendSecondFactor(context: SessionContext, clientIdHash: string): Promise<ResendResult> {
  const { user, session, actor } = context;
  const idHash = identifierHash(user.email);
  // The cap is per account (contract §4.5): logins and resends together, 5 per
  // 15 minutes and 20 per day, whatever the number of sessions.
  if (!issuanceAllowed(await issuedRecently(idHash), clock.systemNow())) {
    await appendStandaloneEvent({
      action: 'auth.second-factor.refused',
      details: { reason: 'ISSUANCE_CAP' },
      actor,
      clientIdHash,
    });
    return { kind: 'refused', retryAfterSeconds: Math.ceil(SECURITY_POLICY.secondFactor.issueWindowMs / 1000) };
  }
  const challenge = await getDb().$transaction(async (tx) => {
    await tx.session.update({ where: { id: session.id }, data: { resendCount: { increment: 1 } } });
    const created = await createChallenge(tx, user.id, session.id, idHash, clientIdHash);
    await appendEvent(tx, {
      action: 'auth.second-factor.issued',
      details: { challengeId: created.challengeId },
      actor,
      clientIdHash,
    });
    return created;
  });
  await sendCode(user, session.id, challenge.code, challenge.expiresAt);
  return { kind: 'ok' };
}

// ---------------------------------------------------------------------------

export type RoleSelection = { kind: 'ok'; token: string } | { kind: 'not-found' };

export async function selectRole(context: SessionContext, clientIdHash: string, roleAssignmentId: string): Promise<RoleSelection> {
  const { user, session, actor } = context;
  const db = getDb();
  const assignment = await db.roleAssignment.findFirst({
    where: { id: roleAssignmentId, userId: user.id, revokedAt: null },
  });
  if (!assignment) return { kind: 'not-found' };
  const token = await db.$transaction(async (tx) => {
    const rotated = await rotateSession(tx, session.id, {
      state: 'ACTIVE',
      roleAssignment: { connect: { id: assignment.id } },
      pendingExpiresAt: null,
      reauthAt: null,
    });
    await appendEvent(tx, {
      action: 'auth.role.selected',
      details: { roleAssignmentId: assignment.id, role: assignment.role },
      actor: { ...actor, roleAssignmentId: assignment.id, role: assignment.role },
      clientIdHash,
    });
    return rotated.token;
  });
  return { kind: 'ok', token };
}

export async function logout(context: SessionContext, clientIdHash: string): Promise<void> {
  await getDb().$transaction(async (tx) => {
    await revokeSession(tx, context.session.id, 'LOGOUT');
    await appendEvent(tx, { action: 'auth.logout', details: {}, actor: context.actor, clientIdHash });
  });
}

export type ReauthResult = { kind: 'ok' } | { kind: 'invalid' } | { kind: 'locked'; retryAfterSeconds: number };

/** Re-authentication before a sensitive action. Failures count toward the password lock. */
export async function reauthenticate(
  req: Request,
  context: SessionContext,
  clientIdHash: string,
  password: string,
): Promise<ReauthResult> {
  const { user, session, actor } = context;
  const idHash = identifierHash(user.email);
  const bucket = await bucketFor(req, user.id);
  const lockedUntil = await activeLock(idHash, bucket);
  if (lockedUntil) return { kind: 'locked', retryAfterSeconds: secondsUntil(lockedUntil) };

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    await recordAttempt('PASSWORD', { identifierHash: idHash, bucket, clientIdHash, ok: false });
    await appendStandaloneEvent({ action: 'auth.reauth.failed', details: {}, actor, clientIdHash });
    const attempts = await attemptsFor('PASSWORD', idHash, bucket, SECURITY_POLICY.password.windowMs);
    if (shouldLock(attempts, clock.systemNow(), SECURITY_POLICY.password)) {
      // The person at the keyboard is presumably not the owner: the session ends.
      const until = await lockAccount(user, idHash, bucket, 'REAUTH', SECURITY_POLICY.password.lockMs, async (tx) => {
        await revokeSession(tx, session.id, 'REAUTH_LOCK');
      });
      return { kind: 'locked', retryAfterSeconds: secondsUntil(until) };
    }
    return { kind: 'invalid' };
  }
  await recordAttempt('PASSWORD', { identifierHash: idHash, bucket, clientIdHash, ok: true });
  await getDb().$transaction(async (tx) => {
    await tx.session.update({ where: { id: session.id }, data: { reauthAt: clock.systemNow() } });
    await appendEvent(tx, { action: 'auth.reauth.succeeded', details: {}, actor, clientIdHash });
  });
  return { kind: 'ok' };
}
