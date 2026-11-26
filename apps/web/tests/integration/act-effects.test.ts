// Independent review IR-10: what packages/core/src/procedure/transitions.ts
// declares for an act (its next status, the facts it sets, the time limits it
// closes and opens) is applied by one applier, inside the act's transaction,
// after the act's own executor, and verified on the snapshot rebuilt after it
// (decision 73). Written before the code:
//   (a) for every act that has an executor, executed through its route, the
//       state after execution is the declaration's: each declared fact true,
//       the status as declared (unchanged when none is declared);
//   (b) the applier itself, called directly on constructed files, on acts the
//       next phase will execute: a next status (the status changes and the
//       event records it); a time limit opened (a row with its start, end and
//       rule version, computed with the tables in force on the day of its
//       trigger, not today's); a declared fact the snapshot derives from
//       nothing (stored, then read back by the snapshot); a time limit closed;
//       and the refusals: a declared effect that does not hold, a limit opened
//       without what it runs from, a limit the act does not declare;
//   (c) is structural (tests/architecture/act-effects.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTIONS,
  addDays,
  computeTimeLimit,
  moroccoDay,
  moroccoInstant,
  resolveLegalBasis,
  type CaseFact,
  type CaseSnapshot,
  type LegalBasis,
  type ProcedureAction,
} from '@mahkama/core';
import { executableActs } from '@/server/cases/executors';
import { applyDeclaredEffects, DeclaredEffectError, type LimitStatements } from '@/server/cases/effects';
import { caseSnapshot } from '@/server/cases/snapshot';
import { clock } from '@/server/clock';
import { eventTransaction, type EventActor } from '@/server/events/append';
import { forgetRuleCache, holidayCalendar, timeLimitRules } from '@/server/rules/store';
import { PUBLIC_DEFENDANT_CASE, PUBLIC_ESTABLISHMENT, withParties } from '../acceptance/model-case-filing.fixture';
import { login } from '../helpers/auth';
import { caseScenario, type CaseScenario } from '../helpers/cases';
import { capturingEvents, count, one, sql } from '../helpers/db';
import { createCaseFile, createCourt, createUser, theCourt, type TestUser } from '../helpers/factories';
import { fileCase, giveSigningSecret } from '../helpers/filings';
import { describeResponse, type ApiResponse, type Client } from '../helpers/http';
import { useFreshDatabase } from '../helpers/reset';
import { pdfBytes } from '../helpers/samples';
import { loadRuleTables, makeModelCourt } from '../helpers/rules';

useFreshDatabase();

function declaration(code: string): ProcedureAction {
  const procedure = ACTIONS[code]?.procedure;
  if (!procedure) throw new Error(`no procedural act ${code}`);
  return procedure;
}

function basisOf(code: string): LegalBasis {
  const rule = ACTIONS[code];
  if (!rule) throw new Error(`no action ${code}`);
  return resolveLegalBasis(rule);
}

async function snapshotOf(caseFileId: string): Promise<CaseSnapshot> {
  const snapshot = await caseSnapshot(caseFileId, clock.now());
  if (!snapshot) throw new Error('no snapshot');
  return snapshot;
}

const actorOf = (user: TestUser, role: string): EventActor => ({ userId: user.id, roleAssignmentId: user.roleAssignmentId, role, viaDemoSwitch: false });

/** Calls the applier alone, inside a transaction of the event log, as the executor's transaction would. */
async function apply(caseFileId: string, action: ProcedureAction, actor: EventActor, limits?: LimitStatements) {
  const before = await snapshotOf(caseFileId);
  return eventTransaction((tx) => applyDeclaredEffects(tx, { caseFileId, action, before, actor, now: clock.now(), ...(limits ? { limits } : {}) }));
}

const fileStatus = async (caseFileId: string) => (await one<{ status: string }>('SELECT status::text FROM "CaseFile" WHERE id = $1', [caseFileId])).status;
const storedFacts = async (caseFileId: string) => (await one<{ facts: string[] }>('SELECT facts FROM "CaseFile" WHERE id = $1', [caseFileId])).facts;

let lawyerUser: TestUser;
let registryUser: TestUser;
let prosecutorUser: TestUser;
let secret: string;

