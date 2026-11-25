// Runs packages/core/rules-tests/time-limits.md against the time-limit engine
// and the rule table in force (rules/time-limits.json).
import { describe, expect, it } from 'vitest';
import {
  appearanceDelayRespected,
  computeTimeLimit,
  deemedServiceDate,
  moroccoInstant,
  ruleInForce,
  type HolidayCalendar,
  type TimeLimitRuleSet,
  type TimeLimitUncertainty,
} from '../../src/index';
import { readRules, rows, tablesOf, yes } from './md-tables';

const FILE = 'time-limits.md';
const sets = readRules<TimeLimitRuleSet[]>('time-limits.json');
const calendar: HolidayCalendar = {
  dates: rows(FILE, 'العطل المعتمدة في هذه الحالات').map(([date]) => date ?? ''),
  weekendDays: [6, 0],
  uncertainDates: [],
  coversUntil: '2027-12-31',
};

function ruleAt(code: string, date: string) {
  const set = ruleInForce(sets, date);
  if (!set) return null;
  const rule = set.rules.find((r) => r.code === code);
  if (!rule) throw new Error(`no rule ${code} in ${set.version}`);
  return { set, rule };
}

describe('time limits in plain language', () => {
  for (const [caseText, code = '', date = '', electronic, expected] of rows(FILE, 'الآجال بالأيام والأشهر والسنوات')) {
    it(caseText ?? '', () => {
      const found = ruleAt(code, date);
      if (expected === 'لا قاعدة سارية') {
        expect(found).toBeNull();
        return;
      }
      if (!found) throw new Error('no rule in force');
      const result = computeTimeLimit({
        rule: found.rule,
        settings: found.set.settings,
        trigger: moroccoInstant(`${date} 10:00`),
        electronic: yes(electronic),
        calendar,
      });
      expect(result.lastDay).toBe(expected);
    });
  }

  for (const [caseText, code = '', date = '', expected] of rows(FILE, 'الآجال التي يحددها القاضي')) {
    it(caseText ?? '', () => {
      const found = ruleAt(code, '2027-03-15');
      if (!found) throw new Error('no rule in force');
      expect(found.rule.fixedByJudge).toBe(true);
      const result = computeTimeLimit({
        rule: found.rule,
        settings: found.set.settings,
        trigger: moroccoInstant('2027-03-15 10:00'),
        fixedDate: date,
        electronic: false,
        calendar,
      });
      expect(result.lastDay).toBe(expected);
    });
  }

  for (const [caseText, code = '', at = '', expected] of rows(FILE, 'الآجال بالساعات')) {
    it(caseText ?? '', () => {
      const found = ruleAt(code, at.slice(0, 10));
      if (!found) throw new Error('no rule in force');
      const result = computeTimeLimit({
        rule: found.rule,
        settings: found.set.settings,
        trigger: moroccoInstant(at),
        electronic: false,
        calendar,
      });
      expect(result.endsAt.getTime()).toBe(moroccoInstant(expected ?? '').getTime());
    });
  }

  for (const [caseText, refusal = '', deemed, code = '', expected] of rows(FILE, 'رفض التسلم')) {
    it(caseText ?? '', () => {
      const deemedRule = ruleAt('DEEMED_SERVICE_AFTER_REFUSAL', refusal);
      if (!deemedRule) throw new Error('no rule in force');
      const servedAt = deemedServiceDate(moroccoInstant(`${refusal} 10:00`), deemedRule.rule);
      expect(servedAt.day).toBe(deemed);
      const found = ruleAt(code, servedAt.day);
      if (!found) throw new Error('no rule in force');
      const result = computeTimeLimit({
        rule: found.rule,
        settings: found.set.settings,
        trigger: servedAt.at,
        electronic: false,
        calendar,
      });
      expect(result.lastDay).toBe(expected);
    });
  }

  for (const [caseText, code = '', date = '', from = '', to = '', expected] of rows(FILE, 'تعذر الولوج إلى المنصة')) {
    it(caseText ?? '', () => {
      const found = ruleAt(code, date);
      if (!found) throw new Error('no rule in force');
      const result = computeTimeLimit({
        rule: found.rule,
        settings: found.set.settings,
        trigger: moroccoInstant(`${date} 10:00`),
        electronic: true,
        calendar,
        outages: [{ from: moroccoInstant(from), to: moroccoInstant(to) }],
      });
      expect(result.lastDay).toBe(expected);
    });
  }

  for (const [caseText, served = '', hearing = '', place, respected] of rows(FILE, 'أجل الحضور')) {
    it(caseText ?? '', () => {
      const code = place === 'داخل الدائرة' ? 'APPEARANCE_IN_DISTRICT' : place === 'خارج المملكة' ? 'APPEARANCE_ABROAD' : 'APPEARANCE_IN_KINGDOM';
      const found = ruleAt(code, served);
      if (!found) throw new Error('no rule in force');
      expect(appearanceDelayRespected(served, hearing, found.rule)).toBe(yes(respected));
    });
  }

  // Review P1-A-08 and P1-A-09: what the result relied on that is not settled.
  const REASONS: Readonly<Record<string, TimeLimitUncertainty['kind'] | null>> = {
    'لا شيء': null,
    'السبت والأحد': 'WEEKEND',
    'عطلة تقديرية': 'ESTIMATED_HOLIDAY',
    'احتساب الأجل الإلكتروني': 'ELECTRONIC_COUNTING',
    'تجاوز أفق قائمة العطل': 'BEYOND_CALENDAR',
    'قاعدة غير مؤكدة': 'RULE',
  };
  const uncertainCalendar: HolidayCalendar = {
    dates: rows(FILE, 'العطل في حالات القيم المؤقتة').map(([date]) => date ?? ''),
    uncertainDates: rows(FILE, 'العطل في حالات القيم المؤقتة')
      .filter(([, , estimated]) => yes(estimated))
      .map(([date]) => date ?? ''),
    weekendDays: [6, 0],
    coversUntil: rows(FILE, 'أفق قائمة العطل في هذه الحالات')[0]?.[0] ?? null,
  };
  for (const [caseText, code = '', date = '', electronic, expected, flagged, reasons = ''] of rows(FILE, 'حالات القيم المؤقتة')) {
    it(caseText ?? '', () => {
      const found = ruleAt(code, date);
      if (!found) throw new Error('no rule in force');
      const result = computeTimeLimit({
        rule: found.rule,
        settings: found.set.settings,
        trigger: moroccoInstant(`${date} 10:00`),
        electronic: yes(electronic),
        calendar: uncertainCalendar,
      });
      expect(result.lastDay).toBe(expected);
      expect(result.uncertainties.length > 0).toBe(yes(flagged));
      const kinds = reasons.split('، ').map((r) => {
        if (!(r in REASONS)) throw new Error(`unknown reason «${r}»`);
        return REASONS[r];
      });
      expect(result.uncertainties.map((u) => u.kind).sort()).toEqual(kinds.filter((k) => k !== null).sort());
    });
  }

  it('marks every computation that looked past an undeclared horizon, and none within a declared one', () => {
    const found = ruleAt('FEE_OBJECTION', '2027-03-15');
    if (!found) throw new Error('no rule in force');
    const input = { rule: found.rule, settings: found.set.settings, trigger: moroccoInstant('2027-03-15 10:00'), electronic: false };
    expect(computeTimeLimit({ ...input, calendar: { ...uncertainCalendar, coversUntil: null } }).uncertainties).toEqual([
      { kind: 'BEYOND_CALENDAR', coversUntil: null, days: ['2027-03-26'] },
    ]);
    expect(computeTimeLimit({ ...input, calendar: uncertainCalendar }).uncertainties).toEqual([]);
  });

  it('marks a rule its table marks uncertain, and a weekend counted or not by an unsettled setting', () => {
    const found = ruleAt('APPEAL', '2027-03-03');
    if (!found) throw new Error('no rule in force');
    const input = { trigger: moroccoInstant('2027-03-03 10:00'), electronic: false, calendar: uncertainCalendar };
    const uncertainRule = computeTimeLimit({ ...input, rule: { ...found.rule, uncertain: true }, settings: found.set.settings });
    expect(uncertainRule.uncertainties.map((u) => u.kind)).toContain('RULE');
    // Saturday and Sunday not counted as days off: the last day is the Saturday, still uncertain.
    const noWeekend = { ...found.set.settings, weekendIsHoliday: { ...found.set.settings.weekendIsHoliday, value: false } };
    const result = computeTimeLimit({ ...input, rule: found.rule, settings: noWeekend });
    expect(result.lastDay).toBe('2027-04-03');
    expect(result.uncertainties).toEqual([{ kind: 'WEEKEND', days: ['2027-04-03'] }]);
    // A settled setting relies on nothing.
    const settled = { ...found.set.settings, weekendIsHoliday: { ...found.set.settings.weekendIsHoliday, uncertain: false } };
    expect(computeTimeLimit({ ...input, rule: found.rule, settings: settled }).uncertainties).toEqual([]);
  });

  it('gives every rule of the table in force at least one case in plain language (review P1-A-17)', () => {
    const covered = new Set<string>();
    for (const table of tablesOf(FILE).values()) for (const cells of table) for (const cell of cells) covered.add(cell);
    const refusal = rows(FILE, 'رفض التسلم');
    if (refusal.length > 0) covered.add('DEEMED_SERVICE_AFTER_REFUSAL');
    const places: Readonly<Record<string, string>> = { 'داخل الدائرة': 'APPEARANCE_IN_DISTRICT', 'خارج الدائرة': 'APPEARANCE_IN_KINGDOM', 'خارج المملكة': 'APPEARANCE_ABROAD' };
    for (const [, , , place = ''] of rows(FILE, 'أجل الحضور')) if (places[place]) covered.add(places[place]);
    for (const set of sets) {
      const missing = set.rules.map((r) => r.code).filter((c) => !covered.has(c));
      expect(missing, `rules of ${set.version} without a plain-language case`).toEqual([]);
    }
  });

  it('gives every rule of the table its article, and marks unsettled settings as uncertain', () => {
    for (const set of sets) {
      for (const rule of set.rules) expect(rule.articles.length, rule.code).toBeGreaterThan(0);
      expect(set.settings.electronicCounting.uncertain).toBe(true);
      expect(set.settings.weekendIsHoliday.uncertain).toBe(true);
    }
  });
});
