// «ملاحظة إلى القاضي» of the registry office (station 2): its reasons, and the
// legal basis each rests on (review of the IR-12 fix, decision 74). Every note
// rests on its act's articles in the table (transitions.ts: the registry's
// control of the registered file, art. 628, as «تأشير» and «تصحيح التصنيف»). The
// study ties the note to art. 619 for a fee shortfall alone («وإذا رأى أن الرسم
// ناقص، رفع الأمر إلى القاضي المكلف ليوجه الإنذار المنصوص عليه في المادة 619»):
// that reason adds it. Neither the law nor the study names another article for
// the other reasons (open question 43).
import { ACTIONS, resolveLegalBasis } from '../actions';
import { lawArticles, type LegalBasis } from '../legal-basis';

export const NOTE_REASONS = ['FEE_SHORTFALL', 'CLASSIFICATION', 'PARTIES', 'OTHER'] as const;
export type NoteReason = (typeof NOTE_REASONS)[number];

/** The articles a reason adds to the note's own. */
const REASON_ARTICLES: Readonly<Record<NoteReason, readonly number[]>> = {
  FEE_SHORTFALL: [619],
  CLASSIFICATION: [],
  PARTIES: [],
  OTHER: [],
};

/** The legal basis of a note to the judge, by its reason, on the day given (the act's day). */
export function noteToJudgeBasis(reason: NoteReason, onDay?: string): LegalBasis {
  const rule = ACTIONS['case.registration.note-to-judge'];
  if (!rule) throw new Error('no action case.registration.note-to-judge');
  const own = resolveLegalBasis(rule, undefined, onDay);
  const added = REASON_ARTICLES[reason];
  if (own.kind !== 'LAW' || added.length === 0) return own;
  return lawArticles(...[...new Set([...own.articles, ...added])].sort((a, b) => a - b));
}
