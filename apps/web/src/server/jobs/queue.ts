import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { log, errorFields } from '../log';
import { StopRequested, type StopCheck } from './stop';

// Job queue in PostgreSQL itself (no extra service). A closed registry of job
// types, each with a payload schema: an unknown type or an invalid payload is
// marked DEAD without retry. At most five attempts with backoff. Jobs become
// due by platform time, so advancing the demo clock makes them run.
//
// A claimed job holds a lease (review A-11): the worker running it renews
// "lockedAt" while it runs. A job left RUNNING by a worker that stopped
// abruptly is found by its expired lease and put back to PENDING (its attempt
// stays counted), or DEAD once its attempts are spent. The stop signal is
// checked before each job and handed to the job itself; a job stopped that way
// goes back to PENDING without counting the attempt.

type Tx = Prisma.TransactionClient;

export const JOB_TYPES = {
  'events.verify-chain': z.strictObject({ full: z.boolean().optional() }),
  'maintenance.cleanup': z.strictObject({}),
  'security.throttle-summaries': z.strictObject({}),
} as const;

/** Technical values of the queue (real time), not legal rules. */
export const JOB_POLICY = {
  maxAttempts: 5,
  /** a RUNNING job whose lease was not renewed for this long is recovered */
  leaseMs: 15 * 60_000,
  /** how often a running job renews its lease */
  renewEveryMs: 60_000,
} as const;

export interface JobContext {
  /** true once the worker has been asked to stop: a long job ends early (throw StopRequested) */
  readonly stopping: StopCheck;
}

export type JobType = keyof typeof JOB_TYPES;
export type JobHandlers = {
  readonly [T in JobType]: (payload: z.infer<(typeof JOB_TYPES)[T]>, context: JobContext) => Promise<void>;
};

const defaultWorkerId = randomUUID();

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

/**
 * Puts back the jobs left RUNNING past their lease (a worker stopped while
 * running them): PENDING, or DEAD when their attempts are spent. The attempt
 * they were running stays counted.
 */
export async function recoverStaleJobs(leaseMs: number = JOB_POLICY.leaseMs): Promise<{ pending: number; dead: number }> {
  const now = clock.systemNow();
  const rows = await getDb().$queryRaw<{ id: string; status: string }[]>`
    UPDATE "Job"
       SET "status" = CASE WHEN "attempts" >= ${JOB_POLICY.maxAttempts} THEN 'DEAD'::"JobStatus" ELSE 'PENDING'::"JobStatus" END,
           "lockedAt" = NULL, "lockedBy" = NULL, "lastErrorClass" = 'LEASE_EXPIRED', "updatedAt" = ${now}
     WHERE "status" = 'RUNNING' AND "lockedAt" < ${new Date(now.getTime() - leaseMs)}
    RETURNING "id", "status"::text AS "status"`;
  const dead = rows.filter((r) => r.status === 'DEAD').length;
  if (rows.length > 0) log.warn('jobs recovered after an expired lease', { pending: rows.length - dead, dead });
  return { pending: rows.length - dead, dead };
}

async function claimOne(workerId: string): Promise<ClaimedJob | null> {
  const rows = await getDb().$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = ${clock.systemNow()}, "lockedBy" = ${workerId},
                     "attempts" = "attempts" + 1, "updatedAt" = ${clock.systemNow()}
     WHERE "id" IN (
       SELECT "id" FROM "Job"
        WHERE "status" = 'PENDING' AND "runAt" <= ${clock.now()}
        ORDER BY "runAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING "id", "type", "payload", "attempts"`;
  return rows[0] ?? null;
}

export interface RunOptions {
  /** at most this many jobs in one call */
  readonly limit?: number;
  /** checked before each job and handed to the job */
  readonly stopping?: StopCheck;
  /** tests only: several workers in one process */
  readonly workerId?: string;
  readonly leaseMs?: number;
  readonly renewEveryMs?: number;
}

/** Recovers stale jobs, then claims and runs due jobs one at a time. Returns the number processed. */
export async function runDueJobs(handlers: JobHandlers, options: RunOptions = {}): Promise<number> {
  const db = getDb();
  const limit = options.limit ?? 10;
  const stopping: StopCheck = options.stopping ?? (() => false);
  const workerId = options.workerId ?? defaultWorkerId;
  await recoverStaleJobs(options.leaseMs);

  let processed = 0;
  while (processed < limit && !stopping()) {
    const job = await claimOne(workerId);
    if (!job) break;
    processed += 1;

    // Only the worker holding the lease may close the job: one recovered and
    // claimed again elsewhere is left alone.
    const finish = (status: 'DONE' | 'DEAD' | 'PENDING', extra: Prisma.JobUpdateManyMutationInput = {}) =>
      db.job.updateMany({
        where: { id: job.id, lockedBy: workerId, status: 'RUNNING' },
        data: { status, lockedAt: null, lockedBy: null, updatedAt: clock.systemNow(), ...extra },
      });
    if (!Object.hasOwn(JOB_TYPES, job.type)) {
      await finish('DEAD', { lastErrorClass: 'UNKNOWN_JOB_TYPE' });
      continue;
    }
    const type = job.type as JobType;
    const parsed = JOB_TYPES[type].safeParse(job.payload);
    if (!parsed.success) {
      await finish('DEAD', { lastErrorClass: 'INVALID_PAYLOAD' });
      continue;
    }

    const renew = setInterval(() => {
      db.job
        .updateMany({ where: { id: job.id, lockedBy: workerId, status: 'RUNNING' }, data: { lockedAt: clock.systemNow() } })
        .catch((error: unknown) => {
          log.warn('job lease not renewed', { jobId: job.id, ...errorFields(error) });
        });
    }, options.renewEveryMs ?? JOB_POLICY.renewEveryMs);
    try {
      await (handlers[type] as (payload: unknown, context: JobContext) => Promise<void>)(parsed.data, { stopping });
      clearInterval(renew);
      await finish('DONE');
    } catch (error) {
      clearInterval(renew);
      if (error instanceof StopRequested) {
        // Not a failure: the job runs again after the restart.
        await finish('PENDING', { attempts: { decrement: 1 } });
        log.info('job stopped before its end', { jobId: job.id, type });
        break;
      }
      const fields = errorFields(error);
      log.warn('job failed', { jobId: job.id, type, attempts: job.attempts, ...fields });
      if (job.attempts >= JOB_POLICY.maxAttempts) {
        await finish('DEAD', { lastErrorClass: String(fields.errorClass ?? 'Error') });
      } else {
        const backoffMs = 2 ** job.attempts * 1000;
        await finish('PENDING', {
          lastErrorClass: String(fields.errorClass ?? 'Error'),
          runAt: new Date(clock.now().getTime() + backoffMs),
        });
      }
    }
  }
  return processed;
}
