'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/components/client/api';
import { NAV_ITEM } from './nav-style';

/**
 * Link to the notifications with the unread count. It refreshes in the
 * background with X-Background-Refresh, which does not keep an abandoned
 * session alive.
 */
export function NotificationsBell({
  label,
  initialUnread,
  unreadTemplate,
  current,
}: {
  label: string;
  initialUnread: number;
  unreadTemplate: string;
  current?: 'page' | undefined;
}) {
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
    <a href="/notifications" className={NAV_ITEM} aria-current={current}>
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={
          'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ' +
          (unread > 0 ? 'bg-ink-800 text-white' : 'border border-line-strong text-text-muted')
        }
      >
        {unread}
      </span>
      <span className="sr-only">{unreadTemplate.replace('{count}', String(unread))}</span>
    </a>
  );
}
