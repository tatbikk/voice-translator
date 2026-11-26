// The court fee engine (prompt, «النواة»; study, station 1; art. 619). The
// schedule is data (rules/fees.json): bands of rates on the total of the claims
// with a fixed amount and the way the bands apply to it, a minimum base, a
// pleading fee, the natures that do not enter the base, the fee of a claim
// without a fixed amount, and the appeal surcharge. Amounts are in centimes,
// rounded half up at each line. Whatever the references do not settle is marked
// uncertain in the table, and the mark goes with every line that rests on it.
import type { Dated } from './in-force';
import type { Setting } from './time-limits';

export type ClaimNature = 'DEBT' | 'DAMAGES' | 'LEGAL_INTEREST' | 'PROVISIONAL_ENFORCEMENT' | 'COSTS' | 'OTHER';
export type FilingKind = 'APPLICATION' | 'COUNTER_CLAIM' | 'APPEAL';

/**
 * The ways of applying the bands the engine knows. BAND_RATE_ON_WHOLE_BASE:
 * the rate (and the fixed surcharge) of the band the base falls in applies to
 * the whole base.
 */
export const FEE_METHODS = ['BAND_RATE_ON_WHOLE_BASE'] as const;
export type FeeMethod = (typeof FEE_METHODS)[number];

export interface FeeBand {
  /** upper bound of the base for this band, in centimes; null for the last band */
  readonly upToCents: number | null;
  /** rate of the band, in basis points (1% = 100) */
  readonly rateBasisPoints: number;
  readonly surchargeCents: number;
  readonly uncertain: boolean;
}

export interface FeeRuleSet extends Dated {
  readonly source: string;
  readonly schedule: {
    /**
     * How the bands apply to the base. A table loaded before this became a
     * setting does not have it: its bands are applied the one way the engine
     * knows, and the way itself adds no mark.
     */
    readonly method?: Setting<FeeMethod>;
    readonly bands: readonly FeeBand[];
    readonly minimumBase: Setting<number>;
    readonly pleadingFee: Setting<number>;
    /** natures that never enter the base (legal interest, provisional enforcement, costs) */
    readonly outsideBase: readonly ClaimNature[];
    /**
     * The fee, in centimes, of each claim without a fixed amount whose nature is
     * not outside the base: it has a line of its own in the assessment. A table
     * loaded before this became a setting does not have it: such a claim is
     * then only listed among those left out of the base.
     */
    readonly unvaluedClaimFee?: Setting<number>;
    readonly appealSurcharge: Setting<number>;
  };
}

export interface FeeLine {
  readonly kind: 'PROPORTIONAL' | 'SURCHARGE' | 'APPEAL_SURCHARGE' | 'UNVALUED_CLAIM' | 'PLEADING';
  readonly amountCents: number;
  /** the base and the rate, for display */
  readonly baseCents: number | null;
  readonly rateBasisPoints: number | null;
  /** i18n key of the line's basis */
  readonly basis: string;
  /** the claim an UNVALUED_CLAIM line is for; null on the other lines */
  readonly claimNature: ClaimNature | null;
  /** the line rests on a value or a rule the table marks uncertain */
  readonly uncertain: boolean;
}

export interface FeeAssessment {
  readonly baseCents: number;
  readonly totalCents: number;
  readonly lines: readonly FeeLine[];
  /** the claims that do not enter the base and have no line of their own */
  readonly excluded: readonly ClaimNature[];
}

const roundHalfUp = (value: number) => Math.floor(value + 0.5);

type Proportional = (baseCents: number, bands: readonly FeeBand[]) => { readonly band: FeeBand; readonly amountCents: number };

/** What the bands yield for a base, each way the table may name. */
const PROPORTIONAL: Readonly<Record<FeeMethod, Proportional>> = {
  BAND_RATE_ON_WHOLE_BASE(baseCents, bands) {
    const band = bands.find((b) => b.upToCents === null || baseCents <= b.upToCents);
    if (!band) throw new Error('fee schedule: no band for the base');
    return { band, amountCents: roundHalfUp((baseCents * band.rateBasisPoints) / 10_000) };
  },
};

