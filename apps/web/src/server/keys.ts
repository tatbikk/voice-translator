import 'server-only';
import { createHmac, hkdfSync } from 'node:crypto';
import { getEnv } from './config/env';

// One key per purpose, derived with HKDF-SHA256 from the two master secrets, so
// that a value signed for one purpose can never be replayed for another.

export type SessionKeyPurpose = 'access-cookie' | 'csrf' | 'client-id' | 'device-cookie' | 'second-factor' | 'identifier';
export type MasterKeyPurpose = 'secret-store-v1' | 'event-chain-v1' | 'signature-simulated-v1';

const cache = new Map<string, Buffer>();

function derive(master: Buffer, label: string): Buffer {
  const cacheKey = `${label}:${master.toString('base64')}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `mahkama:${label}`, 32));
  cache.set(cacheKey, key);
  return key;
}

export function sessionKey(purpose: SessionKeyPurpose): Buffer {
  return derive(getEnv().sessionSecret, purpose);
}

export function masterKey(purpose: MasterKeyPurpose): Buffer {
  return derive(getEnv().masterKey, purpose);
}

export function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export function hmacBase64Url(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('base64url');
}

/** Keyed hash of a normalised e-mail address: the identifier of login attempts and locks. */
export function identifierHash(email: string): string {
  return hmacHex(sessionKey('identifier'), email.trim().toLowerCase());
}

export function clearKeyCache(): void {
  cache.clear();
}
