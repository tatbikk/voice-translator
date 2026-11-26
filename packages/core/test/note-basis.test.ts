// Review of the IR-12 fix (decision 74): «ملاحظة إلى القاضي» rests on art. 619
// only when its reason is a fee shortfall. The study ties the note to that
// article for the fee alone («وإذا رأى أن الرسم ناقص، رفع الأمر إلى القاضي المكلف
// ليوجه الإنذار المنصوص عليه في المادة 619»); every note is one of the three
// buttons of the registry's control of a registered file, which the table bases
// on art. 628 as it does «تأشير» and «تصحيح التصنيف» (open question 43). Written
// before the code.
import { describe, expect, it } from 'vitest';
import { ACTIONS, NOTE_REASONS, noteToJudgeBasis, resolveLegalBasis, type LegalBasis } from '../src/index';

const articles = (basis: LegalBasis) => (basis.kind === 'LAW' ? basis.articles : []);
const act = ACTIONS['case.registration.note-to-judge'];

describe('the basis of a note of the registry to the judge, by its reason (review of IR-12)', () => {
  it('knows the four reasons of the note', () => {
    expect([...NOTE_REASONS]).toEqual(['FEE_SHORTFALL', 'CLASSIFICATION', 'PARTIES', 'OTHER']);
  });

  it('declares the act on the registry’s control of the registered file, without art. 619', () => {
    expect(act?.procedure?.articles).toEqual([628]);
    expect(articles(resolveLegalBasis(act!))).not.toContain(619);
  });

  it('adds art. 619 to the act’s basis for a fee shortfall, and for it alone', () => {
    expect(noteToJudgeBasis('FEE_SHORTFALL')).toEqual({ kind: 'LAW', law: '58.25', articles: [619, 628] });
    for (const reason of NOTE_REASONS.filter((r) => r !== 'FEE_SHORTFALL')) {
      expect(noteToJudgeBasis(reason), reason).toEqual(resolveLegalBasis(act!));
      expect(articles(noteToJudgeBasis(reason)), reason).not.toContain(619);
    }
  });
});
