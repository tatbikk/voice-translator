// Runs packages/core/rules-tests/fees.md against the fee engine and rules/fees.json,
// and holds the fee table to what the references settle (independent review
// IR-03, IR-04): every band, the way the bands apply and the fee of a claim
// without a fixed amount are settings of the table, marked uncertain, and the
// engine reads them from there.
import { describe, expect, it } from 'vitest';
import { assessCourtFee, feeAssessmentUncertain, ruleInForce, storedFeeUncertain, type ClaimNature, type FeeRuleSet } from '../../src/index';
import { readRules, rows, yes } from './md-tables';

const sets = readRules<FeeRuleSet[]>('fees.json');
const NATURES: Record<string, ClaimNature> = {
  دين: 'DEBT',
  تعويض: 'DAMAGES',
  'فوائد قانونية': 'LEGAL_INTEREST',
  'تنفيذ معجل': 'PROVISIONAL_ENFORCEMENT',
  مصاريف: 'COSTS',
  'طلب آخر': 'OTHER',
};
const FILINGS = { مقال: 'APPLICATION', 'طلب مقابل': 'COUNTER_CLAIM', استئناف: 'APPEAL' } as const;

/** A day the table of the plain-language cases is in force on, and a day of the version loaded before it. */
const DAY = '2027-03-15';
const DAY_BEFORE = '2026-10-01';

function tableOn(day: string): FeeRuleSet {
  const set = ruleInForce(sets, day);
  if (!set) throw new Error(`no fee table in force on ${day}`);
  return set;
}

function parseClaims(cell: string) {
  return cell.split('؛').map((part) => {
    const text = part.trim();
    const words = text.split(' ');
    const last = words.at(-1) ?? '';
    const amount = /^\d+$/.test(last) ? Number(last) : null;
    const name = (amount === null ? words : words.slice(0, -1)).join(' ');
    const nature = NATURES[name];
    if (!nature) throw new Error(`unknown claim nature: ${text}`);
    return { nature, amountCents: amount === null ? null : amount * 100 };
  });
}

const MODEL_CASE = parseClaims('دين 486000؛ تعويض 40000؛ فوائد قانونية؛ تنفيذ معجل؛ مصاريف');
const debt = (amountCents: number | null) => [{ nature: 'DEBT' as const, amountCents }];
const application = (claims: readonly { nature: ClaimNature; amountCents: number | null }[], schedule: FeeRuleSet = tableOn(DAY)) =>
  assessCourtFee({ claims, filing: 'APPLICATION', schedule });

/** The table in force with some of its schedule replaced, as a later version would. */
function withSchedule(change: (schedule: Record<string, unknown>) => void): FeeRuleSet {
  const copy = structuredClone(tableOn(DAY)) as unknown as { schedule: Record<string, unknown> };
  change(copy.schedule);
  return copy as unknown as FeeRuleSet;
}

