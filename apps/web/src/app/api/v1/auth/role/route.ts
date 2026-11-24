import { z } from 'zod';
import { selectRole } from '@/server/auth/login';
import { sessionCookie } from '@/server/auth/sessions';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, notFound, ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';
import { recordRefusal } from '@/server/security/refusals';

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
    if (result.kind === 'not-found') {
      // A role assignment that is not the user's own: refused and logged (review S-10).
      await recordRefusal({
        step: 'AUTHZ',
        reason: 'NOT_FOUND',
        target: 'auth.role',
        clientIdHash,
        sessionId: session.session.id,
        actor: session.actor,
      });
      return notFound();
    }
    return ok({ next: 'dashboard' }, { cookies: [sessionCookie(result.token)] });
  },
});
