// Runs packages/core/rules-tests/rule-selection.md against ruleInForce().
import { describe, expect, it } from 'vitest';
import { ruleInForce } from '../../src/index';
import { rows } from './md-tables';

const sets = rows('rule-selection.md', 'الجداول').map(([version = '', validFrom = '', validTo = '']) => ({
  version,
  validFrom,
  validTo: validTo === '—' ? null : validTo,
}));

describe('the rule in force on the day of the act', () => {
  for (const [caseText, date = '', expected] of rows('rule-selection.md', 'الحالات')) {
    it(caseText ?? '', () => {
      const found = ruleInForce(sets, date);
      expect(found?.version ?? 'لا قاعدة سارية').toBe(expected);
    });
  }
});