beforeAll(async () => {
  const court = await theCourt();
  loadRuleTables();
  forgetRuleCache();
  await makeModelCourt(court.id);
  lawyerUser = await createUser({ roles: ['LAWYER'], label: 'plaintiff-lawyer' });
  registryUser = await createUser({ roles: ['CLERK_REGISTRATION'], label: 'registry' });
  prosecutorUser = await createUser({ roles: ['PUBLIC_PROSECUTOR'], label: 'prosecutor' });
  await createUser({ roles: ['COURT_PRESIDENT'], label: 'president' });
  secret = await giveSigningSecret(lawyerUser.id);
}, 120_000);

// ---------------------------------------------------------------------------
// (a) Every act that has an executor does what it declares.

interface ActRun {
  /** the file the act runs on, ready for it */
  readonly file: () => Promise<string>;
  readonly as: () => Promise<Client>;
  readonly run: (client: Client, caseFileId: string) => Promise<ApiResponse>;
}

const upload = (code: string) => (client: Client, caseFileId: string) =>
  client.post(`/api/v1/cases/${caseFileId}/uploads/${code}`, undefined, {
    query: { name: 'piece.pdf' },
    rawBody: Buffer.from(pdfBytes(code)),
    headers: { 'content-type': 'application/octet-stream' },
  });
const json = (code: string, body: Record<string, unknown> = {}) => (client: Client, caseFileId: string) =>
  client.post(`/api/v1/cases/${caseFileId}/actions/${code}`, body);

let registered: Promise<string> | null = null;
/** One registered model case for the three buttons of the registry, run in the table's order. */
const registeredCase = () => (registered ??= login(lawyerUser).then((c) => fileCase(c, secret, { exhibits: 1 })).then((f) => f.caseFileId));

async function administrativeCase(): Promise<{ caseFileId: string; commissioner: TestUser }> {
  const court = await createCourt();
  await sql(`UPDATE "Court" SET specialty = 'ADMINISTRATIVE' WHERE id = $1`, [court.id]);
  const file = await createCaseFile({ courtId: court.id, status: 'REGISTERED' });
  await sql(`UPDATE "CaseFile" SET "referredToCommissionerAt" = now(), "registeredAt" = now() WHERE id = $1`, [file.id]);
  const commissioner = await createUser({ roles: [{ role: 'ROYAL_COMMISSIONER', courtId: court.id }], label: 'commissioner' });
  return { caseFileId: file.id, commissioner };
}
let administrative: Promise<{ caseFileId: string; commissioner: TestUser }> | null = null;

const RUNS: Readonly<Record<string, ActRun>> = {
  'case.registration.reclassify': { file: registeredCase, as: () => login(registryUser), run: json('case.registration.reclassify', { caseType: '8203' }) },
  'case.registration.stamp': { file: registeredCase, as: () => login(registryUser), run: json('case.registration.stamp') },
  'case.registration.note-to-judge': {
    file: registeredCase,
    as: () => login(registryUser),
    run: json('case.registration.note-to-judge', { reason: 'OTHER', text: 'ملاحظة للاختبار.' }),
  },
  'case.prosecution.conclusions': {
    file: async () => (await fileCase(await login(lawyerUser), secret, { card: withParties(PUBLIC_DEFENDANT_CASE, [PUBLIC_ESTABLISHMENT]), exhibits: 1 })).caseFileId,
    as: () => login(prosecutorUser),
    run: upload('case.prosecution.conclusions'),
  },
  'case.commissioner.opinion': {
    file: async () => (await (administrative ??= administrativeCase())).caseFileId,
    as: async () => login((await (administrative ??= administrativeCase())).commissioner),
    run: upload('case.commissioner.opinion'),
  },
};

describe('every act that has an executor does what its declaration says (independent review IR-10)', () => {
  it('has a run for every executable act, and every executable act is a procedural act of the core', () => {
    expect([...executableActs()].sort()).toEqual(Object.keys(RUNS).sort());
    for (const code of executableActs()) expect(ACTIONS[code]?.procedure, code).toBeDefined();
  });

  for (const code of Object.keys(RUNS)) {
    it(`${code}: each declared fact is true and the status is the declared one after execution`, async () => {
      const spec = RUNS[code]!;
      const caseFileId = await spec.file();
      const client = await spec.as();
      const before = await snapshotOf(caseFileId);
      const res = await spec.run(client, caseFileId);
      expect(res.status, describeResponse(res)).toBe(200);
      const after = await snapshotOf(caseFileId);
      const declared = declaration(code);
      expect(after.status).toBe(declared.nextStatus ?? before.status);
      for (const fact of declared.sets) expect(after.facts, fact).toContain(fact);
      for (const limit of declared.opens) expect(after.deadlines.map((d) => d.code), limit).toContain(limit);
    }, 60_000);
  }

  it('records the stamp’s fact through the applier: the moment of the stamp is the act’s, and the effect is in the log', async () => {
    const caseFileId = await registeredCase();
    const row = await one<{ registrationStampedAt: Date | null }>('SELECT "registrationStampedAt" FROM "CaseFile" WHERE id = $1', [caseFileId]);
    expect(row.registrationStampedAt).not.toBeNull();
    const set = await sql<{ details: Record<string, unknown>; legalBasis: unknown }>(
      `SELECT details, "legalBasis" FROM "Event" WHERE action = 'case.facts.set' AND "caseFileId" = $1`,
      [caseFileId],
    );
    expect(set).toEqual([{ details: { caseFileId, action: 'case.registration.stamp', facts: 'REGISTRATION_STAMPED' }, legalBasis: basisOf('case.registration.stamp') }]);
  });
});

