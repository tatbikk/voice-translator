// The declarative table of the procedure (prompt, «النواة: آلة الحالات ومحركات
// الحساب»). One entry per button of the study, by station. Each entry states
// the five elements of a transition: who holds it (role and relation with the
// file), its conditions, its effects (next state, time limits opened), its level
// and its legal basis; then whether it requires a signature before its effect,
// and whether it awaits its holder («ينتظر إجراء مني»). The labels and the
// three lines of each confirmation window are i18n keys actions.<code>.*.
// docs/state-machine.md is generated from this file (npm run docs:state-machine)
// and a test checks that the committed file matches.
import type { ActionLevel } from '../actions';
import type { RoleCode } from '../roles';
import type { Condition, EnvelopeCondition, Holder, Relation } from './conditions';
import type { CaseFact, DeadlineCode } from './snapshot';
import { statusesBetween, type CaseKind, type CaseStatus } from './states';

export type ProcedureResource = 'case' | 'envelope' | 'new-filing' | 'own-contact';

/** Who is informed of an act (the second line of its confirmation window, made executable; review P1-A-05). */
export type NotifyTarget =
  /** the judge or counsellor rapporteur, once assigned */
  | 'RAPPORTEUR'
  /** the rapporteur, or before his assignment the president of the court */
  | 'RAPPORTEUR_OR_PRESIDENT'
  /** the lawyers of the parties */
  | 'COUNSEL';

/** The kinds of document an act adds to the file. */
export type FiledDocumentType = 'PROSECUTION_CONCLUSIONS' | 'COMMISSIONER_OPINION';

export interface ProcedureAction {
  readonly code: string;
  /** station of the model case (1 to 11), 0 for actions of the litigant's own space */
  readonly station: number;
  readonly resource: ProcedureResource;
  readonly kinds: readonly CaseKind[];
  readonly statuses: readonly CaseStatus[];
  readonly holders: readonly Holder[];
  readonly when: readonly Condition[];
  readonly envelopeWhen: readonly EnvelopeCondition[];
  readonly level: ActionLevel;
  readonly articles: readonly number[];
  readonly signature: boolean;
  readonly awaited: boolean;
  /** false for an access (opening a space) rather than a procedural act */
  readonly changesState: boolean;
  readonly nextStatus: CaseStatus | null;
  readonly opens: readonly DeadlineCode[];
  /** effects (review P1-A-05): the facts the act establishes */
  readonly sets: readonly CaseFact[];
  /** the time limits the act closes */
  readonly closes: readonly DeadlineCode[];
  /** who is informed of it */
  readonly notifies: readonly NotifyTarget[];
  /** the document it adds to the file */
  readonly files: FiledDocumentType | null;
}

type Definition = Partial<Omit<ProcedureAction, 'code' | 'station' | 'statuses' | 'holders' | 'articles'>> &
  Pick<ProcedureAction, 'statuses' | 'holders' | 'articles'>;

const JUDGES: readonly RoleCode[] = ['JUDGE_RAPPORTEUR', 'JUDGE_IN_CHARGE', 'COUNSELLOR_RAPPORTEUR'];
const h = (roles: readonly RoleCode[], ...relations: Relation[]): Holder => ({ roles, relations });
const counsel = h(['LAWYER'], 'COUNSEL');
const rapporteur = h(JUDGES, 'RAPPORTEUR');
const president = h(['COURT_PRESIDENT'], 'COURT_STAFF');
const panelPresident = h(['PANEL_PRESIDENT'], 'PANEL');
const staff = (role: RoleCode) => h([role], 'COURT_STAFF');
const expert = h(['EXPERT'], 'EXPERT');
const enforcementJudge = h(['ENFORCEMENT_JUDGE'], 'COURT_STAFF');
const bank = h(['GARNISHEE_BANK'], 'GARNISHEE');
const bailiff = h(['BAILIFF'], 'AGENT');
const litigant = h(['LITIGANT'], 'LITIGANT');

const between = statusesBetween;
const ALL_COURT: readonly CaseKind[] = ['FIRST_INSTANCE', 'APPEAL'];
const ENFORCEMENT: readonly CaseKind[] = ['ENFORCEMENT'];

const table: [code: string, station: number, definition: Definition][] = [];
const at = (station: number, code: string, definition: Definition) => table.push([code, station, definition]);

// ---------------------------------------------------------------------------
// Station 2: registration, and the prosecution

