import { z } from 'zod';
import { loginWithPassword } from '@/server/auth/login';
import { sessionCookie } from '@/server/auth/sessions';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { emailSchema, loginPasswordSchema } from '@/server/http/schemas';

// First step of «الدخول»: the password. Every failure gets the same answer,
// whether the account exists or not.
export const POST = defineEndpoint({
  id: 'auth.login',
  method: 'POST',
  path: '/api/v1/auth/login',
  access: { kind: 'gate' },
  body: z.object({ email: emailSchema, password: loginPasswordSchema }),
  handler: async ({ req, body, clientIdHash }) => {
    const result = await loginWithPassword(req, clientIdHash, body.email, body.password);
    switch (result.kind) {
      case 'throttled':
        return fail(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: result.retryAfterSeconds });
      case 'locked':
        return fail(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: result.retryAfterSeconds });
      case 'invalid':
        return fail(401, 'INVALID_CREDENTIALS');
      case 'pending':
        return ok({ next: 'second-factor' }, { cookies: [sessionCookie(result.token)] });
    }
  },
});
