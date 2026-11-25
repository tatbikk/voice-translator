// Memo rows 16 and 17, extended to the flows of Phase 1 (review P1-S-15): the
// personal signing secret (set, wrong, right), the signature circle and its
// verification, the case file and its documents read through their routes,
// refused procedural actions, and the case page's view. None of the secrets,
// passwords, codes, tokens, e-mails, names or document contents used reaches
// the event log or the technical log, even at debug level; no API answer
// carries a secret, a password, a code or a token; and no table holds the
// signing secret in clear.
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { storeDocument } from '@/server/documents/service';
import { openSignatureCircle, setSigningSecret, signDocument, verifyDocumentSignatures } from '@/server/signature/service';
import { login } from '../helpers/auth';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { sql } from '../helpers/db';
import { overrideEnv } from '../helpers/env';
import type { TestUser } from '../helpers/factories';
import { recordedResponses } from '../helpers/http';
import { capturedLogs } from '../helpers/log-capture';
import { useFreshDatabase } from '../helpers/reset';
import { findLeaks, trackSensitive } from '../helpers/sensitive';

let scenario: CaseScenario;
const SECRET = `signing-${randomBytes(12).toString('hex')}`;
const WRONG = `wrong-signing-${randomBytes(12).toString('hex')}`;
// The content of a deposited document: it travels in the download answer, never in a log.
const CONTENT = `مضمون-وثيقة-${randomBytes(8).toString('hex')}`;

trackSensitive('secret', SECRET);
trackSensitive('secret', WRONG);
// Names of parties and the content of a document: checked in the event log and the technical log.
trackSensitive('name', CONTENT);
trackSensitive('name', 'شركة ألف للتوريدات');
trackSensitive('name', 'شركة باء للصناعة');

const signer = (user: TestUser) => ({ userId: user.id, roleAssignmentId: user.roleAssignmentId });

