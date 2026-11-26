// Independent review IR-17 and IR-20, on the pages themselves (the routes are
// covered by the refusal matrix): the page's default export is called as the
// server calls it, with the cookies of a test browser (tests/helpers/page-request.ts).
//   - «دعوى جديدة», «وصل الإيداع» and «أداء (محاكاة)» of a lawyer's draft are
//     found by their author alone: another lawyer, an assistant of a law firm
//     and a registry clerk meet the 404 of a page that does not exist, and the
//     refusal is logged under the page's id (Phase 2 memo, row 2). No link
//     between a lawyer and a law firm is modelled (decision 56: the delegation
//     of the firm's assistants comes with the firm's account), so the assistant
//     is of a firm, not of the author's office;
//   - the registry's note to the judge, written through the case's action
//     route, leaves no «case.note.added» entry on the timeline the case page
//     gives counsel, and one on the timeline it gives the court president;
//   - documents kept for the panel (PANEL) or the rapporteur (JUDGE) are not
//     listed to counsel nor to the registry clerk on the case page, and are
//     listed to the panel member and the rapporteur.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { storeDocument } from '@/server/documents/service';
import type { CaseView } from '@/server/cases/view';
import { login } from '../helpers/auth';
import { capturingEvents, one, sql } from '../helpers/db';
import { createPanel, createUser, theCourt, type TestUser } from '../helpers/factories';
import { fileCase, giveSigningSecret, type FiledCase } from '../helpers/filings';
import { describeResponse, type Client } from '../helpers/http';
import { propsNamed, renderPage, type PageOutcome } from '../helpers/page-request';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

vi.mock('next/headers', async () => (await import('../helpers/page-request')).NEXT_HEADERS);

const FILING_PAGE = () => import('@/app/(app)/filings/[draftId]/page');
const RECEIPT_PAGE = () => import('@/app/(app)/filings/[draftId]/receipt/page');
const PAYMENT_PAGE = () => import('@/app/(app)/payments/[intentId]/page');
const CASE_PAGE = () => import('@/app/(app)/cases/[caseId]/page');

useFreshDatabase();

interface Cast {
  readonly lawyer: TestUser;
  readonly otherLawyer: TestUser;
  readonly assistant: TestUser;
  readonly registry: TestUser;
  readonly president: TestUser;
  readonly rapporteur: TestUser;
  readonly panelMember: TestUser;
}

let cast: Cast;
let filed: FiledCase & { draftId: string };
let intentId: string;
const clients = new Map<keyof Cast, Client>();
async function as(name: keyof Cast): Promise<Client> {
  let client = clients.get(name);
  if (!client) {
    client = await login(cast[name]);
    clients.set(name, client);
  }
  return client;
}

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  cast = {
    lawyer: await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' }),
    otherLawyer: await createUser({ roles: ['LAWYER'], label: 'other-lawyer' }),
    // An assistant of a law firm: the platform models no link between the author and a firm (decision 56).
    assistant: await createUser({ roles: ['LAWYER_ASSISTANT'], label: 'firm-assistant' }),
    registry: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' }),
    president: await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' }),
    rapporteur: await createUser({ roles: ['JUDGE_RAPPORTEUR'], label: 'rapporteur' }),
    panelMember: await createUser({ roles: ['PANEL_MEMBER'], label: 'panel-member' }),
  };
  const secret = await giveSigningSecret(cast.lawyer.id);
  filed = await fileCase(await as('lawyer'), secret);
  const intent = await one<{ id: string }>(`SELECT id FROM "PaymentIntent" WHERE "draftId" = $1`, [filed.draftId]);
  intentId = intent.id;
}, 180_000);

/** The page's outcome, and the refusals it logged under the page's id. */
async function visit(
  page: () => Promise<{ default: unknown }>,
  pageId: string,
  name: keyof Cast,
  path: string,
  params: Record<string, string>,
): Promise<{ outcome: PageOutcome; refusals: readonly Record<string, unknown>[] }> {
  const client = await as(name);
  const { result, events } = await capturingEvents(() => renderPage(page, client, path, params));
  const refusals = events.filter((e) => e.action === 'access.denied' && e.details.target === pageId).map((e) => e.details);
  return { outcome: result, refusals };
}

// ---------------------------------------------------------------------------

describe('the pages of a draft and of its payment are found by their author alone (IR-17, Phase 2 memo row 2)', () => {
  const pages = () =>
    [
      { label: '«دعوى جديدة»', page: FILING_PAGE, id: 'filing', path: `/filings/${filed.draftId}`, params: { draftId: filed.draftId } },
      { label: '«وصل الإيداع»', page: RECEIPT_PAGE, id: 'filing.receipt', path: `/filings/${filed.draftId}/receipt`, params: { draftId: filed.draftId } },
      { label: '«أداء (محاكاة)»', page: PAYMENT_PAGE, id: 'payment', path: `/payments/${intentId}`, params: { intentId } },
    ] as const;

  it('renders each page for the lawyer who filed (the positive witness)', async () => {
    for (const p of pages()) {
      const { outcome, refusals } = await visit(p.page, p.id, 'lawyer', p.path, p.params);
      expect(outcome.kind, p.label).toBe('rendered');
      expect(refusals, p.label).toEqual([]);
    }
  });

  for (const name of ['otherLawyer', 'assistant', 'registry'] as const) {
    it(`answers ${name} with the 404 of a page that does not exist, and logs the refusal under the page's id`, async () => {
      for (const p of pages()) {
        const { outcome, refusals } = await visit(p.page, p.id, name, p.path, p.params);
        expect(outcome.kind, `${p.label} for ${name}`).toBe('not-found');
        expect(refusals.map((r) => r.step), `${p.label} for ${name}: the refusal is logged`).toEqual(['AUTHZ']);
      }
    });
  }

  it('answers an unknown draft and an unknown payment exactly as one of another lawyer', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const [page, id, path, params] of [
      [FILING_PAGE, 'filing', `/filings/${unknown}`, { draftId: unknown }],
      [RECEIPT_PAGE, 'filing.receipt', `/filings/${unknown}/receipt`, { draftId: unknown }],
      [PAYMENT_PAGE, 'payment', `/payments/${unknown}`, { intentId: unknown }],
    ] as const) {
      const { outcome, refusals } = await visit(page, id, 'otherLawyer', path, params);
      expect(outcome.kind, path).toBe('not-found');
      expect(refusals.map((r) => r.step), path).toEqual(['AUTHZ']);
    }
  });
});

