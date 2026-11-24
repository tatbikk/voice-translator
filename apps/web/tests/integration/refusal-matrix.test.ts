// Memo row 2 and contract §13 item 5: the refusal matrix over the endpoint
// registry. Every endpoint of ENDPOINTS is called
//   (a) without the access cookie,
//   (b) past the gate without a session,
//   (c) with a pending session (before the second factor, and before role selection),
//   (d) with an active session for each of the 26 roles (and a user holding two roles),
// and the answer is compared with the expectation written below, which states
// contract §6 independently of the registry and of the core's action table.
// Every expected refusal must leave an access.denied event naming its step.
// The set of endpoints usable without a session must equal an explicit
// allow-list, and every non-GET endpoint must append an event on success
// (an endpoint without a success fixture fails the test).
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROLE_CODES, moroccoCalendarDate, type RoleCode } from '@mahkama/core';
import { accountDraft, activationLinkFor, adminSession, createAccount, emailIds } from '../helpers/admin';
import { accessCode, login, startLogin, visitor, wrongCode } from '../helpers/auth';
import { capturingEvents, notificationsOf, type EventRow } from '../helpers/db';
import {
  createCaseFile,
  createHearing,
  createUser,
  newEmail,
  newPassword,
  theCourt,
  userIdByEmail,
  type CaseFileFixture,
  type TestUser,
} from '../helpers/factories';
import { Client, describeResponse, loadEndpoints, routePattern, type ApiResponse, type EndpointEntry } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';

const ENDPOINTS: readonly EndpointEntry[] = await loadEndpoints();
const keyOf = (e: EndpointEntry) => `${e.method} ${routePattern(e.module)}`;

// ---------------------------------------------------------------------------
// Subjects

type SubjectKind =
  | { readonly kind: 'no-access' }
  | { readonly kind: 'visitor' }
  | { readonly kind: 'pending-second-factor' }
  | { readonly kind: 'pending-role' }
  | { readonly kind: 'active'; readonly role: RoleCode; readonly roleCount: 1 | 2 };

interface Subject {
  readonly label: string;
  readonly is: SubjectKind;
  readonly hasSession: boolean;
}

const SUBJECTS: readonly Subject[] = [
  { label: 'without the access cookie', is: { kind: 'no-access' }, hasSession: false },
  { label: 'past the gate, without a session', is: { kind: 'visitor' }, hasSession: false },
  { label: 'with a session waiting for the second factor', is: { kind: 'pending-second-factor' }, hasSession: true },
  { label: 'with a session waiting for role selection', is: { kind: 'pending-role' }, hasSession: true },
  ...ROLE_CODES.map(
    (role): Subject => ({ label: `with an active session as ${role}`, is: { kind: 'active', role, roleCount: 1 }, hasSession: true }),
  ),
  {
    label: 'with an active session of a user holding two roles',
    is: { kind: 'active', role: 'JUDGE_RAPPORTEUR', roleCount: 2 },
    hasSession: true,
  },
];

// ---------------------------------------------------------------------------
// Expected answers (contract §6), written out independently

type Expectation = { readonly usable: true } | { readonly status: number; readonly code: string | null; readonly step?: string };

const USABLE: Expectation = { usable: true };
const GATE: Expectation = { status: 401, code: 'ACCESS_CODE_REQUIRED', step: 'GATE' };
const SESSION: Expectation = { status: 401, code: 'SESSION_REQUIRED', step: 'SESSION' };
const FORBIDDEN: Expectation = { status: 403, code: 'FORBIDDEN', step: 'AUTHZ' };
const REAUTH: Expectation = { status: 403, code: 'REAUTH_REQUIRED', step: 'REAUTH' };
const UNKNOWN_PATH: Expectation = { status: 404, code: 'NOT_FOUND' };
const HEALTHY: Expectation = { status: 200, code: null };

const none = (s: Subject) => s.is.kind === 'no-access';
const active = (s: Subject) => s.is.kind === 'active';
const admin = (s: Subject) => s.is.kind === 'active' && s.is.role === 'SYSTEM_ADMIN';

