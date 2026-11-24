import { formatMoroccoDate, formatMoroccoTime } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { MarkReadButton } from '@/components/forms/MarkReadButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationItem } from '@/components/ui/NotificationItem';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { notificationText } from '@/components/shell/notification-text';
import { listNotifications } from '@/server/notifications/service';
import { requirePage } from '@/server/permissions/guard';

export default async function NotificationsPage() {
  const context = await requirePage('notifications', 'notifications.view-own');
  const t = translator(context.locale);
  const items = await listNotifications(context.subject.userId);
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.notifications')} />
      {items.length === 0 ? (
        <EmptyState text={t('notifications.empty')} />
      ) : (
        <ul className="max-w-3xl space-y-3">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationItem
                kind={n.kind}
                kindLabel={t(`notificationKinds.${n.kind}`)}
                text={notificationText(t, n.templateKey, n.params)}
                when={
                  <time dateTime={n.createdAt.toISOString()}>
                    {t('common.dateTime', { date: formatMoroccoDate(n.createdAt), time: formatMoroccoTime(n.createdAt) })}
                  </time>
                }
                read={n.read}
                readLabel={t('notifications.read')}
                action={
                  <span className="flex flex-wrap gap-4">
                    {n.targetPath ? <a href={n.targetPath}>{t('notifications.open')}</a> : null}
                    {n.read ? null : (
                      <MarkReadButton id={n.id} label={t('notifications.markRead')} doneLabel={t('notifications.read')} />
                    )}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
