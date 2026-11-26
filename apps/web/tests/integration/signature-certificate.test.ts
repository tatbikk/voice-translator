// Independent review IR-07 (decision 72), written before the code: the fixed copy
// of the application is printed before it is signed, and its bytes, which the
// signature is on, never change. So once the electronic application is signed at
// registration, the platform prints beside it «شهادة توقيع»: a generated document
// of the file that carries the stamp «توقيع تجريبي», the signer's name and role,
// the date and hour of the signature (Morocco time), the references of the file
// and the hash of the signed application, with the environment line of every
// generated document. It is linked to the application it attests, listed with it
// in the documents of the file, printed by the worker with the retry rules of the
// other generated documents, and printed once.
import { beforeAll, describe, expect, it } from 'vitest';
import { formatMoroccoDate, formatMoroccoTime, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { sha256Hex } from '@/server/documents/service';
import { documentStore } from '@/server/documents/store';
import { issueSignatureCertificate } from '@/server/filings/generated';
import { enqueue } from '@/server/jobs/queue';
import { login } from '../helpers/auth';
import { capturingEvents, count, events, one, sql } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { MODEL_CASE } from '../acceptance/model-case-filing.fixture';
import { createPaperDraft, fileCase, giveSigningSecret, openPayment, payDraft, prepareDraft, runJobs, settle, submit, updateDraft, upload, type FiledCase } from '../helpers/filings';
import { describeResponse, type Client } from '../helpers/http';
import { containsRightToLeft, pdfPages, readsRightToLeft } from '../helpers/pdf-text';
import { pdfBytes } from '../helpers/samples';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

const TITLE = 'شهادة توقيع'; // the owner's decision on IR-07
const STAMP = 'توقيع تجريبي'; // prompt, rule 9; glossary signature.testSeal
const LAWYER_ROLE = 'المحامي'; // glossary roles.LAWYER
const ENVIRONMENT_LINE = 'صادرة عن بيئة العرض — لا أثر قانوني لها'; // prompt, rule 9

let lawyer: TestUser;
let registry: TestUser;
let lawyerClient: Client;
let secret: string;
let filed: FiledCase & { draftId: string };

interface Row {
  readonly id: string;
  readonly sha256: string;
  readonly storageKey: string;
}

const applicationOf = (caseFileId: string) => one<Row>(`SELECT id, sha256, "storageKey" FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'APPLICATION'`, [caseFileId]);
const certificatesOf = (caseFileId: string) =>
  sql<Row & { attestsDocumentId: string | null; generated: boolean; simulated: boolean; mediaType: string; visibility: string; channel: string; depositedByUserId: string | null }>(
    `SELECT id, sha256, "storageKey", "attestsDocumentId", generated, simulated, "mediaType", visibility::text AS visibility, channel::text AS channel, "depositedByUserId"
       FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'SIGNATURE_CERTIFICATE'`,
    [caseFileId],
  );

async function textOf(storageKey: string): Promise<string[][]> {
  const bytes = await documentStore().get(storageKey);
  if (!bytes) throw new Error('the printed certificate is not in the store');
  return pdfPages(bytes);
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

async function documentsFor(user: TestUser, caseFileId: string) {
  const snapshot = await caseSnapshot(caseFileId, new Date());
  if (!snapshot) throw new Error('no snapshot');
  const view = await caseView(caseFileId, await subjectOf(user), snapshot);
  if (!view) throw new Error('no view');
  return view.documents;
}

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  lawyer = await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' });
  registry = await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' });
  secret = await giveSigningSecret(lawyer.id);
  lawyerClient = await login(lawyer);
  filed = await fileCase(lawyerClient, secret, { exhibits: 1 });
}, 120_000);

