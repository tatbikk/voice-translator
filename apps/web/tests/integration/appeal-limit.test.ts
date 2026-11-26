// Independent review IR-18, Phase 1 memo row 4: «الطعن بالاستئناف» is offered
// while its time limit runs and refused once it has run out, by the platform's
// own clock. A judgment pronounced and served on the defendant, its appeal
// limit computed by the engine from the table in force (art. 204 and 602), and
// the platform clock advanced to just before the end of the limit, then just
// past it: the act is in «الإجراءات المتاحة» and passes the core's check on the
// action route before, and is absent and refused, with the refusal logged, after.
import { beforeAll, describe, expect, it } from 'vitest';
import { computeTimeLimit } from '@mahkama/core';
import { clock } from '@/server/clock';
import { holidayCalendar, ruleSetId, timeLimitRules } from '@/server/rules/store';
import { login } from '../helpers/auth';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { capturingEvents, sql } from '../helpers/db';
import { describeResponse, type Client } from '../helpers/http';
import { forgetAppClockCache, useFreshDatabase } from '../helpers/reset';
import { loadRuleTables } from '../helpers/rules';

useFreshDatabase();

let scenario: CaseScenario;
let endsAt: Date;
let defense: Client;

/** Advances the platform clock so that platform time is `at` now (it never moves back; the next file recreates the schema). */
async function platformTimeAt(at: Date): Promise<void> {
  const offsetSeconds = Math.round((at.getTime() - Date.now()) / 1000);
  await sql(`UPDATE "PlatformClock" SET "offsetSeconds" = $1, "updatedAt" = now() WHERE id = 1`, [offsetSeconds]);
  await forgetAppClockCache();
  await clock.refresh();
}

const actions = async () => {
  const res = await defense.get<{ actions: { code: string }[] }>(`/api/v1/cases/${scenario.caseFileId}/available-actions`);
  expect(res.status, describeResponse(res)).toBe(200);
  return res.data!.actions.map((a) => a.code);
};
const appeal = () => capturingEvents(() => defense.post(`/api/v1/cases/${scenario.caseFileId}/actions/case.appeal.file`, {}));

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
  // The appeal limit of the defendant, from its service, by the table in force.
  const rules = await timeLimitRules(servedAt);
  const rule = rules.rules.find((r) => r.code === 'APPEAL');
  if (!rule) throw new Error('no APPEAL rule in force');
  const calendar = await holidayCalendar(servedAt);
  const result = computeTimeLimit({ rule, settings: rules.settings, trigger: servedAt, electronic: false, calendar });
  endsAt = result.endsAt;
  await sql(
    `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", status, computation)
     VALUES (gen_random_uuid(), $1, 'APPEAL', $2, $3, $4, $5, $6, 'RUNNING', $7::jsonb)`,
    [
      scenario.caseFileId,
      await ruleSetId('TIME_LIMITS', rules.version),
      scenario.defendantPartyId,
      result.startsAt,
      result.endsAt,
      result.lastDay,
      JSON.stringify({ steps: result.steps, articles: result.articles, uncertainties: result.uncertainties }),
    ],
  );
  defense = await login(scenario.users.defenseLawyer);
}, 120_000);

describe('the appeal while its time limit runs, and after it (IR-18, Phase 1 memo row 4)', () => {
  it('offers «الطعن بالاستئناف» to counsel of the served party while the limit runs, and the core lets it through', async () => {
    expect(endsAt.getTime() - Date.now(), 'the limit ends in about thirty days').toBeGreaterThan(25 * 86_400_000);
    expect(await actions()).toContain('case.appeal.file');
    // A minute before the end of the limit, still.
    await platformTimeAt(new Date(endsAt.getTime() - 60_000));
    expect(await actions()).toContain('case.appeal.file');
    const { result, events } = await appeal();
    // Past every check of the route and of the core: the act is filed through its own screen (decision 46).
    expect({ status: result.status, code: result.code }, describeResponse(result)).toEqual({ status: 409, code: 'ACTION_NOT_EXECUTABLE_HERE' });
    expect(events.filter((e) => e.action === 'access.denied' || e.action === 'case.action.refused')).toEqual([]);
  });

  it('withdraws «الطعن بالاستئناف» once the platform clock has passed the end of the limit, and refuses the act with the refusal logged', async () => {
    await platformTimeAt(new Date(endsAt.getTime() + 60_000));
    expect(await actions()).not.toContain('case.appeal.file');
    const { result, events } = await appeal();
    expect({ status: result.status, code: result.code }, describeResponse(result)).toEqual({ status: 403, code: 'FORBIDDEN' });
    const refused = events.filter((e) => e.action === 'access.denied' || e.action === 'case.action.refused');
    expect(refused.length, 'the refusal is logged').toBeGreaterThan(0);
    expect(events.filter((e) => e.action === 'case.action.not-executed')).toEqual([]);
  });
});