/** gate-level: anyone past the gate, with or without a session */
const gateLevel = (s: Subject): Expectation => (none(s) ? GATE : USABLE);
/** session-level: an active session of any role */
const anyActive = (s: Subject): Expectation => (none(s) ? GATE : active(s) ? USABLE : SESSION);
/** administrator only (no re-authentication needed) */
const adminOnly = (s: Subject): Expectation => (none(s) ? GATE : !active(s) ? SESSION : admin(s) ? USABLE : FORBIDDEN);
/** administrator only, after a recent re-authentication (the matrix sessions have none) */
const adminWithReauth = (s: Subject): Expectation => (none(s) ? GATE : !active(s) ? SESSION : admin(s) ? REAUTH : FORBIDDEN);

const EXPECTED: Readonly<Record<string, (s: Subject) => Expectation>> = {
  'GET /healthz': () => HEALTHY,
  'POST /api/v1/access': () => USABLE,
  'GET /api/v1/csrf': () => USABLE,
  'POST /api/v1/auth/login': gateLevel,
  'POST /api/v1/auth/second-factor': (s) => (none(s) ? GATE : s.is.kind === 'pending-second-factor' ? USABLE : SESSION),
  'POST /api/v1/auth/second-factor/resend': (s) => (none(s) ? GATE : s.is.kind === 'pending-second-factor' ? USABLE : SESSION),
  'POST /api/v1/auth/role': (s) => {
    if (none(s)) return GATE;
    if (s.is.kind === 'pending-role') return USABLE;
    if (s.is.kind === 'active') return s.is.roleCount > 1 ? USABLE : FORBIDDEN;
    return SESSION;
  },
  'POST /api/v1/auth/logout': (s) => (none(s) ? GATE : s.hasSession ? USABLE : SESSION),
  'POST /api/v1/auth/reauth': anyActive,
  'POST /api/v1/auth/activate': gateLevel,
  'GET /api/v1/notifications': anyActive,
  'POST /api/v1/notifications/:id/read': anyActive,
  'POST /api/v1/preferences': gateLevel,
  'GET /api/v1/admin/accounts': adminOnly,
  'POST /api/v1/admin/accounts': adminWithReauth,
  'POST /api/v1/admin/accounts/:id/activation': adminWithReauth,
  'GET /api/v1/public/case-status': gateLevel,
  'GET /api/v1/public/hearings': gateLevel,
  'GET /api/demo/outbox': gateLevel,
  'GET /api/demo/accounts': gateLevel,
  'POST /api/demo/switch-account': gateLevel,
  'GET /api/*': () => UNKNOWN_PATH,
  'POST /api/*': () => UNKNOWN_PATH,
};

/** Usable without a session (answer (b) is no gate or session refusal). */
const USABLE_WITHOUT_SESSION = [
  'GET /healthz',
  'POST /api/v1/access',
  'GET /api/v1/csrf',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/activate',
  'POST /api/v1/preferences',
  'GET /api/v1/public/case-status',
  'GET /api/v1/public/hearings',
  'GET /api/demo/outbox',
  'GET /api/demo/accounts',
  'POST /api/demo/switch-account',
  'GET /api/*',
  'POST /api/*',
].sort();

/** Usable without the access cookie (answer (a) is no gate refusal). */
const USABLE_WITHOUT_ACCESS_COOKIE = ['GET /healthz', 'POST /api/v1/access', 'GET /api/v1/csrf', 'GET /api/*', 'POST /api/*'].sort();

