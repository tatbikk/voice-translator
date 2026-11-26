// Review of the IR-10 fix (decision 73, fifth): a declared effect that does not
// hold after an act run through its route fails the whole act. The route answers
// 500 (a fault of the platform: the declaration and the executor disagree, not
// the user), the failure is recorded (case.action.refused, EFFECT_NOT_HELD), and
// nothing the executor wrote stays: no corrected code, no referral, no event of
// the act, no notification. For this file only, the core's table gives «تصحيح
// التصنيف» a fact it cannot make true (a hearing set, read from a hearing it
// never writes); the authorization still reads the real table.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { login } from '../helpers/auth';
import { capturingEvents, count, one } from '../helpers/db';
import { createUser, theCourt, type TestUser } from '../helpers/factories';
import { fileCase, giveSigningSecret } from '../helpers/filings';
import { describeResponse } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

vi.mock('@mahkama/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@mahkama/core')>();
  const rule = core.ACTIONS['case.registration.reclassify'];
  if (!rule?.procedure) throw new Error('no declaration of case.registration.reclassify');
  return {
    ...core,
    ACTIONS: { ...core.ACTIONS, 'case.registration.reclassify': { ...rule, procedure: { ...rule.procedure, sets: ['HEARING_SET'] } } },
  };
});

useFreshDatabase();

let lawyerUser: TestUser;
let registryUser: TestUser;
let secret: string;

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  await makeModelCourt(court.id);
  lawyerUser = await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' });
  registryUser = await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' });
  await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' });
  secret = await giveSigningSecret(lawyerUser.id);
}, 120_000);

describe('a declared effect that does not hold, through the route (review of the IR-10 fix)', () => {
  it('answers 500, records the failure, and leaves nothing of what the executor wrote', async () => {
    const { caseFileId } = await fileCase(await login(lawyerUser), secret, { exhibits: 1 });
    const file = () =>
      one<{ caseType: string | null; code: number; classificationCorrectedAt: Date | null }>(
        `SELECT "caseType", code, "classificationCorrectedAt" FROM "CaseFile" WHERE id = $1`,
        [caseFileId],
      );
    const before = await file();
    const referrals = await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1`, [caseFileId]);
    const notifications = await count(`SELECT count(*) FROM "Notification" WHERE "caseFileId" = $1`, [caseFileId]);

    const registry = await login(registryUser);
    const { result, events } = await capturingEvents(() => registry.post(`/api/v1/cases/${caseFileId}/actions/case.registration.reclassify`, { caseType: '8203' }));
    expect(result.status, describeResponse(result)).toBe(500);
    expect(result.code).toBe('INTERNAL');

    // The failure is recorded, and it is the only trace of the act.
    const ofTheFile = events.filter((e) => e.caseFileId === caseFileId);
    expect(ofTheFile.map((e) => ({ action: e.action, outcome: e.outcome, details: e.details }))).toEqual([
      { action: 'case.action.refused', outcome: 'DENIED', details: { caseFileId, action: 'case.registration.reclassify', reason: 'EFFECT_NOT_HELD' } },
    ]);
    expect(events.map((e) => e.action)).not.toContain('case.registration.reclassified');
    expect(events.map((e) => e.action)).not.toContain('case.referrals.reviewed');

    // What the executor wrote before the applier failed is rolled back with it.
    expect(await file()).toEqual(before);
    expect(before.classificationCorrectedAt).toBeNull();
    expect(await count(`SELECT count(*) FROM "CaseReferral" WHERE "caseFileId" = $1`, [caseFileId])).toBe(referrals);
    expect(await count(`SELECT count(*) FROM "Notification" WHERE "caseFileId" = $1`, [caseFileId])).toBe(notifications);
  }, 120_000);
});
