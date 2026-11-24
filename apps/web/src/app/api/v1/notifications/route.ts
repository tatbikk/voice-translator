import { listNotifications, unreadCount } from '@/server/notifications/service';
import { defineEndpoint } from '@/server/http/endpoint';
import { fail, ok } from '@/server/http/responses';

// The user's own notifications. The bell polls with X-Background-Refresh: 1,
// which does not keep an abandoned session alive.
export const GET = defineEndpoint({
  id: 'notifications.list',
  method: 'GET',
  path: '/api/v1/notifications',
  access: { kind: 'action', action: 'notifications.view-own' },
  handler: async ({ subject }) => {
    if (subject.kind !== 'user') return fail(401, 'SESSION_REQUIRED');
    const [items, unread] = await Promise.all([listNotifications(subject.userId, 20), unreadCount(subject.userId)]);
    return ok({
      unread,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        templateKey: n.templateKey,
        params: n.params,
        targetPath: n.targetPath,
        createdAt: n.createdAt.toISOString(),
        read: n.read,
      })),
    });
  },
});
