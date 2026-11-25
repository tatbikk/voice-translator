// Runs packages/core/rules-tests/court-suggestion.md against the court
// suggestion (rules/districts.json, rules/jurisdiction.json, rules/case-types.json).
import { describe, expect, it } from 'vitest';
import { ruleInForce, suggestCourt, type CaseTypeRuleSet, type CourtRef, type DistrictRuleSet, type JurisdictionRuleSet } from '../../src/index';
import { readRules, rows, yes } from './md-tables';

const ON = '2026-11-25';
const districts = ruleInForce(readRules<DistrictRuleSet[]>('districts.json'), ON)!;
const jurisdiction = ruleInForce(readRules<JurisdictionRuleSet[]>('jurisdiction.json'), ON)!;
const caseTypes = ruleInForce(readRules<CaseTypeRuleSet[]>('case-types.json'), ON)!;

/** The two model courts of the demo (src/cli/seed-data/accounts.ts). */
const COURTS: readonly CourtRef[] = [
  { id: 'fi', code: 'demo-fi-commercial', specialty: 'COMMERCIAL', degree: 'FIRST_INSTANCE' },
  { id: 'ap', code: 'demo-ap-commercial', specialty: 'COMMERCIAL', degree: 'APPEAL' },
];
const COURT_NAMES: Record<string, string> = { fi: 'المحكمة الابتدائية التجارية النموذجية' };
const LOCALITIES: Record<string, string> = {
  'الدار البيضاء': 'casablanca',
  المحمدية: 'mohammedia',
  برشيد: 'berrechid',
  الرباط: 'rabat',
};

describe('court suggestion in plain language', () => {
  for (const [caseText, code = '', locality = '', amount = '', expectedCourt = '', exceeded = ''] of rows('court-suggestion.md', 'حالات اختبار اقتراح المحكمة')) {
    it(caseText, () => {
      const suggestion = suggestCourt({
        caseType: caseTypes.types.find((t) => t.code === code) ?? null,
        defendantLocality: LOCALITIES[locality] ?? null,
        principalCents: /^\d+$/.test(amount) ? Number(amount) * 100 : null,
        districts,
        courts: COURTS,
        jurisdiction,
      });
      expect(suggestion.courtId === null ? 'لا اقتراح' : COURT_NAMES[suggestion.courtId]).toBe(expectedCourt);
      if (exceeded === '—') expect(suggestion.thresholdExceeded).toBeNull();
      else expect(suggestion.thresholdExceeded).toBe(yes(exceeded));
      if (suggestion.courtId) expect(suggestion.articles).toContain(66);
    });
  }

  it('lists every locality of the districts table under a translatable code', () => {
    for (const district of districts.districts) {
      for (const locality of district.localities) expect(locality).toMatch(/^[a-z][a-z0-9-]{1,40}$/);
    }
  });
});
