import 'server-only';
import type { LimitRule } from '@mahkama/core';
import { clock } from '../clock';
import { getDb } from '../db';

// Sliding-window request limits stored in "RateLimitHit". Real time only.

export async function countHits(key: string, windowMs: number): Promise<number> {
  const since = new Date(clock.systemNow().getTime() - windowMs);
  return getDb().rateLimitHit.count({ where: { key, at: { gte: since } } });
}

/**
 * Takes one slot of the limit. The hit is written first and the window counted
 * after it: a request passes only if its own hit is within the limit. Whatever
 * the number of concurrent requests, at most `max` pass in a window (each one
 * sees its own hit and every hit committed before it). A request refused before
 * writing leaves no row, so the table holds at most `max` rows per key and
 * window, plus the requests that raced for the last slots.
 */
export async function consume(key: string, rule: LimitRule): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const limited = { limited: true, retryAfterSeconds: Math.ceil(rule.windowMs / 1000) };
  if ((await countHits(key, rule.windowMs)) >= rule.max) return limited;
  await getDb().rateLimitHit.create({ data: { key, at: clock.systemNow() } });
  if ((await countHits(key, rule.windowMs)) > rule.max) return limited;
  return { limited: false, retryAfterSeconds: 0 };
}

/** Checks without recording. */
export async function isLimited(key: string, rule: LimitRule): Promise<boolean> {
  return (await countHits(key, rule.windowMs)) >= rule.max;
}

export async function recordHit(key: string): Promise<void> {
  await getDb().rateLimitHit.create({ data: { key, at: clock.systemNow() } });
}
