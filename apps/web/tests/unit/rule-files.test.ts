// Review P1-S-10: every rule table of rules/*.json is checked against the
// schema of its kind before it is loaded, and the versions of one kind must not
// overlap. And review P1-A-18: a loaded version is never rewritten; the one
// change accepted is the end date of a version loaded open-ended.
import { describe, expect, it } from 'vitest';
import { PUBLIC_ENTITY_KINDS } from '@mahkama/core';
import { ruleContentSha256, ruleSourceFiles, type RuleKind } from '@/server/rules/store';
import { RULE_FILE_SCHEMAS, ruleFileProblems, storedVersionChange, type RuleFile } from '@/server/rules/validation';

const files = ruleSourceFiles();
const file = (kind: RuleKind) => {
  const found = files.find((f) => f.kind === kind);
  if (!found) throw new Error(`no ${kind} table`);
  return found;
};
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const withContent = (base: RuleFile, content: Record<string, unknown>): RuleFile => ({
  ...base,
  version: text(content.version, base.version),
  validFrom: text(content.validFrom, base.validFrom),
  validTo: (content.validTo as string | null | undefined) ?? null,
  content,
});
const contentOf = (kind: RuleKind) => structuredClone(file(kind).content) as Record<string, unknown>;

describe('the rule files of the repository', () => {
  it('has a schema for every kind it loads', () => {
    for (const f of files) expect(RULE_FILE_SCHEMAS[f.kind], f.kind).toBeDefined();
  });

  it('are all valid, and no two versions of one kind overlap', () => {
    expect(ruleFileProblems(files)).toEqual([]);
  });

  it('declare the horizon of the holiday list in force (review P1-A-08)', () => {
    const current = files.filter((f) => f.kind === 'HOLIDAYS' && f.validTo === null);
    expect(current).toHaveLength(1);
    const content = current[0]?.content as { coversUntil?: string; holidays: { date: string }[] };
    expect(content.coversUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(content.holidays.some((h) => h.date > (content.coversUntil ?? '')), 'no holiday listed past the horizon').toBe(false);
  });

  it('communicate to the prosecution every public-law person, whatever its category, in the referral table in force (independent review IR-01)', () => {
    const current = files.filter((f) => f.kind === 'REFERRALS' && f.validTo === null);
    expect(current).toHaveLength(1);
    const { communication } = (current[0]?.content as { prosecution: { communication: { article: number; anyPublicLawPerson?: number; publicEntityKinds: Record<string, number> } } }).prosecution;
    expect(communication.article).toBe(20);
    expect(communication.anyPublicLawPerson, 'art. 20, item 1, names any other public-law person').toBe(1);
    for (const kind of PUBLIC_ENTITY_KINDS) expect(communication.publicEntityKinds[kind], kind).toBe(1);
    // The version loaded before is closed the day its successor takes effect, never rewritten.
    const closed = files.filter((f) => f.kind === 'REFERRALS' && f.validTo !== null);
    expect(closed.map((f) => f.validTo)).toEqual([current[0]?.validFrom]);
  });

  it('mark uncertain the districts of the table in force, and name in its source the open question on the real districts (review of IR-08)', () => {
    const current = files.filter((f) => f.kind === 'DISTRICTS' && f.validTo === null);
    expect(current).toHaveLength(1);
    const content = current[0]?.content as { uncertain?: unknown; source: string; localities: string[]; districts: unknown[] };
    // The districts are assumed for the demo: whether an address lies within one, and the time to
    // appear computed from it (arts. 88 and 89), carry «قيمة مؤقتة غير مؤكدة» until س42 is answered.
    expect(content.uncertain).toBe(true);
    expect(content.source).toContain('س42');
    // The version loaded before is closed the day its successor takes effect, never rewritten; the
    // localities and the districts are the same.
    const closed = files.filter((f) => f.kind === 'DISTRICTS' && f.validTo !== null);
    expect(closed.map((f) => f.validTo)).toEqual([current[0]?.validFrom]);
    const before = closed[0]?.content as { localities: string[]; districts: unknown[] };
    expect([content.localities, content.districts]).toEqual([before.localities, before.districts]);
  });

  it('mark uncertain, in the fee table in force, every band, the way the bands apply and the fee of an unvalued claim (independent review IR-03, IR-04)', () => {
    const current = files.filter((f) => f.kind === 'FEES' && f.validTo === null);
    expect(current).toHaveLength(1);
    const { schedule } = current[0]?.content as {
      schedule: {
        bands: { uncertain: boolean }[];
        method?: { value: string; uncertain: boolean; articles: number[] };
        unvaluedClaimFee?: { value: number; uncertain: boolean; articles: number[] };
      };
    };
    expect(schedule.bands.map((band) => band.uncertain)).toEqual([true, true, true]);
    expect(schedule.method).toEqual({ value: 'BAND_RATE_ON_WHOLE_BASE', uncertain: true, articles: [619] });
    expect(schedule.unvaluedClaimFee).toEqual({ value: 0, uncertain: true, articles: [619] });
    // The version loaded before is closed the day its successor takes effect, never rewritten:
    // it keeps the two bands it presented as settled, and has neither setting.
    const closed = files.filter((f) => f.kind === 'FEES' && f.validTo !== null);
    expect(closed.map((f) => f.validTo)).toEqual([current[0]?.validFrom]);
    const before = (closed[0]?.content as { schedule: { bands: { uncertain: boolean }[]; method?: unknown; unvaluedClaimFee?: unknown } }).schedule;
    expect(before.bands.map((band) => band.uncertain)).toEqual([false, false, true]);
    expect(before.method).toBeUndefined();
    expect(before.unvaluedClaimFee).toBeUndefined();
  });

  it('mark uncertain, in the time-limit table in force, the deemed service after a refusal, and cite art. 602 for every limit counted in whole days (review of the fix of IR-19, IR-54)', () => {
    interface Rule {
      code: string;
      amount: number;
      unit: string;
      counting: string;
      startsFrom: string;
      effectOnExpiry: string;
      fixedByJudge?: boolean;
      articles: number[];
      uncertain?: boolean;
    }
    const current = files.filter((f) => f.kind === 'TIME_LIMITS' && f.validTo === null);
    expect(current).toHaveLength(1);
    const content = current[0]?.content as { source: string; settings: unknown; rules: Rule[] };
    const rule = (code: string) => content.rules.find((r) => r.code === code);
    // Whether the ten days of art. 85 are a limit that art. 602 extends is open (س46): the
    // engine's reading (the tenth day, never extended) stays, marked.
    expect(rule('DEEMED_SERVICE_AFTER_REFUSAL')).toMatchObject({ amount: 10, unit: 'DAYS', counting: 'CALENDAR', articles: [85], uncertain: true });
    expect(content.source).toContain('س46');
    // Art. 602 makes «جميع الآجال المنصوص عليها في هذا القانون كاملة»: the five days before the expertise (art. 127)
    // and the time to appear (art. 88 and 89) are counted so, and cite it.
    expect(rule('EXPERT_SUMMONS_NOTICE')?.articles).toEqual([127, 602]);
    expect(rule('APPEARANCE_IN_DISTRICT')?.articles).toEqual([88, 602]);
    expect(rule('APPEARANCE_IN_KINGDOM')?.articles).toEqual([88, 602]);
    expect(rule('APPEARANCE_ABROAD')?.articles).toEqual([89, 602]);
    // The version loaded before is closed the day its successor takes effect, never rewritten;
    // nothing but these marks and articles changes: the same settings, rules, amounts and countings.
    const closed = files.filter((f) => f.kind === 'TIME_LIMITS' && f.validTo !== null);
    expect(closed.map((f) => f.validTo)).toEqual([current[0]?.validFrom]);
    const before = closed[0]?.content as { settings: unknown; rules: Rule[] };
    expect(content.settings).toEqual(before.settings);
    const bare = (rules: Rule[]) => rules.map(({ articles: _articles, uncertain: _uncertain, ...rest }) => rest);
    expect(bare(content.rules)).toEqual(bare(before.rules));
    const changed = content.rules.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before.rules[i])).map((r) => r.code);
    expect(changed.sort()).toEqual(['APPEARANCE_ABROAD', 'APPEARANCE_IN_DISTRICT', 'APPEARANCE_IN_KINGDOM', 'DEEMED_SERVICE_AFTER_REFUSAL', 'EXPERT_SUMMONS_NOTICE']);
  });

  it('change no amount, in the fee table in force, of the version it replaces: a fee paid under the earlier one is the fee the later one calls for (finding P2-S-04)', () => {
    interface Schedule {
      bands: { upToCents: number | null; rateBasisPoints: number; surchargeCents: number }[];
      minimumBase: { value: number };
      pleadingFee: { value: number };
      outsideBase: string[];
      appealSurcharge: { value: number };
      unvaluedClaimFee?: { value: number };
    }
    const scheduleOf = (open: boolean) => (files.find((f) => f.kind === 'FEES' && (f.validTo === null) === open)?.content as { schedule: Schedule }).schedule;
    const amounts = (schedule: Schedule) => ({
      bands: schedule.bands.map((band) => [band.upToCents, band.rateBasisPoints, band.surchargeCents]),
      minimumBase: schedule.minimumBase.value,
      pleadingFee: schedule.pleadingFee.value,
      outsideBase: schedule.outsideBase,
      appealSurcharge: schedule.appealSurcharge.value,
    });
    expect(amounts(scheduleOf(true))).toEqual(amounts(scheduleOf(false)));
    // The one setting that adds a line adds nothing to the amount.
    expect(scheduleOf(true).unvaluedClaimFee?.value).toBe(0);
  });
});

