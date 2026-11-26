// Independent review IR-06 (decision 71), written before the code: the
// application a lawyer uploads as a Word document is kept in the file exactly
// as filed, with its tracked changes, its comments and its author, but it is not
// the application served on the opponent: the fixed copy is. Only its depositor
// and the judges and staff of the file's court see it or download it:
//   - the filing lawyer and the registry clerk of the court download it (200)
//     and find it among the documents of the file;
//   - the prosecution of a file referred to it, and the counsel of the
//     defendant, are answered as for a document that does not exist (404), do
//     not find it listed, and read and download the fixed copy;
//   - on a database filed before, the migration keeps from the file an
//     original that was deposited for everyone.
import { beforeAll, describe, expect, it } from 'vitest';
import type { UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { PUBLIC_DEFENDANT_CASE, PUBLIC_ESTABLISHMENT, withParties } from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { migrateDeploy } from '../helpers/cli';
import { capturingEvents, one, sql } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { fileCase, giveSigningSecret, type FiledCase } from '../helpers/filings';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** The migration that keeps from the file an original filed before this fix. */
const MIGRATION = '20261126150100_application_source_depositor_and_court';

interface Cast {
  readonly lawyer: TestUser;
  readonly defenceLawyer: TestUser;
  readonly registry: TestUser;
  readonly prosecutor: TestUser;
}

let cast: Cast;
let filed: FiledCase & { draftId: string };
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

async function listedFor(user: TestUser): Promise<{ id: string; docType: string }[]> {
  const snapshot = await caseSnapshot(filed.caseFileId, new Date());
  if (!snapshot) throw new Error('no snapshot');
  const view = await caseView(filed.caseFileId, await subjectOf(user), snapshot);
  if (!view) throw new Error('no view');
  return view.documents.map((d) => ({ id: d.id, docType: d.docType }));
}

const fileOf = (documentId: string) => `/api/v1/cases/${filed.caseFileId}/documents/${documentId}/file`;

interface FiledDocument {
  readonly id: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly storageKey: string;
  readonly visibility: string;
  readonly depositedByUserId: string | null;
}

const documentOf = (docType: 'APPLICATION_SOURCE' | 'APPLICATION') =>
  one<FiledDocument>(
    `SELECT id, sha256, "byteSize", "mediaType", "storageKey", visibility::text AS visibility, "depositedByUserId" FROM "Document" WHERE "caseFileId" = $1 AND "docType" = $2`,
    [filed.caseFileId, docType],
  );

async function expectNotFound(fn: () => Promise<ApiResponse>): Promise<void> {
  const { result, events: appended } = await capturingEvents(fn);
  expect(result.status, describeResponse(result)).toBe(404);
  expect(appended.some((e) => e.action === 'access.denied')).toBe(true);
  expect(appended.some((e) => e.action === 'document.downloaded')).toBe(false);
}

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  cast = {
    lawyer: await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' }),
    defenceLawyer: await createUser({ roles: ['LAWYER'], label: 'defence-lawyer' }),
    registry: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' }),
    prosecutor: await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' }),
  };
  const secret = await giveSigningSecret(cast.lawyer.id);
  // A file against a public establishment, referred to the prosecution on registration (art. 20),
  // whose application the lawyer uploaded as a Word document.
  filed = await fileCase(await as('lawyer'), secret, { application: 'docx', card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]), exhibits: 1 });
  // The defendant has his counsel in the file.
  await sql(
    `INSERT INTO "Representation" (id, "partyId", "lawyerUserId", "startedAt")
     SELECT gen_random_uuid(), id, $2, now() FROM "CaseParty" WHERE "caseFileId" = $1 AND side = 'DEFENDANT'`,
    [filed.caseFileId, cast.defenceLawyer.id],
  );
}, 120_000);

