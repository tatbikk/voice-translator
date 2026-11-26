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
  actionScope,
  awaitedScope,
  statusesBetween,
  viewScope,
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
    expect(ACTIONS['case.view']?.caseHolders).toBe(CASE_VIEW_HOLDERS);
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
