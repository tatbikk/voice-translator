import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { log, errorFields } from '../log';

// Job queue in PostgreSQL itself (no extra service). A closed registry of job
// types, each with a payload schema: an unknown type or an invalid payload is
// marked DEAD without retry. At most five attempts with backoff. Jobs become
// due by platform time, so advancing the demo clock makes them run.

type Tx = Prisma.TransactionClient;

export const JOB_TYPES = {
  'events.verify-chain': z.strictObject({ full: z.boolean().optional() }),
  'maintenance.cleanup': z.strictObject({}),
  'security.throttle-summaries': z.strictObject({}),
} as const;

export type JobType = keyof typeof JOB_TYPES;
export type JobHandlers = { readonly [T in JobType]: (payload: z.infer<(typeof JOB_TYPES)[T]>) => Promise<void> };

const MAX_ATTEMPTS = 5;
const workerId = randomUUID();

export async function enqueue<T extends JobType>(
  tx: Tx | null,
  type: T,
  payload: z.infer<(typeof JOB_TYPES)[T]>,
  options: { runAt?: Date } = {},
): Promise<void> {
  JOB_TYPES[type].parse(payload);
  const now = clock.now();
  await (tx ?? getDb()).job.create({
    data: { type, payload, runAt: options.runAt ?? now, createdAt: clock.systemNow(), updatedAt: clock.systemNow() },
  });
}

interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** Claims and runs up to `limit` due jobs. Returns the number processed. */
export async function runDueJobs(handlers: JobHandlers, limit = 10): Promise<number> {
  const db = getDb();
  const claimed = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = ${clock.systemNow()}, "lockedBy" = ${workerId},
                     "attempts" = "attempts" + 1, "updatedAt" = ${clock.systemNow()}
     WHERE "id" IN (
       SELECT "id" FROM "Job"
        WHERE "status" = 'PENDING' AND "runAt" <= ${clock.now()}
        ORDER BY "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING "id", "type", "payload", "attempts"`;

  for (const job of claimed) {
    const done = (status: 'DONE' | 'DEAD' | 'PENDING', extra: Prisma.JobUpdateInput = {}) =>
      db.job.update({ where: { id: job.id }, data: { status, lockedAt: null, lockedBy: null, updatedAt: clock.systemNow(), ...extra } });
    if (!Object.hasOwn(JOB_TYPES, job.type)) {
      await done('DEAD', { lastErrorClass: 'UNKNOWN_JOB_TYPE' });
      continue;
    }
    const type = job.type as JobType;
    const parsed = JOB_TYPES[type].safeParse(job.payload);
    if (!parsed.success) {
      await done('DEAD', { lastErrorClass: 'INVALID_PAYLOAD' });
      continue;
    }
    try {
      await (handlers[type] as (payload: unknown) => Promise<void>)(parsed.data);
      await done('DONE');
    } catch (error) {
      const fields = errorFields(error);
      log.warn('job failed', { jobId: job.id, type, attempts: job.attempts, ...fields });
      if (job.attempts >= MAX_ATTEMPTS) {
        await done('DEAD', { lastErrorClass: String(fields.errorClass ?? 'Error') });
      } else {
        const backoffMs = 2 ** job.attempts * 1000;
        await done('PENDING', {
          lastErrorClass: String(fields.errorClass ?? 'Error'),
          runAt: new Date(clock.now().getTime() + backoffMs),
        });
      }
    }
  }
  return claimed.length;
}
