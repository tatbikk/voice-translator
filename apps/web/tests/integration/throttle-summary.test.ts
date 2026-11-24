// Review A-13: the summary of suppressed refusals (access.throttled) and the
// deletion of the rows it counts are one transaction. Two passes at once write
// one summary; a summary that cannot be written leaves its rows in place.
import { describe, expect, it } from 'vitest';
import { flushThrottleSummaries } from '@/server/security/refusals';
import { count, eventsAfter, headSeq, sql } from '../helpers/db';
import { useFreshDatabase } from '../helpers/reset';

const CLIENT = 'a'.repeat(64);

async function suppressed(key: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await sql(`INSERT INTO "RateLimitHit" (id, key, at) VALUES (gen_random_uuid(), $1, now() - interval '2 minutes')`, [key]);
  }
}

const rowsOf = (key: string) => count('SELECT count(*)::text AS n FROM "RateLimitHit" WHERE key = $1', [key]);

function pastWindow(): string {
  const minute = Math.floor((Date.now() - 3 * 60_000) / 60_000) * 60_000;
  return new Date(minute).toISOString();
}

describe('throttle summaries (review A-13)', () => {
  useFreshDatabase();

  it('two passes at once write a single summary, and the counted rows are gone', async () => {
    const key = `refusal-suppressed|client|${CLIENT}|${pastWindow()}`;
    await suppressed(key, 7);
    const since = await headSeq();
    const results = await Promise.all([flushThrottleSummaries(), flushThrottleSummaries(), flushThrottleSummaries()]);
    expect(results.reduce((a, b) => a + b, 0), 'one summary written in all').toBe(1);
    const summaries = await eventsAfter(since, 'access.throttled');
    expect(summaries.map((e) => e.details.suppressedCount)).toEqual([7]);
    expect(summaries[0]?.details.scope).toBe('client');
    expect(await rowsOf(key)).toBe(0);
    expect(await flushThrottleSummaries(), 'nothing left to summarise').toBe(0);
  });

  it('a summary that cannot be written leaves its rows, and the other summaries are still written', async () => {
    // A window that is not a timestamp: the event is refused by its schema.
    const broken = `refusal-suppressed|session|${CLIENT}|not-a-timestamp`;
    const good = `refusal-suppressed|global|all|${pastWindow()}`;
    await suppressed(broken, 3);
    await suppressed(good, 2);
    const since = await headSeq();
    expect(await flushThrottleSummaries()).toBe(1);
    expect(await rowsOf(broken), 'rolled back with the event').toBe(3);
    expect(await rowsOf(good)).toBe(0);
    expect((await eventsAfter(since, 'access.throttled')).map((e) => e.details.scope)).toEqual(['global']);
    await sql('DELETE FROM "RateLimitHit" WHERE key = $1', [broken]);
  });
});
