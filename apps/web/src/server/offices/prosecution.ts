import 'server-only';
import { actionScope, authorize, type AuthorizationContext, type CaseSnapshot, type UserSubject } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';
import { outsideScopeWhere, scopesWhere } from '../cases/scope';
import { emptyPage, PAGE_SIZE, readSegmentedPage, withRows, type Page } from '../lists/paging';

// «الإحالات» of the public prosecution (study, «واجهة النيابة العامة»: «تعرض
// لوحة البداية الإحالات التي ترد على النيابة العامة بمجرد تقييد القضية، مرتبة
// بحسب سببها»): every referral of its court, by ground — the files where it is
// a principal party (art. 18: «يكون للنيابة العامة في جميع هذه الحالات ما
// للخصوم من حقوق», in the cases that article lists), and those communicated to
// it (art. 20). Whether the limit of art. 20 §2 binds a principal party too is
// open question س45; the list does not answer it. Each ground shows
// first the referrals in which the core's table still lets it file its written
// conclusions («إيداع مستنتجات كتابية»: before the debate is closed, art. 20
// §2), then the others, each part the referral received longest ago first, a
// page at a time with its total (independent review IR-11, decisions 75 and
// 76). Each row is the core's to show (case.view), and says whether the
// conclusions are still open.

export interface ReferredFile {
  readonly caseFileId: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly article: number;
  readonly item: number | null;
  readonly reasonCode: string;
  readonly referredAt: Date;
  /** the file is in a state where the table offers «إيداع مستنتجات كتابية» */
  readonly conclusionsOpen: boolean;
}

export interface Referrals {
  readonly principalParty: Page<ReferredFile>;
  readonly communication: Page<ReferredFile>;
}

/** The act the open referrals come first for. */
const CONCLUSIONS = 'case.prosecution.conclusions';

export async function prosecutionReferrals(
  subject: UserSubject,
  context: AuthorizationContext,
  pages: { readonly principal: number; readonly communication: number } = { principal: 1, communication: 1 },
): Promise<Referrals | null> {
  if (!authorize(subject, 'prosecution.referrals.list', undefined, context).allowed || !subject.courtId) return null;
  const now = context.now;
  if (!now) return { principalParty: emptyPage(PAGE_SIZE.referrals), communication: emptyPage(PAGE_SIZE.referrals) };
  const db = getDb();
  const conclusions = actionScope(subject, CONCLUSIONS);
  const open = scopesWhere(subject, now, conclusions);
  const others = outsideScopeWhere(subject, now, conclusions);
  const snapshots = new Map<string, CaseSnapshot | null>();
  const shown = async (caseFileId: string) => {
    if (!snapshots.has(caseFileId)) snapshots.set(caseFileId, await caseSnapshot(caseFileId, now));
    const snapshot = snapshots.get(caseFileId);
    return snapshot ? authorize(subject, 'case.view', { kind: 'case', snapshot }, context).allowed : false;
  };

  const ground = async (name: 'PRINCIPAL_PARTY' | 'COMMUNICATION', page: number): Promise<Page<ReferredFile>> => {
    const part = (files: Prisma.CaseFileWhereInput, conclusionsOpen: boolean) => {
      const where: Prisma.CaseReferralWhereInput = { target: 'PROSECUTION', ground: name, caseFile: files };
      return {
        count: () => db.caseReferral.count({ where }),
        read: async (window: { skip: number; take: number }) =>
          (
            await db.caseReferral.findMany({
              where,
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              ...window,
              select: { article: true, item: true, reasonCode: true, createdAt: true, caseFile: { select: { id: true, number: true, code: true, year: true } } },
            })
          ).map((r) => ({ ...r, conclusionsOpen })),
      };
    };
    const read = await readSegmentedPage(PAGE_SIZE.referrals, page, [part(open, true), part(others, false)]);
    const rows: ReferredFile[] = [];
    for (const r of read.rows) {
      if (!(await shown(r.caseFile.id))) continue;
      rows.push({
        caseFileId: r.caseFile.id,
        number: { number: r.caseFile.number, code: r.caseFile.code, year: r.caseFile.year },
        article: r.article,
        item: r.item,
        reasonCode: r.reasonCode,
        referredAt: r.createdAt,
        conclusionsOpen: r.conclusionsOpen,
      });
    }
    return withRows(read, rows);
  };

  return { principalParty: await ground('PRINCIPAL_PARTY', pages.principal), communication: await ground('COMMUNICATION', pages.communication) };
}