at(2, 'case.registration.stamp', {
  statuses: ['REGISTERED'], holders: [staff('CLERK_REGISTRATION')], when: [{ notFact: 'REGISTRATION_STAMPED' }],
  articles: [76, 628], awaited: true, sets: ['REGISTRATION_STAMPED'],
});
at(2, 'case.registration.reclassify', {
  statuses: ['REGISTERED'], holders: [staff('CLERK_REGISTRATION')], when: [{ notFact: 'REGISTRATION_STAMPED' }], articles: [628],
  notifies: ['RAPPORTEUR', 'COUNSEL'],
});
at(2, 'case.registration.note-to-judge', {
  statuses: between('REGISTERED', 'READY'), holders: [staff('CLERK_REGISTRATION')], articles: [619],
  notifies: ['RAPPORTEUR_OR_PRESIDENT'],
});
at(2, 'case.prosecution.view', {
  statuses: between('REGISTERED', 'READY'), holders: [h(['PUBLIC_PROSECUTOR'], 'PROSECUTION')], articles: [18, 20],
  changesState: false, level: 'SCRIPT',
});
at(2, 'case.prosecution.conclusions', {
  statuses: between('REGISTERED', 'READY'), holders: [h(['PUBLIC_PROSECUTOR'], 'PROSECUTION')], articles: [21],
  files: 'PROSECUTION_CONCLUSIONS', notifies: ['RAPPORTEUR', 'COUNSEL'],
});
at(2, 'case.commissioner.opinion', {
  statuses: between('REGISTERED', 'READY'), holders: [h(['ROYAL_COMMISSIONER'], 'COMMISSIONER')], when: [{ administrativeCourt: true }],
  articles: [101, 107], files: 'COMMISSIONER_OPINION', notifies: ['RAPPORTEUR', 'COUNSEL'],
});

// ---------------------------------------------------------------------------
// Station 3: the judge rapporteur (the counsellor rapporteur on appeal)

at(3, 'case.rapporteur.confirm', {
  statuses: ['REGISTERED'], holders: [president], when: [{ rapporteur: 'NONE' }], articles: [101, 628],
  signature: true, awaited: true, nextStatus: 'RAPPORTEUR_ASSIGNED',
});
at(3, 'case.rapporteur.assign-other', {
  statuses: ['REGISTERED'], holders: [president], when: [{ rapporteur: 'NONE' }], articles: [101, 628],
  signature: true, awaited: true, nextStatus: 'RAPPORTEUR_ASSIGNED',
});
at(3, 'case.rapporteur.change', {
  statuses: between('RAPPORTEUR_ASSIGNED', 'READY'), holders: [president], when: [{ rapporteur: 'ASSIGNED' }],
  articles: [101, 628], signature: true,
});

// ---------------------------------------------------------------------------
// Station 4: hearing, summons and service

at(4, 'case.order.cure-defects', {
  statuses: ['RAPPORTEUR_ASSIGNED', 'IN_NOTIFICATION', 'IN_PREPARATION'], holders: [rapporteur], articles: [77],
  signature: true, opens: ['CURE_DEFECTS'],
});
at(4, 'case.hearing.set', {
  statuses: ['RAPPORTEUR_ASSIGNED'], holders: [rapporteur], when: [{ notFact: 'HEARING_SET' }], articles: [81, 88, 89],
  awaited: true,
});
at(4, 'case.summons.order', {
  kinds: ['FIRST_INSTANCE'], statuses: ['RAPPORTEUR_ASSIGNED'], holders: [rapporteur], when: [{ fact: 'HEARING_SET' }],
  articles: [81, 101, 629], signature: true, awaited: true, nextStatus: 'IN_NOTIFICATION',
});
at(4, 'case.address.lookup', {
  statuses: ['IN_NOTIFICATION', 'IN_PREPARATION'], holders: [rapporteur], when: [{ fact: 'SERVICE_FAILED_ADDRESS' }],
  articles: [86], awaited: true,
});
at(4, 'case.envelopes.dispatch', {
  statuses: between('IN_NOTIFICATION', 'UNDER_APPEAL'), holders: [staff('CLERK_NOTIFICATION')], when: [{ fact: 'ENVELOPES_READY' }],
  articles: [83, 629], level: 'SCRIPT', awaited: true,
});
at(4, 'case.certificate.record-paper', {
  statuses: between('IN_NOTIFICATION', 'UNDER_APPEAL'), holders: [staff('CLERK_NOTIFICATION')],
  when: [{ fact: 'PAPER_CERTIFICATE_PENDING' }], articles: [83, 85], awaited: true,
});

