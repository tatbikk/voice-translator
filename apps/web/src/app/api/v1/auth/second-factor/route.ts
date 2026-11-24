import { z } from 'zod';
import { deviceCookie } from '@/server/auth/device-cookie';
import { verifySecondFactor } from '@/server/auth/login';
import { clearSessionCookie, sessionCookie } from '@/server/auth/sessions';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { codeSchema } from '@/server/http/schemas';

// Second step: the six-digit confirmation code («وسيلة التأكيد الثانية»).
export const POST = defineEndpoint({
  id: 'auth.second-factor',
  method: 'POST',
  path: '/api/v1/auth/second-factor',
  access: { kind: 'pending-session', states: ['PENDING_SECOND_FACTOR'] },
  body: z.object({ code: codeSchema }),
  handler: async ({ req, body, session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    const result = await verifySecondFactor(req, session, clientIdHash, body.code);
    switch (result.kind) {
      case 'locked':
        return fail(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: result.retryAfterSeconds }, { cookies: [clearSessionCookie()] });
      case 'expired':
        return fail(401, 'CODE_EXPIRED');
      case 'invalid':
        return fail(401, 'INVALID_CODE');
      case 'ok':
        return ok({ next: result.next }, { cookies: [sessionCookie(result.token), deviceCookie(result.deviceId)] });
    }
  },
});