describe('court fee in plain language', () => {
  for (const [caseText, claims = '', filing = '', expected = '', provisional] of rows('fees.md', 'حالات اختبار الرسم القضائي')) {
    it(caseText ?? '', () => {
      const kind = FILINGS[filing as keyof typeof FILINGS];
      const result = assessCourtFee({ claims: parseClaims(claims), filing: kind, schedule: tableOn(DAY) });
      expect((result.totalCents / 100).toFixed(2)).toBe(expected);
      expect(result.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(result.totalCents);
      for (const line of result.lines) expect(line.basis, line.kind).toBeTruthy();
      // The column «قيمة مؤقتة غير مؤكدة»: whether the amount rests on a line the table marks uncertain.
      expect(['نعم', 'لا']).toContain(provisional);
      expect(feeAssessmentUncertain(result), 'قيمة مؤقتة غير مؤكدة').toBe(yes(provisional));
    });
  }

  it('gives a case at each bound of the first two bands, and one for a debt and for another claim without amount', () => {
    const cases = rows('fees.md', 'حالات اختبار الرسم القضائي').map(([, claims = '']) => claims);
    for (const wanted of ['دين 1000', 'دين 5000', 'دين 5001', 'دين', 'طلب آخر', 'دين 0', 'طلب آخر 0']) expect(cases, wanted).toContain(wanted);
  });
});

describe('what the fee table leaves unsettled (independent review IR-03, IR-04)', () => {
  it('marks every band, the way the bands apply and the fee of an unvalued claim uncertain in the table in force', () => {
    const { schedule } = tableOn(DAY);
    expect(schedule.bands.map((band) => [band.upToCents, band.rateBasisPoints, band.uncertain])).toEqual([
      [500_000, 400, true],
      [2_000_000, 250, true],
      [null, 100, true],
    ]);
    expect(schedule.method).toMatchObject({ value: 'BAND_RATE_ON_WHOLE_BASE', uncertain: true });
    // No proportional fee for a claim without a fixed amount: a provisional result, kept as data.
    expect(schedule.unvaluedClaimFee).toMatchObject({ value: 0, uncertain: true });
    expect(schedule.minimumBase.uncertain).toBe(true);
    expect(schedule.appealSurcharge.uncertain).toBe(true);
    // What the study states outright stays unmarked.
    expect(schedule.pleadingFee).toMatchObject({ value: 1000, uncertain: false });
    expect(schedule.outsideBase).toEqual(['LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS']);
  });

  it('marks the rate above twenty thousand dirhams and the appeal surcharge uncertain in every version', () => {
    for (const set of sets) {
      expect(set.schedule.bands.at(-1)?.uncertain, set.version).toBe(true);
      expect(set.schedule.appealSurcharge.uncertain, set.version).toBe(true);
    }
  });

  it('asks less for 5.000,01 dirhams than for 5.000 dirhams, and marks both amounts (open question 40)', () => {
    const totals = [500_000, 500_001, 800_000].map((cents) => application(debt(cents)));
    expect(totals.map((assessment) => assessment.totalCents)).toEqual([21_000, 13_500, 21_000]);
    for (const assessment of totals) {
      expect(assessment.lines.find((line) => line.kind === 'PROPORTIONAL')?.uncertain).toBe(true);
      expect(feeAssessmentUncertain(assessment)).toBe(true);
    }
  });

  it('marks the proportional fee while the way the bands apply is unsettled, whatever the band says', () => {
    const settledBands = (schedule: Record<string, unknown>) => {
      schedule.bands = (schedule.bands as { uncertain: boolean }[]).map((band) => ({ ...band, uncertain: false }));
      schedule.minimumBase = { ...(schedule.minimumBase as object), uncertain: false };
    };
    const methodOnly = application(debt(400_000), withSchedule(settledBands));
    expect(methodOnly.lines.map((line) => [line.kind, line.uncertain])).toEqual([
      ['PROPORTIONAL', true],
      ['PLEADING', false],
    ]);
    const settled = application(
      debt(400_000),
      withSchedule((schedule) => {
        settledBands(schedule);
        schedule.method = { ...(schedule.method as object), uncertain: false };
      }),
    );
    expect(settled.totalCents).toBe(methodOnly.totalCents);
    expect(feeAssessmentUncertain(settled)).toBe(false);
  });

  it('refuses a way of applying the bands it does not know', () => {
    const unknown = withSchedule((schedule) => {
      schedule.method = { value: 'EACH_SLICE_AT_ITS_RATE', uncertain: true, articles: [619] };
    });
    expect(() => application(debt(400_000), unknown)).toThrow(/method/);
  });

  it('carries a line marked uncertain for each unvalued claim the table does not put outside the base', () => {
    const result = application([
      { nature: 'DEBT', amountCents: null },
      { nature: 'OTHER', amountCents: null },
      { nature: 'LEGAL_INTEREST', amountCents: null },
      { nature: 'COSTS', amountCents: null },
    ]);
    expect(result.lines.map((line) => [line.kind, line.claimNature, line.amountCents, line.uncertain])).toEqual([
      ['UNVALUED_CLAIM', 'DEBT', 0, true],
      ['UNVALUED_CLAIM', 'OTHER', 0, true],
      ['PLEADING', null, 1000, false],
    ]);
    for (const line of result.lines) expect(line.basis, line.kind).toBeTruthy();
    // Outside the base by rule: named as such, without a line of their own.
    expect(result.excluded).toEqual(['LEGAL_INTEREST', 'COSTS']);
    expect(result.baseCents).toBe(0);
    expect(result.totalCents).toBe(1000);
    expect(feeAssessmentUncertain(result)).toBe(true);
  });

  // The reviewer of the IR-03 / IR-04 fix: typing 0 was a way round the line and its mark.
  it('treats a claim whose amount is zero as a claim without a fixed amount: a marked line of its own, never a base of zero', () => {
    for (const nature of ['DEBT', 'DAMAGES', 'OTHER'] as const) {
      const zero = application([{ nature, amountCents: 0 }]);
      const empty = application([{ nature, amountCents: null }]);
      expect(zero.lines, nature).toEqual(empty.lines);
      expect(zero.lines.map((line) => [line.kind, line.claimNature, line.uncertain])).toEqual([
        ['UNVALUED_CLAIM', nature, true],
        ['PLEADING', null, false],
      ]);
      expect(zero.excluded).toEqual([]);
      expect(feeAssessmentUncertain(zero), nature).toBe(true);
    }
    // Beside a claim with a fixed amount, it adds nothing to the base and keeps its line.
    const beside = application([...debt(400_000), { nature: 'OTHER', amountCents: 0 }]);
    expect(beside.baseCents).toBe(400_000);
    expect(beside.lines.map((line) => [line.kind, line.claimNature])).toEqual([
      ['PROPORTIONAL', null],
      ['UNVALUED_CLAIM', 'OTHER'],
      ['PLEADING', null],
    ]);
    // Outside the base by rule, zero or not, it stays outside without a line.
    expect(application([{ nature: 'COSTS', amountCents: 0 }]).excluded).toEqual(['COSTS']);
  });

  it('marks the fixed surcharge and the appeal surcharge while the way the bands apply is unsettled, as it sets them too', () => {
    const settledExceptMethod = withSchedule((schedule) => {
      schedule.bands = (schedule.bands as { uncertain: boolean }[]).map((band) => ({ ...band, uncertain: false }));
      schedule.minimumBase = { ...(schedule.minimumBase as object), uncertain: false };
      schedule.appealSurcharge = { ...(schedule.appealSurcharge as object), uncertain: false };
    });
    const appeal = assessCourtFee({ claims: MODEL_CASE, filing: 'APPEAL', schedule: settledExceptMethod });
    expect(appeal.lines.map((line) => [line.kind, line.uncertain])).toEqual([
      ['PROPORTIONAL', true],
      ['SURCHARGE', true],
      ['APPEAL_SURCHARGE', true],
      ['PLEADING', false],
    ]);
    const settled = withSchedule((schedule) => {
      schedule.bands = (schedule.bands as { uncertain: boolean }[]).map((band) => ({ ...band, uncertain: false }));
      schedule.minimumBase = { ...(schedule.minimumBase as object), uncertain: false };
      schedule.appealSurcharge = { ...(schedule.appealSurcharge as object), uncertain: false };
      schedule.method = { ...(schedule.method as object), uncertain: false };
    });
    const settledAppeal = assessCourtFee({ claims: MODEL_CASE, filing: 'APPEAL', schedule: settled });
    expect(settledAppeal.totalCents).toBe(appeal.totalCents);
    expect(feeAssessmentUncertain(settledAppeal)).toBe(false);
    // The appeal surcharge is a rate on the lines above it: it carries their mark.
    const bandOnly = withSchedule((schedule) => {
      schedule.method = { ...(schedule.method as object), uncertain: false };
      schedule.appealSurcharge = { ...(schedule.appealSurcharge as object), uncertain: false };
    });
    const onUnsettledBand = assessCourtFee({ claims: MODEL_CASE, filing: 'APPEAL', schedule: bandOnly });
    expect(onUnsettledBand.lines.find((line) => line.kind === 'APPEAL_SURCHARGE')?.uncertain).toBe(true);
  });

  it('records by which way the bands were applied', () => {
    expect(application(debt(400_000)).method).toBe('BAND_RATE_ON_WHOLE_BASE');
    expect(application(debt(400_000), tableOn(DAY_BEFORE)).method).toBe('BAND_RATE_ON_WHOLE_BASE');
  });

  it('adds the line of an unvalued claim to the fee of the claims with a fixed amount', () => {
    const result = application([...debt(400_000), { nature: 'OTHER', amountCents: null }]);
    expect(result.lines.map((line) => line.kind)).toEqual(['PROPORTIONAL', 'UNVALUED_CLAIM', 'PLEADING']);
    expect(result.totalCents).toBe(17_000);
  });

  it('reads the fee of an unvalued claim, and whether it is settled, from the table', () => {
    const priced = withSchedule((schedule) => {
      schedule.unvaluedClaimFee = { value: 15_000, uncertain: false, articles: [619] };
    });
    const result = application([{ nature: 'OTHER', amountCents: null }], priced);
    expect(result.lines.map((line) => [line.kind, line.amountCents, line.uncertain])).toEqual([
      ['UNVALUED_CLAIM', 15_000, false],
      ['PLEADING', 1000, false],
    ]);
    expect(result.totalCents).toBe(16_000);
    expect(feeAssessmentUncertain(result)).toBe(false);
  });

  // Until the review of the IR-03 / IR-04 fix this test held that the version in force before was
  // applied with its own marks only (bands 1 and 2 unmarked, an unvalued claim without a line). What
  // it did not set (the way of the bands, the fee of an unvalued claim) was then a rule of the code,
  // and nothing settled it more for that version than for the next one (open questions 40 and 41).
  it('applies the version in force before with the same amounts, and marks what rests on the settings it did not have', () => {
    const before = tableOn(DAY_BEFORE);
    expect(before.version).not.toBe(tableOn(DAY).version);
    expect(before.validTo).toBe(tableOn(DAY).validFrom);
    // The settings its successor adds were not in it, and it presented the first two bands as settled.
    expect(before.schedule.method).toBeUndefined();
    expect(before.schedule.unvaluedClaimFee).toBeUndefined();
    expect(before.schedule.bands.map((band) => band.uncertain)).toEqual([false, false, true]);
    for (const cents of [100_000, 500_000, 500_001, 2_000_000, 2_000_100, 52_600_000]) {
      const assessment = application(debt(cents), before);
      expect(assessment.totalCents, String(cents)).toBe(application(debt(cents)).totalCents);
      expect(assessment.lines.find((line) => line.kind === 'PROPORTIONAL')?.uncertain, String(cents)).toBe(true);
    }
    for (const amountCents of [null, 0]) {
      const unvalued = application([{ nature: 'OTHER', amountCents }], before);
      expect(unvalued.lines.map((line) => [line.kind, line.claimNature, line.amountCents, line.uncertain])).toEqual([
        ['UNVALUED_CLAIM', 'OTHER', 0, true],
        ['PLEADING', null, 1000, false],
      ]);
      expect(unvalued.excluded).toEqual([]);
      expect(unvalued.totalCents).toBe(1000);
    }
  });

  it('keeps the fee of the model case at 5.570 dirhams under both versions', () => {
    expect(application(MODEL_CASE).totalCents).toBe(557_000);
    expect(application(MODEL_CASE, tableOn(DAY_BEFORE)).totalCents).toBe(557_000);
  });
});

describe('the uncertainty of an assessment as it was stored (independent review IR-26)', () => {
  it('is read from the lines kept with the amount', () => {
    const stored: unknown = JSON.parse(JSON.stringify({ version: tableOn(DAY).version, ...application(MODEL_CASE) }));
    expect(storedFeeUncertain(stored)).toBe(true);
    const outsideBase: unknown = JSON.parse(JSON.stringify(application([{ nature: 'PROVISIONAL_ENFORCEMENT', amountCents: null }])));
    expect(storedFeeUncertain(outsideBase)).toBe(false);
    const method = 'BAND_RATE_ON_WHOLE_BASE';
    expect(storedFeeUncertain({ totalCents: 1000, method, lines: [{ kind: 'PLEADING', amountCents: 1000, uncertain: false }] })).toBe(false);
    expect(storedFeeUncertain({ totalCents: 1000, method, lines: [{ kind: 'PLEADING', amountCents: 1000, uncertain: false }, { kind: 'UNVALUED_CLAIM', amountCents: 0, uncertain: true }] })).toBe(true);
  });

  it('is assumed when the record does not say what the amount rests on', () => {
    for (const unreadable of [null, undefined, {}, { totalCents: 557_000 }, { lines: 'none' }, { lines: [] }, { lines: [{ kind: 'PROPORTIONAL', amountCents: 1 }] }, 'text', 12]) {
      expect(storedFeeUncertain(unreadable), JSON.stringify(unreadable)).toBe(true);
    }
  });

  // The reviewer of the IR-03 / IR-04 fix: an amount assessed before 26 November 2026 kept the marks
  // of the first fee table, under which 5.000,01 dirhams (135 dirhams) carried none.
  it('is assumed for a record written before the assessment said by which way its bands were applied', () => {
    const before = {
      version: '2026-08-23.1',
      baseCents: 500_001,
      totalCents: 13_500,
      lines: [
        { kind: 'PROPORTIONAL', amountCents: 12_500, baseCents: 500_001, rateBasisPoints: 250, basis: 'fees.basis.proportional', uncertain: false },
        { kind: 'PLEADING', amountCents: 1000, baseCents: null, rateBasisPoints: null, basis: 'fees.basis.pleading', uncertain: false },
      ],
      excluded: [],
    };
    expect(storedFeeUncertain(before)).toBe(true);
    expect(storedFeeUncertain({ ...before, lines: [before.lines[1]], excluded: ['OTHER'] }), 'an unvalued claim without its line').toBe(true);
    // The same record, once it says how its bands were applied, is read from its lines.
    expect(storedFeeUncertain({ ...before, method: 'BAND_RATE_ON_WHOLE_BASE' })).toBe(false);
    expect(storedFeeUncertain({ ...before, method: 42 })).toBe(true);
  });
});
