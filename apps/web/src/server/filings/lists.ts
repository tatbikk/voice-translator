import 'server-only';
import { authorize, viewScope, type AuthorizationContext, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';
import { scopeWhere } from '../cases/scope';
import { emptyPage, PAGE_SIZE, readPage, withRows, type Page } from '../lists/paging';

// «مشاريع الإيداع» (the lawyer's own drafts) and «لائحة الملفات» (the files the
// user may open). A draft belongs to its author alone (decision 56); a file is
// listed only when the core grants its page to the user. Both are read a page
// at a time, with their total, in a stable order (independent review IR-11,
// decision 75): the drafts the latest changed first, the files by their number
// in the register, the latest first. Neither is a list of what awaits an act.

export interface DraftRow {
  readonly id: string;
  readonly channel: 'ELECTRONIC' | 'PAPER';
  readonly status: 'DRAFT' | 'FILED';
  readonly caseType: string | null;
  readonly courtName: string | null;
  readonly updatedAt: Date;
  readonly caseFileId: string | null;
}

export async function draftsOf(subject: UserSubject, context: AuthorizationContext, page = 1): Promise<Page<DraftRow>> {
  if (!authorize(subject, 'filing.drafts.list', undefined, context).allowed) return emptyPage(PAGE_SIZE.drafts);
  const db = getDb();
  const where = { ownerUserId: subject.userId };
  const read = await readPage(
    PAGE_SIZE.drafts,
    page,
    () => db.filingDraft.count({ where }),
    (window) =>
      db.filingDraft.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        ...window,
        select: { id: true, channel: true, status: true, caseType: true, updatedAt: true, caseFileId: true, court: { select: { name: true } } },
      }),
  );
  return withRows(
    read,
    read.rows.map((r) => ({ id: r.id, channel: r.channel, status: r.status, caseType: r.caseType, courtName: r.court?.name ?? null, updatedAt: r.updatedAt, caseFileId: r.caseFileId })),
  );
}

export interface CaseRow {
  readonly id: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly caseType: string | null;
  readonly status: string;
  /** registered, its rapporteur not yet assigned (study: «مقيد، في انتظار تعيين القاضي المقرر») */
  readonly awaitingRapporteur: boolean;
  readonly courtName: string;
  readonly parties: readonly string[];
  readonly nextHearing: Date | null;
}

/**
 * The files the user may open, newest first: selected in the query by the
 * relations through which the core lets the user open a file (viewScope), a
 * page at a time; each row of the page confirmed by the core (case.view).
 */
export async function casesOf(subject: UserSubject, context: AuthorizationContext, page = 1): Promise<Page<CaseRow>> {
  if (!authorize(subject, 'cases.list', undefined, context).allowed || !context.now) return emptyPage(PAGE_SIZE.cases);
  const now = context.now;
  const db = getDb();
  const where = scopeWhere(subject, viewScope(subject));
  const read = await readPage(PAGE_SIZE.cases, page, () => db.caseFile.count({ where }), (window) => db.caseFile.findMany({
    where,
    orderBy: [{ year: 'desc' }, { number: 'desc' }, { id: 'asc' }],
    ...window,
    select: {
      id: true,
      number: true,
      code: true,
      year: true,
      caseType: true,
      status: true,
      rapporteurUserId: true,
      court: { select: { name: true } },
      nextHearing: { select: { startsAt: true } },
      parties: { orderBy: { position: 'asc' }, take: 3, select: { displayName: true } },
    },
  }));
  const out: CaseRow[] = [];
  for (const r of read.rows) {
    const snapshot = await caseSnapshot(r.id, now);
    if (!snapshot || !authorize(subject, 'case.view', { kind: 'case', snapshot }, context).allowed) continue;
    out.push({
      id: r.id,
      number: { number: r.number, code: r.code, year: r.year },
      caseType: r.caseType,
      status: r.status,
      awaitingRapporteur: r.status === 'REGISTERED' && r.rapporteurUserId === null,
      courtName: r.court.name,
      parties: r.parties.map((p) => p.displayName),
      nextHearing: r.nextHearing?.startsAt ?? null,
    });
  }
  return withRows(read, out);
}
