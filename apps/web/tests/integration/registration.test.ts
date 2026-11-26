// Phase 2 acceptance and refusal tests on registration (study, «المرحلة الثانية»;
// docs/security/phase-2-memo.md rows 7 to 12, 25), written before the code:
//   - the model case filed from the first screen to the receipt is registered
//     at once, with its number in the court's register and its national
//     identifier, its parties, claims, documents, fee, payment and signature;
//   - the system records that it reviewed the referrals and found none, while
//     a file against a public establishment is referred to the prosecution;
//   - the registry office finds three buttons and no button to reject the
//     application, and a direct request to reject is refused as unknown;
//   - numbers are sequential under concurrency and cannot be changed;
//   - the registry's note to the judge is never shown to a lawyer.
import { beforeAll, describe, expect, it } from 'vitest';
import { SECURITY_POLICY, filerCounselByDefault, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { casesOf } from '@/server/filings/lists';
import { ruleSourceFiles } from '@/server/rules/store';
import {
  COMMERCIAL_PAYMENT,
  MODEL_CASE,
  MODEL_CASE_FEE_CENTS,
  PUBLIC_DEFENDANT_CASE,
  PUBLIC_ESTABLISHMENT,
  SECOND_PLAINTIFF,
  STATE_JUDICIAL_AGENT,
  withCounselBox,
  withParties,
} from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { capturingEvents, count, events, notificationsOf, one, runtime, sql, type EventRow } from '../helpers/db';
import { createCourt, createUser, theCourt, type TestUser } from '../helpers/factories';
import { attestAll, createDraft, fileCase, getDraft, giveSigningSecret, pasteApplication, payDraft, prepareDraft, runJobs, submit, updateDraft, upload, type FiledCase } from '../helpers/filings';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { docxBytes, pdfBytes } from '../helpers/samples';
import { MODEL_CASE_APPLICATION_TEXT } from '../acceptance/model-case-filing.fixture';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

interface Cast {
  readonly lawyer: TestUser;
  readonly otherLawyer: TestUser;
  readonly registry: TestUser;
  readonly otherCourtRegistry: TestUser;
  readonly cashier: TestUser;
  readonly president: TestUser;
  readonly prosecutor: TestUser;
  readonly otherCourtProsecutor: TestUser;
  readonly bailiff: TestUser;
  readonly litigant: TestUser;
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

async function viewAs(user: TestUser, caseFileId: string) {
  const snapshot = await caseSnapshot(caseFileId, new Date());
  if (!snapshot) throw new Error('no snapshot');
  return caseView(caseFileId, await subjectOf(user), snapshot);
}

async function availableCodes(client: Client, caseFileId: string): Promise<string[]> {
  const res = await client.get<{ actions: { code: string }[] }>(`/api/v1/cases/${caseFileId}/available-actions`);
  expect(res.status, describeResponse(res)).toBe(200);
  return res.data!.actions.map((a) => a.code).sort();
}

async function expectDenied(fn: () => Promise<ApiResponse>, status: number): Promise<EventRow[]> {
  const { result, events: appended } = await capturingEvents(fn);
  expect(result.status, describeResponse(result)).toBe(status);
  expect(appended.some((e) => e.action === 'access.denied' || e.action === 'case.action.refused')).toBe(true);
  return appended;
}

const act = (client: Client, caseFileId: string, action: string, body: Record<string, unknown> = {}) =>
  client.post(`/api/v1/cases/${caseFileId}/actions/${action}`, body);

let model: FiledCase & { draftId: string };

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  const otherCourt = await createCourt();
  cast = {
    lawyer: await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' }),
    otherLawyer: await createUser({ roles: ['LAWYER'], label: 'other-lawyer' }),
    registry: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' }),
    otherCourtRegistry: await createUser({ roles: [{ role: 'CLERK_REGISTRATION', courtId: otherCourt.id }], label: 'other-registry' }),
    cashier: await createUser({ roles: ['CLERK_CASHIER'], label: 'cashier' }),
    president: await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' }),
    prosecutor: await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' }),
    otherCourtProsecutor: await createUser({ roles: [{ role: 'PUBLIC_PROSECUTOR', courtId: otherCourt.id }], label: 'other-prosecutor' }),
    bailiff: await createUser({ roles: [{ role: 'BAILIFF', courtId: court.id }], label: 'bailiff' }),
    litigant: await createUser({ roles: ['LITIGANT'], label: 'litigant' }),
  };
  secret = await giveSigningSecret(cast.lawyer.id);
  model = await fileCase(await as('lawyer'), secret, { bailiffUserId: cast.bailiff.id });
}, 120_000);

// ---------------------------------------------------------------------------

