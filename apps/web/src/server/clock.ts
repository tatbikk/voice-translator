import 'server-only';
import type { Clock } from '@mahkama/core';
import { getEnv } from './config/env';
import { getDb } from './db';

// The only module allowed to read the system clock (rule 6 of the prompt).
//
// now()        platform time: the legal time of every act, notification and
//              time limit. In production it is the system time. In the demo
//              environment it may be advanced (never moved back) by a demo tool,
//              through the single-row table "PlatformClock".
// systemNow()  real elapsed time, for security timers only (sessions, locks,
//              code validity, request limits): advancing the demo clock must
//              never lift a lock. Callers are limited by an architecture rule.

const REFRESH_MS = 2_000;

let offsetMs = 0;
let lastRefresh = Number.NEGATIVE_INFINITY;

function readSystemTime(): number {
  return Date.now();
}

export const clock: Clock & { refresh(): Promise<void> } = {
  now(): Date {
    return new Date(readSystemTime() + offsetMs);
  },
  systemNow(): Date {
    return new Date(readSystemTime());
  },
  async refresh(): Promise<void> {
    if (getEnv().mode === 'production') {
      offsetMs = 0;
      return;
    }
    const at = readSystemTime();
    if (at - lastRefresh < REFRESH_MS) return;
    lastRefresh = at;
    const row = await getDb().platformClock.findUnique({ where: { id: 1 }, select: { offsetSeconds: true } });
    offsetMs = row ? Number(row.offsetSeconds) * 1000 : 0;
  },
};

/** Tests and the demo clock tool force the next refresh to read the database. */
export function invalidateClockCache(): void {
  lastRefresh = Number.NEGATIVE_INFINITY;
}
