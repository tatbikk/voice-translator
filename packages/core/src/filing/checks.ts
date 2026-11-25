// «مراقبة البيانات قبل التوقيع» (prompt, Phase 2; study, «مراقبة البيانات
// الإلزامية»): a deterministic script reviews the card against the list of
// art. 77, and recalls art. 605 and art. 35 while it is still time to act.
// These are warnings, not refusals: the law gives the sanction of a missing
// statement to the judge after notice (art. 77, seventh paragraph), not to the
// platform nor to the registry. What blocks the filing is only what it cannot
// do without: an application, the declared nature of each document (art. 631;
// study: «لا يكتمل الإيداع دونها»), the depositor's attestation of each section
// (study: «مطابق للمقال»), and, on paper, the record of each original. The fee
// is checked by the authorization itself (decision 55; prompt: «لا يتم الإيداع
// بلا أداء»).
import { CARD_SECTIONS, type CardParty, type CardSection, type FilingCard } from './card';
import { principalValueCents, type CaseTypeRule, type JurisdictionRuleSet, type ReferralRuleSet, type Specialty } from './rules';

export const CHECK_CODES = [
  // blocking
  'APPLICATION_MISSING',
  'FIXED_COPY_NOT_READY',
  'EXHIBIT_NATURE_MISSING',
  'SECTION_NOT_ATTESTED',
  'PAPER_ORIGINAL_UNRECORDED',
  'PAPER_DEPOSITOR_MISSING',
  'CASE_TYPE_MISSING',
  'COURT_MISSING',
  'NO_PLAINTIFF',
  // warnings (art. 77)
  'NO_DEFENDANT',
  'PARTY_QUALITY_MISSING',
  'PARTY_ADDRESS_MISSING',
  'PLAINTIFF_ID_MISSING',
  'AGENT_ADDRESS_MISSING',
  'LEGAL_REPRESENTATIVE_MISSING',
  'LEGAL_FORM_MISSING',
  'REGISTER_ADDRESS_MISSING',
  'PARTY_EMAIL_MISSING',
  'SUMMARY_MISSING',
  'NO_CLAIM',
  'CLAIM_AMOUNT_MISSING',
  'FILER_DATA_MISSING',
  // warnings (art. 605, 35)
  'STATE_JUDICIAL_AGENT_MISSING',
  'LOCAL_AUTHORITIES_AGENT_MISSING',
  'COMMERCIAL_THRESHOLD_NOT_EXCEEDED',
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export interface FilingCheck {
  readonly code: CheckCode;
  readonly level: 'WARNING' | 'BLOCKING';
  readonly article: number | null;
  readonly section: CardSection | null;
  readonly partyKey: string | null;
  readonly documentId: string | null;
  /** the rule behind the check is uncertain (open question) */
  readonly uncertain: boolean;
}

export interface CheckDocument {
  readonly id: string;
  readonly kind: 'APPLICATION' | 'EXHIBIT';
  readonly declaredNature: string | null;
  readonly pageCount: number | null;
  readonly paperOriginalLocation: string | null;
}

export interface CheckInput {
  readonly channel: 'ELECTRONIC' | 'PAPER';
  readonly card: FilingCard;
  /** the sections whose attestation still matches their content */
  readonly attested: readonly CardSection[];
  readonly application: { readonly present: boolean; readonly fixedCopyReady: boolean };
  readonly documents: readonly CheckDocument[];
  /** the filing lawyer's statements from the account (art. 77), null on paper */
  readonly filer: { readonly professionalNumber: string | null; readonly professionalBody: string | null; readonly email: string | null } | null;
  readonly caseType: CaseTypeRule | null;
  readonly courtSpecialty: Specialty | null;
  readonly referrals: ReferralRuleSet;
  readonly jurisdiction: JurisdictionRuleSet;
  /** the person who deposits the paper application at the counter */
  readonly paperDepositor?: { readonly name: string } | null;
}

const check = (
  code: CheckCode,
  level: FilingCheck['level'],
  article: number | null,
  extra: Partial<Pick<FilingCheck, 'section' | 'partyKey' | 'documentId' | 'uncertain'>> = {},
): FilingCheck => ({ code, level, article, section: null, partyKey: null, documentId: null, uncertain: false, ...extra });

const blank = (value: string | undefined | null) => value === undefined || value === null || value.trim() === '';

function partyChecks(party: CardParty): FilingCheck[] {
  const out: FilingCheck[] = [];
  const at = { partyKey: party.key };
  if (blank(party.quality)) out.push(check('PARTY_QUALITY_MISSING', 'WARNING', 77, at));
  const address =
    party.personKind === 'NATURAL' ? party.domicile ?? party.residence : party.registeredOffice ?? party.branch ?? party.domicile;
  if (!address) out.push(check('PARTY_ADDRESS_MISSING', 'WARNING', 77, at));
  if (party.side === 'PLAINTIFF' && party.personKind !== 'PUBLIC' && blank(party.idNumber)) out.push(check('PLAINTIFF_ID_MISSING', 'WARNING', 77, at));
  if (party.agent && blank(party.agent.address)) out.push(check('AGENT_ADDRESS_MISSING', 'WARNING', 77, at));
  if (party.personKind !== 'NATURAL') {
    // «إذا تعلق الأمر بشخص اعتباري، اسمه وممثله القانوني ونوعه ومقره الاجتماعي
    // أو مقر الفرع التابع له، وعنوانه المضمن في السجل التجاري وعنوان بريده الإلكتروني»
    if (blank(party.legalRepresentative)) out.push(check('LEGAL_REPRESENTATIVE_MISSING', 'WARNING', 77, at));
    if (party.personKind === 'LEGAL') {
      if (blank(party.legalForm)) out.push(check('LEGAL_FORM_MISSING', 'WARNING', 77, at));
      if (party.registeredOffice?.source !== 'COMMERCIAL_REGISTER') out.push(check('REGISTER_ADDRESS_MISSING', 'WARNING', 77, at));
    }
    if (blank(party.email)) out.push(check('PARTY_EMAIL_MISSING', 'WARNING', 77, at));
  }
  return out;
}

/** Art. 605: the judicial agent to bring in when the claims seek to declare a public debtor's debt. */
function judicialAgentChecks(input: CheckInput): FilingCheck[] {
  const { card, caseType, referrals } = input;
  const out: FilingCheck[] = [];
  const debtors = card.parties.filter((p) => p.side !== 'PLAINTIFF' && p.personKind === 'PUBLIC');
  // Only a public-law person is a judicial agent: a kind kept from another person counts for nothing.
  const present = new Set(card.parties.filter((p) => p.personKind === 'PUBLIC').map((p) => p.publicEntityKind).filter((k) => k !== undefined));
  for (const rule of referrals.judicialAgents) {
    if (caseType && rule.exemptFlags.some((flag) => caseType.flags.includes(flag))) continue;
    if (!debtors.some((p) => p.publicEntityKind !== undefined && rule.debtorKinds.includes(p.publicEntityKind))) continue;
    if (!card.claims.some((c) => rule.claimNatures.includes(c.nature))) continue;
    if (present.has(rule.agentKind)) continue;
    const code = rule.agentKind === 'STATE_JUDICIAL_AGENT' ? 'STATE_JUDICIAL_AGENT_MISSING' : 'LOCAL_AUTHORITIES_AGENT_MISSING';
    out.push(check(code, 'WARNING', rule.article, { uncertain: rule.uncertain }));
  }
  return out;
}

export function preSignatureChecks(input: CheckInput): FilingCheck[] {
  const { card, channel } = input;
  const out: FilingCheck[] = [];

  // What the filing cannot do without.
  if (!input.caseType) out.push(check('CASE_TYPE_MISSING', 'BLOCKING', null));
  if (!input.courtSpecialty) out.push(check('COURT_MISSING', 'BLOCKING', null));
  if (!input.application.present) out.push(check('APPLICATION_MISSING', 'BLOCKING', 76));
  else if (!input.application.fixedCopyReady) out.push(check('FIXED_COPY_NOT_READY', 'BLOCKING', 76));
  for (const doc of input.documents) {
    if (doc.kind === 'EXHIBIT' && blank(doc.declaredNature)) out.push(check('EXHIBIT_NATURE_MISSING', 'BLOCKING', 631, { documentId: doc.id }));
    if (channel === 'PAPER' && (doc.pageCount === null || blank(doc.paperOriginalLocation))) {
      out.push(check('PAPER_ORIGINAL_UNRECORDED', 'BLOCKING', 631, { documentId: doc.id }));
    }
  }
  if (channel === 'PAPER' && blank(input.paperDepositor?.name)) out.push(check('PAPER_DEPOSITOR_MISSING', 'BLOCKING', 76));
  if (!card.parties.some((p) => p.side === 'PLAINTIFF')) out.push(check('NO_PLAINTIFF', 'BLOCKING', 77));
  for (const section of CARD_SECTIONS) {
    if (!input.attested.includes(section)) out.push(check('SECTION_NOT_ATTESTED', 'BLOCKING', null, { section }));
  }

  // The statements of art. 77: warnings.
  if (!card.parties.some((p) => p.side !== 'PLAINTIFF')) out.push(check('NO_DEFENDANT', 'WARNING', 77));
  for (const party of card.parties) out.push(...partyChecks(party));
  if (blank(card.summary)) out.push(check('SUMMARY_MISSING', 'WARNING', 77, { section: 'SUMMARY' }));
  if (card.claims.length === 0) out.push(check('NO_CLAIM', 'WARNING', 77, { section: 'CLAIMS' }));
  for (const claim of card.claims) {
    if ((claim.nature === 'DEBT' || claim.nature === 'DAMAGES') && claim.amountCents === null) {
      out.push(check('CLAIM_AMOUNT_MISSING', 'WARNING', 77, { section: 'CLAIMS' }));
    }
  }
  if (channel === 'ELECTRONIC' && input.filer && (blank(input.filer.professionalNumber) || blank(input.filer.professionalBody) || blank(input.filer.email))) {
    out.push(check('FILER_DATA_MISSING', 'WARNING', 77));
  }

  // Art. 605 and art. 35: recalled while it is still time.
  out.push(...judicialAgentChecks(input));
  if (input.courtSpecialty === 'COMMERCIAL') {
    const principal = principalValueCents(card.claims, input.jurisdiction) ?? 0;
    if (principal <= input.jurisdiction.commercial.thresholdCents) out.push(check('COMMERCIAL_THRESHOLD_NOT_EXCEEDED', 'WARNING', 35));
  }
  return out;
}

/** True when nothing blocks the filing. */
export function filingReady(checks: readonly FilingCheck[]): boolean {
  return !checks.some((c) => c.level === 'BLOCKING');
}