describe('an invalid rule file is refused before loading (review P1-S-10)', () => {
  const cases: readonly [string, RuleKind, (c: Record<string, unknown>) => void][] = [
    ['a missing field', 'TIME_LIMITS', (c) => delete c.settings],
    ['an unknown field', 'FEES', (c) => (c.extra = true)],
    ['a day that does not exist', 'INTEREST', (c) => (c.validFrom = '2026-02-30')],
    ['a day written otherwise', 'HOLIDAYS', (c) => (c.validFrom = '23/08/2026')],
    ['an end before the start', 'FEES', (c) => (c.validTo = '2026-01-01')],
    ['an end equal to the start', 'INTEREST', (c) => (c.validTo = c.validFrom)],
    ['a rule without its article', 'TIME_LIMITS', (c) => ((c.rules as { articles: number[] }[])[0]!.articles = [])],
    ['a rule code twice', 'TIME_LIMITS', (c) => (c.rules as unknown[]).push((c.rules as unknown[])[0])],
    ['an unknown counting', 'TIME_LIMITS', (c) => ((c.rules as { counting: string }[])[0]!.counting = 'WEEKLY')],
    ['a holiday without its uncertainty', 'HOLIDAYS', (c) => delete (c.holidays as { uncertain?: boolean }[])[0]!.uncertain],
    ['a horizon before the start', 'HOLIDAYS', (c) => (c.coversUntil = '2020-01-01')],
    ['a last fee band with an upper bound', 'FEES', (c) => ((c.schedule as { bands: { upToCents: number | null }[] }).bands.at(-1)!.upToCents = 1)],
    ['a negative rate', 'INTEREST', (c) => ((c.rate as { value: number }).value = -1)],
    ['a way of applying the fee bands the engine does not know', 'FEES', (c) => ((c.schedule as Record<string, unknown>).method = { value: 'EACH_SLICE_AT_ITS_RATE', uncertain: true, articles: [619] })],
    ['a way of applying the fee bands without its uncertainty', 'FEES', (c) => ((c.schedule as Record<string, unknown>).method = { value: 'BAND_RATE_ON_WHOLE_BASE', articles: [619] })],
    ['a negative fee for an unvalued claim', 'FEES', (c) => ((c.schedule as Record<string, unknown>).unvaluedClaimFee = { value: -1, uncertain: true, articles: [619] })],
    // The reviewer of the IR-03 / IR-04 fix: the two settings may be absent from the version loaded
    // before they existed (2026-08-23.1) only; a later version without them would bring back the
    // rules of the code, unmarked. The first FEES file is that version, without either setting.
    ['a later version without the way of applying the bands or the fee of an unvalued claim', 'FEES', (c) => Object.assign(c, { version: '2027-01-01.1', validFrom: '2027-01-01', validTo: null })],
    [
      'a later version without the way of applying the bands',
      'FEES',
      (c) => Object.assign(c, { version: '2027-01-01.1', validFrom: '2027-01-01', validTo: null, schedule: { ...(c.schedule as object), unvaluedClaimFee: { value: 0, uncertain: true, articles: [619] } } }),
    ],
    [
      'a later version without the fee of an unvalued claim',
      'FEES',
      (c) => Object.assign(c, { version: '2027-01-01.1', validFrom: '2027-01-01', validTo: null, schedule: { ...(c.schedule as object), method: { value: 'BAND_RATE_ON_WHOLE_BASE', uncertain: true, articles: [619] } } }),
    ],
    ['an item art. 20 does not have', 'REFERRALS', (c) => ((c.prosecution as { communication: { anyPublicLawPerson?: number } }).communication.anyPublicLawPerson = 6)],
  ];
  for (const [what, kind, change] of cases) {
    it(`${kind} with ${what}`, () => {
      const content = contentOf(kind);
      change(content);
      const problems = ruleFileProblems([withContent(file(kind), content)]);
      expect(problems.length, JSON.stringify(problems)).toBeGreaterThan(0);
      expect(problems[0]?.kind).toBe(kind);
    });
  }

  it('names the paths and codes of the problems, never a value of the table', () => {
    const content = contentOf('INTEREST');
    content.source = 42;
    content.version = 'a-version-of-its-own';
    const problems = ruleFileProblems([withContent(file('INTEREST'), content)]);
    expect(problems).toEqual([{ kind: 'INTEREST', version: 'a-version-of-its-own', issues: ['source: invalid_type'] }]);
  });

  it('refuses a kind without a schema', () => {
    const problems = ruleFileProblems([{ ...file('FEES'), kind: 'NO_SUCH_KIND' as RuleKind }]);
    expect(problems[0]?.issues).toEqual(['(root): no schema for this kind']);
  });

  it('refuses two versions of one kind that overlap, and the same version twice', () => {
    const base = file('INTEREST');
    const later = withContent(base, { ...contentOf('INTEREST'), version: '2027-01-01.1', validFrom: '2027-01-01', validTo: null });
    expect(ruleFileProblems([base, later]).map((p) => p.issues[0])).toEqual([`validFrom: overlaps version ${base.version}`]);
    expect(ruleFileProblems([base, base]).map((p) => p.issues[0])).toEqual(['version: appears twice']);
  });

  it('accepts a version that starts the day the previous one ends', () => {
    const base = file('INTEREST');
    const closed = withContent(base, { ...contentOf('INTEREST'), validTo: '2027-01-01' });
    const later = withContent(base, { ...contentOf('INTEREST'), version: '2027-01-01.1', validFrom: '2027-01-01', validTo: null });
    expect(ruleFileProblems([closed, later])).toEqual([]);
  });
});

