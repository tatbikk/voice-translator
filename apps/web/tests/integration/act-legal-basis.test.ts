// Independent review IR-12: every event written for a procedure act, for the
// filing, the registration and the payment carries «بأي سند» (rule 4 of the
// prompt), the basis the core's action table resolves for the action that
// wrote it (resolveLegalBasis), so that the timeline never shows «—» under
// «السند» for them. Written before the code:
//   - the model case is filed through the API, step by step; each step's
//     events carry the basis of the step's action (filing.new, filing.paper,
//     filing.draft.edit, filing.draft.read, filing.draft.pay, payment.simulate,
//     filing.draft.submit), the review of referrals keeping the articles its
//     own rule set applies;
//   - the registry corrects the classification, stamps and adds a note, the
//     prosecution files its conclusions: each act's events carry its basis;
//   - the case timeline shows those articles under «السند».
// The review of the fix added, before its code: what the worker prints for an
// act (the fixed copy, the two receipts, the signature certificate) carries the
// basis of the act that queued it, so that no line of the model case's timeline
// shows «—»; a note to the judge rests on art. 619 only when its reason is a fee
// shortfall (noteToJudgeBasis).
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, NOTE_REASONS, noteToJudgeBasis, resolveLegalBasis, type LegalBasis, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { MODEL_CASE, MODEL_CASE_APPLICATION_TEXT, MODEL_CASE_EXHIBITS, PUBLIC_DEFENDANT_CASE, PUBLIC_ESTABLISHMENT, COMMERCIAL_PAYMENT, withParties } from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { capturingEvents, one, type EventRow } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import {
  attestAll,
  createDraft,
  createPaperDraft,
  fileCase,
  getDraft,
  giveSigningSecret,
  openPayment,
  pasteApplication,
  runJobs,
  settle,
  submit,
  updateDraft,
  upload,
} from '../helpers/filings';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { pdfBytes } from '../helpers/samples';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

/** The basis the core's action table gives an action. */
function basisOf(code: string): LegalBasis {
  const rule = ACTIONS[code];
  if (!rule) throw new Error(`no action ${code}`);
  return resolveLegalBasis(rule);
}

/** The articles of that basis. */
function articlesOfAction(code: string): readonly number[] {
  const basis = basisOf(code);
  return basis.kind === 'LAW' ? basis.articles : [];
}

/** The events an act writes: what it did, never an access record or a refusal. */
const ACT_EVENT = /^(filing|payment|case|document|signature)\./;
const actEvents = (events: readonly EventRow[]) => events.filter((e) => e.outcome === 'DONE' && ACT_EVENT.test(e.action));

/** The review of referrals applies its own rule set (arts. 18, 20, 101): its basis is that set's, not the act's. */
const OWN_BASIS: ReadonlySet<string> = new Set(['case.referrals.reviewed']);

interface Step {
  readonly code: string;
  readonly events: readonly EventRow[];
}
const steps: Step[] = [];

async function step<T extends ApiResponse>(code: string, fn: () => Promise<T>): Promise<T> {
  const { result, events } = await capturingEvents(fn);
  expect(result.status, `${code}: ${describeResponse(result)}`).toBe(200);
  steps.push({ code, events: actEvents(events) });
  return result;
}

/** The jobs the worker runs after an act, recorded as a step of that act: what it prints carries its basis. */
async function jobsOf(code: string): Promise<readonly EventRow[]> {
  const { events } = await capturingEvents(runJobs);
  const printed = actEvents(events);
  steps.push({ code, events: printed });
  return printed;
}

function expectBasisOfStep(s: Step): void {
  expect(s.events.length, `${s.code} wrote no event`).toBeGreaterThan(0);
  for (const e of s.events) {
    if (OWN_BASIS.has(e.action)) continue;
    expect(e.legalBasis, `${e.action} written by ${s.code}`).toEqual(basisOf(s.code));
  }
}

async function subjectOf(user: TestUser): Promise<UserSubject> {
  const row = await one<{ role: UserSubject['role']; courtId: string | null; panelId: string | null; organizationId: string | null }>(
    `SELECT role, "courtId", "panelId", "organizationId" FROM "RoleAssignment" WHERE id = $1`,
    [user.roleAssignmentId],
  );
  return {
    kind: 'user',
    userId: user.id,
    role: row.role,
    roleAssignmentId: user.roleAssignmentId,
    courtId: row.courtId,
    panelId: row.panelId,
    organizationId: row.organizationId,
    isDemoAccount: false,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

let lawyerUser: TestUser;
let registryUser: TestUser;
let prosecutorUser: TestUser;
let lawyer: Client;
let registry: Client;
let secret: string;
let caseFileId: string;

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  lawyerUser = await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' });
  registryUser = await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' });
  prosecutorUser = await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' });
  await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' });
  secret = await giveSigningSecret(lawyerUser.id);
  lawyer = await login(lawyerUser);
  registry = await login(registryUser);
}, 120_000);

