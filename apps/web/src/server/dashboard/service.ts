import 'server-only';
import { authorize, availableActions, awaitedScope, type AuthorizationContext, type CaseSnapshot, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';
import { OLDEST_FIRST, scopesWhere } from '../cases/scope';
import { PAGE_SIZE, readPage, withRows, type Page } from '../lists/paging';
import { notificationsSince, type NotificationView } from '../notifications/service';

// The start page answers «what is expected of me» before «what are my files»
// (study, «العناصر المشتركة»): three boxes for every role. Who sees what is
// decided by the core alone (review A-04): the files are those the core relates
// to the user (case.view), the first box lists the awaited actions it grants on
// each, the second the running time limits of those files, and the state of the
// event chain is shown to whoever holds events.chain-status.view.
//
// Neither box takes the newest files and filters them (independent review
// IR-11, decision 75). The first selects, in its query, the files the user may
// open in which an act of his awaits (awaitedScope, from the core's table,
// every condition of the act read from the file's data: decision 76), the one
// waiting longest first, a page of files at a time; the second selects the
// running limits of the files the user may open, the nearest first, a page at
// a time. Both say how many there are; the core decides each file of the page
// shown, and no other.

/** How far ahead a time limit counts as approaching. */
const APPROACHING_MS = 15 * 86_400_000;

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
  /** the awaited acts of a page of files; the page's positions and total count files */
  readonly waiting: Page<WaitingItem>;
  readonly deadlines: Page<DeadlineItem>;
  readonly newSinceLastLogin: readonly NotificationView[];
  readonly previousLoginAt: Date | null;
  readonly chainStatus: 'UNVERIFIED' | 'OK' | 'BROKEN' | null;
}

export async function dashboardFor(
  subject: UserSubject,
  previousLoginAt: Date | null,
  context: AuthorizationContext & { now: Date },
  pages: { readonly awaiting: number; readonly deadlines: number } = { awaiting: 1, deadlines: 1 },
): Promise<DashboardData> {
  const db = getDb();
  const now = context.now;
  const newSinceLastLogin = await notificationsSince(subject.userId, previousLoginAt);

  // One snapshot per file of the pages shown, shared by both boxes.
  const snapshots = new Map<string, CaseSnapshot | null>();
  const viewable = async (caseFileId: string): Promise<CaseSnapshot | null> => {
    if (!snapshots.has(caseFileId)) snapshots.set(caseFileId, await caseSnapshot(caseFileId, now));
    const snapshot = snapshots.get(caseFileId) ?? null;
    return snapshot && authorize(subject, 'case.view', { kind: 'case', snapshot }, context).allowed ? snapshot : null;
  };
  const ref = (f: { id: string; number: number; code: number; year: number }): CaseRef => ({ caseFileId: f.id, number: f.number, code: f.code, year: f.year });

  const awaitingWhere = scopesWhere(subject, now, awaitedScope(subject));
  const files = await readPage(PAGE_SIZE.awaiting, pages.awaiting, () => db.caseFile.count({ where: awaitingWhere }), (window) =>
    db.caseFile.findMany({ where: awaitingWhere, orderBy: [...OLDEST_FIRST], ...window, select: { id: true, number: true, code: true, year: true } }),
  );
  const waiting: WaitingItem[] = [];
  for (const file of files.rows) {
    const snapshot = await viewable(file.id);
    if (!snapshot) continue;
    for (const rule of availableActions(subject, { kind: 'case', snapshot }, context)) {
      if (rule.procedure?.awaited) waiting.push({ ...ref(file), labelKey: rule.labelKey });
    }
  }

  const limitsWhere = {
    status: 'RUNNING' as const,
    endsAt: { gt: now, lte: new Date(now.getTime() + APPROACHING_MS) },
    caseFile: scopesWhere(subject, now),
  };
  const limits = await readPage(PAGE_SIZE.deadlines, pages.deadlines, () => db.timeLimit.count({ where: limitsWhere }), (window) =>
    db.timeLimit.findMany({
      where: limitsWhere,
      orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
      ...window,
      select: {
        ruleCode: true,
        lastDay: true,
        endsAt: true,
        party: { select: { displayName: true } },
        caseFile: { select: { id: true, number: true, code: true, year: true } },
      },
    }),
  );
  const deadlines: DeadlineItem[] = [];
  for (const limit of limits.rows) {
    if (!(await viewable(limit.caseFile.id))) continue;
    deadlines.push({ ...ref(limit.caseFile), ruleCode: limit.ruleCode, lastDay: limit.lastDay, endsAt: limit.endsAt, party: limit.party?.displayName ?? null });
  }

  let chainStatus: DashboardData['chainStatus'] = null;
  if (authorize(subject, 'events.chain-status.view', undefined, context).allowed) {
    const state = await db.systemState.findUnique({ where: { id: 1 }, select: { chainStatus: true } });
    const status = state?.chainStatus;
    chainStatus = status === 'OK' || status === 'BROKEN' ? status : 'UNVERIFIED';
  }
  return { waiting: withRows(files, waiting), deadlines: withRows(limits, deadlines), newSinceLastLogin, previousLoginAt, chainStatus };
}
