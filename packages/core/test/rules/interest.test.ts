// Runs packages/core/rules-tests/interest.md against the liquidation engine.
import { describe, expect, it } from 'vitest';
import { liquidateDebt } from '../../src/index';
import { readRules, rows } from './md-tables';

const cents = (dirhams: string) => Math.round(Number(dirhams) * 100);

describe('debt liquidation in plain language', () => {
  for (const [caseText, principal = '', rate = '', from = '', to = '', damages = '', costs = '', paid = '', interest = '', total = ''] of rows(
    'interest.md',
    'حالات اختبار تصفية الدين',
  )) {
    it(caseText ?? '', () => {
      const result = liquidateDebt({
        principalCents: cents(principal),
        annualRateBasisPoints: Math.round(Number(rate.replace('%', '')) * 100),
        from,
        to,
        damagesCents: cents(damages),
        costsCents: cents(costs),
        paidCents: cents(paid),
      });
      expect((result.interestCents / 100).toFixed(2)).toBe(interest);
      expect((result.totalCents / 100).toFixed(2)).toBe(total);
    });
  }

  it('keeps the legal interest rate in the rule table, marked uncertain', () => {
    const sets = readRules<{ rate: { uncertain: boolean } }[]>('interest.json');
    for (const set of sets) expect(set.rate.uncertain).toBe(true);
  });
});
