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
import { CARD_SECTIONS, SECURITY_POLICY, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { cashierLedger } from '@/server/offices/cashier';
import { caseTypesOfCourt } from '@/server/offices/registry';
import { loadDraft } from '@/server/filings/drafts';
import { updateDraft as updateDraftDirectly } from '@/server/filings/service';
import { COMMERCIAL_PAYMENT, MODEL_CASE, PUBLIC_DEFENDANT_CASE, PUBLIC_ESTABLISHMENT, withParties } from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { capturingEvents, count, one, sql } from '../helpers/db';
import { createCourt, createUser, theCourt, type TestUser } from '../helpers/factories';
import { createPaperDraft, fileCase, getDraft, giveSigningSecret, openPayment, payDraft, prepareDraft, runJobs, settle, submit, updateDraft, upload } from '../helpers/filings';
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
    // The page of a lapsed payment says so (verification of the review fixes, L6).
    const late = await settle(lawyer, intentId, 'SUCCEEDED');
    expect({ status: late.status, code: late.code }, describeResponse(late)).toEqual({ status: 409, code: 'PAYMENT_LAPSED' });
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
    expect({ status: result.status, code: result.code }, describeResponse(result)).toEqual({ status: 409, code: 'PAYMENT_LAPSED' });
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

// ---------------------------------------------------------------------------
// The independent review of these fixes (docs/security/phase-2-review.md, «مراجعة الإصلاحات»).

const actorOf = (user: TestUser, role: string) => ({ userId: user.id, roleAssignmentId: user.roleAssignmentId, role, viaDemoSwitch: false });

/** A paper draft of the model case, ready to be paid at the counter. */
async function paperDraft(lawyerUserId: string | null, depositor = 'السيد نون'): Promise<string> {
  const clerk = await as('clerk');
  const draftId = await createPaperDraft(clerk);
  const card = { ...MODEL_CASE, parties: MODEL_CASE.parties.map((p) => ({ ...p, representedByFiler: false })) };
  const saved = await updateDraft(clerk, draftId, {
    caseType: COMMERCIAL_PAYMENT,
    card,
    paperDepositor: { name: depositor },
    ...(lawyerUserId ? { paperLawyerUserId: lawyerUserId } : {}),
    attest: [...CARD_SECTIONS],
  });
  expect(saved.status, describeResponse(saved)).toBe(200);
  expect((await upload(clerk, draftId, { kind: 'APPLICATION', name: 'scan.pdf', bytes: pdfBytes('scan'), pages: 1, location: 'خزانة التقييد' })).status).toBe(200);
  return draftId;
}

describe('the fixes hold under the review that followed them', () => {
  it('re-checks under the lock a payment recorded since the draft was read: the paid claims stay (M1)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const stale = await loadDraft(draftId);
    await payDraft(lawyer, draftId);
    const outcome = await updateDraftDirectly(stale!, await subjectOf(cast.lawyer), { card: withDebt(50_000_000) }, actorOf(cast.lawyer, 'LAWYER'));
    expect(outcome).toMatchObject({ ok: false, status: 409, code: 'CLAIMS_LOCKED' });
    const stored = await one<{ amount: string }>(`SELECT card->'claims'->0->>'amountCents' AS amount FROM "FilingDraft" WHERE id = $1`, [draftId]);
    expect(Number(stored.amount)).toBe(MODEL_CASE.claims[0]!.amountCents);
  });

  it('counts toward the cap only the drafts touched within its window: an abandoned draft locks no one out (M3)', async () => {
    const user = await createUser({ roles: ['LAWYER'], label: 'old-drafts' });
    const client = await login(user);
    await client.csrf();
    await sql(
      `INSERT INTO "FilingDraft" (id, "ownerUserId", "ownerRoleAssignmentId", channel, card, attestations, "createdAt", "updatedAt")
       SELECT gen_random_uuid(), $1, $2, 'ELECTRONIC', '{"parties":[],"summary":"","claims":[]}'::jsonb, '{}'::jsonb, now() - interval '90 days', now() - interval '60 days'
         FROM generate_series(1, $3)`,
      [user.id, user.roleAssignmentId, SECURITY_POLICY.filing.maxOpenDrafts],
    );
    const created = await client.post('/api/v1/filings', {});
    expect(created.status, describeResponse(created)).toBe(200);
  });

  it('records after a reclassification every referral the file has, not only the new ones (M4)', async () => {
    const referred = await fileCase(await as('lawyer'), secret, { card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]), exhibits: 1 });
    const standing = await count('SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1', [referred.caseFileId]);
    expect(standing).toBeGreaterThan(0);
    const res = await (await as('clerk')).post(`/api/v1/cases/${referred.caseFileId}/actions/case.registration.reclassify`, { caseType: '8203' });
    expect(res.status, describeResponse(res)).toBe(200);
    const last = await one<{ referrals: number }>(
      `SELECT (details->>'referrals')::int AS referrals FROM "Event" WHERE "caseFileId" = $1 AND action = 'case.referrals.reviewed' ORDER BY seq DESC LIMIT 1`,
      [referred.caseFileId],
    );
    expect(last.referrals).toBe(standing);
  });

  it('refuses the paper filing when the lawyer picked has left the roster since (L1)', async () => {
    const leaving = await createUser({ roles: ['LAWYER'], label: 'leaving-lawyer' });
    const clerk = await as('clerk');
    const draftId = await paperDraft(leaving.id);
    const { intentId } = await openPayment(clerk, draftId);
    expect((await settle(clerk, intentId, 'SUCCEEDED')).status).toBe(200);
    await runJobs();
    await sql(`UPDATE "RoleAssignment" SET "revokedAt" = now() WHERE "userId" = $1`, [leaving.id]);
    const before = await count('SELECT count(*) FROM "CaseFile"');
    const res = await submit(clerk, draftId, {});
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 409, code: 'DRAFT_CHANGED' });
    expect(await count('SELECT count(*) FROM "CaseFile"')).toBe(before);
  });

  it('keeps the depositor the payment receipt names once the fee is paid (L4)', async () => {
    const clerk = await as('clerk');
    const draftId = await paperDraft(null, 'السيد صاد');
    const { intentId } = await openPayment(clerk, draftId);
    expect((await settle(clerk, intentId, 'SUCCEEDED')).status).toBe(200);
    const changed = await updateDraft(clerk, draftId, { paperDepositor: { name: 'السيد قاف' } });
    expect({ status: changed.status, code: changed.code }).toEqual({ status: 409, code: 'DEPOSITOR_LOCKED' });
    expect((await updateDraft(clerk, draftId, { paperDepositor: { name: 'السيد صاد' } })).status).toBe(200);
  });

  it('lets a pending counter payment lapse when the depositor changes, and records none without a depositor (verification of L4)', async () => {
    const clerk = await as('clerk');
    const draftId = await paperDraft(null, 'السيد طاء');
    const first = await openPayment(clerk, draftId);
    // Another depositor while the payment is pending: the receipt would name the wrong person.
    expect((await updateDraft(clerk, draftId, { paperDepositor: { name: 'السيد ظاء' } })).status).toBe(200);
    expect(await intentStatus(first.intentId)).toBe('EXPIRED');
    const late = await settle(clerk, first.intentId, 'SUCCEEDED');
    expect({ status: late.status, code: late.code }).toEqual({ status: 409, code: 'PAYMENT_LAPSED' });
    // The depositor erased behind the page while a payment is pending: nothing is recorded.
    const second = await openPayment(clerk, draftId);
    await sql(`UPDATE "FilingDraft" SET "paperDepositor" = NULL WHERE id = $1`, [draftId]);
    const blank = await settle(clerk, second.intentId, 'SUCCEEDED');
    expect({ status: blank.status, code: blank.code }).toEqual({ status: 409, code: 'PAYMENT_LAPSED' });
    expect(await paymentsOf(draftId)).toBe(0);
    // A depositor entered again, the fee is paid and the draft can be filed.
    expect((await updateDraft(clerk, draftId, { paperDepositor: { name: 'السيد ظاء' } })).status).toBe(200);
    const third = await openPayment(clerk, draftId);
    expect((await settle(clerk, third.intentId, 'SUCCEEDED')).status).toBe(200);
    await runJobs();
    const filed = await submit(clerk, draftId, {});
    expect(filed.status, describeResponse(filed)).toBe(200);
  });

  it('attests no section the server rewrote while saving it (verification of L2)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const borrowed = { ...MODEL_CASE, parties: MODEL_CASE.parties.map((p) => (p.key === 'baa' ? { ...p, name: 'شركة أخرى للصناعة' } : p)) };
    expect((await updateDraft(lawyer, draftId, { card: borrowed, attest: [...CARD_SECTIONS] })).status).toBe(200);
    const view = await getDraft(lawyer, draftId);
    const unattested = view.checks.filter((c) => c.code === 'SECTION_NOT_ATTESTED').map((c) => c.section);
    expect(unattested).toEqual(['DEFENDANTS']);
  });

  it('keeps «السجل التجاري» only for the company the register names, with the register’s locality (L2)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const officeOf = async (key: string) =>
      (await one<{ office: { source: string; locality?: string } }>(`SELECT p->'registeredOffice' AS office FROM "FilingDraft", jsonb_array_elements(card->'parties') p WHERE id = $1 AND p->>'key' = $2`, [draftId, key])).office;
    // The register's address with a typed locality: the locality is the register's.
    const typed = { ...MODEL_CASE, parties: MODEL_CASE.parties.map((p) => (p.key === 'baa' && p.registeredOffice ? { ...p, registeredOffice: { ...p.registeredOffice, locality: 'rabat' } } : p)) };
    expect((await updateDraft(lawyer, draftId, { card: typed })).status).toBe(200);
    expect(await officeOf('baa')).toMatchObject({ source: 'COMMERCIAL_REGISTER', locality: 'casablanca' });
    // Another company with that company's number and address: declared.
    const borrowed = { ...MODEL_CASE, parties: MODEL_CASE.parties.map((p) => (p.key === 'baa' ? { ...p, name: 'شركة أخرى للتجارة' } : p)) };
    expect((await updateDraft(lawyer, draftId, { card: borrowed })).status).toBe(200);
    expect((await officeOf('baa')).source).toBe('DECLARED');
  });
});