describe('a loaded version against the files (review P1-A-18)', () => {
  const open = contentOf('INTEREST');
  const stored = { contentSha256: ruleContentSha256(open), validTo: null };
  const fileOf = (content: Record<string, unknown>) => ({
    contentSha256: ruleContentSha256(content),
    validTo: (content.validTo as string | null | undefined) ?? null,
    content,
  });

  it('is left alone when nothing changed', () => {
    expect(storedVersionChange(stored, fileOf(open))).toBe('SAME');
  });

  it('is closed when the file gives it an end date and changes nothing else', () => {
    expect(storedVersionChange(stored, fileOf({ ...open, validTo: '2027-01-01' }))).toBe('CLOSING');
  });

  it('is refused when anything else changed, even with an end date', () => {
    expect(storedVersionChange(stored, fileOf({ ...open, source: `${String(open.source)} (2)` }))).toBe('CHANGED');
    expect(storedVersionChange(stored, fileOf({ ...open, validTo: '2027-01-01', rate: { value: 1, uncertain: true, articles: [] } }))).toBe('CHANGED');
  });

  it('is never reopened nor closed twice', () => {
    const closed = { ...open, validTo: '2027-01-01' };
    const storedClosed = { contentSha256: ruleContentSha256(closed), validTo: '2027-01-01' };
    expect(storedVersionChange(storedClosed, fileOf(open))).toBe('CHANGED');
    expect(storedVersionChange(storedClosed, fileOf({ ...open, validTo: '2027-06-01' }))).toBe('CHANGED');
  });
});
