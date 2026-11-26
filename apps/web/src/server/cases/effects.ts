import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  ACTIONS,
  computeTimeLimit,
  effectViolations,
  type CaseFact,
  type CaseSnapshot,
  type CaseStatus,
  type DeadlineCode,
  type EffectViolation,
  type ProcedureAction,
  type UserSubject,
} from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { appendEvent, type EventActor } from '../events/append';
import { basisOf } from '../events/basis';
import type { ErrorCode } from '../http/responses';
import { asJson } from '../json';
import { holidayCalendar, ruleSetId, timeLimitRules } from '../rules/store';
import { caseSnapshot, DERIVED_CASE_FACTS } from './snapshot';

// The one place that applies what the core's declarative table
// (packages/core/src/procedure/transitions.ts) says an act does (independent
// review IR-10, decision 73): its next status, the facts it sets, the time
// limits it closes and opens. It runs inside the act's transaction, after the
// act's own executor, then rebuilds the snapshot and asks the core whether
// every declared effect holds; if one does not, the transaction fails and
// nothing of the act stays. Every effect is recorded in the event log with the
// act's legal basis (IR-12). The executors of the acts are registered through
// actExecutors() below and run only from here.

type Tx = Prisma.TransactionClient;

/** How a limit the act opens runs, which the table cannot know: the executor states it. */
export interface LimitStatement {
  /** the party the limit runs against; the file when null or not given */
  readonly partyId?: string | null;
  /** the event it runs from (a service, an order…); the act itself when not given */
  readonly trigger?: Date;
  /** whether that event was done electronically (art. 602, last paragraph; art. 639) */
  readonly electronic: boolean;
  /** the day the judge set, for a limit the judge fixes (arts. 6, 77, 124) */
  readonly fixedDate?: string;
}

export type LimitStatements = Partial<Record<DeadlineCode, readonly LimitStatement[]>>;

/** A declaration that cannot be carried out, or an effect that does not hold after the act. */
export class DeclaredEffectError extends Error {
  constructor(
    readonly action: string,
    readonly reason: string,
    readonly violations: readonly EffectViolation[] = [],
  ) {
    super(`declared effects of ${action}: ${reason}${violations.length > 0 ? ` ${JSON.stringify(violations)}` : ''}`);
    this.name = 'DeclaredEffectError';
  }
}

/**
 * The derived facts the applier writes itself: each is read from a column that
 * records the moment it was established (decision 73). The other derived facts
 * are read from rows the act's executor writes (a hearing, a document, a
 * decision, a signature circle): the applier only verifies them.
 */
const MOMENT_COLUMNS = {
  REGISTRATION_STAMPED: 'registrationStampedAt',
  REFERRED_TO_PROSECUTION: 'referredToProsecutionAt',
  REFERRED_TO_COMMISSIONER: 'referredToCommissionerAt',
} as const satisfies Partial<Record<CaseFact, string>>;
type MomentColumn = (typeof MOMENT_COLUMNS)[keyof typeof MOMENT_COLUMNS];
const momentColumn = (fact: CaseFact): MomentColumn | undefined => (MOMENT_COLUMNS as Partial<Record<CaseFact, MomentColumn>>)[fact];

export interface ApplyInput {
  readonly caseFileId: string;
  /** the act's declaration, from the core's table */
  readonly action: ProcedureAction;
  /** the snapshot the act was authorized on, inside its transaction */
  readonly before: CaseSnapshot;
  readonly actor: EventActor | null;
  /** the platform time of the act */
  readonly now: Date;
  readonly limits?: LimitStatements;
}

export interface AppliedEffects {
  readonly status: CaseStatus;
  readonly opened: readonly { readonly id: string; readonly code: DeadlineCode; readonly partyId: string | null }[];
  readonly closed: readonly string[];
}

