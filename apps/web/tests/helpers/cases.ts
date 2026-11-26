// A case file with its cast, written through the OWNER connection: parties,
// counsel, claims, a time limit and two documents (one visible to everyone
// related to the case, one reserved to the panel before pronouncement). The
// documents go through the platform's own store, so that their bytes and
// hashes are those the download and verification routes read.
import { randomUUID } from 'node:crypto';
import { storeDocument } from '@/server/documents/service';
import { createCaseFile, createCourt, createPanel, createUser, theCourt, type TestUser } from './factories';
import { sql } from './db';

export interface CaseScenario {
  readonly caseFileId: string;
  readonly courtId: string;
  readonly panelId: string;
  readonly plaintiffPartyId: string;
  readonly defendantPartyId: string;
  readonly users: {
    readonly plaintiffLawyer: TestUser;
    readonly defenseLawyer: TestUser;
    readonly otherLawyer: TestUser;
    readonly rapporteur: TestUser;
    readonly otherRapporteur: TestUser;
    readonly panelPresident: TestUser;
    readonly panelMember: TestUser;
    readonly hearingClerk: TestUser;
    readonly registrationClerk: TestUser;
    readonly otherCourtClerk: TestUser;
    readonly prosecutor: TestUser;
    readonly admin: TestUser;
    readonly validator: TestUser;
    readonly bailiff: TestUser;
    readonly expert: TestUser;
  };
  /** a document every related user may read */
  readonly applicationDocumentId: string;
  /** the judgment draft: panel only, until pronouncement */
  readonly draftDocumentId: string;
}

async function setPanel(user: TestUser, panelId: string): Promise<void> {
  await sql(`UPDATE "RoleAssignment" SET "panelId" = $1 WHERE id = $2`, [panelId, user.roleAssignmentId]);
}

export async function caseScenario(options: { status?: string } = {}): Promise<CaseScenario> {
  const court = await theCourt();
  const panelId = await createPanel(court.id);
  const otherCourt = await createCourt();
  const users = {
    plaintiffLawyer: await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' }),
    defenseLawyer: await createUser({ roles: ['LAWYER'], label: 'defense-lawyer' }),
    otherLawyer: await createUser({ roles: ['LAWYER'], label: 'other-lawyer' }),
    rapporteur: await createUser({ roles: ['JUDGE_RAPPORTEUR'], label: 'rapporteur' }),
    otherRapporteur: await createUser({ roles: ['JUDGE_RAPPORTEUR'], label: 'other-rapporteur' }),
    panelPresident: await createUser({ roles: ['PANEL_PRESIDENT'], label: 'panel-president' }),
    panelMember: await createUser({ roles: ['PANEL_MEMBER'], label: 'panel-member' }),
    hearingClerk: await createUser({ roles: ['CLERK_HEARING'], label: 'hearing-clerk' }),
    registrationClerk: await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registration-clerk' }),
    otherCourtClerk: await createUser({ roles: [{ role: 'CLERK_REGISTRATION', courtId: otherCourt.id }], label: 'other-clerk' }),
    prosecutor: await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' }),
    admin: await createUser({ roles: ['SYSTEM_ADMIN'], label: 'admin' }),
    validator: await createUser({ roles: ['RULES_LEGAL_VALIDATOR'], label: 'validator' }),
    bailiff: await createUser({ roles: ['BAILIFF'], label: 'bailiff' }),
    expert: await createUser({ roles: ['EXPERT'], label: 'expert' }),
  };
  for (const user of [users.rapporteur, users.panelPresident, users.panelMember]) await setPanel(user, panelId);

  const file = await createCaseFile({ courtId: court.id, status: options.status ?? 'IN_PREPARATION' });
  await sql(
    `UPDATE "CaseFile" SET kind = 'FIRST_INSTANCE', "caseType" = '8201', subject = 'دعوى أداء',
       "panelId" = $2, "rapporteurUserId" = $3, procedure = 'WRITTEN', "registeredAt" = now() WHERE id = $1`,
    [file.id, panelId, users.rapporteur.id],
  );

  const plaintiffPartyId = randomUUID();
  const defendantPartyId = randomUUID();
  await sql(
    `INSERT INTO "CaseParty" (id, "caseFileId", side, "personKind", "displayName", position)
     VALUES ($1, $3, 'PLAINTIFF', 'LEGAL', 'شركة ألف للتوريدات', 1), ($2, $3, 'DEFENDANT', 'LEGAL', 'شركة باء للصناعة', 2)`,
    [plaintiffPartyId, defendantPartyId, file.id],
  );
  await sql(
    `INSERT INTO "Representation" (id, "partyId", "lawyerUserId", "startedAt") VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
    [randomUUID(), plaintiffPartyId, users.plaintiffLawyer.id, randomUUID(), defendantPartyId, users.defenseLawyer.id],
  );
  await sql(
    `INSERT INTO "Claim" (id, "caseFileId", "partyId", category, nature, "amountCents", "filedAt")
     VALUES ($1, $2, $3, 'PRINCIPAL', 'DEBT', 48600000, now())`,
    [randomUUID(), file.id, plaintiffPartyId],
  );

  const application = await storeDocument({
    caseFileId: file.id,
    bytes: new TextEncoder().encode('%PDF-1.7\n% application\n'),
    mediaType: 'application/pdf',
    docType: 'APPLICATION',
    visibility: 'CASE',
    channel: 'ELECTRONIC',
    declaredNature: 'ORIGINAL',
    generated: false,
    depositedByUserId: users.plaintiffLawyer.id,
    depositedByPartyId: plaintiffPartyId,
  });
  const draft = await storeDocument({
    caseFileId: file.id,
    bytes: new TextEncoder().encode('%PDF-1.7\n% judgment draft\n'),
    mediaType: 'application/pdf',
    docType: 'JUDGMENT',
    visibility: 'PANEL',
    channel: 'ELECTRONIC',
    declaredNature: null,
    generated: true,
    depositedByUserId: users.rapporteur.id,
    depositedByPartyId: null,
  });

  return {
    caseFileId: file.id,
    courtId: court.id,
    panelId,
    plaintiffPartyId,
    defendantPartyId,
    users,
    applicationDocumentId: application.id,
    draftDocumentId: draft.id,
  };
}
