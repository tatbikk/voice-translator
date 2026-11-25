// Review A-11: the job queue (src/server/jobs/queue.ts). A job left RUNNING
// after an abrupt stop is recovered once its lease expires (back to PENDING,
// its attempt counted, or DEAD once the attempts are spent); a running job
// renews its lease; the stop signal is checked before each job and handed to
// the job, which then goes back to PENDING without counting the attempt.
import { describe, expect, it } from 'vitest';
import { JOB_POLICY, runDueJobs, type JobHandlers } from '@/server/jobs/queue';
import { StopRequested } from '@/server/jobs/stop';
import { one, sql } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

type JobRow = { id: string; status: string; attempts: number; lockedAt: Date | null; lockedBy: string | null; lastErrorClass: string | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function insertJob(values: { status?: string; attempts?: number; lockedMinutesAgo?: number | null; type?: string } = {}): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO "Job" (id, type, payload, "runAt", status, attempts, "lockedAt", "lockedBy", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, '{}'::jsonb, now() - interval '1 minute', $2::"JobStatus", $3,
             CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(mins => $4::int) END,
             CASE WHEN $4::int IS NULL THEN NULL ELSE 'a-worker-that-crashed' END, now(), now())
     RETURNING id`,
    [values.type ?? 'maintenance.cleanup', values.status ?? 'PENDING', values.attempts ?? 0, values.lockedMinutesAgo ?? null],
  );
  return row.id;
}

const jobOf = (id: string) => one<JobRow>('SELECT id, status::text AS status, attempts, "lockedAt", "lockedBy", "lastErrorClass" FROM "Job" WHERE id = $1', [id]);

function handlers(overrides: Partial<JobHandlers> = {}): JobHandlers & { readonly calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => async () => {
    await Promise.resolve();
    calls.push(name);
  };
  return {
    calls,
    'events.verify-chain': record('events.verify-chain'),
    'maintenance.cleanup': record('maintenance.cleanup'),
    'security.throttle-summaries': record('security.throttle-summaries'),
    'filing.fixed-copy': record('filing.fixed-copy'),
    'payment.receipt': record('payment.receipt'),
    'filing.receipt': record('filing.receipt'),
    ...overrides,
  };
}

describe('job queue (review A-11)', () => {
  useFreshDatabase();

  it('a job left RUNNING past its lease goes back to PENDING, its attempt counted, and runs again', async () => {
    const id = await insertJob({ status: 'RUNNING', attempts: 1, lockedMinutesAgo: JOB_POLICY.leaseMs / 60_000 + 1 });
    const h = handlers();
    expect(await runDueJobs(h)).toBe(1);
    expect(h.calls).toEqual(['maintenance.cleanup']);
    const job = await jobOf(id);
    expect(job.status).toBe('DONE');
    expect(job.attempts, 'the lost attempt and the new one').toBe(2);
  });

  it('a job left RUNNING past its lease with its attempts spent becomes DEAD', async () => {
    const id = await insertJob({ status: 'RUNNING', attempts: JOB_POLICY.maxAttempts, lockedMinutesAgo: JOB_POLICY.leaseMs / 60_000 + 1 });
    const h = handlers();
    await runDueJobs(h);
    expect(h.calls).toEqual([]);
    const job = await jobOf(id);
    expect({ status: job.status, attempts: job.attempts, lastErrorClass: job.lastErrorClass }).toEqual({
      status: 'DEAD',
      attempts: JOB_POLICY.maxAttempts,
      lastErrorClass: 'LEASE_EXPIRED',
    });
    expect(job.lockedBy).toBeNull();
  });

  it('a job RUNNING within its lease is left alone', async () => {
    const id = await insertJob({ status: 'RUNNING', attempts: 1, lockedMinutesAgo: 1 });
    const h = handlers();
    expect(await runDueJobs(h)).toBe(0);
    const job = await jobOf(id);
    expect({ status: job.status, lockedBy: job.lockedBy }).toEqual({ status: 'RUNNING', lockedBy: 'a-worker-that-crashed' });
    await sql(`UPDATE "Job" SET status = 'DONE', "lockedAt" = NULL, "lockedBy" = NULL WHERE id = $1`, [id]);
  });

  it('a running job renews its lease', async () => {
    const id = await insertJob();
    let seen: Date | null = null;
    const h = handlers({
      'maintenance.cleanup': async () => {
        const first = (await jobOf(id)).lockedAt;
        await sleep(400);
        seen = (await jobOf(id)).lockedAt;
        expect(seen?.getTime() ?? 0).toBeGreaterThan(first?.getTime() ?? Number.POSITIVE_INFINITY);
      },
    });
    await runDueJobs(h, { renewEveryMs: 100 });
    expect(seen).not.toBeNull();
    expect((await jobOf(id)).status).toBe('DONE');
  });

  it('no job starts once the stop signal is given', async () => {
    const first = await insertJob();
    const second = await insertJob();
    let stop = false;
    const h = handlers({
      'maintenance.cleanup': async () => {
        await Promise.resolve();
        h.calls.push('cleanup');
        stop = true;
      },
    });
    expect(await runDueJobs(h, { stopping: () => stop })).toBe(1);
    const statuses = [(await jobOf(first)).status, (await jobOf(second)).status].sort();
    expect(statuses, 'one ran, the other waits for the next start').toEqual(['DONE', 'PENDING']);
    expect(await runDueJobs(handlers())).toBe(1);
  });

  it('a job stopped by the stop signal goes back to PENDING without counting the attempt', async () => {
    const id = await insertJob();
    let stop = false;
    const h = handlers({
      'maintenance.cleanup': async (_payload, { stopping }) => {
        await Promise.resolve();
        stop = true;
        if (stopping()) throw new StopRequested();
      },
    });
    await runDueJobs(h, { stopping: () => stop });
    const job = await jobOf(id);
    expect({ status: job.status, attempts: job.attempts, lockedBy: job.lockedBy }).toEqual({ status: 'PENDING', attempts: 0, lockedBy: null });
  });

  it('a job past its time limit is aborted, given time to close what it started, and counted as failed (review P2-S-15)', async () => {
    const id = await insertJob();
    const seen = { aborted: false, closed: false };
    const h = handlers({
      'maintenance.cleanup': async (_payload, { signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            seen.aborted = true;
            resolve();
          });
        });
        await sleep(100);
        seen.closed = true;
      },
    });
    await runDueJobs(h, { timeoutMs: 200 });
    expect(seen).toEqual({ aborted: true, closed: true });
    const job = await jobOf(id);
    expect({ status: job.status, attempts: job.attempts, lastErrorClass: job.lastErrorClass }).toEqual({ status: 'PENDING', attempts: 1, lastErrorClass: 'JobTimedOut' });
    await sql(`UPDATE "Job" SET status = 'DONE' WHERE id = $1`, [id]);
  });

  it('a job is told when its attempt is the last, and a failure then makes it DEAD (review P2-A-05)', async () => {
    const told: boolean[] = [];
    const failing = handlers({
      'maintenance.cleanup': async (_payload, { lastAttempt }) => {
        told.push(lastAttempt);
        await Promise.resolve();
        throw new Error('print failed');
      },
    });
    const first = await insertJob();
    await runDueJobs(failing);
    expect((await jobOf(first)).status).toBe('PENDING');
    await sql(`UPDATE "Job" SET status = 'DONE' WHERE id = $1`, [first]);
    const last = await insertJob({ attempts: JOB_POLICY.maxAttempts - 1 });
    await runDueJobs(failing);
    expect((await jobOf(last)).status).toBe('DEAD');
    expect(told).toEqual([false, true]);
  });

  it('a job recovered and claimed by another worker is not closed by the first one', async () => {
    const id = await insertJob();
    const h = handlers({
      'maintenance.cleanup': async () => {
        // Meanwhile the lease expired and another worker took the job.
        await sql(`UPDATE "Job" SET "lockedBy" = 'another-worker' WHERE id = $1`, [id]);
      },
    });
    await runDueJobs(h);
    const job = await jobOf(id);
    expect({ status: job.status, lockedBy: job.lockedBy }).toEqual({ status: 'RUNNING', lockedBy: 'another-worker' });
    await sql(`UPDATE "Job" SET status = 'DONE', "lockedAt" = NULL, "lockedBy" = NULL WHERE id = $1`, [id]);
  });
});