describe('the filing, the payment and the registration carry the basis of their action (independent review IR-12)', () => {
  it('records each step of the electronic filing with the basis the core gives its action', async () => {
    const created = await capturingEvents(() => lawyer.post<{ draftId: string }>('/api/v1/filings', {}));
    expect(created.result.status, describeResponse(created.result)).toBe(200);
    steps.push({ code: 'filing.new', events: actEvents(created.events) });
    const draftId = created.result.data!.draftId;

    const first = await step('filing.draft.edit', () => updateDraft(lawyer, draftId, { caseType: COMMERCIAL_PAYMENT, defendantLocality: 'casablanca' }));
    const courtId = first.data!.suggestion?.courtId ?? null;
    expect(courtId).not.toBeNull();
    await step('filing.draft.edit', () => updateDraft(lawyer, draftId, { courtId }));
    await step('filing.draft.edit', () => pasteApplication(lawyer, draftId, MODEL_CASE_APPLICATION_TEXT));
    expect((await jobsOf('filing.draft.edit')).map((e) => e.action)).toContain('filing.fixed-copy.prepared');
    await step('filing.draft.edit', () => updateDraft(lawyer, draftId, { card: MODEL_CASE }));
    const attested = await capturingEvents(() => attestAll(lawyer, draftId));
    steps.push({ code: 'filing.draft.edit', events: actEvents(attested.events) });
    const exhibit = MODEL_CASE_EXHIBITS[0]!;
    const uploaded = await step('filing.draft.edit', () =>
      upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'exhibit-1.pdf', bytes: pdfBytes(exhibit.title), title: exhibit.title, nature: exhibit.nature }),
    );
    // Reading a document of the draft is recorded too, with the basis of the reading.
    await step('filing.draft.read', () => lawyer.get(`/api/v1/filings/${draftId}/documents/${uploaded.data!.documentId}/file`));
    expect((await getDraft(lawyer, draftId)).draft.fixedCopyStatus).toBe('READY');

    const opened = await capturingEvents(() => openPayment(lawyer, draftId));
    steps.push({ code: 'filing.draft.pay', events: actEvents(opened.events) });
    await step('payment.simulate', () => settle(lawyer, opened.result.intentId, 'SUCCEEDED'));
    expect((await jobsOf('payment.simulate')).map((e) => e.action)).toContain('payment.receipt.issued');
    const filed = await step('filing.draft.submit', () => submit(lawyer, draftId, { secret }));
    caseFileId = filed.data!.caseFileId;
    expect((await jobsOf('filing.draft.submit')).map((e) => e.action)).toEqual(
      expect.arrayContaining(['document.stored', 'filing.receipt.issued', 'signature.certificate.issued']),
    );

    for (const s of steps) expectBasisOfStep(s);
    const written = new Set(steps.flatMap((s) => s.events.map((e) => e.action)));
    for (const action of [
      'filing.draft.created',
      'filing.draft.updated',
      'filing.application.pasted',
      'filing.document.uploaded',
      'document.downloaded',
      'payment.intent.opened',
      'payment.succeeded',
      'document.stored',
      'signature.circle.opened',
      'signature.signed',
      'signature.circle.completed',
      'filing.submitted',
      'case.registered',
      'case.referrals.reviewed',
      // What the worker prints for the acts above (review of the fix).
      'filing.fixed-copy.prepared',
      'payment.receipt.issued',
      'filing.receipt.issued',
      'signature.certificate.issued',
    ]) {
      expect(written, action).toContain(action);
    }
    // The review of referrals keeps the articles of its rule set.
    const reviewed = steps.flatMap((s) => s.events).find((e) => e.action === 'case.referrals.reviewed');
    expect(reviewed?.legalBasis).toMatchObject({ kind: 'LAW', law: '58.25' });
    expect((reviewed?.legalBasis as { articles: number[] }).articles.length).toBeGreaterThan(0);
  });

  it('records the paper filing begun by the registry office with the basis of «filing.paper»', async () => {
    const { result, events } = await capturingEvents(() => createPaperDraft(registry));
    expect(result).toMatch(/^[0-9a-f-]{36}$/);
    const created = actEvents(events).filter((e) => e.action === 'filing.draft.created');
    expect(created).toHaveLength(1);
    expect(created[0]?.legalBasis).toEqual(basisOf('filing.paper'));
  });

  it('records a payment that fails, and one that lapses, with the basis of the payment', async () => {
    const draftId = await createDraft(lawyer);
    const first = await updateDraft(lawyer, draftId, { caseType: COMMERCIAL_PAYMENT, defendantLocality: 'casablanca' });
    expect((await updateDraft(lawyer, draftId, { courtId: first.data!.suggestion?.courtId })).status).toBe(200);
    expect((await pasteApplication(lawyer, draftId, MODEL_CASE_APPLICATION_TEXT)).status).toBe(200);
    await runJobs();
    expect((await updateDraft(lawyer, draftId, { card: MODEL_CASE })).status).toBe(200);
    await attestAll(lawyer, draftId);
    expect((await upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'contrat.pdf', bytes: pdfBytes('contract'), nature: 'ORIGINAL' })).status).toBe(200);
    const { intentId } = await openPayment(lawyer, draftId);
    const failed = await capturingEvents(() => settle(lawyer, intentId, 'FAILED'));
    expect(actEvents(failed.events).map((e) => e.action)).toEqual(['payment.failed']);
    expect(actEvents(failed.events)[0]?.legalBasis).toEqual(basisOf('payment.simulate'));
    // A payment left pending lapses when the claims change: the edit writes it, with the edit's basis.
    await openPayment(lawyer, draftId);
    const changed = await capturingEvents(() =>
      updateDraft(lawyer, draftId, { card: { ...MODEL_CASE, claims: MODEL_CASE.claims.slice(0, 1) } }),
    );
    expect(changed.result.status, describeResponse(changed.result)).toBe(200);
    const lapsed = actEvents(changed.events).filter((e) => e.action === 'payment.expired');
    expect(lapsed).toHaveLength(1);
    for (const e of actEvents(changed.events)) expect(e.legalBasis, e.action).toEqual(basisOf('filing.draft.edit'));
  });
});

