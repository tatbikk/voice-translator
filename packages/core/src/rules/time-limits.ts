// The time-limit engine (prompt, «النواة»; articles 602 to 604 and 639). Pure:
// the rule, the calendar and the instants are given; nothing is read here.
//
// Readings of the text, each tied to its article:
// - FULL counting (art. 602, first paragraph): neither the day of the act nor
//   the last day counts, so the act remains possible during the day after the
//   N-th day.
// - a last day that is a holiday extends to the first working day (art. 602,
//   second paragraph; holidays: art. 603).
// - an act done electronically: counted «بصورة مستمرة إلى غاية منتصف ليل اليوم
//   الأخير» (art. 602, third paragraph; art. 639). How this combines with the
//   two rules above is open (docs/open-questions.md, س1): the table setting
//   electronicCounting carries the reading in force, marked uncertain.
// - an outage on the last day extends the limit to the first day after the
//   platform resumed its service (art. 639).
// - the result carries what it relied on that is not settled (review P1-A-09):
//   the date stays the date computed, and is shown «قيمة مؤقتة غير مؤكدة».
//   A limit opened by a deemed service after a refusal (art. 85) carries what
//   that service relied on too: whether art. 602 extends its tenth day is open
//   (س46), and the table marks the rule uncertain.
import { addDays, addMonths, isHoliday, moroccoDay, moroccoLocal, startOfMoroccoDay, weekday, type HolidayCalendar } from './calendar';
import type { Dated } from './in-force';

export type TimeLimitUnit = 'DAYS' | 'MONTHS' | 'YEARS' | 'HOURS';
export type TimeLimitCounting =
  /** art. 602: whole days, first and last excluded, holiday extension */
  | 'FULL'
  /** a plain calendar count without extension (the tenth day after a refusal, art. 85) */
  | 'CALENDAR'
  /** hours, every hour counts */
  | 'PLAIN_HOURS'
  /** hours, holidays and days off excluded (art. 487) */
  | 'WORKING_HOURS';

export interface TimeLimitRule {
  readonly code: string;
  readonly amount: number;
  readonly unit: TimeLimitUnit;
  readonly counting: TimeLimitCounting;
  /** the event the limit starts from, as an i18n key suffix (deadlines.start.*) */
  readonly startsFrom: string;
  /** a limit whose end the judge sets (art. 6, 77, 124): amount and unit are unused */
  readonly fixedByJudge?: boolean;
  /** what its lapse entails, as an i18n key suffix (deadlines.effect.*) */
  readonly effectOnExpiry: string;
  readonly articles: readonly number[];
  readonly uncertain?: boolean;
}

export interface Setting<T> {
  readonly value: T;
  readonly uncertain: boolean;
  readonly articles: readonly number[];
}

export interface TimeLimitRuleSet extends Dated {
  readonly source: string;
  readonly settings: {
    readonly electronicCounting: Setting<'CONTINUOUS_TO_END_OF_LAST_DAY' | 'AS_PAPER'>;
    readonly weekendIsHoliday: Setting<boolean>;
  };
  readonly rules: readonly TimeLimitRule[];
}

export interface Outage {
  readonly from: Date;
  readonly to: Date;
}

export type TimeLimitStep =
  | { readonly kind: 'START'; readonly day: string }
  | { readonly kind: 'COUNT'; readonly day: string }
  | { readonly kind: 'LAST_DAY_EXCLUDED'; readonly day: string }
  | { readonly kind: 'ELECTRONIC_CONTINUOUS'; readonly day: string }
  | { readonly kind: 'FIXED_BY_JUDGE'; readonly day: string }
  | { readonly kind: 'HOLIDAY_EXTENSION'; readonly from: string; readonly to: string }
  | { readonly kind: 'OUTAGE_EXTENSION'; readonly from: string; readonly to: string }
  | { readonly kind: 'HOURS'; readonly hours: number; readonly workingOnly: boolean };

/** What a computed limit relied on that is not settled; any of them makes the result uncertain. */
export type TimeLimitUncertainty =
  /** the rule itself is marked uncertain in its table */
  | { readonly kind: 'RULE' }
  /** the limit starts from a deemed service whose rule is marked uncertain (art. 85, س46): that rule, not the limit's */
  | { readonly kind: 'DEEMED_SERVICE'; readonly rule: string }
  /** how art. 602 counts a limit for an act done electronically (س1) */
  | { readonly kind: 'ELECTRONIC_COUNTING' }
  /** Saturday and Sunday as days off (art. 603, س32) decided whether these days count */
  | { readonly kind: 'WEEKEND'; readonly days: readonly string[] }
  /** an estimated religious holiday (س33), or the day before or after one, was looked at */
  | { readonly kind: 'ESTIMATED_HOLIDAY'; readonly days: readonly string[] }
  /** days past the last day the holiday table covers were looked at (review P1-A-08) */
  | { readonly kind: 'BEYOND_CALENDAR'; readonly coversUntil: string | null; readonly days: readonly string[] };

