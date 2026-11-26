// Phase 2 in the core (docs/phases/phase-2.md, docs/security/phase-2-memo.md):
// the case card and its schema, the check before signature (art. 77, 605, 631),
// the authorization of a draft and of a payment, the relation of the royal
// commissioner, and the absence of any action rejecting an application.
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  CARD_SECTIONS,
  CARD_SIDES,
  FilingCardSchema,
  PUBLIC_ENTITY_KINDS,
  authorize,
  availableActions,
  filerCounselByDefault,
  filingReady,
  preSignatureChecks,
  referralsFor,
  ruleInForce,
  type AuthorizationContext,
  type CaseSnapshot,
  type CaseTypeRuleSet,
  type FilingCard,
  type JurisdictionRuleSet,
  type ReferralRuleSet,
  type Resource,
  type RoleCode,
  type Subject,
} from '../src/index';
import { readRules } from './rules/md-tables';

const NOW = new Date('2026-11-25T20:40:00Z');
const context: AuthorizationContext = { mode: 'demo', demoToolsEnabled: true, now: NOW };
// The rule tables in force today; the referral table communicates every public-law person since this day (decision 66).
const ON = '2026-11-26';
const referrals = ruleInForce(readRules<ReferralRuleSet[]>('referrals.json'), ON)!;
const jurisdiction = ruleInForce(readRules<JurisdictionRuleSet[]>('jurisdiction.json'), ON)!;
const caseTypes = ruleInForce(readRules<CaseTypeRuleSet[]>('case-types.json'), ON)!;
const commercialPayment = caseTypes.types.find((t) => t.code === '8201')!;

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const COURT = '44444444-4444-4444-8444-444444444444';
const OTHER_COURT = '55555555-5555-4555-8555-555555555555';