/** The access kind each endpoint must declare in the registry. */
const EXPECTED_ACCESS: Readonly<Record<string, { kinds: readonly string[]; action?: string; states?: readonly string[] }>> = {
  'GET /healthz': { kinds: ['public'] },
  'POST /api/v1/access': { kinds: ['pre-gate'] },
  'GET /api/v1/csrf': { kinds: ['pre-gate'] },
  'POST /api/v1/auth/login': { kinds: ['gate'] },
  'POST /api/v1/auth/second-factor': { kinds: ['pending-session'], states: ['PENDING_SECOND_FACTOR'] },
  'POST /api/v1/auth/second-factor/resend': { kinds: ['pending-session'], states: ['PENDING_SECOND_FACTOR'] },
  'POST /api/v1/auth/role': { kinds: ['pending-session', 'action'] },
  'POST /api/v1/auth/logout': { kinds: ['session', 'pending-session'] },
  'POST /api/v1/auth/reauth': { kinds: ['action'], action: 'account.view-own' },
  'POST /api/v1/auth/activate': { kinds: ['gate'] },
  'GET /api/v1/notifications': { kinds: ['action'], action: 'notifications.view-own' },
  'POST /api/v1/notifications/:id/read': { kinds: ['action'], action: 'notifications.mark-read-own' },
  'POST /api/v1/preferences': { kinds: ['gate'] },
  'GET /api/v1/admin/accounts': { kinds: ['action'], action: 'admin.accounts.list' },
  'POST /api/v1/admin/accounts': { kinds: ['action'], action: 'admin.accounts.create' },
  'POST /api/v1/admin/accounts/:id/activation': { kinds: ['action'], action: 'admin.accounts.reissue-activation' },
  'GET /api/v1/public/case-status': { kinds: ['gate'] },
  'GET /api/v1/public/hearings': { kinds: ['gate'] },
  'GET /api/demo/outbox': { kinds: ['demo'], action: 'demo.outbox.view' },
  'GET /api/demo/accounts': { kinds: ['demo'], action: 'demo.accounts.list' },
  'POST /api/demo/switch-account': { kinds: ['demo'], action: 'demo.account.switch' },
  'GET /api/*': { kinds: ['public'] },
  'POST /api/*': { kinds: ['public'] },
};

/** A response refused at one of the steps of §6 (or throttled, or failed). */
function stepRefusal(res: ApiResponse): string | null {
  if (res.status === 401 && (res.code === 'ACCESS_CODE_REQUIRED' || res.code === 'SESSION_REQUIRED')) return res.code;
  if (res.status === 403 && (res.code === 'CSRF_REJECTED' || res.code === 'FORBIDDEN')) return res.code;
  if (res.status === 404 && res.code === 'NOT_FOUND') return 'NOT_FOUND';
  if (res.status === 429) return 'TOO_MANY_REQUESTS';
  if (res.status >= 500) return `server error ${String(res.status)}`;
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures and probes

interface Fixtures {
  readonly caseFile: CaseFileFixture;
  readonly hearingDate: string;
  readonly unactivated: TestUser;
  readonly demoTarget: TestUser;
  readonly someoneElse: TestUser;
  readonly someoneElsesNotification: string;
}

let fixtures!: Fixtures;

interface SubjectState {
  readonly client: Client;
  readonly user: TestUser | null;
  readonly code: string | null;
  readonly notificationId: string | null;
  /** role assignment sent to POST /api/v1/auth/role */
  readonly roleTarget: string | null;
}

type Probe = (state: SubjectState) => Promise<ApiResponse>;

const randomToken = () => randomBytes(32).toString('base64url');

const PROBES: Readonly<Record<string, Probe>> = {
  'GET /healthz': ({ client }) => client.get('/healthz'),
  'POST /api/v1/access': ({ client }) => client.post('/api/v1/access', { code: accessCode() }),
  'GET /api/v1/csrf': ({ client }) => client.get('/api/v1/csrf'),
  'POST /api/v1/auth/login': ({ client }) =>
    client.post('/api/v1/auth/login', { email: newEmail('unknown'), password: 'Not-the-password-2026' }),
  'POST /api/v1/auth/second-factor': ({ client, code }) =>
    client.post('/api/v1/auth/second-factor', { code: wrongCode(code ?? '000000') }),
  'POST /api/v1/auth/second-factor/resend': ({ client }) => client.post('/api/v1/auth/second-factor/resend'),
  'POST /api/v1/auth/role': ({ client, roleTarget }) =>
    client.post('/api/v1/auth/role', { roleAssignmentId: roleTarget ?? fixtures.demoTarget.roleAssignmentId }),
  'POST /api/v1/auth/logout': ({ client }) => client.post('/api/v1/auth/logout'),
  'POST /api/v1/auth/reauth': ({ client, user }) =>
    client.post('/api/v1/auth/reauth', { password: user?.password ?? 'Not-the-password-2026' }),
  'POST /api/v1/auth/activate': ({ client }) =>
    client.post('/api/v1/auth/activate', { token: randomToken(), password: 'Activation-password-2026' }),
  'GET /api/v1/notifications': ({ client }) => client.get('/api/v1/notifications'),
  'POST /api/v1/notifications/:id/read': ({ client, notificationId }) =>
    client.post(`/api/v1/notifications/${notificationId ?? fixtures.someoneElsesNotification}/read`),
  'POST /api/v1/preferences': ({ client }) => client.post('/api/v1/preferences', { locale: 'ar' }),
  'GET /api/v1/admin/accounts': ({ client }) => client.get('/api/v1/admin/accounts'),
  'POST /api/v1/admin/accounts': ({ client }) => createAccount(client, accountDraft()),
  'POST /api/v1/admin/accounts/:id/activation': ({ client }) =>
    client.post(`/api/v1/admin/accounts/${fixtures.unactivated.id}/activation`),
  'GET /api/v1/public/case-status': ({ client }) =>
    client.get('/api/v1/public/case-status', {
      query: {
        courtId: fixtures.caseFile.courtId,
        number: fixtures.caseFile.number,
        code: fixtures.caseFile.code,
        year: fixtures.caseFile.year,
      },
    }),
  'GET /api/v1/public/hearings': ({ client }) =>
    client.get('/api/v1/public/hearings', { query: { courtId: fixtures.caseFile.courtId, date: fixtures.hearingDate } }),
  'GET /api/demo/outbox': ({ client }) => client.get('/api/demo/outbox'),
  'GET /api/demo/accounts': ({ client }) => client.get('/api/demo/accounts'),
  'POST /api/demo/switch-account': ({ client }) =>
    client.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId: fixtures.demoTarget.roleAssignmentId } }),
  'GET /api/*': ({ client }) => client.get('/api/v1/no-such-endpoint'),
  'POST /api/*': ({ client }) => client.post('/api/v1/no-such-endpoint', {}),
};

