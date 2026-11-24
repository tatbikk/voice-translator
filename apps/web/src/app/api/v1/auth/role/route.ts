import { z } from 'zod';
import { selectRole } from '@/server/auth/login';
import { sessionCookie } from '@/server/auth/sessions';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound, ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';

// «اختيار الصفة»: at login for a user holding several roles, or later to switch.
export const POST = defineEndpoint({
  id: 'auth.role',
  method: 'POST',
  path: '/api/v1/auth/role',
  access: { kind: 'pending-session', states: ['PENDING_ROLE'], orAction: 'account.switch-role' },
  body: z.object({ roleAssignmentId: uuidSchema }),
  handler: async ({ body, session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    const result = await selectRole(session, clientIdHash, body.roleAssignmentId);
    if (result.kind === 'not-found') return notFound();
    return ok({ next: 'dashboard' }, { cookies: [sessionCookie(result.token)] });
  },
});