function subject(role: RoleCode, options: { userId?: string; courtId?: string | null } = {}): Subject {
  return {
    kind: 'user',
    userId: options.userId ?? USER,
    role,
    roleAssignmentId: '33333333-3333-4333-8333-333333333333',
    courtId: options.courtId === undefined ? COURT : options.courtId,
    panelId: null,
    organizationId: null,
    isDemoAccount: true,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

const draft = (overrides: Partial<Extract<Resource, { kind: 'filing-draft' }>> = {}): Resource => ({
  kind: 'filing-draft',
  ownerUserId: USER,
  channel: 'ELECTRONIC',
  courtId: COURT,
  status: 'DRAFT',
  paid: false,
  ...overrides,
});

const intent = (overrides: Partial<Extract<Resource, { kind: 'payment-intent' }>> = {}): Resource => ({
  kind: 'payment-intent',
  ownerUserId: USER,
  status: 'PENDING',
  ...overrides,
});

// ---------------------------------------------------------------------------

const MODEL: FilingCard = {
  parties: [
    {
      key: 'alif',
      side: 'PLAINTIFF',
      personKind: 'LEGAL',
      name: 'شركة ألف للتوريدات',
      quality: 'مدعية',
      idNumber: 'RC-DEMO-1001',
      legalForm: 'شركة ذات مسؤولية محدودة',
      legalRepresentative: 'السيد كاف ميم',
      registeredOffice: { value: 'الدار البيضاء، شارع النموذج، رقم 1', locality: 'casablanca', source: 'COMMERCIAL_REGISTER' },
      email: 'contact@alif-demo.example',
      representedByFiler: true,
    },
    {
      key: 'baa',
      side: 'DEFENDANT',
      personKind: 'LEGAL',
      name: 'شركة باء للصناعة',
      quality: 'مدعى عليها',
      idNumber: 'RC-DEMO-2002',
      legalForm: 'شركة مساهمة',
      legalRepresentative: 'السيد جيم',
      registeredOffice: { value: 'الدار البيضاء، المنطقة الصناعية النموذجية، رقم 2', locality: 'casablanca', source: 'COMMERCIAL_REGISTER' },
    },
    {
      key: 'jim',
      side: 'GUARANTOR',
      personKind: 'NATURAL',
      name: 'السيد جيم',
      quality: 'كفيل متضامن',
      domicile: { value: 'الدار البيضاء، حي المثال، رقم 5', locality: 'casablanca', source: 'DECLARED' },
    },
  ],
  summary: 'دعوى أداء ثمن توريدات.',
  claims: [
    { key: 'debt', nature: 'DEBT', amountCents: 48_600_000 },
    { key: 'interest', nature: 'LEGAL_INTEREST', amountCents: null },
    { key: 'damages', nature: 'DAMAGES', amountCents: 4_000_000 },
    { key: 'enforcement', nature: 'PROVISIONAL_ENFORCEMENT', amountCents: null },
    { key: 'costs', nature: 'COSTS', amountCents: null },
  ],
};

const checksOf = (overrides: Partial<Parameters<typeof preSignatureChecks>[0]> = {}) =>
  preSignatureChecks({
    channel: 'ELECTRONIC',
    card: MODEL,
    attested: [...CARD_SECTIONS],
    application: { present: true, fixedCopyReady: true },
    documents: [{ id: 'e1', kind: 'EXHIBIT', declaredNature: 'ORIGINAL', pageCount: null, paperOriginalLocation: null }],
    filer: { professionalNumber: 'DEMO-AV-0001', professionalBody: 'هيئة المحامين النموذجية', email: 'avocat@demo.example' },
    caseType: commercialPayment,
    courtSpecialty: 'COMMERCIAL',
    referrals,
    jurisdiction,
    ...overrides,
  });

describe('the case card (art. 77)', () => {
  it('accepts the model case as entered by the plaintiff’s lawyer', () => {
    expect(FilingCardSchema.safeParse(MODEL).success).toBe(true);
  });

  it('refuses a card with unknown fields, duplicate keys, negative amounts or oversized texts', () => {
    expect(FilingCardSchema.safeParse({ ...MODEL, verdict: 'x' }).success).toBe(false);
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [MODEL.parties[0], MODEL.parties[0]] }).success).toBe(false);
    expect(FilingCardSchema.safeParse({ ...MODEL, claims: [{ key: 'x', nature: 'DEBT', amountCents: -1 }] }).success).toBe(false);
    expect(FilingCardSchema.safeParse({ ...MODEL, summary: 'م'.repeat(20_001) }).success).toBe(false);
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [{ ...MODEL.parties[0]!, email: 'not an address' }] }).success).toBe(false);
  });

  it('lets the filing lawyer act for a plaintiff only, never for the other side (review P2-S-02)', () => {
    const plaintiff = MODEL.parties.find((p) => p.side === 'PLAINTIFF')!;
    const others = MODEL.parties.filter((p) => p.side !== 'PLAINTIFF');
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [{ ...plaintiff, representedByFiler: true }, ...others] }).success).toBe(true);
    for (const other of others) {
      const card = { ...MODEL, parties: [plaintiff, ...others.map((p) => (p.key === other.key ? { ...p, representedByFiler: true } : p))] };
      expect(FilingCardSchema.safeParse(card).success, other.side).toBe(false);
    }
  });

  it('keeps capacity to a natural person and the agent of art. 77 to a plaintiff, and refers no company for a capacity (fix review M2)', () => {
    const plaintiff = MODEL.parties.find((p) => p.side === 'PLAINTIFF')!;
    const others = MODEL.parties.filter((p) => p.side !== 'PLAINTIFF');
    const natural = { key: 'n', side: 'DEFENDANT' as const, personKind: 'NATURAL' as const, name: 'السيد دال', capacityStatus: 'INCAPABLE' as const };
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [...MODEL.parties, natural] }).success).toBe(true);
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [...MODEL.parties, { ...natural, personKind: 'LEGAL' }] }).success).toBe(false);
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [{ ...plaintiff, agent: { name: 'السيد هاء', address: 'الدار البيضاء' } }, ...others] }).success).toBe(true);
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [plaintiff, { ...others[0]!, agent: { name: 'السيد هاء' } }, ...others.slice(1)] }).success).toBe(false);
    // The kind of a public-law person is a public-law person's only.
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [...MODEL.parties, { ...natural, capacityStatus: undefined, personKind: 'LEGAL', publicEntityKind: 'STATE_JUDICIAL_AGENT' }] }).success).toBe(false);
    // Whatever reaches the rule from elsewhere, a capacity on a company refers nothing.
    const company = referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: null, parties: [{ personKind: 'LEGAL', capacityStatus: 'INCAPABLE' }], rules: referrals });
    expect(company).toEqual([]);
    const person = referralsFor({ courtSpecialty: 'COMMERCIAL', caseType: null, parties: [{ personKind: 'NATURAL', capacityStatus: 'INCAPABLE' }], rules: referrals });
    expect(person.map((r) => [r.target, r.ground, r.article])).toEqual([['PROSECUTION', 'PRINCIPAL_PARTY', 18]]);
  });

  it('keeps no invisible or direction-overriding character in the card, which would make a name read otherwise (review P2-S-11)', () => {
    const rlo = String.fromCodePoint(0x202e);
    const zwsp = String.fromCodePoint(0x200b);
    const plaintiff = MODEL.parties.find((p) => p.side === 'PLAINTIFF')!;
    const parsed = FilingCardSchema.parse({
      ...MODEL,
      parties: [{ ...plaintiff, name: `شركة${rlo} ألف${zwsp}`, quality: `مدعية${String.fromCodePoint(0x2066)}` }, ...MODEL.parties.filter((p) => p !== plaintiff)],
      summary: `سطر أول${rlo}\nسطر ثان`,
    });
    expect(parsed.parties[0]?.name).toBe('شركة ألف');
    expect(parsed.parties[0]?.quality).toBe('مدعية');
    expect(parsed.summary).toBe('سطر أول\nسطر ثان');
  });

  it('keeps with an address its locality of the districts table, or the country of an address outside the Kingdom, never both (independent review IR-08)', () => {
    const guarantor = MODEL.parties.find((p) => p.key === 'jim')!;
    const others = MODEL.parties.filter((p) => p !== guarantor);
    const abroad = { value: 'باريس، شارع المثال، رقم 4', country: `فرنسا${String.fromCodePoint(0x200f)}`, source: 'DECLARED' as const };
    // A residence is a residence: the card keeps it apart from the domicile (art. 77; G012).
    const residence = FilingCardSchema.parse({ ...MODEL, parties: [...others, { ...guarantor, domicile: undefined, residence: abroad }] });
    const kept = residence.parties.find((p) => p.key === 'jim')!;
    expect(kept.domicile).toBeUndefined();
    expect(kept.residence).toEqual({ value: 'باريس، شارع المثال، رقم 4', country: 'فرنسا', source: 'DECLARED' });
    // A country left blank in the form is absent.
    const blank = FilingCardSchema.parse({ ...MODEL, parties: [...others, { ...guarantor, domicile: { ...guarantor.domicile!, country: ' ' } }] });
    expect(blank.parties.find((p) => p.key === 'jim')?.domicile).toEqual(guarantor.domicile);
    // One address is in one place: a locality of the table, or a country outside the Kingdom.
    const both = FilingCardSchema.safeParse({ ...MODEL, parties: [...others, { ...guarantor, domicile: { ...guarantor.domicile!, country: 'فرنسا' } }] });
    expect(both.success).toBe(false);
    if (!both.success) expect(both.error.issues.map((i) => i.path.join('.'))).toContain('parties.2.domicile.country');
    expect(FilingCardSchema.safeParse({ ...MODEL, parties: [...others, { ...guarantor, residence: { ...abroad, country: 'ب'.repeat(101) } }] }).success).toBe(false);
  });

  it('names the four sections the depositor attests «مطابق للمقال»', () => {
    expect([...CARD_SECTIONS]).toEqual(['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS']);
  });
});

