// The worker's periodic tasks (review A-11). Tasks run one after the other, as
// before, but each task has an in-flight flag: while one of its pulses waits or
// runs, its next pulses are skipped instead of piling up behind a slow task.
// Once stop() is called no pulse starts, waiting pulses are dropped, and the
// running task sees the stop through the check it is handed.
import { StopRequested, type StopCheck } from '@/server/jobs/stop';

export interface SchedulerHooks {
  /** runs before each task (refresh of the platform clock) */
  readonly beforeEach?: () => Promise<void>;
  readonly onError: (task: string, error: unknown) => void;
}

export interface Scheduler {
  every(ms: number, name: string, task: (stopping: StopCheck) => Promise<unknown>): void;
  readonly stopping: StopCheck;
  /** Stops every timer, then resolves once the running task, if any, has ended. */
  stop(): Promise<void>;
}

export function createScheduler(hooks: SchedulerHooks): Scheduler {
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  const inFlight = new Set<string>();
  const timers: NodeJS.Timeout[] = [];
  const stopping: StopCheck = () => stopped;

  const pulse = (name: string, task: (stopping: StopCheck) => Promise<unknown>) => {
    if (stopped || inFlight.has(name)) return;
    inFlight.add(name);
    chain = chain
      .then(async () => {
        if (stopping()) return;
        await hooks.beforeEach?.();
        if (stopping()) return;
        await task(stopping);
      })
      .catch((error: unknown) => {
        if (!(error instanceof StopRequested)) hooks.onError(name, error);
      })
      .finally(() => {
        inFlight.delete(name);
      });
  };

  return {
    every(ms, name, task) {
      pulse(name, task);
      timers.push(setInterval(() => { pulse(name, task); }, ms));
    },
    stopping,
    async stop() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      await chain;
    },
  };
}
