// The worker: the same code base, started with another command (contract §11).
// It runs the boot check, then the job queue, the periodic verification of the
// event chain, the summaries of throttled refusals and the cleanup of expired
// security records. Platform time drives the jobs; there is no host cron.
import { clock } from '@/server/clock';
import { closeDb } from '@/server/db';
import { enforceBoot } from '@/server/boot/check';
import { verifyEventChain } from '@/server/events/verify';
import { JOB_HANDLERS } from '@/server/jobs/handlers';
import { reviveUnreadJobs, runDueJobs } from '@/server/jobs/queue';
import { log, errorFields } from '@/server/log';
import { cleanupExpired } from '@/server/security/maintenance';
import { flushThrottleSummaries } from '@/server/security/refusals';
import { createScheduler } from './scheduler';

// The fixed copy of an application is awaited by its author: the queue is read often.
const QUEUE_EVERY_MS = 2_000;
const THROTTLE_EVERY_MS = 60_000;
const MAINTENANCE_EVERY_MS = 10 * 60_000;

async function main(): Promise<void> {
  await enforceBoot('worker');
  // The jobs an earlier worker declared dead unread, during a deployment (review of the IR-12 fix),
  // before any task; the tick below puts back those it declares while it drains.
  await reviveUnreadJobs();
  const scheduler = createScheduler({
    beforeEach: () => clock.refresh(),
    onError: (task, error) => {
      log.error('worker task failed', { task, ...errorFields(error) });
    },
  });
  scheduler.every(QUEUE_EVERY_MS, 'jobs', (stopping) => runDueJobs(JOB_HANDLERS, { stopping }));
  scheduler.every(THROTTLE_EVERY_MS, 'throttle-summaries', () => flushThrottleSummaries());
  // The old worker may run on after this one started (the platform drains it): what it declares
  // dead unread meanwhile is put back on the next tick, not at the next start.
  scheduler.every(THROTTLE_EVERY_MS, 'revive-unread-jobs', () => reviveUnreadJobs());
  scheduler.every(MAINTENANCE_EVERY_MS, 'chain-verification', (stopping) => verifyEventChain({ stopping }));
  scheduler.every(MAINTENANCE_EVERY_MS, 'cleanup', () => cleanupExpired());

  let stopRequested = false;
  const stop = (signal: string) => {
    if (stopRequested) return;
    stopRequested = true;
    log.info('worker stopping', { signal });
    void scheduler.stop().finally(async () => {
      await closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => { stop('SIGTERM'); });
  process.on('SIGINT', () => { stop('SIGINT'); });
  log.info('worker started', {});
}

await main();
