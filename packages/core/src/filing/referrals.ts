// The referrals the system makes of its own motion on registration (study,
// «المرحلة الثانية»; art. 18, 20, 101): a script applies the rules of
// rules/referrals.json and of rules/case-types.json to the file's structured
// data. Its answer, even empty, is recorded: «فيسجل النظام أنه راجعها ولم يجد
// موجبا للإحالة».
import type { CardParty } from './card';
import type { CaseTypeRule, ReferralRuleSet, Specialty } from './rules';

export interface Referral {
  readonly target: 'PROSECUTION' | 'ROYAL_COMMISSIONER';
  readonly ground: 'PRINCIPAL_PARTY' | 'COMMUNICATION' | 'ADMINISTRATIVE_COURT';
  readonly article: number;
  readonly item: number | null;
  /** what in the file triggered it */
  readonly reasonCode: 'CASE_TYPE' | 'PARTY_CAPACITY' | 'PUBLIC_PARTY' | 'ADMINISTRATIVE_COURT';
}

export interface ReferralInput {
  readonly courtSpecialty: Specialty;
  readonly caseType: CaseTypeRule | null;
  readonly parties: readonly Pick<CardParty, 'personKind' | 'publicEntityKind' | 'capacityStatus'>[];
  readonly rules: ReferralRuleSet;
}

export function referralsFor(input: ReferralInput): Referral[] {
  const found: Referral[] = [];
  const add = (referral: Referral) => {
    if (!found.some((r) => r.target === referral.target && r.ground === referral.ground)) found.push(referral);
  };
  const { prosecution, royalCommissioner } = input.rules;

  // Art. 18: the prosecution is a principal party.
  const typed = input.caseType?.prosecution;
  if (typed) add({ target: 'PROSECUTION', ground: 'PRINCIPAL_PARTY', article: typed.article, item: typed.item, reasonCode: 'CASE_TYPE' });
  for (const party of input.parties) {
    // A natural person's only: a field kept from another kind of person refers nothing (fix review M2).
    const item = party.personKind === 'NATURAL' && party.capacityStatus ? prosecution.principalParty.capacityStatuses[party.capacityStatus] : undefined;
    if (item !== undefined) add({ target: 'PROSECUTION', ground: 'PRINCIPAL_PARTY', article: prosecution.principalParty.article, item, reasonCode: 'PARTY_CAPACITY' });
  }

  // Art. 20, first case: cases concerning the State and the other public-law persons. The table
  // gives the item of each category, and the item of any public-law person whatever its category,
  // even none (independent review IR-01, decision 66); a category kept on another kind of person counts for nothing.
  const { publicEntityKinds, anyPublicLawPerson } = prosecution.communication;
  for (const party of input.parties) {
    if (party.personKind !== 'PUBLIC') continue;
    const item = (party.publicEntityKind ? publicEntityKinds[party.publicEntityKind] : undefined) ?? anyPublicLawPerson;
    if (item !== undefined) add({ target: 'PROSECUTION', ground: 'COMMUNICATION', article: prosecution.communication.article, item, reasonCode: 'PUBLIC_PARTY' });
  }

  // Art. 101: a copy of the application to the royal commissioner before administrative courts.
  if (royalCommissioner.specialties.includes(input.courtSpecialty)) {
    add({ target: 'ROYAL_COMMISSIONER', ground: 'ADMINISTRATIVE_COURT', article: royalCommissioner.article, item: null, reasonCode: 'ADMINISTRATIVE_COURT' });
  }

  return sortReferrals(found);
}

/** The order referrals are recorded in, at registration and after a reclassification alike. */
export function sortReferrals<T extends Pick<Referral, 'target' | 'ground'>>(referrals: readonly T[]): T[] {
  const order = (r: T) => (r.target === 'PROSECUTION' ? (r.ground === 'PRINCIPAL_PARTY' ? 0 : 1) : 2);
  return [...referrals].sort((a, b) => order(a) - order(b));
}
