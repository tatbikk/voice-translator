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
// The review of the fix added, before its code: the facts of the investigation
// and of the envelopes read from their rows; a stored fact retracted by a
// declaration (clears); a limit met by the act it awaited (meets) apart from one
// closed; a trigger bounded by the file's registration and the act, a judge's day
// not before the trigger; the calendar of the day of the computation with the
// time-limit table of the trigger's day. The route's side of a declared effect
// that does not hold is in tests/integration/act-effects-route.test.ts.
import { randomUUID } from 'node:crypto';
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
import { applyDeclaredEffects, DeclaredEffectError, type LimitStatement, type LimitStatements } from '@/server/cases/effects';
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

  it('opens a declared limit with its start, its end and the rule version, computed with the time-limit table of its trigger’s day and the calendar known on the day of the computation', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    // A file registered before the trigger: a trigger is bounded by the file's registration.
    await sql(`UPDATE "CaseFile" SET "registeredAt" = $2 WHERE id = $1`, [scenario.caseFileId, moroccoInstant('2026-08-25 09:00')]);
    const trigger = moroccoInstant('2026-09-01 10:00');
    const statement = { partyId: scenario.defendantPartyId, trigger, electronic: true, fixedDate: '2026-09-21' };
    const { events } = await capturingEvents(() =>
      apply(scenario.caseFileId, declaration('case.order.cure-defects'), actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR'), { CURE_DEFECTS: [statement] }),
    );

    // What the engine computes with the time-limit table in force on 1 September 2026 and the
    // calendar of holidays in force when the limit is computed (art. 603: the days the texts in
    // force declare holidays; the latest calendar corrects an estimated date of the earlier one).
    const rules = await timeLimitRules(trigger);
    const calendar = await holidayCalendar(clock.now());
    expect(calendar.version, 'the calendar of the day of the computation, not the trigger’s').not.toBe((await holidayCalendar(trigger)).version);
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
      calendarVersion: calendar.version,
      coversUntil: calendar.coversUntil,
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
        calendarVersion: calendar.version,
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

  it('refuses a trigger later than the act or earlier than the file’s registration, and a judge’s day before the trigger’s: nothing is written', async () => {
    scenario = await caseScenario({ status: 'RAPPORTEUR_ASSIGNED' });
    const rapporteur = actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR');
    const cure = declaration('case.order.cure-defects');
    const now = clock.now();
    const before = await count(`SELECT count(*) FROM "Event" WHERE "caseFileId" = $1`, [scenario.caseFileId]);
    const refused = async (statement: readonly LimitStatement[], reason: RegExp) => {
      const error = await apply(scenario.caseFileId, cure, rapporteur, { CURE_DEFECTS: statement }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DeclaredEffectError);
      expect((error as DeclaredEffectError).reason).toMatch(reason);
    };
    const party = scenario.defendantPartyId;
    // An event that has not happened yet.
    await refused([{ partyId: party, trigger: new Date(now.getTime() + 86_400_000), electronic: true, fixedDate: addDays(moroccoDay(now), 20) }], /^TRIGGER_AFTER_ACT:CURE_DEFECTS$/);
    // An event before the file existed in the register (the file was registered at the scenario's creation).
    await refused([{ partyId: party, trigger: new Date(now.getTime() - 30 * 86_400_000), electronic: true, fixedDate: addDays(moroccoDay(now), 20) }], /^TRIGGER_BEFORE_FILE:CURE_DEFECTS$/);
    // A day fixed by the judge before the day the limit runs from.
    await refused([{ partyId: party, electronic: true, fixedDate: addDays(moroccoDay(now), -1) }], /^FIXED_DATE_BEFORE_TRIGGER:CURE_DEFECTS$/);
    expect(await count(`SELECT count(*) FROM "TimeLimit" WHERE "caseFileId" = $1`, [scenario.caseFileId])).toBe(0);
    expect(await count(`SELECT count(*) FROM "Event" WHERE "caseFileId" = $1`, [scenario.caseFileId])).toBe(before);
  });

  it('stores a declared fact the snapshot derives from nothing, and the snapshot rebuilt after the act reads it', async () => {
    // The table declares few facts yet: the next phases do. The authorization of the other party to
    // deposit (art. 119) is given here its fact, which no column records.
    scenario = await caseScenario({ status: 'IN_EXPERTISE' });
    const other: ProcedureAction = { ...declaration('case.investigation.authorize-other-party'), sets: ['DEPOSIT_OTHER_AUTHORIZED'] };
    const { events } = await capturingEvents(() => apply(scenario.caseFileId, other, actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR')));
    expect(await storedFacts(scenario.caseFileId)).toEqual(['DEPOSIT_OTHER_AUTHORIZED']);
    const after = await snapshotOf(scenario.caseFileId);
    expect(after.facts).toContain('DEPOSIT_OTHER_AUTHORIZED');
    expect(after.status).toBe('IN_EXPERTISE');
    const set = events.find((e) => e.action === 'case.facts.set');
    expect(set).toMatchObject({
      details: { caseFileId: scenario.caseFileId, action: 'case.investigation.authorize-other-party', facts: 'DEPOSIT_OTHER_AUTHORIZED' },
      legalBasis: basisOf('case.investigation.authorize-other-party'),
    });
    // Set once: an act applied again adds nothing twice.
    await apply(scenario.caseFileId, other, actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR'));
    expect(await storedFacts(scenario.caseFileId)).toEqual(['DEPOSIT_OTHER_AUTHORIZED']);
  });

  it('retracts a stored fact the act declares it clears, and the snapshot rebuilt after the act no longer reads it', async () => {
    // A stored fact stops being true only by a declared retraction: the investigation ongoing
    // ends with the expert's report (the next phase declares it), and the file may be declared ready.
    scenario = await caseScenario({ status: 'IN_EXPERTISE' });
    await sql(`UPDATE "CaseFile" SET facts = ARRAY['INVESTIGATION_ONGOING', 'DEPOSIT_OTHER_AUTHORIZED'] WHERE id = $1`, [scenario.caseFileId]);
    const report: ProcedureAction = { ...declaration('case.expert.deposit-report'), clears: ['INVESTIGATION_ONGOING' satisfies CaseFact] };
    const { events } = await capturingEvents(() => apply(scenario.caseFileId, report, actorOf(scenario.users.expert, 'EXPERT')));
    expect(await storedFacts(scenario.caseFileId)).toEqual(['DEPOSIT_OTHER_AUTHORIZED']);
    const after = await snapshotOf(scenario.caseFileId);
    expect(after.facts).not.toContain('INVESTIGATION_ONGOING');
    expect(after.status).toBe('IN_PREPARATION');
    expect(events.find((e) => e.action === 'case.facts.cleared')).toMatchObject({
      details: { caseFileId: scenario.caseFileId, action: 'case.expert.deposit-report', facts: 'INVESTIGATION_ONGOING' },
      legalBasis: basisOf('case.expert.deposit-report'),
    });
  });

  it('fails the act when a derived fact it declares it clears still holds after it, and passes once the executor changed its data', async () => {
    scenario = await caseScenario({ status: 'IN_NOTIFICATION' });
    const envelope = randomUUID();
    await sql(
      `INSERT INTO "Envelope" (id, "caseFileId", "partyId", purpose, channel, status, "createdAt") VALUES ($1, $2, $3, 'SUMMONS', 'BAILIFF', 'READY', now())`,
      [envelope, scenario.caseFileId, scenario.defendantPartyId],
    );
    const dispatch: ProcedureAction = { ...declaration('case.envelopes.dispatch'), clears: ['ENVELOPES_READY'] };
    const clerk = actorOf(scenario.users.registrationClerk, 'CLERK_REGISTRATION');
    await expect(apply(scenario.caseFileId, dispatch, clerk)).rejects.toBeInstanceOf(DeclaredEffectError);
    // The envelope dispatched (what the executor of the next phase writes): nothing to retract by hand.
    await sql(`UPDATE "Envelope" SET status = 'DISPATCHED', "dispatchedAt" = now() WHERE id = $1`, [envelope]);
    await apply(scenario.caseFileId, dispatch, clerk);
    expect((await snapshotOf(scenario.caseFileId)).facts).not.toContain('ENVELOPES_READY');
    expect(await storedFacts(scenario.caseFileId)).toEqual([]);
  });

  it('reads the facts of the investigation from its latest row and «ENVELOPES_READY» from an envelope ready, never from a stored code', async () => {
    scenario = await caseScenario({ status: 'IN_EXPERTISE' });
    const investigationFacts: readonly CaseFact[] = [
      'DEPOSIT_MADE',
      'MISSION_ACCEPTED',
      'MISSION_DECLINED',
      'EXPERT_PARTIES_SUMMONED',
      'REPORT_DEPOSITED',
      'REPORT_RETURNED',
      'FEES_ORDERED',
      'FEES_PAID',
    ];
    await sql(`UPDATE "CaseFile" SET facts = $2::text[] WHERE id = $1`, [scenario.caseFileId, [...investigationFacts, 'ENVELOPES_READY']]);
    const facts = async () => (await snapshotOf(scenario.caseFileId)).facts;
    expect((await facts()).filter((f) => investigationFacts.includes(f) || f === 'ENVELOPES_READY'), 'a stored code of a derived fact is ignored').toEqual([]);

    // An earlier investigation with every column written, and the latest with none: the latest counts.
    const insert = (createdAt: string) =>
      sql<{ id: string }>(
        `INSERT INTO "Investigation" (id, "caseFileId", kind, "expertUserId", "createdAt") VALUES (gen_random_uuid(), $1, 'EXPERTISE', $2, $3::timestamptz) RETURNING id`,
        [scenario.caseFileId, scenario.users.expert.id, createdAt],
      ).then((r) => r[0]!.id);
    const older = await insert('2026-10-01T08:00:00Z');
    await sql(
      `UPDATE "Investigation" SET "depositedAt" = now(), "acceptedAt" = now(), "declinedAt" = now(), "partiesSummonedAt" = now(), "reportDepositedAt" = now(),
         "returnedAt" = now(), "feesOrderedCents" = 100000, "feesPaidAt" = now() WHERE id = $1`,
      [older],
    );
    const latest = await insert('2026-10-15T08:00:00Z');
    expect((await facts()).filter((f) => investigationFacts.includes(f))).toEqual([]);

    const columns: readonly [string, CaseFact][] = [
      ['"depositedAt" = now()', 'DEPOSIT_MADE'],
      ['"acceptedAt" = now()', 'MISSION_ACCEPTED'],
      ['"declinedAt" = now()', 'MISSION_DECLINED'],
      ['"partiesSummonedAt" = now()', 'EXPERT_PARTIES_SUMMONED'],
      ['"reportDepositedAt" = now()', 'REPORT_DEPOSITED'],
      ['"returnedAt" = now()', 'REPORT_RETURNED'],
      ['"feesOrderedCents" = 250000', 'FEES_ORDERED'],
      ['"feesPaidAt" = now()', 'FEES_PAID'],
    ];
    for (const [set, fact] of columns) {
      await sql(`UPDATE "Investigation" SET ${set} WHERE id = $1`, [latest]);
      expect(await facts(), fact).toContain(fact);
    }

    // «ENVELOPES_READY»: an envelope of the file still ready to be sent, and no longer once sent.
    expect(await facts()).not.toContain('ENVELOPES_READY');
    const envelope = randomUUID();
    await sql(
      `INSERT INTO "Envelope" (id, "caseFileId", "partyId", purpose, channel, status, "createdAt") VALUES ($1, $2, $3, 'SUMMONS', 'BAILIFF', 'READY', now())`,
      [envelope, scenario.caseFileId, scenario.defendantPartyId],
    );
    expect(await facts()).toContain('ENVELOPES_READY');
    await sql(`UPDATE "Envelope" SET status = 'DISPATCHED' WHERE id = $1`, [envelope]);
    expect(await facts()).not.toContain('ENVELOPES_READY');
  });

  it('holds a declared fact of the investigation only when the executor wrote its column, and stores nothing', async () => {
    scenario = await caseScenario({ status: 'IN_EXPERTISE' });
    const [investigation] = await sql<{ id: string }>(
      `INSERT INTO "Investigation" (id, "caseFileId", kind, "expertUserId", "depositedAt", "createdAt") VALUES (gen_random_uuid(), $1, 'EXPERTISE', $2, now(), now()) RETURNING id`,
      [scenario.caseFileId, scenario.users.expert.id],
    );
    const accept: ProcedureAction = { ...declaration('case.expert.accept'), sets: ['MISSION_ACCEPTED'] };
    const expertActor = actorOf(scenario.users.expert, 'EXPERT');
    await expect(apply(scenario.caseFileId, accept, expertActor)).rejects.toBeInstanceOf(DeclaredEffectError);
    await sql(`UPDATE "Investigation" SET "acceptedAt" = now() WHERE id = $1`, [investigation!.id]);
    await apply(scenario.caseFileId, accept, expertActor);
    expect((await snapshotOf(scenario.caseFileId)).facts).toContain('MISSION_ACCEPTED');
    expect(await storedFacts(scenario.caseFileId)).toEqual([]);
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
    await sql(`UPDATE "CaseFile" SET facts = ARRAY['HEARING_SET', 'REGISTRATION_STAMPED', 'ENVELOPES_READY', 'DEPOSIT_MADE', 'DEPOSIT_OTHER_AUTHORIZED'] WHERE id = $1`, [
      scenario.caseFileId,
    ]);
    const facts = (await snapshotOf(scenario.caseFileId)).facts;
    expect(facts).toContain('DEPOSIT_OTHER_AUTHORIZED');
    expect(facts).not.toContain('HEARING_SET');
    expect(facts).not.toContain('REGISTRATION_STAMPED');
    expect(facts).not.toContain('ENVELOPES_READY');
    expect(facts).not.toContain('DEPOSIT_MADE');
  });

  it('meets the declared limits still running, apart from those it closes, and leaves an elapsed limit elapsed', async () => {
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
    // No act of the table meets or closes a limit yet; the deposit is given here the limit it meets
    // (the act the limit awaited, done within it: «تم الإجراء داخله»).
    const deposit: ProcedureAction = { ...declaration('case.investigation.deposit'), meets: ['INVESTIGATION_DEPOSIT'] };
    const { events } = await capturingEvents(() => apply(scenario.caseFileId, deposit, actorOf(scenario.users.plaintiffLawyer, 'LAWYER')));
    const status = async (id: string) => one<{ status: string; closedAt: Date | null }>(`SELECT status::text, "closedAt" FROM "TimeLimit" WHERE id = $1`, [id]);
    expect(await status(running)).toMatchObject({ status: 'MET' });
    expect((await status(running)).closedAt).not.toBeNull();
    expect(await status(elapsed)).toEqual({ status: 'RUNNING', closedAt: null });
    expect(await status(other)).toEqual({ status: 'RUNNING', closedAt: null });
    const met = events.filter((e) => e.action === 'case.time-limit.met');
    expect(met.map((e) => e.details)).toEqual([{ caseFileId: scenario.caseFileId, timeLimitId: running, action: 'case.investigation.deposit', ruleCode: 'INVESTIGATION_DEPOSIT' }]);
    expect(met[0]?.legalBasis).toEqual(basisOf('case.investigation.deposit'));
    expect(events.filter((e) => e.action === 'case.time-limit.closed')).toEqual([]);

    // A limit an act ends without meeting it is closed: the investigation abandoned ends the challenge.
    const abandon: ProcedureAction = { ...declaration('case.investigation.abandon'), closes: ['EXPERT_CHALLENGE'] };
    const ended = await capturingEvents(() => apply(scenario.caseFileId, abandon, actorOf(scenario.users.rapporteur, 'JUDGE_RAPPORTEUR')));
    expect(await status(other)).toMatchObject({ status: 'CLOSED' });
    expect(await status(running)).toMatchObject({ status: 'MET' });
    const closed = ended.events.filter((e) => e.action === 'case.time-limit.closed');
    expect(closed.map((e) => e.details)).toEqual([{ caseFileId: scenario.caseFileId, timeLimitId: other, action: 'case.investigation.abandon', ruleCode: 'EXPERT_CHALLENGE' }]);
    expect(closed[0]?.legalBasis).toEqual(basisOf('case.investigation.abandon'));
  });
});
