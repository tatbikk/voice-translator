// The interest and costs engine (prompt, «النواة»; study, stations 8 and 11):
// simple interest by days on a 365-day year, from the day it runs to the day of
// payment, plus damages and costs, less what was paid. The rate is data
// (rules/interest.json), uncertain until the administration confirms it.
import type { Dated } from './in-force';
import type { Setting } from './time-limits';

export interface InterestRuleSet extends Dated {
  readonly source: string;
  /** annual rate in basis points (1% = 100) */
  readonly rate: Setting<number>;
}

export interface Liquidation {
  readonly days: number;
  readonly interestCents: number;
  readonly totalCents: number;
  readonly lines: readonly { readonly kind: 'PRINCIPAL' | 'INTEREST' | 'DAMAGES' | 'COSTS' | 'PAID'; readonly amountCents: number }[];
}

export function liquidateDebt(input: {
  readonly principalCents: number;
  readonly annualRateBasisPoints: number;
  /** YYYY-MM-DD: the day interest starts to run */
  readonly from: string;
  /** YYYY-MM-DD: the day of payment */
  readonly to: string;
  readonly damagesCents: number;
  readonly costsCents: number;
  readonly paidCents: number;
}): Liquidation {
  const days = Math.max(0, Math.round((Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000));
  const interestCents = Math.floor((input.principalCents * input.annualRateBasisPoints * days) / (10_000 * 365) + 0.5);
  const totalCents = input.principalCents + interestCents + input.damagesCents + input.costsCents - input.paidCents;
  return {
    days,
    interestCents,
    totalCents,
    lines: [
      { kind: 'PRINCIPAL', amountCents: input.principalCents },
      { kind: 'INTEREST', amountCents: interestCents },
      { kind: 'DAMAGES', amountCents: input.damagesCents },
      { kind: 'COSTS', amountCents: input.costsCents },
      { kind: 'PAID', amountCents: -input.paidCents },
    ],
  };
}
