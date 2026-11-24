import { logout } from '@/server/auth/login';
import { clearSessionCookie } from '@/server/auth/sessions';
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
    return ok({}, { cookies: [clearSessionCookie()], headers: { 'Clear-Site-Data': '"cookies", "storage"' } });
  },
});
