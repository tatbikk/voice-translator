import { bindingCookie, bindingIdFromValue, csrfTokenFor, newBindingCookieValue } from '@/server/auth/csrf';
import { COOKIES, readCookie } from '@/server/http/cookies';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';

// The CSRF token of the current binding: the session when one exists, otherwise
// a server-issued anonymous binding cookie (set here when absent or invalid).
// Reachable before the visitor gate, because the passphrase form itself is a
// protected POST; it reveals nothing (the binding is a random server-issued id).
export const GET = defineEndpoint({
  id: 'csrf.token',
  method: 'GET',
  path: '/api/v1/csrf',
  access: { kind: 'pre-gate' },
  handler: async ({ req, session }) => {
    await Promise.resolve();
    if (session) return ok({ token: csrfTokenFor(session.session.id) });
    const existing = bindingIdFromValue(readCookie(req, COOKIES.csrf));
    if (existing) return ok({ token: csrfTokenFor(existing) });
    const value = newBindingCookieValue();
    const id = bindingIdFromValue(value) ?? '';
    return ok({ token: csrfTokenFor(id) }, { cookies: [bindingCookie(value)] });
  },
});