// The bailiff's envelope (station 4: service; station 11: enforcement).
at(4, 'envelope.start', {
  resource: 'envelope', statuses: [], holders: [bailiff], envelopeWhen: [{ envelopeStatus: 'DISPATCHED' }], articles: [83, 634],
  awaited: true,
});
for (const outcome of ['served', 'refused', 'unknown-at-address', 'moved'] as const) {
  at(4, `envelope.certificate.${outcome}`, {
    resource: 'envelope', statuses: [], holders: [bailiff],
    envelopeWhen: [{ purpose: 'SERVICE' }, { envelopeStatus: 'IN_PROGRESS' }], articles: outcome === 'served' || outcome === 'refused' ? [84, 85] : [85, 86],
    awaited: true,
  });
}

// ---------------------------------------------------------------------------
// Station 5: preparation and exchange of briefs

const preparation = between('IN_NOTIFICATION', 'READY');
at(5, 'case.counsel.appear', {
  statuses: between('IN_NOTIFICATION', 'IN_DELIBERATION'), holders: [h(['LAWYER'], 'SUMMONS_HOLDER')], articles: [102, 630],
  signature: true,
});
at(5, 'case.brief.file', { statuses: preparation, holders: [counsel], articles: [103, 106, 630, 631], signature: true });
at(5, 'case.exhibit.file', { statuses: preparation, holders: [counsel], articles: [631], signature: true });
at(5, 'case.extension.request', { statuses: preparation, holders: [counsel], articles: [6, 104] });
at(5, 'case.address.change-notice', {
  kinds: ['FIRST_INSTANCE', 'APPEAL', 'ENFORCEMENT'], statuses: between('REGISTERED', 'IN_ENFORCEMENT'), holders: [counsel], articles: [77],
});
at(5, 'case.order.reply-deadline', {
  statuses: ['IN_PREPARATION', 'IN_EXPERTISE'], holders: [rapporteur], articles: [6], opens: ['REPLY'],
});
at(5, 'case.order.produce-document', {
  statuses: ['IN_PREPARATION', 'IN_EXPERTISE'], holders: [rapporteur], articles: [105, 122], signature: true,
});
at(5, 'case.order.produce-original', {
  statuses: ['IN_PREPARATION', 'IN_EXPERTISE'], holders: [rapporteur], when: [{ fact: 'ELECTRONIC_DOCUMENT' }], articles: [631],
});
at(5, 'case.declare-ready', {
  statuses: ['IN_PREPARATION'], holders: [rapporteur], when: [{ notFact: 'INVESTIGATION_ONGOING' }], articles: [106],
  signature: true, awaited: true, nextStatus: 'READY',
});

// ---------------------------------------------------------------------------
// Station 6: investigation, the expertise

