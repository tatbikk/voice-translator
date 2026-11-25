import 'server-only';
import { assessCourtFee, CLAIM_NATURE_CODES } from '@mahkama/core';
import { feeSchedule } from '../rules/store';

// The fee the claims call for, computed again from the claims themselves with
// the schedule in force on the day of the payment (review P2-A-13): what the
// cashier's «مطابقة» and the registry's card compare a payment with, instead of
// a copy of the payment.

export type ClaimLike = { readonly nature: string; readonly amountCents: bigint | number | null };

export async function feeCalledFor(claims: readonly ClaimLike[], at: Date): Promise<bigint | null> {
  const known = claims.filter((c): c is ClaimLike & { nature: (typeof CLAIM_NATURE_CODES)[number] } => (CLAIM_NATURE_CODES as readonly string[]).includes(c.nature));
  if (known.length === 0) return null;
  try {
    const schedule = await feeSchedule(at);
    const assessment = assessCourtFee({
      claims: known.map((c) => ({ nature: c.nature, amountCents: c.amountCents === null ? null : Number(c.amountCents) })),
      filing: 'APPLICATION',
      schedule,
    });
    return BigInt(assessment.totalCents);
  } catch {
    return null;
  }
}

