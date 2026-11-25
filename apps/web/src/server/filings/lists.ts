import 'server-only';
import { authorize, type AuthorizationContext, type UserSubject } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';

// «مشاريع الإيداع» (the lawyer's own drafts) and «لائحة الملفات» (the files the
// user may open). A draft belongs to its author alone (decision 56); a file is
// listed only when the core grants its page to the user.

export interface DraftRow {
  readonly id: string;
  readonly channel: 'ELECTRONIC' | 'PAPER';
  readonly status: 'DRAFT' | 'FILED';
  readonly caseType: string | null;
  readonly courtName: string | null;
  readonly updatedAt: Date;
  readonly caseFileId: string | null;
}

export async function draftsOf(subject: UserSubject, context: AuthorizationContext): Promise<DraftRow[]> {
  if (!authorize(subject, 'filing.drafts.list', undefined, context).allowed) return [];
  const rows = await getDb().filingDraft.findMany({
    where: { ownerUserId: subject.userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, channel: true, status: true, caseType: true, updatedAt: true, caseFileId: true, court: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, channel: r.channel, status: r.status, caseType: r.caseType, courtName: r.court?.name ?? null, updatedAt: r.updatedAt, caseFileId: r.caseFileId }));
}

export interface CaseRow {
  readonly id: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly caseType: string | null;
  readonly status: string;
  readonly courtName: string;
  readonly parties: readonly string[];
  readonly nextHearing: Date | null;
}

const CANDIDATES = 60;

/** The files the user may open, newest first: candidates by the user's ties, each confirmed by the core. */
export async function casesOf(subject: UserSubject, context: AuthorizationContext): Promise<CaseRow[]> {
  if (!authorize(subject, 'cases.list', undefined, context).allowed || !context.now) return [];
  const ties: Prisma.CaseFileWhereInput[] = [
    { parties: { some: { representations: { some: { lawyerUserId: subject.userId, endedAt: null } } } } },
    { parties: { some: { litigantUserId: subject.userId } } },
    { rapporteurUserId: subject.userId },
    { filedByUserId: subject.userId },
  ];
  if (subject.courtId) ties.push({ courtId: subject.courtId });
  const rows = await getDb().caseFile.findMany({
    where: { OR: ties },
    orderBy: [{ year: 'desc' }, { number: 'desc' }],
    take: CANDIDATES,
    select: {
      id: true,
      number: true,
      code: true,
      year: true,
      caseType: true,
      status: true,
      court: { select: { name: true } },
      nextHearing: { select: { startsAt: true } },
      parties: { orderBy: { position: 'asc' }, take: 3, select: { displayName: true } },
    },
  });
  const out: CaseRow[] = [];
  for (const r of rows) {
    const snapshot = await caseSnapshot(r.id, context.now);
    if (!snapshot || !authorize(subject, 'case.view', { kind: 'case', snapshot }, context).allowed) continue;
    out.push({
      id: r.id,
      number: { number: r.number, code: r.code, year: r.year },
      caseType: r.caseType,
      status: r.status,
      courtName: r.court.name,
      parties: r.parties.map((p) => p.displayName),
      nextHearing: r.nextHearing?.startsAt ?? null,
    });
  }
  return out;
}
