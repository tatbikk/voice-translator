// Phase 2 refusal tests (docs/security/phase-2-memo.md), written before the
// code they guard. The three cases the prompt names for this phase:
//   - a file whose content contradicts its extension (memo row 1, with 13, 14, 15, 17);
//   - a lawyer reading another lawyer's draft (row 2), and the payment page of another (row 2);
//   - completing a filing without payment (rows 3 to 5, 27);
// and the other rows of the memo that concern the draft: filing twice (6),
// the signing secret (19, 20), the bailiff (21), the paper filing (24), a
// filed draft (26). Every refusal must leave a record in the event log.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@mahkama/core';
import {
  CARD_SECTIONS,
  COMMERCIAL_PAYMENT,
  MODEL_CASE,
  MODEL_CASE_FEE_CENTS,
  PUBLIC_DEFENDANT_CASE,
  PUBLIC_ESTABLISHMENT,
  PUBLIC_PERSON_WITHOUT_KIND,
  withCounselBox,
  withParties,
} from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { capturingEvents, count, one, runtime, sql, type EventRow } from '../helpers/db';
import { createCourt, createUser, theCourt, type TestUser } from '../helpers/factories';
import {
  createDraft,
  createPaperDraft,
  getDraft,
  giveSigningSecret,
  openPayment,
  payDraft,
  prepareDraft,
  runJobs,
  settle,
  submit,
  updateDocument,
  updateDraft,
  upload,
} from '../helpers/filings';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';
import {
  EXECUTABLE,
  HTML_PAGE,
  PLAIN_TEXT,
  docxBomb,
  docxBytes,
  docxWithManyEntries,
  jpegBytes,
  pdfBytes,
  pdfWithEmbeddedFile,
  pdfWithEscapedJavaScript,
  pdfWithJavaScript,
  pdfWithLaunch,
  plainZip,
  pngBytes,
} from '../helpers/samples';

useFreshDatabase();

interface Cast {
  readonly lawyer: TestUser;
  readonly otherLawyer: TestUser;
  readonly assistant: TestUser;
  readonly clerk: TestUser;
  readonly otherCourtClerk: TestUser;
  readonly cashier: TestUser;
  readonly judge: TestUser;
  readonly admin: TestUser;
  readonly bailiff: TestUser;
  readonly otherCourtBailiff: TestUser;
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

// One lawyer session files many drafts across this file: each test starts with
// its upload window empty, so that the hourly limit, tested on its own below
// («the limits of a draft…»), does not stand in for the refusal a test looks for.
beforeEach(async () => {
  await sql(`DELETE FROM "RateLimitHit" WHERE key LIKE 'uploads:%'`);
});

const deniedEvents = (events: readonly EventRow[]) => events.filter((e) => e.action === 'access.denied');
const refusalEvents = (events: readonly EventRow[]) => events.filter((e) => e.action === 'access.denied' || e.action === 'filing.refused');

async function expectRefused(fn: () => Promise<ApiResponse>, status: number, code?: string): Promise<EventRow[]> {
  const { result, events } = await capturingEvents(fn);
  expect(result.status, describeResponse(result)).toBe(status);
  if (code) expect(result.code).toBe(code);
  expect(refusalEvents(events).length, 'the refusal is recorded').toBeGreaterThan(0);
  return events;
}

const storedObjects = () => count('SELECT count(*) FROM "FilingDocument"');
const caseFiles = () => count('SELECT count(*) FROM "CaseFile"');

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  const otherCourt = await createCourt();
  cast = {
    lawyer: await createUser({ roles: ['LAWYER'], label: 'lawyer' }),
    otherLawyer: await createUser({ roles: ['LAWYER'], label: 'other-lawyer' }),
    assistant: await createUser({ roles: ['LAWYER_ASSISTANT'], label: 'assistant' }),
    clerk: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registration-clerk' }),
    otherCourtClerk: await createUser({ roles: [{ role: 'CLERK_REGISTRATION', courtId: otherCourt.id }], label: 'other-court-clerk' }),
    cashier: await createUser({ roles: ['CLERK_CASHIER'], label: 'cashier' }),
    judge: await createUser({ roles: ['JUDGE_RAPPORTEUR'], label: 'judge' }),
    admin: await createUser({ roles: ['SYSTEM_ADMIN'], label: 'admin' }),
    bailiff: await createUser({ roles: [{ role: 'BAILIFF', courtId: court.id }], label: 'bailiff' }),
    otherCourtBailiff: await createUser({ roles: [{ role: 'BAILIFF', courtId: otherCourt.id }], label: 'other-bailiff' }),
  };
  secret = await giveSigningSecret(cast.lawyer.id);
});

// ---------------------------------------------------------------------------

