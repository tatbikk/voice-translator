import 'server-only';
import { SECURITY_POLICY } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { COOKIES, readCookie, serializeCookie } from '../http/cookies';
import { hmacBase64Url, sessionKey } from '../keys';
import { randomToken, safeEqual, sha256Hex } from './tokens';

// Device cookie (OWASP "slow down online guessing with device cookies"): after
// a completed second factor, the browser receives a signed device identifier,
// and the account remembers it. Attempts from a remembered browser are counted
// in their own bucket, so whoever locks the account from elsewhere cannot lock
// its owner out of the browser the owner usually uses.

type Tx = Prisma.TransactionClient;

function mac(deviceId: string): string {
  return hmacBase64Url(sessionKey('device-cookie'), `device|${deviceId}`);
}

export function deviceIdFromRequest(req: Request): string | null {
  const value = readCookie(req, COOKIES.device);
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, id = '', given = ''] = parts;
  return /^[A-Za-z0-9_-]{20,64}$/.test(id) && safeEqual(given, mac(id)) ? id : null;
}

export function newDeviceId(): string {
  return randomToken(24);
}

export function deviceCookie(deviceId: string): string {
  return serializeCookie(COOKIES.device, `v1.${deviceId}.${mac(deviceId)}`, {
    sameSite: 'Strict',
    maxAge: SECURITY_POLICY.deviceCookie.lifetimeMs / 1000,
  });
}

export async function isKnownDevice(userId: string, deviceId: string | null): Promise<boolean> {
  if (!deviceId) return false;
  const row = await getDb().knownDevice.findUnique({
    where: { userId_deviceIdHash: { userId, deviceIdHash: sha256Hex(deviceId) } },
  });
  return row !== null && row.expiresAt.getTime() > clock.systemNow().getTime();
}

export async function rememberDevice(tx: Tx, userId: string, deviceId: string): Promise<void> {
  const now = clock.systemNow();
  const expiresAt = new Date(now.getTime() + SECURITY_POLICY.deviceCookie.lifetimeMs);
  await tx.knownDevice.upsert({
    where: { userId_deviceIdHash: { userId, deviceIdHash: sha256Hex(deviceId) } },
    create: { userId, deviceIdHash: sha256Hex(deviceId), createdAt: now, lastSeenAt: now, expiresAt },
    update: { lastSeenAt: now, expiresAt },
  });
}