const expertise: readonly CaseStatus[] = ['IN_EXPERTISE'];
const depositLapsed: Condition = {
  anyParty: { facts: ['DEPOSIT_DUE'], deadline: { code: 'INVESTIGATION_DEPOSIT', state: 'ELAPSED' } },
};
at(6, 'case.investigation.order', {
  statuses: ['IN_PREPARATION'], holders: [rapporteur], when: [{ notFact: 'INVESTIGATION_ONGOING' }],
  articles: [105, 116, 119, 123, 124], signature: true, nextStatus: 'IN_EXPERTISE',
  opens: ['INVESTIGATION_DEPOSIT', 'EXPERT_CHALLENGE', 'EXPERT_REPORT'],
});
at(6, 'case.investigation.deposit', {
  statuses: expertise, holders: [counsel],
  when: [
    { notFact: 'DEPOSIT_MADE' },
    {
      clientParty: {
        anyOf: [
          { facts: ['DEPOSIT_DUE'], deadline: { code: 'INVESTIGATION_DEPOSIT', state: 'OPEN' } },
          { facts: ['DEPOSIT_AUTHORIZED'] },
        ],
      },
    },
  ],
  articles: [119], awaited: true,
});
at(6, 'case.investigation.authorize-other-party', {
  statuses: expertise, holders: [rapporteur], when: [{ notFact: 'DEPOSIT_MADE' }, { notFact: 'DEPOSIT_OTHER_AUTHORIZED' }, depositLapsed],
  articles: [119], awaited: true,
});
at(6, 'case.investigation.abandon', {
  statuses: expertise, holders: [rapporteur], when: [{ notFact: 'DEPOSIT_MADE' }, depositLapsed], articles: [119],
  nextStatus: 'IN_PREPARATION',
});
at(6, 'case.expert.challenge', {
  statuses: expertise, holders: [counsel], when: [{ clientParty: { deadline: { code: 'EXPERT_CHALLENGE', state: 'OPEN' } } }],
  articles: [126], opens: ['CHALLENGE_RULING'],
});
at(6, 'case.expert.accept', {
  statuses: expertise, holders: [expert],
  when: [{ fact: 'DEPOSIT_MADE' }, { notFact: 'MISSION_ACCEPTED' }, { notFact: 'MISSION_DECLINED' }], articles: [126],
  signature: true, awaited: true,
});
at(6, 'case.expert.decline', {
  statuses: expertise, holders: [expert],
  when: [{ fact: 'DEPOSIT_MADE' }, { notFact: 'MISSION_ACCEPTED' }, { notFact: 'MISSION_DECLINED' }], articles: [126],
});
at(6, 'case.expert.summon-parties', {
  statuses: expertise, holders: [expert], when: [{ fact: 'MISSION_ACCEPTED' }, { notFact: 'EXPERT_PARTIES_SUMMONED' }],
  articles: [127], awaited: true, opens: ['EXPERT_SUMMONS_NOTICE'],
});
at(6, 'case.expert.attendance-minutes', {
  statuses: expertise, holders: [expert], when: [{ fact: 'EXPERT_PARTIES_SUMMONED' }, { notFact: 'ATTENDANCE_MINUTES_FILED' }],
  articles: [127], signature: true,
});
at(6, 'case.expert.request-extension', {
  statuses: expertise, holders: [expert], when: [{ fact: 'MISSION_ACCEPTED' }, { notFact: 'REPORT_DEPOSITED' }], articles: [124],
});
at(6, 'case.expert.deposit-report', {
  statuses: expertise, holders: [expert], when: [{ fact: 'EXPERT_PARTIES_SUMMONED' }, { notFact: 'REPORT_DEPOSITED' }],
  articles: [124, 631], signature: true, awaited: true, nextStatus: 'IN_PREPARATION',
});
at(6, 'case.expert.supplement', {
  statuses: ['IN_EXPERTISE', 'IN_PREPARATION'], holders: [expert], when: [{ fact: 'REPORT_RETURNED' }], articles: [128],
  signature: true, awaited: true,
});
at(6, 'case.expert.fee-statement', {
  statuses: ['IN_EXPERTISE', 'IN_PREPARATION'], holders: [expert], when: [{ fact: 'REPORT_DEPOSITED' }, { notFact: 'FEE_STATEMENT_FILED' }],
  articles: [120],
});
at(6, 'case.expert.replace', {
  statuses: expertise, holders: [rapporteur],
  when: [
    {
      anyOf: [
        { fact: 'MISSION_DECLINED' },
        { anyOf: [{ deadline: 'EXPERT_REPORT', state: 'ELAPSED' }], },
      ],
    },
    { notFact: 'REPORT_DEPOSITED' },
  ],
  articles: [125], signature: true, awaited: true,
});
at(6, 'case.expert.return-report', {
  statuses: ['IN_PREPARATION'], holders: [rapporteur], when: [{ fact: 'REPORT_DEPOSITED' }, { notFact: 'REPORT_RETURNED' }],
  articles: [128],
});
at(6, 'case.expert.fix-fees', {
  statuses: ['IN_PREPARATION'], holders: [rapporteur], when: [{ fact: 'FEE_STATEMENT_FILED' }, { notFact: 'FEES_ORDERED' }],
  articles: [120, 197], signature: true, awaited: true, opens: ['FEE_OBJECTION'],
});
at(6, 'case.expert.object-fees', {
  statuses: between('IN_PREPARATION', 'IN_DELIBERATION'), holders: [counsel, expert],
  when: [{ fact: 'FEES_ORDERED' }, { deadline: 'FEE_OBJECTION', state: 'OPEN' }], articles: [197],
});
at(6, 'case.expert.pay-fees', {
  statuses: between('IN_PREPARATION', 'JUDGMENT_ISSUED'), holders: [staff('CLERK_CASHIER')],
  when: [{ fact: 'FEES_ORDERED' }, { notFact: 'FEES_PAID' }], articles: [120], level: 'SCRIPT', awaited: true,
});

// ---------------------------------------------------------------------------
// Station 7: the hearing