describe('a draft belongs to its author alone (memo row 2)', () => {
  let draftId: string;
  let documentId: string;
  let intentId: string;

  beforeAll(async () => {
    const lawyer = await as('lawyer');
    draftId = await createDraft(lawyer);
    const res = await upload(lawyer, draftId, { kind: 'APPLICATION', name: 'maqal.pdf', bytes: pdfBytes('secret application') });
    expect(res.status, describeResponse(res)).toBe(200);
    documentId = res.data!.documentId;
    // A draft complete enough to be paid (decision 55): its sections attested.
    await updateDraft(lawyer, draftId, { caseType: COMMERCIAL_PAYMENT, courtId: (await theCourt()).id, card: MODEL_CASE, attest: [...CARD_SECTIONS] });
    intentId = (await openPayment(lawyer, draftId)).intentId;
  });

  it('answers another lawyer exactly as for a draft that does not exist, on every route of the draft', async () => {
    const other = await as('otherLawyer');
    const unknown = '00000000-0000-4000-8000-000000000777';
    for (const id of [draftId, unknown]) {
      await expectRefused(() => other.get(`/api/v1/filings/${id}`), 404, 'NOT_FOUND');
      await expectRefused(() => updateDraft(other, id, { card: MODEL_CASE }), 404, 'NOT_FOUND');
      await expectRefused(() => other.post(`/api/v1/filings/${id}/application-text`, { text: 'نص' }), 404, 'NOT_FOUND');
      await expectRefused(() => upload(other, id, { kind: 'EXHIBIT', name: 'x.pdf', bytes: pdfBytes(), nature: 'ORIGINAL' }), 404, 'NOT_FOUND');
      await expectRefused(() => other.get(`/api/v1/filings/${id}/documents/${documentId}/file`), 404, 'NOT_FOUND');
      await expectRefused(() => updateDocument(other, id, documentId, { remove: true }), 404, 'NOT_FOUND');
      await expectRefused(() => other.post(`/api/v1/filings/${id}/payment`, {}), 404, 'NOT_FOUND');
      await expectRefused(() => submit(other, id, { secret: 'whatever-secret' }), 404, 'NOT_FOUND');
    }
  });

  it('refuses another lawyer the payment page of the draft, as an unknown payment', async () => {
    const other = await as('otherLawyer');
    await expectRefused(() => settle(other, intentId, 'SUCCEEDED'), 404, 'NOT_FOUND');
    await expectRefused(() => settle(other, '00000000-0000-4000-8000-000000000778', 'SUCCEEDED'), 404, 'NOT_FOUND');
    expect((await getDraft(await as('lawyer'), draftId)).payment.status).toBe('PENDING');
  });

  it('refuses the office assistant, the registry clerk, a judge and the administrator', async () => {
    for (const name of ['assistant', 'judge', 'admin', 'cashier'] as const) {
      const client = await as(name);
      await expectRefused(() => client.get(`/api/v1/filings/${draftId}`), 403, 'FORBIDDEN');
      await expectRefused(() => client.post('/api/v1/filings', {}), 403, 'FORBIDDEN');
    }
    // The registry clerk holds paper drafts, not this one: the same answer as an unknown draft.
    const clerk = await as('clerk');
    await expectRefused(() => clerk.get(`/api/v1/filings/${draftId}`), 404, 'NOT_FOUND');
    await expectRefused(() => clerk.get(`/api/v1/filings/${draftId}/documents/${documentId}/file`), 404, 'NOT_FOUND');
  });

  it('answers 404 for a document of another draft asked through one’s own draft, on reading, editing and removal, and downloads nothing (independent review IR-17)', async () => {
    const documentState = () =>
      one<{ title: string | null; removedAt: Date | null }>('SELECT title, "removedAt" FROM "FilingDocument" WHERE id = $1', [documentId]);
    const before = await documentState();
    // Another lawyer through his own draft, and the author through another draft of his own.
    const other = await as('otherLawyer');
    const lawyer = await as('lawyer');
    const throughOwn = [
      { client: other, draft: await createDraft(other) },
      { client: lawyer, draft: await createDraft(lawyer) },
    ];
    for (const { client, draft } of throughOwn) {
      const read = await expectRefused(() => client.get(`/api/v1/filings/${draft}/documents/${documentId}/file`), 404, 'NOT_FOUND');
      expect(read.filter((e) => e.action === 'document.downloaded'), 'nothing is downloaded').toEqual([]);
      for (const body of [{ title: 'عنوان آخر' }, { nature: 'PHOTOCOPY' }, { remove: true }]) {
        const events = await expectRefused(() => updateDocument(client, draft, documentId, body), 404, 'NOT_FOUND');
        expect(events.filter((e) => e.action === 'filing.document.updated'), 'nothing is changed').toEqual([]);
      }
    }
    expect(await documentState(), 'the document keeps its title and stays in its draft').toEqual(before);
    // Through its own draft the same document is served (the positive witness).
    const own = await capturingEvents(() => lawyer.get(`/api/v1/filings/${draftId}/documents/${documentId}/file`));
    expect(own.result.status, describeResponse(own.result)).toBe(200);
    expect(own.events.filter((e) => e.action === 'document.downloaded').map((e) => e.details.documentId)).toEqual([documentId]);
  });

  it('serves the author his own document as an attachment, never as a web page', async () => {
    const res = await (await as('lawyer')).get(`/api/v1/filings/${draftId}/documents/${documentId}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition') ?? '').toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy') ?? '').toMatch(/sandbox/);
  });

  it('records the draft’s history without the card’s content', async () => {
    const lawyer = await as('lawyer');
    const { events } = await capturingEvents(() => updateDraft(lawyer, draftId, { card: MODEL_CASE }));
    const text = JSON.stringify(events.map((e) => e.details));
    for (const party of MODEL_CASE.parties) expect(text).not.toContain(party.name);
    expect(text).not.toContain('RC-DEMO');
  });
});

// ---------------------------------------------------------------------------

describe('a file is known by its content, not by its name (memo rows 1, 13, 14, 15, 17)', () => {
  let draftId: string;

  beforeAll(async () => {
    draftId = await createDraft(await as('lawyer'));
  });

  const exhibit = (name: string, bytes: Uint8Array) => async () => upload(await as('lawyer'), draftId, { kind: 'EXHIBIT', name, bytes, title: name, nature: 'ORIGINAL' });
  const application = (name: string, bytes: Uint8Array) => async () => upload(await as('lawyer'), draftId, { kind: 'APPLICATION', name, bytes });

  it('accepts each type where the procedure accepts it, and records the type read from the content', async () => {
    for (const [name, bytes, mediaType] of [
      ['contract.pdf', pdfBytes(), 'application/pdf'],
      ['receipt.png', pngBytes(), 'image/png'],
      ['delivery.jpg', jpegBytes(), 'image/jpeg'],
      ['delivery.jpeg', jpegBytes(), 'image/jpeg'],
    ] as const) {
      const res = await exhibit(name, bytes)();
      expect(res.status, `${name}: ${describeResponse(res)}`).toBe(200);
      expect(res.data!.mediaType).toBe(mediaType);
    }
    const docx = await application('maqal.docx', docxBytes(['مقال افتتاحي', 'الوقائع']))();
    expect(docx.status, describeResponse(docx)).toBe(200);
    expect(docx.data!.mediaType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('refuses a file whose content contradicts its extension, and stores nothing', async () => {
    const before = await storedObjects();
    for (const [name, bytes] of [
      ['contract.pdf', HTML_PAGE],
      ['contract.pdf', EXECUTABLE],
      ['contract.pdf', pngBytes()],
      ['scan.png', pdfBytes()],
      ['photo.jpg', pngBytes()],
      ['maqal.docx', pdfBytes()],
    ] as const) {
      const events = await expectRefused(exhibit(name, bytes), 415, 'FILE_TYPE_MISMATCH');
      expect(events.some((e) => e.action === 'filing.refused' && e.details.reason === 'FILE_TYPE_MISMATCH')).toBe(true);
    }
    const docxAsPdf = await expectRefused(application('maqal.pdf', docxBytes(['x'])), 415, 'FILE_TYPE_MISMATCH');
    expect(docxAsPdf.length).toBeGreaterThan(0);
    expect(await storedObjects()).toBe(before);
  });

  it('refuses a type the procedure does not accept at this place, whatever its name', async () => {
    await expectRefused(exhibit('notes.txt', PLAIN_TEXT), 415, 'FILE_TYPE_NOT_ACCEPTED');
    await expectRefused(exhibit('page.html', HTML_PAGE), 415, 'FILE_TYPE_NOT_ACCEPTED');
    await expectRefused(exhibit('archive.zip', plainZip()), 415, 'FILE_TYPE_NOT_ACCEPTED');
    await expectRefused(exhibit('no-extension', pdfBytes()), 415, 'FILE_TYPE_NOT_ACCEPTED');
    // An application is a PDF or a Word document (study), not an image.
    await expectRefused(application('maqal.png', pngBytes()), 415, 'FILE_TYPE_NOT_ACCEPTED');
    // Exhibits are scans and PDFs: a Word document is not an exhibit.
    await expectRefused(exhibit('annex.docx', docxBytes(['x'])), 415, 'FILE_TYPE_NOT_ACCEPTED');
  });

  it('refuses a PDF carrying a script, a launch action or an embedded file', async () => {
    for (const bytes of [pdfWithJavaScript(), pdfWithEscapedJavaScript(), pdfWithLaunch(), pdfWithEmbeddedFile()]) {
      await expectRefused(exhibit('active.pdf', bytes), 422, 'FILE_UNSAFE');
    }
  });

  it('refuses a Word document with macros, a document type definition, too many entries, or that inflates beyond the limit', async () => {
    await expectRefused(application('maqal.docx', docxBytes(['x'], { macro: true })), 422, 'FILE_UNSAFE');
    await expectRefused(application('maqal.docx', docxBytes(['x'], { doctype: true })), 422, 'FILE_UNSAFE');
    await expectRefused(application('maqal.docx', docxWithManyEntries(SECURITY_POLICY.uploads.docx.maxEntries + 1)), 422, 'FILE_UNSAFE');
    await expectRefused(application('maqal.docx', docxBomb(SECURITY_POLICY.uploads.docx.maxEntryBytes + 1024)), 422, 'FILE_UNSAFE');
  });

  it('refuses a file beyond the size limit of its place before writing it to the store', async () => {
    const before = await storedObjects();
    const big = new Uint8Array(SECURITY_POLICY.uploads.exhibitMaxBytes + 1);
    big.set(pdfBytes());
    await expectRefused(exhibit('big.pdf', big), 413, 'PAYLOAD_TOO_LARGE');
    expect(await storedObjects()).toBe(before);
  });

  it('refuses a body that is not sent as raw bytes', async () => {
    const lawyer = await as('lawyer');
    await expectRefused(
      () => upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'x.pdf', bytes: pdfBytes(), nature: 'ORIGINAL', headers: { 'content-type': 'multipart/form-data; boundary=x' } }),
      415,
    );
  });

  it('keeps the name the browser sent as a title only, without its path or invisible direction marks', async () => {
    const lawyer = await as('lawyer');
    const res = await upload(lawyer, draftId, { kind: 'EXHIBIT', name: '../../etc/\u202Efdp.exe\u202C.pdf', bytes: pdfBytes(), nature: 'ORIGINAL' });
    expect(res.status, describeResponse(res)).toBe(200);
    const row = await one<{ title: string | null; storageKey: string }>('SELECT title, "storageKey" FROM "FilingDocument" WHERE id = $1', [res.data!.documentId]);
    expect(row.title ?? '').not.toMatch(/[\\/\u202A-\u202E\u2066-\u2069]/);
    expect(row.storageKey).toMatch(/^[a-z0-9/-]{8,200}$/);
    expect(row.storageKey).not.toContain('etc');
  });

  it('caps the number of documents of one draft', async () => {
    const lawyer = await as('lawyer');
    const fresh = await createDraft(lawyer);
    for (let i = 0; i < SECURITY_POLICY.uploads.draftMaxDocuments; i += 1) {
      const res = await upload(lawyer, fresh, { kind: 'EXHIBIT', name: `e${String(i)}.png`, bytes: pngBytes(), nature: 'PHOTOCOPY' });
      expect(res.status, describeResponse(res)).toBe(200);
    }
    await expectRefused(() => upload(lawyer, fresh, { kind: 'EXHIBIT', name: 'one-more.png', bytes: pngBytes(), nature: 'PHOTOCOPY' }), 409, 'DRAFT_DOCUMENT_LIMIT');
  });
});

// ---------------------------------------------------------------------------

describe('no filing without payment (memo rows 3, 4, 5, 27)', () => {
  it('refuses to file a draft that was never paid, and creates no file and no number', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    const before = await caseFiles();
    const events = await expectRefused(() => submit(lawyer, draftId, { secret }), 403, 'FORBIDDEN');
    expect(deniedEvents(events).some((e) => e.details.step === 'AUTHZ')).toBe(true);
    expect(await caseFiles()).toBe(before);
    expect(await count('SELECT count(*) FROM "CaseSequence"')).toBe(0);
  });

  it('refuses to file after a failed payment, a cancelled payment, or an expired one', async () => {
    const lawyer = await as('lawyer');
    for (const outcome of ['FAILED', 'CANCELLED'] as const) {
      const draftId = await prepareDraft(lawyer);
      const { intentId } = await openPayment(lawyer, draftId);
      const settled = await settle(lawyer, intentId, outcome);
      expect(settled.status, describeResponse(settled)).toBe(200);
      expect(await count('SELECT count(*) FROM "TreasuryEntry" WHERE "draftId" = $1', [draftId])).toBe(0);
      await expectRefused(() => submit(lawyer, draftId, { secret }), 403, 'FORBIDDEN');
    }
    const draftId = await prepareDraft(lawyer);
    const { intentId } = await openPayment(lawyer, draftId);
    // Thirty minutes pass (the intent's amount and expiry are guarded: the guard is set aside for this arrangement only).
    await sql(`ALTER TABLE "PaymentIntent" DISABLE TRIGGER payment_intent_guard`);
    try {
      await sql(`UPDATE "PaymentIntent" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [intentId]);
    } finally {
      await sql(`ALTER TABLE "PaymentIntent" ENABLE TRIGGER payment_intent_guard`);
    }
    await expectRefused(() => settle(lawyer, intentId, 'SUCCEEDED'), 409, 'PAYMENT_LAPSED');
    await expectRefused(() => submit(lawyer, draftId, { secret }), 403, 'FORBIDDEN');
  });

  it('computes the amount on the server and ignores any amount sent by the client', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    // The body of the payment request is closed: an amount is not the client's to give.
    await expectRefused(() => lawyer.post(`/api/v1/filings/${draftId}/payment`, { amountCents: 100 }), 422, 'INVALID_INPUT');
    const { intentId, amountCents } = await openPayment(lawyer, draftId);
    expect(amountCents).toBe(MODEL_CASE_FEE_CENTS);
    const intent = await one<{ amountCents: string }>('SELECT "amountCents"::text AS "amountCents" FROM "PaymentIntent" WHERE id = $1', [intentId]);
    expect(Number(intent.amountCents)).toBe(MODEL_CASE_FEE_CENTS);
  });

  it('locks the claims once the fee is paid, and refuses a filing whose claims no longer match the payment', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    await payDraft(lawyer, draftId);
    const smaller = { ...MODEL_CASE, claims: [{ key: 'debt', nature: 'DEBT', amountCents: 100_000 }] };
    await expectRefused(() => updateDraft(lawyer, draftId, { card: smaller }), 409, 'CLAIMS_LOCKED');
    // Even if the claims changed behind the platform's back, the payment no longer covers them.
    await sql(`UPDATE "FilingDraft" SET card = jsonb_set(card, '{claims}', '[{"key":"debt","nature":"DEBT","amountCents":100000}]'::jsonb) WHERE id = $1`, [draftId]);
    const before = await caseFiles();
    await expectRefused(() => submit(lawyer, draftId, { secret }), 403, 'FORBIDDEN');
    expect(await caseFiles()).toBe(before);
  });

  it('records no second payment for a draft already paid or filed, whatever intent is presented (review P2-S-10)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    const first = await payDraft(lawyer, draftId);
    // A second pending intent, written behind the API, for the same draft.
    const second = '00000000-0000-4000-8000-0000000000a2';
    await sql(
      `INSERT INTO "PaymentIntent" (id, "draftId", purpose, "amountCents", "inputsDigest", breakdown, "ruleSetId", method, status, "createdByUserId", "createdAt", "expiresAt")
       SELECT $2::uuid, "draftId", purpose, "amountCents", "inputsDigest", breakdown, "ruleSetId", method, 'PENDING', "createdByUserId", now(), now() + interval '20 minutes'
         FROM "PaymentIntent" WHERE id = $1`,
      [first, second],
    );
    await expectRefused(() => settle(lawyer, second, 'SUCCEEDED'), 409, 'PAYMENT_LAPSED');
    expect(await count('SELECT count(*) FROM "Payment" WHERE "draftId" = $1', [draftId])).toBe(1);
    expect(await count('SELECT count(*) FROM "TreasuryEntry" WHERE "draftId" = $1', [draftId])).toBe(1);
  });

  it('completes a payment once: a second click, or two at once, leave one payment and one treasury entry', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    const { intentId } = await openPayment(lawyer, draftId);
    const [a, b] = await Promise.all([settle(lawyer, intentId, 'SUCCEEDED'), settle(lawyer.clone(), intentId, 'SUCCEEDED')]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect([403, 409]).toContain([a, b].find((r) => r.status !== 200)!.status);
    await expectRefused(() => settle(lawyer, intentId, 'SUCCEEDED'), 409, 'PAYMENT_ALREADY_COMPLETED');
    expect(await count('SELECT count(*) FROM "Payment" WHERE "intentId" = $1', [intentId])).toBe(1);
    expect(await count('SELECT count(*) FROM "TreasuryEntry" WHERE "draftId" = $1', [draftId])).toBe(1);
  });

  it('refuses a second payment of a draft already paid', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    await payDraft(lawyer, draftId);
    await expectRefused(() => lawyer.post(`/api/v1/filings/${draftId}/payment`, {}), 403, 'FORBIDDEN');
  });

  it('never deletes a payment or a treasury entry, and only links them to the file', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    await payDraft(lawyer, draftId);
    await expect(runtime().query('DELETE FROM "Payment" WHERE "draftId" = $1', [draftId])).rejects.toThrow();
    await expect(runtime().query('DELETE FROM "TreasuryEntry" WHERE "draftId" = $1', [draftId])).rejects.toThrow();
    await expect(runtime().query('UPDATE "Payment" SET "amountCents" = 1 WHERE "draftId" = $1', [draftId])).rejects.toThrow();
    await expect(runtime().query('UPDATE "TreasuryEntry" SET "amountCents" = 1 WHERE "draftId" = $1', [draftId])).rejects.toThrow();
  });

  it('keeps the fee assessed and the payment opened as they were computed (review P2-S-14)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    await payDraft(lawyer, draftId);
    for (const statement of [
      'UPDATE "FeeAssessment" SET "totalCents" = 1 WHERE "draftId" = $1',
      'UPDATE "FeeAssessment" SET "inputsDigest" = repeat(\'0\', 64) WHERE "draftId" = $1',
      'UPDATE "FeeAssessment" SET breakdown = \'{}\'::jsonb WHERE "draftId" = $1',
      'DELETE FROM "FeeAssessment" WHERE "draftId" = $1',
      'UPDATE "PaymentIntent" SET "amountCents" = 1 WHERE "draftId" = $1',
      'UPDATE "PaymentIntent" SET "inputsDigest" = repeat(\'0\', 64) WHERE "draftId" = $1',
      // a completed payment does not go back to pending
      'UPDATE "PaymentIntent" SET status = \'PENDING\' WHERE "draftId" = $1 AND status = \'SUCCEEDED\'',
      'DELETE FROM "PaymentIntent" WHERE "draftId" = $1',
    ]) {
      await expect(runtime().query(statement, [draftId]), statement).rejects.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------

describe('signing and filing (memo rows 6, 19, 20, 21, 26)', () => {
  it('files once: two submissions at once give one file', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    await payDraft(lawyer, draftId);
    const before = await caseFiles();
    const [a, b] = await Promise.all([submit(lawyer, draftId, { secret }), submit(lawyer.clone(), draftId, { secret })]);
    expect([a.status, b.status].filter((s) => s === 200), `${describeResponse(a)} / ${describeResponse(b)}`).toHaveLength(1);
    expect([403, 409]).toContain([a, b].find((r) => r.status !== 200)!.status);
    expect(await caseFiles()).toBe(before + 1);
  });

  it('builds the file from the draft as it stands under the lock: an edit racing the filing never leaves a referral or a check behind (review P2-A-01)', async () => {
    const lawyer = await as('lawyer');
    const withPublic = withParties(MODEL_CASE, [PUBLIC_ESTABLISHMENT]);
    for (let round = 0; round < 4; round += 1) {
      const draftId = await prepareDraft(lawyer, { exhibits: 1 });
      await payDraft(lawyer, draftId);
      const [filed] = await Promise.all([
        submit(lawyer, draftId, { secret }),
        updateDraft(lawyer.clone(), draftId, { card: withPublic, attest: [...CARD_SECTIONS] }),
      ]);
      if (filed.status !== 200) {
        expect([403, 409]).toContain(filed.status);
        continue;
      }
      const caseFileId = filed.data!.caseFileId;
      const publicParties = await count(`SELECT count(*) FROM "CaseParty" WHERE "caseFileId" = $1 AND "publicEntityKind" = 'PUBLIC_ESTABLISHMENT'`, [caseFileId]);
      const referrals = await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1 AND target = 'PROSECUTION' AND article = 20`, [caseFileId]);
      // The parties registered and the referrals recorded come from one and the same reading of the draft.
      expect(referrals > 0, `round ${String(round)}`).toBe(publicParties > 0);
    }
  });

  it('refuses any change to a filed draft', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    await payDraft(lawyer, draftId);
    const filed = await submit(lawyer, draftId, { secret });
    expect(filed.status, describeResponse(filed)).toBe(200);
    await expectRefused(() => updateDraft(lawyer, draftId, { card: MODEL_CASE }), 403, 'FORBIDDEN');
    await expectRefused(() => upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'late.pdf', bytes: pdfBytes(), nature: 'ORIGINAL' }), 403, 'FORBIDDEN');
    await expectRefused(() => submit(lawyer, draftId, { secret }), 403, 'FORBIDDEN');
  });

  it('refuses a wrong signing secret, locks after the third, and files nothing', async () => {
    const lawyer2 = await createUser({ roles: ['LAWYER'], label: 'guessing-lawyer' });
    const own = await giveSigningSecret(lawyer2.id, 'Right-secret-2026');
    const client = await login(lawyer2);
    const draftId = await prepareDraft(client);
    await payDraft(client, draftId);
    const before = await caseFiles();
    // As for every signature (Phase 1, decision 39): three wrong secrets, the third locks.
    for (let i = 0; i < 3; i += 1) {
      const res = await submit(client, draftId, { secret: `Wrong-secret-${String(i)}` });
      expect(res.status, describeResponse(res)).toBe(422);
    }
    const locked = await submit(client, draftId, { secret: own });
    expect(locked.status, describeResponse(locked)).toBe(423);
    expect(await caseFiles()).toBe(before);
  });

  it('signs the fixed copy the lawyer saw: a byte changed in the store forbids the filing', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    await payDraft(lawyer, draftId);
    const copy = await one<{ storageKey: string }>(`SELECT "storageKey" FROM "FilingDocument" WHERE "draftId" = $1 AND kind = 'APPLICATION_COPY' AND "removedAt" IS NULL`, [draftId]);
    const { documentStore } = await import('@/server/documents/store');
    const stored = await documentStore().get(copy.storageKey);
    const tampered = new Uint8Array(stored!);
    tampered[tampered.length - 2] = (tampered[tampered.length - 2]! + 1) % 256;
    await documentStore().put(copy.storageKey, tampered, 'application/pdf');
    const before = await caseFiles();
    const res = await submit(lawyer, draftId, { secret });
    expect(res.status, describeResponse(res)).toBe(409);
    expect(res.code).toBe('DOCUMENT_CHANGED');
    expect(await caseFiles()).toBe(before);
  });

  it('accepts as bailiff only a bailiff of the chosen court', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    for (const wrong of [cast.otherCourtBailiff.id, cast.clerk.id, '00000000-0000-4000-8000-000000000779']) {
      await expectRefused(() => updateDraft(lawyer, draftId, { bailiffUserId: wrong }), 422, 'INVALID_INPUT');
    }
    const ok = await updateDraft(lawyer, draftId, { bailiffUserId: cast.bailiff.id });
    expect(ok.status, describeResponse(ok)).toBe(200);
    expect((await getDraft(lawyer, draftId)).bailiffs.map((b) => b.userId)).toContain(cast.bailiff.id);
    expect((await getDraft(lawyer, draftId)).bailiffs.map((b) => b.userId)).not.toContain(cast.otherCourtBailiff.id);
  });

  it('refuses to file without the application, without the declared nature of an exhibit, or without the attestation', async () => {
    const lawyer = await as('lawyer');
    // no application
    const bare = await createDraft(lawyer);
    await updateDraft(lawyer, bare, { caseType: COMMERCIAL_PAYMENT, courtId: (await theCourt()).id, card: MODEL_CASE });
    await expectRefused(() => lawyer.post(`/api/v1/filings/${bare}/payment`, {}), 409, 'DRAFT_INCOMPLETE');
    // an exhibit without its declared nature (art. 631)
    const draftId = await prepareDraft(lawyer, { exhibits: 0 });
    const res = await upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'nature-missing.pdf', bytes: pdfBytes() });
    expect(res.status, describeResponse(res)).toBe(200);
    const view = await getDraft(lawyer, draftId);
    expect(view.checks.some((c) => c.level === 'BLOCKING' && c.code === 'EXHIBIT_NATURE_MISSING')).toBe(true);
    await expectRefused(() => lawyer.post(`/api/v1/filings/${draftId}/payment`, {}), 409, 'DRAFT_INCOMPLETE');
    // a section no longer attested after it changed
    const other = await prepareDraft(lawyer);
    await updateDraft(lawyer, other, { card: { ...MODEL_CASE, summary: `${MODEL_CASE.summary} (مصحح)` } });
    const after = await getDraft(lawyer, other);
    expect(after.draft.attestations).not.toContain('SUMMARY');
    expect(after.checks.some((c) => c.level === 'BLOCKING' && c.code === 'SECTION_NOT_ATTESTED' && c.section === 'SUMMARY')).toBe(true);
  });

  it('refuses to pay or to file while a public-law party has no category, lists the check that blocks, and files once it is given (independent review IR-01)', async () => {
    const lawyer = await as('lawyer');
    const uncategorised = withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_PERSON_WITHOUT_KIND]);
    const categorised = withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]);
    const refusalOf = (events: readonly EventRow[], draftId: string) =>
      events.filter((e) => e.action === 'filing.refused' && e.details.draftId === draftId).map((e) => e.details.reason);

    // The card is saved and attested as it is; what it lacks is listed among what blocks the filing.
    const unpaid = await prepareDraft(lawyer, { card: uncategorised, exhibits: 1 });
    const view = await getDraft(lawyer, unpaid);
    expect(view.draft.attestations).toContain('DEFENDANTS');
    expect(view.checks.filter((c) => c.level === 'BLOCKING')).toEqual([
      expect.objectContaining({ code: 'PUBLIC_ENTITY_KIND_MISSING', level: 'BLOCKING', article: 20, partyKey: PUBLIC_PERSON_WITHOUT_KIND.key }),
    ]);
    // The fee is not paid for it.
    const payment = await expectRefused(() => lawyer.post(`/api/v1/filings/${unpaid}/payment`, {}), 409, 'DRAFT_INCOMPLETE');
    expect(refusalOf(payment, unpaid)).toEqual(['DRAFT_INCOMPLETE']);
    expect(await count(`SELECT count(*) FROM "PaymentIntent" WHERE "draftId" = $1`, [unpaid])).toBe(0);

    // Nor is it filed: a draft paid with the category, from which the category is then removed.
    const draftId = await prepareDraft(lawyer, { card: categorised, exhibits: 1 });
    await payDraft(lawyer, draftId);
    const removed = await updateDraft(lawyer, draftId, { card: uncategorised, attest: [...CARD_SECTIONS] });
    expect(removed.status, describeResponse(removed)).toBe(200);
    expect(removed.data!.payment.status, 'the fee paid still covers the claims').toBe('SUCCEEDED');
    expect(removed.data!.checks.filter((c) => c.level === 'BLOCKING').map((c) => c.code)).toEqual(['PUBLIC_ENTITY_KIND_MISSING']);
    const before = { files: await caseFiles(), referrals: await count('SELECT count(*) FROM "CaseReferral"') };
    const filing = await expectRefused(() => submit(lawyer, draftId, { secret }), 409, 'DRAFT_INCOMPLETE');
    expect(refusalOf(filing, draftId)).toEqual(['DRAFT_INCOMPLETE']);
    expect(await caseFiles()).toBe(before.files);
    expect((await getDraft(lawyer, draftId)).draft.status).toBe('DRAFT');

    // The category given, the same draft is filed, and the file is communicated to the prosecution (art. 20).
    const restored = await updateDraft(lawyer, draftId, { card: categorised, attest: [...CARD_SECTIONS] });
    expect(restored.status, describeResponse(restored)).toBe(200);
    const filed = await submit(lawyer, draftId, { secret });
    expect(filed.status, describeResponse(filed)).toBe(200);
    expect(await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1 AND target = 'PROSECUTION' AND article = 20 AND item = 1`, [filed.data!.caseFileId])).toBe(1);
    expect(await count('SELECT count(*) FROM "CaseReferral"')).toBe(before.referrals + 1);
  });

  it('refuses to pay or to file an electronic draft whose lawyer acts for no plaintiff, lists the check that blocks, and files once he acts for one (independent review IR-02)', async () => {
    const lawyer = await as('lawyer');
    // The box «ينوب المحامي المودع عن هذا الطرف» never sent, and the box unticked.
    const neverTicked = withCounselBox(MODEL_CASE, () => undefined);
    const unticked = withCounselBox(MODEL_CASE, () => false);
    const refusalOf = (events: readonly EventRow[], draftId: string) =>
      events.filter((e) => e.action === 'filing.refused' && e.details.draftId === draftId).map((e) => e.details.reason);
    const counselOf = (userId: string) => count(`SELECT count(*) FROM "Representation" WHERE "lawyerUserId" = $1`, [userId]);
    const blocks = [expect.objectContaining({ code: 'FILER_REPRESENTS_NO_PLAINTIFF', level: 'BLOCKING', article: 76, section: 'PLAINTIFFS', partyKey: null })];

    // The card is saved and attested as it is; what it lacks is listed among what blocks the filing.
    const unpaid = await prepareDraft(lawyer, { card: neverTicked, exhibits: 1 });
    const view = await getDraft(lawyer, unpaid);
    expect(view.draft.card.parties.map((p) => p.representedByFiler)).toEqual([undefined, undefined, undefined]);
    expect(view.draft.attestations).toContain('PLAINTIFFS');
    expect(view.checks.filter((c) => c.level === 'BLOCKING')).toEqual(blocks);
    // The fee is not paid for it.
    const payment = await expectRefused(() => lawyer.post(`/api/v1/filings/${unpaid}/payment`, {}), 409, 'DRAFT_INCOMPLETE');
    expect(refusalOf(payment, unpaid)).toEqual(['DRAFT_INCOMPLETE']);
    expect(await count(`SELECT count(*) FROM "PaymentIntent" WHERE "draftId" = $1`, [unpaid])).toBe(0);

    // Nor is it filed: a draft paid by the plaintiff's counsel, who then unticks the box.
    const draftId = await prepareDraft(lawyer, { exhibits: 1 });
    await payDraft(lawyer, draftId);
    const removed = await updateDraft(lawyer, draftId, { card: unticked, attest: [...CARD_SECTIONS] });
    expect(removed.status, describeResponse(removed)).toBe(200);
    expect(removed.data!.payment.status, 'the fee paid still covers the claims').toBe('SUCCEEDED');
    expect(removed.data!.checks.filter((c) => c.level === 'BLOCKING')).toEqual(blocks);
    const before = { files: await caseFiles(), counsel: await counselOf(cast.lawyer.id) };
    const filing = await expectRefused(() => submit(lawyer, draftId, { secret }), 409, 'DRAFT_INCOMPLETE');
    expect(refusalOf(filing, draftId)).toEqual(['DRAFT_INCOMPLETE']);
    expect(await caseFiles(), 'no file is registered without counsel of the plaintiff').toBe(before.files);
    expect(await counselOf(cast.lawyer.id)).toBe(before.counsel);
    expect((await getDraft(lawyer, draftId)).draft.status).toBe('DRAFT');

    // The box ticked, the same draft is filed, and he is counsel of the plaintiff in the file.
    const restored = await updateDraft(lawyer, draftId, { card: MODEL_CASE, attest: [...CARD_SECTIONS] });
    expect(restored.status, describeResponse(restored)).toBe(200);
    expect(restored.data!.checks.filter((c) => c.level === 'BLOCKING')).toEqual([]);
    const filed = await submit(lawyer, draftId, { secret });
    expect(filed.status, describeResponse(filed)).toBe(200);
    const counsel = await sql<{ side: string }>(
      `SELECT p.side::text AS side FROM "Representation" r JOIN "CaseParty" p ON p.id = r."partyId" WHERE p."caseFileId" = $1 AND r."lawyerUserId" = $2`,
      [filed.data!.caseFileId, cast.lawyer.id],
    );
    expect(counsel.map((c) => c.side)).toEqual(['PLAINTIFF']);
  });

  it('warns without refusing about the missing e-mail of the defendant company (art. 77)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    const view = await getDraft(lawyer, draftId);
    const warning = view.checks.find((c) => c.code === 'PARTY_EMAIL_MISSING' && c.partyKey === 'baa');
    expect(warning?.level).toBe('WARNING');
    expect(warning?.article).toBe(77);
    expect(view.checks.filter((c) => c.level === 'BLOCKING')).toEqual([]);
  });

  it('keeps an address «from the commercial register» only when the register gives it (review P2-A-08)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await createDraft(lawyer);
    const registerAddress = (card: Record<string, unknown>, key: string) =>
      ((card.parties as Record<string, unknown>[]).find((p) => p.key === key)?.registeredOffice as { source: string } | undefined)?.source;
    // The register's own address for the company's number stays the register's.
    const saved = await updateDraft(lawyer, draftId, { card: MODEL_CASE });
    expect(saved.status, describeResponse(saved)).toBe(200);
    const stored = await one<{ card: Record<string, unknown> }>(`SELECT card FROM "FilingDraft" WHERE id = $1`, [draftId]);
    expect(registerAddress(stored.card, 'baa')).toBe('COMMERCIAL_REGISTER');
    // Another address, or a number the register does not know, said to come from it, is kept as declared and warned about.
    const forged = {
      ...MODEL_CASE,
      parties: MODEL_CASE.parties.map((p) =>
        p.key === 'baa'
          ? { ...p, registeredOffice: { value: 'مدينة أخرى، عنوان لا يعرفه السجل', locality: 'casablanca', source: 'COMMERCIAL_REGISTER' } }
          : p.key === 'alif'
            ? { ...p, idNumber: 'RC-UNKNOWN-9999' }
            : p,
      ),
    };
    expect((await updateDraft(lawyer, draftId, { card: forged })).status).toBe(200);
    const after = await one<{ card: Record<string, unknown> }>(`SELECT card FROM "FilingDraft" WHERE id = $1`, [draftId]);
    expect(registerAddress(after.card, 'baa')).toBe('DECLARED');
    expect(registerAddress(after.card, 'alif')).toBe('DECLARED');
    const view = await getDraft(lawyer, draftId);
    expect(view.checks.filter((c) => c.code === 'REGISTER_ADDRESS_MISSING').map((c) => c.partyKey).sort()).toEqual(['alif', 'baa']);
  });
});