describe('the model case, filed from the first screen to the receipt', () => {
  it('is registered at once, in the court’s register for the year, with its national identifier', async () => {
    const file = await one<{ status: string; courtId: string; number: number; code: number; year: number; nationalRef: string; filingChannel: string; registeredAt: Date | null; designatedBailiffUserId: string | null }>(
      `SELECT status::text, "courtId", number, code, year, "nationalRef", "filingChannel"::text, "registeredAt", "designatedBailiffUserId" FROM "CaseFile" WHERE id = $1`,
      [model.caseFileId],
    );
    expect(file.status).toBe('REGISTERED');
    expect(file.courtId).toBe((await theCourt()).id);
    expect(file.code).toBe(Number(COMMERCIAL_PAYMENT));
    expect(file.number).toBe(model.number);
    expect(file.nationalRef).toBe(model.nationalRef);
    expect(file.nationalRef).not.toContain(COMMERCIAL_PAYMENT);
    expect(file.filingChannel).toBe('ELECTRONIC');
    expect(file.registeredAt).not.toBeNull();
    expect(file.designatedBailiffUserId).toBe(cast.bailiff.id);
    const sequence = await one<{ lastNumber: number }>('SELECT "lastNumber" FROM "CaseSequence" WHERE "courtId" = $1 AND year = $2', [file.courtId, file.year]);
    expect(sequence.lastNumber).toBe(file.number);
  });

  it('carries the case card: three parties, the filing lawyer for the plaintiff, five claims', async () => {
    const parties = await sql<{ side: string; displayName: string }>('SELECT side::text, "displayName" FROM "CaseParty" WHERE "caseFileId" = $1 ORDER BY position', [model.caseFileId]);
    expect(parties.map((p) => [p.side, p.displayName])).toEqual(MODEL_CASE.parties.map((p) => [p.side, p.name]));
    const represented = await sql<{ displayName: string }>(
      `SELECT p."displayName" FROM "Representation" r JOIN "CaseParty" p ON p.id = r."partyId" WHERE p."caseFileId" = $1 AND r."lawyerUserId" = $2 AND r."endedAt" IS NULL`,
      [model.caseFileId, cast.lawyer.id],
    );
    expect(represented.map((r) => r.displayName)).toEqual(['شركة ألف للتوريدات']);
    expect(await count('SELECT count(*) FROM "Claim" WHERE "caseFileId" = $1', [model.caseFileId])).toBe(MODEL_CASE.claims.length);
    const office = await one<{ source: string }>(
      `SELECT a.source::text FROM "PartyAddress" a JOIN "CaseParty" p ON p.id = a."partyId" WHERE p."caseFileId" = $1 AND p."displayName" = 'شركة باء للصناعة' AND a.kind = 'REGISTERED_OFFICE'`,
      [model.caseFileId],
    );
    expect(office.source).toBe('COMMERCIAL_REGISTER');
  });

  it('records the fee, its payment and the treasury entry, linked to the file', async () => {
    const fee = await one<{ totalCents: string }>('SELECT "totalCents"::text AS "totalCents" FROM "FeeAssessment" WHERE "caseFileId" = $1', [model.caseFileId]);
    expect(Number(fee.totalCents)).toBe(MODEL_CASE_FEE_CENTS);
    const payment = await one<{ status: string; amountCents: string; operationRef: string; paidAt: Date }>(
      'SELECT status::text, "amountCents"::text AS "amountCents", "operationRef", "paidAt" FROM "Payment" WHERE "caseFileId" = $1',
      [model.caseFileId],
    );
    expect(payment.status).toBe('SUCCEEDED');
    expect(Number(payment.amountCents)).toBe(MODEL_CASE_FEE_CENTS);
    expect(payment.operationRef).toMatch(/\S{8,}/);
    const entry = await one<{ direction: string; amountCents: string }>('SELECT direction, "amountCents"::text AS "amountCents" FROM "TreasuryEntry" WHERE "caseFileId" = $1', [model.caseFileId]);
    expect(entry.direction).toBe('IN');
    expect(Number(entry.amountCents)).toBe(MODEL_CASE_FEE_CENTS);
  });

  it('signs the fixed copy of the application in a completed circle, with the lawyer’s signature on its hash', async () => {
    const copy = await one<{ id: string; sha256: string }>(
      `SELECT d.id, d.sha256 FROM "Document" d WHERE d."caseFileId" = $1 AND d."docType" = 'APPLICATION'`,
      [model.caseFileId],
    );
    const circle = await one<{ status: string; documentSha256: string }>('SELECT status::text, "documentSha256" FROM "SignatureCircle" WHERE "documentId" = $1', [copy.id]);
    expect(circle.status).toBe('COMPLETED');
    expect(circle.documentSha256).toBe(copy.sha256);
    const signature = await one<{ signerUserId: string; signerRole: string; documentSha256: string }>(
      `SELECT s."signerUserId", s."signerRole"::text AS "signerRole", s."documentSha256" FROM "Signature" s JOIN "SignatureCircle" c ON c.id = s."circleId" WHERE c."documentId" = $1`,
      [copy.id],
    );
    expect(signature).toEqual({ signerUserId: cast.lawyer.id, signerRole: 'LAWYER', documentSha256: copy.sha256 });
  });

  it('keeps every exhibit with its declared nature and hash, under the same stored object as in the draft', async () => {
    const exhibits = await sql<{ title: string; declaredNature: string; sha256: string; storageKey: string }>(
      `SELECT title, "declaredNature"::text AS "declaredNature", sha256, "storageKey" FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'EXHIBIT' ORDER BY title`,
      [model.caseFileId],
    );
    expect(exhibits).toHaveLength(3);
    const drafts = await sql<{ storageKey: string; sha256: string }>(`SELECT "storageKey", sha256 FROM "FilingDocument" WHERE "draftId" = $1 AND kind = 'EXHIBIT'`, [model.draftId]);
    expect(exhibits.map((e) => e.storageKey).sort()).toEqual(drafts.map((d) => d.storageKey).sort());
    for (const exhibit of exhibits) expect(exhibit.declaredNature).toMatch(/^(ORIGINAL|CERTIFIED_COPY|PHOTOCOPY)$/);
  });

  it('issues the filing receipt: date and time, number, documents with their nature and hash, payment reference', async () => {
    const view = await getDraft(await as('lawyer'), model.draftId);
    expect(view.draft.status).toBe('FILED');
    expect(view.draft.caseFileId).toBe(model.caseFileId);
    const receipt = await one<{ id: string; mediaType: string }>(`SELECT id, "mediaType" FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'FILING_RECEIPT'`, [model.caseFileId]);
    expect(receipt.mediaType).toBe('application/pdf');
    const res = await (await as('lawyer')).get(`/api/v1/cases/${model.caseFileId}/documents/${receipt.id}/file`);
    expect(res.status, describeResponse(res)).toBe(200);
    const issued = (await events('filing.receipt.issued')).find((e) => e.details.caseFileId === model.caseFileId);
    expect(issued).toBeDefined();
    const payment = (await events('payment.receipt.issued')).filter((e) => e.details.draftId === model.draftId);
    expect(payment).toHaveLength(1);
  });

  it('records in the event log the filing, the registration and the review of referrals that found none', async () => {
    const filed = (await events('filing.submitted')).find((e) => e.details.draftId === model.draftId);
    expect(filed).toBeDefined();
    const registered = (await events('case.registered')).find((e) => e.details.caseFileId === model.caseFileId);
    expect(registered).toBeDefined();
    const reviewed = (await events('case.referrals.reviewed')).find((e) => e.details.caseFileId === model.caseFileId);
    expect(reviewed?.details.referrals).toBe(0);
    expect(reviewed?.details.grounds).toBe('NONE');
    expect(await count('SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1', [model.caseFileId])).toBe(0);
    const file = await one<{ referredToProsecutionAt: Date | null }>('SELECT "referredToProsecutionAt" FROM "CaseFile" WHERE id = $1', [model.caseFileId]);
    expect(file.referredToProsecutionAt).toBeNull();
  });

  it('informs the filing lawyer, and keeps the file from the prosecution, which it does not concern', async () => {
    const notes = await sql<{ templateKey: string }>('SELECT "templateKey" FROM "Notification" WHERE "userId" = $1 AND "caseFileId" = $2', [cast.lawyer.id, model.caseFileId]);
    expect(notes.map((n) => n.templateKey)).toContain('notifications.case.registered');
    const prosecutor = await as('prosecutor');
    await expectDenied(() => prosecutor.get(`/api/v1/cases/${model.caseFileId}/available-actions`), 404);
  });
});

