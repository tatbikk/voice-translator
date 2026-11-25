import 'server-only';
import { authorize, type AuthorizationContext, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';

// «الإحالات» of the public prosecution (study, «واجهة النيابة العامة»): the
// files of its court referred to it on registration, by ground — those where it
// is a principal party (art. 18) and those communicated to it (art. 20).

export interface ReferredFile {
  readonly caseFileId: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly article: number;
  readonly item: number | null;
  readonly reasonCode: string;
  readonly referredAt: Date;
}

export interface Referrals {
  readonly principalParty: readonly ReferredFile[];
  readonly communication: readonly ReferredFile[];
}

const LIMIT = 50;

export async function prosecutionReferrals(subject: UserSubject, context: AuthorizationContext): Promise<Referrals | null> {
  if (!authorize(subject, 'prosecution.referrals.list', undefined, context).allowed || !subject.courtId) return null;
  const rows = await getDb().caseReferral.findMany({
    where: { target: 'PROSECUTION', caseFile: { courtId: subject.courtId } },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
    select: { ground: true, article: true, item: true, reasonCode: true, createdAt: true, caseFile: { select: { id: true, number: true, code: true, year: true } } },
  });
  const view = (r: (typeof rows)[number]): ReferredFile => ({
    caseFileId: r.caseFile.id,
    number: { number: r.caseFile.number, code: r.caseFile.code, year: r.caseFile.year },
    article: r.article,
    item: r.item,
    reasonCode: r.reasonCode,
    referredAt: r.createdAt,
  });
  return {
    principalParty: rows.filter((r) => r.ground === 'PRINCIPAL_PARTY').map(view),
    communication: rows.filter((r) => r.ground === 'COMMUNICATION').map(view),
  };
}