/**
 * Probes that end or change the caller's session (logout, account switch,
 * role selection with token rotation, re-authentication) run on a session of
 * their own, so that they do not disturb the other probes of the subject.
 */
function changesSession(key: string, subject: Subject): boolean {
  if (!subject.hasSession) return false;
  if (key === 'POST /api/v1/auth/logout' || key === 'POST /api/demo/switch-account') return true;
  if (key === 'POST /api/v1/auth/reauth') return true;
  if (key === 'POST /api/v1/auth/role') {
    return subject.is.kind === 'pending-role' || (subject.is.kind === 'active' && subject.is.roleCount > 1);
  }
  return false;
}

async function ownNotification(user: TestUser): Promise<string | null> {
  return (await notificationsOf(user.id))[0]?.id ?? null;
}

const SECOND_ROLE: RoleCode = 'PANEL_PRESIDENT';

/** A fresh client in the state of the subject. */
async function prepare(subject: Subject): Promise<SubjectState> {
  const empty = { user: null, code: null, notificationId: null, roleTarget: null };
  switch (subject.is.kind) {
    case 'no-access':
      return { client: new Client(), ...empty };
    case 'visitor':
      return { client: await visitor(), ...empty };
    case 'pending-second-factor': {
      const user = await createUser({ roles: ['LAWYER'] });
      const pending = await startLogin(user);
      return { client: pending.client, user, code: pending.code, notificationId: await ownNotification(user), roleTarget: user.roleAssignmentId };
    }
    case 'pending-role': {
      const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', SECOND_ROLE] });
      const client = await login(user, { stopAtRole: true });
      return { client, user, code: null, notificationId: await ownNotification(user), roleTarget: user.roleAssignmentId };
    }
    case 'active': {
      const { role, roleCount } = subject.is;
      const roles: RoleCode[] = roleCount > 1 ? [role, role === SECOND_ROLE ? 'JUDGE_RAPPORTEUR' : SECOND_ROLE] : [role];
      const user = await createUser({ roles });
      const client = await login(user, { role });
      const roleTarget = roleCount > 1 ? user.roles[1]!.id : user.roleAssignmentId;
      return { client, user, code: null, notificationId: await ownNotification(user), roleTarget };
    }
  }
}

function check(res: ApiResponse, expected: Expectation, context: string): void {
  if ('usable' in expected) {
    expect(stepRefusal(res), `${context}: expected the request to pass every check, got ${describeResponse(res)}`).toBeNull();
  } else {
    expect({ status: res.status, code: res.code }, `${context}: ${describeResponse(res)}`).toEqual({
      status: expected.status,
      code: expected.code,
    });
  }
}

