import 'server-only';
import { z } from 'zod';
import type { FeeRuleSet, InterestRuleSet, TimeLimitRuleSet } from '@mahkama/core';
import { ruleContentSha256, type HolidayRuleSet, type RuleKind } from './store';

// The structure of each rule table of rules/*.json, checked before anything is
// loaded (review P1-S-10): a table that does not have the shape its engine
// reads, or whose versions overlap, stops the release. A new kind of table
// comes with its schema here (RULE_FILE_SCHEMAS is complete by type).

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = z
  .string()
  .regex(DAY)
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, 'not a calendar day');
const article = z.number().int().positive();
const keySuffix = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);
const ruleCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const setting = <T extends z.ZodType>(value: T) => z.strictObject({ value, uncertain: z.boolean(), articles: z.array(article) });

const dated = {
  version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$/),
  validFrom: day,
  validTo: day.nullable(),
  source: z.string().min(1),
};

const endsAfterStart = (set: { validFrom: string; validTo: string | null }) => set.validTo === null || set.validTo > set.validFrom;
const END_AFTER_START = { error: 'validTo must come after validFrom', path: ['validTo'] };

const timeLimitRule = z.strictObject({
  code: ruleCode,
  amount: z.number().int().min(0),
  unit: z.enum(['DAYS', 'MONTHS', 'YEARS', 'HOURS']),
  counting: z.enum(['FULL', 'CALENDAR', 'PLAIN_HOURS', 'WORKING_HOURS']),
  startsFrom: keySuffix,
  fixedByJudge: z.boolean().exactOptional(),
  effectOnExpiry: keySuffix,
  articles: z.array(article).min(1),
  uncertain: z.boolean().exactOptional(),
});

const timeLimits: z.ZodType<TimeLimitRuleSet> = z
  .strictObject({
    ...dated,
    settings: z.strictObject({
      electronicCounting: setting(z.enum(['CONTINUOUS_TO_END_OF_LAST_DAY', 'AS_PAPER'])),
      weekendIsHoliday: setting(z.boolean()),
    }),
    rules: z.array(timeLimitRule).min(1),
  })
  .refine(endsAfterStart, END_AFTER_START)
  .refine((set) => new Set(set.rules.map((r) => r.code)).size === set.rules.length, { error: 'a rule code appears twice', path: ['rules'] });

const cents = z.number().int().min(0);
const fees: z.ZodType<FeeRuleSet> = z
  .strictObject({
    ...dated,
    schedule: z.strictObject({
      bands: z
        .array(z.strictObject({ upToCents: cents.nullable(), rateBasisPoints: z.number().int().min(0), surchargeCents: cents, uncertain: z.boolean() }))
        .min(1),
      minimumBase: setting(cents),
      pleadingFee: setting(cents),
      outsideBase: z.array(z.enum(['DEBT', 'DAMAGES', 'LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS', 'OTHER'])),
      appealSurcharge: setting(cents),
    }),
  })
  .refine(endsAfterStart, END_AFTER_START)
  .refine((set) => set.schedule.bands.at(-1)?.upToCents === null, { error: 'the last band has no upper bound', path: ['schedule', 'bands'] });

const holidays: z.ZodType<HolidayRuleSet> = z
  .strictObject({
    ...dated,
    /** the last day the list is complete for; a table without it declares no horizon (review P1-A-08) */
    coversUntil: day.exactOptional(),
    holidays: z.array(z.strictObject({ date: day, name: z.string().min(1), uncertain: z.boolean() })),
  })
  .refine(endsAfterStart, END_AFTER_START)
  .refine((set) => set.coversUntil === undefined || set.coversUntil >= set.validFrom, { error: 'coversUntil precedes validFrom', path: ['coversUntil'] });

const interest: z.ZodType<InterestRuleSet> = z
  .strictObject({ ...dated, rate: setting(z.number().int().min(0)) })
  .refine(endsAfterStart, END_AFTER_START);

export const RULE_FILE_SCHEMAS: Readonly<Record<RuleKind, z.ZodType>> = {
  TIME_LIMITS: timeLimits,
  FEES: fees,
  HOLIDAYS: holidays,
  INTEREST: interest,
};

export interface RuleFile {
  readonly kind: RuleKind;
  readonly version: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly content: unknown;
}

export interface RuleFileProblem {
  readonly kind: string;
  readonly version: string;
  /** paths and codes only, never a value of the table */
  readonly issues: readonly string[];
}

const overlap = (a: RuleFile, b: RuleFile) => (a.validTo === null || b.validFrom < a.validTo) && (b.validTo === null || a.validFrom < b.validTo);

/** What is wrong with the rule files, or nothing: each against its schema, and the versions of each kind against each other. */
export function ruleFileProblems(files: readonly RuleFile[]): RuleFileProblem[] {
  const problems: RuleFileProblem[] = [];
  for (const file of files) {
    const schema = (RULE_FILE_SCHEMAS as Partial<Record<string, z.ZodType>>)[file.kind];
    if (!schema) {
      problems.push({ kind: file.kind, version: file.version, issues: ['(root): no schema for this kind'] });
      continue;
    }
    const parsed = schema.safeParse(file.content);
    if (!parsed.success) {
      problems.push({ kind: file.kind, version: file.version, issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`) });
    }
  }
  files.forEach((a, i) => {
    for (const b of files.slice(i + 1)) {
      if (a.kind !== b.kind) continue;
      if (a.version === b.version) problems.push({ kind: a.kind, version: a.version, issues: ['version: appears twice'] });
      else if (overlap(a, b)) problems.push({ kind: a.kind, version: b.version, issues: [`validFrom: overlaps version ${a.version}`] });
    }
  });
  return problems;
}

/**
 * How a version already loaded compares with the same version in the files.
 * SAME: nothing to do. CLOSING: the version was loaded open-ended and the file
 * now gives its end date, nothing else changed: the end date is recorded.
 * CHANGED: anything else; a loaded version is never rewritten.
 */
export function storedVersionChange(
  stored: { readonly contentSha256: string; readonly validTo: string | null },
  file: { readonly contentSha256: string; readonly validTo: string | null; readonly content: unknown },
): 'SAME' | 'CLOSING' | 'CHANGED' {
  if (stored.contentSha256 === file.contentSha256) return 'SAME';
  if (stored.validTo !== null || file.validTo === null) return 'CHANGED';
  const reopened = { ...(file.content as Record<string, unknown>), validTo: null };
  return ruleContentSha256(reopened) === stored.contentSha256 ? 'CLOSING' : 'CHANGED';
}
