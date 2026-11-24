import { z } from 'zod';
import { reauthenticate } from '@/server/auth/login';
import { clearSessionCookie } from '@/server/auth/sessions';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { loginPasswordSchema } from '@/server/http/schemas';

// «إعادة التحقق من الهوية» before a sensitive action.
export const POST = defineEndpoint({
  id: 'auth.reauth',
  method: 'POST',
  path: '/api/v1/auth/reauth',
  access: { kind: 'action', action: 'account.view-own' },
  body: z.object({ password: loginPasswordSchema }),
  handler: async ({ req, body, session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    const result = await reauthenticate(req, session, clientIdHash, body.password);
    if (result.kind === 'locked') {
      return fail(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: result.retryAfterSeconds }, { cookies: [clearSessionCookie()] });
    }
    if (result.kind === 'invalid') return fail(401, 'INVALID_CREDENTIALS');
    return ok({});
  },
});