function expectRefusalLogged(events: readonly EventRow[], expected: Expectation, endpoint: EndpointEntry, context: string): void {
  if ('usable' in expected || expected.step === undefined) return;
  const denied = events.filter((e) => e.action === 'access.denied');
  expect(
    denied.some((e) => e.details.step === expected.step),
    `${context}: the refusal must leave an access.denied event with step ${expected.step} (got ${JSON.stringify(denied.map((e) => e.details))})`,
  ).toBe(true);
  expect(
    denied.some((e) => e.details.target === endpoint.id),
    `${context}: the access.denied event must name the endpoint id ${endpoint.id}`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------

const observed = new Map<string, Map<string, ApiResponse>>();

describe('refusal matrix over the endpoint registry (memo row 2, contract §13.5)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    const court = await theCourt();
    const startsAt = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    startsAt.setUTCHours(10, 0, 0, 0);
    const hearingId = await createHearing(court.id, startsAt);
    const caseFile = await createCaseFile({ courtId: court.id, hearingId, status: 'IN_PREPARATION' });
    const unactivated = await createUser({ roles: ['LAWYER'], password: null, isDemo: false });
    const demoTarget = await createUser({ roles: ['LITIGANT'], isDemo: true });
    const someoneElse = await createUser({ roles: ['EXPERT'] });
    const someoneElsesNotification = (await ownNotification(someoneElse)) ?? '';
    fixtures = {
      caseFile,
      hearingDate: moroccoCalendarDate(startsAt),
      unactivated,
      demoTarget,
      someoneElse,
      someoneElsesNotification,
    };
  });

  describe('the registry', () => {
    it('lists every endpoint of contract §6, and nothing else', () => {
      expect(ENDPOINTS.map(keyOf).sort()).toEqual(Object.keys(EXPECTED).sort());
    });

    it('has one entry per method and path, with unique ids', () => {
      const keys = ENDPOINTS.map(keyOf);
      expect(new Set(keys).size).toBe(keys.length);
      const ids = ENDPOINTS.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('declares for each endpoint the access kind of contract §6', () => {
      for (const endpoint of ENDPOINTS) {
        const expected = EXPECTED_ACCESS[keyOf(endpoint)];
        expect(expected, `no expected access for ${keyOf(endpoint)}`).toBeDefined();
        if (!expected) continue;
        expect(expected.kinds, `${keyOf(endpoint)} access kind`).toContain(endpoint.access.kind);
        if (expected.action) expect(endpoint.access.action, `${keyOf(endpoint)} action`).toBe(expected.action);
        if (expected.states) expect([...(endpoint.access.states ?? [])].sort(), `${keyOf(endpoint)} states`).toEqual([...expected.states].sort());
      }
    });

    it('has a probe and an expectation for every endpoint, so none escapes the matrix', () => {
      for (const endpoint of ENDPOINTS) {
        expect(PROBES[keyOf(endpoint)], `no probe for ${keyOf(endpoint)}`).toBeDefined();
        expect(EXPECTED[keyOf(endpoint)], `no expectation for ${keyOf(endpoint)}`).toBeDefined();
      }
    });

    it('reaches no case-file action in Phase 0 (memo row 9)', () => {
      for (const endpoint of ENDPOINTS) expect(endpoint.access.action ?? '').not.toMatch(/^case\./);
    });

    it('declares the demo endpoints as demo-only, behind a demo action', () => {
      for (const endpoint of ENDPOINTS.filter((e) => e.module.endsWith('.demo'))) {
        expect(endpoint.access.kind, endpoint.id).toBe('demo');
        expect(endpoint.access.action ?? '', endpoint.id).toMatch(/^demo\./);
      }
    });
  });

  for (const subject of SUBJECTS) {
    describe(`called ${subject.label}`, () => {
      let main: SubjectState | null = null;
      const results = new Map<string, ApiResponse>();
      observed.set(subject.label, results);

      beforeAll(async () => {
        if (subject.hasSession) main = await prepare(subject);
      }, 60_000);

      for (const endpoint of ENDPOINTS) {
        const key = keyOf(endpoint);
        const expectation = EXPECTED[key];
        const probe = PROBES[key];
        if (!expectation || !probe) continue;
        const expected = expectation(subject);
        const label =
          'usable' in expected
            ? `${key} passes every check`
            : `${key} answers ${String(expected.status)}${expected.code ? ` ${expected.code}` : ''}`;
        it(label, async () => {
          const state = !subject.hasSession || changesSession(key, subject) || !main ? await prepare(subject) : main;
          const { result: res, events } = await capturingEvents(() => probe(state));
          results.set(key, res);
          const context = `${subject.label}, ${key}`;
          check(res, expected, context);
          expectRefusalLogged(events, expected, endpoint, context);
        });
      }
    });
  }

  describe('allow-lists', () => {
    it('the endpoints usable without a session are exactly the explicit allow-list', () => {
      const results = observed.get('past the gate, without a session');
      expect(results?.size, 'the matrix did not run for the visitor').toBe(ENDPOINTS.length);
      const usable = [...(results ?? new Map<string, ApiResponse>())]
        .filter(([, res]) => !(res.status === 401 && (res.code === 'ACCESS_CODE_REQUIRED' || res.code === 'SESSION_REQUIRED')))
        .map(([key]) => key)
        .sort();
      expect(usable).toEqual(USABLE_WITHOUT_SESSION);
    });

    it('the endpoints usable without the access cookie are exactly the explicit allow-list', () => {
      const results = observed.get('without the access cookie');
      expect(results?.size, 'the matrix did not run without the access cookie').toBe(ENDPOINTS.length);
      const usable = [...(results ?? new Map<string, ApiResponse>())]
        .filter(([, res]) => !(res.status === 401 && res.code === 'ACCESS_CODE_REQUIRED'))
        .map(([key]) => key)
        .sort();
      expect(usable).toEqual(USABLE_WITHOUT_ACCESS_COOKIE);
    });

    it('the registry agrees: only public, pre-gate, gate and demo endpoints need no session', () => {
      const noSession = ENDPOINTS.filter((e) => ['public', 'pre-gate', 'gate', 'demo'].includes(e.access.kind)).map(keyOf).sort();
      expect(noSession).toEqual(USABLE_WITHOUT_SESSION);
      const noGate = ENDPOINTS.filter((e) => ['public', 'pre-gate'].includes(e.access.kind)).map(keyOf).sort();
      expect(noGate).toEqual(USABLE_WITHOUT_ACCESS_COOKIE);
    });
  });

  describe('every non-GET endpoint appends at least one event on success', () => {
    interface Success {
      /** the successful request itself; events are counted around it only */
      readonly run: () => Promise<ApiResponse>;
      /** one of these actions must be among the appended events (empty: any event) */
      readonly actions: readonly string[];
    }
    /** Endpoints with no success path, and why. */
    const NO_SUCCESS_PATH: Readonly<Record<string, string>> = {
      'POST /api/*': 'answers 404 NOT_FOUND to every request (unknown path)',
    };

    /** Each fixture prepares the state, then returns the successful request. */
    const SUCCESS: Readonly<Record<string, () => Promise<Success>>> = {
      'POST /api/v1/access': async () => {
        const client = new Client();
        await client.csrf();
        return { run: () => client.post('/api/v1/access', { code: accessCode() }), actions: ['access.code.accepted'] };
      },
      'POST /api/v1/auth/login': async () => {
        const user = await createUser({ roles: ['LAWYER'] });
        const client = await visitor();
        await client.csrf();
        return {
          run: () => client.post('/api/v1/auth/login', { email: user.email, password: user.password }),
          actions: ['auth.login.succeeded', 'auth.second-factor.issued'],
        };
      },
      'POST /api/v1/auth/second-factor': async () => {
        const user = await createUser({ roles: ['LAWYER'] });
        const pending = await startLogin(user);
        await pending.client.csrf();
        return {
          run: () => pending.client.post('/api/v1/auth/second-factor', { code: pending.code }),
          actions: ['auth.second-factor.succeeded'],
        };
      },
      'POST /api/v1/auth/second-factor/resend': async () => {
        const user = await createUser({ roles: ['LAWYER'] });
        const pending = await startLogin(user);
        await pending.client.csrf();
        return { run: () => pending.client.post('/api/v1/auth/second-factor/resend'), actions: ['auth.second-factor.issued'] };
      },
      'POST /api/v1/auth/role': async () => {
        const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', SECOND_ROLE] });
        const client = await login(user, { stopAtRole: true });
        await client.csrf();
        return {
          run: () => client.post('/api/v1/auth/role', { roleAssignmentId: user.roles[1]!.id }),
          actions: ['auth.role.selected'],
        };
      },
      'POST /api/v1/auth/logout': async () => {
        const user = await createUser({ roles: ['LAWYER'] });
        const client = await login(user);
        await client.csrf();
        return { run: () => client.post('/api/v1/auth/logout'), actions: ['auth.logout'] };
      },
      'POST /api/v1/auth/reauth': async () => {
        const user = await createUser({ roles: ['LAWYER'] });
        const client = await login(user);
        await client.csrf();
        return { run: () => client.post('/api/v1/auth/reauth', { password: user.password }), actions: ['auth.reauth.succeeded'] };
      },
      'POST /api/v1/auth/activate': async () => {
        const { client } = await adminSession();
        const draft = accountDraft();
        const created = await createAccount(client, draft);
        expect(created.status, describeResponse(created)).toBeLessThan(300);
        const userId = await userIdByEmail(draft.email);
        const { token } = await activationLinkFor(userId);
        const someone = await visitor();
        await someone.csrf();
        return { run: () => someone.post('/api/v1/auth/activate', { token, password: newPassword() }), actions: ['account.activated'] };
      },
      'POST /api/v1/notifications/:id/read': async () => {
        const user = await createUser({ roles: ['LAWYER'] });
        const client = await login(user);
        const id = (await ownNotification(user)) ?? '';
        await client.csrf();
        return { run: () => client.post(`/api/v1/notifications/${id}/read`), actions: ['notification.read'] };
      },
      'POST /api/v1/preferences': async () => {
        const client = await visitor();
        await client.csrf();
        return { run: () => client.post('/api/v1/preferences', { locale: 'fr', readingSize: 1 }), actions: ['preferences.updated'] };
      },
      'POST /api/v1/admin/accounts': async () => {
        const { client } = await adminSession();
        const draft = accountDraft();
        await client.csrf();
        return { run: () => createAccount(client, draft), actions: ['admin.account.created'] };
      },
      'POST /api/v1/admin/accounts/:id/activation': async () => {
        const { client } = await adminSession();
        const draft = accountDraft();
        const created = await createAccount(client, draft);
        expect(created.status, describeResponse(created)).toBeLessThan(300);
        const userId = await userIdByEmail(draft.email);
        const before = await emailIds(userId);
        await client.csrf();
        return {
          run: async () => {
            const res = await client.post(`/api/v1/admin/accounts/${userId}/activation`);
            if (res.status < 300) await activationLinkFor(userId, before);
            return res;
          },
          actions: ['admin.account.activation-reissued'],
        };
      },
      'POST /api/demo/switch-account': async () => {
        const target = await createUser({ roles: ['BAILIFF'], isDemo: true });
        const client = await visitor();
        await client.csrf();
        return {
          run: () => client.post('/api/demo/switch-account', undefined, { query: { roleAssignmentId: target.roleAssignmentId } }),
          actions: ['demo.account.switched'],
        };
      },
    };

    it('has a success fixture for every non-GET endpoint of the registry', () => {
      const missing = ENDPOINTS.filter((e) => e.method !== 'GET')
        .map(keyOf)
        .filter((key) => !SUCCESS[key] && !NO_SUCCESS_PATH[key]);
      expect(missing, 'non-GET endpoints without a success fixture').toEqual([]);
    });

    for (const endpoint of ENDPOINTS.filter((e) => e.method !== 'GET')) {
      const key = keyOf(endpoint);
      const fixture = SUCCESS[key];
      if (!fixture) continue;
      it(`${key} appends an event when it succeeds`, async () => {
        const success = await fixture();
        const { result: res, events } = await capturingEvents(success.run);
        expect(res.status, describeResponse(res)).toBeGreaterThanOrEqual(200);
        expect(res.status, describeResponse(res)).toBeLessThan(300);
        expect(events.length, `${key} appended no event`).toBeGreaterThan(0);
        if (success.actions.length > 0) {
          const actions = events.map((e) => e.action);
          expect(
            success.actions.some((a) => actions.includes(a)),
            `${key}: expected one of ${success.actions.join(', ')} among ${actions.join(', ')}`,
          ).toBe(true);
        }
      });
    }
  });
});
