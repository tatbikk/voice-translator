// «المحكمة المقترحة» (study, «المرحلة الأولى»): from the case type and the
// defendant's domicile (art. 66), which for a company is its registered office
// in the trade register (art. 613), the platform suggests the competent court
// of the districts table, and notes the threshold of art. 35 for a commercial
// court. A suggestion, nothing more: the choice is the depositor's, and the
// ruling on jurisdiction the court's.
import { principalValueCents, type CaseTypeRule, type DistrictRuleSet, type JurisdictionRuleSet, type Specialty } from './rules';
import type { ClaimNature } from '../rules/fees';

export interface CourtRef {
  readonly id: string;
  readonly code: string;
  readonly specialty: Specialty;
  readonly degree: 'FIRST_INSTANCE' | 'APPEAL';
}

export type SuggestionReason = 'DEFENDANT_DOMICILE' | 'NO_CASE_TYPE' | 'NO_LOCALITY' | 'NO_DISTRICT' | 'NO_COURT_OF_SPECIALTY';

export interface CourtSuggestion {
  readonly courtId: string | null;
  readonly reason: SuggestionReason;
  readonly articles: readonly number[];
  /** for a commercial court suggested: whether the principal claims exceed the threshold of art. 35; null otherwise or without amount */
  readonly thresholdExceeded: boolean | null;
}

export interface SuggestionInput {
  readonly caseType: CaseTypeRule | null;
  /** the locality code of the defendant's domicile or registered office */
  readonly defendantLocality: string | null;
  /** the value of the principal claims, when known */
  readonly principalCents: number | null;
  /** the defendant is a company whose domicile is its registered office (art. 613) */
  readonly defendantIsCompany?: boolean;
  readonly districts: DistrictRuleSet;
  readonly courts: readonly CourtRef[];
  readonly jurisdiction: JurisdictionRuleSet;
}

export function suggestCourt(input: SuggestionInput): CourtSuggestion {
  const none = (reason: SuggestionReason, articles: readonly number[] = []): CourtSuggestion => ({ courtId: null, reason, articles, thresholdExceeded: null });
  if (!input.caseType) return none('NO_CASE_TYPE');
  if (!input.defendantLocality) return none('NO_LOCALITY', [66]);
  const codes = input.districts.districts.filter((d) => d.localities.includes(input.defendantLocality ?? '')).map((d) => d.courtCode);
  if (codes.length === 0) return none('NO_DISTRICT', [66]);
  const specialty = input.caseType.specialty;
  const court = input.courts.find((c) => c.degree === 'FIRST_INSTANCE' && c.specialty === specialty && codes.includes(c.code));
  if (!court) return none('NO_COURT_OF_SPECIALTY', [66]);
  const commercial = specialty === 'COMMERCIAL';
  const threshold = input.jurisdiction.commercial.thresholdCents;
  return {
    courtId: court.id,
    reason: 'DEFENDANT_DOMICILE',
    articles: [66, ...(input.defendantIsCompany ? [613] : []), ...(commercial ? [input.jurisdiction.commercial.article] : [])],
    thresholdExceeded: commercial && input.principalCents !== null ? input.principalCents > threshold : null,
  };
}

export interface DistrictInput {
  readonly districts: DistrictRuleSet;
  /** the code of the court the case is registered in */
  readonly courtCode: string;
  readonly address: { readonly locality?: string | null | undefined; readonly country?: string | null | undefined };
}

/**
 * Whether an address of a party lies within the district of the court (independent
 * review IR-08), on which the time to appear depends: five days within the district,
 * fifteen elsewhere in the Kingdom (art. 88), three months for a party with neither
 * domicile nor residence in the Kingdom (art. 89). An address outside the Kingdom lies
 * within no district of it. Otherwise the districts table answers for a locality it
 * lists and a court it gives a district; for any other, the answer is unknown (null),
 * never a guess. The time itself is computed in Phase 3.
 */
export function addressWithinDistrict(input: DistrictInput): boolean | null {
  const { districts, courtCode, address } = input;
  if (address.country) return false;
  const locality = address.locality ?? null;
  if (!locality || !districts.localities.includes(locality)) return null;
  const district = districts.districts.find((d) => d.courtCode === courtCode);
  if (!district) return null;
  return district.localities.includes(locality);
}

/** The principal value of claims for the suggestion, from the card's claims. */
export function principalOf(claims: readonly { nature: ClaimNature; amountCents: number | null }[], jurisdiction: JurisdictionRuleSet): number | null {
  return principalValueCents(claims, jurisdiction);
}
