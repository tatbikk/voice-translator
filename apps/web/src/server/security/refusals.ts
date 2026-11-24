import 'server-only';
import { SECURITY_POLICY, type EventAction } from '@mahkama/core';
import { appendEvent, appendStandaloneEvent, eventTransaction, type AppendInput, type EventActor } from '../events/append';
import { clock } from '../clock';
import { getDb } from '../db';
import { log, errorFields } from '../log';
import { consume, recordHit } from './rate-limit';

// Every refusal is written to the event log, individually, up to a known limit
// per session, or per client and for all clients together when there is no
// session. Beyond it the request is still refused, and the suppressed refusals
// are counted; the worker writes one summary event (access.throttled) per
// session, client or (past the global ceiling) for everyone, and minute,
// carrying the number of suppressed refusals. The log cannot be flooded, from
// one address or from many, and the fact that refusals happened is kept
// (decision 3; reviews S-02 and A-07).

export type RefusalStep = 'GATE' | 'MODE' | 'CSRF' | 'SESSION' | 'RATE' | 'PARAMS' | 'AUTHZ' | 'REAUTH' | 'BODY' | 'METHOD';

export interface RefusalInput {
  readonly step: RefusalStep;
  readonly reason: string;
  /** endpoint or page identifier */
  readonly target: string;
  readonly clientIdHash: string;
  readonly sessionId: string | null;
  readonly actor: EventActor | null;
}

const SUPPRESSED_PREFIX = 'refusal-suppressed';

function windowStart(at: Date): string {
  const minute = Math.floor(at.getTime() / 60_000) * 60_000;
  return new Date(minute).toISOString();
}

export interface BudgetOwner {
  readonly clientIdHash: string;
  readonly sessionId: string | null;
}

/** Whether one more refusal may be written individually; otherwise it is counted. */
async function refusalBudget(owner: BudgetOwner): Promise<boolean> {
  const window = windowStart(clock.systemNow());
  if (owner.sessionId) {
    const { limited } = await consume(`refusal:session:${owner.sessionId}`, SECURITY_POLICY.refusals.authenticatedPerSession);
    if (limited) await recordHit(`${SUPPRESSED_PREFIX}|session|${owner.sessionId}|${window}`);
    return !limited;
  }
  // The global ceiling comes first: past it, a single summary for every client,
  // so that many addresses cannot multiply the summaries either.
  const global = await consume('refusal:global', SECURITY_POLICY.refusals.unauthenticatedGlobal);
  if (global.limited) {
    await recordHit(`${SUPPRESSED_PREFIX}|global|all|${window}`);
    return false;
  }
  const { limited } = await consume(`refusal:client:${owner.clientIdHash}`, SECURITY_POLICY.refusals.unauthenticatedPerClient);
  if (limited) await recordHit(`${SUPPRESSED_PREFIX}|client|${owner.clientIdHash}|${window}`);
  return !limited;
}

/**
 * Appends a refusal event of any kind through the refusal budget. Returns true
 * when it was written individually, false when it was counted for a summary.
 */
export async function appendRefusalEvent<A extends EventAction>(owner: BudgetOwner, input: AppendInput<A>): Promise<boolean> {
  try {
    if (!(await refusalBudget(owner))) return false;
    await appendStandaloneEvent(input);
    return true;
  } catch (error) {
    // A refusal must still be answered as a refusal even if it cannot be logged.
    log.error('refusal could not be logged', { action: input.action, ...errorFields(error) });
    return true;
  }
}

/** Returns true when the refusal was logged individually, false when throttled. */
export async function recordRefusal(input: RefusalInput): Promise<boolean> {
  return appendRefusalEvent(
    { clientIdHash: input.clientIdHash, sessionId: input.sessionId },
    {
      action: 'access.denied',
      details: { step: input.step, reason: input.reason, target: input.target },
      actor: input.actor,
      clientIdHash: input.clientIdHash,
    },
  );
}

// Arbitrary constant identifying the lock of the summary job.
const THROTTLE_SUMMARY_LOCK = 582_506_391;

/**
 * Worker task: one summary event per throttled client/session and finished minute.
 * Each summary is one transaction (review A-13): the event log's lock first
 * (decision 41), the job's lock, the counted rows deleted and returned, then
 * the event appended. A stop between the two can neither lose the count nor
 * write it twice, and two workers never summarise the same rows.
 */
export async function flushThrottleSummaries(): Promise<number> {
  const currentWindow = windowStart(clock.systemNow());
  const rows = await getDb().rateLimitHit.groupBy({
    by: ['key'],
    where: { key: { startsWith: `${SUPPRESSED_PREFIX}|` } },
  });
  let written = 0;
  for (const row of rows) {
    const [, scope, owner, start] = row.key.split('|');
    if (!scope || !owner || !start || start === currentWindow) continue;
    let appended = false;
    try {
      appended = await eventTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${THROTTLE_SUMMARY_LOCK})`;
        const deleted = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM "RateLimitHit" WHERE "key" = ${row.key} RETURNING "id"`;
        if (deleted.length === 0) return false;
        await appendEvent(tx, {
          action: 'access.throttled',
          details: {
            scope: scope === 'session' ? 'session' : scope === 'global' ? 'global' : 'client',
            suppressedCount: deleted.length,
            windowStart: start,
          },
          clientIdHash: scope === 'client' ? owner : null,
        });
        return true;
      });
    } catch (error) {
      // The rows stay for the next pass; the other summaries go on.
      log.error('throttle summary not written', { scope, ...errorFields(error) });
    }
    if (appended) written += 1;
  }
  return written;
}
