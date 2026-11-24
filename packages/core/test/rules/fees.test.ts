// Runs packages/core/rules-tests/fees.md against the fee engine and rules/fees.json.
import { describe, expect, it } from 'vitest';
import { assessCourtFee, ruleInForce, type ClaimNature, type FeeRuleSet } from '../../src/index';
import { readRules, rows } from './md-tables';

const sets = readRules<FeeRuleSet[]>('fees.json');
const NATURES: Record<string, ClaimNature> = {
  دين: 'DEBT',
  تعويض: 'DAMAGES',
  'فوائد قانونية': 'LEGAL_INTEREST',
  'تنفيذ معجل': 'PROVISIONAL_ENFORCEMENT',
  مصاريف: 'COSTS',
};
const FILINGS = { مقال: 'APPLICATION', 'طلب مقابل': 'COUNTER_CLAIM', استئناف: 'APPEAL' } as const;

function parseClaims(cell: string) {
  return cell.split('؛').map((part) => {
    const text = part.trim();
    const match = /^(.*?)\s*(\d+)?$/.exec(text);
    const nature = NATURES[(match?.[1] ?? text).trim()];
    if (!nature) throw new Error(`unknown claim nature: ${text}`);
    return { nature, amountCents: match?.[2] ? Number(match[2]) * 100 : null };
  });
}

describe('court fee in plain language', () => {
  for (const [caseText, claims = '', filing = '', expected = ''] of rows('fees.md', 'حالات اختبار الرسم القضائي')) {
    it(caseText ?? '', () => {
      const set = ruleInForce(sets, '2027-03-15');
      if (!set) throw new Error('no fee table in force');
      const kind = FILINGS[filing as keyof typeof FILINGS];
      const result = assessCourtFee({ claims: parseClaims(claims), filing: kind, schedule: set });
      expect((result.totalCents / 100).toFixed(2)).toBe(expected);
      expect(result.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(result.totalCents);
      for (const line of result.lines) expect(line.basis, line.kind).toBeTruthy();
    });
  }

  it('marks the rates the study could not confirm as uncertain', () => {
    for (const set of sets) {
      expect(set.schedule.bands.at(-1)?.uncertain).toBe(true);
      expect(set.schedule.appealSurcharge.uncertain).toBe(true);
    }
  });
});
