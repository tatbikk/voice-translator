import { z } from 'zod';
import { SECURITY_POLICY } from '@mahkama/core';
import { accountResource, reissueActivation } from '@/server/accounts/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';

export const POST = defineEndpoint({
  id: 'admin.accounts.reissue-activation',
  method: 'POST',
  path: '/api/v1/admin/accounts/:id/activation',
  access: { kind: 'action', action: 'admin.accounts.reissue-activation' },
  recentAuthMinutes: SECURITY_POLICY.reauth.windowMs / 60_000,
  params: z.object({ id: uuidSchema }),
  resource: async ({ id }) => accountResource(id),
  handler: async ({ params, session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    await reissueActivation(params.id, { actor: session.actor, sessionId: session.session.id, clientIdHash });
    return ok({});
  },
});
