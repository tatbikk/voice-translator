// Memo rows 16 and 17, extended to the flows of Phase 2 (Phase 2 memo row 25;
// independent review IR-17). A filing whose case card carries personal data
// of every kind (names, identity numbers, addresses, e-mail addresses, a phone
// number, a summary and the pasted application), a commercial-register lookup,
// an upload, the payment, the signature and filing, the registry's note to the
// judge and the prosecution's conclusions run at debug level under the log
// capture, with every one of those values registered for tracking. So does the
// paper channel (review of the fix of IR-17): the depositor's name, identity
// number and quality typed in by the registry, its scans, and the payment at the
// counter whose receipt names the depositor. None of them reaches the event log
// nor the technical log; no API answer carries a secret, a password, a code or a
// token.
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { login } from '../helpers/auth';
import { sql } from '../helpers/db';
import { overrideEnv } from '../helpers/env';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { createPaperDraft, fileCase, giveSigningSecret, openPayment, runJobs, settle, submit, updateDraft, upload, type FiledCase } from '../helpers/filings';
import { describeResponse, recordedResponses } from '../helpers/http';
import { capturedLogs } from '../helpers/log-capture';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';
import { pdfBytes } from '../helpers/samples';
import { findLeaks, trackSensitive, type SensitiveKind } from '../helpers/sensitive';
import { CARD_SECTIONS, COMMERCIAL_PAYMENT, type Card } from '../acceptance/model-case-filing.fixture';

useFreshDatabase();

const tag = randomBytes(4).toString('hex');
const digits = String(100_000 + (randomBytes(2).readUInt16BE(0) % 900_000)).padStart(6, '0');

function tracked(kind: SensitiveKind, value: string): string {
  trackSensitive(kind, value);
  return value;
}

// Every value of the card that names or reaches a person.
const PERSONAL = {
  plaintiff: tracked('name', `شركة سين للتجارة ${tag}`),
  plaintiffRegister: tracked('reference', `RC-PRIVE-${tag}`),
  plaintiffRepresentative: tracked('name', `السيد نون الممثل ${tag}`),
  plaintiffOffice: tracked('name', `الدار البيضاء، زنقة الكتمان ${tag}، رقم 7`),
  plaintiffEmail: tracked('email', `contact-${tag}@sin-demo.example`),
  defendant: tracked('name', `المكتب العمومي للتجريب ${tag}`),
  defendantRepresentative: tracked('name', `مديره العام السيد هاء ${tag}`),
  defendantOffice: tracked('name', `الرباط، شارع الأمانة ${tag}، رقم 3`),
  defendantEmail: tracked('email', `office-${tag}@public-demo.example`),
  guarantor: tracked('name', `السيد عين الكفيل ${tag}`),
  guarantorIdentity: tracked('reference', `BK${digits}${tag.slice(0, 2).toUpperCase()}`),
  guarantorHome: tracked('name', `الدار البيضاء، حي السرية ${tag}، رقم 9`),
  guarantorEmail: tracked('email', `ain-${tag}@guarantor-demo.example`),
  guarantorPhone: tracked('phone', `+2126${digits}${String(10 + (randomBytes(1)[0]! % 90))}`),
  summary: tracked('name', `وقائع خاصة ${tag}: لم يؤد المكتب ثمن التوريدات المسلمة إليه`),
};
const APPLICATION = [
  'مقال افتتاحي من أجل الأداء',
  tracked('name', `لفائدة ${PERSONAL.plaintiff}، في شخص ممثلها القانوني ${PERSONAL.plaintiffRepresentative}.`),
  tracked('name', `ضد ${PERSONAL.defendant}، وكفيله ${PERSONAL.guarantor} القاطن ب${PERSONAL.guarantorHome}.`),
  tracked('name', `الوقائع السرية ${tag}: وردت المدعية سلعا إلى المدعى عليه، وبقي الثمن دون أداء.`),
  'الطلبات: الحكم بالأداء مع الفوائد القانونية والمصاريف.',
].join('\n');
const EXHIBIT_TITLE = tracked('name', `عقد الكفالة الموقع من ${PERSONAL.guarantor}`);
const EXHIBIT_CONTENT = tracked('name', `مضمون-عقد-${tag}`);
const LOOKED_UP = tracked('reference', `RC-INCONNU-${tag}`);
const NOTE_TEXT = tracked('name', `ملاحظة خاصة ${tag}: يبدو الرسم المؤدى ناقصا بالنظر إلى طلبات ${PERSONAL.guarantor}.`);
const CONCLUSIONS_TITLE = tracked('name', `مستنتجات النيابة العامة في دعوى ${PERSONAL.plaintiff}`);
const CONCLUSIONS_CONTENT = tracked('name', `مضمون-مستنتجات-${tag}`);
// The paper channel: what the registry types in of the person who brings the application, and its scans.
const DEPOSITOR = {
  name: tracked('name', `السيد فاء المودع ${tag}`),
  idNumber: tracked('reference', `DK${digits}${tag.slice(2, 4).toUpperCase()}`),
  quality: tracked('name', `كاتب مكتب الأستاذ صاد ${tag}`),
};
const SCAN_CONTENT = tracked('name', `مضمون-المقال-الورقي-${tag}`);
const SCAN_EXHIBIT_TITLE = tracked('name', `وكالة ${DEPOSITOR.name}`);
const SCAN_EXHIBIT_CONTENT = tracked('name', `مضمون-الوكالة-${tag}`);

