import { SECURITY_POLICY } from '@mahkama/core';
import { z } from 'zod';
import { sessionCookie } from '@/server/auth/sessions';
import { defineEndpoint } from '@/server/http/endpoint';
import { ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';

// Account switcher (demo tool): demo accounts only; every switch is logged.
// The target is a query parameter so that it is known before authorization:
// an unknown target and a target that is not a demo account answer alike (404).
export const POST = defineEndpoint({
  id: 'demo.switch-account',
  method: 'POST',
  path: '/api/demo/switch-account',
  access: { kind: 'demo', action: 'demo.account.switch' },
  rateLimit: (clientIdHash) => ({ key: `demo:client:${clientIdHash}`, rule: SECURITY_POLICY.demoEndpoints.perClient }),
  params: z.object({ roleAssignmentId: uuidSchema }),
  resource: async ({ roleAssignmentId }) => {
    const { switchTarget } = await import('@/demo/server/services');
    return switchTarget(roleAssignmentId);
  },
  handler: async ({ params, session, clientIdHash }) => {
    const { switchAccount } = await import('@/demo/server/services');
    const token = await switchAccount(
      params.roleAssignmentId,
      { sessionId: session?.session.id ?? null, userId: session?.user.id ?? null },
      clientIdHash,
    );
    return ok({ next: '/dashboard' }, { cookies: [sessionCookie(token)] });
  },
});