describe('the application uploaded as a Word document (independent review IR-06, decision 71)', () => {
  it('is kept in the file exactly as filed, for its depositor and the court only', async () => {
    const original = await documentOf('APPLICATION_SOURCE');
    const uploaded = await one<{ storageKey: string; sha256: string; byteSize: number }>(
      `SELECT "storageKey", sha256, "byteSize" FROM "FilingDocument" WHERE "draftId" = $1 AND kind = 'APPLICATION_ORIGINAL'`,
      [filed.draftId],
    );
    expect({ storageKey: original.storageKey, sha256: original.sha256, byteSize: original.byteSize }).toEqual(uploaded);
    expect(original.mediaType).toBe(DOCX);
    expect(original.visibility).toBe('DEPOSITOR_AND_COURT');
    expect(original.depositedByUserId).toBe(cast.lawyer.id);
    // The fixed copy, signed and served on the opponent, is the file's.
    expect((await documentOf('APPLICATION')).visibility).toBe('CASE');
  });

  it('is served to the lawyer who filed it and to the registry clerk of the court, and listed for them', async () => {
    const original = await documentOf('APPLICATION_SOURCE');
    for (const name of ['lawyer', 'registry'] as const) {
      const { result: res, events: appended } = await capturingEvents(async () => (await as(name)).get(fileOf(original.id)));
      expect(res.status, `${name}: ${describeResponse(res)}`).toBe(200);
      expect(res.headers.get('content-type')).toBe(DOCX);
      expect(Number(res.headers.get('content-length'))).toBe(original.byteSize);
      expect(appended.filter((e) => e.action === 'document.downloaded').map((e) => e.details.documentId)).toEqual([original.id]);
      expect((await listedFor(cast[name])).map((d) => d.id), name).toContain(original.id);
    }
  });

  it('does not exist for the prosecution of the file referred to it, which reads and downloads the fixed copy', async () => {
    const file = await one<{ referredToProsecutionAt: Date | null }>('SELECT "referredToProsecutionAt" FROM "CaseFile" WHERE id = $1', [filed.caseFileId]);
    expect(file.referredToProsecutionAt, 'the file is referred to the prosecution').not.toBeNull();
    const original = await documentOf('APPLICATION_SOURCE');
    const copy = await documentOf('APPLICATION');
    const prosecutor = await as('prosecutor');
    await expectNotFound(() => prosecutor.get(fileOf(original.id)));
    const listed = await listedFor(cast.prosecutor);
    expect(listed.map((d) => d.id)).not.toContain(original.id);
    expect(listed.map((d) => d.docType)).not.toContain('APPLICATION_SOURCE');
    expect(listed.map((d) => d.id)).toContain(copy.id);
    const res = await prosecutor.get(fileOf(copy.id));
    expect(res.status, describeResponse(res)).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('does not exist for the counsel of the defendant either, who reads the fixed copy', async () => {
    const original = await documentOf('APPLICATION_SOURCE');
    const copy = await documentOf('APPLICATION');
    const defence = await as('defenceLawyer');
    await expectNotFound(() => defence.get(fileOf(original.id)));
    const listed = await listedFor(cast.defenceLawyer);
    expect(listed.map((d) => d.id)).not.toContain(original.id);
    expect(listed.map((d) => d.id)).toContain(copy.id);
    expect((await defence.get(fileOf(copy.id))).status).toBe(200);
  });

  it('keeps from the file, on a database filed before, an original that was deposited for everyone', async () => {
    const original = await documentOf('APPLICATION_SOURCE');
    // Back to the state before the migration: the original deposited at the file's visibility.
    await sql(`UPDATE "Document" SET visibility = 'CASE' WHERE id = $1`, [original.id]);
    await sql(`DELETE FROM "_prisma_migrations" WHERE migration_name = $1`, [MIGRATION]);
    expect(await listedFor(cast.prosecutor).then((rows) => rows.map((d) => d.id))).toContain(original.id);
    migrateDeploy();
    expect((await documentOf('APPLICATION_SOURCE')).visibility).toBe('DEPOSITOR_AND_COURT');
    // The other documents of the file keep theirs.
    const others = await sql<{ docType: string; visibility: string }>(
      `SELECT "docType", visibility::text AS visibility FROM "Document" WHERE "caseFileId" = $1 AND "docType" <> 'APPLICATION_SOURCE'`,
      [filed.caseFileId],
    );
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) expect(other.visibility, other.docType).toBe('CASE');
    expect((await listedFor(cast.prosecutor)).map((d) => d.id)).not.toContain(original.id);
  }, 120_000);
});