async function subjectOf(user: TestUser): Promise<UserSubject> {
  const [row] = await sql<{ role: UserSubject['role']; courtId: string | null; panelId: string | null }>(
    `SELECT role, "courtId", "panelId" FROM "RoleAssignment" WHERE id = $1`,
    [user.roleAssignmentId],
  );
  if (!row) throw new Error('no role assignment');
  return {
    kind: 'user',
    userId: user.id,
    role: row.role,
    roleAssignmentId: user.roleAssignmentId,
    courtId: row.courtId,
    panelId: row.panelId,
    organizationId: null,
    isDemoAccount: false,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

/** Runs every Phase 1 flow once, successes and refusals alike. */
async function runPhaseOneFlows(): Promise<void> {
  scenario = await caseScenario({ status: 'IN_DELIBERATION' });
  const { users } = scenario;
  const exhibit = await storeDocument({
    caseFileId: scenario.caseFileId,
    bytes: new TextEncoder().encode(`%PDF-1.7\n% ${CONTENT}\n`),
    mediaType: 'application/pdf',
    docType: 'EXHIBIT',
    visibility: 'CASE',
    channel: 'ELECTRONIC',
    declaredNature: 'ORIGINAL',
    generated: false,
    depositedByUserId: users.plaintiffLawyer.id,
    depositedByPartyId: scenario.plaintiffPartyId,
  });

  for (const user of [users.panelPresident, users.rapporteur, users.hearingClerk]) await setSigningSecret(user.id, SECRET);
  const circle = await openSignatureCircle({
    documentId: scenario.draftDocumentId,
    purpose: 'JUDGMENT',
    signers: [signer(users.panelPresident), signer(users.rapporteur), signer(users.hearingClerk)],
  });
  await signDocument({ circleId: circle.id, ...signer(users.rapporteur), secret: SECRET }); // not his turn
  await signDocument({ circleId: circle.id, ...signer(users.panelPresident), secret: WRONG });
  await signDocument({ circleId: circle.id, ...signer(users.panelPresident), secret: SECRET });
  await signDocument({ circleId: circle.id, ...signer(users.rapporteur), secret: SECRET });
  await verifyDocumentSignatures(scenario.draftDocumentId);

  const path = `/api/v1/cases/${scenario.caseFileId}`;
  const rapporteur = await login(users.rapporteur);
  await rapporteur.get(`${path}/available-actions`);
  await rapporteur.get(`${path}/documents/${scenario.draftDocumentId}/signatures`);
  await rapporteur.get(`${path}/documents/${scenario.draftDocumentId}/file`);
  await rapporteur.post(`${path}/actions/case.appeal.file`, {});
  await rapporteur.post(`${path}/actions/case.hearing.reserve`, {});

  const lawyer = await login(users.plaintiffLawyer);
  await lawyer.get(`${path}/available-actions`);
  await lawyer.get(`${path}/documents/${exhibit.id}/file`);
  await lawyer.get(`${path}/documents/${scenario.draftDocumentId}/file`);
  await lawyer.get(`${path}/documents/${scenario.draftDocumentId}/signatures`);
  await lawyer.post(`${path}/actions/case.judgment.pronounce`, {});

  const stranger = await login(users.otherLawyer);
  await stranger.get(`${path}/available-actions`);
  await stranger.get(`${path}/documents/${exhibit.id}/file`);
  await stranger.post(`${path}/actions/case.brief.file`, {});

  const snapshot = await caseSnapshot(scenario.caseFileId, new Date());
  if (!snapshot) throw new Error('no snapshot');
  await caseView(scenario.caseFileId, await subjectOf(users.rapporteur), snapshot);
  await caseView(scenario.caseFileId, await subjectOf(users.plaintiffLawyer), snapshot);
}

describe('secrets and personal data in the flows of Phase 1 (memo rows 16 and 17, review P1-S-15)', () => {
  useFreshDatabase();

  beforeAll(async () => {
    const restore = await overrideEnv({ LOG_LEVEL: 'debug' });
    try {
      await runPhaseOneFlows();
    } finally {
      await restore();
    }
  }, 180_000);

  it('the flows ran: signatures, refusals and downloads were recorded', async () => {
    const actions = (await sql<{ action: string }>(`SELECT DISTINCT action FROM "Event"`)).map((r) => r.action);
    for (const action of ['signature.secret.set', 'signature.refused', 'signature.signed', 'signature.verified', 'document.downloaded', 'access.denied']) {
      expect(actions, action).toContain(action);
    }
  });

  it('row 16: the whole event log holds none of the secrets, names or contents used', async () => {
    const dump = JSON.stringify(await sql('SELECT * FROM "Event" ORDER BY seq'));
    expect(findLeaks(dump)).toEqual([]);
  });

  it('row 17: the technical log holds none of them, even at debug level', () => {
    expect(findLeaks(capturedLogs())).toEqual([]);
  });

  it('row 17: no API answer carries a secret, a password, a code or a token', () => {
    const leaks: string[] = [];
    for (const res of recordedResponses()) {
      for (const leak of findLeaks(`${res.headers}\n${res.text}`, ['secret', 'password', 'code', 'token'])) {
        leaks.push(`${res.method} ${res.path} ${String(res.status)}: ${leak}`);
      }
    }
    expect(recordedResponses().length).toBeGreaterThan(10);
    expect(leaks).toEqual([]);
  });

  it('no table holds the signing secret in clear; it is kept as an Argon2id hash', async () => {
    const tables = await sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    for (const { tablename } of tables) {
      if (tablename === '_prisma_migrations') continue;
      const dump = JSON.stringify(await sql(`SELECT * FROM "${tablename.replace(/"/g, '')}"`));
      expect(findLeaks(dump, ['secret', 'password']), tablename).toEqual([]);
    }
    const hashes = await sql<{ secretHash: string }>(`SELECT "secretHash" FROM "SigningCredential"`);
    expect(hashes.length).toBe(3);
    for (const { secretHash } of hashes) expect(secretHash.startsWith('$argon2id$')).toBe(true);
  });
});
