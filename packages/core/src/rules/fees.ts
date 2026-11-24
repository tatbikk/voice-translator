// The court fee engine (prompt, «النواة»; study, station 1; art. 619). The
// schedule is data (rules/fees.json): bands of rates on the total of the claims
// with a fixed amount, a minimum base, a pleading fee, the natures that carry
// no fee or do not enter the base, and the appeal surcharge. Amounts are in
// centimes, rounded half up at each line.
import type { Dated } from './in-force';
import type { Setting } from './time-limits';

export type ClaimNature = 'DEBT' | 'DAMAGES' | 'LEGAL_INTEREST' | 'PROVISIONAL_ENFORCEMENT' | 'COSTS' | 'OTHER';
export type FilingKind = 'APPLICATION' | 'COUNTER_CLAIM' | 'APPEAL';

export interface FeeBand {
  /** upper bound of the base for this band, in centimes; null for the last band */
  readonly upToCents: number | null;
  /** rate applied to the whole base, in basis points (1% = 100) */
  readonly rateBasisPoints: number;
  readonly surchargeCents: number;
  readonly uncertain: boolean;
}

export interface FeeRuleSet extends Dated {
  readonly source: string;
  readonly schedule: {
    readonly bands: readonly FeeBand[];
    readonly minimumBase: Setting<number>;
    readonly pleadingFee: Setting<number>;
    /** natures that never enter the base (legal interest, provisional enforcement, costs) */
    readonly outsideBase: readonly ClaimNature[];
    readonly appealSurcharge: Setting<number>;
  };
}

export interface FeeLine {
  readonly kind: 'PROPORTIONAL' | 'SURCHARGE' | 'APPEAL_SURCHARGE' | 'PLEADING';
  readonly amountCents: number;
  /** the base and the rate, for display */
  readonly baseCents: number | null;
  readonly rateBasisPoints: number | null;
  /** i18n key of the line's basis */
  readonly basis: string;
  readonly uncertain: boolean;
}

export interface FeeAssessment {
  readonly baseCents: number;
  readonly totalCents: number;
  readonly lines: readonly FeeLine[];
  readonly excluded: readonly ClaimNature[];
}

const roundHalfUp = (value: number) => Math.floor(value + 0.5);

export function assessCourtFee(input: {
  readonly claims: readonly { nature: ClaimNature; amountCents: number | null }[];
  readonly filing: FilingKind;
  readonly schedule: FeeRuleSet;
}): FeeAssessment {
  const { schedule } = input.schedule;
  const excluded: ClaimNature[] = [];
  let baseCents = 0;
  for (const claim of input.claims) {
    if (schedule.outsideBase.includes(claim.nature) || claim.amountCents === null) {
      excluded.push(claim.nature);
      continue;
    }
    baseCents += claim.amountCents;
  }
  const lines: FeeLine[] = [];
  if (baseCents > 0) {
    const effectiveBase = Math.max(baseCents, schedule.minimumBase.value);
    const band = schedule.bands.find((b) => b.upToCents === null || effectiveBase <= b.upToCents);
    if (!band) throw new Error('fee schedule: no band for the base');
    lines.push({
      kind: 'PROPORTIONAL',
      amountCents: roundHalfUp((effectiveBase * band.rateBasisPoints) / 10_000),
      baseCents: effectiveBase,
      rateBasisPoints: band.rateBasisPoints,
      basis: 'fees.basis.proportional',
      uncertain: band.uncertain || (effectiveBase !== baseCents && schedule.minimumBase.uncertain),
    });
    if (band.surchargeCents > 0) {
      lines.push({
        kind: 'SURCHARGE',
        amountCents: band.surchargeCents,
        baseCents: null,
        rateBasisPoints: null,
        basis: 'fees.basis.surcharge',
        uncertain: band.uncertain,
      });
    }
    if (input.filing === 'APPEAL') {
      const subtotal = lines.reduce((sum, l) => sum + l.amountCents, 0);
      lines.push({
        kind: 'APPEAL_SURCHARGE',
        amountCents: roundHalfUp((subtotal * schedule.appealSurcharge.value) / 10_000),
        baseCents: subtotal,
        rateBasisPoints: schedule.appealSurcharge.value,
        basis: 'fees.basis.appealSurcharge',
        uncertain: schedule.appealSurcharge.uncertain,
      });
    }
  }
  lines.push({
    kind: 'PLEADING',
    amountCents: schedule.pleadingFee.value,
    baseCents: null,
    rateBasisPoints: null,
    basis: 'fees.basis.pleading',
    uncertain: schedule.pleadingFee.uncertain,
  });
  return { baseCents, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0), lines, excluded };
}
