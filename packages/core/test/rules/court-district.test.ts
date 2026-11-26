// Runs packages/core/rules-tests/court-district.md against the districts table
// (rules/districts.json): whether an address of a party lies within the district
// of the court the case is registered in (arts. 88 and 89; independent review IR-08).
import { describe, expect, it } from 'vitest';
import { addressWithinDistrict, ruleInForce, type DistrictRuleSet } from '../../src/index';
import { readRules, rows } from './md-tables';

const ON = '2026-11-26';
const districts = ruleInForce(readRules<DistrictRuleSet[]>('districts.json'), ON)!;

const COURT_CODES: Record<string, string> = {
  'المحكمة الابتدائية التجارية النموذجية': 'demo-fi-commercial',
  'محكمة الاستئناف التجارية النموذجية': 'demo-ap-commercial',
  'محكمة لا يذكرها الجدول': 'demo-fi-general',
};
const LOCALITIES: Record<string, string> = {
  'الدار البيضاء': 'casablanca',
  المحمدية: 'mohammedia',
  برشيد: 'berrechid',
  الرباط: 'rabat',
  // a well-formed code the table does not list
  طنجة: 'tangier',
};
const ANSWERS: Record<string, boolean | null> = { نعم: true, لا: false, 'غير معروف': null };

describe('an address within the district of the court, in plain language', () => {
  for (const [caseText = '', court = '', locality = '', country = '', expected = ''] of rows('court-district.md', 'حالات اختبار عنوان الطرف داخل دائرة نفوذ المحكمة')) {
    it(caseText, () => {
      const courtCode = COURT_CODES[court];
      expect(courtCode, court).toBeDefined();
      expect(expected in ANSWERS, expected).toBe(true);
      const answer = addressWithinDistrict({
        districts,
        courtCode: courtCode ?? '',
        address: { locality: locality === '—' ? null : (LOCALITIES[locality] ?? null), country: country === '—' ? null : country },
      });
      expect(answer).toBe(ANSWERS[expected]);
    });
  }

  it('reads the absent locality and country of a card address as unknown', () => {
    expect(addressWithinDistrict({ districts, courtCode: 'demo-fi-commercial', address: {} })).toBeNull();
  });

  it('knows every locality of a district among the localities the interface offers', () => {
    for (const district of districts.districts) {
      for (const locality of district.localities) expect(districts.localities).toContain(locality);
    }
  });
});