// ---------------------------------------------------------------------------

describe('the limits of a draft and of an account hold, whatever is removed (review P2-S-07)', () => {
  it('counts the documents removed from a draft toward the storage it may use', async () => {
    const lawyer = await as('lawyer');
    const draftId = await createDraft(lawyer);
    // What earlier uploads stored and their removal left behind.
    const stored = SECURITY_POLICY.uploads.draftMaxStoredBytes;
    await sql(
      `INSERT INTO "FilingDocument" (id, "draftId", kind, "storageKey", sha256, "byteSize", "mediaType", title, generated, "uploadedAt", "removedAt")
       VALUES (gen_random_uuid(), $1::uuid, 'EXHIBIT', 'drafts/' || $1::text || '/' || gen_random_uuid(), repeat('a', 64), $2, 'application/pdf', 'x', false, now(), now())`,
      [draftId, stored],
    );
    await expectRefused(() => upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'one-more.pdf', bytes: pdfBytes('one more'), nature: 'ORIGINAL' }), 409, 'DRAFT_DOCUMENT_LIMIT');
  });

  it('refuses an upload beyond the hourly window of the session, and stores nothing', async () => {
    const user = await createUser({ roles: ['LAWYER'], label: 'many-uploads' });
    const client = await login(user);
    await client.csrf();
    const draftId = await createDraft(client);
    const [session] = await sql<{ id: string }>(`SELECT id FROM "Session" WHERE "userId" = $1::uuid ORDER BY "createdAt" DESC LIMIT 1`, [user.id]);
    const rule = SECURITY_POLICY.uploads.perSession;
    await sql(
      `INSERT INTO "RateLimitHit" (id, key, at) SELECT gen_random_uuid(), $1, now() FROM generate_series(1, $2)`,
      [`uploads:session:${session?.id ?? 'none'}`, rule.max],
    );
    const before = await storedObjects();
    await expectRefused(() => upload(client, draftId, { kind: 'EXHIBIT', name: 'over.pdf', bytes: pdfBytes('over'), nature: 'ORIGINAL' }), 429, 'TOO_MANY_REQUESTS');
    expect(await storedObjects()).toBe(before);
  });

  it('refuses a commercial-register lookup at the rate step once the session has used its budget, and counts it apart from another session (independent review IR-17, memo row 22)', async () => {
    const user = await createUser({ roles: ['LAWYER'], label: 'many-lookups' });
    const client = await login(user);
    const lookup = (c: Client) => c.get('/api/v1/registers/commercial', { query: { number: 'RC-DEMO-1001' } });
    const rule = SECURITY_POLICY.registerLookup.perSession;
    // Every lookup of the budget is answered, the last one included.
    for (let i = 0; i < rule.max; i += 1) {
      const res = await lookup(client);
      expect(res.status, `lookup ${String(i + 1)} of ${String(rule.max)}: ${describeResponse(res)}`).toBe(200);
    }
    const { result, events } = await capturingEvents(() => lookup(client));
    expect({ status: result.status, code: result.code }, describeResponse(result)).toEqual({ status: 429, code: 'TOO_MANY_REQUESTS' });
    expect(result.error?.retryAfterSeconds).toBe(Math.ceil(rule.windowMs / 1000));
    const denied = deniedEvents(events);
    expect(denied.map((e) => ({ step: e.details.step, target: e.details.target }))).toEqual([{ step: 'RATE', target: 'registers.commercial.lookup' }]);
    expect(events.filter((e) => e.action === 'registers.commercial.looked-up'), 'the register is not asked').toEqual([]);
    // The budget is the session's: a second session of the same lawyer still looks up.
    const second = await login(user);
    expect((await lookup(second)).status).toBe(200);
  });

  it('refuses a new draft to an account that already holds the most open drafts it may', async () => {
    const lawyer = await createUser({ roles: ['LAWYER'], label: 'many-drafts' });
    const client = await login(lawyer);
    await client.csrf();
    const max = SECURITY_POLICY.filing.maxOpenDrafts;
    await sql(
      `INSERT INTO "FilingDraft" (id, "ownerUserId", "ownerRoleAssignmentId", channel, card, attestations, "createdAt", "updatedAt")
       SELECT gen_random_uuid(), $1, $2, 'ELECTRONIC', '{"parties":[],"summary":"","claims":[]}'::jsonb, '{}'::jsonb, now(), now() FROM generate_series(1, $3)`,
      [lawyer.id, lawyer.roleAssignmentId, max],
    );
    await expectRefused(() => client.post('/api/v1/filings', {}), 409, 'DRAFT_LIMIT');
  });
});

