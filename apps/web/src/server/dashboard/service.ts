import 'server-only';
import type { UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { notificationsSince, type NotificationView } from '../notifications/service';

// The start page answers «what is expected of me» before «what are my files»
// (study, «العناصر المشتركة»): three boxes for every role. In Phase 0 nothing is
// pending and no time limit runs yet: the first two boxes say so in full
// sentences. The third lists what arrived since the previous login.

export interface DashboardData {
  readonly waiting: readonly never[];
  readonly deadlines: readonly never[];
  readonly newSinceLastLogin: readonly NotificationView[];
  readonly previousLoginAt: Date | null;
  /** shown to the system administrator only */
  readonly chainStatus: 'UNVERIFIED' | 'OK' | 'BROKEN' | null;
}

export async function dashboardFor(subject: UserSubject, previousLoginAt: Date | null): Promise<DashboardData> {
  const newSinceLastLogin = await notificationsSince(subject.userId, previousLoginAt);
  let chainStatus: DashboardData['chainStatus'] = null;
  if (subject.role === 'SYSTEM_ADMIN') {
    const state = await getDb().systemState.findUnique({ where: { id: 1 }, select: { chainStatus: true } });
    const status = state?.chainStatus;
    chainStatus = status === 'OK' || status === 'BROKEN' ? status : 'UNVERIFIED';
  }
  return { waiting: [], deadlines: [], newSinceLastLogin, previousLoginAt, chainStatus };
}
