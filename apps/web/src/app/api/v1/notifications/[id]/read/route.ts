import { z } from 'zod';
import { markRead, notificationOwner } from '@/server/notifications/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';
import { uuidSchema } from '@/server/http/schemas';

export const POST = defineEndpoint({
  id: 'notifications.mark-read',
  method: 'POST',
  path: '/api/v1/notifications/:id/read',
  access: { kind: 'action', action: 'notifications.mark-read-own' },
  params: z.object({ id: uuidSchema }),
  // Someone else's notification is answered exactly like a missing one.
  resource: async ({ id }) => {
    const owner = await notificationOwner(id);
    return owner ? { kind: 'notification', ownerUserId: owner } : null;
  },
  handler: async ({ params, session, clientIdHash }) => {
    if (!session) return fail(401, 'SESSION_REQUIRED');
    await markRead(params.id, session.actor, clientIdHash);
    return ok({});
  },
});
