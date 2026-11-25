// Phase 2 in the core (docs/phases/phase-2.md, docs/security/phase-2-memo.md):
// the case card and its schema, the check before signature (art. 77, 605, 631),
// the authorization of a draft and of a payment, the relation of the royal
// commissioner, and the absence of any action rejecting an application.
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  CARD_SECTIONS,
  FilingCardSchema,
  authorize,
  availableActions,
  preSignatureChecks,
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
const ON = '2026-11-25';
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

  it('blocks only on what the filing cannot do without: the application, the nature of each exhibit, the attestation', () => {
    expect(checksOf({ application: { present: false, fixedCopyReady: false } }).map((c) => c.code)).toContain('APPLICATION_MISSING');
    expect(checksOf({ application: { present: true, fixedCopyReady: false } }).map((c) => c.code)).toContain('FIXED_COPY_NOT_READY');
    const nature = checksOf({ documents: [{ id: 'e1', kind: 'EXHIBIT', declaredNature: null, pageCount: null, paperOriginalLocation: null }] });
    expect(nature).toContainEqual(expect.objectContaining({ code: 'EXHIBIT_NATURE_MISSING', level: 'BLOCKING', article: 631 }));
    const unattested = checksOf({ attested: ['PLAINTIFFS', 'CLAIMS'] });
    expect(unattested.filter((c) => c.code === 'SECTION_NOT_ATTESTED').map((c) => c.section).sort()).toEqual(['DEFENDANTS', 'SUMMARY']);
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
