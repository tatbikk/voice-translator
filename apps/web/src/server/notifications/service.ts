import 'server-only';
import { safeInternalPath } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { getEnv } from '../config/env';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendEvent, type EventActor } from '../events/append';

// Notifications inside the user's space. Three kinds, never confused: a legal
// notification (opens a time limit, acknowledged), information, a reminder.

type Tx = Prisma.TransactionClient;
export type NotificationKind = 'LEGAL_NOTIFICATION' | 'INFORMATION' | 'REMINDER';

export async function createNotification(
  tx: Tx,
  input: {
    userId: string;
    kind: NotificationKind;
    templateKey: string;
    params?: Record<string, string | number>;
    targetPath?: string | null;
    caseFileId?: string | null;
  },
): Promise<void> {
  const target = input.targetPath ? safeInternalPath(input.targetPath, getEnv().appOrigin) : null;
  await tx.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      templateKey: input.templateKey,
      params: input.params ?? {},
      targetPath: target === '/' ? null : target,
      caseFileId: input.caseFileId ?? null,
      createdAt: clock.now(),
    },
  });
}

export interface NotificationView {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly templateKey: string;
  readonly params: Record<string, string | number>;
  readonly targetPath: string | null;
  readonly createdAt: Date;
  readonly read: boolean;
}

function toView(row: {
  id: string;
  kind: NotificationKind;
  templateKey: string;
  params: Prisma.JsonValue;
  targetPath: string | null;
  createdAt: Date;
  readAt: Date | null;
}): NotificationView {
  const params = typeof row.params === 'object' && row.params !== null && !Array.isArray(row.params) ? row.params : {};
  const safeParams: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' || typeof v === 'number') safeParams[k] = v;
  }
  const target = row.targetPath ? safeInternalPath(row.targetPath, getEnv().appOrigin) : null;
  return {
    id: row.id,
    kind: row.kind,
    templateKey: row.templateKey,
    params: safeParams,
    targetPath: target === '/' ? null : target,
    createdAt: row.createdAt,
    read: row.readAt !== null,
  };
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationView[]> {
  const rows = await getDb().notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toView);
}

export async function notificationsSince(userId: string, since: Date | null, limit = 20): Promise<NotificationView[]> {
  const rows = await getDb().notification.findMany({
    where: { userId, ...(since ? { createdAt: { gt: since } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toView);
}

export async function unreadCount(userId: string): Promise<number> {
  return getDb().notification.count({ where: { userId, readAt: null } });
}

/** Looks up a notification for the authorization check; owner only matters. */
export async function notificationOwner(id: string): Promise<string | null> {
  const row = await getDb().notification.findUnique({ where: { id }, select: { userId: true } });
  return row?.userId ?? null;
}

export async function markRead(id: string, actor: EventActor, clientIdHash: string): Promise<void> {
  await getDb().$transaction(async (tx) => {
    await tx.notification.updateMany({ where: { id, readAt: null }, data: { readAt: clock.now() } });
    await appendEvent(tx, { action: 'notification.read', details: { notificationId: id }, actor, clientIdHash });
  });
}
