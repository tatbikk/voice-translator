// The model case of the study (شركة ألف للتوريدات ضد شركة باء للصناعة وكفيلها
// السيد جيم), as a sequence of case snapshots, one for each situation of
// model-case-actions.md. The actors are the demo cast; the snapshots are what
// the server builds from the database (src/server/cases/snapshot.ts).
import type {
  AuthorizationContext,
  CaseFact,
  CaseSnapshot,
  DeadlineCode,
  EnvelopeSnapshot,
  PartyFact,
  RoleCode,
  UserSubject,
} from '@mahkama/core';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const COURT = uuid(1);
export const APPEAL_COURT = uuid(2);
export const PANEL = uuid(3);
export const APPEAL_PANEL = uuid(4);
export const LAW_FIRM_A = uuid(5);
export const LAW_FIRM_B = uuid(6);
export const BANK = uuid(7);
export const ADMINISTRATION = uuid(8);

interface Actor {
  readonly role: RoleCode;
  readonly userId: string;
  readonly courtId?: string;
  readonly panelId?: string;
  readonly organizationId?: string;
}

/** The cast, keyed by the name the specification uses. */
export const ACTORS: Readonly<Record<string, Actor>> = {
  'محامية المدعية': { role: 'LAWYER', userId: uuid(101), organizationId: LAW_FIRM_A },
  'محامي المدعى عليهما': { role: 'LAWYER', userId: uuid(102), organizationId: LAW_FIRM_B },
  'محام آخر': { role: 'LAWYER', userId: uuid(103) },
  'مساعد مكتب المدعية': { role: 'LAWYER_ASSISTANT', userId: uuid(104), organizationId: LAW_FIRM_A },
  'رئيس المحكمة': { role: 'COURT_PRESIDENT', userId: uuid(111), courtId: COURT },
  'الرئيس الأول': { role: 'COURT_PRESIDENT', userId: uuid(112), courtId: APPEAL_COURT },
  'القاضي المقرر': { role: 'JUDGE_RAPPORTEUR', userId: uuid(113), courtId: COURT, panelId: PANEL },
  'قاض مقرر آخر': { role: 'JUDGE_RAPPORTEUR', userId: uuid(114), courtId: COURT },
  'رئيس الهيئة': { role: 'PANEL_PRESIDENT', userId: uuid(115), courtId: COURT, panelId: PANEL },
  'عضو الهيئة': { role: 'PANEL_MEMBER', userId: uuid(116), courtId: COURT, panelId: PANEL },
  'المستشار المقرر': { role: 'COUNSELLOR_RAPPORTEUR', userId: uuid(117), courtId: APPEAL_COURT, panelId: APPEAL_PANEL },
  'رئيس هيئة الاستئناف': { role: 'PANEL_PRESIDENT', userId: uuid(118), courtId: APPEAL_COURT, panelId: APPEAL_PANEL },
  'مكتب التقييد': { role: 'CLERK_REGISTRATION', userId: uuid(121), courtId: COURT },
  'الصندوق': { role: 'CLERK_CASHIER', userId: uuid(122), courtId: COURT },
  'مكتب التبليغ': { role: 'CLERK_NOTIFICATION', userId: uuid(123), courtId: COURT },
  'كاتب الجلسة': { role: 'CLERK_HEARING', userId: uuid(124), courtId: COURT },
  'مكتب النسخ والتنفيذ': { role: 'CLERK_COPIES_ENFORCEMENT', userId: uuid(125), courtId: COURT },
  'رئيس كتابة الضبط': { role: 'CHIEF_CLERK', userId: uuid(126), courtId: COURT },
  'مكتب النسخ بمحكمة الاستئناف': { role: 'CLERK_COPIES_ENFORCEMENT', userId: uuid(127), courtId: APPEAL_COURT },
  'النيابة العامة': { role: 'PUBLIC_PROSECUTOR', userId: uuid(131), courtId: COURT },
  'المفوض الملكي': { role: 'ROYAL_COMMISSIONER', userId: uuid(132) },
  'المفوض القضائي': { role: 'BAILIFF', userId: uuid(141), courtId: COURT },
  'مفوض قضائي آخر': { role: 'BAILIFF', userId: uuid(142), courtId: COURT },
  'الخبير': { role: 'EXPERT', userId: uuid(143) },
  'قاضي التنفيذ': { role: 'ENFORCEMENT_JUDGE', userId: uuid(144), courtId: COURT },
  'السيد جيم': { role: 'LITIGANT', userId: uuid(151) },
  'متقاض آخر': { role: 'LITIGANT', userId: uuid(152) },
  'موظف الإدارة العمومية': { role: 'PUBLIC_ADMIN_LITIGATION', userId: uuid(153), organizationId: ADMINISTRATION },
  'البنك المحجوز لديه': { role: 'GARNISHEE_BANK', userId: uuid(154), organizationId: BANK },
  'مدبر النظام': { role: 'SYSTEM_ADMIN', userId: uuid(161) },
  'المختص القانوني': { role: 'RULES_LEGAL_VALIDATOR', userId: uuid(162) },
};

