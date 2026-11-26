// Memo row 12 of Phase 0, extended to every state-changing route (Phase 1 and
// Phase 2 memo row 18; independent review IR-17). The routes are taken from the
// endpoint registry: every non-GET endpoint that is not public, and every GET it
// marks as having effects (the commercial-register lookup, decision 80), must
// have a probe here, so that a route added later is in this test or fails it. Each
// probe is the request a legitimate browser of the right role would send, on
// a session of its own (a pending one where the route needs it). Sent without
// a CSRF token, and with a wrong one, the request is refused at the CSRF step
// (403 CSRF_REJECTED, an access.denied record naming the step and the
// endpoint, and no other record), and no table of the platform changes. Sent
// with the token, the same request passes that step; for the routes of Phases
// 1 and 2 it succeeds and changes the database (the positive witness).
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountDraft, adminSession, createAccount } from '../helpers/admin';
import { accessCode, login, startLogin, visitor } from '../helpers/auth';
import { capturingEvents, notificationsOf, sql } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { createDraft, fileCase, giveSigningSecret, openPayment, payDraft, prepareDraft, upload } from '../helpers/filings';
import { Client, describeResponse, loadEndpoints, type ApiResponse, type EndpointEntry, type RequestOptions } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';
import { pdfBytes } from '../helpers/samples';
import {
  COMMERCIAL_PAYMENT,
  MODEL_CASE_APPLICATION_TEXT,
  PUBLIC_DEFENDANT_CASE,
  PUBLIC_ESTABLISHMENT,
  withParties,
} from '../acceptance/model-case-filing.fixture';

useFreshDatabase();

const ENDPOINTS: readonly EndpointEntry[] = await loadEndpoints();
const STATE_CHANGING = ENDPOINTS.filter((e) => (e.method !== 'GET' || e.sideEffects === true) && e.access.kind !== 'public');

// ---------------------------------------------------------------------------
// What "nothing changed" means: every table but the event log (checked record
// by record) and the request counters (the refusal budget counts the refusal),
// with the last activity of a session left out.

let tables: string[] = [];

async function fingerprint(): Promise<Record<string, string>> {
  if (tables.length === 0) {
    const rows = await sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    tables = rows.map((r) => r.tablename).filter((t) => !['_prisma_migrations', 'Event', 'RateLimitHit'].includes(t));
  }
  const query = tables
    .map((t) => {
      const name = t.replace(/"/g, '');
      return `SELECT '${name}' AS t, md5(coalesce(string_agg(x, ',' ORDER BY x), '')) AS h FROM (SELECT (to_jsonb(r) - 'lastSeenAt')::text AS x FROM "${name}" r) s`;
    })
    .join(' UNION ALL ');
  const rows = await sql<{ t: string; h: string }>(query);
  return Object.fromEntries(rows.map((r) => [r.t, r.h]));
}

function changedTables(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]);
}

// ---------------------------------------------------------------------------
// Probes

interface Prepared {
  /** sends the request with these CSRF options (and nothing else changed) */
  readonly send: (csrf: Pick<RequestOptions, 'csrf'>) => Promise<ApiResponse>;
  /** what the request does with its token: change the database, or only pass the CSRF step */
  readonly witness: 'changes' | 'passes';
}

type Probe = () => Promise<Prepared>;

interface World {
  readonly registry: TestUser;
  readonly prosecutor: TestUser;
}
let world!: World;

