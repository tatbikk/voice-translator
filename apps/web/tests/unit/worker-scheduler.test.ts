// Review A-11: the worker's pulses do not pile up behind a slow task, nothing
// starts after the stop signal, and the running task is handed the stop check.
import { describe, expect, it } from 'vitest';
import { StopRequested } from '@/server/jobs/stop';
import { createScheduler } from '@/worker/scheduler';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('worker scheduler (review A-11)', () => {
  it('a slow task is never run twice at once, and its missed pulses are skipped, not queued', async () => {
    const errors: unknown[] = [];
    const scheduler = createScheduler({ onError: (_task, error) => errors.push(error) });
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    scheduler.every(10, 'slow', async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      runs += 1;
      await sleep(150);
      running -= 1;
    });
    await sleep(400);
    await scheduler.stop();
    expect(maxRunning).toBe(1);
    // About 400 / 150 runs; with queued pulses it would keep running ~40 times.
    expect(runs).toBeGreaterThanOrEqual(2);
    expect(runs).toBeLessThanOrEqual(4);
    const after = runs;
    await sleep(100);
    expect(runs, 'nothing runs after stop').toBe(after);
    expect(errors).toEqual([]);
  });

  it('after the stop signal, a task waiting behind another one does not start', async () => {
    const scheduler = createScheduler({ onError: () => undefined });
    const started: string[] = [];
    scheduler.every(1_000, 'first', async () => {
      started.push('first');
      await sleep(100);
    });
    scheduler.every(1_000, 'second', async () => {
      started.push('second');
      await Promise.resolve();
    });
    await sleep(20);
    await scheduler.stop();
    expect(started).toEqual(['first']);
  });

  it('the running task sees the stop and may end early; StopRequested is not reported as a failure', async () => {
    const errors: unknown[] = [];
    const scheduler = createScheduler({ onError: (_task, error) => errors.push(error) });
    let steps = 0;
    scheduler.every(1_000, 'long', async (stopping) => {
      for (let i = 0; i < 100; i += 1) {
        if (stopping()) throw new StopRequested();
        steps += 1;
        await sleep(10);
      }
    });
    await sleep(50);
    const stoppedAt = Date.now();
    await scheduler.stop();
    expect(Date.now() - stoppedAt, 'stop waits only for the current step').toBeLessThan(200);
    expect(steps).toBeLessThan(100);
    expect(errors).toEqual([]);
  });

  it('a failing task is reported and does not stop the others', async () => {
    const errors: string[] = [];
    const scheduler = createScheduler({ onError: (task) => errors.push(task) });
    let ran = false;
    scheduler.every(1_000, 'failing', async () => {
      await Promise.resolve();
      throw new Error('boom');
    });
    scheduler.every(1_000, 'healthy', async () => {
      await Promise.resolve();
      ran = true;
    });
    await sleep(20);
    await scheduler.stop();
    expect(errors).toEqual(['failing']);
    expect(ran).toBe(true);
  });
});