// ---------------------------------------------------------------------------
// (b) The applier, called directly, on acts of the next phase.

describe('the applier of what an act declares (independent review IR-10, decision 73)', () => {
  let scenario: CaseScenario;

  it('changes the status to the declared next one, and records it in the log with the act’s basis', async () => {
    scenario = await caseScenario({ status: 'REGISTERED' });
    const president = await createUser({ roles: ['COURT_PRESIDENT'], label: 'president-b' });
    const { events } = await capturingEvents(() => apply(scenario.caseFileId, declaration('case.rapporteur.confirm'), actorOf(president, 'COURT_PRESIDENT')));
    expect(await fileStatus(scenario.caseFileId)).toBe('RAPPORTEUR_ASSIGNED');
    const transition = events.filter((e) => e.action === 'case.transition.recorded');
    expect(transition).toHaveLength(1);
    expect(transition[0]).toMatchObject({
      caseFileId: scenario.caseFileId,
      actorUserId: president.id,
      details: { action: 'case.rapporteur.confirm', fromStatus: 'REGISTERED', toStatus: 'RAPPORTEUR_ASSIGNED' },
      legalBasis: basisOf('case.rapporteur.confirm'),
    });
    expect((await snapshotOf(scenario.caseFileId)).status).toBe('RAPPORTEUR_ASSIGNED');
  });

  it('opens a declared limit with its start, its end and the rule version, computed with the tables in force on the day of its trigger', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    const trigger = moroccoInstant('2026-09-01 10:00');
    const statement = { partyId: scenario.defendantPartyId, trigger, electronic: true, fixedDate: '2026-09-21' };
    const { events } = await capturingEvents(() =>
      apply(scenario.caseFileId, declaration('case.order.cure-defects'), actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR'), { CURE_DEFECTS: [statement] }),
    );

    // What the engine computes with the time-limit table and the calendar in force on 1 September 2026.
    const rules = await timeLimitRules(trigger);
    const calendar = await holidayCalendar(trigger);
    expect(calendar.version, 'the calendar of the trigger’s day, not today’s').toBe('2026-08-23.1');
    const rule = rules.rules.find((r) => r.code === 'CURE_DEFECTS')!;
    const expected = computeTimeLimit({ rule, settings: rules.settings, trigger, electronic: true, calendar, fixedDate: '2026-09-21' });

    const rows = await sql<{ id: string; ruleCode: string; partyId: string | null; startsAt: Date; endsAt: Date; lastDay: string; electronic: boolean; status: string; computation: Record<string, unknown>; version: string }>(
      `SELECT t.id, t."ruleCode", t."partyId", t."startsAt", t."endsAt", t."lastDay", t.electronic, t.status::text, t.computation, s.version
         FROM "TimeLimit" t JOIN "RuleSet" s ON s.id = t."ruleSetId" AND s.kind = 'TIME_LIMITS' WHERE t."caseFileId" = $1`,
      [scenario.caseFileId],
    );
    expect(rows).toHaveLength(1);
    const limit = rows[0]!;
    expect(limit).toMatchObject({
      ruleCode: 'CURE_DEFECTS',
      partyId: scenario.defendantPartyId,
      startsAt: trigger,
      endsAt: expected.endsAt,
      lastDay: expected.lastDay,
      electronic: true,
      version: rules.version,
      status: expected.endsAt.getTime() > clock.now().getTime() ? 'RUNNING' : 'ELAPSED',
    });
    // What the computation relied on is kept with it, as for the seeded limits (review P1-A-09).
    expect(limit.computation).toMatchObject({
      action: 'case.order.cure-defects',
      ruleVersion: rules.version,
      calendarVersion: '2026-08-23.1',
      coversUntil: null,
      articles: expected.articles,
      uncertainties: expected.uncertainties,
      trigger: trigger.toISOString(),
      fixedDate: '2026-09-21',
    });
    expect(limit.computation.steps).toEqual(JSON.parse(JSON.stringify(expected.steps)));

    const opened = events.filter((e) => e.action === 'case.time-limit.opened');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      caseFileId: scenario.caseFileId,
      legalBasis: basisOf('case.order.cure-defects'),
      details: {
        caseFileId: scenario.caseFileId,
        timeLimitId: limit.id,
        action: 'case.order.cure-defects',
        ruleCode: 'CURE_DEFECTS',
        ruleVersion: rules.version,
        calendarVersion: '2026-08-23.1',
        partyId: scenario.defendantPartyId,
        lastDay: expected.lastDay,
        uncertain: expected.uncertainties.length > 0,
      },
    });
    const after = await snapshotOf(scenario.caseFileId);
    expect(after.deadlines).toContainEqual(expect.objectContaining({ code: 'CURE_DEFECTS', partyId: scenario.defendantPartyId, endsAt: expected.endsAt }));
    // An order opens no limit by itself: the status stays.
    expect(after.status).toBe('RAPPORTEUR_ASSIGNED');
  });

  it('counts from the act itself, with today’s tables, when no trigger is given', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    const now = clock.now();
    const fixedDate = addDays(moroccoDay(now), 15);
    await apply(scenario.caseFileId, declaration('case.order.cure-defects'), actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR'), {
      CURE_DEFECTS: [{ partyId: scenario.defendantPartyId, electronic: false, fixedDate }],
    });
    const limit = await one<{ startsAt: Date; status: string; computation: { calendarVersion: string; fixedDate: string } }>(
      `SELECT "startsAt", status::text, computation FROM "TimeLimit" WHERE "caseFileId" = $1`,
      [scenario.caseFileId],
    );
    const calendar = await holidayCalendar(now);
    expect(limit.computation.calendarVersion).toBe(calendar.version);
    expect(limit.computation.fixedDate).toBe(fixedDate);
    expect(Math.abs(limit.startsAt.getTime() - now.getTime())).toBeLessThan(60_000);
    expect(limit.status).toBe('RUNNING');
  });

  it('refuses a declared limit the executor did not state, and a limit the act does not declare: nothing is written', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    const rapporteur = actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR');
    const before = await count(`SELECT count(*) FROM "Event" WHERE "caseFileId" = $1`, [scenario.caseFileId]);
    await expect(apply(scenario.caseFileId, declaration('case.order.cure-defects'), rapporteur)).rejects.toBeInstanceOf(DeclaredEffectError);
    await expect(
      apply(scenario.caseFileId, declaration('case.order.cure-defects'), rapporteur, {
        CURE_DEFECTS: [{ partyId: scenario.defendantPartyId, electronic: true, fixedDate: '2026-12-30' }],
        APPEAL: [{ partyId: scenario.defendantPartyId, electronic: true }],
      }),
    ).rejects.toBeInstanceOf(DeclaredEffectError);
    // A limit against someone who is not a party of the file.
    await expect(
      apply(scenario.caseFileId, declaration('case.order.cure-defects'), rapporteur, {
        CURE_DEFECTS: [{ partyId: scenario.users.rapporteur.id, electronic: true, fixedDate: '2026-12-30' }],
      }),
    ).rejects.toBeInstanceOf(DeclaredEffectError);
    expect(await count(`SELECT count(*) FROM "TimeLimit" WHERE "caseFileId" = $1`, [scenario.caseFileId])).toBe(0);
    expect(await count(`SELECT count(*) FROM "Event" WHERE "caseFileId" = $1`, [scenario.caseFileId])).toBe(before);
  });

  it('stores a declared fact the snapshot derives from nothing, and the snapshot rebuilt after the act reads it', async () => {
    // The table declares no fact for the acts of stations 3 and 4 yet: the next phase does. The
    // summons order is given here the fact of the envelopes it prepares, which nothing derives today.
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    const summons: ProcedureAction = { ...declaration('case.summons.order'), sets: ['ENVELOPES_READY'] };
    const { events } = await capturingEvents(() => apply(scenario.caseFileId, summons, actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR')));
    expect(await storedFacts(scenario.caseFileId)).toEqual(['ENVELOPES_READY']);
    const after = await snapshotOf(scenario.caseFileId);
    expect(after.facts).toContain('ENVELOPES_READY');
    expect(after.status).toBe('IN_NOTIFICATION');
    const set = events.find((e) => e.action === 'case.facts.set');
    expect(set).toMatchObject({ details: { caseFileId: scenario.caseFileId, action: 'case.summons.order', facts: 'ENVELOPES_READY' }, legalBasis: basisOf('case.summons.order') });
    // Set once: an act applied again adds nothing twice.
    await apply(scenario.caseFileId, { ...summons, nextStatus: null }, actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR'));
    expect(await storedFacts(scenario.caseFileId)).toEqual(['ENVELOPES_READY']);
  });

  it('fails the act when a declared fact derived from the file’s data does not hold after it, and stores nothing', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    // «تعيين الجلسة» with no hearing written: HEARING_SET is read from the hearing, never stored.
    const hearing: ProcedureAction = { ...declaration('case.hearing.set'), sets: ['HEARING_SET' satisfies CaseFact] };
    await expect(apply(scenario.caseFileId, hearing, actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR'))).rejects.toBeInstanceOf(DeclaredEffectError);
    expect(await storedFacts(scenario.caseFileId)).toEqual([]);
    expect(await count(`SELECT count(*) FROM "Event" WHERE "caseFileId" = $1 AND action LIKE 'case.%'`, [scenario.caseFileId])).toBe(0);
  });

  it('reads a derived fact from the file’s data only, never from a stored code', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    await sql(`UPDATE "CaseFile" SET facts = ARRAY['HEARING_SET', 'REGISTRATION_STAMPED', 'ENVELOPES_READY'] WHERE id = $1`, [scenario.caseFileId]);
    const facts = (await snapshotOf(scenario.caseFileId)).facts;
    expect(facts).toContain('ENVELOPES_READY');
    expect(facts).not.toContain('HEARING_SET');
    expect(facts).not.toContain('REGISTRATION_STAMPED');
  });

  it('closes the declared limits still running, and leaves an elapsed limit elapsed', async () => {
    scenario = await caseScenario({ status: 'IN_EXPERTISE' });
    const [ruleSet] = await sql<{ id: string }>(`SELECT id FROM "RuleSet" WHERE kind = 'TIME_LIMITS' LIMIT 1`);
    const insert = (code: string, endsIn: string) =>
      sql<{ id: string }>(
        `INSERT INTO "TimeLimit" (id, "caseFileId", "ruleCode", "ruleSetId", "partyId", "startsAt", "endsAt", "lastDay", electronic, status, computation)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now() - interval '20 days', now() + $5::interval, '2099-01-01', true, 'RUNNING', '{}'::jsonb) RETURNING id`,
        [scenario.caseFileId, code, ruleSet?.id, scenario.plaintiffPartyId, endsIn],
      ).then((r) => r[0]!.id);
    const running = await insert('INVESTIGATION_DEPOSIT', '5 days');
    const elapsed = await insert('INVESTIGATION_DEPOSIT', '-2 days');
    const other = await insert('EXPERT_CHALLENGE', '5 days');
    // No act of the table closes a limit yet; the deposit is given here the limit it meets.
    const deposit: ProcedureAction = { ...declaration('case.investigation.deposit'), closes: ['INVESTIGATION_DEPOSIT'] };
    const { events } = await capturingEvents(() => apply(scenario.caseFileId, deposit, actorOf(scenario.users.plaintiffLawyer, 'LAWYER')));
    const status = async (id: string) => one<{ status: string; closedAt: Date | null }>(`SELECT status::text, "closedAt" FROM "TimeLimit" WHERE id = $1`, [id]);
    expect(await status(running)).toMatchObject({ status: 'CLOSED' });
    expect((await status(running)).closedAt).not.toBeNull();
    expect(await status(elapsed)).toEqual({ status: 'RUNNING', closedAt: null });
    expect(await status(other)).toEqual({ status: 'RUNNING', closedAt: null });
    const closed = events.filter((e) => e.action === 'case.time-limit.closed');
    expect(closed.map((e) => e.details)).toEqual([{ caseFileId: scenario.caseFileId, timeLimitId: running, action: 'case.investigation.deposit', ruleCode: 'INVESTIGATION_DEPOSIT' }]);
    expect(closed[0]?.legalBasis).toEqual(basisOf('case.investigation.deposit'));
  });
});
