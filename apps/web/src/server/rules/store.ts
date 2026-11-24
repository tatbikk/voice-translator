import 'server-only';
import { createHash } from 'node:crypto';
import {
  moroccoDay,
  ruleInForce,
  type FeeRuleSet,
  type HolidayCalendar,
  type InterestRuleSet,
  type TimeLimitRuleSet,
} from '@mahkama/core';
import feesData from '../../../../../rules/fees.json';
import holidaysData from '../../../../../rules/holidays.json';
import interestData from '../../../../../rules/interest.json';
import timeLimitsData from '../../../../../rules/time-limits.json';
import { getDb } from '../db';

// The dated, sourced rule tables (prompt, rule 5: «القواعد القانونية معطيات لا
// كود»). Their content lives in rules/*.json, reviewed like any document; the
// release step loads each version into the RuleSet table (loadRuleTables), and
// the application reads them from there only, by the date of the act. The
// runtime role may read the table and never write it (src/cli/db-roles.ts).

export type RuleKind = 'TIME_LIMITS' | 'FEES' | 'HOLIDAYS' | 'INTEREST';

export interface HolidayRuleSet {
  readonly version: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly source: string;
  readonly holidays: readonly { date: string; name: string; uncertain: boolean }[];
}

const SOURCE_FILES: Readonly<Record<RuleKind, readonly { version: string; validFrom: string; validTo: string | null }[]>> = {
  TIME_LIMITS: timeLimitsData as unknown as TimeLimitRuleSet[],
  FEES: feesData as unknown as FeeRuleSet[],
  HOLIDAYS: holidaysData as unknown as HolidayRuleSet[],
  INTEREST: interestData as unknown as InterestRuleSet[],
};

const canonical = (value: unknown) => JSON.stringify(value);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The tables of rules/*.json with the hash of their canonical content (load-rules). */
export function ruleSourceFiles(): { kind: RuleKind; version: string; validFrom: string; validTo: string | null; contentSha256: string; content: unknown }[] {
  return (Object.entries(SOURCE_FILES) as [RuleKind, (typeof SOURCE_FILES)[RuleKind]][]).flatMap(([kind, sets]) =>
    sets.map((set) => ({
      kind,
      version: set.version,
      validFrom: set.validFrom,
      validTo: set.validTo,
      contentSha256: sha256(canonical(set)),
      content: set,
    })),
  );
}

// The tables are read from the database once per process: they change only
// with a release, which restarts the processes. An empty read is not kept.
let cache: Map<RuleKind, unknown[]> | null = null;

async function setsOf<T>(kind: RuleKind): Promise<T[]> {
  if (!cache) {
    const rows = await getDb().ruleSet.findMany({ select: { kind: true, content: true } });
    const sets = new Map<RuleKind, unknown[]>();
    for (const row of rows) {
      const list = sets.get(row.kind as RuleKind) ?? [];
      list.push(row.content);
      sets.set(row.kind as RuleKind, list);
    }
    if (rows.length > 0) cache = sets;
    return (sets.get(kind) ?? []) as T[];
  }
  return (cache.get(kind) ?? []) as T[];
}

export function forgetRuleCache(): void {
  cache = null;
}

export class NoRuleInForceError extends Error {
  constructor(readonly kind: RuleKind, readonly day: string) {
    super(`no ${kind} rule table in force on ${day}`);
    this.name = 'NoRuleInForceError';
  }
}

async function inForce<T extends { version: string; validFrom: string; validTo: string | null }>(kind: RuleKind, at: Date): Promise<T> {
  const day = moroccoDay(at);
  const set = ruleInForce(await setsOf<T>(kind), day);
  if (!set) throw new NoRuleInForceError(kind, day);
  return set;
}

export const timeLimitRules = (at: Date) => inForce<TimeLimitRuleSet>('TIME_LIMITS', at);
export const feeSchedule = (at: Date) => inForce<FeeRuleSet>('FEES', at);
export const interestRules = (at: Date) => inForce<InterestRuleSet>('INTEREST', at);

/** The calendar of holidays and days off in force on a day (art. 603). */
export async function holidayCalendar(at: Date): Promise<HolidayCalendar & { uncertainDates: readonly string[] }> {
  const holidays = await inForce<HolidayRuleSet>('HOLIDAYS', at);
  const limits = await timeLimitRules(at);
  return {
    dates: holidays.holidays.map((h) => h.date),
    uncertainDates: holidays.holidays.filter((h) => h.uncertain).map((h) => h.date),
    weekendDays: limits.settings.weekendIsHoliday.value ? [6, 0] : [],
  };
}
