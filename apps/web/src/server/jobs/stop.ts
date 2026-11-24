import 'server-only';

// The worker's stop signal, as seen by a long task (review A-11): the task
// checks it between steps and throws StopRequested, which is not a failure.

export type StopCheck = () => boolean;

export class StopRequested extends Error {
  constructor() {
    super('stop requested');
    this.name = 'StopRequested';
  }
}

/** Throws StopRequested when the worker has been asked to stop. */
export function throwIfStopping(stopping: StopCheck | undefined): void {
  if (stopping?.()) throw new StopRequested();
}