at(7, 'case.hearing.request-remote', {
  statuses: ['READY'], holders: [counsel], when: [{ fact: 'HEARING_UPCOMING' }, { clientParty: { notFacts: ['REMOTE_REQUESTED'] } }],
  articles: [90], signature: true,
});
at(7, 'case.hearing.adjourn', {
  statuses: ['READY'], holders: [panelPresident], when: [{ fact: 'HEARING_IN_SESSION' }], articles: [104], awaited: true,
});
at(7, 'case.hearing.return-to-rapporteur', {
  statuses: ['READY'], holders: [panelPresident], when: [{ fact: 'HEARING_IN_SESSION' }], articles: [104], awaited: true,
  nextStatus: 'IN_PREPARATION', opens: ['RETURN_TO_HEARING'],
});
at(7, 'case.hearing.reserve', {
  statuses: ['READY'], holders: [panelPresident], when: [{ fact: 'HEARING_IN_SESSION' }], articles: [108], awaited: true,
  nextStatus: 'IN_DELIBERATION',
});
at(7, 'case.hearing.reopen', {
  statuses: ['READY', 'IN_DELIBERATION'], holders: [panelPresident], when: [{ notFact: 'JUDGMENT_PRONOUNCED' }], articles: [106],
  nextStatus: 'IN_PREPARATION',
});
at(7, 'case.minutes.record', {
  statuses: between('READY', 'JUDGMENT_ISSUED'), holders: [staff('CLERK_HEARING')],
  when: [{ anyOf: [{ fact: 'HEARING_IN_SESSION' }, { fact: 'HEARING_HELD' }] }, { notFact: 'MINUTES_RECORDED' }],
  articles: [91], awaited: true,
});
at(7, 'case.minutes.sign', {
  statuses: between('READY', 'JUDGMENT_ISSUED'),
  holders: [h(['CLERK_HEARING'], 'COURT_STAFF', 'MINUTES_SIGNER'), h(['PANEL_PRESIDENT'], 'PANEL', 'MINUTES_SIGNER')],
  when: [{ fact: 'MINUTES_RECORDED' }, { notFact: 'MINUTES_SIGNED' }], articles: [91], signature: true, awaited: true,
});

// ---------------------------------------------------------------------------
// Station 8: deliberation and judgment

at(8, 'case.deliberation.open', {
  statuses: ['IN_DELIBERATION'], holders: [h(['PANEL_PRESIDENT', 'PANEL_MEMBER'], 'PANEL'), rapporteur], articles: [108],
  changesState: false, level: 'HUMAN_DECISION',
});
at(8, 'case.judgment.draft', {
  statuses: ['IN_DELIBERATION'], holders: [rapporteur],
  when: [{ notFact: 'SIGNATURE_CIRCLE_OPEN' }, { notFact: 'SIGNATURES_COMPLETE' }], articles: [109], awaited: true,
});
at(8, 'case.judgment.sign', {
  statuses: ['IN_DELIBERATION'],
  holders: [
    h(['PANEL_PRESIDENT'], 'PANEL', 'NEXT_SIGNER'),
    h(JUDGES, 'RAPPORTEUR', 'NEXT_SIGNER'),
    h(['CLERK_HEARING'], 'COURT_STAFF', 'NEXT_SIGNER'),
  ],
  when: [{ fact: 'SIGNATURE_CIRCLE_OPEN' }], articles: [110, 632], signature: true, awaited: true,
});
at(8, 'case.judgment.sign-substitute', {
  statuses: ['IN_DELIBERATION'], holders: [president], when: [{ fact: 'SINGLE_JUDGE' }, { fact: 'SIGNER_IMPEDED' }],
  articles: [110], signature: true, awaited: true,
});

// ---------------------------------------------------------------------------
// Station 9: pronouncement, service and copies

const afterJudgment = between('JUDGMENT_ISSUED', 'CLOSED');
at(9, 'case.judgment.pronounce', {
  statuses: ['IN_DELIBERATION'], holders: [panelPresident], when: [{ fact: 'SIGNATURES_COMPLETE' }, { fact: 'PRONOUNCEMENT_DAY' }],
  articles: [108, 109, 112], awaited: true, nextStatus: 'JUDGMENT_ISSUED',
});
at(9, 'case.judgment.serve-in-hearing', {
  statuses: ['JUDGMENT_ISSUED'], holders: [staff('CLERK_HEARING')],
  when: [{ anyParty: { facts: ['ATTENDED_PRONOUNCEMENT'], notFacts: ['JUDGMENT_SERVED'] } }], articles: [111], awaited: true,
  opens: ['APPEAL'],
});
at(9, 'case.judgment.accept-account-service', {
  statuses: ['JUDGMENT_ISSUED'], holders: [counsel], when: [{ fact: 'JUDGMENT_PRONOUNCED' }, { notFact: 'ACCOUNT_SERVICE_ANSWERED' }],
  articles: [633],
});
at(9, 'case.judgment.request-service', {
  statuses: ['JUDGMENT_ISSUED', 'UNDER_APPEAL'], holders: [counsel],
  when: [{ fact: 'JUDGMENT_PRONOUNCED' }, { anyParty: { notFacts: ['JUDGMENT_SERVED'] } }], articles: [115, 634],
});
at(9, 'case.copy.request', {
  statuses: afterJudgment, holders: [counsel, litigant], when: [{ fact: 'JUDGMENT_PRONOUNCED' }], articles: [114, 637],
});
at(9, 'case.copy.deliver', {
  statuses: afterJudgment, holders: [staff('CLERK_COPIES_ENFORCEMENT')], when: [{ fact: 'COPY_REQUEST_PENDING' }],
  articles: [114, 637], level: 'SCRIPT', awaited: true,
});
at(9, 'case.copy.third-party.deliver', {
  statuses: afterJudgment, holders: [staff('CHIEF_CLERK')], when: [{ fact: 'THIRD_PARTY_COPY_PENDING' }], articles: [114], awaited: true,
});
at(9, 'case.copy.third-party.refuse', {
  statuses: afterJudgment, holders: [staff('CHIEF_CLERK')], when: [{ fact: 'THIRD_PARTY_COPY_PENDING' }], articles: [114], awaited: true,
});
at(9, 'case.copy.third-party.rule', {
  statuses: afterJudgment, holders: [president], when: [{ fact: 'THIRD_PARTY_COPY_REFUSED' }], articles: [114], awaited: true,
});

