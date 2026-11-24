import 'server-only';
import { SECURITY_POLICY, type UserSubject } from '@mahkama/core';
import type { Prisma, RoleAssignment, Session, User } from '@/generated/prisma/client';
import { getEnv } from '../config/env';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendStandaloneEvent, type EventActor } from '../events/append';
import { COOKIES, clearCookie, readCookie, serializeCookie } from '../http/cookies';
import { isBackgroundRefresh } from '../http/request-info';
import { randomToken, sha256Hex } from './tokens';

// Sessions (contract §5). The cookie holds an opaque random token; the database
// keeps only its SHA-256. Every request re-reads the session, the user and the
// selected role: a disabled user or a revoked role ends the session at once.

export type SessionState = 'PENDING_SECOND_FACTOR' | 'PENDING_ROLE' | 'ACTIVE';
type Tx = Prisma.TransactionClient;

export interface SessionContext {
  readonly session: Session;
  readonly user: User;
  readonly roleAssignment: RoleAssignment | null;
  readonly roleCount: number;
  /** present only for an ACTIVE session with a selected role */
  readonly subject: UserSubject | null;
  readonly actor: EventActor;
}

const TOUCH_EVERY_MS = 15_000;

export function sessionCookie(token: string): string {
  // Browser-session cookie: no Max-Age, it ends with the browser.
  return serializeCookie(COOKIES.session, token);
}

export function clearSessionCookie(): string {
  return clearCookie(COOKIES.session);
}

export async function createSession(
  tx: Tx,
  input: {
    userId: string;
    state: SessionState;
    roleAssignmentId?: string | null;
    origin?: 'LOGIN' | 'DEMO_SWITCH';
    previousLoginAt?: Date | null;
    clientIdHash: string;
  },
): Promise<{ token: string; session: Session }> {
  const now = clock.systemNow();
  const token = randomToken(32);
  const pending = input.state !== 'ACTIVE';
  const session = await tx.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId: input.userId,
      state: input.state,
      origin: input.origin ?? 'LOGIN',
      roleAssignmentId: input.roleAssignmentId ?? null,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + SECURITY_POLICY.session.absoluteMs),
      pendingExpiresAt: pending ? new Date(now.getTime() + SECURITY_POLICY.secondFactor.pendingSessionMs) : null,
      previousLoginAt: input.previousLoginAt ?? null,
      clientIdHash: input.clientIdHash,
    },
  });
  return { token, session };
}

/** Gives the session a new token (fixation defence) and applies the changes. */
export async function rotateSession(
  tx: Tx,
  sessionId: string,
  changes: Prisma.SessionUpdateInput = {},
): Promise<{ token: string; session: Session }> {
  const token = randomToken(32);
  const now = clock.systemNow();
  const session = await tx.session.update({
    where: { id: sessionId },
    data: { ...changes, tokenHash: sha256Hex(token), lastSeenAt: now },
  });
  return { token, session };
}

export type RevokeCause =
  | 'USER_DISABLED'
  | 'ROLE_REVOKED'
  | 'NEW_LOGIN'
  | 'DEMO_SWITCH'
  | 'REAUTH_LOCK'
  | 'SECOND_FACTOR_LOCK'
  | 'LOGOUT';

export async function revokeSession(tx: Tx, sessionId: string, cause: RevokeCause): Promise<void> {
  await tx.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: clock.systemNow(), revokeReason: cause },
  });
}

function actorOf(session: Session, roleAssignment: RoleAssignment | null): EventActor {
  return {
    userId: session.userId,
    roleAssignmentId: roleAssignment?.id ?? null,
    role: roleAssignment?.role ?? null,
    viaDemoSwitch: session.origin === 'DEMO_SWITCH',
  };
}

export type SessionProblem = 'NONE' | 'EXPIRED' | 'REVOKED';

/**
 * Resolves the session of a request. Expired or invalidated sessions are closed
 * here and logged; the caller then treats the request as having no session.
 */
export async function resolveSession(req: Request): Promise<SessionContext | null> {
  const token = readCookie(req, COOKIES.session);
  if (!token || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const db = getDb();
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true, roleAssignment: true },
  });
  if (!session || session.revokedAt) return null;

  const now = clock.systemNow();
  const { user, roleAssignment } = session;
  const actor = actorOf(session, roleAssignment);
  const idleMs = getEnv().idleMinutes * 60_000;

  let expired: 'IDLE' | 'ABSOLUTE' | 'PENDING' | null = null;
  if (now.getTime() > session.absoluteExpiresAt.getTime()) expired = 'ABSOLUTE';
  else if (session.state !== 'ACTIVE' && session.pendingExpiresAt && now.getTime() > session.pendingExpiresAt.getTime())
    expired = 'PENDING';
  else if (now.getTime() - session.lastSeenAt.getTime() > idleMs) expired = 'IDLE';
  if (expired) {
    await db.$transaction((tx) => revokeSession(tx, session.id, 'LOGOUT'));
    await appendStandaloneEvent({ action: 'auth.session.expired', details: { kind: expired }, actor });
    return null;
  }

  let invalid: RevokeCause | null = null;
  if (user.disabledAt) invalid = 'USER_DISABLED';
  else if (roleAssignment?.revokedAt) invalid = 'ROLE_REVOKED';
  if (invalid) {
    await db.$transaction((tx) => revokeSession(tx, session.id, invalid));
    await appendStandaloneEvent({ action: 'auth.session.revoked', details: { cause: invalid }, actor });
    return null;
  }

  const roleCount = await db.roleAssignment.count({ where: { userId: user.id, revokedAt: null } });

  if (!isBackgroundRefresh(req) && now.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  const subject: UserSubject | null =
    session.state === 'ACTIVE' && roleAssignment
      ? {
          kind: 'user',
          userId: user.id,
          role: roleAssignment.role,
          roleAssignmentId: roleAssignment.id,
          courtId: roleAssignment.courtId,
          organizationId: roleAssignment.organizationId,
          isDemoAccount: user.isDemo,
          roleCount,
          verificationStatus: roleAssignment.verificationStatus,
        }
      : null;

  return { session, user, roleAssignment, roleCount, subject, actor };
}

/** Re-authentication within the last minutes (sensitive actions). */
export function recentlyReauthenticated(session: Session, minutes: number): boolean {
  if (!session.reauthAt) return false;
  return clock.systemNow().getTime() - session.reauthAt.getTime() <= minutes * 60_000;
}