describe('the filing lawyer acts for the plaintiff only (review P2-S-02)', () => {
  it('refuses a card on which the lawyer acts for the defendant or the guarantor, and registers no such counsel', async () => {
    const lawyer = await as('lawyer');
    const draftId = await createDraft(lawyer);
    for (const key of ['baa', 'jim']) {
      const card = { ...MODEL_CASE, parties: MODEL_CASE.parties.map((p) => (p.key === key ? { ...p, representedByFiler: true } : p)) };
      await expectRefused(() => updateDraft(lawyer, draftId, { card }), 422, 'INVALID_INPUT');
    }
    // Written into the draft behind the API, the card is refused at filing, and no counsel is registered for the other side.
    const filed = await prepareDraft(lawyer, { exhibits: 1 });
    await payDraft(lawyer, filed);
    await sql(
      `UPDATE "FilingDraft" SET card = jsonb_set(card, '{parties,1,representedByFiler}', 'true'::jsonb) WHERE id = $1`,
      [filed],
    );
    const before = await caseFiles();
    const res = await submit(lawyer, filed, { secret });
    // The card no longer reads as a card, so no fee it calls for is covered: the
    // refusal comes at authorization (unpaid) or at the checks, never a filing.
    expect([403, 409, 422], describeResponse(res)).toContain(res.status);
    expect(await caseFiles()).toBe(before);
  });
});

