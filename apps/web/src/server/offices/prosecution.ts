import 'server-only';
import { actionScope, authorize, viewScope, type AuthorizationContext, type CaseSnapshot, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';
import { scopesWhere } from '../cases/scope';
import { emptyPage, PAGE_SIZE, readPage, withRows, type Page } from '../lists/paging';

// «الإحالات» of the public prosecution (study, «واجهة النيابة العامة»): the
// files of its court referred to it on registration, by ground — those where it
// is a principal party (art. 18) and those communicated to it (art. 20). The
// query selects them by the referral, and by the states in which the core's
// table lets the prosecution file its conclusions (art. 21: until the debate is
// closed); each ground the referral received longest ago first, a page at a
// time with its total (independent review IR-11, decision 75). A referred file
// that left those states stays in «لائحة الملفات». Each row is the core's to
// show (case.view).

export interface ReferredFile {
  readonly caseFileId: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly article: number;
  readonly item: number | null;
  readonly reasonCode: string;
  readonly referredAt: Date;
}

export interface Referrals {
  readonly principalParty: Page<ReferredFile>;
  readonly communication: Page<ReferredFile>;
}

/** The act a referral awaits. */
const AWAITED = 'case.prosecution.conclusions';

export async function prosecutionReferrals(
  subject: UserSubject,
  context: AuthorizationContext,
  pages: { readonly principal: number; readonly communication: number } = { principal: 1, communication: 1 },
): Promise<Referrals | null> {
  if (!authorize(subject, 'prosecution.referrals.list', undefined, context).allowed || !subject.courtId) return null;
  const now = context.now;
  if (!now) return { principalParty: emptyPage(PAGE_SIZE.referrals), communication: emptyPage(PAGE_SIZE.referrals) };
  const db = getDb();
  const files = scopesWhere(subject, viewScope(subject), actionScope(subject, AWAITED));
  const snapshots = new Map<string, CaseSnapshot | null>();
  const shown = async (caseFileId: string) => {
    if (!snapshots.has(caseFileId)) snapshots.set(caseFileId, await caseSnapshot(caseFileId, now));
    const snapshot = snapshots.get(caseFileId);
    return snapshot ? authorize(subject, 'case.view', { kind: 'case', snapshot }, context).allowed : false;
  };

  const ground = async (name: 'PRINCIPAL_PARTY' | 'COMMUNICATION', page: number): Promise<Page<ReferredFile>> => {
    const where = { target: 'PROSECUTION' as const, ground: name, caseFile: files };
    const read = await readPage(PAGE_SIZE.referrals, page, () => db.caseReferral.count({ where }), (window) =>
      db.caseReferral.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...window,
        select: { article: true, item: true, reasonCode: true, createdAt: true, caseFile: { select: { id: true, number: true, code: true, year: true } } },
      }),
    );
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
      });
    }
    return withRows(read, rows);
  };

  return { principalParty: await ground('PRINCIPAL_PARTY', pages.principal), communication: await ground('COMMUNICATION', pages.communication) };
}