export interface TimeLimitResult {
  readonly startsAt: Date;
  /** exclusive: the limit is open while now < endsAt */
  readonly endsAt: Date;
  /** the last day on which the act is possible (Morocco) */
  readonly lastDay: string;
  readonly steps: readonly TimeLimitStep[];
  readonly articles: readonly number[];
  /** empty when the result relies on nothing unsettled */
  readonly uncertainties: readonly TimeLimitUncertainty[];
}

export interface TimeLimitInput {
  readonly rule: TimeLimitRule;
  readonly settings: TimeLimitRuleSet['settings'];
  /** the event the limit starts from (in service: the established date of receipt) */
  readonly trigger: Date;
  readonly electronic: boolean;
  readonly calendar: HolidayCalendar;
  readonly outages?: readonly Outage[];
  /** the day the judge set, for a limit fixed by the judge */
  readonly fixedDate?: string;
  /** what the start itself relied on that is not settled: a deemed service after a refusal (art. 85, س46) */
  readonly startUncertainties?: readonly TimeLimitUncertainty[];
}

/**
 * The calendar as the engine reads it: the weekend counts only when the table
 * says so, and every day looked at is remembered, so that the result can say
 * what it relied on.
 */
interface CalendarReader {
  isHoliday(day: string): boolean;
  uncertainties(input: TimeLimitInput, electronicCountingUsed: boolean): TimeLimitUncertainty[];
}

/** An estimated holiday may be announced a day earlier or later: the days next to it are uncertain too. */
const ESTIMATE_MARGIN_DAYS = 1;

function calendarReader(calendar: HolidayCalendar, settings: TimeLimitRuleSet['settings']): CalendarReader {
  const effective: HolidayCalendar = settings.weekendIsHoliday.value ? calendar : { ...calendar, weekendDays: [] };
  const looked = new Set<string>();
  const near = new Set<string>();
  for (const estimated of calendar.uncertainDates) {
    for (let d = -ESTIMATE_MARGIN_DAYS; d <= ESTIMATE_MARGIN_DAYS; d += 1) near.add(addDays(estimated, d));
  }
  return {
    isHoliday(day) {
      looked.add(day);
      return isHoliday(effective, day);
    },
    uncertainties(input, electronicCountingUsed) {
      const days = [...looked].sort();
      const found: TimeLimitUncertainty[] = [...(input.startUncertainties ?? [])];
      if (input.rule.uncertain) found.push({ kind: 'RULE' });
      if (electronicCountingUsed && settings.electronicCounting.uncertain) found.push({ kind: 'ELECTRONIC_COUNTING' });
      const weekend = days.filter((d) => calendar.weekendDays.includes(weekday(d)) && !calendar.dates.includes(d));
      if (weekend.length > 0 && settings.weekendIsHoliday.uncertain) found.push({ kind: 'WEEKEND', days: weekend });
      const estimated = days.filter((d) => near.has(d));
      if (estimated.length > 0) found.push({ kind: 'ESTIMATED_HOLIDAY', days: estimated });
      const beyond = days.filter((d) => calendar.coversUntil === null || d > calendar.coversUntil);
      if (beyond.length > 0) found.push({ kind: 'BEYOND_CALENDAR', coversUntil: calendar.coversUntil, days: beyond });
      return found;
    },
  };
}

function extendPastHolidays(calendar: CalendarReader, day: string, steps: TimeLimitStep[]): string {
  let current = day;
  while (calendar.isHoliday(current)) current = addDays(current, 1);
  if (current !== day) steps.push({ kind: 'HOLIDAY_EXTENSION', from: day, to: current });
  return current;
}

function hoursLimit(input: TimeLimitInput, calendar: CalendarReader, steps: TimeLimitStep[]): Date {
  const { rule, trigger } = input;
  steps.push({ kind: 'HOURS', hours: rule.amount, workingOnly: rule.counting === 'WORKING_HOURS' });
  if (rule.counting !== 'WORKING_HOURS') return new Date(trigger.getTime() + rule.amount * 3_600_000);
  let remaining = rule.amount * 3_600_000;
  let cursor = trigger;
  for (let guard = 0; remaining > 0 && guard < 1000; guard += 1) {
    const day = moroccoDay(cursor);
    const next = startOfMoroccoDay(addDays(day, 1));
    if (calendar.isHoliday(day)) {
      cursor = next;
      continue;
    }
    const available = next.getTime() - cursor.getTime();
    if (available >= remaining) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = next;
  }
  return cursor;
}

