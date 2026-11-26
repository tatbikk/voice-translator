// The mark «قيمة مؤقتة غير مؤكدة» goes with every amount that rests on a line of
// the fee the table marks uncertain (independent review IR-03, IR-04, IR-26),
// written before the code:
//   - the fee of the model case (5.570 dirhams) rests on rates and on a way of
//     applying the bands that were not checked on the official text: its amount
//     carries the mark on «أداء (محاكاة)», in the cashier's ledger, on the
//     registry office card, on the receipt page and in both printed receipts;
//   - a debt whose amount was left empty, and «طلب آخر» without amount, each
//     have a line of their own marked uncertain, and the mark with their amount;
//   - an amount that rests on nothing unsettled (the pleading fee alone) carries
//     the mark nowhere;
//   - the mark is read from the assessment stored with the payment, never
//     worked out again where the amount is shown.
import { beforeAll, describe, expect, it } from 'vitest';
import type { UserSubject } from '@mahkama/core';
import { documentStore } from '@/server/documents/store';
import { intentView, receiptView } from '@/server/filings/receipt';
import { cashierLedger } from '@/server/offices/cashier';
import { incomingFiles } from '@/server/offices/registry';
import {
  ENFORCEMENT_ONLY,
  MODEL_CASE,
  MODEL_CASE_FEE_CENTS,
  PLEADING_FEE_CENTS,
  UNVALUED_DEBT,
  UNVALUED_OTHER,
  withClaims,
} from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { one, sql } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { fileCase, getDraft, giveSigningSecret, openPayment, prepareDraft, settle, type FiledCase } from '../helpers/filings';
import { describeResponse, type Client } from '../helpers/http';
import { FILING } from '../helpers/labels';
import { containsRightToLeft, pdfPages } from '../helpers/pdf-text';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

interface Cast {
  readonly lawyer: TestUser;
  readonly registry: TestUser;
  readonly cashier: TestUser;
}

let cast: Cast;
let secret: string;
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

type Filed = FiledCase & { draftId: string };
/** The model case, whose fee rests on unsettled rules; and a file whose fee is the pleading fee alone. */
let model: Filed;
let settled: Filed;

const paymentOf = (file: Filed) =>
  one<{ id: string; intentId: string; operationRef: string; amountCents: string }>(
    `SELECT id, "intentId", "operationRef", "amountCents"::text AS "amountCents" FROM "Payment" WHERE "draftId" = $1 AND status = 'SUCCEEDED'`,
    [file.draftId],
  );

async function pdfOf(storageKey: string): Promise<string[]> {
  const bytes = await documentStore().get(storageKey);
  if (!bytes) throw new Error('the printed document is not in the store');
  return pdfPages(bytes).flat();
}
const paymentReceiptOf = async (file: Filed) =>
  pdfOf((await one<{ storageKey: string }>(`SELECT "storageKey" FROM "FilingDocument" WHERE "draftId" = $1 AND kind = 'PAYMENT_RECEIPT'`, [file.draftId])).storageKey);
const filingReceiptOf = async (file: Filed) =>
  pdfOf((await one<{ storageKey: string }>(`SELECT "storageKey" FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'FILING_RECEIPT'`, [file.caseFileId])).storageKey);

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  cast = {
    lawyer: await createUser({ roles: ['LAWYER'], label: 'lawyer' }),
    registry: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' }),
    cashier: await createUser({ roles: ['CLERK_CASHIER'], label: 'cashier' }),
  };
  secret = await giveSigningSecret(cast.lawyer.id);
  const lawyer = await as('lawyer');
  model = await fileCase(lawyer, secret, { exhibits: 1 });
  settled = await fileCase(lawyer, secret, { card: withClaims(MODEL_CASE, [ENFORCEMENT_ONLY]), exhibits: 1 });
}, 180_000);

// ---------------------------------------------------------------------------

