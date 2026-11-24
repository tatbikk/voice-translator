import { describe, expect, it } from 'vitest';
import {
  ACTION_CODES,
  ACTIONS,
  ROLE_CODES,
  ROLES,
  authorize,
  availableActions,
  resolveLegalBasis,
  type ActionCode,
  type AuthorizationContext,
  type Resource,
  type RoleCode,
  type Subject,
} from '../src/index';

const demo: AuthorizationContext = { mode: 'demo', demoToolsEnabled: true };
const demoNoTools: AuthorizationContext = { mode: 'demo', demoToolsEnabled: false };
const production: AuthorizationContext = { mode: 'production', demoToolsEnabled: false };

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function userSubject(role: RoleCode, roleCount = 1): Subject {
  return {
    kind: 'user',
    userId: USER_ID,
    role,
    roleAssignmentId: '33333333-3333-4333-8333-333333333333',
    courtId: null,
    organizationId: null,
    isDemoAccount: true,
    roleCount,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

const anonymous: Subject = { kind: 'anonymous' };

// The resource each action is checked against, chosen so that every
// resource-level condition passes: the matrix below then isolates the role rule.
const passingResource: Partial<Record<ActionCode, Resource>> = {
  'notifications.mark-read-own': { kind: 'notification', ownerUserId: USER_ID },
  'admin.accounts.create': { kind: 'account-draft', role: 'LAWYER' },
  'admin.accounts.reissue-activation': {
    kind: 'account',
    userId: OTHER_ID,
    isDemo: false,
    activated: false,
    role: 'LAWYER',
  },
  'case.content.view': { kind: 'case', caseFileId: OTHER_ID, relatedUserIds: [USER_ID] },
  'demo.account.switch': { kind: 'demo-account', userId: OTHER_ID, isDemo: true },
};

// Independent statement of who may do what in Phase 0 (contract §4.2). It is
// written out here on purpose, not derived from ACTIONS.
const ALL = 'ALL' as const;
const EXPECTED: Record<ActionCode, readonly RoleCode[] | typeof ALL> = {
  'dashboard.view': ALL,
  'notifications.view-own': ALL,
  'notifications.mark-read-own': ALL,
  'account.view-own': ALL,
  'account.switch-role': ALL, // with two roles; see the dedicated test
  'admin.accounts.list': ['SYSTEM_ADMIN'],
  'admin.accounts.create': ['SYSTEM_ADMIN'],
  'admin.accounts.reissue-activation': ['SYSTEM_ADMIN'],
  'case.content.view': [],
  'demo.accounts.list': ALL,
  'demo.account.switch': ALL,
  'demo.outbox.view': ALL,
};

describe('authorization matrix: every role against every action', () => {
  for (const action of ACTION_CODES) {
    for (const role of ROLE_CODES) {
      const holders = EXPECTED[action];
      const expected = holders === ALL || holders.includes(role);
      it(`${role} ${expected ? 'may' : 'may not'} ${action}`, () => {
        const decision = authorize(userSubject(role, 2), action, passingResource[action], demo);
        expect(decision.allowed).toBe(expected);
      });
    }
  }

  it('covers every action of the table', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACTION_CODES].sort());
  });
});

describe('deny by default', () => {
  it('refuses an unknown action', () => {
    expect(authorize(userSubject('SYSTEM_ADMIN'), 'admin.everything', undefined, demo)).toEqual({
      allowed: false,
      reason: 'UNKNOWN_ACTION',
    });
  });

  it('refuses prototype keys used as action names', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(authorize(userSubject('SYSTEM_ADMIN'), name, undefined, demo).allowed).toBe(false);
    }
  });

  it('refuses every session-bound action to an anonymous visitor', () => {
    for (const action of ACTION_CODES) {
      const rule = ACTIONS[action];
      const decision = authorize(anonymous, action, passingResource[action], demo);
      if (rule.holders === 'ANY_VISITOR') {
        expect(decision.allowed).toBe(true);
      } else {
        expect(decision).toEqual({ allowed: false, reason: 'UNAUTHENTICATED' });
      }
    }
  });

  it('refuses an action applied to the wrong kind of resource, or without its resource', () => {
    expect(authorize(userSubject('LAWYER'), 'notifications.mark-read-own', undefined, demo)).toEqual({
      allowed: false,
      reason: 'NOT_FOUND',
    });
    expect(
      authorize(userSubject('SYSTEM_ADMIN'), 'admin.accounts.create', { kind: 'notification', ownerUserId: USER_ID }, demo),
    ).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });
});