// ---------------------------------------------------------------------------

/** The view the case page passes to its tabs, for one member of the cast. */
async function casePageView(name: keyof Cast): Promise<CaseView> {
  const client = await as(name);
  const outcome = await renderPage(CASE_PAGE, client, `/cases/${filed.caseFileId}`, { caseId: filed.caseFileId });
  expect(outcome.kind, `the case page for ${name}`).toBe('rendered');
  if (outcome.kind !== 'rendered') throw new Error('not rendered');
  const views = propsNamed(outcome.tree, 'view') as CaseView[];
  expect(views.length, 'the tabs receive the view').toBeGreaterThan(0);
  return views[0]!;
}

describe('the note of the registry to the judge, on the case page (IR-20)', () => {
  beforeAll(async () => {
    const registry = await as('registry');
    const res = await registry.post(`/api/v1/cases/${filed.caseFileId}/actions/case.registration.note-to-judge`, {
      reason: 'FEE_SHORTFALL',
      text: 'يبدو الرسم المؤدى ناقصا بالنظر إلى الطلبات.',
    });
    expect(res.status, describeResponse(res)).toBe(200);
  });

  it('leaves no trace of the note on the timeline the case page gives counsel', async () => {
    const view = await casePageView('lawyer');
    expect(view.timeline.map((e) => e.action)).not.toContain('case.note.added');
    expect(view.notes).toEqual([]);
    // The file's own history is there: the page is not empty for counsel.
    expect(view.timeline.map((e) => e.action)).toContain('case.registered');
  });

  it('shows the note and its entry on the timeline the case page gives the court president', async () => {
    const view = await casePageView('president');
    expect(view.timeline.map((e) => e.action)).toContain('case.note.added');
    expect(view.notes.map((n) => n.reason)).toEqual(['FEE_SHORTFALL']);
  });
});

// ---------------------------------------------------------------------------

describe('documents kept for the panel or the rapporteur are not listed to counsel nor to the registry (IR-20)', () => {
  let panelDocumentId: string;
  let judgeDocumentId: string;

  beforeAll(async () => {
    const court = await theCourt();
    const panelId = await createPanel(court.id);
    for (const user of [cast.rapporteur, cast.panelMember]) {
      await sql(`UPDATE "RoleAssignment" SET "panelId" = $1 WHERE id = $2`, [panelId, user.roleAssignmentId]);
    }
    await sql(`UPDATE "CaseFile" SET "panelId" = $2, "rapporteurUserId" = $3, status = 'IN_DELIBERATION' WHERE id = $1`, [
      filed.caseFileId,
      panelId,
      cast.rapporteur.id,
    ]);
    const stored = (docType: string, visibility: 'PANEL' | 'JUDGE') =>
      storeDocument({
        caseFileId: filed.caseFileId,
        bytes: new TextEncoder().encode(`%PDF-1.7\n% ${visibility}\n`),
        mediaType: 'application/pdf',
        docType,
        visibility,
        channel: 'ELECTRONIC',
        declaredNature: null,
        generated: true,
        depositedByUserId: cast.rapporteur.id,
        depositedByPartyId: null,
      });
    panelDocumentId = (await stored('JUDGMENT', 'PANEL')).id;
    judgeDocumentId = (await stored('JUDGMENT', 'JUDGE')).id;
  });

  it('lists neither to the plaintiff’s counsel', async () => {
    const ids = (await casePageView('lawyer')).documents.map((d) => d.id);
    expect(ids.length, 'counsel sees the documents of the file').toBeGreaterThan(0);
    expect(ids).not.toContain(panelDocumentId);
    expect(ids).not.toContain(judgeDocumentId);
  });

  it('lists neither to the registry clerk of the court', async () => {
    const ids = (await casePageView('registry')).documents.map((d) => d.id);
    expect(ids.length, 'the registry sees the documents of the file').toBeGreaterThan(0);
    expect(ids).not.toContain(panelDocumentId);
    expect(ids).not.toContain(judgeDocumentId);
  });

  it('lists the panel’s document to the panel member, and both to the rapporteur', async () => {
    const member = (await casePageView('panelMember')).documents.map((d) => d.id);
    expect(member).toContain(panelDocumentId);
    expect(member).not.toContain(judgeDocumentId);
    const rapporteur = (await casePageView('rapporteur')).documents.map((d) => d.id);
    expect(rapporteur).toContain(panelDocumentId);
    expect(rapporteur).toContain(judgeDocumentId);
  });
});
