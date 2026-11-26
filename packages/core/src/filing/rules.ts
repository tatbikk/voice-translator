// The rule tables of Phase 2 (prompt, rule 5: legal rules are dated, sourced
// data, not code). Each file of rules/ holds dated versions; the server loads
// them into RuleSet and hands the version in force to the functions of this
// module. The schemas below validate a file before it is loaded.
//   rules/case-types.json   the codes of case types (fictitious, س21), their
//                           specialty, and those that make the prosecution a
//                           principal party (art. 18)
//   rules/districts.json    the localities of each court's district (art. 66)
//   rules/referrals.json    referrals to the prosecution (art. 18, 20) and to
//                           the royal commissioner (art. 101), and the judicial
//                           agents to bring in (art. 605)
//   rules/jurisdiction.json the threshold of the commercial courts (art. 35)
import { z } from 'zod';
import type { Dated } from '../rules/in-force';
import type { ClaimNature } from '../rules/fees';

export const SPECIALTIES = ['GENERAL', 'COMMERCIAL', 'ADMINISTRATIVE'] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const PUBLIC_ENTITY_KINDS = [
  'STATE',
  'LOCAL_AUTHORITY',
  'PUBLIC_ESTABLISHMENT',
  'OTHER_PUBLIC',
  'STATE_JUDICIAL_AGENT',
  'LOCAL_AUTHORITIES_AGENT',
] as const;
export type PublicEntityKind = (typeof PUBLIC_ENTITY_KINDS)[number];

export const CAPACITY_STATUSES = ['FULL', 'INCAPABLE', 'ABSENT'] as const;
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number];

const CLAIM_NATURES = ['DEBT', 'DAMAGES', 'LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS', 'OTHER'] as const satisfies readonly ClaimNature[];

/** Flags of a case type that matter to a rule (art. 605: taxes, State domain). */
export const CASE_TYPE_FLAGS = ['TAX', 'STATE_DOMAIN'] as const;
export type CaseTypeFlag = (typeof CASE_TYPE_FLAGS)[number];

const dated = {
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  source: z.string().min(1),
};

const code = z.string().regex(/^\d{3,5}$/);
const locality = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);

export const CaseTypeRuleSetSchema = z
  .object({
    ...dated,
    types: z
      .array(
        z
          .object({
            code,
            specialty: z.enum(SPECIALTIES),
            /** the article (and item) that gives the specialty its jurisdiction, for display */
            articles: z.array(z.number().int().positive()),
            flags: z.array(z.enum(CASE_TYPE_FLAGS)),
            /** the prosecution is a principal party in cases of this type (art. 18) */
            prosecution: z
              .object({ ground: z.literal('PRINCIPAL_PARTY'), article: z.literal(18), item: z.number().int().min(1).max(4) })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CaseTypeRuleSet = z.infer<typeof CaseTypeRuleSetSchema> & Dated;
export type CaseTypeRule = CaseTypeRuleSet['types'][number];

export const DistrictRuleSetSchema = z
  .object({
    ...dated,
    /** every locality the interface offers, in display order */
    localities: z.array(locality).min(1),
    districts: z.array(z.object({ courtCode: z.string().min(1), localities: z.array(locality).min(1) }).strict()).min(1),
    /**
     * The districts are assumed, not read from the texts of judicial organisation (open question
     * 42): whether an address lies within one, and the time to appear computed from it (arts. 88
     * and 89), carry «قيمة مؤقتة غير مؤكدة». Since version 2026-11-26.1 (review of IR-08); the
     * first version, which lacks it, is as uncertain.
     */
    uncertain: z.boolean().optional(),
  })
  .strict();
export type DistrictRuleSet = z.infer<typeof DistrictRuleSetSchema> & Dated;

export const ReferralRuleSetSchema = z
  .object({
    ...dated,
    prosecution: z
      .object({
        /** art. 18, item 4: cases concerning the incapable, the absent and the missing */
        principalParty: z.object({ article: z.literal(18), capacityStatuses: z.partialRecord(z.enum(CAPACITY_STATUSES), z.number().int().min(1).max(4)) }).strict(),
        /**
         * Art. 20, item 1: cases concerning the State and other public-law persons. The item by
         * category of the card, and (since version 2026-11-26.1, decision 66) the item for any
         * public-law person whatever its category, even none: «أو بأي شخص آخر من أشخاص القانون
         * العام». A version without it communicates only the categories it lists.
         */
        communication: z
          .object({
            article: z.literal(20),
            anyPublicLawPerson: z.number().int().min(1).max(5).optional(),
            publicEntityKinds: z.partialRecord(z.enum(PUBLIC_ENTITY_KINDS), z.number().int().min(1).max(5)),
          })
          .strict(),
      })
      .strict(),
    /** art. 101: a copy of the application to the royal commissioner before administrative courts */
    royalCommissioner: z.object({ article: z.literal(101), specialties: z.array(z.enum(SPECIALTIES)).min(1) }).strict(),
    /** art. 605: the judicial agent to bring in when the claims seek to declare a public debtor's debt */
    judicialAgents: z
      .array(
        z
          .object({
            article: z.literal(605),
            paragraph: z.number().int().min(1),
            debtorKinds: z.array(z.enum(PUBLIC_ENTITY_KINDS)).min(1),
            agentKind: z.enum(PUBLIC_ENTITY_KINDS),
            claimNatures: z.array(z.enum(CLAIM_NATURES)).min(1),
            exemptFlags: z.array(z.enum(CASE_TYPE_FLAGS)),
            uncertain: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ReferralRuleSet = z.infer<typeof ReferralRuleSetSchema> & Dated;

export const JurisdictionRuleSetSchema = z
  .object({
    ...dated,
    commercial: z
      .object({
        article: z.literal(35),
        /** «الطلبات الأصلية التي تتجاوز قيمتها ثمانين ألف (80.000) درهم»: strictly above */
        thresholdCents: z.number().int().positive(),
        /** natures that carry no value of their own for the threshold */
        excludedNatures: z.array(z.enum(CLAIM_NATURES)),
      })
      .strict(),
  })
  .strict();
export type JurisdictionRuleSet = z.infer<typeof JurisdictionRuleSetSchema> & Dated;

/** The value of the principal claims for the threshold of art. 35, or null without any amount. */
export function principalValueCents(
  claims: readonly { nature: ClaimNature; amountCents: number | null }[],
  jurisdiction: JurisdictionRuleSet,
): number | null {
  const counted = claims.filter((c) => !jurisdiction.commercial.excludedNatures.includes(c.nature) && c.amountCents !== null);
  if (counted.length === 0) return null;
  return counted.reduce((total, c) => total + (c.amountCents ?? 0), 0);
}
