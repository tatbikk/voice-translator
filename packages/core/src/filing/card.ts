// «بطاقة الدعوى» (study, «المرحلة الأولى»; interface book, «واجهة المحامي»): the
// structured form of the statements art. 77 requires, filled by hand in
// Phase 2 (prompt). The server validates every card against this schema and
// never trusts the interface's validation. The lawyer's own statements (name,
// national number, bar, e-mail) come from the account, not from the card.
import { z } from 'zod';
import { CAPACITY_STATUSES, PUBLIC_ENTITY_KINDS } from './rules';

/** The four sections the depositor attests «مطابق للمقال» (study). */
export const CARD_SECTIONS = ['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS'] as const;
export type CardSection = (typeof CARD_SECTIONS)[number];

export const CARD_SIDES = ['PLAINTIFF', 'DEFENDANT', 'GUARANTOR'] as const;
export const PERSON_KINDS = ['NATURAL', 'LEGAL', 'PUBLIC'] as const;
export const CLAIM_NATURE_CODES = ['DEBT', 'DAMAGES', 'LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS', 'OTHER'] as const;

export const CARD_LIMITS = {
  parties: 50,
  claims: 50,
  summaryChars: 20_000,
} as const;

/** An empty field of a form is an absent statement. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

/**
 * Control characters and the invisible marks that make a text read otherwise than
 * it is (direction overrides and isolates, zero-width characters): removed from
 * every text of the card, the line breaks of the summary kept (review P2-S-11).
 */
// eslint-disable-next-line no-control-regex -- the control characters are what this class removes
const INVISIBLE = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]', 'g');
export const stripInvisible = (value: string) => value.normalize('NFC').replace(INVISIBLE, '');

const text = (max: number) =>
  z
    .string()
    .transform(stripInvisible)
    .pipe(z.string().trim().min(1).max(max));
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

const AddressSchema = z
  .object({
    value: text(300),
    /** a locality of the districts table (rules/districts.json), by its code */
    locality: optional(z.string().regex(/^[a-z][a-z0-9-]{1,40}$/)),
    /**
     * the country of an address outside the Kingdom (art. 89), as declared; never with a locality,
     * never blank: «خارج تراب المملكة» chosen names its country, or the address would lie nowhere
     * (review of IR-08)
     */
    country: text(100).optional(),
    source: z.enum(['DECLARED', 'COMMERCIAL_REGISTER']),
  })
  .strict();

/** The fields of a party that hold a place where the party may be found (art. 77). */
export const CARD_ADDRESS_FIELDS = ['domicile', 'residence', 'registeredOffice', 'branch'] as const;

/** An address or an agent left blank in the form is absent. */
const blankObject = (field: string) => (value: unknown) =>
  value !== null && typeof value === 'object' && isBlank((value as Record<string, unknown>)[field]) ? undefined : value;
const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const optionalAddress = z.preprocess(blankObject('value'), AddressSchema.optional());

const PartySchema = z
  .object({
    key,
    side: z.enum(CARD_SIDES),
    personKind: z.enum(PERSON_KINDS),
    name: text(200),
    /** the party's capacity in the suit (art. 77: «صفة») */
    quality: optional(text(200)),
    /** national identity card of a natural person, or what stands for it; a company's trade register number */
    idNumber: optional(text(60)),
    legalForm: optional(text(120)),
    legalRepresentative: optional(text(200)),
    publicEntityKind: optional(z.enum(PUBLIC_ENTITY_KINDS)),
    capacityStatus: optional(z.enum(CAPACITY_STATUSES)),
    domicile: optionalAddress,
    residence: optionalAddress,
    registeredOffice: optionalAddress,
    branch: optionalAddress,
    email: optional(z.string().trim().max(200).pipe(z.email())),
    phone: optional(z.string().trim().regex(/^\+?[0-9][0-9 ]{5,19}$/)),
    /** the plaintiff's agent and his domicile (art. 77) */
    agent: z.preprocess(blankObject('name'), z.object({ name: text(200), address: optional(text(300)) }).strict().optional()),
    /** the filing lawyer acts for this party: a plaintiff only (the card's refinement below) */
    representedByFiler: z.boolean().optional(),
  })
  .strict();

const ClaimSchema = z
  .object({
    key,
    nature: z.enum(CLAIM_NATURE_CODES),
    /** centimes; null for a claim without a fixed amount */
    amountCents: z.number().int().min(0).max(100_000_000_000_000).nullable(),
    description: optional(text(500)),
  })
  .strict();