const CARD: Card = {
  parties: [
    {
      key: 'sin',
      side: 'PLAINTIFF',
      personKind: 'LEGAL',
      name: PERSONAL.plaintiff,
      quality: 'مدعية',
      idNumber: PERSONAL.plaintiffRegister,
      legalForm: 'شركة ذات مسؤولية محدودة',
      legalRepresentative: PERSONAL.plaintiffRepresentative,
      registeredOffice: { value: PERSONAL.plaintiffOffice, locality: 'casablanca', source: 'DECLARED' },
      email: PERSONAL.plaintiffEmail,
      representedByFiler: true,
    },
    {
      key: 'office',
      side: 'DEFENDANT',
      personKind: 'PUBLIC',
      publicEntityKind: 'PUBLIC_ESTABLISHMENT',
      name: PERSONAL.defendant,
      quality: 'مدعى عليه',
      legalRepresentative: PERSONAL.defendantRepresentative,
      registeredOffice: { value: PERSONAL.defendantOffice, locality: 'casablanca', source: 'DECLARED' },
      email: PERSONAL.defendantEmail,
    },
    {
      key: 'ain',
      side: 'GUARANTOR',
      personKind: 'NATURAL',
      name: PERSONAL.guarantor,
      quality: 'كفيل متضامن',
      idNumber: PERSONAL.guarantorIdentity,
      domicile: { value: PERSONAL.guarantorHome, locality: 'casablanca', source: 'DECLARED' },
      email: PERSONAL.guarantorEmail,
      phone: PERSONAL.guarantorPhone,
    },
  ],
  summary: PERSONAL.summary,
  claims: [
    { key: 'debt', nature: 'DEBT', amountCents: 12_000_000 },
    { key: 'interest', nature: 'LEGAL_INTEREST', amountCents: null },
    { key: 'costs', nature: 'COSTS', amountCents: null },
  ],
};

let filed: FiledCase & { draftId: string };
let paperDraftId: string;
let paperCaseFileId: string;

