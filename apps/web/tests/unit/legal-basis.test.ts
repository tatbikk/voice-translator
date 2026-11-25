// Review P1-L-38: the legal basis of an order names one article, two, or more,
// in the genitive that follows «بناء على»: «المادة»، «المادتين»، «المواد».
import { describe, expect, it } from 'vitest';
import { lawArticlesText } from '@/i18n/legal-basis';
import { translator } from '@/i18n/translate';

const t = translator('ar');
const LAW = 'من القانون رقم 58.25 المتعلق بالمسطرة المدنية';

describe('the articles an order rests on (review P1-L-38)', () => {
  it('names one article in the singular', () => {
    expect(lawArticlesText(t, [76])).toBe(`المادة 76 ${LAW}`);
  });

  it('names two articles in the dual', () => {
    expect(lawArticlesText(t, [76, 77])).toBe(`المادتين 76 و77 ${LAW}`);
  });

  it('names three articles or more in the plural, in the order given', () => {
    expect(lawArticlesText(t, [76, 77, 628])).toBe(`المواد 76 و77 و628 ${LAW}`);
    expect(lawArticlesText(t, [105, 119, 123, 124])).toBe(`المواد 105 و119 و123 و124 ${LAW}`);
  });

  it('refuses a basis without an article', () => {
    expect(() => lawArticlesText(t, [])).toThrow();
  });

  it('reads well after «بناء على» in the order template', () => {
    expect(`بناء على ${lawArticlesText(t, [86, 87])}`).toBe(`بناء على المادتين 86 و87 ${LAW}`);
  });
});