describe('the fee as the screen «الرسم القضائي» details it', () => {
  it('marks the proportional fee of the model case, whose amount stays 5.570 dirhams', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const fee = (await getDraft(lawyer, draftId)).fee;
    expect(fee?.totalCents).toBe(MODEL_CASE_FEE_CENTS);
    expect(fee?.uncertain).toBe(true);
    expect(fee?.lines.map((line) => [line.kind, line.amountCents, line.uncertain])).toEqual([
      ['PROPORTIONAL', 526_000, true],
      ['SURCHARGE', 30_000, true],
      ['PLEADING', PLEADING_FEE_CENTS, false],
    ]);
    // Outside the base by the table: named, without a line.
    expect(fee?.excluded).toEqual(['LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS']);
  });

  for (const [what, claim] of [
    ['a debt whose amount was left empty', UNVALUED_DEBT],
    ['«طلب آخر» without amount', UNVALUED_OTHER],
  ] as const) {
    it(`gives ${what} a line of its own, marked uncertain, and the mark goes with the amount to the payment page`, async () => {
      const lawyer = await as('lawyer');
      const draftId = await prepareDraft(lawyer, { card: withClaims(MODEL_CASE, [claim]), exhibits: 1 });
      const fee = (await getDraft(lawyer, draftId)).fee;
      expect(fee?.totalCents).toBe(PLEADING_FEE_CENTS);
      expect(fee?.uncertain).toBe(true);
      expect(fee?.lines.map((line) => [line.kind, line.claimNature ?? null, line.amountCents, line.uncertain])).toEqual([
        ['UNVALUED_CLAIM', claim.nature, 0, true],
        ['PLEADING', null, PLEADING_FEE_CENTS, false],
      ]);
      expect(fee?.excluded).toEqual([]);

      const { intentId, amountCents } = await openPayment(lawyer, draftId);
      expect(amountCents).toBe(PLEADING_FEE_CENTS);
      // The line is kept with the payment as it was opened.
      const stored = await one<{ kinds: string[] }>(
        `SELECT array(SELECT line->>'kind' FROM jsonb_array_elements(breakdown->'lines') AS line WHERE line->>'uncertain' = 'true') AS kinds FROM "PaymentIntent" WHERE id = $1`,
        [intentId],
      );
      expect(stored.kinds).toEqual(['UNVALUED_CLAIM']);
      expect((await intentView(intentId, new Date()))?.amountUncertain).toBe(true);
    });
  }
});

describe('the mark goes with the amount wherever it is shown (independent review IR-26)', () => {
  it('on «أداء (محاكاة)», before and after the payment', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const { intentId } = await openPayment(lawyer, draftId);
    const pending = await intentView(intentId, new Date());
    expect(pending).toMatchObject({ status: 'PENDING', amountCents: BigInt(MODEL_CASE_FEE_CENTS), amountUncertain: true });
    const paid = await settle(lawyer, intentId, 'SUCCEEDED');
    expect(paid.status, describeResponse(paid)).toBe(200);
    expect(await intentView(intentId, new Date())).toMatchObject({ status: 'SUCCEEDED', amountUncertain: true });
    // The pleading fee alone rests on nothing unsettled.
    const other = await paymentOf(settled);
    expect(await intentView(other.intentId, new Date())).toMatchObject({ amountCents: BigInt(PLEADING_FEE_CENTS), amountUncertain: false });
  });

  it('in the cashier’s ledger, for the amount that came in and for the fee the claims call for', async () => {
    const ledger = await cashierLedger(await subjectOf(cast.cashier), context());
    const row = async (file: Filed) => {
      const { operationRef } = await paymentOf(file);
      return ledger.payments.find((p) => p.operationRef === operationRef);
    };
    expect(await row(model)).toMatchObject({
      amountCents: BigInt(MODEL_CASE_FEE_CENTS),
      uncertain: true,
      assessedCents: BigInt(MODEL_CASE_FEE_CENTS),
      assessedUncertain: true,
    });
    expect(await row(settled)).toMatchObject({
      amountCents: BigInt(PLEADING_FEE_CENTS),
      uncertain: false,
      assessedCents: BigInt(PLEADING_FEE_CENTS),
      assessedUncertain: false,
    });
  });

  it('on the registry office card, for the fee paid and for the fee the claims call for', async () => {
    const incoming = await incomingFiles(await subjectOf(cast.registry), context());
    expect(incoming.find((f) => f.caseFileId === model.caseFileId)).toMatchObject({
      feePaidCents: BigInt(MODEL_CASE_FEE_CENTS),
      feePaidUncertain: true,
      feeAssessedCents: BigInt(MODEL_CASE_FEE_CENTS),
      feeAssessedUncertain: true,
    });
    expect(incoming.find((f) => f.caseFileId === settled.caseFileId)).toMatchObject({
      feePaidCents: BigInt(PLEADING_FEE_CENTS),
      feePaidUncertain: false,
      feeAssessedCents: BigInt(PLEADING_FEE_CENTS),
      feeAssessedUncertain: false,
    });
  });

  it('on the receipt page «وصل الإيداع»', async () => {
    expect((await receiptView(model.draftId))?.payment).toMatchObject({ amountCents: BigInt(MODEL_CASE_FEE_CENTS), uncertain: true });
    expect((await receiptView(settled.draftId))?.payment).toMatchObject({ amountCents: BigInt(PLEADING_FEE_CENTS), uncertain: false });
  });

  it('in the text of the printed «وصل الأداء»', async () => {
    const marked = await paymentReceiptOf(model);
    expect(marked.join('\n')).toMatch(/5\.570/);
    expect(containsRightToLeft(marked, FILING.uncertain), marked.join(' | ')).toBe(true);
    expect(containsRightToLeft(await paymentReceiptOf(settled), FILING.uncertain)).toBe(false);
  });

  it('in the text of the printed «وصل الإيداع»', async () => {
    const marked = await filingReceiptOf(model);
    expect(marked.join('\n')).toMatch(/5\.570/);
    expect(containsRightToLeft(marked, FILING.uncertain), marked.join(' | ')).toBe(true);
    expect(containsRightToLeft(await filingReceiptOf(settled), FILING.uncertain)).toBe(false);
  });
});

