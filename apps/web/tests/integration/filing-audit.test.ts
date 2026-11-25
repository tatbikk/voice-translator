// Phase 2: the gaps the acceptance audit found after the reviews
// (docs/security/phase-2-review.md, «تدقيق القبول»), each with the test that
// holds it closed:
//   - a payment opened before the claims or the court changed covers nothing:
//     it lapses, and is never recorded as paid (G025);
//   - the cashier keeps what came in, at his own court only (G029, G030);
//   - the lawyer the registry clerk picks on a paper filing is counsel of the
//     plaintiffs and opens the file (G063);
//   - a download of a draft's document is recorded (G100);
//   - «تصحيح التصنيف» offers the case types of the court's specialty only (G067);
//   - the signed application carries the stamp «توقيع تجريبي» (G046).
import { beforeAll, describe, expect, it } from 'vitest';
import { CARD_SECTIONS, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { cashierLedger } from '@/server/offices/cashier';
import { caseTypesOfCourt } from '@/server/offices/registry';
import { COMMERCIAL_PAYMENT, MODEL_CASE } from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { capturingEvents, count, one, sql } from '../helpers/db';
import { createCourt, createUser, theCourt, type TestUser } from '../helpers/factories';
import { createPaperDraft, fileCase, getDraft, giveSigningSecret, openPayment, prepareDraft, runJobs, settle, submit, updateDraft, upload } from '../helpers/filings';
import { describeResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';
import { pdfBytes } from '../helpers/samples';

useFreshDatabase();

interface Cast {
  readonly lawyer: TestUser;
  readonly rosterLawyer: TestUser;
  readonly clerk: TestUser;
  readonly cashier: TestUser;
  readonly otherCourtCashier: TestUser;
}

let cast: Cast;
let secret: string;
let courtId: string;
const clients = new Map<string, Client>();
async function as(name: keyof Cast): Promise<Client> {
  let client = clients.get(name);
  if (!client) {
    client = await login(cast[name]);
    clients.set(name, client);
  }
  return client;
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

const context = () => ({ mode: 'demo' as const, demoToolsEnabled: false, now: new Date() });
const intentStatus = async (intentId: string) => (await one<{ status: string }>('SELECT status::text AS status FROM "PaymentIntent" WHERE id = $1', [intentId])).status;
const paymentsOf = (draftId: string) => count('SELECT count(*) FROM "Payment" WHERE "draftId" = $1', [draftId]);
const treasuryOf = (draftId: string) => count('SELECT count(*) FROM "TreasuryEntry" WHERE "draftId" = $1', [draftId]);
const withDebt = (cents: number) => ({ ...MODEL_CASE, claims: MODEL_CASE.claims.map((c) => (c.nature === 'DEBT' ? { ...c, amountCents: cents } : c)) });

beforeAll(async () => {
  const court = await theCourt();
  courtId = court.id;
  loadRuleTables();
  await makeModelCourt(court.id);
  const otherCourt = await createCourt();
  cast = {
    lawyer: await createUser({ roles: ['LAWYER'], label: 'lawyer' }),
    rosterLawyer: await createUser({ roles: ['LAWYER'], label: 'roster-lawyer' }),
    clerk: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registration-clerk' }),
    cashier: await createUser({ roles: ['CLERK_CASHIER'], label: 'cashier' }),
    otherCourtCashier: await createUser({ roles: [{ role: 'CLERK_CASHIER', courtId: otherCourt.id }], label: 'other-cashier' }),
  };
  secret = await giveSigningSecret(cast.lawyer.id);
});

// ---------------------------------------------------------------------------

describe('a payment covers the claims and the court it was opened on (audit G025)', () => {
  it('lets a pending payment lapse as soon as the claims change, and records nothing as paid', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const { intentId } = await openPayment(lawyer, draftId);
    const changed = await updateDraft(lawyer, draftId, { card: withDebt(50_000_000), attest: [...CARD_SECTIONS] });
    expect(changed.status, describeResponse(changed)).toBe(200);
    expect(await intentStatus(intentId)).toBe('EXPIRED');
    // The page of a lapsed payment is closed: refused at authorization, or at its lock.
    const late = await settle(lawyer, intentId, 'SUCCEEDED');
    expect([403, 409], describeResponse(late)).toContain(late.status);
    expect(await paymentsOf(draftId)).toBe(0);
    expect(await treasuryOf(draftId)).toBe(0);
    expect((await getDraft(lawyer, draftId)).claimsLocked).toBe(false);
  });

  it('refuses to record a payment whose claims were changed behind the page, under the draft’s lock', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const { intentId } = await openPayment(lawyer, draftId);
    await sql(`UPDATE "FilingDraft" SET card = jsonb_set(card, '{claims,0,amountCents}', '60000000'::jsonb) WHERE id = $1`, [draftId]);
    const { result, events } = await capturingEvents(() => settle(lawyer, intentId, 'SUCCEEDED'));
    expect(result.status, describeResponse(result)).toBe(409);
    expect(events.some((e) => e.action === 'payment.expired')).toBe(true);
    expect(await intentStatus(intentId)).toBe('EXPIRED');
    expect(await paymentsOf(draftId)).toBe(0);
    expect(await treasuryOf(draftId)).toBe(0);
  });

  it('records a payment whose claims did not change', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const { intentId } = await openPayment(lawyer, draftId);
    // A change that touches neither the claims nor the court keeps the payment pending.
    expect((await updateDraft(lawyer, draftId, { card: { ...MODEL_CASE, summary: `${MODEL_CASE.summary} ` } })).status).toBe(200);
    expect(await intentStatus(intentId)).toBe('PENDING');
    expect((await settle(lawyer, intentId, 'SUCCEEDED')).status).toBe(200);
    expect(await paymentsOf(draftId)).toBe(1);
  });
});

