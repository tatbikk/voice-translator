import 'server-only';
import { getEnv } from '../config/env';
import { hmacHex, sessionKey } from '../keys';

// The client address used by every per-client limit comes ONLY from X-Real-IP,
// set by Railway's edge. X-Forwarded-For and Forwarded are client-controlled
// and ignored. IPv6 addresses are grouped by /64. A missing or malformed header
// outside local development puts the request in one shared bucket — the
// strictest outcome, never an unlimited one. The raw address is never stored.

const SHARED_BUCKET = 'unknown';
const LOCAL_BUCKET = 'local';

const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const DECIMAL_OCTET = /^\d{1,3}$/;

/** Dotted-quad IPv4 without leading zeros. */
function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => DECIMAL_OCTET.test(p) && (p === '0' || !p.startsWith('0')) && Number(p) <= 255)
  );
}

function normalise(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length > 64) return null;
  if (isIpv4(value)) return value;
  const mapped = /^::ffff:([0-9.]+)$/.exec(value);
  if (mapped?.[1] && isIpv4(mapped[1])) return mapped[1];
  if (!value.includes(':')) return null;
  const groups = expandIpv6(value);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : null;
}

function expandIpv6(address: string): string[] | null {
  const [head, tail] = address.split('::');
  if (address.split('::').length > 2) return null;
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || !groups.every((g) => HEX_GROUP.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

export function clientAddress(req: Request): string {
  const header = req.headers.get('x-real-ip');
  const normalised = header ? normalise(header) : null;
  if (normalised) return normalised;
  const host = new URL(getEnv().appUrl).hostname;
  return host === 'localhost' || host === '127.0.0.1' ? LOCAL_BUCKET : SHARED_BUCKET;
}

export function clientIdHash(req: Request): string {
  return hmacHex(sessionKey('client-id'), clientAddress(req));
}
