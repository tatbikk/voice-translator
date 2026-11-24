import 'server-only';
import { SECURITY_POLICY, type EventAction } from '@mahkama/core';
import { appendStandaloneEvent, type AppendInput, type EventActor } from '../events/append';
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

/** Worker task: one summary event per throttled client/session and finished minute. */
export async function flushThrottleSummaries(): Promise<number> {
  const db = getDb();
  const currentWindow = windowStart(clock.systemNow());
  const rows = await db.rateLimitHit.groupBy({
    by: ['key'],
    where: { key: { startsWith: `${SUPPRESSED_PREFIX}|` } },
    _count: { _all: true },
  });
  let written = 0;
  for (const row of rows) {
    const [, scope, owner, start] = row.key.split('|');
    if (!scope || !owner || !start || start === currentWindow) continue;
    await appendStandaloneEvent({
      action: 'access.throttled',
      details: {
        scope: scope === 'session' ? 'session' : scope === 'global' ? 'global' : 'client',
        suppressedCount: row._count._all,
        windowStart: start,
      },
      clientIdHash: scope === 'client' ? owner : null,
    });
    await db.rateLimitHit.deleteMany({ where: { key: row.key } });
    written += 1;
  }
  return written;
}