describe('«شهادة توقيع» of the electronic application (independent review IR-07, decision 72)', () => {
  it('is a generated document of the file, linked to the application it attests', async () => {
    const application = await applicationOf(filed.caseFileId);
    const certificates = await certificatesOf(filed.caseFileId);
    expect(certificates).toHaveLength(1);
    const [certificate] = certificates;
    expect(certificate).toMatchObject({
      attestsDocumentId: application.id,
      generated: true,
      simulated: true,
      mediaType: 'application/pdf',
      visibility: 'CASE',
      channel: 'ELECTRONIC',
      depositedByUserId: null,
    });
    // Stored as every document of the file, and its issue recorded.
    const stored = (await events('document.stored')).find((e) => e.details.documentId === certificate!.id);
    expect(stored?.details).toMatchObject({ sha256: certificate!.sha256, generated: true, docType: 'SIGNATURE_CERTIFICATE' });
    expect(stored?.caseFileId).toBe(filed.caseFileId);
    const circle = await one<{ id: string }>('SELECT id FROM "SignatureCircle" WHERE "documentId" = $1', [application.id]);
    const issued = (await events('signature.certificate.issued')).filter((e) => e.details.documentId === certificate!.id);
    expect(issued.map((e) => e.details)).toEqual([{ caseFileId: filed.caseFileId, documentId: certificate!.id, attestsDocumentId: application.id, circleId: circle.id }]);
  });

  it('prints the stamp, the signer and his role, the date and hour of the signature, the references of the file and the hash of the application', async () => {
    const application = await applicationOf(filed.caseFileId);
    const [certificate] = await certificatesOf(filed.caseFileId);
    const signature = await one<{ signedAt: Date; documentSha256: string }>(
      `SELECT s."signedAt", s."documentSha256" FROM "Signature" s JOIN "SignatureCircle" c ON c.id = s."circleId" WHERE c."documentId" = $1`,
      [application.id],
    );
    const file = await one<{ number: number; code: number; year: number; nationalRef: string }>('SELECT number, code, year, "nationalRef" FROM "CaseFile" WHERE id = $1', [filed.caseFileId]);
    const pages = await textOf(certificate!.storageKey);
    const text = pages.flat();
    const all = text.join(' | ');
    const flat = text.join('').replace(/\s+/g, '');
    expect(containsRightToLeft(text, TITLE), all).toBe(true);
    expect(containsRightToLeft(text, STAMP), all).toBe(true);
    expect(containsRightToLeft(text, LAWYER_ROLE), all).toBe(true);
    expect(containsRightToLeft(text, lawyer.fullName), `the signer’s name: ${all}`).toBe(true);
    expect(flat, 'the hash of the signed application').toContain(application.sha256);
    expect(signature.documentSha256).toBe(application.sha256);
    // The date and hour of the signature, Morocco time, as one phrase.
    expect(containsRightToLeft(text, `${formatMoroccoDate(signature.signedAt)} على الساعة ${formatMoroccoTime(signature.signedAt)}`), `the date and hour of the signature: ${all}`).toBe(true);
    expect(flat, 'the number of the file').toContain(`${String(file.number)}/${String(file.code)}/${String(file.year)}`);
    expect(flat, 'the national identifier').toContain(file.nationalRef);
    // The environment line, on every page, as on every generated document.
    for (const [i, page] of pages.entries()) expect(readsRightToLeft(page, ENVIRONMENT_LINE), `page ${String(i + 1)}`).toBe(true);
  });

  it('leaves the bytes and the hash of the signed application as they were', async () => {
    const application = await applicationOf(filed.caseFileId);
    const registered = (await events('document.stored')).find((e) => e.details.documentId === application.id);
    expect(registered?.details.sha256).toBe(application.sha256);
    const opened = (await events('signature.circle.opened')).find((e) => e.details.documentId === application.id);
    expect(opened?.details.documentSha256).toBe(application.sha256);
    const bytes = await documentStore().get(application.storageKey);
    expect(bytes && sha256Hex(bytes)).toBe(application.sha256);
    const res = await lawyerClient.get(`/api/v1/cases/${filed.caseFileId}/documents/${application.id}/file`);
    expect(res.status, describeResponse(res)).toBe(200);
  });

  it('is listed with the application it attests in the documents of the file, and downloaded like any of them', async () => {
    const application = await applicationOf(filed.caseFileId);
    const [certificate] = await certificatesOf(filed.caseFileId);
    for (const user of [lawyer, registry]) {
      const documents = await documentsFor(user, filed.caseFileId);
      const at = documents.findIndex((d) => d.id === application.id);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(documents[at + 1]).toMatchObject({ id: certificate!.id, docType: 'SIGNATURE_CERTIFICATE', attestsDocumentId: application.id, generated: true });
      expect(documents[at]).toMatchObject({ attestsDocumentId: null });
    }
    const res = await lawyerClient.get(`/api/v1/cases/${filed.caseFileId}/documents/${certificate!.id}/file`);
    expect(res.status, describeResponse(res)).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('is printed once, however often its job runs', async () => {
    const application = await applicationOf(filed.caseFileId);
    await enqueue(null, 'filing.signature-certificate', { documentId: application.id });
    await runJobs();
    expect(await certificatesOf(filed.caseFileId)).toHaveLength(1);
  });

  it('is printed for a signed document only', async () => {
    const exhibit = await one<{ id: string }>(`SELECT id FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'EXHIBIT'`, [filed.caseFileId]);
    await issueSignatureCertificate(exhibit.id);
    expect(await count(`SELECT count(*) FROM "Document" WHERE "attestsDocumentId" = $1`, [exhibit.id])).toBe(0);
  });

  it('keeps the document it attests: the link never changes', async () => {
    const [certificate] = await certificatesOf(filed.caseFileId);
    const exhibit = await one<{ id: string }>(`SELECT id FROM "Document" WHERE "caseFileId" = $1 AND "docType" = 'EXHIBIT'`, [filed.caseFileId]);
    await expect(sql(`UPDATE "Document" SET "attestsDocumentId" = $2 WHERE id = $1`, [certificate!.id, exhibit.id])).rejects.toThrow();
    await expect(sql(`UPDATE "Document" SET "attestsDocumentId" = NULL WHERE id = $1`, [certificate!.id])).rejects.toThrow();
  });

  // Review of IR-07: a paper application carries no electronic signature (decision 59), so nothing attests one.
  it('is neither queued nor printed for a paper filing', async () => {
    const clerk = await login(registry);
    const draftId = await createPaperDraft(clerk);
    const saved = await updateDraft(clerk, draftId, {
      caseType: '8201',
      card: MODEL_CASE,
      paperDepositor: { name: 'السيد نون', idNumber: 'DEMO-CIN-0003', quality: 'ممثل الشركة المدعية' },
      attest: ['PLAINTIFFS', 'DEFENDANTS', 'SUMMARY', 'CLAIMS'],
    });
    expect(saved.status, describeResponse(saved)).toBe(200);
    const scan = await upload(clerk, draftId, { kind: 'APPLICATION', name: 'scan.pdf', bytes: pdfBytes('paper-certificate'), pages: 3, location: 'خزانة التقييد، الرف 4' });
    expect(scan.status, describeResponse(scan)).toBe(200);
    const { intentId } = await openPayment(clerk, draftId);
    expect((await settle(clerk, intentId, 'SUCCEEDED')).status).toBe(200);
    await runJobs();
    const res = await submit(clerk, draftId, {});
    expect(res.status, describeResponse(res)).toBe(200);
    const caseFileId = res.data!.caseFileId;
    const application = await applicationOf(caseFileId);
    expect(await count(`SELECT count(*) FROM "Job" WHERE type = 'filing.signature-certificate' AND payload->>'documentId' = $1`, [application.id])).toBe(0);
    await runJobs();
    expect(await certificatesOf(caseFileId)).toHaveLength(0);
    expect(await count(`SELECT count(*) FROM "Document" WHERE "attestsDocumentId" = $1`, [application.id])).toBe(0);
  }, 120_000);

  it('follows the retry rules of the generated documents: a failed print is tried again, and only the last failure is recorded', async () => {
    // A filing whose jobs have not run yet: its certificate is still to print.
    const draftId = await prepareDraft(lawyerClient, { exhibits: 1 });
    await payDraft(lawyerClient, draftId);
    const res = await submit(lawyerClient, draftId, { secret });
    expect(res.status, describeResponse(res)).toBe(200);
    const caseFileId = res.data!.caseFileId;
    const application = await applicationOf(caseFileId);
    const stopped = AbortSignal.abort();

    // A failure before the last attempt goes back to the queue, unrecorded.
    const { result: retried, events: none } = await capturingEvents(() => issueSignatureCertificate(application.id, { signal: stopped, lastAttempt: false }).then(() => 'printed', () => 'thrown'));
    expect(retried).toBe('thrown');
    expect(none.filter((e) => e.action === 'document.generation.failed')).toEqual([]);
    // The last failure is recorded on the file, and nothing is stored.
    const { events: last } = await capturingEvents(() => issueSignatureCertificate(application.id, { signal: stopped, lastAttempt: true }));
    expect(last.filter((e) => e.action === 'document.generation.failed').map((e) => [e.details.template, e.caseFileId])).toEqual([['signature-certificate', caseFileId]]);
    expect(await certificatesOf(caseFileId)).toHaveLength(0);

    // The job the registration queued prints it.
    await runJobs();
    const certificates = await certificatesOf(caseFileId);
    expect(certificates.map((c) => c.attestsDocumentId)).toEqual([application.id]);
    expect((await applicationOf(caseFileId)).sha256).toBe(application.sha256);
  }, 120_000);
});
