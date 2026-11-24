import { logout } from '@/server/auth/login';
import { clearSessionCookie } from '@/server/auth/sessions';
import { COOKIES, clearCookie } from '@/server/http/cookies';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';

export const POST = defineEndpoint({
  id: 'auth.logout',
  method: 'POST',
  path: '/api/v1/auth/logout',
  access: { kind: 'session' },
  handler: async ({ session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    await logout(session, clientIdHash);
    // The session and its CSRF binding end; the device cookie stays, so that the
    // owner keeps the path that a deliberate lock cannot close (decision 11;
    // reviews S-05 and A-09). Clear-Site-Data "cookies" would erase it.
    return ok(
      {},
      {
        cookies: [clearSessionCookie(), clearCookie(COOKIES.csrf)],
        headers: { 'Clear-Site-Data': '"cache", "storage"' },
      },
    );
  },
});
