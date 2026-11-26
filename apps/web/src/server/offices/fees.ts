import 'server-only';
import { assessCourtFee, CLAIM_NATURE_CODES, feeAssessmentUncertain } from '@mahkama/core';
import { feeSchedule } from '../rules/store';

// The fee the claims call for, computed again from the claims themselves with
// the schedule in force on the day of the payment (review P2-A-13): what the
// cashier's «مطابقة» and the registry's card compare a payment with, instead of
// a copy of the payment. It comes with its own mark: whether this computation
// rests on something the schedule marks uncertain (independent review IR-26).

export type ClaimLike = { readonly nature: string; readonly amountCents: bigint | number | null };

export interface CalledFee {
  readonly totalCents: bigint;
  readonly uncertain: boolean;
}

export async function feeCalledFor(claims: readonly ClaimLike[], at: Date): Promise<CalledFee | null> {
  const known = claims.filter((c): c is ClaimLike & { nature: (typeof CLAIM_NATURE_CODES)[number] } => (CLAIM_NATURE_CODES as readonly string[]).includes(c.nature));
  if (known.length === 0) return null;
  try {
    const schedule = await feeSchedule(at);
    const assessment = assessCourtFee({
      claims: known.map((c) => ({ nature: c.nature, amountCents: c.amountCents === null ? null : Number(c.amountCents) })),
      filing: 'APPLICATION',
      schedule,
    });
    return { totalCents: BigInt(assessment.totalCents), uncertain: feeAssessmentUncertain(assessment) };
  } catch {
    return null;
  }
}
