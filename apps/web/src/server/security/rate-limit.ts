import 'server-only';
import type { LimitRule } from '@mahkama/core';
import { clock } from '../clock';
import { getDb } from '../db';

// Sliding-window request limits stored in "RateLimitHit". Real time only.

export async function countHits(key: string, windowMs: number): Promise<number> {
  const since = new Date(clock.systemNow().getTime() - windowMs);
  return getDb().rateLimitHit.count({ where: { key, at: { gte: since } } });
}

/** Records one hit and tells whether the limit was already reached before it. */
export async function consume(key: string, rule: LimitRule): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const used = await countHits(key, rule.windowMs);
  if (used >= rule.max) return { limited: true, retryAfterSeconds: Math.ceil(rule.windowMs / 1000) };
  await getDb().rateLimitHit.create({ data: { key, at: clock.systemNow() } });
  return { limited: false, retryAfterSeconds: 0 };
}

/** Checks without recording. */
export async function isLimited(key: string, rule: LimitRule): Promise<boolean> {
  return (await countHits(key, rule.windowMs)) >= rule.max;
}

export async function recordHit(key: string): Promise<void> {
  await getDb().rateLimitHit.create({ data: { key, at: clock.systemNow() } });
}