export function subjectOf(name: string): UserSubject {
  const actor = ACTORS[name];
  if (!actor) throw new Error(`unknown actor: ${name}`);
  return {
    kind: 'user',
    userId: actor.userId,
    role: actor.role,
    roleAssignmentId: actor.userId.replace(/^0/, 'a'),
    courtId: actor.courtId ?? null,
    panelId: actor.panelId ?? null,
    organizationId: actor.organizationId ?? null,
    isDemoAccount: true,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

const id = (name: string) => {
  const actor = ACTORS[name];
  if (!actor) throw new Error(`unknown actor: ${name}`);
  return actor.userId;
};

export const PARTY_A = uuid(201);
export const PARTY_B = uuid(202);
export const PARTY_J = uuid(203);
const FIRST_FILE = uuid(301);
const APPEAL_FILE = uuid(302);
const ENFORCEMENT_FILE = uuid(303);

/** 15 March 2027, 10:30 in Morocco (UTC+1): the platform time of every situation. */
export const NOW = new Date('2027-03-15T09:30:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
export const CONTEXT: AuthorizationContext = { mode: 'demo', demoToolsEnabled: true, now: NOW };

interface PartyOptions {
  readonly defenseCounsel?: boolean;
  readonly a?: readonly PartyFact[];
  readonly b?: readonly PartyFact[];
  readonly j?: readonly PartyFact[];
  readonly jLitigant?: boolean;
}

function parties(options: PartyOptions = {}): CaseSnapshot['parties'] {
  const defense = options.defenseCounsel ? [id('محامي المدعى عليهما')] : [];
  return [
    { partyId: PARTY_A, side: 'PLAINTIFF', counselUserIds: [id('محامية المدعية')], litigantUserId: null, organizationId: null, facts: options.a ?? [] },
    { partyId: PARTY_B, side: 'DEFENDANT', counselUserIds: defense, litigantUserId: null, organizationId: null, facts: options.b ?? [] },
    {
      partyId: PARTY_J,
      side: 'GUARANTOR',
      counselUserIds: defense,
      litigantUserId: options.jLitigant ? id('السيد جيم') : null,
      organizationId: null,
      facts: options.j ?? [],
    },
  ];
}

interface SnapshotOptions extends PartyOptions {
  readonly status: CaseSnapshot['status'];
  readonly kind?: CaseSnapshot['kind'];
  readonly facts?: readonly CaseFact[];
  readonly rapporteur?: boolean;
  readonly expert?: boolean;
  readonly deadlines?: readonly { code: DeadlineCode; partyId?: string | null; endsInDays: number }[];
  readonly nextSigner?: string;
  readonly minutesNextSigner?: string;
  readonly garnishee?: boolean;
  readonly summonsCodeHolder?: boolean;
}

function snapshot(options: SnapshotOptions): CaseSnapshot {
  const kind = options.kind ?? 'FIRST_INSTANCE';
  const appeal = kind === 'APPEAL';
  return {
    caseFileId: kind === 'APPEAL' ? APPEAL_FILE : kind === 'ENFORCEMENT' ? ENFORCEMENT_FILE : FIRST_FILE,
    kind,
    status: options.status,
    courtId: appeal ? APPEAL_COURT : COURT,
    panelId: kind === 'ENFORCEMENT' ? null : appeal ? APPEAL_PANEL : PANEL,
    administrativeCourt: false,
    rapporteurUserId: options.rapporteur === false ? null : appeal ? id('المستشار المقرر') : id('القاضي المقرر'),
    expertUserId: options.expert ? id('الخبير') : null,
    facts: options.facts ?? [],
    parties: kind === 'ENFORCEMENT' ? enforcementParties(options) : parties(options),
    deadlines: (options.deadlines ?? []).map((d) => ({ code: d.code, partyId: d.partyId ?? null, endsAt: days(d.endsInDays) })),
    nextSignerUserIds: options.nextSigner ? [id(options.nextSigner)] : [],
    minutesNextSignerUserIds: options.minutesNextSigner ? [id(options.minutesNextSigner)] : [],
    garnisheeOrganizationIds: options.garnishee ? [BANK] : [],
    summonsCodeHolderUserIds: options.summonsCodeHolder ? [id('محامي المدعى عليهما')] : [],
    cassationAccreditedUserIds: [id('محامي المدعى عليهما')],
  };
}

function enforcementParties(options: PartyOptions): CaseSnapshot['parties'] {
  return [
    { partyId: PARTY_A, side: 'ENFORCEMENT_CREDITOR', counselUserIds: [id('محامية المدعية')], litigantUserId: null, organizationId: null, facts: options.a ?? [] },
    { partyId: PARTY_B, side: 'ENFORCEMENT_DEBTOR', counselUserIds: [id('محامي المدعى عليهما')], litigantUserId: null, organizationId: null, facts: options.b ?? [] },
  ];
}

const served: PartyFact[] = ['SERVED'];
const defenseServed = { a: served, b: served, j: served, defenseCounsel: true } as const;

/** Every situation of the specification, by its code. */
export const SITUATIONS: Readonly<Record<string, CaseSnapshot>> = {
  S01: snapshot({ status: 'REGISTERED', rapporteur: false }),
  S02: snapshot({ status: 'REGISTERED', rapporteur: false, facts: ['REGISTRATION_STAMPED'] }),
  S03: snapshot({ status: 'RAPPORTEUR_ASSIGNED', facts: ['REGISTRATION_STAMPED'] }),
  S04: snapshot({ status: 'RAPPORTEUR_ASSIGNED', facts: ['REGISTRATION_STAMPED', 'HEARING_SET'] }),
  S05: snapshot({ status: 'IN_NOTIFICATION', facts: ['REGISTRATION_STAMPED', 'HEARING_SET', 'ENVELOPES_READY'] }),
  S06: snapshot({
    status: 'IN_NOTIFICATION',
    facts: ['REGISTRATION_STAMPED', 'HEARING_SET', 'SERVICE_FAILED_ADDRESS'],
    a: served,
    b: served,
    j: ['SERVICE_FAILED'],
    summonsCodeHolder: true,
  }),
  S07: snapshot({ status: 'IN_PREPARATION', facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT'], ...defenseServed }),
  S08: snapshot({
    status: 'IN_EXPERTISE',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'INVESTIGATION_ONGOING'],
    ...defenseServed,
    a: ['SERVED', 'DEPOSIT_DUE'],
    deadlines: [
      { code: 'INVESTIGATION_DEPOSIT', partyId: PARTY_A, endsInDays: 9 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_A, endsInDays: 4 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_B, endsInDays: 4 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_J, endsInDays: 4 },
    ],
  }),
  S09: snapshot({
    status: 'IN_EXPERTISE',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'INVESTIGATION_ONGOING'],
    ...defenseServed,
    a: ['SERVED', 'DEPOSIT_DUE'],
    deadlines: [
      { code: 'INVESTIGATION_DEPOSIT', partyId: PARTY_A, endsInDays: -1 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_A, endsInDays: -6 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_B, endsInDays: -6 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_J, endsInDays: -6 },
    ],
  }),
  S10: snapshot({
    status: 'IN_EXPERTISE',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'INVESTIGATION_ONGOING', 'DEPOSIT_MADE'],
    ...defenseServed,
    deadlines: [
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_A, endsInDays: 2 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_B, endsInDays: 2 },
      { code: 'EXPERT_CHALLENGE', partyId: PARTY_J, endsInDays: 2 },
      { code: 'EXPERT_REPORT', endsInDays: 40 },
    ],
  }),
  S11: snapshot({
    status: 'IN_EXPERTISE',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'INVESTIGATION_ONGOING', 'DEPOSIT_MADE', 'MISSION_ACCEPTED'],
    ...defenseServed,
    deadlines: [{ code: 'EXPERT_REPORT', endsInDays: 30 }],
  }),
  S12: snapshot({
    status: 'IN_EXPERTISE',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'INVESTIGATION_ONGOING', 'DEPOSIT_MADE', 'MISSION_ACCEPTED', 'EXPERT_PARTIES_SUMMONED'],
    ...defenseServed,
    deadlines: [{ code: 'EXPERT_REPORT', endsInDays: 20 }],
  }),
  S13: snapshot({
    status: 'IN_EXPERTISE',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'INVESTIGATION_ONGOING', 'DEPOSIT_MADE', 'MISSION_ACCEPTED', 'EXPERT_PARTIES_SUMMONED'],
    ...defenseServed,
    deadlines: [{ code: 'EXPERT_REPORT', endsInDays: -2 }],
  }),
  S14: snapshot({
    status: 'IN_PREPARATION',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'REPORT_DEPOSITED'],
    ...defenseServed,
  }),
  S15: snapshot({
    status: 'IN_PREPARATION',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'REPORT_DEPOSITED', 'FEE_STATEMENT_FILED'],
    ...defenseServed,
  }),
  S16: snapshot({
    status: 'IN_PREPARATION',
    expert: true,
    facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'REPORT_DEPOSITED', 'FEE_STATEMENT_FILED', 'FEES_ORDERED'],
    ...defenseServed,
    deadlines: [{ code: 'FEE_OBJECTION', endsInDays: 7 }],
  }),
  S17: snapshot({
    status: 'READY',
    facts: ['ELECTRONIC_DOCUMENT', 'REPORT_DEPOSITED', 'FEES_PAID', 'HEARING_SET', 'HEARING_UPCOMING'],
    ...defenseServed,
  }),
  S18: snapshot({
    status: 'READY',
    facts: ['ELECTRONIC_DOCUMENT', 'REPORT_DEPOSITED', 'FEES_PAID', 'HEARING_SET', 'HEARING_IN_SESSION'],
    ...defenseServed,
  }),
  S19: snapshot({
    status: 'IN_DELIBERATION',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'MINUTES_RECORDED'],
    ...defenseServed,
    minutesNextSigner: 'كاتب الجلسة',
  }),
  S20: snapshot({
    status: 'IN_DELIBERATION',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'MINUTES_SIGNED', 'JUDGMENT_DRAFTED', 'SIGNATURE_CIRCLE_OPEN'],
    ...defenseServed,
    nextSigner: 'رئيس الهيئة',
  }),
  S21: snapshot({
    status: 'IN_DELIBERATION',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'MINUTES_SIGNED', 'JUDGMENT_DRAFTED', 'SIGNATURE_CIRCLE_OPEN'],
    ...defenseServed,
    nextSigner: 'القاضي المقرر',
  }),
  S22: snapshot({
    status: 'IN_DELIBERATION',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'MINUTES_SIGNED', 'JUDGMENT_DRAFTED', 'SIGNATURE_CIRCLE_OPEN'],
    ...defenseServed,
    nextSigner: 'كاتب الجلسة',
  }),
  S23: snapshot({
    status: 'IN_DELIBERATION',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'MINUTES_SIGNED', 'JUDGMENT_DRAFTED', 'SIGNATURES_COMPLETE', 'PRONOUNCEMENT_DAY'],
    ...defenseServed,
  }),
  S24: snapshot({
    status: 'JUDGMENT_ISSUED',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'JUDGMENT_PRONOUNCED'],
    defenseCounsel: true,
    a: ['ATTENDED_PRONOUNCEMENT', 'JUDGMENT_CREDITOR'],
    b: ['ATTENDED_PRONOUNCEMENT'],
    j: [],
  }),
  S25: snapshot({
    status: 'JUDGMENT_ISSUED',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED'],
    defenseCounsel: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR'],
    b: ['JUDGMENT_SERVED'],
    j: ['JUDGMENT_SERVED'],
    deadlines: [
      { code: 'APPEAL', partyId: PARTY_A, endsInDays: 20 },
      { code: 'APPEAL', partyId: PARTY_B, endsInDays: 20 },
      { code: 'APPEAL', partyId: PARTY_J, endsInDays: 25 },
    ],
  }),
  // The same file once every appeal limit has run out, nobody having appealed (independent review IR-18).
  S27: snapshot({
    status: 'JUDGMENT_ISSUED',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED'],
    defenseCounsel: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR'],
    b: ['JUDGMENT_SERVED'],
    j: ['JUDGMENT_SERVED'],
    deadlines: [
      { code: 'APPEAL', partyId: PARTY_A, endsInDays: -1 },
      { code: 'APPEAL', partyId: PARTY_B, endsInDays: -1 },
      { code: 'APPEAL', partyId: PARTY_J, endsInDays: -1 },
    ],
  }),
  S26: snapshot({
    status: 'UNDER_APPEAL',
    facts: ['REPORT_DEPOSITED', 'FEES_PAID', 'JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED', 'ENFORCEMENT_SUSPENDED'],
    defenseCounsel: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR'],
    b: ['JUDGMENT_SERVED', 'APPEALED'],
    j: ['JUDGMENT_SERVED', 'APPEALED'],
  }),
  A01: snapshot({ kind: 'APPEAL', status: 'REGISTERED', rapporteur: false, ...defenseServed }),
  A02: snapshot({ kind: 'APPEAL', status: 'RAPPORTEUR_ASSIGNED', ...defenseServed }),
  A03: snapshot({ kind: 'APPEAL', status: 'RAPPORTEUR_ASSIGNED', facts: ['HEARING_SET'], ...defenseServed }),
  A04: snapshot({
    kind: 'APPEAL',
    status: 'READY',
    facts: ['HEARING_SET', 'HEARING_UPCOMING', 'INVESTIGATION_HELD', 'ELECTRONIC_DOCUMENT'],
    ...defenseServed,
  }),
  A05: snapshot({
    kind: 'APPEAL',
    status: 'JUDGMENT_ISSUED',
    facts: ['JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED', 'DECISION_FINAL'],
    defenseCounsel: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR'],
    b: ['JUDGMENT_SERVED'],
    j: ['JUDGMENT_SERVED'],
    deadlines: [
      { code: 'CASSATION', partyId: PARTY_A, endsInDays: 20 },
      { code: 'CASSATION', partyId: PARTY_B, endsInDays: 20 },
      { code: 'CASSATION', partyId: PARTY_J, endsInDays: 20 },
    ],
  }),
  A06: snapshot({
    kind: 'APPEAL',
    status: 'JUDGMENT_ISSUED',
    facts: ['JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED', 'DECISION_FINAL', 'EXECUTORY_COPY_REQUESTED'],
    defenseCounsel: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR'],
    b: ['JUDGMENT_SERVED'],
    j: ['JUDGMENT_SERVED'],
    deadlines: [
      { code: 'CASSATION', partyId: PARTY_A, endsInDays: -1 },
      { code: 'CASSATION', partyId: PARTY_B, endsInDays: -1 },
      { code: 'CASSATION', partyId: PARTY_J, endsInDays: -1 },
    ],
  }),
  A07: snapshot({
    kind: 'APPEAL',
    status: 'JUDGMENT_ISSUED',
    facts: ['JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED', 'DECISION_FINAL'],
    defenseCounsel: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR', 'HOLDS_EXECUTORY_COPY'],
    b: ['JUDGMENT_SERVED'],
    j: ['JUDGMENT_SERVED'],
    deadlines: [
      { code: 'CASSATION', partyId: PARTY_A, endsInDays: -1 },
      { code: 'CASSATION', partyId: PARTY_B, endsInDays: -1 },
      { code: 'CASSATION', partyId: PARTY_J, endsInDays: -1 },
    ],
  }),
  E01: snapshot({ kind: 'ENFORCEMENT', status: 'REGISTERED', rapporteur: false }),
  E02: snapshot({ kind: 'ENFORCEMENT', status: 'IN_ENFORCEMENT', rapporteur: false, facts: ['DEMAND_ORDERED', 'DEBTOR_REQUESTED_DELAY'] }),
  E03: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'DEBTOR_REQUESTED_DELAY', 'SETTLEMENT_OFFERED'],
  }),
  E04: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'SETTLEMENT_REJECTED', 'GARNISHMENT_MADE'],
    garnishee: true,
    deadlines: [{ code: 'GARNISHMENT_NOTICE', endsInDays: 1 }],
  }),
  E05: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'SETTLEMENT_REJECTED', 'GARNISHMENT_MADE', 'GARNISHMENT_NOTIFIED'],
    garnishee: true,
    deadlines: [{ code: 'GARNISHEE_DECLARATION', endsInDays: 6 }],
  }),
  E06: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'SETTLEMENT_REJECTED', 'GARNISHMENT_MADE', 'GARNISHMENT_NOTIFIED', 'GARNISHEE_DECLARED'],
    garnishee: true,
    deadlines: [{ code: 'GARNISHMENT_DISPUTE', endsInDays: 10 }],
  }),
  E07: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'SETTLEMENT_REJECTED', 'GARNISHMENT_MADE', 'GARNISHMENT_NOTIFIED', 'GARNISHEE_DECLARED'],
    garnishee: true,
    deadlines: [{ code: 'GARNISHMENT_DISPUTE', endsInDays: -1 }],
  }),
  E08: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'SETTLEMENT_REJECTED', 'GARNISHMENT_MADE', 'GARNISHMENT_NOTIFIED', 'GARNISHEE_DECLARED', 'FUNDS_DELIVERED', 'FUNDS_IN_TREASURY'],
    garnishee: true,
  }),
  E09: snapshot({
    kind: 'ENFORCEMENT',
    status: 'IN_ENFORCEMENT',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'SETTLEMENT_REJECTED', 'GARNISHMENT_MADE', 'GARNISHMENT_NOTIFIED', 'GARNISHEE_DECLARED', 'FUNDS_DELIVERED', 'FUNDS_TRANSFERRED', 'DEBT_SATISFIED'],
    garnishee: true,
  }),
  E10: snapshot({
    kind: 'ENFORCEMENT',
    status: 'CLOSED',
    rapporteur: false,
    facts: ['DEMAND_ORDERED', 'GARNISHMENT_MADE', 'GARNISHEE_DECLARED', 'FUNDS_DELIVERED', 'FUNDS_TRANSFERRED', 'DEBT_SATISFIED', 'RELEASE_ORDERED'],
    garnishee: true,
  }),
  L01: snapshot({ status: 'IN_PREPARATION', facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT'], ...defenseServed, jLitigant: true, j: ['SERVED', 'E_SERVICE_ACCEPTED'] }),
  L02: snapshot({
    status: 'JUDGMENT_ISSUED',
    facts: ['JUDGMENT_PRONOUNCED', 'ACCOUNT_SERVICE_ANSWERED'],
    defenseCounsel: true,
    jLitigant: true,
    a: ['JUDGMENT_SERVED', 'JUDGMENT_CREDITOR'],
    b: ['JUDGMENT_SERVED'],
    j: ['JUDGMENT_SERVED', 'E_SERVICE_ACCEPTED', 'PAYMENT_DUE'],
    deadlines: [
      { code: 'APPEAL', partyId: PARTY_A, endsInDays: 20 },
      { code: 'APPEAL', partyId: PARTY_B, endsInDays: 20 },
      { code: 'APPEAL', partyId: PARTY_J, endsInDays: 20 },
    ],
  }),
  P01: snapshot({ status: 'IN_PREPARATION', facts: ['HEARING_SET', 'ELECTRONIC_DOCUMENT', 'REFERRED_TO_PROSECUTION'], ...defenseServed }),
};

const ENVELOPE = uuid(401);
const envelope = (status: EnvelopeSnapshot['status'], purpose: EnvelopeSnapshot['purpose'], facts: EnvelopeSnapshot['facts'] = [], deadlines: EnvelopeSnapshot['deadlines'] = []): EnvelopeSnapshot => ({
  envelopeId: ENVELOPE,
  caseFileId: purpose === 'ENFORCEMENT' ? ENFORCEMENT_FILE : FIRST_FILE,
  purpose,
  agentUserId: id('المفوض القضائي'),
  status,
  facts,
  deadlines,
});

/** The bailiff's envelopes: summons (V) and enforcement (X). */
export const ENVELOPE_SITUATIONS: Readonly<Record<string, EnvelopeSnapshot>> = {
  V01: envelope('DISPATCHED', 'SERVICE'),
  V02: envelope('IN_PROGRESS', 'SERVICE'),
  V03: envelope('DONE', 'SERVICE'),
  X01: envelope('DISPATCHED', 'ENFORCEMENT'),
  X02: envelope('IN_PROGRESS', 'ENFORCEMENT'),
  X03: envelope('IN_PROGRESS', 'ENFORCEMENT', ['DEMAND_RECORDED', 'DEBTOR_REFUSED'], [{ code: 'EXECUTORY_SEIZURE', partyId: null, endsAt: days(3) }]),
};
