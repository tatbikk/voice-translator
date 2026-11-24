// The worker: the same code base, started with another command (contract §11).
// It runs the boot check, then the job queue, the periodic verification of the
// event chain, the summaries of throttled refusals and the cleanup of expired
// security records. Platform time drives the jobs; there is no host cron.
import { clock } from '@/server/clock';
import { closeDb } from '@/server/db';
import { enforceBoot } from '@/server/boot/check';
import { verifyEventChain } from '@/server/events/verify';
import { runDueJobs } from '@/server/jobs/queue';
import { log, errorFields } from '@/server/log';
import { cleanupExpired } from '@/server/security/maintenance';
import { flushThrottleSummaries } from '@/server/security/refusals';

const QUEUE_EVERY_MS = 5_000;
const THROTTLE_EVERY_MS = 60_000;
const MAINTENANCE_EVERY_MS = 10 * 60_000;

let stopping = false;
let running: Promise<void> = Promise.resolve();

function every(ms: number, name: string, task: () => Promise<unknown>): NodeJS.Timeout {
  const tick = () => {
    if (stopping) return;
    running = running
      .then(async () => {
        await clock.refresh();
        await task();
      })
      .catch((error: unknown) => {
        log.error('worker task failed', { task: name, ...errorFields(error) });
      });
  };
  tick();
  return setInterval(tick, ms);
}

async function main(): Promise<void> {
  await enforceBoot('worker');
  const timers = [
    every(QUEUE_EVERY_MS, 'jobs', () =>
      runDueJobs({
        'events.verify-chain': async (payload) => {
          await verifyEventChain(payload.full === undefined ? {} : { full: payload.full });
        },
        'maintenance.cleanup': () => cleanupExpired(),
        'security.throttle-summaries': async () => {
          await flushThrottleSummaries();
        },
      }),
    ),
    every(THROTTLE_EVERY_MS, 'throttle-summaries', () => flushThrottleSummaries()),
    every(MAINTENANCE_EVERY_MS, 'chain-verification', () => verifyEventChain()),
    every(MAINTENANCE_EVERY_MS, 'cleanup', () => cleanupExpired()),
  ];

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('worker stopping', { signal });
    for (const timer of timers) clearInterval(timer);
    void running.finally(async () => {
      await closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => { stop('SIGTERM'); });
  process.on('SIGINT', () => { stop('SIGINT'); });
  log.info('worker started', {});
}

await main();
