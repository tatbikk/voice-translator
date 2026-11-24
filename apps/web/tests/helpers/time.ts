// Waiting helpers for limits counted per minute. A limiter may use fixed
// windows aligned on the minute: a burst that straddles a minute boundary
// would then be split in two windows and never reach the limit.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits, when needed, so that at least `neededMs` remain before the next minute boundary. */
export async function awayFromMinuteBoundary(neededMs = 15_000): Promise<void> {
  const intoMinute = Date.now() % 60_000;
  if (60_000 - intoMinute < neededMs) await sleep(60_000 - intoMinute + 250);
}

/** Waits until the next minute window has started (fixed windows) and a full minute has passed (sliding windows). */
export async function untilNextWindow(since: number): Promise<void> {
  const elapsed = Date.now() - since;
  const minuteEnd = 60_000 - (since % 60_000);
  await sleep(Math.max(61_000 - elapsed, minuteEnd - elapsed + 500, 0));
}