/** A lawyer of its own for each probe: one account logging in two dozen times would be locked. */
async function lawyerSession(): Promise<Client> {
  return login(await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' }));
}

/** A lawyer with a signing secret, for the probes that file. */
async function filingLawyer(): Promise<{ client: Client; secret: string }> {
  const user = await createUser({ roles: ['LAWYER'], label: 'filing-lawyer' });
  const secret = await giveSigningSecret(user.id, `Signing-${randomBytes(6).toString('hex')}`);
  return { client: await login(user), secret };
}
const pdfBody = (note: string): RequestOptions => ({
  rawBody: Buffer.from(pdfBytes(note)),
  headers: { 'content-type': 'application/octet-stream' },
});

const PROBES: Readonly<Record<string, Probe>> = {
  // Phase 0
  'access.submit': () => {
    const c = new Client();
    return Promise.resolve({ witness: 'passes', send: (o) => c.post('/api/v1/access', { code: accessCode() }, o) });
  },
  'auth.login': async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const c = await visitor();
    return { witness: 'changes', send: (o) => c.post('/api/v1/auth/login', { email: user.email, password: user.password }, o) };
  },
  'auth.second-factor': async () => {
    const pending = await startLogin(await createUser({ roles: ['LAWYER'] }));
    return { witness: 'changes', send: (o) => pending.client.post('/api/v1/auth/second-factor', { code: pending.code }, o) };
  },
  'auth.second-factor.resend': async () => {
    const pending = await startLogin(await createUser({ roles: ['LAWYER'] }));
    return { witness: 'passes', send: (o) => pending.client.post('/api/v1/auth/second-factor/resend', undefined, o) };
  },
  'auth.role': async () => {
    const user = await createUser({ roles: ['JUDGE_RAPPORTEUR', 'PANEL_PRESIDENT'] });
    const c = await login(user, { stopAtRole: true });
    return { witness: 'changes', send: (o) => c.post('/api/v1/auth/role', { roleAssignmentId: user.roleAssignmentId }, o) };
  },
  'auth.logout': async () => {
    const c = await login(await createUser({ roles: ['LAWYER'] }));
    return { witness: 'changes', send: (o) => c.post('/api/v1/auth/logout', undefined, o) };
  },
  'auth.reauth': async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const c = await login(user);
    return { witness: 'changes', send: (o) => c.post('/api/v1/auth/reauth', { password: user.password }, o) };
  },
  'auth.activate': async () => {
    const c = await visitor();
    return { witness: 'passes', send: (o) => c.post('/api/v1/auth/activate', { token: randomBytes(32).toString('base64url'), password: 'Activation-password-2026' }, o) };
  },
  'notifications.mark-read': async () => {
    const user = await createUser({ roles: ['LAWYER'] });
    const c = await login(user);
    const id = (await notificationsOf(user.id))[0]?.id ?? '';
    return { witness: 'changes', send: (o) => c.post(`/api/v1/notifications/${id}/read`, undefined, o) };
  },
  'preferences.update': async () => {
    const c = await visitor();
    return { witness: 'passes', send: (o) => c.post('/api/v1/preferences', { locale: 'fr' }, o) };
  },
  'admin.accounts.create': async () => {
    const { client } = await adminSession();
    const draft = accountDraft();
    return { witness: 'changes', send: (o) => createAccount(client, draft, o) };
  },
  'admin.accounts.reissue-activation': async () => {
    const { client } = await adminSession();
    const target = await createUser({ roles: ['LAWYER'], password: null, isDemo: false });
    return { witness: 'changes', send: (o) => client.post(`/api/v1/admin/accounts/${target.id}/activation`, undefined, o) };
  },
  'demo.switch-account': async () => {
    const target = await createUser({ roles: ['LITIGANT'], isDemo: true });
    const c = await visitor();
    return { witness: 'changes', send: (o) => c.post('/api/demo/switch-account', undefined, { ...o, query: { roleAssignmentId: target.roleAssignmentId } }) };
  },

  // Phase 1 and 2: the case's acts, the filing path, the payment
  'cases.action': async () => {
    const lawyer = await filingLawyer();
    const filed = await fileCase(lawyer.client, lawyer.secret, { exhibits: 1 });
    const c = await login(world.registry);
    return { witness: 'changes', send: (o) => c.post(`/api/v1/cases/${filed.caseFileId}/actions/case.registration.stamp`, {}, o) };
  },
  'cases.upload': async () => {
    const lawyer = await filingLawyer();
    const filed = await fileCase(lawyer.client, lawyer.secret, { exhibits: 1, card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]) });
    const c = await login(world.prosecutor);
    return {
      witness: 'changes',
      send: (o) =>
        c.post(`/api/v1/cases/${filed.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
          ...o,
          ...pdfBody('conclusions'),
          query: { name: 'conclusions.pdf' },
        }),
    };
  },
  'filings.create': async () => {
    const c = await lawyerSession();
    return { witness: 'changes', send: (o) => c.post('/api/v1/filings', {}, o) };
  },
  'filings.create-paper': async () => {
    const c = await login(world.registry);
    return { witness: 'changes', send: (o) => c.post('/api/v1/filings/paper', {}, o) };
  },
  'filings.update': async () => {
    const c = await lawyerSession();
    const draftId = await createDraft(c);
    return { witness: 'changes', send: (o) => c.post(`/api/v1/filings/${draftId}`, { caseType: COMMERCIAL_PAYMENT, defendantLocality: 'casablanca' }, o) };
  },
  'filings.application-text': async () => {
    const c = await lawyerSession();
    const draftId = await createDraft(c);
    return { witness: 'changes', send: (o) => c.post(`/api/v1/filings/${draftId}/application-text`, { text: MODEL_CASE_APPLICATION_TEXT }, o) };
  },
  'filings.documents.upload': async () => {
    const c = await lawyerSession();
    const draftId = await createDraft(c);
    return {
      witness: 'changes',
      send: (o) =>
        c.post(`/api/v1/filings/${draftId}/documents`, undefined, {
          ...o,
          ...pdfBody('exhibit'),
          query: { kind: 'EXHIBIT', name: 'exhibit.pdf', title: 'عقد التوريد', nature: 'ORIGINAL' },
        }),
    };
  },
  'filings.documents.update': async () => {
    const c = await lawyerSession();
    const draftId = await createDraft(c);
    const uploaded = await upload(c, draftId, { kind: 'EXHIBIT', name: 'exhibit.pdf', bytes: pdfBytes('exhibit'), nature: 'ORIGINAL' });
    expect(uploaded.status, describeResponse(uploaded)).toBe(200);
    const documentId = uploaded.data!.documentId;
    return { witness: 'changes', send: (o) => c.post(`/api/v1/filings/${draftId}/documents/${documentId}`, { title: 'عنوان جديد' }, o) };
  },
  'filings.payment.open': async () => {
    const c = await lawyerSession();
    const draftId = await prepareDraft(c, { exhibits: 1 });
    return { witness: 'changes', send: (o) => c.post(`/api/v1/filings/${draftId}/payment`, {}, o) };
  },
  'payments.outcome': async () => {
    const c = await lawyerSession();
    const draftId = await prepareDraft(c, { exhibits: 1 });
    const { intentId } = await openPayment(c, draftId);
    return { witness: 'changes', send: (o) => c.post(`/api/v1/payments/${intentId}/outcome`, { outcome: 'SUCCEEDED' }, o) };
  },
  // A GET with effects (decision 80): it asks the register and spends the session's budget, in the lawyer's name.
  'registers.commercial.lookup': async () => {
    const c = await lawyerSession();
    return { witness: 'passes', send: (o) => c.get('/api/v1/registers/commercial', { ...o, query: { number: 'RC-DEMO-1001' } }) };
  },
  'filings.submit': async () => {
    const { client: c, secret } = await filingLawyer();
    const draftId = await prepareDraft(c, { exhibits: 1 });
    await payDraft(c, draftId);
    return { witness: 'changes', send: (o) => c.post(`/api/v1/filings/${draftId}/submit`, { secret }, o) };
  },
};

// ---------------------------------------------------------------------------

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' });
  world = {
    registry: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' }),
    prosecutor: await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' }),
  };
}, 120_000);

describe('cross-site request forgery on every state-changing route (memo row 12; Phase 2 memo row 18; IR-17)', () => {
  it('has a probe for every non-GET endpoint of the registry that is not public and every GET with effects, and for nothing else', () => {
    expect(Object.keys(PROBES).sort()).toEqual(STATE_CHANGING.map((e) => e.id).sort());
    // The routes the Phases 1 and 2 memos name are among them.
    for (const id of [
      'cases.action',
      'cases.upload',
      'filings.create',
      'filings.create-paper',
      'filings.update',
      'filings.application-text',
      'filings.documents.upload',
      'filings.documents.update',
      'filings.payment.open',
      'filings.submit',
      'payments.outcome',
      'registers.commercial.lookup',
    ]) {
      expect(STATE_CHANGING.map((e) => e.id), id).toContain(id);
    }
  });

  it('leaves out only plain reads: a download is a GET whose one effect is the record of the download itself (decision 80)', () => {
    for (const id of ['filings.documents.file', 'cases.document.file']) {
      const endpoint = ENDPOINTS.find((e) => e.id === id);
      expect(endpoint?.method, id).toBe('GET');
      expect(endpoint?.sideEffects, id).toBeUndefined();
    }
    // The lookup asks the register and spends a budget: a GET with effects, probed above.
    expect(ENDPOINTS.find((e) => e.id === 'registers.commercial.lookup')).toMatchObject({ method: 'GET', sideEffects: true });
  });

  it('refuses the register lookup sent by a cross-site navigation: the register is not asked and the session’s budget is not spent (review of the fix of IR-17, decision 80)', async () => {
    const c = await lawyerSession();
    const lookups = () => sql<{ n: string }>(`SELECT count(*)::text AS n FROM "RateLimitHit" WHERE key LIKE 'register:session:%'`).then((r) => Number(r[0]?.n ?? 0));
    const before = await lookups();
    // A top-level navigation from another site: no token, Sec-Fetch-Site cross-site, the cookies sent (SameSite=Lax).
    const forged = await capturingEvents(() =>
      c.get('/api/v1/registers/commercial', { query: { number: 'RC-DEMO-1001' }, csrf: 'none', headers: { 'Sec-Fetch-Site': 'cross-site' } }),
    );
    expect({ status: forged.result.status, code: forged.result.code }, describeResponse(forged.result)).toEqual({ status: 403, code: 'CSRF_REJECTED' });
    expect(forged.events.map((e) => ({ action: e.action, step: e.details.step }))).toEqual([{ action: 'access.denied', step: 'CSRF' }]);
    // Even with the token, a request another site sends is refused.
    const crossSite = await c.get('/api/v1/registers/commercial', { query: { number: 'RC-DEMO-1001' }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(crossSite.code, describeResponse(crossSite)).toBe('CSRF_REJECTED');
    expect(await lookups(), 'no lookup of the budget is spent').toBe(before);
    // The page's own request (same origin, with its token, and no Origin header as a browser sends a GET) is answered.
    const own = await capturingEvents(() => c.get('/api/v1/registers/commercial', { query: { number: 'RC-DEMO-1001' } }));
    expect(own.result.status, describeResponse(own.result)).toBe(200);
    expect(own.events.map((e) => e.action)).toEqual(['registers.commercial.looked-up']);
    expect(await lookups()).toBe(before + 1);
  });

  for (const endpoint of STATE_CHANGING) {
    it(`${endpoint.id}: without a token and with a wrong one, refused at the CSRF step, nothing changed; with the token, ${endpoint.id.startsWith('filings') || endpoint.id.startsWith('cases') || endpoint.id.startsWith('payments') ? 'done' : 'past that step'}`, async () => {
      const probe = PROBES[endpoint.id];
      if (!probe) throw new Error(`no CSRF probe for ${endpoint.id}`);
      const prepared = await probe();
      const before = await fingerprint();
      for (const csrf of ['none', randomBytes(32).toString('base64url')] as const) {
        const { result, events } = await capturingEvents(() => prepared.send({ csrf }));
        const label = `${endpoint.id} with ${csrf === 'none' ? 'no token' : 'a wrong token'}`;
        expect({ status: result.status, code: result.code }, `${label}: ${describeResponse(result)}`).toEqual({ status: 403, code: 'CSRF_REJECTED' });
        expect(
          events.map((e) => ({ action: e.action, step: e.details.step, target: e.details.target })),
          `${label}: one refusal record, at the CSRF step, naming the endpoint, and nothing else`,
        ).toEqual([{ action: 'access.denied', step: 'CSRF', target: endpoint.id }]);
        expect(changedTables(before, await fingerprint()), `${label}: no table changed`).toEqual([]);
      }
      const witness = await prepared.send({});
      expect(witness.code, `${endpoint.id} with its token: ${describeResponse(witness)}`).not.toBe('CSRF_REJECTED');
      if (prepared.witness === 'changes') {
        expect(witness.status, `${endpoint.id} with its token: ${describeResponse(witness)}`).toBe(200);
        expect(changedTables(before, await fingerprint()).length, `${endpoint.id} with its token changes the database`).toBeGreaterThan(0);
      }
    }, 90_000);
  }
});
