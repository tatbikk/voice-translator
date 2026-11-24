import 'server-only';
import { SECURITY_POLICY, countInWindow } from '@mahkama/core';
import { getDb } from '../db';
import { appendStandaloneEvent } from '../events/append';
import { appendRefusalEvent } from '../security/refusals';
import { getEnv } from '../config/env';
import { COOKIES, readCookie, serializeCookie } from '../http/cookies';
import { hmacBase64Url, sessionKey } from '../keys';
import { clock } from '../clock';
import { safeEqual, sha256Hex } from './tokens';

// Visitor passphrase of the demo environment (ACCESS_CODE). The cookie is
// v1.<expiry>.<mac>, where the MAC covers a digest of the current passphrase:
// changing ACCESS_CODE revokes every cookie issued before. In production mode
// there is no visitor gate.

function mac(expiry: string): string {
  const code = getEnv().accessCode ?? '';
  return hmacBase64Url(sessionKey('access-cookie'), `v1|${expiry}|${sha256Hex(code)}`);
}

export function gateRequired(): boolean {
  return getEnv().mode === 'demo';
}

export function verifyAccessCookieValue(value: string | null | undefined): boolean {
  if (!gateRequired()) return true;
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [, expiry = '', given = ''] = parts;
  if (!/^\d{10,13}$/.test(expiry) || Number(expiry) <= clock.systemNow().getTime()) return false;
  return safeEqual(given, mac(expiry));
}

export function hasAccess(req: Request): boolean {
  return verifyAccessCookieValue(readCookie(req, COOKIES.access));
}

export function issueAccessCookie(): string {
  const expiry = String(clock.systemNow().getTime() + SECURITY_POLICY.accessCode.cookieMs);
  return serializeCookie(COOKIES.access, `v1.${expiry}.${mac(expiry)}`, {
    maxAge: SECURITY_POLICY.accessCode.cookieMs / 1000,
  });
}

/** Constant-time check of a submitted passphrase. */
export function accessCodeMatches(submitted: string): boolean {
  const expected = getEnv().accessCode;
  if (!expected) return false;
  const key = sessionKey('access-cookie');
  return safeEqual(hmacBase64Url(key, `code|${submitted}`), hmacBase64Url(key, `code|${expected}`));
}

// ---------------------------------------------------------------------------
// Submission of the passphrase, with a per-client and a global limit.


export type AccessSubmission =
  | { kind: 'accepted'; cookie: string }
  | { kind: 'rejected' }
  | { kind: 'blocked'; scope: 'client' | 'global'; retryAfterSeconds: number };

async function failuresSince(where: { clientIdHash?: string }, windowMs: number): Promise<Date[]> {
  const since = new Date(clock.systemNow().getTime() - windowMs);
  const rows = await getDb().authAttempt.findMany({
    where: { kind: 'ACCESS_CODE', ok: false, at: { gte: since }, ...where },
    select: { at: true },
  });
  return rows.map((r) => r.at);
}

export async function submitAccessCode(clientIdHash: string, code: string): Promise<AccessSubmission> {
  const now = clock.systemNow();
  const perClient = SECURITY_POLICY.accessCode.perClient;
  const global = SECURITY_POLICY.accessCode.global;
  if (countInWindow(await failuresSince({ clientIdHash }, perClient.windowMs), now, perClient.windowMs) >= perClient.max) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'access.code.blocked', details: { scope: 'client' }, clientIdHash });
    return { kind: 'blocked', scope: 'client', retryAfterSeconds: perClient.blockMs / 1000 };
  }
  if (countInWindow(await failuresSince({}, global.windowMs), now, global.windowMs) >= global.max) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'access.code.blocked', details: { scope: 'global' }, clientIdHash });
    return { kind: 'blocked', scope: 'global', retryAfterSeconds: global.blockMs / 1000 };
  }
  const accepted = accessCodeMatches(code);
  await getDb().authAttempt.create({
    data: { kind: 'ACCESS_CODE', identifierHash: null, bucket: 'default', clientIdHash, ok: accepted, at: now },
  });
  if (!accepted) {
    await appendRefusalEvent({ clientIdHash, sessionId: null }, { action: 'access.code.rejected', details: {}, clientIdHash });
    return { kind: 'rejected' };
  }
  await appendStandaloneEvent({ action: 'access.code.accepted', details: {}, clientIdHash });
  return { kind: 'accepted', cookie: issueAccessCookie() };
}