export function computeTimeLimit(input: TimeLimitInput): TimeLimitResult {
  const { rule, settings, trigger, electronic } = input;
  const calendar = calendarReader(input.calendar, settings);
  const steps: TimeLimitStep[] = [];
  const startDay = moroccoDay(trigger);
  steps.push({ kind: 'START', day: startDay });

  if (rule.unit === 'HOURS' && !rule.fixedByJudge) {
    const endsAt = hoursLimit(input, calendar, steps);
    const local = moroccoLocal(endsAt);
    const lastDay = local.hour === 0 && local.minute === 0 && local.second === 0 ? addDays(moroccoDay(endsAt), -1) : moroccoDay(endsAt);
    return { startsAt: trigger, endsAt, lastDay, steps, articles: rule.articles, uncertainties: calendar.uncertainties(input, false) };
  }

  let lastDay: string;
  let electronicCountingUsed = false;
  if (rule.fixedByJudge) {
    if (!input.fixedDate) throw new Error(`time limit ${rule.code}: the judge's date is required`);
    steps.push({ kind: 'FIXED_BY_JUDGE', day: input.fixedDate });
    lastDay = extendPastHolidays(calendar, input.fixedDate, steps);
  } else {
    const counted =
      rule.unit === 'DAYS' ? addDays(startDay, rule.amount) : addMonths(startDay, rule.unit === 'MONTHS' ? rule.amount : rule.amount * 12);
    steps.push({ kind: 'COUNT', day: counted });
    const continuous = electronic && settings.electronicCounting.value === 'CONTINUOUS_TO_END_OF_LAST_DAY';
    electronicCountingUsed = electronic && rule.counting !== 'CALENDAR';
    if (rule.counting === 'CALENDAR') {
      lastDay = counted;
    } else if (continuous) {
      steps.push({ kind: 'ELECTRONIC_CONTINUOUS', day: counted });
      lastDay = counted;
    } else {
      const excluded = addDays(counted, 1);
      steps.push({ kind: 'LAST_DAY_EXCLUDED', day: excluded });
      lastDay = extendPastHolidays(calendar, excluded, steps);
    }
  }

  for (const outage of input.outages ?? []) {
    const dayStart = startOfMoroccoDay(lastDay).getTime();
    const dayEnd = startOfMoroccoDay(addDays(lastDay, 1)).getTime();
    if (outage.from.getTime() < dayEnd && outage.to.getTime() > dayStart) {
      const resumed = addDays(moroccoDay(outage.to), 1);
      if (resumed > lastDay) {
        steps.push({ kind: 'OUTAGE_EXTENSION', from: lastDay, to: resumed });
        lastDay = resumed;
      }
    }
  }

  return {
    startsAt: trigger,
    endsAt: startOfMoroccoDay(addDays(lastDay, 1)),
    lastDay,
    steps,
    articles: rule.articles,
    uncertainties: calendar.uncertainties(input, electronicCountingUsed),
  };
}

/**
 * The day a refused summons counts as duly delivered: the tenth day after the
 * refusal (art. 85), never extended (the table's reading, marked uncertain
 * while س46 is open). What it relies on goes to the limit it opens
 * (startUncertainties of computeTimeLimit).
 */
export function deemedServiceDate(refusalAt: Date, rule: TimeLimitRule): { day: string; at: Date; uncertainties: readonly TimeLimitUncertainty[] } {
  const day = addDays(moroccoDay(refusalAt), rule.amount);
  return { day, at: startOfMoroccoDay(day), uncertainties: rule.uncertain ? [{ kind: 'DEEMED_SERVICE', rule: rule.code }] : [] };
}

/**
 * Whether the time between service and hearing respects the appearance limit
 * (art. 88 and 89): at least `amount` whole days between the two days.
 */
export function appearanceDelayRespected(servedDay: string, hearingDay: string, rule: TimeLimitRule): boolean {
  const required = rule.unit === 'MONTHS' ? null : rule.amount;
  if (required === null) return addMonths(servedDay, rule.amount) < hearingDay;
  const between = Math.round((Date.parse(`${hearingDay}T00:00:00Z`) - Date.parse(`${servedDay}T00:00:00Z`)) / 86_400_000) - 1;
  return between >= required;
}
