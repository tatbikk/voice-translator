import 'server-only';
import { storedFeeUncertain } from '@mahkama/core';

// The mark «قيمة مؤقتة غير مؤكدة» of an amount that was paid (prompt, rule 5;
// independent review IR-26). One reading for every place the amount is shown
// (the page of the gateway, the cashier's ledger, the registry office card,
// the receipt page, the printed receipts): the assessment stored when the
// payment was opened, never a new computation with the table in force on the
// day of display.

export interface PaidAmount {
  readonly purpose: string;
  readonly amountCents: bigint;
  /** the payment as it was opened on the gateway, with the assessment it was opened for */
  readonly intent: { readonly breakdown: unknown } | null;
}

export interface StoredAssessment {
  readonly totalCents: bigint;
  readonly breakdown: unknown;
}

/**
 * Whether the amount of a payment rests on something the fee table marked
 * uncertain. Only a court fee comes from the fee engine: a sum fixed by a
 * decision carries no mark. A payment recorded without its opening (the demo
 * seed's) is read from the assessments kept on its file, by its amount; an
 * amount no stored assessment accounts for is shown uncertain.
 */
export function paidAmountUncertain(payment: PaidAmount, fileAssessments: readonly StoredAssessment[] = []): boolean {
  if (payment.purpose !== 'COURT_FEE') return false;
  if (payment.intent) return storedFeeUncertain(payment.intent.breakdown);
  const matching = fileAssessments.filter((assessment) => assessment.totalCents === payment.amountCents);
  return matching.length === 0 || matching.some((assessment) => storedFeeUncertain(assessment.breakdown));
}
