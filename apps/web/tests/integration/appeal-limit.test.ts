// Independent review IR-18, Phase 1 memo row 4: «الطعن بالاستئناف» is offered
// while its time limit runs and refused once it has run out, by the platform's
// own clock. A judgment pronounced and served on both parties, the appeal limit
// of each computed by the engine from the table in force (art. 204 and 602),
// and the platform clock advanced to just before the end of the limit, then
// just past it: the act is in «الإجراءات المتاحة» of counsel of either party
// and passes the core's check on the action route before, and is absent and
// refused after, the refusal logged and caused by the appeal limit alone (the
// review of the fix). A party marked served without a limit row is not cut off:
// the gap is recorded in findings.md for stations 9 and 10.
import { beforeAll, describe, expect, it } from 'vitest';
import { authorize, computeTimeLimit, deadlineState, type CaseSnapshot, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { clock } from '@/server/clock';
import { getEnv } from '@/server/config/env';
import { holidayCalendar, ruleSetId, timeLimitRules } from '@/server/rules/store';
import { login } from '../helpers/auth';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { capturingEvents, one, sql } from '../helpers/db';
import type { TestUser } from '../helpers/factories';
import { describeResponse, type Client } from '../helpers/http';
import { forgetAppClockCache, useFreshDatabase } from '../helpers/reset';
import { loadRuleTables } from '../helpers/rules';

useFreshDatabase();

let scenario: CaseScenario;
let endsAt: Date;
let defense: Client;
let plaintiffCounsel: Client;

/** Advances the platform clock so that platform time is `at` now (it never moves back; the next file recreates the schema). */
async function platformTimeAt(at: Date): Promise<void> {
  const offsetSeconds = Math.round((at.getTime() - Date.now()) / 1000);
  await sql(`UPDATE "PlatformClock" SET "offsetSeconds" = $1, "updatedAt" = now() WHERE id = 1`, [offsetSeconds]);
  await forgetAppClockCache();
  await clock.refresh();
}

const actionsOf = async (client: Client) => {
  const res = await client.get<{ actions: { code: string }[] }>(`/api/v1/cases/${scenario.caseFileId}/available-actions`);
  expect(res.status, describeResponse(res)).toBe(200);
  return res.data!.actions.map((a) => a.code);
};
const actions = () => actionsOf(defense);
const appeal = (client: Client = defense) => capturingEvents(() => client.post(`/api/v1/cases/${scenario.caseFileId}/actions/case.appeal.file`, {}));

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

/** The core's own decision on the file as the platform reads it now. */
async function coreDecision(user: TestUser, snapshot?: CaseSnapshot) {
  const read = snapshot ?? (await caseSnapshot(scenario.caseFileId, clock.now()));
  if (!read) throw new Error('no snapshot');
  const env = getEnv();
  return authorize(await subjectOf(user), 'case.appeal.file', { kind: 'case', snapshot: read }, { mode: env.mode, demoToolsEnabled: env.demoToolsEnabled, now: clock.now() });
}

/** The appeal limit of a party, from its service, by the table in force. */
async function appealLimit(partyId: string, servedAt: Date): Promise<Date> {
  const rules = await timeLimitRules(servedAt);
  const rule = rules.rules.find((r) => r.code === 'APPEAL');
  if (!rule) throw new Error('no APPEAL rule in force');
  const calendar = await holidayCalendar(servedAt);
  const result = computeTimeLimit({ rule, settings: rules.settings, trigger: servedAt, electronic: false, calendar });
  await sql(
    `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", status, computation)
     VALUES (gen_random_uuid(), $1, 'APPEAL', $2, $3, $4, $5, $6, 'RUNNING', $7::jsonb)`,
    [
      scenario.caseFileId,
      await ruleSetId('TIME_LIMITS', rules.version),
      partyId,
      result.startsAt,
      result.endsAt,
      result.lastDay,
      JSON.stringify({ steps: result.steps, articles: result.articles, uncertainties: result.uncertainties }),
    ],
  );
  return result.endsAt;
}

beforeAll(async () => {
  loadRuleTables();
  scenario = await caseScenario({ status: 'JUDGMENT_ISSUED' });
  const servedAt = new Date(Date.now() - 86_400_000);
  // The judgment, pronounced, and served on both parties (station 9).
  await sql(
    `INSERT INTO "Decision" (id, "caseFileId", kind, "subjectCode", "issuedAt", "pronouncedAt")
     VALUES (gen_random_uuid(), $1, 'JUDGMENT', 'MERITS', $2, $2)`,
    [scenario.caseFileId, new Date(servedAt.getTime() - 7 * 86_400_000)],
  );
  await sql(`UPDATE "CaseParty" SET facts = array_append(facts, 'JUDGMENT_SERVED') WHERE "caseFileId" = $1`, [scenario.caseFileId]);
  // The appeal limit of each party, from the same service.
  endsAt = await appealLimit(scenario.defendantPartyId, servedAt);
  expect(await appealLimit(scenario.plaintiffPartyId, servedAt)).toEqual(endsAt);
  defense = await login(scenario.users.defenseLawyer);
  plaintiffCounsel = await login(scenario.users.plaintiffLawyer);
}, 120_000);

describe('the appeal while its time limit runs, and after it (IR-18, Phase 1 memo row 4)', () => {
  it('offers «الطعن بالاستئناف» to counsel of each served party while the limit runs, and the core lets it through', async () => {
    expect(endsAt.getTime() - Date.now(), 'the limit ends in about thirty days').toBeGreaterThan(25 * 86_400_000);
    expect(await actions()).toContain('case.appeal.file');
    // A minute before the end of the limit, still.
    await platformTimeAt(new Date(endsAt.getTime() - 60_000));
    for (const client of [defense, plaintiffCounsel]) {
      expect(await actionsOf(client)).toContain('case.appeal.file');
      const { result, events } = await appeal(client);
      // Past every check of the route and of the core: the act is filed through its own screen (decision 46).
      expect({ status: result.status, code: result.code }, describeResponse(result)).toEqual({ status: 409, code: 'ACTION_NOT_EXECUTABLE_HERE' });
      expect(events.filter((e) => e.action === 'access.denied' || e.action === 'case.action.refused')).toEqual([]);
    }
    expect((await coreDecision(scenario.users.defenseLawyer)).allowed).toBe(true);
  });

  it('withdraws «الطعن بالاستئناف» from counsel of each party once the platform clock has passed the end of the limit, and refuses the act at authorization with the refusal logged', async () => {
    await platformTimeAt(new Date(endsAt.getTime() + 60_000));
    for (const client of [defense, plaintiffCounsel]) {
      expect(await actionsOf(client)).not.toContain('case.appeal.file');
      const { result, events } = await appeal(client);
      expect({ status: result.status, code: result.code }, describeResponse(result)).toEqual({ status: 403, code: 'FORBIDDEN' });
      // One refusal, at the authorization step, on the action route: nothing reached the executor.
      expect(events.map((e) => ({ action: e.action, step: e.details.step, reason: e.details.reason, target: e.details.target }))).toEqual([
        { action: 'access.denied', step: 'AUTHZ', reason: 'FORBIDDEN', target: 'cases.action' },
      ]);
    }
  });

  it('refuses for the appeal limit and for nothing else: the same file with that limit still running is allowed (review of the fix of IR-18)', async () => {
    const snapshot = await caseSnapshot(scenario.caseFileId, clock.now());
    if (!snapshot) throw new Error('no snapshot');
    expect(await coreDecision(scenario.users.defenseLawyer, snapshot)).toEqual({ allowed: false, reason: 'CONDITION_NOT_MET' });
    expect(deadlineState(snapshot.deadlines, 'APPEAL', scenario.defendantPartyId, clock.now()), 'the appeal limit has run out').toBe('ELAPSED');
    // The defendant's appeal limit moved past now, and nothing else: the act is allowed again.
    const running = {
      ...snapshot,
      deadlines: snapshot.deadlines.map((d) =>
        d.code === 'APPEAL' && d.partyId === scenario.defendantPartyId ? { ...d, endsAt: new Date(clock.now().getTime() + 86_400_000) } : d,
      ),
    };
    expect((await coreDecision(scenario.users.defenseLawyer, running)).allowed).toBe(true);
  });

  it('keeps «الطعن بالاستئناف» for a party marked served without an appeal limit row: the open gap of stations 9 and 10 (findings.md)', async () => {
    // Data the platform does not write (service opens the limit), but that old or hand-made data may hold:
    // the condition «not elapsed» holds for a limit that is absent, as before any service.
    await sql(`DELETE FROM "TimeLimit" WHERE "caseFileId" = $1 AND "partyId" = $2 AND "ruleCode" = 'APPEAL'`, [scenario.caseFileId, scenario.plaintiffPartyId]);
    expect(await actionsOf(plaintiffCounsel)).toContain('case.appeal.file');
    expect(await actions(), 'the served party whose limit has run out stays cut off').not.toContain('case.appeal.file');
  });
});