// ---------------------------------------------------------------------------
// Station 10: appeal and cassation

at(10, 'case.appeal.file', {
  kinds: ['FIRST_INSTANCE'], statuses: ['JUDGMENT_ISSUED'], holders: [counsel],
  when: [{ fact: 'JUDGMENT_PRONOUNCED' }, { clientParty: { notFacts: ['APPEALED'], deadline: { code: 'APPEAL', state: 'NOT_ELAPSED' } } }],
  articles: [204, 214, 216], signature: true, nextStatus: 'UNDER_APPEAL', opens: ['APPEAL_TRANSMISSION'],
});
at(10, 'case.appeal.order-service', {
  kinds: ['APPEAL'], statuses: ['RAPPORTEUR_ASSIGNED'], holders: [h(['COUNSELLOR_RAPPORTEUR'], 'RAPPORTEUR')],
  when: [{ fact: 'HEARING_SET' }], articles: [352, 353], signature: true, awaited: true, nextStatus: 'IN_NOTIFICATION',
});
at(10, 'case.appeal.counsellor-report', {
  kinds: ['APPEAL'], statuses: ['READY'], holders: [h(['COUNSELLOR_RAPPORTEUR'], 'RAPPORTEUR')],
  when: [{ fact: 'INVESTIGATION_HELD' }, { notFact: 'COUNSELLOR_REPORT_FILED' }], articles: [364], signature: true, awaited: true,
});
at(10, 'case.cassation.file', {
  kinds: ['APPEAL'], statuses: ['JUDGMENT_ISSUED'], holders: [h(['LAWYER'], 'COUNSEL', 'CASSATION_ACCREDITED')],
  when: [{ fact: 'JUDGMENT_PRONOUNCED' }, { clientParty: { notFacts: ['APPEALED'], deadline: { code: 'CASSATION', state: 'OPEN' } } }],
  articles: [376, 378, 380], signature: true, nextStatus: 'UNDER_APPEAL',
});

// ---------------------------------------------------------------------------
// Station 11: enforcement

const enforceable: Condition = { anyOf: [{ fact: 'DECISION_FINAL' }, { fact: 'PROVISIONAL_ENFORCEMENT' }] };
at(11, 'case.executory-copy.request', {
  statuses: ['JUDGMENT_ISSUED', 'UNDER_APPEAL'], holders: [counsel],
  when: [
    enforceable,
    { notFact: 'EXECUTORY_COPY_REQUESTED' },
    { deadline: 'ENFORCEABILITY', state: 'NOT_ELAPSED' },
    { clientParty: { facts: ['JUDGMENT_CREDITOR'], notFacts: ['HOLDS_EXECUTORY_COPY'] } },
  ],
  articles: [449],
});
at(11, 'case.executory-copy.issue', {
  statuses: ['JUDGMENT_ISSUED', 'UNDER_APPEAL'], holders: [staff('CLERK_COPIES_ENFORCEMENT')], when: [{ fact: 'EXECUTORY_COPY_REQUESTED' }],
  articles: [449, 457], signature: true, awaited: true,
});
at(11, 'case.executory-copy.second', {
  statuses: afterJudgment, holders: [president], when: [{ fact: 'SECOND_EXECUTORY_COPY_REQUESTED' }], articles: [463], awaited: true,
});
at(11, 'case.enforcement.request', {
  statuses: ['JUDGMENT_ISSUED', 'UNDER_APPEAL'], holders: [counsel],
  when: [
    enforceable,
    { notFact: 'ENFORCEMENT_SUSPENDED' },
    { notFact: 'ENFORCEMENT_REQUESTED' },
    { clientParty: { facts: ['HOLDS_EXECUTORY_COPY'] } },
  ],
  articles: [480, 481], signature: true,
});