describe('the paper filing is the registry clerk’s, at his court (memo row 24)', () => {
  it('refuses the paper filing to a lawyer, a cashier and the administrator', async () => {
    for (const name of ['lawyer', 'cashier', 'admin'] as const) {
      await expectRefused(async () => (await as(name)).post('/api/v1/filings/paper', {}), 403, 'FORBIDDEN');
    }
  });

  it('opens the paper draft at the clerk’s own court, and hides it from the clerk of another court', async () => {
    const clerk = await as('clerk');
    const draftId = await createPaperDraft(clerk);
    const view = await getDraft(clerk, draftId);
    expect(view.draft.channel).toBe('PAPER');
    expect(view.draft.courtId).toBe((await theCourt()).id);
    // The court of a paper filing is the clerk's: another court is refused.
    const other = await createCourt();
    await expectRefused(() => updateDraft(clerk, draftId, { courtId: other.id }), 422, 'INVALID_INPUT');
    const stranger = await as('otherCourtClerk');
    await expectRefused(() => stranger.get(`/api/v1/filings/${draftId}`), 404, 'NOT_FOUND');
  });

  it('accepts scans (PDF, JPEG, PNG) with their page count and the place of the paper original, and nothing else', async () => {
    const clerk = await as('clerk');
    const draftId = await createPaperDraft(clerk);
    const scan = await upload(clerk, draftId, { kind: 'APPLICATION', name: 'scan.pdf', bytes: pdfBytes('scan'), pages: 4, location: 'خزانة التقييد، الرف 3' });
    expect(scan.status, describeResponse(scan)).toBe(200);
    await expectRefused(() => upload(clerk, draftId, { kind: 'APPLICATION', name: 'maqal.docx', bytes: docxBytes(['x']), pages: 1, location: 'خزانة' }), 415, 'FILE_TYPE_NOT_ACCEPTED');
    // A scan without its page count or the place of its original is incomplete.
    const missing = await upload(clerk, draftId, { kind: 'EXHIBIT', name: 'annex.png', bytes: pngBytes(), nature: 'PHOTOCOPY' });
    expect(missing.status, describeResponse(missing)).toBe(200);
    const view = await getDraft(clerk, draftId);
    expect(view.checks.some((c) => c.level === 'BLOCKING' && c.code === 'PAPER_ORIGINAL_UNRECORDED')).toBe(true);
  });

  it('files a paper draft without an electronic signature, after payment at the counter', async () => {
    const clerk = await as('clerk');
    const draftId = await createPaperDraft(clerk);
    await updateDraft(clerk, draftId, {
      caseType: COMMERCIAL_PAYMENT,
      card: MODEL_CASE,
      paperDepositor: { name: 'السيد نون', idNumber: 'DEMO-CIN-0001', quality: 'ممثل الشركة المدعية' },
      attest: ['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS'],
    });
    await upload(clerk, draftId, { kind: 'APPLICATION', name: 'scan.pdf', bytes: pdfBytes('scan'), pages: 3, location: 'خزانة التقييد، الرف 1' });
    const before = await caseFiles();
    await expectRefused(() => submit(clerk, draftId, {}), 403, 'FORBIDDEN');
    const { intentId } = await openPayment(clerk, draftId);
    expect((await settle(clerk, intentId, 'SUCCEEDED')).status).toBe(200);
    await runJobs();
    const res = await submit(clerk, draftId, {});
    expect(res.status, describeResponse(res)).toBe(200);
    expect(await caseFiles()).toBe(before + 1);
    const file = await one<{ filingChannel: string }>('SELECT "filingChannel"::text FROM "CaseFile" WHERE id = $1', [res.data!.caseFileId]);
    expect(file.filingChannel).toBe('PAPER');
    const method = await one<{ method: string }>('SELECT method::text FROM "Payment" WHERE "intentId" = $1', [intentId]);
    expect(method.method).toBe('COUNTER');
  });
});
