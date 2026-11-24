import { z } from 'zod';
import { activateAccount } from '@/server/auth/activation';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';

// «تفعيل الحساب»: the token comes from the fragment of the link, in the body.
export const POST = defineEndpoint({
  id: 'auth.activate',
  method: 'POST',
  path: '/api/v1/auth/activate',
  access: { kind: 'gate' },
  body: z.object({ token: z.string().min(1).max(128), password: z.string().min(1).max(128) }),
  handler: async ({ body, clientIdHash }) => {
    const result = await activateAccount(clientIdHash, body.token, body.password);
    switch (result.kind) {
      case 'throttled':
        return fail(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: result.retryAfterSeconds });
      case 'invalid-token':
        return fail(400, 'INVALID_TOKEN');
      case 'password-policy':
        return fail(422, 'PASSWORD_POLICY', { fields: { password: 'errors.PASSWORD_POLICY' } });
      case 'ok':
        return ok({ next: '/login' });
    }
  },
});