describe('the check before signature: it warns, it does not refuse (study, «مراقبة البيانات الإلزامية»)', () => {
  it('warns that the defendant company’s e-mail address is missing, and nothing blocks the model case', () => {
    const checks = checksOf();
    expect(checks.filter((c) => c.level === 'BLOCKING')).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({ code: 'PARTY_EMAIL_MISSING', level: 'WARNING', article: 77, partyKey: 'baa' }));
  });

  it('warns about every statement of art. 77 left out, without refusing', () => {
    const bare: FilingCard = {
      parties: [
        { key: 'p', side: 'PLAINTIFF', personKind: 'NATURAL', name: 'السيد ألف', representedByFiler: true },
        { key: 'd', side: 'DEFENDANT', personKind: 'LEGAL', name: 'شركة دال' },
      ],
      summary: '',
      claims: [{ key: 'c', nature: 'DEBT', amountCents: null }],
    };
    const checks = checksOf({ card: bare, filer: { professionalNumber: null, professionalBody: null, email: null } });
    const codes = checks.filter((c) => c.level === 'WARNING').map((c) => c.code);
    for (const code of [
      'PARTY_QUALITY_MISSING',
      'PARTY_ADDRESS_MISSING',
      'PLAINTIFF_ID_MISSING',
      'LEGAL_REPRESENTATIVE_MISSING',
      'LEGAL_FORM_MISSING',
      'REGISTER_ADDRESS_MISSING',
      'PARTY_EMAIL_MISSING',
      'SUMMARY_MISSING',
      'CLAIM_AMOUNT_MISSING',
      'FILER_DATA_MISSING',
    ]) {
      expect(codes, code).toContain(code);
    }
    for (const check of checks.filter((c) => c.level === 'WARNING' && c.code !== 'COMMERCIAL_THRESHOLD_NOT_EXCEEDED')) expect(check.article).toBe(77);
    expect(checks.filter((c) => c.level === 'BLOCKING')).toEqual([]);
  });

  // The reviewer of the IR-03 / IR-04 fix: an amount of zero is a claim without a fixed amount, for
  // the fee (its own marked line) and for this warning alike (decision 68).
  it('warns that the amount of a debt or of damages is missing when it is written as zero', () => {
    const amountWarnings = (claims: FilingCard['claims']) =>
      checksOf({ card: { ...MODEL, claims } }).filter((c) => c.code === 'CLAIM_AMOUNT_MISSING');
    for (const nature of ['DEBT', 'DAMAGES'] as const) {
      expect(amountWarnings([{ key: 'c', nature, amountCents: 0 }]), nature).toEqual([
        expect.objectContaining({ code: 'CLAIM_AMOUNT_MISSING', level: 'WARNING', article: 77, section: 'CLAIMS' }),
      ]);
      expect(amountWarnings([{ key: 'c', nature, amountCents: 1 }]), nature).toEqual([]);
    }
    // As for an empty amount, only a debt or damages are warned about.
    expect(amountWarnings([{ key: 'c', nature: 'OTHER', amountCents: 0 }])).toEqual([]);
  });

  it('blocks only on what the filing cannot do without: the application, the nature of each exhibit, the attestation', () => {
    expect(checksOf({ application: { present: false, fixedCopyReady: false } }).map((c) => c.code)).toContain('APPLICATION_MISSING');
    expect(checksOf({ application: { present: true, fixedCopyReady: false } }).map((c) => c.code)).toContain('FIXED_COPY_NOT_READY');
    const nature = checksOf({ documents: [{ id: 'e1', kind: 'EXHIBIT', declaredNature: null, pageCount: null, paperOriginalLocation: null }] });
    expect(nature).toContainEqual(expect.objectContaining({ code: 'EXHIBIT_NATURE_MISSING', level: 'BLOCKING', article: 631 }));
    const unattested = checksOf({ attested: ['PLAINTIFFS', 'CLAIMS'] });
    expect(unattested.filter((c) => c.code === 'SECTION_NOT_ATTESTED').map((c) => c.section).sort()).toEqual(['DEFENDANTS', 'SUMMARY']);
  });

  // Independent review IR-01 (decision 66): the category of a public-law person is what the warning
  // of art. 605 and the ground of the communication of art. 20 are read from, and the parties of a
  // registered file are not amended. Left empty, it blocks the payment and the filing; the card is still saved.
  it('blocks while a public-law person has no category, names the party, and lets every category through', () => {
    const plaintiff = MODEL.parties.find((p) => p.side === 'PLAINTIFF')!;
    const office = { key: 'office', side: 'DEFENDANT' as const, personKind: 'PUBLIC' as const, name: 'المكتب النموذجي للتجهيز', quality: 'مدعى عليه' };
    const against = (party: FilingCard['parties'][number]): FilingCard => ({ ...MODEL, parties: [plaintiff, party], claims: [{ key: 'debt', nature: 'DEBT', amountCents: 12_000_000 }] });
    const codes = (checks: ReturnType<typeof checksOf>) => checks.map((c): string => c.code);

    expect(FilingCardSchema.safeParse(against(office)).success, 'the card is saved without the category').toBe(true);
    const missing = checksOf({ card: against(office) });
    expect(missing.filter((c) => c.level === 'BLOCKING')).toEqual([
      expect.objectContaining({ code: 'PUBLIC_ENTITY_KIND_MISSING', level: 'BLOCKING', article: 20, partyKey: 'office', uncertain: false }),
    ]);
    expect(filingReady(missing)).toBe(false);
    // Nothing can recall art. 605 while the category is unknown: this is why the check blocks instead of warning.
    expect(codes(missing)).not.toContain('STATE_JUDICIAL_AGENT_MISSING');
    expect(codes(missing)).not.toContain('LOCAL_AUTHORITIES_AGENT_MISSING');

    // The same on the plaintiff's side, and on paper.
    const asPlaintiff = checksOf({ card: { ...MODEL, parties: [{ ...office, side: 'PLAINTIFF' }, ...MODEL.parties.filter((p) => p.side !== 'PLAINTIFF')] } });
    expect(asPlaintiff).toContainEqual(expect.objectContaining({ code: 'PUBLIC_ENTITY_KIND_MISSING', level: 'BLOCKING', partyKey: 'office' }));
    const onPaper = checksOf({ channel: 'PAPER', filer: null, documents: [], paperDepositor: { name: 'السيد عين' }, card: against(office) });
    expect(codes(onPaper.filter((c) => c.level === 'BLOCKING'))).toEqual(['PUBLIC_ENTITY_KIND_MISSING']);

    // Every category the form offers lifts it.
    for (const publicEntityKind of PUBLIC_ENTITY_KINDS) {
      const stated = checksOf({ card: against({ ...office, publicEntityKind }) });
      expect(stated.filter((c) => c.level === 'BLOCKING'), publicEntityKind).toEqual([]);
    }
    // And the warning of art. 605 is then given by the category.
    expect(checksOf({ card: against({ ...office, publicEntityKind: 'PUBLIC_ESTABLISHMENT' }) })).toContainEqual(
      expect.objectContaining({ code: 'STATE_JUDICIAL_AGENT_MISSING', level: 'WARNING', article: 605 }),
    );
    expect(checksOf({ card: against({ ...office, publicEntityKind: 'LOCAL_AUTHORITY' }) })).toContainEqual(
      expect.objectContaining({ code: 'LOCAL_AUTHORITIES_AGENT_MISSING', level: 'WARNING', article: 605 }),
    );
    // It is asked of a public-law person only.
    expect(codes(checksOf())).not.toContain('PUBLIC_ENTITY_KIND_MISSING');
  });

  // Independent review IR-02 (decision 67): on the electronic channel the lawyer who files and signs
  // the application is counsel of the plaintiffs (art. 76: signed by the plaintiff, his agent or his
  // lawyer; the register holds the parties' lawyers). A card on which he acted for no plaintiff
  // registered a file he could not open: it now blocks the payment and the filing. The card is still saved.
  it('blocks the electronic filing while the filing lawyer acts for no plaintiff, once, on the plaintiffs’ section', () => {
    const plaintiff = MODEL.parties.find((p) => p.side === 'PLAINTIFF')!;
    const others = MODEL.parties.filter((p) => p.side !== 'PLAINTIFF');
    const second: FilingCard['parties'][number] = {
      key: 'dal',
      side: 'PLAINTIFF',
      personKind: 'NATURAL',
      name: 'السيد دال',
      quality: 'مدع',
      idNumber: 'DEMO-CIN-0009',
      domicile: { value: 'الدار البيضاء، حي المثال، رقم 9', locality: 'casablanca', source: 'DECLARED' },
    };
    const withPlaintiffs = (...plaintiffs: FilingCard['parties']): FilingCard => ({ ...MODEL, parties: [...plaintiffs, ...others] });
    const blocking = (checks: ReturnType<typeof checksOf>) => checks.filter((c) => c.level === 'BLOCKING');
    const asked: unknown = expect.objectContaining({ code: 'FILER_REPRESENTS_NO_PLAINTIFF', level: 'BLOCKING', article: 76, section: 'PLAINTIFFS', partyKey: null, uncertain: false });

    // The box never ticked, or unticked: the card is a card all the same, and one check blocks.
    for (const representedByFiler of [undefined, false]) {
      const card = withPlaintiffs({ ...plaintiff, representedByFiler });
      expect(FilingCardSchema.safeParse(card).success, 'the card is saved without counsel').toBe(true);
      const checks = checksOf({ card });
      expect(blocking(checks), String(representedByFiler)).toEqual([asked]);
      expect(filingReady(checks)).toBe(false);
    }
    // Several plaintiffs and counsel of none: asked once, of the section, not of each plaintiff.
    expect(blocking(checksOf({ card: withPlaintiffs({ ...plaintiff, representedByFiler: false }, second) }))).toEqual([asked]);

    // He may leave one plaintiff among several to another counsel: acting for one is enough.
    expect(blocking(checksOf({ card: withPlaintiffs(plaintiff, second) }))).toEqual([]);
    expect(blocking(checksOf({ card: withPlaintiffs({ ...plaintiff, representedByFiler: false }, { ...second, representedByFiler: true }) }))).toEqual([]);
    expect(blocking(checksOf())).toEqual([]);

    // A card without any plaintiff lacks the plaintiff, not his counsel.
    expect(blocking(checksOf({ card: { ...MODEL, parties: others }, attested: [...CARD_SECTIONS] })).map((c): string => c.code)).toEqual(['NO_PLAINTIFF']);
  });

  it('asks nothing of the kind of the paper filing: the lawyer the clerk picks acts for the plaintiffs (decision 59)', () => {
    const unmarked: FilingCard = { ...MODEL, parties: MODEL.parties.map((p) => ({ ...p, representedByFiler: false })) };
    const onPaper = checksOf({ channel: 'PAPER', filer: null, documents: [], paperDepositor: { name: 'السيد عين' }, card: unmarked });
    expect(onPaper.filter((c) => c.level === 'BLOCKING')).toEqual([]);
    expect(onPaper.map((c): string => c.code)).not.toContain('FILER_REPRESENTS_NO_PLAINTIFF');
  });

  it('starts a new plaintiff of the electronic card with the filing lawyer as counsel, and no other party (decision 67)', () => {
    expect(filerCounselByDefault('ELECTRONIC', 'PLAINTIFF')).toBe(true);
    for (const side of ['DEFENDANT', 'GUARANTOR'] as const) expect(filerCounselByDefault('ELECTRONIC', side), side).toBe(false);
    // On paper the clerk ticks nothing by default (decision 59).
    for (const side of CARD_SIDES) expect(filerCounselByDefault('PAPER', side), side).toBe(false);
    // What the default gives is what the schema accepts: counsel of a plaintiff only.
    for (const side of CARD_SIDES) {
      const party = { key: 'x', side, personKind: 'NATURAL' as const, name: 'السيد سين', representedByFiler: filerCounselByDefault('ELECTRONIC', side) };
      expect(FilingCardSchema.safeParse({ parties: [party], summary: '', claims: [] }).success, side).toBe(true);
    }
  });

  it('asks the paper filing for the page count and the place of every paper original', () => {
    const checks = checksOf({
      channel: 'PAPER',
      filer: null,
      documents: [{ id: 's1', kind: 'APPLICATION', declaredNature: 'ORIGINAL', pageCount: null, paperOriginalLocation: null }],
    });
    expect(checks).toContainEqual(expect.objectContaining({ code: 'PAPER_ORIGINAL_UNRECORDED', level: 'BLOCKING' }));
    expect(checks.map((c) => c.code)).not.toContain('FILER_DATA_MISSING');
  });

  it('notes, without refusing, a commercial court chosen for principal claims that do not exceed the threshold (art. 35)', () => {
    const small: FilingCard = { ...MODEL, claims: [{ key: 'debt', nature: 'DEBT', amountCents: 6_000_000 }] };
    expect(checksOf({ card: small })).toContainEqual(expect.objectContaining({ code: 'COMMERCIAL_THRESHOLD_NOT_EXCEEDED', level: 'WARNING', article: 35 }));
    expect(checksOf().map((c) => c.code)).not.toContain('COMMERCIAL_THRESHOLD_NOT_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------

describe('a draft belongs to its author (memo row 2)', () => {
  const reading = ['filing.draft.read', 'filing.draft.edit', 'filing.draft.pay', 'filing.draft.submit'] as const;

  it('lets the lawyer who opened it read, edit and pay it', () => {
    for (const action of ['filing.draft.read', 'filing.draft.edit', 'filing.draft.pay'] as const) {
      expect(authorize(subject('LAWYER'), action, draft(), context).allowed, action).toBe(true);
    }
  });

  it('answers another lawyer as for a draft that does not exist', () => {
    for (const action of reading) {
      expect(authorize(subject('LAWYER', { userId: OTHER }), action, draft(), context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    }
  });

  it('refuses the role to the office assistant, the judges, the administrator and the other clerks', () => {
    for (const role of ['LAWYER_ASSISTANT', 'JUDGE_RAPPORTEUR', 'COURT_PRESIDENT', 'SYSTEM_ADMIN', 'CLERK_CASHIER', 'PUBLIC_PROSECUTOR', 'BAILIFF'] as const) {
      for (const action of reading) {
        expect(authorize(subject(role), action, draft(), context), `${role} ${action}`).toEqual({ allowed: false, reason: 'ROLE_NOT_PERMITTED' });
      }
    }
  });

  it('gives the paper draft to the registry clerk who opened it, at his court only', () => {
    const paper = draft({ channel: 'PAPER' });
    expect(authorize(subject('CLERK_REGISTRATION'), 'filing.draft.read', paper, context).allowed).toBe(true);
    expect(authorize(subject('CLERK_REGISTRATION', { courtId: OTHER_COURT }), 'filing.draft.read', paper, context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(authorize(subject('CLERK_REGISTRATION', { userId: OTHER }), 'filing.draft.read', paper, context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    // A lawyer never holds a paper draft, nor a clerk an electronic one.
    expect(authorize(subject('LAWYER'), 'filing.draft.read', paper, context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(authorize(subject('CLERK_REGISTRATION'), 'filing.draft.read', draft(), context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });

  it('files nothing without payment, and pays nothing twice (memo rows 3 and 5)', () => {
    expect(authorize(subject('LAWYER'), 'filing.draft.submit', draft({ paid: false }), context)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    expect(authorize(subject('LAWYER'), 'filing.draft.submit', draft({ paid: true }), context).allowed).toBe(true);
    expect(authorize(subject('LAWYER'), 'filing.draft.pay', draft({ paid: true }), context)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
  });

  it('changes nothing once filed (memo row 26)', () => {
    for (const action of ['filing.draft.edit', 'filing.draft.pay', 'filing.draft.submit'] as const) {
      expect(authorize(subject('LAWYER'), action, draft({ status: 'FILED', paid: true }), context), action).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    }
    expect(authorize(subject('LAWYER'), 'filing.draft.read', draft({ status: 'FILED', paid: true }), context).allowed).toBe(true);
  });

  it('opens a new draft to a lawyer, and a paper draft to a registry clerk only', () => {
    expect(authorize(subject('LAWYER'), 'filing.new', { kind: 'new-filing' }, context).allowed).toBe(true);
    expect(authorize(subject('CLERK_REGISTRATION'), 'filing.paper', { kind: 'new-filing' }, context).allowed).toBe(true);
    for (const role of ['LAWYER_ASSISTANT', 'CLERK_CASHIER', 'SYSTEM_ADMIN', 'LITIGANT'] as const) {
      expect(authorize(subject(role), 'filing.new', { kind: 'new-filing' }, context).allowed, role).toBe(false);
      expect(authorize(subject(role), 'filing.paper', { kind: 'new-filing' }, context).allowed, role).toBe(false);
    }
    expect(authorize(subject('LAWYER'), 'filing.paper', { kind: 'new-filing' }, context).allowed).toBe(false);
  });
});

describe('the simulated payment page belongs to whoever opened the payment', () => {
  it('lets him settle a pending payment once', () => {
    expect(authorize(subject('LAWYER'), 'payment.simulate', intent(), context).allowed).toBe(true);
    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(authorize(subject('LAWYER'), 'payment.simulate', intent({ status }), context)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    }
  });

  it('shows its page, and the receipt once paid, to whoever opened it', () => {
    for (const status of ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(authorize(subject('LAWYER'), 'payment.view', intent({ status }), context).allowed, status).toBe(true);
    }
    expect(authorize(subject('LAWYER', { userId: OTHER }), 'payment.view', intent(), context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });

  it('answers anyone else as for a payment that does not exist', () => {
    expect(authorize(subject('LAWYER', { userId: OTHER }), 'payment.simulate', intent(), context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(authorize(subject('SYSTEM_ADMIN'), 'payment.simulate', intent(), context)).toEqual({ allowed: false, reason: 'ROLE_NOT_PERMITTED' });
  });
});

describe('the lists of the registry office, the cashier and the prosecution', () => {
  const cases: [string, readonly RoleCode[]][] = [
    ['registry.incoming.list', ['CLERK_REGISTRATION']],
    ['cashier.ledger.view', ['CLERK_CASHIER']],
    ['prosecution.referrals.list', ['PUBLIC_PROSECUTOR']],
    ['registers.commercial.lookup', ['LAWYER', 'CLERK_REGISTRATION']],
    ['filing.drafts.list', ['LAWYER', 'CLERK_REGISTRATION']],
  ];
  for (const [action, roles] of cases) {
    it(`${action}: ${roles.join(', ')} only`, () => {
      for (const role of ['LAWYER', 'LAWYER_ASSISTANT', 'CLERK_REGISTRATION', 'CLERK_CASHIER', 'CHIEF_CLERK', 'COURT_PRESIDENT', 'PUBLIC_PROSECUTOR', 'SYSTEM_ADMIN'] as const) {
        expect(authorize(subject(role), action, undefined, context).allowed, role).toBe(roles.includes(role));
      }
    });
  }

  it('lists files to whoever may open some, never to the administration of the platform', () => {
    expect(authorize(subject('LAWYER'), 'cases.list', undefined, context).allowed).toBe(true);
    expect(authorize(subject('CLERK_REGISTRATION'), 'cases.list', undefined, context).allowed).toBe(true);
    for (const role of ['SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR', 'BAILIFF', 'EXPERT', 'GARNISHEE_BANK', 'LAWYER_ASSISTANT'] as const) {
      expect(authorize(subject(role), 'cases.list', undefined, context).allowed, role).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

const registered = (overrides: Partial<CaseSnapshot> = {}): CaseSnapshot => ({
  caseFileId: OTHER,
  kind: 'FIRST_INSTANCE',
  status: 'REGISTERED',
  courtId: COURT,
  panelId: null,
  administrativeCourt: false,
  rapporteurUserId: null,
  expertUserId: null,
  facts: [],
  parties: [],
  deadlines: [],
  nextSignerUserIds: [],
  minutesNextSignerUserIds: [],
  garnisheeOrganizationIds: [],
  summonsCodeHolderUserIds: [],
  cassationAccreditedUserIds: [],
  ...overrides,
});

describe('the registry office has three buttons and none to reject (acceptance criterion)', () => {
  it('offers exactly «تأشير» «تصحيح التصنيف» «ملاحظة إلى القاضي» on a registered file', () => {
    const codes = availableActions(subject('CLERK_REGISTRATION'), { kind: 'case', snapshot: registered() }, context).map((r) => r.code).sort();
    expect(codes).toEqual(['case.registration.note-to-judge', 'case.registration.reclassify', 'case.registration.stamp']);
  });

  it('has no action rejecting an application anywhere in the table', () => {
    // The registry office's actions are the three of the interface book, no more.
    expect(Object.keys(ACTIONS).filter((code) => code.startsWith('case.registration.')).sort()).toEqual([
      'case.registration.note-to-judge',
      'case.registration.reclassify',
      'case.registration.stamp',
    ]);
    // No action of any holder returns, rejects or refuses an application.
    expect(Object.keys(ACTIONS).filter((code) => /application|filing\.(reject|refuse|return)/.test(code))).toEqual([]);
    expect(authorize(subject('CLERK_REGISTRATION'), 'case.registration.reject', { kind: 'case', snapshot: registered() }, context)).toEqual({
      allowed: false,
      reason: 'UNKNOWN_ACTION',
    });
  });
});

describe('the royal commissioner sees a file only once the application is handed to him (art. 101)', () => {
  const administrative = registered({ administrativeCourt: true, facts: ['REFERRED_TO_COMMISSIONER'] });

  it('opens the referred file of his court, with «إيداع الرأي المكتوب»', () => {
    const commissioner = subject('ROYAL_COMMISSIONER');
    expect(authorize(commissioner, 'case.view', { kind: 'case', snapshot: administrative }, context).allowed).toBe(true);
    expect(availableActions(commissioner, { kind: 'case', snapshot: administrative }, context).map((r) => r.code)).toContain('case.commissioner.opinion');
  });

  it('knows nothing of a file not handed to him, or of another court', () => {
    const commissioner = subject('ROYAL_COMMISSIONER');
    expect(authorize(commissioner, 'case.view', { kind: 'case', snapshot: registered({ administrativeCourt: true }) }, context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
    expect(authorize(subject('ROYAL_COMMISSIONER', { courtId: OTHER_COURT }), 'case.view', { kind: 'case', snapshot: administrative }, context)).toEqual({
      allowed: false,
      reason: 'NOT_FOUND',
    });
    expect(authorize(commissioner, 'case.commissioner.opinion', { kind: 'case', snapshot: registered() }, context)).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });
});
