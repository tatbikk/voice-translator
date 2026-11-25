// Review P1-S-12: the relation «member of the file's panel» holds for the judges
// and the panel members of that panel only, not for any role assignment that
// happens to carry the panel (a clerk, a prosecutor, a lawyer...). The panel's
// documents (judgment drafts before pronouncement) follow the same rule.
import { describe, expect, it } from 'vitest';
import { PANEL_ROLES, ROLE_CODES, availableActions, documentVisible, holdsRelation, type CaseSnapshot, type RoleCode, type UserSubject } from '../src/index';

const NOW = new Date('2027-03-15T09:30:00Z');
const USER = '11111111-1111-4111-8111-111111111111';
const COURT = '22222222-2222-4222-8222-222222222222';
const PANEL = '33333333-3333-4333-8333-333333333333';
const OTHER_PANEL = '44444444-4444-4444-8444-444444444444';
const RAPPORTEUR = '55555555-5555-4555-8555-555555555555';
const DRAFT = '66666666-6666-4666-8666-666666666666';

const snapshot: CaseSnapshot = {
  caseFileId: '77777777-7777-4777-8777-777777777777',
  kind: 'FIRST_INSTANCE',
  status: 'IN_DELIBERATION',
  courtId: COURT,
  panelId: PANEL,
  administrativeCourt: false,
  rapporteurUserId: RAPPORTEUR,
  expertUserId: null,
  facts: [],
  parties: [],
  deadlines: [],
  nextSignerUserIds: [],
  minutesNextSignerUserIds: [],
  garnisheeOrganizationIds: [],
  summonsCodeHolderUserIds: [],
  cassationAccreditedUserIds: [],
};

function subject(role: RoleCode, panelId: string | null = PANEL): UserSubject {
  return {
    kind: 'user',
    userId: USER,
    role,
    roleAssignmentId: '88888888-8888-4888-8888-888888888888',
    courtId: COURT,
    panelId,
    organizationId: null,
    isDemoAccount: true,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

describe('the panel relation (review P1-S-12)', () => {
  it('names exactly the judges and the members of a panel', () => {
    expect([...PANEL_ROLES].sort()).toEqual(['COUNSELLOR_RAPPORTEUR', 'JUDGE_IN_CHARGE', 'JUDGE_RAPPORTEUR', 'PANEL_MEMBER', 'PANEL_PRESIDENT']);
  });

  for (const role of ROLE_CODES) {
    const expected = PANEL_ROLES.includes(role);
    it(`${role} carrying the file's panel ${expected ? 'holds' : 'does not hold'} the panel relation`, () => {
      expect(holdsRelation(subject(role), snapshot, 'PANEL')).toBe(expected);
    });
  }

  for (const role of PANEL_ROLES) {
    it(`${role} of another panel, or of no panel, does not hold it`, () => {
      expect(holdsRelation(subject(role, OTHER_PANEL), snapshot, 'PANEL')).toBe(false);
      expect(holdsRelation(subject(role, null), snapshot, 'PANEL')).toBe(false);
    });
  }

  it('does not hold on a file without a panel', () => {
    expect(holdsRelation(subject('PANEL_PRESIDENT'), { ...snapshot, panelId: null }, 'PANEL')).toBe(false);
  });

  for (const role of ROLE_CODES.filter((r) => !PANEL_ROLES.includes(r))) {
    it(`${role} carrying the panel does not see the panel's judgment draft`, () => {
      expect(documentVisible(subject(role), snapshot, 'PANEL', DRAFT)).toBe(false);
    });
  }

  it('shows the draft to the president and the members of the panel', () => {
    expect(documentVisible(subject('PANEL_PRESIDENT'), snapshot, 'PANEL', DRAFT)).toBe(true);
    expect(documentVisible(subject('PANEL_MEMBER'), snapshot, 'PANEL', DRAFT)).toBe(true);
  });

  it('grants a clerk carrying the panel none of the panel actions of the deliberation', () => {
    const clerk = subject('CLERK_HEARING');
    const panelSide = availableActions(subject('PANEL_PRESIDENT'), { kind: 'case', snapshot }, { mode: 'demo', demoToolsEnabled: true, now: NOW }).map((a) => a.code);
    const granted = availableActions(clerk, { kind: 'case', snapshot }, { mode: 'demo', demoToolsEnabled: true, now: NOW }).map((a) => a.code);
    expect(panelSide.length).toBeGreaterThan(0);
    expect(granted.filter((code) => panelSide.includes(code))).toEqual([]);
  });
});