const enforcing: readonly CaseStatus[] = ['IN_ENFORCEMENT'];
const creditorCounsel: Condition = { clientParty: { sides: ['ENFORCEMENT_CREDITOR'] } };
const enforcementAction = (code: string, definition: Omit<Definition, 'kinds' | 'statuses'> & { statuses?: readonly CaseStatus[] }) =>
  at(11, code, { kinds: ENFORCEMENT, statuses: enforcing, ...definition });

enforcementAction('case.enforcement.order-demand', {
  statuses: ['REGISTERED'], holders: [enforcementJudge], when: [{ notFact: 'DEMAND_ORDERED' }], articles: [476, 485, 486],
  signature: true, awaited: true, nextStatus: 'IN_ENFORCEMENT', opens: ['ENFORCEMENT_DEMAND'],
});
enforcementAction('case.enforcement.authorize-asset-search', {
  holders: [enforcementJudge], when: [{ notFact: 'DEBT_SATISFIED' }], articles: [467], signature: true,
});
enforcementAction('case.enforcement.offer-settlement', {
  holders: [enforcementJudge], when: [{ fact: 'DEBTOR_REQUESTED_DELAY' }, { notFact: 'SETTLEMENT_OFFERED' }], articles: [486, 488],
  awaited: true,
});
enforcementAction('case.enforcement.accept-settlement', {
  holders: [counsel], when: [creditorCounsel, { fact: 'SETTLEMENT_OFFERED' }, { notFact: 'SETTLEMENT_ACCEPTED' }, { notFact: 'SETTLEMENT_REJECTED' }],
  articles: [488], awaited: true,
});
enforcementAction('case.enforcement.reject-settlement', {
  holders: [counsel], when: [creditorCounsel, { fact: 'SETTLEMENT_OFFERED' }, { notFact: 'SETTLEMENT_ACCEPTED' }, { notFact: 'SETTLEMENT_REJECTED' }],
  articles: [488], awaited: true,
});
enforcementAction('case.enforcement.approve-settlement', {
  holders: [enforcementJudge], when: [{ fact: 'SETTLEMENT_ACCEPTED' }, { notFact: 'SETTLEMENT_APPROVED' }], articles: [488],
  signature: true, awaited: true,
});
enforcementAction('case.enforcement.authorize-entry', {
  holders: [enforcementJudge], when: [{ notFact: 'DEBT_SATISFIED' }], articles: [485], signature: true,
});
enforcementAction('case.enforcement.refer-to-judge', { holders: [counsel], when: [creditorCounsel], articles: [476] });
enforcementAction('case.enforcement.garnishment-notice', {
  holders: [staff('CLERK_COPIES_ENFORCEMENT')], when: [{ fact: 'GARNISHMENT_MADE' }, { notFact: 'GARNISHMENT_NOTIFIED' }],
  articles: [578], level: 'SCRIPT', awaited: true, opens: ['GARNISHEE_DECLARATION'],
});
enforcementAction('case.enforcement.garnishee-declaration', {
  holders: [bank], when: [{ fact: 'GARNISHMENT_NOTIFIED' }, { notFact: 'GARNISHEE_DECLARED' }], articles: [576, 579], awaited: true,
  opens: ['GARNISHMENT_DISPUTE'],
});
enforcementAction('case.enforcement.dispute-garnishment', {
  holders: [counsel],
  when: [
    { clientParty: { sides: ['ENFORCEMENT_DEBTOR'] } },
    { fact: 'GARNISHEE_DECLARED' },
    { notFact: 'GARNISHMENT_DISPUTED' },
    { deadline: 'GARNISHMENT_DISPUTE', state: 'OPEN' },
  ],
  articles: [580],
});
enforcementAction('case.enforcement.rule-dispute', {
  holders: [enforcementJudge], when: [{ fact: 'GARNISHMENT_DISPUTED' }, { notFact: 'DISPUTE_RULED' }], articles: [580],
  signature: true, awaited: true,
});
enforcementAction('case.enforcement.deliver-funds', {
  holders: [bank],
  when: [
    { fact: 'GARNISHEE_DECLARED' },
    { notFact: 'FUNDS_DELIVERED' },
    {
      anyOf: [
        { fact: 'DISPUTE_RULED' },
        { anyOf: [{ deadline: 'GARNISHMENT_DISPUTE', state: 'ELAPSED' }] },
      ],
    },
    { anyOf: [{ notFact: 'GARNISHMENT_DISPUTED' }, { fact: 'DISPUTE_RULED' }] },
  ],
  articles: [580], awaited: true,
});
enforcementAction('case.enforcement.rule-difficulty', {
  holders: [enforcementJudge], when: [{ fact: 'DIFFICULTY_RAISED' }, { notFact: 'DIFFICULTY_RULED' }], articles: [492],
  signature: true, awaited: true,
});
enforcementAction('case.enforcement.provisional-difficulty', {
  holders: [president], when: [{ fact: 'PROVISIONAL_DIFFICULTY_FILED' }], articles: [491], signature: true, awaited: true,
});
enforcementAction('case.enforcement.transfer-funds', {
  holders: [staff('CLERK_CASHIER')], when: [{ fact: 'FUNDS_IN_TREASURY' }, { notFact: 'FUNDS_TRANSFERRED' }], articles: [593],
  level: 'SCRIPT', awaited: true, opens: [],
});
enforcementAction('case.enforcement.close', {
  holders: [enforcementJudge], when: [{ fact: 'DEBT_SATISFIED' }], articles: [476, 634], signature: true, awaited: true,
  nextStatus: 'CLOSED',
});
enforcementAction('case.enforcement.confirm-release', {
  statuses: ['CLOSED'], holders: [bank], when: [{ fact: 'RELEASE_ORDERED' }, { notFact: 'RELEASE_CONFIRMED' }], articles: [580],
  awaited: true,
});

