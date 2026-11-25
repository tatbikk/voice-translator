import 'server-only';
import { authorize, type AuthorizationContext, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';

// «الصندوق» (study, «واجهة كتابة الضبط»): the payments that came in at the
// cashier's court and their match with the fee of the claims, and apart the
// sums deposited for measures of investigation (art. 119).

export interface LedgerPayment {
  readonly id: string;
  readonly paidAt: Date;
  readonly amountCents: bigint;
  readonly method: 'ONLINE' | 'COUNTER' | null;
  readonly status: string;
  readonly operationRef: string;
  readonly purpose: string;
  readonly caseFile: { readonly id: string; readonly number: number; readonly code: number; readonly year: number } | null;
  /** the fee computed for the claims the payment covers; null when none was recorded */
  readonly assessedCents: bigint | null;
}

export interface Ledger {
  readonly payments: readonly LedgerPayment[];
  readonly deposits: readonly LedgerPayment[];
}

const LIMIT = 100;

export async function cashierLedger(subject: UserSubject, context: AuthorizationContext): Promise<Ledger> {
  if (!authorize(subject, 'cashier.ledger.view', undefined, context).allowed || !subject.courtId) return { payments: [], deposits: [] };
  const rows = await getDb().payment.findMany({
    where: { OR: [{ courtId: subject.courtId }, { caseFile: { courtId: subject.courtId } }] },
    orderBy: { paidAt: 'desc' },
    take: LIMIT,
    select: {
      id: true,
      paidAt: true,
      amountCents: true,
      method: true,
      status: true,
      operationRef: true,
      purpose: true,
      draftId: true,
      caseFile: { select: { id: true, number: true, code: true, year: true } },
      intent: { select: { inputsDigest: true } },
    },
  });
  const draftIds = rows.map((r) => r.draftId).filter((id): id is string => id !== null);
  const fees = draftIds.length > 0 ? await getDb().feeAssessment.findMany({ where: { draftId: { in: draftIds } }, select: { draftId: true, inputsDigest: true, totalCents: true } }) : [];
  const assessed = (r: (typeof rows)[number]) =>
    fees.find((f) => f.draftId === r.draftId && f.inputsDigest === r.intent?.inputsDigest)?.totalCents ?? null;
  const view = (r: (typeof rows)[number]): LedgerPayment => ({
    id: r.id,
    paidAt: r.paidAt,
    amountCents: r.amountCents,
    method: r.method,
    status: r.status,
    operationRef: r.operationRef,
    purpose: r.purpose,
    caseFile: r.caseFile,
    assessedCents: assessed(r),
  });
  return {
    payments: rows.filter((r) => r.purpose === 'COURT_FEE').map(view),
    deposits: rows.filter((r) => r.purpose !== 'COURT_FEE').map(view),
  };
}