describe('resource conditions', () => {
  it("answers 'not found' for someone else's notification", () => {
    const decision = authorize(
      userSubject('LAWYER'),
      'notifications.mark-read-own',
      { kind: 'notification', ownerUserId: OTHER_ID },
      demo,
    );
    expect(decision).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });

  it('allows a role switch only to a user holding more than one role', () => {
    expect(authorize(userSubject('JUDGE_RAPPORTEUR', 1), 'account.switch-role', undefined, demo)).toEqual({
      allowed: false,
      reason: 'CONDITION_NOT_MET',
    });
    expect(authorize(userSubject('JUDGE_RAPPORTEUR', 2), 'account.switch-role', undefined, demo).allowed).toBe(true);
  });

  it('reissues an activation link only for an account not yet activated', () => {
    const decision = authorize(
      userSubject('SYSTEM_ADMIN'),
      'admin.accounts.reissue-activation',
      { kind: 'account', userId: OTHER_ID, isDemo: false, activated: true, role: 'LAWYER' },
      demo,
    );
    expect(decision).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
  });
});

describe('demo tools', () => {
  it('do not exist in production mode, whoever asks', () => {
    for (const action of ['demo.accounts.list', 'demo.account.switch', 'demo.outbox.view'] as const) {
      for (const subject of [anonymous, userSubject('SYSTEM_ADMIN')]) {
        expect(authorize(subject, action, passingResource[action], production)).toEqual({
          allowed: false,
          reason: 'MODE_NOT_PERMITTED',
        });
        expect(authorize(subject, action, passingResource[action], demoNoTools)).toEqual({
          allowed: false,
          reason: 'MODE_NOT_PERMITTED',
        });
      }
    }
  });

  it('switch only to an account flagged as a demo account, answering "not found" otherwise', () => {
    expect(
      authorize(anonymous, 'demo.account.switch', { kind: 'demo-account', userId: OTHER_ID, isDemo: false }, demo),
    ).toEqual({ allowed: false, reason: 'NOT_FOUND' });
  });
});

describe('permanent invariants (kept in every phase)', () => {
  const caseActions = ACTION_CODES.filter((a) => a.startsWith('case.'));

  it('the system administrator and the rules validator never read case content', () => {
    expect(caseActions.length).toBeGreaterThan(0);
    for (const role of ['SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR'] as const) {
      for (const action of caseActions) {
        const resource: Resource = { kind: 'case', caseFileId: OTHER_ID, relatedUserIds: [USER_ID] };
        expect(authorize(userSubject(role), action, resource, demo).allowed).toBe(false);
      }
    }
  });

  it('availableActions never contains an action that authorize would refuse', () => {
    const resources: (Resource | undefined)[] = [undefined, ...Object.values(passingResource)];
    for (const role of ROLE_CODES) {
      for (const context of [demo, demoNoTools, production]) {
        for (const resource of resources) {
          for (const subject of [userSubject(role, 1), userSubject(role, 2), anonymous]) {
            for (const rule of availableActions(subject, resource, context)) {
              expect(authorize(subject, rule.code, resource, context).allowed).toBe(true);
            }
          }
        }
      }
    }
  });

  it('every action declares its level, its three confirmation lines and a legal basis', () => {
    for (const action of ACTION_CODES) {
      const rule = ACTIONS[action];
      expect(['HUMAN_DECISION', 'SCRIPT', 'AI_ASSIST']).toContain(rule.level);
      expect(rule.labelKey).toBe(`actions.${action}.label`);
      expect(rule.effectKey).toBe(`actions.${action}.effect`);
      expect(rule.notifiedKey).toBe(`actions.${action}.notified`);
      expect(resolveLegalBasis(rule, passingResource[action])).toBeDefined();
    }
  });
});

describe('legal basis of account creation (Law 58.25)', () => {
  const basisOf = (role: RoleCode) =>
    resolveLegalBasis(ACTIONS['admin.accounts.create'], { kind: 'account-draft', role });

  it('rests on article 624 for users of the information system', () => {
    for (const role of ['CLERK_REGISTRATION', 'JUDGE_RAPPORTEUR', 'PUBLIC_PROSECUTOR', 'SYSTEM_ADMIN'] as const) {
      expect(basisOf(role)).toEqual({ kind: 'LAW', law: '58.25', articles: [624] });
    }
  });

  it('rests on article 625 for professional accounts', () => {
    for (const role of ['LAWYER', 'LAWYER_ASSISTANT', 'BAILIFF', 'EXPERT'] as const) {
      expect(basisOf(role)).toEqual({ kind: 'LAW', law: '58.25', articles: [625] });
    }
  });

  it('rests on article 626 for public-law persons and 627 for private-law persons', () => {
    expect(basisOf('PUBLIC_ADMIN_SUPERVISOR')).toEqual({ kind: 'LAW', law: '58.25', articles: [626] });
    expect(basisOf('STATE_JUDICIAL_AGENT')).toEqual({ kind: 'LAW', law: '58.25', articles: [626] });
    expect(basisOf('LITIGANT')).toEqual({ kind: 'LAW', law: '58.25', articles: [627] });
    expect(basisOf('GARNISHEE_BANK')).toEqual({ kind: 'LAW', law: '58.25', articles: [627] });
  });

  it('assigns a basis group to every role', () => {
    for (const role of ROLE_CODES) {
      expect(['INTERNAL', 'PROFESSIONAL', 'PUBLIC_PERSON', 'PRIVATE_PERSON']).toContain(ROLES[role].accountBasis);
    }
  });
});
