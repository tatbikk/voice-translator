// The scopes of the lists (independent review IR-11), written before the code:
// a list selects, in its query, the files the subject is related to and those
// in the state where an act awaits him, from the very tables the single
// authorization function reads; it never takes the newest files and filters
// them. Each scope is derived from the table, never written for a role.
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  CASE_VIEW_HOLDERS,
  PROCEDURE_ACTIONS,
  ROLE_CODES,
  actionScope,
  awaitedScope,
  holdsRelation,
  statusesBetween,
  subjectMayHold,
  viewScope,
  type CaseSnapshot,
  type Relation,
  type RoleCode,
  type UserSubject,
} from '../src/index';

const COURT = '44444444-4444-4444-8444-444444444444';

function subjectOf(role: RoleCode): UserSubject {
  return {
    kind: 'user',
    userId: '11111111-1111-4111-8111-111111111111',
    role,
    roleAssignmentId: '33333333-3333-4333-8333-333333333333',
    courtId: COURT,
    panelId: null,
    organizationId: null,
    isDemoAccount: true,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

const relationsOf = (scope: ReturnType<typeof viewScope>) => scope.map((branch) => [...branch.relations]);

describe('the files a list may show (case.view)', () => {
  it('are those of the relations through which the role opens a file, whatever their state', () => {
    expect(relationsOf(viewScope(subjectOf('LAWYER')))).toEqual([['COUNSEL']]);
    expect(relationsOf(viewScope(subjectOf('CLERK_REGISTRATION')))).toEqual([['COURT_STAFF']]);
    expect(relationsOf(viewScope(subjectOf('PUBLIC_PROSECUTOR')))).toEqual([['PROSECUTION']]);
    expect(relationsOf(viewScope(subjectOf('JUDGE_RAPPORTEUR')))).toEqual([['RAPPORTEUR'], ['PANEL']]);
    for (const branch of viewScope(subjectOf('JUDGE_RAPPORTEUR'))) {
      expect(branch.statuses).toBeNull();
      expect(branch.kinds).toBeNull();
      expect(branch.when).toEqual([]);
    }
  });

  it('follow the holders of «case.view» for every role, and are none for a role that never opens a file', () => {
    expect(ACTIONS['case.view'].caseHolders).toBe(CASE_VIEW_HOLDERS);
    for (const role of ['SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR', 'BAILIFF', 'EXPERT', 'GARNISHEE_BANK'] as const) {
      expect(viewScope(subjectOf(role)), role).toEqual([]);
    }
    for (const holder of CASE_VIEW_HOLDERS) {
      for (const role of holder.roles) expect(relationsOf(viewScope(subjectOf(role))), role).toContainEqual([...holder.relations]);
    }
  });
});

describe('the files in which an act awaits the subject («ينتظر إجراء مني»)', () => {
  it('for the registry office: «مقيد» and not stamped, the state of «تأشير»', () => {
    const stamp = ACTIONS['case.registration.stamp']?.procedure;
    expect(awaitedScope(subjectOf('CLERK_REGISTRATION'))).toEqual([
      { relations: ['COURT_STAFF'], statuses: ['REGISTERED'], kinds: stamp?.kinds, when: [{ notFact: 'REGISTRATION_STAMPED' }] },
    ]);
  });

  it('for the court president: «مقيد» without a rapporteur, from his two awaited acts', () => {
    const scope = awaitedScope(subjectOf('COURT_PRESIDENT'));
    expect(scope).toContainEqual({ relations: ['COURT_STAFF'], statuses: ['REGISTERED'], kinds: ['FIRST_INSTANCE', 'APPEAL'], when: [{ rapporteur: 'NONE' }] });
  });

  it('has one branch for every awaited act on a file whose holders include the role, with its relations, states, kinds and conditions', () => {
    for (const role of ['LAWYER', 'CLERK_NOTIFICATION', 'JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT', 'ENFORCEMENT_JUDGE'] as const) {
      const expected = PROCEDURE_ACTIONS.filter((a) => a.resource === 'case' && a.awaited).flatMap((a) =>
        a.holders.filter((h) => h.roles.includes(role)).map((h) => ({ relations: h.relations, statuses: a.statuses, kinds: a.kinds, when: a.when })),
      );
      expect(expected.length, role).toBeGreaterThan(0);
      expect(awaitedScope(subjectOf(role)), role).toEqual(expected);
    }
  });

  it('never reaches an act on an envelope, which is not a file', () => {
    expect(awaitedScope(subjectOf('BAILIFF'))).toEqual([]);
  });
});

describe('the files in which the subject may do one act', () => {
  it('for the prosecution: its referral, while it may still file its conclusions (art. 21)', () => {
    expect(actionScope(subjectOf('PUBLIC_PROSECUTOR'), 'case.prosecution.conclusions')).toEqual([
      { relations: ['PROSECUTION'], statuses: statusesBetween('REGISTERED', 'READY'), kinds: ['FIRST_INSTANCE', 'APPEAL'], when: [] },
    ]);
  });

  it('is none for a role that does not hold the act, for an unknown act, and for an act that is not of the procedure', () => {
    expect(actionScope(subjectOf('LAWYER'), 'case.prosecution.conclusions')).toEqual([]);
    expect(actionScope(subjectOf('PUBLIC_PROSECUTOR'), 'case.no-such-act')).toEqual([]);
    expect(actionScope(subjectOf('PUBLIC_PROSECUTOR'), 'case.view')).toEqual([]);
  });
});

// Review of the IR-11 fix: the query of a list reads, for each relation, what
// it asks of the subject alone (his role, court, panel, organization) from the
// core, not from a copy in the server; and the core's single authorization
// function asks exactly that, whatever the file.
describe('what a relation asks of the subject alone', () => {
  const USER = '11111111-1111-4111-8111-111111111111';
  const PANEL = '55555555-5555-4555-8555-555555555555';
  const ORG = '66666666-6666-4666-8666-666666666666';
  // A file that grants every relation on its side to the user.
  const party = (counsel: boolean) => ({
    partyId: '77777777-7777-4777-8777-777777777777',
    side: 'PLAINTIFF' as const,
    counselUserIds: counsel ? [USER] : [],
    litigantUserId: USER,
    organizationId: ORG,
    facts: ['E_SERVICE_ACCEPTED' as const],
  });
  const everything = (counsel: boolean): CaseSnapshot => ({
    caseFileId: '88888888-8888-4888-8888-888888888888',
    kind: 'FIRST_INSTANCE',
    status: 'IN_DELIBERATION',
    courtId: COURT,
    panelId: PANEL,
    administrativeCourt: true,
    rapporteurUserId: USER,
    expertUserId: USER,
    facts: ['REFERRED_TO_PROSECUTION', 'REFERRED_TO_COMMISSIONER'],
    parties: [party(counsel)],
    deadlines: [],
    nextSignerUserIds: [USER],
    minutesNextSignerUserIds: [USER],
    garnisheeOrganizationIds: [ORG],
    summonsCodeHolderUserIds: [USER],
    cassationAccreditedUserIds: [USER],
  });
  const RELATIONS: readonly Relation[] = [
    'COUNSEL', 'SUMMONS_HOLDER', 'RAPPORTEUR', 'PANEL', 'COURT_STAFF', 'PROSECUTION', 'COMMISSIONER', 'EXPERT', 'LITIGANT',
    'ADMIN_PARTY', 'GARNISHEE', 'NEXT_SIGNER', 'MINUTES_SIGNER', 'CASSATION_ACCREDITED', 'AGENT',
  ];

  it('is what the authorization function asks of him on a file that grants everything else, for every role and relation', () => {
    for (const role of ROLE_CODES) {
      for (const courtId of [COURT, null]) {
        for (const panelId of [PANEL, null]) {
          for (const organizationId of [ORG, null]) {
            const subject: UserSubject = { ...subjectOf(role), userId: USER, courtId, panelId, organizationId };
            for (const relation of RELATIONS) {
              const held = holdsRelation(subject, everything(true), relation) || holdsRelation(subject, everything(false), relation);
              expect(subjectMayHold(subject, relation), `${role} ${relation} court=${String(courtId)} panel=${String(panelId)} org=${String(organizationId)}`).toBe(held);
            }
          }
        }
      }
    }
  });

  it('names the role, the court and the panel where the relation needs them', () => {
    expect(subjectMayHold(subjectOf('LAWYER'), 'RAPPORTEUR')).toBe(false);
    expect(subjectMayHold(subjectOf('JUDGE_RAPPORTEUR'), 'RAPPORTEUR')).toBe(true);
    expect(subjectMayHold({ ...subjectOf('JUDGE_RAPPORTEUR'), courtId: null }, 'RAPPORTEUR')).toBe(false);
    expect(subjectMayHold(subjectOf('PANEL_PRESIDENT'), 'PANEL')).toBe(false);
    expect(subjectMayHold({ ...subjectOf('PANEL_PRESIDENT'), panelId: PANEL }, 'PANEL')).toBe(true);
    expect(subjectMayHold(subjectOf('CLERK_HEARING'), 'COUNSEL')).toBe(false);
    expect(subjectMayHold(subjectOf('BAILIFF'), 'AGENT')).toBe(false);
  });
});
