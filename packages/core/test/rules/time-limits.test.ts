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
} from '../../src/index';
import { readRules, rows, yes } from './md-tables';

const FILE = 'time-limits.md';
const sets = readRules<TimeLimitRuleSet[]>('time-limits.json');
const calendar: HolidayCalendar = {
  dates: rows(FILE, 'العطل المعتمدة في هذه الحالات').map(([date]) => date ?? ''),
  weekendDays: [6, 0],
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
      const found = ruleAt(place === 'داخل الدائرة' ? 'APPEARANCE_IN_DISTRICT' : 'APPEARANCE_IN_KINGDOM', served);
      if (!found) throw new Error('no rule in force');
      expect(appearanceDelayRespected(served, hearing, found.rule)).toBe(yes(respected));
    });
  }

  it('gives every rule of the table its article, and marks unsettled settings as uncertain', () => {
    for (const set of sets) {
      for (const rule of set.rules) expect(rule.articles.length, rule.code).toBeGreaterThan(0);
      expect(set.settings.electronicCounting.uncertain).toBe(true);
      expect(set.settings.weekendIsHoliday.uncertain).toBe(true);
    }
  });
});
