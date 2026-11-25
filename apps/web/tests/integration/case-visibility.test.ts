// Review findings P1-S-01, P1-S-02, P1-S-04 and P1-A-03, on data built in the database:
//  - the timeline of a file shows nothing of a document hidden from the viewer
//    (a judgment draft before pronouncement) and no access record;
//  - a time limit recorded ELAPSED stays elapsed in the server's snapshot, so
//    an act conditioned on the limit not having elapsed is refused.
import { beforeAll, describe, expect, it } from 'vitest';
import { authorize, deadlineState, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { appendStandaloneEvent } from '@/server/events/append';
import { openSignatureCircle } from '@/server/signature/service';
import { login } from '../helpers/auth';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { sql } from '../helpers/db';
import type { TestUser } from '../helpers/factories';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

let scenario: CaseScenario;

async function subjectOf(user: TestUser): Promise<UserSubject> {
  const [row] = await sql<{ role: UserSubject['role']; courtId: string | null; panelId: string | null; organizationId: string | null }>(
    `SELECT role, "courtId", "panelId", "organizationId" FROM "RoleAssignment" WHERE id = $1`,
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
    organizationId: row.organizationId,
    isDemoAccount: false,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

async function timelineOf(user: TestUser) {
  const subject = await subjectOf(user);
  const snapshot = await caseSnapshot(scenario.caseFileId, new Date());
  if (!snapshot) throw new Error('no snapshot');
  const view = await caseView(scenario.caseFileId, subject, snapshot);
  if (!view) throw new Error('no view');
  return view.timeline;
}

beforeAll(async () => {
  scenario = await caseScenario({ status: 'IN_DELIBERATION' });
  await appendStandaloneEvent({ action: 'document.downloaded', details: { documentId: scenario.draftDocumentId }, caseFileId: scenario.caseFileId });
  await appendStandaloneEvent({
    action: 'case.transition.recorded',
    details: { action: 'case.judgment.draft', fromStatus: 'IN_DELIBERATION', toStatus: 'IN_DELIBERATION' },
    caseFileId: scenario.caseFileId,
  });
});

describe('the timeline shows only what the viewer may know (P1-S-01)', () => {
  it('hides the judgment draft, its download and the deliberation from counsel, clerks and prosecution', async () => {
    for (const user of [scenario.users.plaintiffLawyer, scenario.users.defenseLawyer, scenario.users.hearingClerk, scenario.users.registrationClerk]) {
      const timeline = await timelineOf(user);
      expect(timeline.some((e) => e.action === 'document.stored'), 'the application stays on the timeline').toBe(true);
      expect(timeline.filter((e) => e.action === 'document.stored').length, 'one stored document is visible').toBe(1);
      expect(timeline.some((e) => e.action === 'document.downloaded')).toBe(false);
      expect(timeline.some((e) => e.detailAction === 'case.judgment.draft')).toBe(false);
    }
  });

  it('shows the panel its draft and the deliberation, never the access records', async () => {
    const timeline = await timelineOf(scenario.users.rapporteur);
    expect(timeline.filter((e) => e.action === 'document.stored').length).toBe(2);
    expect(timeline.some((e) => e.detailAction === 'case.judgment.draft')).toBe(true);
    expect(timeline.some((e) => e.action === 'document.downloaded')).toBe(false);
  });
});

describe('a time limit recorded ELAPSED stays elapsed (P1-S-02)', () => {
  it('reads the stored status, not only the end, and refuses what needs the limit open', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000);
    await sql(
      `INSERT INTO "RuleSet" (id, kind, version, "validFrom", "contentSha256", content)
       VALUES (gen_random_uuid(), 'TIME_LIMITS', 'visibility-test', '2026-01-01', repeat('0', 64), '{}'::jsonb) ON CONFLICT DO NOTHING`,
    );
    const [ruleSet] = await sql<{ id: string }>(`SELECT id FROM "RuleSet" WHERE kind = 'TIME_LIMITS' LIMIT 1`);
    expect(ruleSet).toBeDefined();
    await sql(
      `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", status, computation)
       VALUES (gen_random_uuid(), $1, 'APPEAL', $2, $3, now(), $4, '2099-01-01', 'ELAPSED', '{}'::jsonb)`,
      [scenario.caseFileId, ruleSet?.id, scenario.defendantPartyId, future],
    );
    const snapshot = await caseSnapshot(scenario.caseFileId, new Date());
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(deadlineState(snapshot.deadlines, 'APPEAL', scenario.defendantPartyId, new Date())).toBe('ELAPSED');
    await sql(`UPDATE "CaseFile" SET status = 'JUDGMENT_ISSUED' WHERE id = $1`, [scenario.caseFileId]);
    const issued = await caseSnapshot(scenario.caseFileId, new Date());
    if (!issued) throw new Error('no snapshot');
    const decision = authorize(await subjectOf(scenario.users.defenseLawyer), 'case.appeal.file', { kind: 'case', snapshot: issued }, {
      mode: 'demo',
      demoToolsEnabled: true,
      now: new Date(),
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('«الإجراءات المتاحة» answers whoever acts in the file through a mission (P1-A-03)', () => {
  it('answers the appointed expert, and an expert of another file meets a 404', async () => {
    const res0 = await (await login(scenario.users.expert)).get(`/api/v1/cases/${scenario.caseFileId}/available-actions`);
    expect(res0.status).toBe(404);
    await sql(
      `INSERT INTO "Investigation" (id, "caseFileId", kind, "expertUserId", "createdAt") VALUES (gen_random_uuid(), $1, 'EXPERTISE', $2, now())`,
      [scenario.caseFileId, scenario.users.expert.id],
    );
    const res = await (await login(scenario.users.expert)).get(`/api/v1/cases/${scenario.caseFileId}/available-actions`);
    expect(res.status).toBe(200);
    const snapshot = await caseSnapshot(scenario.caseFileId, new Date());
    if (!snapshot) throw new Error('no snapshot');
    const view = authorize(await subjectOf(scenario.users.expert), 'case.view', { kind: 'case', snapshot }, { mode: 'demo', demoToolsEnabled: true, now: new Date() });
    expect(view.allowed, 'the expert does not open the whole file').toBe(false);
  });
});

describe('a signature circle completes only with its signatures (P1-S-04)', () => {
  it('refuses, even to the owner role, a completion without signatures, a change of signers, a reopening or a deletion', async () => {
    const { id } = await openSignatureCircle({
      documentId: scenario.draftDocumentId,
      purpose: 'JUDGMENT',
      signers: [{ userId: scenario.users.rapporteur.id, roleAssignmentId: scenario.users.rapporteur.roleAssignmentId }],
    });
    await expect(sql(`UPDATE "SignatureCircle" SET status = 'COMPLETED' WHERE id = $1`, [id])).rejects.toThrow();
    await expect(sql(`UPDATE "SignatureCircle" SET signers = '[]'::jsonb WHERE id = $1`, [id])).rejects.toThrow();
    await expect(sql(`DELETE FROM "SignatureCircle" WHERE id = $1`, [id])).rejects.toThrow();
    await sql(`UPDATE "SignatureCircle" SET status = 'VOIDED' WHERE id = $1`, [id]);
    await expect(sql(`UPDATE "SignatureCircle" SET status = 'OPEN' WHERE id = $1`, [id])).rejects.toThrow();
  });
});