export const FilingCardSchema = z
  .object({
    parties: z.array(PartySchema).max(CARD_LIMITS.parties),
    summary: z.string().transform(stripInvisible).pipe(z.string().trim().max(CARD_LIMITS.summaryChars)),
    claims: z.array(ClaimSchema).max(CARD_LIMITS.claims),
  })
  .strict()
  .superRefine((card, ctx) => {
    for (const [field, items] of [
      ['parties', card.parties],
      ['claims', card.claims],
    ] as const) {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (seen.has(item.key)) ctx.addIssue({ code: 'custom', path: [field, index, 'key'], message: 'duplicate key' });
        seen.add(item.key);
      }
    }
    // The filing lawyer files the application of a plaintiff: he can act for no other side (review P2-S-02).
    for (const [index, party] of card.parties.entries()) {
      if (party.representedByFiler === true && party.side !== 'PLAINTIFF') {
        ctx.addIssue({ code: 'custom', path: ['parties', index, 'representedByFiler'], message: 'the filer acts for a plaintiff only' });
      }
      // Capacity and absence are a natural person's (art. 18, item 4), and the agent art. 77 names is the plaintiff's.
      if (party.capacityStatus !== undefined && party.personKind !== 'NATURAL') {
        ctx.addIssue({ code: 'custom', path: ['parties', index, 'capacityStatus'], message: 'capacity is a natural person’s' });
      }
      if (party.publicEntityKind !== undefined && party.personKind !== 'PUBLIC') {
        ctx.addIssue({ code: 'custom', path: ['parties', index, 'publicEntityKind'], message: 'the kind of a public-law person' });
      }
      if (party.agent !== undefined && party.side !== 'PLAINTIFF') {
        ctx.addIssue({ code: 'custom', path: ['parties', index, 'agent'], message: 'the agent of art. 77 is the plaintiff’s' });
      }
      // An address lies in a locality of the districts table or outside the Kingdom, not both (independent review IR-08).
      for (const field of CARD_ADDRESS_FIELDS) {
        const address = party[field];
        if (address?.locality !== undefined && address.country !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['parties', index, field, 'country'], message: 'a locality of the Kingdom or a country, not both' });
        }
      }
    }
  });

export type FilingCard = z.infer<typeof FilingCardSchema>;
export type CardParty = FilingCard['parties'][number];
export type CardClaim = FilingCard['claims'][number];
export type CardAddress = z.infer<typeof AddressSchema>;

export const EMPTY_CARD: FilingCard = { parties: [], summary: '', claims: [] };

/**
 * Whether a party that becomes a plaintiff in the card form starts with the filing lawyer as its
 * counsel (decision 67). On the electronic channel it does: the lawyer who signs the application
 * of the plaintiffs is their lawyer (art. 76), and he unticks the plaintiff, among several, who
 * keeps another counsel. On paper the clerk ticks nothing: the lawyer he picks from the roster
 * acts for the plaintiffs the card marks, or for all of them (decision 59). Never another side.
 */
export function filerCounselByDefault(channel: 'ELECTRONIC' | 'PAPER', side: CardParty['side']): boolean {
  return channel === 'ELECTRONIC' && side === 'PLAINTIFF';
}

/**
 * The party with what the card shows for its kind of person, and nothing else (review of IR-08): a
 * natural person's identity number, capacity, domicile and residence; a company's register number,
 * legal form, representative, registered office and branch; a public-law person's category,
 * representative, registered office and branch. What a kind switch, a form before the fix or another
 * client left hidden is dropped where the card is saved, checked and registered: a hidden address
 * would be registered with its place, and decide the time to appear (arts. 88 and 89). The schema does
 * not refuse it, because a stored card that fails the schema is read as empty.
 */
export function shownForKind(party: CardParty): CardParty {
  const { idNumber, capacityStatus, publicEntityKind, legalForm, legalRepresentative, domicile, residence, registeredOffice, branch, ...rest } = party;
  const kind = party.personKind;
  const natural = kind === 'NATURAL';
  return {
    ...rest,
    ...(idNumber !== undefined && kind !== 'PUBLIC' ? { idNumber } : {}),
    ...(natural && capacityStatus ? { capacityStatus } : {}),
    ...(kind === 'PUBLIC' && publicEntityKind ? { publicEntityKind } : {}),
    ...(kind === 'LEGAL' && legalForm !== undefined ? { legalForm } : {}),
    ...(!natural && legalRepresentative !== undefined ? { legalRepresentative } : {}),
    ...(natural && domicile ? { domicile } : {}),
    ...(natural && residence ? { residence } : {}),
    ...(!natural && registeredOffice ? { registeredOffice } : {}),
    ...(!natural && branch ? { branch } : {}),
  };
}

/**
 * The party of the card form whose kind of person changes: what the card no longer shows for the new
 * kind does not stay hidden with it (fix review M2; review of IR-08).
 */
export function withPersonKind(party: CardParty, personKind: CardParty['personKind']): CardParty {
  if (party.personKind === personKind) return party;
  return shownForKind({ ...party, personKind });
}

/** The part of the card a section attests: its digest is kept with the attestation. */
export function sectionContent(card: FilingCard, section: CardSection): unknown {
  switch (section) {
    case 'PLAINTIFFS':
      return card.parties.filter((p) => p.side === 'PLAINTIFF');
    case 'DEFENDANTS':
      return card.parties.filter((p) => p.side !== 'PLAINTIFF');
    case 'SUMMARY':
      return card.summary;
    case 'CLAIMS':
      return card.claims;
  }
}

/** The claims as the fee engine reads them. */
export function feeClaims(card: FilingCard): { nature: CardClaim['nature']; amountCents: number | null }[] {
  return card.claims.map((c) => ({ nature: c.nature, amountCents: c.amountCents }));
}

/** JSON with sorted keys, so that a digest does not depend on the order of fields. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
