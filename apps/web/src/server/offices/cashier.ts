import 'server-only';
import { authorize, type AuthorizationContext, type UserSubject } from '@mahkama/core';
import { getDb } from '../db';
import { parseCard } from '../filings/drafts';
import { feeCalledFor } from './fees';

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
  /** the fee the claims call for, computed again from them on the day of the payment; null when it cannot be */
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
    // What the cashier keeps is what came in: a failed or cancelled attempt books nothing
    // in the cashier («لا يقيد في الصندوق شيء», audit G029); it stays on the draft and in the log.
    where: { status: 'SUCCEEDED', OR: [{ courtId: subject.courtId }, { caseFile: { courtId: subject.courtId } }] },
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
      caseFile: { select: { id: true, number: true, code: true, year: true, claims: { where: { category: 'PRINCIPAL' }, select: { nature: true, amountCents: true } } } },
      intent: { select: { draft: { select: { card: true } } } },
    },
  });
  // «مطابقتها للطلبات»: the fee the claims call for, from the file's claims once filed, from the draft's before.
  const called = await Promise.all(
    rows.map((r) =>
      r.purpose !== 'COURT_FEE'
        ? Promise.resolve(null)
        : feeCalledFor(r.caseFile ? r.caseFile.claims : r.intent ? parseCard(r.intent.draft.card).claims : [], r.paidAt),
    ),
  );
  const view = (r: (typeof rows)[number], index: number): LedgerPayment => ({
    id: r.id,
    paidAt: r.paidAt,
    amountCents: r.amountCents,
    method: r.method,
    status: r.status,
    operationRef: r.operationRef,
    purpose: r.purpose,
    caseFile: r.caseFile ? { id: r.caseFile.id, number: r.caseFile.number, code: r.caseFile.code, year: r.caseFile.year } : null,
    assessedCents: called[index] ?? null,
  });
  const all = rows.map(view);
  return {
    payments: all.filter((p) => p.purpose === 'COURT_FEE'),
    deposits: all.filter((p) => p.purpose !== 'COURT_FEE'),
  };
}
