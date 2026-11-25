import { describe, expect, it } from 'vitest';
import {
  deadlineState,
  ACTION_CODES,
  ACTIONS,
  ROLE_CODES,
  ROLES,
  authorize,
  availableActions,
  resolveLegalBasis,
  type AuthorizationContext,
  type Resource,
  type RoleCode,
  type Subject,
} from '../src/index';

const NOW = new Date('2027-03-15T09:30:00Z');
const demo: AuthorizationContext = { mode: 'demo', demoToolsEnabled: true, now: NOW };
const demoNoTools: AuthorizationContext = { mode: 'demo', demoToolsEnabled: false, now: NOW };
const production: AuthorizationContext = { mode: 'production', demoToolsEnabled: false, now: NOW };

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function userSubject(role: RoleCode, roleCount = 1): Subject {
  return {
    kind: 'user',
    userId: USER_ID,
    role,
    roleAssignmentId: '33333333-3333-4333-8333-333333333333',
    courtId: null,
    panelId: null,
    organizationId: null,
    isDemoAccount: true,
    roleCount,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

const anonymous: Subject = { kind: 'anonymous' };

// The resource each action is checked against, chosen so that every
// resource-level condition passes: the matrix below then isolates the role rule.
// A file the subject counsels in, and the snapshot of a file in preparation.
const counselledCase: Resource = {
  kind: 'case',
  snapshot: {
    caseFileId: OTHER_ID,
    kind: 'FIRST_INSTANCE',
    status: 'IN_PREPARATION',
    courtId: OTHER_ID,
    panelId: null,
    administrativeCourt: false,
    rapporteurUserId: null,
    expertUserId: null,
    facts: [],
    parties: [{ partyId: OTHER_ID, side: 'PLAINTIFF', counselUserIds: [USER_ID], litigantUserId: null, organizationId: null, facts: [] }],
    deadlines: [],
    nextSignerUserIds: [],
    minutesNextSignerUserIds: [],
    garnisheeOrganizationIds: [],
    summonsCodeHolderUserIds: [],
    cassationAccreditedUserIds: [],
  },
};

const passingResource: Partial<Record<string, Resource>> = {
  'notifications.mark-read-own': { kind: 'notification', ownerUserId: USER_ID },
  'admin.accounts.create': { kind: 'account-draft', role: 'LAWYER' },
  'admin.accounts.reissue-activation': {
    kind: 'account',
    userId: OTHER_ID,
    isDemo: false,
    activated: false,
    disabled: false,
    role: 'LAWYER',
  },
  'case.view': counselledCase,
  'case.actions.list': counselledCase,
  'case.document.read': { ...counselledCase, kind: 'case-document', visibility: 'CASE', documentId: OTHER_ID },
  'demo.account.switch': { kind: 'demo-account', userId: OTHER_ID, isDemo: true },
  // Phase 2: a draft of the subject's own, not yet paid (filing it needs a paid one), and its payment.
  'filing.draft.read': { kind: 'filing-draft', ownerUserId: USER_ID, channel: 'ELECTRONIC', courtId: null, status: 'DRAFT', paid: false },
  'filing.draft.edit': { kind: 'filing-draft', ownerUserId: USER_ID, channel: 'ELECTRONIC', courtId: null, status: 'DRAFT', paid: false },
  'filing.draft.pay': { kind: 'filing-draft', ownerUserId: USER_ID, channel: 'ELECTRONIC', courtId: null, status: 'DRAFT', paid: false },
  'filing.draft.submit': { kind: 'filing-draft', ownerUserId: USER_ID, channel: 'ELECTRONIC', courtId: null, status: 'DRAFT', paid: true },
  'payment.simulate': { kind: 'payment-intent', ownerUserId: USER_ID, status: 'PENDING' },
  'payment.view': { kind: 'payment-intent', ownerUserId: USER_ID, status: 'SUCCEEDED' },
};

// Independent statement of who may do what in Phase 0 (contract §4.2). It is
// written out here on purpose, not derived from ACTIONS.
const ALL = 'ALL' as const;
const EXPECTED: Record<(typeof ACTION_CODES)[number], readonly RoleCode[] | typeof ALL> = {
  'dashboard.view': ALL,
  'notifications.view-own': ALL,
  'notifications.mark-read-own': ALL,
  'account.view-own': ALL,
  'account.switch-role': ALL, // with two roles; see the dedicated test
  'admin.accounts.list': ['SYSTEM_ADMIN'],
  'admin.accounts.create': ['SYSTEM_ADMIN'],
  'admin.accounts.reissue-activation': ['SYSTEM_ADMIN'],
  'case.view': ['LAWYER'],
  'case.actions.list': ['LAWYER'],
  'case.document.read': ['LAWYER'],
  'events.chain-status.view': ['SYSTEM_ADMIN'],
  'environment.view': ALL,
  'demo.accounts.list': ALL,
  'demo.account.switch': ALL,
  'demo.outbox.view': ALL,
  // Phase 2 (docs/phases/phase-2.md): the lawyer's drafts, the simulated payment,
  // the registry office, the cashier, the prosecution's referrals, the register
  // lookup, and the list of files (whoever may open a file).
  'filing.drafts.list': ['LAWYER', 'CLERK_REGISTRATION'],
  'filing.draft.read': ['LAWYER'],
  'filing.draft.edit': ['LAWYER'],
  'filing.draft.pay': ['LAWYER'],
  'filing.draft.submit': ['LAWYER'],
  'payment.simulate': ['LAWYER', 'CLERK_REGISTRATION'],
  'payment.view': ['LAWYER', 'CLERK_REGISTRATION'],
  'registers.commercial.lookup': ['LAWYER', 'CLERK_REGISTRATION'],
  'registry.incoming.list': ['CLERK_REGISTRATION'],
  'cashier.ledger.view': ['CLERK_CASHIER'],
  'prosecution.referrals.list': ['PUBLIC_PROSECUTOR'],
  'cases.list': [
    'LAWYER',
    'JUDGE_RAPPORTEUR',
    'JUDGE_IN_CHARGE',
    'COUNSELLOR_RAPPORTEUR',
    'PANEL_PRESIDENT',
    'PANEL_MEMBER',
    'COURT_PRESIDENT',
    'ENFORCEMENT_JUDGE',
    'CLERK_REGISTRATION',
    'CLERK_CASHIER',
    'CLERK_NOTIFICATION',
    'CLERK_HEARING',
    'CLERK_COPIES_ENFORCEMENT',
    'CHIEF_CLERK',
    'PUBLIC_PROSECUTOR',
    'ROYAL_COMMISSIONER',
    'LITIGANT',
    'PUBLIC_ADMIN_SUPERVISOR',
    'PUBLIC_ADMIN_LITIGATION',
    'STATE_JUDICIAL_AGENT',
  ],
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
      { kind: 'account', userId: OTHER_ID, isDemo: false, activated: true, disabled: false, role: 'LAWYER' },
      demo,
    );
    expect(decision).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
  });

  it('never reissues an activation link for a disabled account', () => {
    const decision = authorize(
      userSubject('SYSTEM_ADMIN'),
      'admin.accounts.reissue-activation',
      { kind: 'account', userId: OTHER_ID, isDemo: false, activated: false, disabled: true, role: 'LAWYER' },
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
  const caseActions = Object.keys(ACTIONS).filter((a) => a.startsWith('case.'));

  it('the system administrator and the rules validator never read case content', () => {
    expect(caseActions.length).toBeGreaterThan(0);
    for (const role of ['SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR'] as const) {
      for (const action of caseActions) {
        const resource = counselledCase;
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
    for (const action of Object.keys(ACTIONS)) {
      const rule = ACTIONS[action];
      if (!rule) throw new Error(action);
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

describe('stored time-limit status (review P1-S-02)', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  const now = new Date();
  it('keeps a limit recorded ELAPSED elapsed, even before its end', () => {
    expect(deadlineState([{ code: 'APPEAL', partyId: 'p', endsAt: future, status: 'ELAPSED' }], 'APPEAL', 'p', now)).toBe('ELAPSED');
  });
  it('reads a running limit against its end', () => {
    expect(deadlineState([{ code: 'APPEAL', partyId: 'p', endsAt: future }], 'APPEAL', 'p', now)).toBe('OPEN');
    expect(deadlineState([{ code: 'APPEAL', partyId: 'p', endsAt: past, status: 'RUNNING' }], 'APPEAL', 'p', now)).toBe('ELAPSED');
  });
  it('treats a limit met or closed as neither open nor absent', () => {
    expect(deadlineState([{ code: 'APPEAL', partyId: 'p', endsAt: future, status: 'MET' }], 'APPEAL', 'p', now)).toBe('CLOSED');
    expect(deadlineState([], 'APPEAL', 'p', now)).toBe('ABSENT');
  });
});