export async function applyDeclaredEffects(tx: Tx, input: ApplyInput): Promise<AppliedEffects> {
  const { caseFileId, action, before, actor, now } = input;
  const code = action.code;
  const legalBasis = basisOf(code, now, { kind: 'case', snapshot: before });
  const statements = input.limits ?? {};

  // What the executor states is what the table declares, no more, no less.
  for (const limit of Object.keys(statements) as DeadlineCode[]) {
    if (!action.opens.includes(limit)) throw new DeclaredEffectError(code, `LIMIT_NOT_DECLARED:${limit}`);
  }
  for (const limit of action.opens) {
    if ((statements[limit] ?? []).length === 0) throw new DeclaredEffectError(code, `LIMIT_NOT_STATED:${limit}`);
  }
  const parties = new Set(before.parties.map((p) => p.partyId));

  await tx.$queryRaw`SELECT id FROM "CaseFile" WHERE id = ${caseFileId}::uuid FOR UPDATE`;
  const file = await tx.caseFile.findUniqueOrThrow({
    where: { id: caseFileId },
    select: { status: true, facts: true, registrationStampedAt: true, referredToProsecutionAt: true, referredToCommissionerAt: true },
  });

  // 1. The facts and the status. A stored fact is added once; a moment keeps the first one.
  const stored = action.sets.filter((f) => !DERIVED_CASE_FACTS.has(f) && !file.facts.includes(f));
  const moments: Partial<Record<MomentColumn, Date>> = {};
  for (const fact of action.sets) {
    const column = momentColumn(fact);
    if (column && file[column] === null) moments[column] = now;
  }
  const data: Prisma.CaseFileUpdateInput = {
    ...moments,
    ...(stored.length > 0 ? { facts: { set: [...file.facts, ...stored] } } : {}),
    ...(action.nextStatus ? { status: action.nextStatus } : {}),
  };
  if (Object.keys(data).length > 0) await tx.caseFile.update({ where: { id: caseFileId }, data });
  if (action.sets.length > 0) {
    await appendEvent(tx, { action: 'case.facts.set', details: { caseFileId, action: code, facts: action.sets.join(':') }, caseFileId, actor, legalBasis });
  }

  // 2. The limits it closes: those still running; one elapsed stays elapsed.
  const closed: string[] = [];
  for (const limit of action.closes) {
    const running = await tx.timeLimit.findMany({
      where: { caseFileId, ruleCode: limit, status: 'RUNNING', endsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
      select: { id: true },
    });
    for (const row of running) {
      await tx.timeLimit.update({ where: { id: row.id }, data: { status: 'CLOSED', closedAt: now } });
      await appendEvent(tx, { action: 'case.time-limit.closed', details: { caseFileId, timeLimitId: row.id, action: code, ruleCode: limit }, caseFileId, actor, legalBasis });
      closed.push(row.id);
    }
  }

  // 3. The limits it opens, each computed by the core's engine with the time-limit table and
  // the calendar in force on the day of its trigger, and kept with what the computation relied on.
  const opened: { id: string; code: DeadlineCode; partyId: string | null }[] = [];
  for (const limit of action.opens) {
    for (const statement of statements[limit] ?? []) {
      const partyId = statement.partyId ?? null;
      if (partyId !== null && !parties.has(partyId)) throw new DeclaredEffectError(code, `NOT_A_PARTY:${limit}`);
      const trigger = statement.trigger ?? now;
      const rules = await timeLimitRules(trigger);
      const rule = rules.rules.find((r) => r.code === limit);
      if (!rule) throw new DeclaredEffectError(code, `NO_RULE:${limit}`);
      if ((rule.fixedByJudge === true) !== (statement.fixedDate !== undefined)) throw new DeclaredEffectError(code, `FIXED_DATE:${limit}`);
      const calendar = await holidayCalendar(trigger);
      const result = computeTimeLimit({
        rule,
        settings: rules.settings,
        trigger,
        electronic: statement.electronic,
        calendar,
        ...(statement.fixedDate !== undefined ? { fixedDate: statement.fixedDate } : {}),
      });
      const id = randomUUID();
      await tx.timeLimit.create({
        data: {
          id,
          caseFileId,
          ruleCode: limit,
          ruleSetId: await ruleSetId('TIME_LIMITS', rules.version),
          partyId,
          startsAt: result.startsAt,
          endsAt: result.endsAt,
          lastDay: result.lastDay,
          electronic: statement.electronic,
          status: result.endsAt.getTime() > now.getTime() ? 'RUNNING' : 'ELAPSED',
          // As the seeded limits (review P1-A-09), with the act and the trigger it was computed from.
          computation: asJson({
            action: code,
            trigger: trigger.toISOString(),
            fixedDate: statement.fixedDate ?? null,
            steps: result.steps,
            articles: result.articles,
            ruleVersion: rules.version,
            calendarVersion: calendar.version,
            coversUntil: calendar.coversUntil,
            uncertainties: result.uncertainties,
          }),
        },
      });
      await appendEvent(tx, {
        action: 'case.time-limit.opened',
        details: {
          caseFileId,
          timeLimitId: id,
          action: code,
          ruleCode: limit,
          ruleVersion: rules.version,
          calendarVersion: calendar.version,
          partyId,
          lastDay: result.lastDay,
          uncertain: result.uncertainties.length > 0,
        },
        caseFileId,
        actor,
        legalBasis,
      });
      opened.push({ id, code: limit, partyId });
    }
  }

  // 4. The status, recorded with the act it follows.
  if (action.nextStatus) {
    await appendEvent(tx, { action: 'case.transition.recorded', details: { action: code, fromStatus: file.status, toStatus: action.nextStatus }, caseFileId, actor, legalBasis });
  }

  // 5. Every declared effect holds in the snapshot rebuilt after the act, or nothing of it stays.
  const after = await caseSnapshot(caseFileId, now, { db: tx });
  if (!after) throw new DeclaredEffectError(code, 'NO_FILE');
  const violations = effectViolations(action, before, after, opened, now);
  if (violations.length > 0) throw new DeclaredEffectError(code, 'NOT_HELD', violations);
  return { status: after.status, opened, closed };
}

// ---------------------------------------------------------------------------
// The registry of the executors of the acts.

/** What an act receives: a JSON body, or the bytes of a document and its query. */
export interface ExecutorInput {
  readonly body: unknown;
  readonly bytes: Uint8Array | null;
  readonly query: Readonly<Record<string, string>>;
}

export interface Prepared<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Invalid {
  readonly ok: false;
  readonly status: number;
  readonly code: ErrorCode;
  readonly reason: string;
}

export interface ActContext<T> {
  readonly tx: Tx;
  readonly caseFileId: string;
  /** the snapshot the act was authorized on, inside its transaction */
  readonly snapshot: CaseSnapshot;
  readonly subject: UserSubject;
  readonly actor: EventActor;
  readonly now: Date;
  readonly value: T;
}

export interface ActResult {
  /** what the route answers */
  readonly data: Record<string, unknown>;
  /** how each limit the table declares the act opens runs */
  readonly limits?: LimitStatements;
}

/** The executor of an act: what is particular to it. What the table declares is the applier's. */
export interface ActExecutor<T> {
  readonly input: 'json' | 'upload';
  /** validation outside the transaction; an upload's bytes are stored here, under a generated key */
  prepare(input: ExecutorInput, caseFileId: string, now: Date): Promise<Prepared<T> | Invalid>;
  run(context: ActContext<T>): Promise<ActResult>;
}

export interface ActRegistry {
  /** the acts that have an executor */
  codes(): readonly string[];
  kind(code: string): 'json' | 'upload' | null;
  prepare(code: string, input: ExecutorInput, caseFileId: string, now: Date): Promise<Prepared<unknown> | Invalid>;
  /** the act's executor, then what the table declares for it, in the act's transaction */
  execute(code: string, context: ActContext<unknown>): Promise<Record<string, unknown>>;
}

/** The only way to register the executors of the acts: each must be a state-changing act of a file in the core's table. */
export function actExecutors(entries: Readonly<Record<string, ActExecutor<never>>>): ActRegistry {
  const table = new Map<string, { readonly executor: ActExecutor<unknown>; readonly action: ProcedureAction }>();
  for (const [code, executor] of Object.entries(entries)) {
    const action = ACTIONS[code]?.procedure;
    if (!action || action.resource !== 'case' || !action.changesState) throw new Error(`executor: ${code} is not a procedural act on a file`);
    table.set(code, { executor, action });
  }
  const entry = (code: string) => {
    const found = table.get(code);
    if (!found) throw new Error(`executor: no executor for ${code}`);
    return found;
  };
  return {
    codes: () => [...table.keys()],
    kind: (code) => table.get(code)?.executor.input ?? null,
    prepare: (code, input, caseFileId, now) => entry(code).executor.prepare(input, caseFileId, now),
    async execute(code, context) {
      const { executor, action } = entry(code);
      const result = await executor.run(context);
      await applyDeclaredEffects(context.tx, {
        caseFileId: context.caseFileId,
        action,
        before: context.snapshot,
        actor: context.actor,
        now: context.now,
        ...(result.limits ? { limits: result.limits } : {}),
      });
      return result.data;
    },
  };
}
