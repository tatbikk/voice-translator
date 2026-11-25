// Phase 2 refusal tests (docs/security/phase-2-memo.md), written before the
// code they guard. The three cases the prompt names for this phase:
//   - a file whose content contradicts its extension (memo row 1, with 13, 14, 15, 17);
//   - a lawyer reading another lawyer's draft (row 2), and the payment page of another (row 2);
//   - completing a filing without payment (rows 3 to 5, 27);
// and the other rows of the memo that concern the draft: filing twice (6),
// the signing secret (19, 20), the bailiff (21), the paper filing (24), a
// filed draft (26). Every refusal must leave a record in the event log.
import { beforeAll, describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@mahkama/core';
import { CARD_SECTIONS, COMMERCIAL_PAYMENT, MODEL_CASE, MODEL_CASE_FEE_CENTS } from '../acceptance/model-case-filing.fixture';
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
    await sql(`UPDATE "PaymentIntent" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [intentId]);
    await expectRefused(() => settle(lawyer, intentId, 'SUCCEEDED'), 403, 'FORBIDDEN');
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

  it('completes a payment once: a second click, or two at once, leave one payment and one treasury entry', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    const { intentId } = await openPayment(lawyer, draftId);
    const [a, b] = await Promise.all([settle(lawyer, intentId, 'SUCCEEDED'), settle(lawyer.clone(), intentId, 'SUCCEEDED')]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect([403, 409]).toContain([a, b].find((r) => r.status !== 200)!.status);
    await expectRefused(() => settle(lawyer, intentId, 'SUCCEEDED'), 403, 'FORBIDDEN');
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

  it('warns without refusing about the missing e-mail of the defendant company (art. 77)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer);
    const view = await getDraft(lawyer, draftId);
    const warning = view.checks.find((c) => c.code === 'PARTY_EMAIL_MISSING' && c.partyKey === 'baa');
    expect(warning?.level).toBe('WARNING');
    expect(warning?.article).toBe(77);
    expect(view.checks.filter((c) => c.level === 'BLOCKING')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

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
