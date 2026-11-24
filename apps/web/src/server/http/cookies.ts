import 'server-only';

// Cookie names are always the __Host- form: Secure, Path=/, no Domain. Chromium
// accepts them on http://localhost as well, so tests use the production names.
export const COOKIES = {
  access: '__Host-mr-access',
  session: '__Host-mr-session',
  csrf: '__Host-mr-csrf',
  device: '__Host-mr-device',
  locale: '__Host-mr-locale',
  reading: '__Host-mr-reading',
} as const;

export type CookieName = (typeof COOKIES)[keyof typeof COOKIES];

export function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!jar.has(name)) jar.set(name, value);
  }
  return jar;
}

export function readCookie(req: Request, name: CookieName): string | null {
  return parseCookieHeader(req.headers.get('cookie')).get(name) ?? null;
}

export interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly sameSite?: 'Lax' | 'Strict';
  /** seconds; omitted for a browser-session cookie */
  readonly maxAge?: number;
}

export function serializeCookie(name: CookieName, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`, 'Path=/', 'Secure', `SameSite=${options.sameSite ?? 'Lax'}`];
  if (options.httpOnly ?? true) parts.push('HttpOnly');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${String(Math.max(0, Math.floor(options.maxAge)))}`);
  return parts.join('; ');
}

export function clearCookie(name: CookieName): string {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
