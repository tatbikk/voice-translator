// Reviews P1-A-08 and P1-A-09: a time limit says what its computation relied
// on that is not settled (estimated religious holidays, the weekend setting,
// the electronic counting, the horizon of the holiday table), this is stored
// with the limit, and the case page reads «قيمة مؤقتة غير مؤكدة» from it, not
// from the rule table in force on the day it is shown.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeTimeLimit, moroccoInstant, type UserSubject } from '@mahkama/core';
import { caseSnapshot } from '@/server/cases/snapshot';
import { caseView } from '@/server/cases/view';
import { forgetRuleCache, holidayCalendar, timeLimitRules } from '@/server/rules/store';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { expectSuccess, runProcess } from '../helpers/cli';
import { sql } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

useFreshDatabase();

let scenario: CaseScenario;

async function rapporteur(): Promise<UserSubject> {
  const user = scenario.users.rapporteur;
  const [row] = await sql<{ courtId: string | null; panelId: string | null }>(`SELECT "courtId", "panelId" FROM "RoleAssignment" WHERE id = $1`, [user.roleAssignmentId]);
  return {
    kind: 'user',
    userId: user.id,
    role: 'JUDGE_RAPPORTEUR',
    roleAssignmentId: user.roleAssignmentId,
    courtId: row?.courtId ?? null,
    panelId: row?.panelId ?? null,
    organizationId: null,
    isDemoAccount: false,
    roleCount: 1,
    verificationStatus: 'VERIFIED_SIMULATED',
  };
}

beforeAll(async () => {
  scenario = await caseScenario({ status: 'IN_PREPARATION' });
  expectSuccess('load-rules', runProcess(process.execPath, [join('dist-server', 'load-rules.mjs')]));
  forgetRuleCache();
});

describe('the flag of a stored time limit (review P1-A-09)', () => {
  it('is read from what the computation recorded, not from the table in force today', async () => {
    const [ruleSet] = await sql<{ id: string }>(`SELECT id FROM "RuleSet" WHERE kind = 'TIME_LIMITS' LIMIT 1`);
    const stored = {
      settled: { electronic: true, computation: { steps: [], articles: [204, 602], uncertainties: [] } },
      weekend: { electronic: false, computation: { steps: [], articles: [204, 602], uncertainties: [{ kind: 'WEEKEND', days: ['2027-04-03'] }] } },
      beyond: {
        electronic: false,
        computation: { steps: [], articles: [204, 602], uncertainties: [{ kind: 'BEYOND_CALENDAR', coversUntil: '2027-12-31', days: ['2028-01-10'] }] },
      },
      unrecorded: { electronic: false, computation: { steps: [], articles: [204, 602], ruleVersion: '2026-08-23.1' } },
    };
    const ids: Record<string, string> = {};
    for (const [name, limit] of Object.entries(stored)) {
      const [row] = await sql<{ id: string }>(
        `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", electronic, status, computation)
         VALUES (gen_random_uuid(), $1, 'APPEAL', $2, $3, now(), now() + interval '30 days', '2099-01-01', $4, 'RUNNING', $5::jsonb) RETURNING id`,
        [scenario.caseFileId, ruleSet?.id, scenario.defendantPartyId, limit.electronic, JSON.stringify(limit.computation)],
      );
      ids[name] = row?.id ?? '';
    }
    const snapshot = await caseSnapshot(scenario.caseFileId, new Date());
    if (!snapshot) throw new Error('no snapshot');
    const view = await caseView(scenario.caseFileId, await rapporteur(), snapshot);
    const flag = (name: string) => view?.deadlines.find((d) => d.id === ids[name])?.uncertain;
    // An electronic limit whose computation relied on nothing unsettled is not flagged,
    // although the table in force marks the electronic counting uncertain.
    expect(flag('settled')).toBe(false);
    expect(flag('weekend')).toBe(true);
    expect(flag('beyond')).toBe(true);
    // A limit stored without what it relied on is shown uncertain.
    expect(flag('unrecorded')).toBe(true);
  });
});

describe('the calendar the platform computes with (review P1-A-08)', () => {
  it('carries the version in force, its estimated holidays and its horizon, read from the database', async () => {
    const calendar = await holidayCalendar(moroccoInstant('2027-03-01 10:00'));
    expect(calendar.version).toBe('2026-11-25.1');
    expect(calendar.coversUntil).toBe('2027-12-31');
    expect(calendar.uncertainDates).toContain('2027-03-10');
    expect(calendar.weekendDays).toEqual([6, 0]);
    // Before the horizon was declared, the earlier version applies, and declares none.
    const earlier = await holidayCalendar(moroccoInstant('2026-09-01 10:00'));
    expect(earlier.version).toBe('2026-08-23.1');
    expect(earlier.coversUntil).toBeNull();
  });

  it('flags a limit that ends past the horizon, and one that ends next to an estimated holiday', async () => {
    const at = moroccoInstant('2027-03-01 10:00');
    const rules = await timeLimitRules(at);
    const calendar = await holidayCalendar(at);
    const appeal = rules.rules.find((r) => r.code === 'APPEAL');
    const declaration = rules.rules.find((r) => r.code === 'GARNISHEE_DECLARATION');
    if (!appeal || !declaration) throw new Error('rules missing');
    const late = computeTimeLimit({ rule: appeal, settings: rules.settings, trigger: moroccoInstant('2027-12-10 10:00'), electronic: false, calendar });
    expect(late.lastDay).toBe('2028-01-10');
    expect(late.uncertainties.map((u) => u.kind)).toEqual(['BEYOND_CALENDAR']);
    const eid = computeTimeLimit({ rule: declaration, settings: rules.settings, trigger: moroccoInstant('2027-03-01 10:00'), electronic: false, calendar });
    expect(eid.lastDay).toBe('2027-03-12');
    expect(eid.uncertainties.map((u) => u.kind)).toEqual(['ESTIMATED_HOLIDAY']);
  });
});