describe('the mark is read from the assessment stored with the payment', () => {
  const clone = async (intentId: string, id: string, breakdown: string) => {
    await sql(
      `INSERT INTO "PaymentIntent" (id, "draftId", purpose, "amountCents", "inputsDigest", breakdown, "ruleSetId", method, status, "createdByUserId", "createdAt", "expiresAt")
       SELECT $2::uuid, "draftId", purpose, "amountCents", "inputsDigest", ${breakdown}, "ruleSetId", method, 'EXPIRED', "createdByUserId", now(), now() + interval '20 minutes'
         FROM "PaymentIntent" WHERE id = $1`,
      [intentId, id],
    );
    return (await intentView(id, new Date()))?.amountUncertain;
  };

  it('follows what the stored lines say, whatever the table in force would say today of the same claims', async () => {
    const { intentId } = await paymentOf(model);
    // The same amount, kept with lines none of which is marked: no mark.
    const unmarked = `jsonb_set(breakdown, '{lines}', (SELECT jsonb_agg(line || '{"uncertain": false}'::jsonb) FROM jsonb_array_elements(breakdown->'lines') AS line))`;
    expect(await clone(intentId, '00000000-0000-4000-8000-0000000000c1', unmarked)).toBe(false);
    // The pleading fee alone, kept with a line marked: the mark.
    const pleading = await paymentOf(settled);
    const marked = `jsonb_set(breakdown, '{lines}', (SELECT jsonb_agg(line || '{"uncertain": true}'::jsonb) FROM jsonb_array_elements(breakdown->'lines') AS line))`;
    expect(await clone(pleading.intentId, '00000000-0000-4000-8000-0000000000c2', marked)).toBe(true);
  });

  it('is shown when the record does not say what the amount rests on', async () => {
    const pleading = await paymentOf(settled);
    expect(await clone(pleading.intentId, '00000000-0000-4000-8000-0000000000c3', `'{}'::jsonb`)).toBe(true);
  });

  it('comes, for a payment recorded without its opening, from the assessment kept on its file', async () => {
    const insert = (file: Filed, ref: string, cents: number) =>
      sql(
        `INSERT INTO "Payment" (id, "caseFileId", purpose, "amountCents", status, "operationRef", "paidAt")
         VALUES (gen_random_uuid(), $1, 'COURT_FEE', $2, 'SUCCEEDED', $3, now())`,
        [file.caseFileId, cents, ref],
      );
    // As the demo seed records the fee of its files: an assessment on the file, a payment of the same amount.
    await insert(model, 'TEST-PAY-MARKED', MODEL_CASE_FEE_CENTS);
    await insert(settled, 'TEST-PAY-SETTLED', PLEADING_FEE_CENTS);
    // And an amount no assessment of the file accounts for.
    await insert(settled, 'TEST-PAY-UNKNOWN', 12_345);
    const ledger = await cashierLedger(await subjectOf(cast.cashier), context());
    const mark = (ref: string) => ledger.payments.find((p) => p.operationRef === ref)?.uncertain;
    expect(mark('TEST-PAY-MARKED')).toBe(true);
    expect(mark('TEST-PAY-SETTLED')).toBe(false);
    expect(mark('TEST-PAY-UNKNOWN')).toBe(true);
  });
});
