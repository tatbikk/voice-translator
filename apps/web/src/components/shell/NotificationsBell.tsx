'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/components/client/api';

/**
 * Link to the notifications with the unread count. It refreshes in the
 * background with X-Background-Refresh, which does not keep an abandoned
 * session alive.
 */
export function NotificationsBell({ label, initialUnread, unreadTemplate }: { label: string; initialUnread: number; unreadTemplate: string }) {
  const [unread, setUnread] = useState(initialUnread);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void apiGet<{ unread: number }>('/api/v1/notifications', { background: true }).then((result) => {
        if (result.ok) setUnread(result.data.unread);
      });
    }, 60_000);
    return () => { window.clearInterval(timer); };
  }, []);
  return (
    <a href="/notifications" className="inline-flex min-h-11 items-center gap-2 px-3 text-text no-underline">
      <span>{label}</span>
      <span className="min-w-6 rounded-sm border border-line-strong px-1 text-center text-sm tabular-nums" aria-label={unreadTemplate.replace('{count}', String(unread))}>
        {unread}
      </span>
    </a>
  );
}
