import 'server-only';
import { getEnv } from '@/server/config/env';
import { getDb } from '@/server/db';
import { appendEvent, appendStandaloneEvent, type EventActor } from '@/server/events/append';
import { createSession, revokeSession } from '@/server/auth/sessions';

// Demo tools deliberately bypass controls: they are isolated here, reached only
// through their own entry points, absent from non-demo builds, and every use is
// written to the event log. This module refuses to load outside demo mode.
if (getEnv().mode !== 'demo') {
  throw new Error('the demo module cannot be loaded outside the demo environment');
}

export interface OutboxItem {
  readonly id: string;
  readonly channel: 'SMS' | 'EMAIL';
  readonly sender: string;
  readonly recipientAddress: string;
  readonly body: string;
  readonly createdAt: Date;
}

/**
 * Messages addressed to demo accounts are visible to every visitor of the demo
 * environment. Messages for any other account are visible only to the session
 * that caused them (the person who asked for the code or created the account).
 */
export async function outboxFor(sessionId: string | null, actor: EventActor | null, clientIdHash: string): Promise<OutboxItem[]> {
  const db = getDb();
  const demoUsers = await db.user.findMany({ where: { isDemo: true }, select: { id: true } });
  const rows = await db.outboundMessage.findMany({
    where: {
      OR: [
        { recipientUserId: { in: demoUsers.map((u) => u.id) } },
        ...(sessionId ? [{ visibleToSessionId: sessionId }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, channel: true, sender: true, recipientAddress: true, body: true, createdAt: true },
  });
  await appendStandaloneEvent({ action: 'demo.outbox.viewed', details: { count: rows.length }, actor, clientIdHash });
  return rows;
}

export interface DemoAccount {
  readonly roleAssignmentId: string;
  readonly fullName: string;
  readonly role: string;
  readonly courtName: string | null;
  readonly courtDegree: 'FIRST_INSTANCE' | 'APPEAL' | null;
}

export async function demoAccounts(): Promise<DemoAccount[]> {
  const rows = await getDb().roleAssignment.findMany({
    where: { revokedAt: null, user: { isDemo: true, disabledAt: null, passwordHash: { not: null } } },
    include: { user: { select: { fullName: true } }, court: { select: { name: true, degree: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    roleAssignmentId: r.id,
    fullName: r.user.fullName,
    role: r.role,
    courtName: r.court?.name ?? null,
    courtDegree: r.court?.degree ?? null,
  }));
}

/** Authorization resource of a switch target: unknown and non-demo answer alike. */
export async function switchTarget(roleAssignmentId: string) {
  const row = await getDb().roleAssignment.findUnique({
    where: { id: roleAssignmentId },
    include: { user: { select: { id: true, isDemo: true, disabledAt: true, passwordHash: true } } },
  });
  if (!row || row.revokedAt || row.user.disabledAt || !row.user.passwordHash) return null;
  return { kind: 'demo-account' as const, userId: row.user.id, isDemo: row.user.isDemo };
}

export async function switchAccount(
  roleAssignmentId: string,
  previous: { sessionId: string | null; userId: string | null },
  clientIdHash: string,
): Promise<string> {
  const db = getDb();
  const assignment = await db.roleAssignment.findUniqueOrThrow({ where: { id: roleAssignmentId }, include: { user: true } });
  return db.$transaction(async (tx) => {
    if (previous.sessionId) await revokeSession(tx, previous.sessionId, 'DEMO_SWITCH');
    const { token } = await createSession(tx, {
      userId: assignment.userId,
      state: 'ACTIVE',
      roleAssignmentId: assignment.id,
      origin: 'DEMO_SWITCH',
      // A switch is not a login: "new since last login" keeps its reference.
      previousLoginAt: assignment.user.lastLoginAt,
      clientIdHash,
    });
    await appendEvent(tx, {
      action: 'demo.account.switched',
      details: { fromUserId: previous.userId, toUserId: assignment.userId },
      actor: { userId: assignment.userId, roleAssignmentId: assignment.id, role: assignment.role, viaDemoSwitch: true },
      clientIdHash,
    });
    return token;
  });
}
