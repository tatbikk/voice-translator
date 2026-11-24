import 'server-only';
import { SECURITY_POLICY } from '@mahkama/core';
import { appendStandaloneEvent, type EventActor } from '../events/append';
import { clock } from '../clock';
import { getDb } from '../db';
import { log, errorFields } from '../log';
import { consume, recordHit } from './rate-limit';

// Every refusal is written to the event log, individually, up to a known limit
// per client (without session) or per session. Beyond it the request is
// answered 429 and the suppressed refusals are counted; the worker writes one
// summary event (access.throttled) per client or session and minute, carrying
// the number of suppressed refusals. This keeps the log from being flooded
// without losing the fact that refusals happened (decision recorded in
// docs/decisions.md).

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

/** Returns true when the refusal was logged individually, false when throttled. */
export async function recordRefusal(input: RefusalInput): Promise<boolean> {
  try {
    const scope = input.sessionId ? 'session' : 'client';
    const owner = input.sessionId ?? input.clientIdHash;
    const rule = input.sessionId
      ? SECURITY_POLICY.refusals.authenticatedPerSession
      : SECURITY_POLICY.refusals.unauthenticatedPerClient;
    const { limited } = await consume(`refusal:${scope}:${owner}`, rule);
    if (limited) {
      await recordHit(`${SUPPRESSED_PREFIX}|${scope}|${owner}|${windowStart(clock.systemNow())}`);
      return false;
    }
    await appendStandaloneEvent({
      action: 'access.denied',
      details: { step: input.step, reason: input.reason, target: input.target },
      actor: input.actor,
      clientIdHash: input.clientIdHash,
    });
    return true;
  } catch (error) {
    // A refusal must still be answered as a refusal even if it cannot be logged.
    log.error('refusal could not be logged', { step: input.step, target: input.target, ...errorFields(error) });
    return true;
  }
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
      details: { scope: scope === 'session' ? 'session' : 'client', suppressedCount: row._count._all, windowStart: start },
      clientIdHash: scope === 'client' ? owner : null,
    });
    await db.rateLimitHit.deleteMany({ where: { key: row.key } });
    written += 1;
  }
  return written;
}
