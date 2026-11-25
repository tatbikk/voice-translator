// Review P1-S-10: every rule table of rules/*.json is checked against the
// schema of its kind before it is loaded, and the versions of one kind must not
// overlap. And review P1-A-18: a loaded version is never rewritten; the one
// change accepted is the end date of a version loaded open-ended.
import { describe, expect, it } from 'vitest';
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
