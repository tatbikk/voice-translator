import 'server-only';
import { COOKIES, readCookie, serializeCookie } from '../http/cookies';
import { hmacBase64Url, sessionKey } from '../keys';
import { randomToken, safeEqual } from './tokens';

// CSRF protection for every state-changing request (contract §5, §6):
// - SameSite=Lax cookies;
// - Origin must be the application's origin, Sec-Fetch-Site same-origin;
// - an X-CSRF-Token header bound to the session, or, before a session exists,
//   to the server-issued __Host-mr-csrf binding (id.mac: a value the client
//   chose itself is rejected, so it cannot be used as a signing oracle).

function bindingMac(id: string): string {
  return hmacBase64Url(sessionKey('csrf'), `bind|${id}`);
}

export function newBindingCookieValue(): string {
  const id = randomToken(18);
  return `${id}.${bindingMac(id)}`;
}

export function bindingCookie(value: string): string {
  return serializeCookie(COOKIES.csrf, value);
}

/** The verified binding id carried by the cookie value, or null. */
export function bindingIdFromValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  return /^[A-Za-z0-9_-]{16,64}$/.test(id) && safeEqual(mac, bindingMac(id)) ? id : null;
}

export function bindingIdFromRequest(req: Request): string | null {
  return bindingIdFromValue(readCookie(req, COOKIES.csrf));
}

export function csrfTokenFor(bindingId: string): string {
  return hmacBase64Url(sessionKey('csrf'), `csrf|${bindingId}`);
}

export function csrfTokenValid(given: string | null, bindingId: string | null): boolean {
  if (!given || !bindingId) return false;
  return safeEqual(given, csrfTokenFor(bindingId));
}