async function runPhaseTwoFlows(): Promise<void> {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' });
  const lawyer: TestUser = await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' });
  const registry = await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' });
  const prosecutor = await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' });
  const secret = await giveSigningSecret(lawyer.id, `Signing-${randomBytes(8).toString('hex')}`);

  const client = await login(lawyer);
  // A lookup in the commercial register, by a number it does not know.
  const lookup = await client.get('/api/v1/registers/commercial', { query: { number: LOOKED_UP } });
  expect(lookup.status, describeResponse(lookup)).toBe(200);
  // The whole path: the card, the pasted application, the exhibits, the payment, the signature and filing.
  filed = await fileCase(client, secret, { card: CARD, exhibits: 1 });
  // An exhibit whose title names the guarantor, uploaded to a second draft of the same card.
  const second = await client.post<{ draftId: string }>('/api/v1/filings', {});
  expect(second.status, describeResponse(second)).toBe(200);
  const uploaded = await upload(client, second.data!.draftId, { kind: 'EXHIBIT', name: `${EXHIBIT_TITLE}.pdf`, title: EXHIBIT_TITLE, bytes: pdfBytes(EXHIBIT_CONTENT), nature: 'ORIGINAL' });
  expect(uploaded.status, describeResponse(uploaded)).toBe(200);
  const card = await client.post(`/api/v1/filings/${second.data!.draftId}`, { card: CARD });
  expect(card.status, describeResponse(card)).toBe(200);
  // The application pasted with the parties' names in it, and its fixed copy printed by the worker.
  const pasted = await client.post(`/api/v1/filings/${second.data!.draftId}/application-text`, { text: APPLICATION });
  expect(pasted.status, describeResponse(pasted)).toBe(200);
  await runJobs();

  // The registry's note to the judge, and the prosecution's conclusions on the referred file.
  const note = await (await login(registry)).post(`/api/v1/cases/${filed.caseFileId}/actions/case.registration.note-to-judge`, { reason: 'FEE_SHORTFALL', text: NOTE_TEXT });
  expect(note.status, describeResponse(note)).toBe(200);
  const conclusions = await (await login(prosecutor)).post(`/api/v1/cases/${filed.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
    query: { name: `${CONCLUSIONS_TITLE}.pdf`, title: CONCLUSIONS_TITLE },
    rawBody: Buffer.from(pdfBytes(CONCLUSIONS_CONTENT)),
    headers: { 'content-type': 'application/octet-stream' },
  });
  expect(conclusions.status, describeResponse(conclusions)).toBe(200);
  // The file as counsel reads it.
  const read = await client.get(`/api/v1/cases/${filed.caseFileId}/available-actions`);
  expect(read.status, describeResponse(read)).toBe(200);

  // The paper channel at the registry: the card, the depositor, the scans, the payment at the counter and the filing.
  const desk = await login(registry);
  paperDraftId = await createPaperDraft(desk);
  const paperCard: Card = { ...CARD, parties: CARD.parties.map((p) => ({ ...p, representedByFiler: false })) };
  const saved = await updateDraft(desk, paperDraftId, {
    caseType: COMMERCIAL_PAYMENT,
    card: paperCard,
    paperDepositor: { name: DEPOSITOR.name, idNumber: DEPOSITOR.idNumber, quality: DEPOSITOR.quality },
    attest: [...CARD_SECTIONS],
  });
  expect(saved.status, describeResponse(saved)).toBe(200);
  const scan = await upload(desk, paperDraftId, { kind: 'APPLICATION', name: 'scan.pdf', bytes: pdfBytes(SCAN_CONTENT), pages: 2, location: 'خزانة التقييد، الرف 4' });
  expect(scan.status, describeResponse(scan)).toBe(200);
  const scannedExhibit = await upload(desk, paperDraftId, {
    kind: 'EXHIBIT',
    name: `${SCAN_EXHIBIT_TITLE}.pdf`,
    title: SCAN_EXHIBIT_TITLE,
    bytes: pdfBytes(SCAN_EXHIBIT_CONTENT),
    nature: 'PHOTOCOPY',
    pages: 1,
    location: 'خزانة التقييد، الرف 4',
  });
  expect(scannedExhibit.status, describeResponse(scannedExhibit)).toBe(200);
  const { intentId } = await openPayment(desk, paperDraftId);
  const paid = await settle(desk, intentId, 'SUCCEEDED');
  expect(paid.status, describeResponse(paid)).toBe(200);
  // The receipt of the counter payment, which names the depositor, printed by the worker.
  await runJobs();
  const paperFiled = await submit(desk, paperDraftId, {});
  expect(paperFiled.status, describeResponse(paperFiled)).toBe(200);
  paperCaseFileId = paperFiled.data!.caseFileId;
  await runJobs();
}

describe('secrets and personal data in the flows of Phase 2 (memo rows 16 and 17; Phase 2 memo row 25; IR-17)', () => {
  beforeAll(async () => {
    const restore = await overrideEnv({ LOG_LEVEL: 'debug' });
    try {
      await runPhaseTwoFlows();
    } finally {
      await restore();
    }
  }, 240_000);

  it('the flows ran: the filing, the payment, the registration, the note, the conclusions and the lookup were recorded', async () => {
    const actions = (await sql<{ action: string }>(`SELECT DISTINCT action FROM "Event"`)).map((r) => r.action);
    for (const action of [
      'registers.commercial.looked-up',
      'filing.draft.created',
      'filing.draft.updated',
      'filing.document.uploaded',
      'filing.application.pasted',
      'filing.fixed-copy.prepared',
      'payment.intent.opened',
      'payment.succeeded',
      'filing.submitted',
      'case.registered',
      'case.note.added',
    ]) {
      expect(actions, action).toContain(action);
    }
    const stored = await sql<{ docType: string }>(`SELECT "docType" FROM "Document" WHERE "caseFileId" = $1`, [filed.caseFileId]);
    expect(stored.map((d) => d.docType)).toContain('PROSECUTION_CONCLUSIONS');
    // The paper filing, paid at the counter, with its receipt printed.
    const paper = await sql<{ filingChannel: string }>(`SELECT "filingChannel"::text AS "filingChannel" FROM "CaseFile" WHERE id = $1`, [paperCaseFileId]);
    expect(paper.map((f) => f.filingChannel)).toEqual(['PAPER']);
    const counter = await sql<{ method: string }>(`SELECT p.method::text AS method FROM "Payment" p JOIN "PaymentIntent" i ON i.id = p."intentId" WHERE i."draftId" = $1`, [paperDraftId]);
    expect(counter.map((p) => p.method)).toEqual(['COUNTER']);
    const receipts = await sql<{ kind: string }>(`SELECT kind::text AS kind FROM "FilingDocument" WHERE "draftId" = $1 AND generated`, [paperDraftId]);
    expect(receipts.map((d) => d.kind)).toContain('PAYMENT_RECEIPT');
    const depositor = await sql<{ paperDepositor: unknown }>(`SELECT "paperDepositor" FROM "FilingDraft" WHERE id = $1`, [paperDraftId]);
    expect(findLeaks(JSON.stringify(depositor)), 'the depositor is kept with the draft').toHaveLength(3);
    // The values are where they belong: in the file, not in the log.
    const parties = await sql<{ displayName: string; idNumber: string | null }>(`SELECT "displayName", "idNumber" FROM "CaseParty" WHERE "caseFileId" = $1 ORDER BY position`, [filed.caseFileId]);
    expect(parties.map((p) => p.displayName)).toEqual([PERSONAL.plaintiff, PERSONAL.defendant, PERSONAL.guarantor]);
    expect(parties.map((p) => p.idNumber)).toContain(PERSONAL.guarantorIdentity);
    // The leak search finds them there: what it does not find in the log is not there.
    const inFile = findLeaks(JSON.stringify([await sql('SELECT * FROM "CaseParty"'), await sql('SELECT * FROM "PartyAddress"'), await sql('SELECT * FROM "CaseNote"')]));
    expect(inFile.length, 'the tracked values are found in the tables that hold them').toBeGreaterThanOrEqual(10);
  });

  it('row 16: the whole event log holds none of the names, numbers, addresses, e-mails, phone, texts or contents used', async () => {
    const dump = JSON.stringify(await sql('SELECT * FROM "Event" ORDER BY seq'));
    expect(findLeaks(dump)).toEqual([]);
  });

  it('row 17: the technical log holds none of them, even at debug level', () => {
    expect(capturedLogs().length, 'the log was captured').toBeGreaterThan(0);
    expect(findLeaks(capturedLogs())).toEqual([]);
  });

  it('row 17: no API answer carries a secret, a password, a code or a token', () => {
    const leaks: string[] = [];
    for (const res of recordedResponses()) {
      for (const leak of findLeaks(`${res.headers}\n${res.text}`, ['secret', 'password', 'code', 'token'])) {
        leaks.push(`${res.method} ${res.path} ${String(res.status)}: ${leak}`);
      }
    }
    expect(recordedResponses().length).toBeGreaterThan(20);
    expect(leaks).toEqual([]);
  });
});
