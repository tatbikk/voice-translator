import { resendSecondFactor } from '@/server/auth/login';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';

export const POST = defineEndpoint({
  id: 'auth.second-factor.resend',
  method: 'POST',
  path: '/api/v1/auth/second-factor/resend',
  access: { kind: 'pending-session', states: ['PENDING_SECOND_FACTOR'] },
  handler: async ({ session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    const result = await resendSecondFactor(session, clientIdHash);
    if (result.kind === 'refused') return fail(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: result.retryAfterSeconds });
    return ok({});
  },
});