// The bailiff's enforcement envelope (station 11).
const enforcementEnvelope = (code: string, articles: number[], extra: readonly EnvelopeCondition[] = []) =>
  at(11, code, {
    resource: 'envelope', statuses: [], holders: [bailiff],
    envelopeWhen: [{ purpose: 'ENFORCEMENT' }, { envelopeStatus: 'IN_PROGRESS' }, ...extra], articles, awaited: true,
  });
for (const outcome of ['complied', 'asked-delay', 'refused', 'unable'] as const) {
  enforcementEnvelope(`envelope.demand.${outcome}`, [486], [{ notEnvelopeFact: 'DEMAND_RECORDED' }]);
}
enforcementEnvelope('envelope.collect', [487]);
enforcementEnvelope('envelope.executory-seizure', [489], [
  { envelopeFact: 'DEBTOR_REFUSED' },
  { envelopeDeadline: 'EXECUTORY_SEIZURE', state: 'OPEN' },
]);
enforcementEnvelope('envelope.garnishment', [575, 576], [{ envelopeFact: 'DEBTOR_REFUSED' }]);
enforcementEnvelope('envelope.raise-difficulty', [492]);

// ---------------------------------------------------------------------------
// The litigant (interface book, «واجهة المتقاضي»)

at(0, 'case.litigant.documents', {
  kinds: ['FIRST_INSTANCE', 'APPEAL', 'ENFORCEMENT'], statuses: between('REGISTERED', 'CLOSED'), holders: [litigant],
  articles: [627], changesState: false, level: 'SCRIPT',
});
at(0, 'case.litigant.pay', {
  kinds: ['FIRST_INSTANCE', 'APPEAL', 'ENFORCEMENT'], statuses: between('REGISTERED', 'CLOSED'), holders: [litigant],
  when: [{ clientParty: { facts: ['PAYMENT_DUE'] } }], articles: [628], awaited: true,
});

// ---------------------------------------------------------------------------
// Actions outside a file: built with their screens (filing, Phase 2; the
// litigant's account, Phase 3). Declared here so that the table is complete.

at(1, 'filing.new', { resource: 'new-filing', statuses: [], holders: [h(['LAWYER'])], articles: [76, 77, 628], signature: true });
at(1, 'filing.paper', { resource: 'new-filing', statuses: [], holders: [h(['CLERK_REGISTRATION'])], articles: [76, 631] });
at(0, 'litigant.accept-e-service', { resource: 'own-contact', statuses: [], holders: [h(['LITIGANT'])], articles: [627] });
at(0, 'litigant.change-contact', { resource: 'own-contact', statuses: [], holders: [h(['LITIGANT'])], articles: [627] });

export const PROCEDURE_ACTIONS: readonly ProcedureAction[] = table.map(([code, station, d]) => ({
  code,
  station,
  resource: d.resource ?? 'case',
  kinds: d.kinds ?? (d.resource === 'envelope' ? [] : ALL_COURT),
  statuses: d.statuses,
  holders: d.holders,
  when: d.when ?? [],
  envelopeWhen: d.envelopeWhen ?? [],
  level: d.level ?? 'HUMAN_DECISION',
  articles: d.articles,
  signature: d.signature ?? false,
  awaited: d.awaited ?? false,
  changesState: d.changesState ?? true,
  nextStatus: d.nextStatus ?? null,
  opens: d.opens ?? [],
  sets: d.sets ?? [],
  closes: d.closes ?? [],
  notifies: d.notifies ?? [],
  files: d.files ?? null,
}));