describe('the cashier keeps what came in, at his own court (audit G029, G030; memo row 23)', () => {
  it('lists the successful payment of the court, not the failed attempt, and nothing to the cashier of another court', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const failed = await openPayment(lawyer, draftId);
    expect((await settle(lawyer, failed.intentId, 'FAILED')).status).toBe(200);
    const paid = await openPayment(lawyer, draftId);
    const done = await settle(lawyer, paid.intentId, 'SUCCEEDED');
    expect(done.status).toBe(200);
    const operationRef = done.data!.operationRef;

    const ledger = await cashierLedger(await subjectOf(cast.cashier), context());
    expect(ledger.payments.some((p) => p.operationRef === operationRef)).toBe(true);
    expect(ledger.payments.every((p) => p.status === 'SUCCEEDED')).toBe(true);
    const failedRef = (await one<{ operationRef: string }>('SELECT "operationRef" FROM "Payment" WHERE "intentId" = $1', [failed.intentId])).operationRef;
    expect(ledger.payments.some((p) => p.operationRef === failedRef)).toBe(false);

    const elsewhere = await cashierLedger(await subjectOf(cast.otherCourtCashier), context());
    expect(elsewhere.payments.some((p) => p.operationRef === operationRef)).toBe(false);
  });
});

describe('the lawyer picked on a paper filing is counsel of the plaintiffs (audit G063, decision 59)', () => {
  it('registers him as counsel when the card marks no one, and he opens the file', async () => {
    const clerk = await as('clerk');
    const draftId = await createPaperDraft(clerk);
    const card = { ...MODEL_CASE, parties: MODEL_CASE.parties.map((p) => ({ ...p, representedByFiler: false })) };
    expect(
      (
        await updateDraft(clerk, draftId, {
          caseType: COMMERCIAL_PAYMENT,
          card,
          paperDepositor: { name: 'السيد نون', idNumber: 'DEMO-CIN-0002', quality: 'كاتب المحامي' },
          paperLawyerUserId: cast.rosterLawyer.id,
          attest: [...CARD_SECTIONS],
        })
      ).status,
    ).toBe(200);
    expect((await upload(clerk, draftId, { kind: 'APPLICATION', name: 'scan.pdf', bytes: pdfBytes('scan'), pages: 2, location: 'خزانة التقييد، الرف 2' })).status).toBe(200);
    const { intentId } = await openPayment(clerk, draftId);
    expect((await settle(clerk, intentId, 'SUCCEEDED')).status).toBe(200);
    await runJobs();
    const filed = await submit(clerk, draftId, {});
    expect(filed.status, describeResponse(filed)).toBe(200);
    const caseFileId = filed.data!.caseFileId;
    const counsel = await sql<{ side: string }>(
      `SELECT p.side::text AS side FROM "Representation" r JOIN "CaseParty" p ON p.id = r."partyId" WHERE p."caseFileId" = $1 AND r."lawyerUserId" = $2`,
      [caseFileId, cast.rosterLawyer.id],
    );
    expect(counsel.map((c) => c.side)).toEqual(['PLAINTIFF']);
    const opened = await (await as('rosterLawyer')).get(`/api/v1/cases/${caseFileId}/available-actions`);
    expect(opened.status, describeResponse(opened)).toBe(200);
  });
});

describe('every download of a draft’s document is recorded (audit G100, decision 47)', () => {
  it('appends document.downloaded for the draft’s own document', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const documentId = (await getDraft(lawyer, draftId)).documents.find((d) => d.kind === 'EXHIBIT')!.id;
    const { result, events } = await capturingEvents(() => lawyer.get(`/api/v1/filings/${draftId}/documents/${documentId}/file`));
    expect(result.status, describeResponse(result)).toBe(200);
    expect(events.filter((e) => e.action === 'document.downloaded').map((e) => (e.details as { documentId: string }).documentId)).toEqual([documentId]);
  });
});

describe('«تصحيح التصنيف» offers the case types of the court’s specialty only (audit G067)', () => {
  it('lists commercial types for the commercial model court, and none of another specialty', async () => {
    const types = (await caseTypesOfCourt(courtId, new Date())) as readonly { code: string; specialty?: string }[];
    expect(types.length).toBeGreaterThan(0);
    expect(types.map((t) => t.code)).toContain(COMMERCIAL_PAYMENT);
    expect(types.every((t) => t.specialty === 'COMMERCIAL')).toBe(true);
    expect(await caseTypesOfCourt(null, new Date())).toEqual([]);
  });
});

describe('the signed application carries the stamp «توقيع تجريبي» (audit G046)', () => {
  it('marks the application signed by the simulated provider', async () => {
    const lawyer = await as('lawyer');
    const filed = await fileCase(lawyer, secret, { exhibits: 1 });
    const snapshot = await caseSnapshot(filed.caseFileId, new Date());
    const view = await caseView(filed.caseFileId, await subjectOf(cast.lawyer), snapshot!);
    const application = view!.documents.find((d) => d.docType === 'APPLICATION');
    expect(application?.signatures).toBeGreaterThan(0);
    expect(application?.simulatedSignature).toBe(true);
  });
});