describe('the acts of the registry office and of the prosecution carry the basis of the act (independent review IR-12)', () => {
  const act = (client: Client, action: string, body: Record<string, unknown> = {}) =>
    step(action, () => client.post(`/api/v1/cases/${caseFileId}/actions/${action}`, body));

  it('records the correction of the classification, the stamp and the note with their articles', async () => {
    steps.length = 0;
    await act(registry, 'case.registration.reclassify', { caseType: '8203' });
    await act(registry, 'case.registration.stamp');
    await act(registry, 'case.registration.note-to-judge', { reason: 'CLASSIFICATION', text: 'رمز نوع القضية صحح قبل التأشير.' });
    for (const s of steps) expectBasisOfStep(s);
    const written = steps.flatMap((s) => s.events.map((e) => e.action));
    for (const action of ['case.registration.reclassified', 'case.referrals.reviewed', 'case.registration.stamped', 'case.note.added']) {
      expect(written, action).toContain(action);
    }
  });

  it('shows those articles under «السند» on the case timeline', async () => {
    const snapshot = await caseSnapshot(caseFileId, new Date());
    if (!snapshot) throw new Error('no snapshot');
    const view = await caseView(caseFileId, await subjectOf(registryUser), snapshot);
    const articlesOf = (action: string) => view?.timeline.find((e) => e.action === action)?.articles;
    expect(articlesOf('case.registration.stamped')).toEqual(articlesOfAction('case.registration.stamp'));
    expect(articlesOf('case.registration.reclassified')).toEqual(articlesOfAction('case.registration.reclassify'));
    expect(articlesOf('case.note.added')).toEqual(articlesOfAction('case.registration.note-to-judge'));
    expect(articlesOf('case.registered')).toEqual(articlesOfAction('filing.draft.submit'));
    expect(articlesOf('filing.submitted')).toEqual(articlesOfAction('filing.draft.submit'));
    // No line of the model case's timeline is left without its basis, what the worker printed
    // for the filing included (the receipt, the signature certificate, the documents they store).
    expect(view?.timeline.map((e) => e.action)).toEqual(expect.arrayContaining(['filing.receipt.issued', 'signature.certificate.issued']));
    const withoutBasis = (view?.timeline ?? []).filter((e) => e.articles.length === 0).map((e) => e.action);
    expect(withoutBasis).toEqual([]);
  });

  it('rests a note to the judge on art. 619 only when its reason is a fee shortfall', async () => {
    const note = async (reason: (typeof NOTE_REASONS)[number]) => {
      const { result, events } = await capturingEvents(() =>
        registry.post(`/api/v1/cases/${caseFileId}/actions/case.registration.note-to-judge`, { reason, text: 'ملاحظة للاختبار.' }),
      );
      expect(result.status, describeResponse(result)).toBe(200);
      return events.find((e) => e.action === 'case.note.added')?.legalBasis;
    };
    const fee = await note('FEE_SHORTFALL');
    expect(fee).toEqual(noteToJudgeBasis('FEE_SHORTFALL'));
    expect((fee as { articles: number[] }).articles).toContain(619);
    for (const reason of NOTE_REASONS.filter((r) => r !== 'FEE_SHORTFALL')) {
      const basis = await note(reason);
      expect(basis, reason).toEqual(noteToJudgeBasis(reason));
      expect((basis as { articles: number[] }).articles, reason).not.toContain(619);
    }
  });

  it('records the conclusions the prosecution files on a referred file with the basis of its act', async () => {
    const referred = await fileCase(lawyer, secret, { card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]), exhibits: 1 });
    const prosecutor = await login(prosecutorUser);
    steps.length = 0;
    await step('case.prosecution.conclusions', () =>
      prosecutor.post(`/api/v1/cases/${referred.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
        query: { name: 'conclusions.pdf', title: 'مستنتجات النيابة العامة' },
        rawBody: Buffer.from(pdfBytes('conclusions')),
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    for (const s of steps) expectBasisOfStep(s);
    expect(steps[0]?.events.map((e) => e.action)).toEqual(expect.arrayContaining(['document.stored', 'case.document.filed']));
  });
});
