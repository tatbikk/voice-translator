import 'server-only';
import { authorize, availableActions, resolveLegalBasis, type AuthorizationContext, type LegalBasis, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { caseSnapshot } from '../cases/snapshot';

// «مكتب التقييد» (study, «واجهة كتابة الضبط»): the files registered at the
// clerk's court that the office has not stamped yet, newest first, each with
// its case card and the buttons the core grants on it (three, and none to
// reject the application).

export interface IncomingFile {
  readonly caseFileId: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly nationalRef: string;
  readonly caseType: string | null;
  readonly channel: 'ELECTRONIC' | 'PAPER' | null;
  readonly registeredAt: Date | null;
  readonly parties: readonly { readonly side: string; readonly name: string }[];
  readonly claims: readonly { readonly nature: string; readonly amountCents: bigint | null }[];
  readonly feePaidCents: bigint;
  readonly feeAssessedCents: bigint | null;
  readonly actions: readonly { readonly code: string; readonly labelKey: string; readonly effectKey: string; readonly notifiedKey: string; readonly basis: LegalBasis }[];
}

const LIMIT = 30;

export async function incomingFiles(subject: UserSubject, context: AuthorizationContext): Promise<IncomingFile[]> {
  if (!authorize(subject, 'registry.incoming.list', undefined, context).allowed || !subject.courtId) return [];
  const files = await getDb().caseFile.findMany({
    where: { courtId: subject.courtId, status: 'REGISTERED', registrationStampedAt: null },
    orderBy: [{ registeredAt: 'desc' }, { number: 'desc' }],
    take: LIMIT,
    select: {
      id: true,
      number: true,
      code: true,
      year: true,
      nationalRef: true,
      caseType: true,
      filingChannel: true,
      registeredAt: true,
      parties: { orderBy: { position: 'asc' }, select: { side: true, displayName: true } },
      claims: { orderBy: { filedAt: 'asc' }, select: { nature: true, amountCents: true } },
      payments: { where: { status: 'SUCCEEDED' }, select: { amountCents: true } },
      fees: { orderBy: { assessedAt: 'desc' }, take: 1, select: { totalCents: true } },
    },
  });
  const now = context.now ?? null;
  const out: IncomingFile[] = [];
  for (const f of files) {
    const snapshot = now ? await caseSnapshot(f.id, now) : null;
    if (!snapshot) continue;
    const resource = { kind: 'case' as const, snapshot };
    const actions = availableActions(subject, resource, context)
      .filter((rule) => rule.procedure !== undefined)
      .map((rule) => ({ code: rule.code, labelKey: rule.labelKey, effectKey: rule.effectKey, notifiedKey: rule.notifiedKey, basis: resolveLegalBasis(rule, resource) }));
    out.push({
      caseFileId: f.id,
      number: { number: f.number, code: f.code, year: f.year },
      nationalRef: f.nationalRef,
      caseType: f.caseType,
      channel: f.filingChannel,
      registeredAt: f.registeredAt,
      parties: f.parties.map((p) => ({ side: p.side, name: p.displayName })),
      claims: f.claims.map((c) => ({ nature: c.nature, amountCents: c.amountCents })),
      feePaidCents: f.payments.reduce((sum, p) => sum + p.amountCents, 0n),
      feeAssessedCents: f.fees[0]?.totalCents ?? null,
      actions,
    });
  }
  return out;
}