// ---------------------------------------------------------------------------

describe('the lawyer who files electronically is counsel of the plaintiffs (independent review IR-02, decision 67)', () => {
  const counselOf = (caseFileId: string) =>
    sql<{ displayName: string; side: string; lawyerUserId: string }>(
      `SELECT p."displayName", p.side::text AS side, r."lawyerUserId" FROM "Representation" r JOIN "CaseParty" p ON p.id = r."partyId"
        WHERE p."caseFileId" = $1 AND r."endedAt" IS NULL ORDER BY p.position`,
      [caseFileId],
    );
  const listed = async (user: TestUser) => (await casesOf(await subjectOf(user), { mode: 'demo', demoToolsEnabled: false, now: new Date() })).rows.map((row) => row.id);

  it('registers him as counsel of the plaintiff by the default of the card, shows him the file in his space, and serves him the application he signed', async () => {
    // The card as the form opens it: the box «ينوب المحامي المودع عن هذا الطرف» of each party at the default of its side.
    const card = withCounselBox(MODEL_CASE, (party) => (filerCounselByDefault('ELECTRONIC', party.side) ? true : undefined));
    expect(card.parties.map((p) => [p.side, p.representedByFiler])).toEqual([
      ['PLAINTIFF', true],
      ['DEFENDANT', undefined],
      ['GUARANTOR', undefined],
    ]);
    const lawyer = await as('lawyer');
    const filed = await fileCase(lawyer, secret, { card, exhibits: 1 });
    expect(await counselOf(filed.caseFileId)).toEqual([{ displayName: 'شركة ألف للتوريدات', side: 'PLAINTIFF', lawyerUserId: cast.lawyer.id }]);

    // The file appears in his space (study, «المرحلة الثانية»), and he opens it.
    const opened = await lawyer.get(`/api/v1/cases/${filed.caseFileId}/available-actions`);
    expect(opened.status, describeResponse(opened)).toBe(200);
    expect(await viewAs(cast.lawyer, filed.caseFileId)).not.toBeNull();
    expect(await listed(cast.lawyer)).toContain(filed.caseFileId);

    // He downloads the application: the very document his signature is on.
    const application = await one<{ id: string; sha256: string; byteSize: number }>(
      `SELECT id, sha256, "byteSize" FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'APPLICATION'`,
      [filed.caseFileId],
    );
    const signature = await one<{ signerUserId: string; documentSha256: string }>(
      `SELECT s."signerUserId", s."documentSha256" FROM "Signature" s JOIN "SignatureCircle" c ON c.id = s."circleId" WHERE c."documentId" = $1`,
      [application.id],
    );
    expect(signature).toEqual({ signerUserId: cast.lawyer.id, documentSha256: application.sha256 });
    const { result: download, events: appended } = await capturingEvents(() => lawyer.get(`/api/v1/cases/${filed.caseFileId}/documents/${application.id}/file`));
    expect(download.status, describeResponse(download)).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect(Number(download.headers.get('content-length'))).toBe(application.byteSize);
    expect(appended.filter((e) => e.action === 'document.downloaded').map((e) => e.details.documentId)).toEqual([application.id]);

    // A lawyer who acts for no one in the file still knows nothing of it.
    await expectDenied(async () => (await as('otherLawyer')).get(`/api/v1/cases/${filed.caseFileId}/available-actions`), 404);
    expect(await listed(cast.otherLawyer)).not.toContain(filed.caseFileId);
  });

  it('leaves to his own counsel the plaintiff the filing lawyer unticked among several, and still opens the file to the filing lawyer', async () => {
    const lawyer = await as('lawyer');
    const filed = await fileCase(lawyer, secret, { card: withParties(MODEL_CASE, [SECOND_PLAINTIFF]), exhibits: 1 });
    const plaintiffs = await sql<{ displayName: string }>(`SELECT "displayName" FROM "CaseParty" WHERE "caseFileId" = $1 AND side = 'PLAINTIFF' ORDER BY position`, [filed.caseFileId]);
    expect(plaintiffs.map((p) => p.displayName)).toEqual(['شركة ألف للتوريدات', SECOND_PLAINTIFF.name]);
    // Counsel of the plaintiff whose box stayed ticked, and of that one only.
    expect(await counselOf(filed.caseFileId)).toEqual([{ displayName: 'شركة ألف للتوريدات', side: 'PLAINTIFF', lawyerUserId: cast.lawyer.id }]);
    const opened = await lawyer.get(`/api/v1/cases/${filed.caseFileId}/available-actions`);
    expect(opened.status, describeResponse(opened)).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe('automatic referrals (art. 18, 20 and 101)', () => {
  let publicCase: FiledCase & { draftId: string };

  beforeAll(async () => {
    publicCase = await fileCase(await as('lawyer'), secret, { card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]) });
  }, 60_000);

  it('warned before signature that the State judicial agent is not a party (art. 605)', async () => {
    const lawyer = await as('lawyer');
    const draftId = await prepareDraft(lawyer, { card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]) });
    const view = await getDraft(lawyer, draftId);
    const warning = view.checks.find((c) => c.code === 'STATE_JUDICIAL_AGENT_MISSING');
    expect(warning).toMatchObject({ level: 'WARNING', article: 605 });
  });

  it('refers the file against a public establishment to the prosecution on registration, with its ground', async () => {
    const referral = await one<{ target: string; ground: string; article: number; item: number | null }>(
      'SELECT target::text, ground::text, article, item FROM "CaseReferral" WHERE "caseFileId" = $1',
      [publicCase.caseFileId],
    );
    expect(referral).toEqual({ target: 'PROSECUTION', ground: 'COMMUNICATION', article: 20, item: 1 });
    const file = await one<{ referredToProsecutionAt: Date | null }>('SELECT "referredToProsecutionAt" FROM "CaseFile" WHERE id = $1', [publicCase.caseFileId]);
    expect(file.referredToProsecutionAt).not.toBeNull();
    const notes = await notificationsOf(cast.prosecutor.id);
    expect(notes.some((n) => n.kind === 'INFORMATION')).toBe(true);
  });

  it('opens the referred file to the prosecution of its court with its two buttons, and to no other prosecution', async () => {
    const codes = await availableCodes(await as('prosecutor'), publicCase.caseFileId);
    expect(codes).toEqual(['case.prosecution.conclusions', 'case.prosecution.view']);
    await expectDenied(async () => (await as('otherCourtProsecutor')).get(`/api/v1/cases/${publicCase.caseFileId}/available-actions`), 404);
  });

  it('refers the file whose only public party is the State judicial agent, tells the prosecution of the court and opens the file to it (independent review IR-01)', async () => {
    const informedBefore = await count(`SELECT count(*) FROM "Notification" WHERE "userId" = $1 AND "templateKey" = 'notifications.case.referred'`, [cast.prosecutor.id]);
    const filed = await fileCase(await as('lawyer'), secret, { card: withParties(PUBLIC_DEFENDANT_CASE, [STATE_JUDICIAL_AGENT]) });
    // One public-law person in the file, and it is the judicial agent.
    const publicParties = await sql<{ publicEntityKind: string | null }>(`SELECT "publicEntityKind" FROM "CaseParty" WHERE "caseFileId" = $1 AND "personKind" = 'PUBLIC'`, [filed.caseFileId]);
    expect(publicParties).toEqual([{ publicEntityKind: 'STATE_JUDICIAL_AGENT' }]);

    const referrals = await sql<{ target: string; ground: string; article: number; item: number | null; reasonCode: string; version: string }>(
      `SELECT r.target::text, r.ground::text, r.article, r.item, r."reasonCode", s.version
         FROM "CaseReferral" r JOIN "RuleSet" s ON s.id = r."ruleSetId" WHERE r."caseFileId" = $1`,
      [filed.caseFileId],
    );
    const inForce = ruleSourceFiles().find((f) => f.kind === 'REFERRALS' && f.validTo === null);
    expect(referrals).toEqual([{ target: 'PROSECUTION', ground: 'COMMUNICATION', article: 20, item: 1, reasonCode: 'PUBLIC_PARTY', version: inForce?.version }]);
    const file = await one<{ referredToProsecutionAt: Date | null; registeredAt: Date }>('SELECT "referredToProsecutionAt", "registeredAt" FROM "CaseFile" WHERE id = $1', [filed.caseFileId]);
    expect(file.referredToProsecutionAt, 'communicated as soon as registered (art. 20)').toEqual(file.registeredAt);
    const reviewed = (await events('case.referrals.reviewed')).find((e) => e.details.caseFileId === filed.caseFileId);
    expect(reviewed?.details).toMatchObject({ referrals: 1, grounds: 'PROSECUTION/COMMUNICATION/20/1', ruleVersion: inForce?.version });

    // The prosecution of the court is told, and opens the file; the prosecution of another court does not.
    const informed = await sql<{ kind: string; targetPath: string }>(
      `SELECT kind::text, "targetPath" FROM "Notification" WHERE "userId" = $1 AND "caseFileId" = $2 AND "templateKey" = 'notifications.case.referred'`,
      [cast.prosecutor.id, filed.caseFileId],
    );
    expect(informed).toEqual([{ kind: 'INFORMATION', targetPath: `/cases/${filed.caseFileId}` }]);
    expect(await count(`SELECT count(*) FROM "Notification" WHERE "userId" = $1 AND "templateKey" = 'notifications.case.referred'`, [cast.prosecutor.id])).toBe(informedBefore + 1);
    expect(await count(`SELECT count(*) FROM "Notification" WHERE "userId" = $1 AND "caseFileId" = $2`, [cast.otherCourtProsecutor.id, filed.caseFileId])).toBe(0);
    expect(await availableCodes(await as('prosecutor'), filed.caseFileId)).toEqual(['case.prosecution.conclusions', 'case.prosecution.view']);
    expect(await viewAs(cast.prosecutor, filed.caseFileId)).not.toBeNull();
    await expectDenied(async () => (await as('otherCourtProsecutor')).get(`/api/v1/cases/${filed.caseFileId}/available-actions`), 404);
  });

  it('lets the prosecution file written conclusions as a PDF, and refuses them on a file not referred to it', async () => {
    const prosecutor = await as('prosecutor');
    const res = await prosecutor.post(`/api/v1/cases/${publicCase.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
      query: { name: 'conclusions.pdf', title: 'مستنتجات النيابة العامة' },
      rawBody: Buffer.from(pdfBytes('conclusions')),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.status, describeResponse(res)).toBe(200);
    expect(await count(`SELECT count(*) FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'PROSECUTION_CONCLUSIONS'`, [publicCase.caseFileId])).toBe(1);
    const wrongType = await prosecutor.post(`/api/v1/cases/${publicCase.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
      query: { name: 'conclusions.docx' },
      rawBody: Buffer.from(docxBytes(['x'])),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(wrongType.status, describeResponse(wrongType)).toBe(415);
    await expectDenied(
      () =>
        prosecutor.post(`/api/v1/cases/${model.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
          query: { name: 'conclusions.pdf' },
          rawBody: Buffer.from(pdfBytes('conclusions')),
          headers: { 'content-type': 'application/octet-stream' },
        }),
      404,
    );
  });

  it('refuses conclusions beyond what one act may file on one file, before storing anything (review P2-A-10)', async () => {
    const prosecutor = await as('prosecutor');
    const filedOf = () => count(`SELECT count(*) FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'PROSECUTION_CONCLUSIONS'`, [publicCase.caseFileId]);
    const missing = SECURITY_POLICY.uploads.caseMaxFiledPerAct - (await filedOf());
    await sql(
      `INSERT INTO "Document" (id, "caseFileId", "storageKey", sha256, "byteSize", "mediaType", "docType", channel, "depositedAt")
       SELECT gen_random_uuid(), $1::uuid, 'cases/' || $1::text || '/' || gen_random_uuid(), repeat('b', 64), 10, 'application/pdf', 'PROSECUTION_CONCLUSIONS', 'ELECTRONIC', now()
         FROM generate_series(1, $2)`,
      [publicCase.caseFileId, missing],
    );
    const before = await filedOf();
    const res = await prosecutor.post(`/api/v1/cases/${publicCase.caseFileId}/uploads/case.prosecution.conclusions`, undefined, {
      query: { name: 'one-more.pdf' },
      rawBody: Buffer.from(pdfBytes('one more')),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect({ status: res.status, code: res.code }, describeResponse(res)).toEqual({ status: 409, code: 'CASE_DOCUMENT_LIMIT' });
    expect(await filedOf()).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe('the registry office: three buttons, and none to reject the application', () => {
  it('shows the registry clerk of the court exactly «تأشير» «تصحيح التصنيف» «ملاحظة إلى القاضي»', async () => {
    expect(await availableCodes(await as('registry'), model.caseFileId)).toEqual([
      'case.registration.note-to-judge',
      'case.registration.reclassify',
      'case.registration.stamp',
    ]);
  });

  it('refuses a direct request to reject the application as an action that does not exist', async () => {
    const registry = await as('registry');
    for (const code of ['case.registration.reject', 'case.application.reject', 'case.reject']) {
      await expectDenied(() => act(registry, model.caseFileId, code), 404);
    }
    const file = await one<{ status: string }>('SELECT status::text FROM "CaseFile" WHERE id = $1', [model.caseFileId]);
    expect(file.status).toBe('REGISTERED');
  });

  it('refuses the registry buttons to the cashier, the clerk of another court and the lawyer', async () => {
    await expectDenied(async () => act(await as('cashier'), model.caseFileId, 'case.registration.stamp'), 403);
    await expectDenied(async () => act(await as('otherCourtRegistry'), model.caseFileId, 'case.registration.stamp'), 404);
    await expectDenied(async () => act(await as('lawyer'), model.caseFileId, 'case.registration.stamp'), 403);
  });

  it('corrects the classification with the case type, keeping the number and the national identifier', async () => {
    const registry = await as('registry');
    const other = await fileCase(await as('lawyer'), secret);
    const before = await one<{ number: number; code: number; nationalRef: string }>('SELECT number, code, "nationalRef" FROM "CaseFile" WHERE id = $1', [other.caseFileId]);
    // A code outside the table of case types is refused, and the refusal recorded.
    await expectDenied(() => act(registry, other.caseFileId, 'case.registration.reclassify', { caseType: '9999' }), 422);
    const res = await act(registry, other.caseFileId, 'case.registration.reclassify', { caseType: '8203' });
    expect(res.status, describeResponse(res)).toBe(200);
    const after = await one<{ number: number; code: number; nationalRef: string; caseType: string; classificationCorrectedAt: Date | null }>(
      'SELECT number, code, "nationalRef", "caseType", "classificationCorrectedAt" FROM "CaseFile" WHERE id = $1',
      [other.caseFileId],
    );
    expect(after.number).toBe(before.number);
    expect(after.nationalRef).toBe(before.nationalRef);
    expect(after.code).toBe(8203);
    expect(after.caseType).toBe('8203');
    expect(after.classificationCorrectedAt).not.toBeNull();
    const event = (await events('case.registration.reclassified')).find((e) => e.details.caseFileId === other.caseFileId);
    expect(event?.details).toMatchObject({ fromCode: before.code, toCode: 8203 });
  });

  it('recomputes the referrals when the classification changes, and refuses a case type of another specialty (review P2-S-05)', async () => {
    // A court of general jurisdiction, its registry, its prosecution.
    const general = await createCourt();
    await sql(`UPDATE "Court" SET specialty = 'GENERAL' WHERE id = $1`, [general.id]);
    const clerk = await login(await createUser({ roles: [{ role: 'CLERK_REGISTRATION', courtId: general.id }], label: 'general-registry' }));
    const prosecutor = await createUser({ roles: [{ role: 'PUBLIC_PROSECUTOR', courtId: general.id }], label: 'general-prosecutor' });
    const lawyer = await as('lawyer');
    const draftId = await createDraft(lawyer);
    expect((await updateDraft(lawyer, draftId, { caseType: '1201', courtId: general.id })).status).toBe(200);
    expect((await pasteApplication(lawyer, draftId, MODEL_CASE_APPLICATION_TEXT)).status).toBe(200);
    await runJobs();
    expect((await updateDraft(lawyer, draftId, { card: MODEL_CASE })).status).toBe(200);
    await attestAll(lawyer, draftId);
    expect((await upload(lawyer, draftId, { kind: 'EXHIBIT', name: 'contrat.pdf', bytes: pdfBytes('contract'), nature: 'ORIGINAL' })).status).toBe(200);
    await payDraft(lawyer, draftId);
    const filed = await submit(lawyer, draftId, { secret });
    expect(filed.status, describeResponse(filed)).toBe(200);
    const caseFileId = filed.data!.caseFileId;
    expect(await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1`, [caseFileId])).toBe(0);

    // A commercial case type does not belong to a court of general jurisdiction.
    await expectDenied(() => act(clerk, caseFileId, 'case.registration.reclassify', { caseType: '8201' }), 422);
    // A family matter (art. 18, item 2): the prosecution becomes a principal party, and is told.
    const res = await act(clerk, caseFileId, 'case.registration.reclassify', { caseType: '1601' });
    expect(res.status, describeResponse(res)).toBe(200);
    const referral = await one<{ target: string; ground: string; article: number; item: number | null }>(
      'SELECT target::text, ground::text, article, item FROM "CaseReferral" WHERE "caseFileId" = $1',
      [caseFileId],
    );
    expect(referral).toEqual({ target: 'PROSECUTION', ground: 'PRINCIPAL_PARTY', article: 18, item: 2 });
    const file = await one<{ referredToProsecutionAt: Date | null }>('SELECT "referredToProsecutionAt" FROM "CaseFile" WHERE id = $1', [caseFileId]);
    expect(file.referredToProsecutionAt).not.toBeNull();
    expect(await count(`SELECT count(*) FROM "Notification" WHERE "userId" = $1 AND "templateKey" = 'notifications.case.referred-reclassified'`, [prosecutor.id])).toBe(1);
  });

  it('communicates, when its classification is corrected, a file registered with a public-law party left without category (independent review IR-01)', async () => {
    const filed = await fileCase(await as('lawyer'), secret, { exhibits: 1 });
    expect(await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1`, [filed.caseFileId])).toBe(0);
    // As a file was registered before the category became mandatory: a public-law defendant, its category empty.
    await sql(`UPDATE "CaseParty" SET "personKind" = 'PUBLIC', "publicEntityKind" = NULL WHERE "caseFileId" = $1 AND side = 'DEFENDANT'`, [filed.caseFileId]);
    const res = await act(await as('registry'), filed.caseFileId, 'case.registration.reclassify', { caseType: '8203' });
    expect(res.status, describeResponse(res)).toBe(200);
    const referral = await one<{ target: string; ground: string; article: number; item: number | null }>(
      'SELECT target::text, ground::text, article, item FROM "CaseReferral" WHERE "caseFileId" = $1',
      [filed.caseFileId],
    );
    expect(referral).toEqual({ target: 'PROSECUTION', ground: 'COMMUNICATION', article: 20, item: 1 });
    const file = await one<{ referredToProsecutionAt: Date | null }>('SELECT "referredToProsecutionAt" FROM "CaseFile" WHERE id = $1', [filed.caseFileId]);
    expect(file.referredToProsecutionAt).not.toBeNull();
    expect(
      await count(`SELECT count(*) FROM "Notification" WHERE "userId" = $1 AND "caseFileId" = $2 AND "templateKey" = 'notifications.case.referred-reclassified'`, [cast.prosecutor.id, filed.caseFileId]),
    ).toBe(1);
    expect(await availableCodes(await as('prosecutor'), filed.caseFileId)).toEqual(['case.prosecution.conclusions', 'case.prosecution.view']);
  });

  it('communicates, when its type is changed, a file registered whose only public-law party is a judicial agent; the same type is refused and recomputes nothing (review of IR-01)', async () => {
    const filed = await fileCase(await as('lawyer'), secret, { exhibits: 1 });
    // As a file was registered under the first referral table, which communicated four categories and not the agents.
    await sql(`UPDATE "CaseParty" SET "personKind" = 'PUBLIC', "publicEntityKind" = 'STATE_JUDICIAL_AGENT' WHERE "caseFileId" = $1 AND side = 'DEFENDANT'`, [filed.caseFileId]);
    expect(await count(`SELECT count(*) FROM "CaseParty" WHERE "caseFileId" = $1 AND "personKind" = 'PUBLIC'`, [filed.caseFileId])).toBeGreaterThan(0);
    expect(await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1`, [filed.caseFileId])).toBe(0);
    expect(await count(`SELECT count(*) FROM "CaseFile" WHERE id = $1 AND "caseType" = $2`, [filed.caseFileId, COMMERCIAL_PAYMENT])).toBe(1);
    const registry = await as('registry');

    // Reclassified with the type it has: refused, and the referrals stay as they are.
    await expectDenied(() => act(registry, filed.caseFileId, 'case.registration.reclassify', { caseType: COMMERCIAL_PAYMENT }), 422);
    expect(await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1`, [filed.caseFileId])).toBe(0);

    // Another type: the referrals are recomputed with the table in force, and art. 20 (case 1) reaches the agent.
    const res = await act(registry, filed.caseFileId, 'case.registration.reclassify', { caseType: '8203' });
    expect(res.status, describeResponse(res)).toBe(200);
    const referral = await one<{ target: string; ground: string; article: number; item: number | null }>(
      'SELECT target::text, ground::text, article, item FROM "CaseReferral" WHERE "caseFileId" = $1',
      [filed.caseFileId],
    );
    expect(referral).toEqual({ target: 'PROSECUTION', ground: 'COMMUNICATION', article: 20, item: 1 });
    expect(await availableCodes(await as('prosecutor'), filed.caseFileId)).toEqual(['case.prosecution.conclusions', 'case.prosecution.view']);
  });

  it('stamps once: two stamps at once leave one stamp, and the buttons that precede it disappear', async () => {
    const other = await fileCase(await as('lawyer'), secret);
    const registry = await as('registry');
    const [a, b] = await Promise.all([act(registry, other.caseFileId, 'case.registration.stamp'), act(registry.clone(), other.caseFileId, 'case.registration.stamp')]);
    expect([a.status, b.status].filter((s) => s === 200), `${describeResponse(a)} / ${describeResponse(b)}`).toHaveLength(1);
    expect([403, 409]).toContain([a, b].find((r) => r.status !== 200)!.status);
    expect(await count(`SELECT count(*) FROM "Event" WHERE action = 'case.registration.stamped' AND details->>'caseFileId' = $1`, [other.caseFileId])).toBe(1);
    expect(await availableCodes(registry, other.caseFileId)).toEqual(['case.registration.note-to-judge']);
    await expectDenied(() => act(registry, other.caseFileId, 'case.registration.stamp'), 403);
    await expectDenied(() => act(registry, other.caseFileId, 'case.registration.reclassify', { caseType: '8203' }), 403);
  });

  it('addresses the note to the court president before a rapporteur is assigned, and never shows it to a lawyer', async () => {
    const registry = await as('registry');
    const res = await act(registry, model.caseFileId, 'case.registration.note-to-judge', { reason: 'FEE_SHORTFALL', text: 'يبدو الرسم المؤدى ناقصا بالنظر إلى الطلبات.' });
    expect(res.status, describeResponse(res)).toBe(200);
    const note = await one<{ addressedToUserId: string; reason: string }>('SELECT "addressedToUserId", reason::text FROM "CaseNote" WHERE "caseFileId" = $1', [model.caseFileId]);
    expect(note).toEqual({ addressedToUserId: cast.president.id, reason: 'FEE_SHORTFALL' });
    const presidentNotes = await sql<{ templateKey: string }>('SELECT "templateKey" FROM "Notification" WHERE "userId" = $1 AND "caseFileId" = $2', [cast.president.id, model.caseFileId]);
    expect(presidentNotes.map((n) => n.templateKey)).toContain('notifications.case.note-to-judge');

    const forPresident = await viewAs(cast.president, model.caseFileId);
    expect(forPresident?.notes.map((n) => n.text)).toEqual(['يبدو الرسم المؤدى ناقصا بالنظر إلى الطلبات.']);
    const forLawyer = await viewAs(cast.lawyer, model.caseFileId);
    expect(forLawyer?.notes).toEqual([]);
    expect(JSON.stringify(forLawyer, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain('يبدو الرسم المؤدى ناقصا');
    // The event records the note's existence, never its text.
    const event = (await events('case.note.added')).find((e) => e.details.caseFileId === model.caseFileId);
    expect(JSON.stringify(event?.details)).not.toContain('الرسم');
  });

  it('cannot change or delete a note of the registry once written', async () => {
    await expect(runtime().query(`UPDATE "CaseNote" SET text = 'x' WHERE "caseFileId" = $1`, [model.caseFileId])).rejects.toThrow();
    await expect(runtime().query(`DELETE FROM "CaseNote" WHERE "caseFileId" = $1`, [model.caseFileId])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('the number in the register (memo rows 7 and 8)', () => {
  it('gives consecutive numbers without repetition to filings made at the same moment', async () => {
    const lawyers = await Promise.all(Array.from({ length: 6 }, (_, i) => createUser({ roles: ['LAWYER'], label: `concurrent-${String(i)}` })));
    const ready: { client: Client; draftId: string; secret: string }[] = [];
    for (const user of lawyers) {
      const own = await giveSigningSecret(user.id, `Concurrent-secret-${user.id.slice(0, 6)}`);
      const client = await login(user);
      const draftId = await prepareDraft(client, { exhibits: 1 });
      await payDraft(client, draftId);
      ready.push({ client, draftId, secret: own });
    }
    const results = await Promise.all(ready.map((r) => submit(r.client, r.draftId, { secret: r.secret })));
    for (const res of results) expect(res.status, describeResponse(res)).toBe(200);
    const numbers = results.map((r) => r.data!.number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]! - numbers[i - 1]!).toBe(1);
  }, 120_000);

  it('refuses any change to the number, the year, the court or the national identifier of a registered file', async () => {
    for (const statement of [
      `UPDATE "CaseFile" SET number = number + 1000 WHERE id = $1`,
      `UPDATE "CaseFile" SET year = year + 1 WHERE id = $1`,
      `UPDATE "CaseFile" SET "nationalRef" = 'X-' || "nationalRef" WHERE id = $1`,
    ]) {
      await expect(runtime().query(statement, [model.caseFileId])).rejects.toThrow();
    }
    const otherCourt = await createCourt();
    await expect(runtime().query(`UPDATE "CaseFile" SET "courtId" = $2 WHERE id = $1`, [model.caseFileId, otherCourt.id])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('what each role sees of the parties (review P1-S-14)', () => {
  it('shows the identity numbers and e-mail addresses to the court and to counsel, not to a litigant of the file', async () => {
    const forRegistry = await viewAs(cast.registry, model.caseFileId);
    const plaintiff = forRegistry?.parties.find((p) => p.displayName === 'شركة ألف للتوريدات');
    expect(plaintiff?.idNumber).toBe('RC-DEMO-1001');
    // The litigant of the file (السيد جيم) accepted electronic service: he sees the parties, not their numbers.
    await sql(`UPDATE "CaseParty" SET "litigantUserId" = $2, "eServiceAcceptedAt" = now(), facts = array_append(facts, 'E_SERVICE_ACCEPTED') WHERE "caseFileId" = $1 AND "displayName" = 'السيد جيم'`, [
      model.caseFileId,
      cast.litigant.id,
    ]);
    const forLitigant = await viewAs(cast.litigant, model.caseFileId);
    expect(forLitigant).not.toBeNull();
    for (const party of forLitigant!.parties.filter((p) => p.displayName !== 'السيد جيم')) {
      expect(party.idNumber ?? null).toBeNull();
      expect(party.addresses.filter((a) => a.kind === 'ELECTRONIC' || a.kind === 'PHONE')).toEqual([]);
    }
  });
});
