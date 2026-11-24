import 'server-only';
import { clock } from '../clock';
import { getDb } from '../db';

// Periodic cleanup: expired sessions, codes, activation tokens, request-limit
// rows and outbox messages holding an expired code or link. The event log is
// never touched.

const DAY = 24 * 60 * 60 * 1000;

export async function cleanupExpired(): Promise<void> {
  const db = getDb();
  const now = clock.systemNow();
  const old = new Date(now.getTime() - DAY);
  await db.secondFactorChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { voidedAt: { lt: old } }] } });
  await db.session.deleteMany({ where: { OR: [{ absoluteExpiresAt: { lt: old } }, { revokedAt: { lt: old } }] } });
  await db.activationToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY) } } });
  await db.rateLimitHit.deleteMany({ where: { at: { lt: old }, NOT: { key: { startsWith: 'refusal-suppressed|' } } } });
  await db.authAttempt.deleteMany({ where: { at: { lt: new Date(now.getTime() - 2 * DAY) } } });
  await db.lockout.deleteMany({ where: { until: { lt: old } } });
  await db.knownDevice.deleteMany({ where: { expiresAt: { lt: now } } });
  // Outbox rows carrying a code or a link are removed once that secret expired.
  await db.outboundMessage.deleteMany({ where: { holdsSecret: true, expiresAt: { lt: clock.now() } } });
}
