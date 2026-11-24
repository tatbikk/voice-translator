import 'server-only';
import { authorize, availableActions, type AuthorizationContext, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';
import { notificationsSince, type NotificationView } from '../notifications/service';

// The start page answers «what is expected of me» before «what are my files»
// (study, «العناصر المشتركة»): three boxes for every role. Who sees what is
// decided by the core alone (review A-04): the files are those the core relates
// to the user (case.view), the first box lists the awaited actions it grants on
// each, the second the running time limits of those files, and the state of the
// event chain is shown to whoever holds events.chain-status.view.

/** How far ahead a time limit counts as approaching. */
const APPROACHING_MS = 15 * 86_400_000;
/** The files looked at for the first two boxes, most recent first. */
const CANDIDATE_FILES = 60;

export interface CaseRef {
  readonly caseFileId: string;
  readonly number: number;
  readonly code: number;
  readonly year: number;
}

export interface WaitingItem extends CaseRef {
  readonly labelKey: string;
}

export interface DeadlineItem extends CaseRef {
  readonly ruleCode: string;
  readonly lastDay: string;
  readonly endsAt: Date;
  readonly party: string | null;
}

export interface DashboardData {
  readonly waiting: readonly WaitingItem[];
  readonly deadlines: readonly DeadlineItem[];
  readonly newSinceLastLogin: readonly NotificationView[];
  readonly previousLoginAt: Date | null;
  readonly chainStatus: 'UNVERIFIED' | 'OK' | 'BROKEN' | null;
}

/** Files the user may be related to; the core then decides which ones are. */
async function candidateFiles(subject: UserSubject): Promise<CaseRef[]> {
  const or = [
    { parties: { some: { representations: { some: { lawyerUserId: subject.userId, endedAt: null } } } } },
    { parties: { some: { litigantUserId: subject.userId } } },
    { rapporteurUserId: subject.userId },
    { investigations: { some: { expertUserId: subject.userId } } },
    { envelopes: { some: { agentUserId: subject.userId } } },
    ...(subject.panelId ? [{ panelId: subject.panelId }] : []),
    ...(subject.courtId ? [{ courtId: subject.courtId }] : []),
    ...(subject.organizationId ? [{ parties: { some: { organizationId: subject.organizationId } } }] : []),
  ];
  return getDb().caseFile.findMany({
    where: { OR: or },
    orderBy: { createdAt: 'desc' },
    take: CANDIDATE_FILES,
    select: { id: true, number: true, code: true, year: true },
  }).then((rows) => rows.map((r) => ({ caseFileId: r.id, number: r.number, code: r.code, year: r.year })));
}

export async function dashboardFor(
  subject: UserSubject,
  previousLoginAt: Date | null,
  context: AuthorizationContext & { now: Date },
): Promise<DashboardData> {
  const newSinceLastLogin = await notificationsSince(subject.userId, previousLoginAt);

  const waiting: WaitingItem[] = [];
  const related: CaseRef[] = [];
  for (const file of await candidateFiles(subject)) {
    const snapshot = await caseSnapshot(file.caseFileId, context.now);
    if (!snapshot) continue;
    const resource = { kind: 'case', snapshot } as const;
    if (!authorize(subject, 'case.view', resource, context).allowed) continue;
    related.push(file);
    for (const rule of availableActions(subject, resource, context)) {
      if (rule.procedure?.awaited) waiting.push({ ...file, labelKey: rule.labelKey });
    }
  }

  const byId = new Map(related.map((f) => [f.caseFileId, f]));
  const limits = related.length
    ? await getDb().timeLimit.findMany({
        where: {
          caseFileId: { in: [...byId.keys()] },
          status: 'RUNNING',
          endsAt: { gt: context.now, lte: new Date(context.now.getTime() + APPROACHING_MS) },
        },
        orderBy: { endsAt: 'asc' },
        take: 20,
        select: { caseFileId: true, ruleCode: true, lastDay: true, endsAt: true, party: { select: { displayName: true } } },
      })
    : [];
  const deadlines: DeadlineItem[] = limits.flatMap((l) => {
    const file = byId.get(l.caseFileId);
    return file ? [{ ...file, ruleCode: l.ruleCode, lastDay: l.lastDay, endsAt: l.endsAt, party: l.party?.displayName ?? null }] : [];
  });

  let chainStatus: DashboardData['chainStatus'] = null;
  if (authorize(subject, 'events.chain-status.view', undefined, context).allowed) {
    const state = await getDb().systemState.findUnique({ where: { id: 1 }, select: { chainStatus: true } });
    const status = state?.chainStatus;
    chainStatus = status === 'OK' || status === 'BROKEN' ? status : 'UNVERIFIED';
  }
  return { waiting, deadlines, newSinceLastLogin, previousLoginAt, chainStatus };
}