function proportionalBy(method: Setting<FeeMethod> | undefined): Proportional {
  // A table without the setting was loaded when the engine knew one way only.
  if (!method) return PROPORTIONAL.BAND_RATE_ON_WHOLE_BASE;
  const known = (PROPORTIONAL as Partial<Record<string, Proportional>>)[method.value];
  if (!known) throw new Error(`fee schedule: unknown method ${method.value}`);
  return known;
}

export function assessCourtFee(input: {
  readonly claims: readonly { nature: ClaimNature; amountCents: number | null }[];
  readonly filing: FilingKind;
  readonly schedule: FeeRuleSet;
}): FeeAssessment {
  const { schedule } = input.schedule;
  const { method, unvaluedClaimFee } = schedule;
  const proportional = proportionalBy(method);

  const excluded: ClaimNature[] = [];
  const unvalued: ClaimNature[] = [];
  let baseCents = 0;
  for (const claim of input.claims) {
    if (schedule.outsideBase.includes(claim.nature)) excluded.push(claim.nature);
    else if (claim.amountCents !== null) baseCents += claim.amountCents;
    else if (unvaluedClaimFee) unvalued.push(claim.nature);
    else excluded.push(claim.nature);
  }

  const lines: FeeLine[] = [];
  if (baseCents > 0) {
    const effectiveBase = Math.max(baseCents, schedule.minimumBase.value);
    const { band, amountCents } = proportional(effectiveBase, schedule.bands);
    lines.push({
      kind: 'PROPORTIONAL',
      amountCents,
      baseCents: effectiveBase,
      rateBasisPoints: band.rateBasisPoints,
      basis: 'fees.basis.proportional',
      claimNature: null,
      uncertain: band.uncertain || (method?.uncertain ?? false) || (effectiveBase !== baseCents && schedule.minimumBase.uncertain),
    });
    if (band.surchargeCents > 0) {
      lines.push({
        kind: 'SURCHARGE',
        amountCents: band.surchargeCents,
        baseCents: null,
        rateBasisPoints: null,
        basis: 'fees.basis.surcharge',
        claimNature: null,
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
        claimNature: null,
        uncertain: schedule.appealSurcharge.uncertain,
      });
    }
  }
  if (unvaluedClaimFee) {
    for (const nature of unvalued) {
      lines.push({
        kind: 'UNVALUED_CLAIM',
        amountCents: unvaluedClaimFee.value,
        baseCents: null,
        rateBasisPoints: null,
        basis: 'fees.basis.unvaluedClaim',
        claimNature: nature,
        uncertain: unvaluedClaimFee.uncertain,
      });
    }
  }
  lines.push({
    kind: 'PLEADING',
    amountCents: schedule.pleadingFee.value,
    baseCents: null,
    rateBasisPoints: null,
    basis: 'fees.basis.pleading',
    claimNature: null,
    uncertain: schedule.pleadingFee.uncertain,
  });
  return { baseCents, totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0), lines, excluded };
}

/** Whether an amount rests on something the table marks uncertain: one of its lines does. */
export function feeAssessmentUncertain(assessment: Pick<FeeAssessment, 'lines'>): boolean {
  return assessment.lines.some((line) => line.uncertain);
}

/**
 * The same, read from an assessment as it was stored with a payment or a file:
 * the mark «قيمة مؤقتة غير مؤكدة» goes with the amount wherever it is shown,
 * from what was recorded when it was computed, not from the table in force on
 * the day it is shown. A record that does not say what the amount rests on
 * (no lines, or a line without its flag) is shown uncertain.
 */
export function storedFeeUncertain(breakdown: unknown): boolean {
  const lines: unknown = typeof breakdown === 'object' && breakdown !== null ? (breakdown as { lines?: unknown }).lines : undefined;
  if (!Array.isArray(lines) || lines.length === 0) return true;
  return lines.some((line: unknown) => {
    const flag = typeof line === 'object' && line !== null ? (line as { uncertain?: unknown }).uncertain : undefined;
    return typeof flag !== 'boolean' || flag;
  });
}
