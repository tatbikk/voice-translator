import { ROLES, formatMoroccoDate, formatMoroccoTime, roleLabelKey } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { Box } from '@/components/ui/Box';
import { NotificationItem } from '@/components/ui/NotificationItem';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { notificationText } from '@/components/shell/notification-text';
import { dashboardFor } from '@/server/dashboard/service';
import { requirePage } from '@/server/permissions/guard';

// «لوحة البداية»: what is expected of the user before the list of files, in
// three boxes common to every role (study, «العناصر المشتركة»).
export default async function DashboardPage() {
  const context = await requirePage('dashboard', 'dashboard.view');
  const t = translator(context.locale);
  const { subject, session } = context;
  const data = await dashboardFor(subject, session.session.previousLoginAt);
  const roleText = t(roleLabelKey(subject.role));
  const dateTime = (d: Date) => t('common.dateTime', { date: formatMoroccoDate(d), time: formatMoroccoTime(d) });
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.dashboard')}>
        <p className="mt-2 text-text-muted">{t('dashboard.roleLine', { role: roleText, space: t(`spaces.${ROLES[subject.role].space}`) })}</p>
        <p className="mt-1 text-sm text-text-muted">
          {data.previousLoginAt
            ? t('dashboard.previousLogin', { date: formatMoroccoDate(data.previousLoginAt), time: formatMoroccoTime(data.previousLoginAt) })
            : t('dashboard.firstLogin')}
        </p>
      </PageHeader>
      {data.chainStatus === 'BROKEN' ? (
        <div className="mb-6">
          <Notice tone="error">{t('dashboard.chain.broken')}</Notice>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Box
          id="awaiting"
          title={t('dashboard.boxes.awaitingAction')}
          count={data.waiting.length}
          emptyText={t('dashboard.empty.awaitingAction')}
        />
        <Box
          id="deadlines"
          title={t('dashboard.boxes.approachingDeadlines')}
          count={data.deadlines.length}
          emptyText={t('dashboard.empty.approachingDeadlines')}
        />
        <Box
          id="new"
          title={t('dashboard.boxes.newSinceLastLogin')}
          count={data.newSinceLastLogin.length}
          emptyText={t('dashboard.empty.newSinceLastLogin')}
        >
          <ul className="space-y-3">
            {data.newSinceLastLogin.map((n) => (
              <li key={n.id}>
                <NotificationItem
                  kind={n.kind}
                  kindLabel={t(`notificationKinds.${n.kind}`)}
                  text={notificationText(t, n.templateKey, n.params)}
                  when={<time dateTime={n.createdAt.toISOString()}>{dateTime(n.createdAt)}</time>}
                  read={n.read}
                  action={n.targetPath ? <a href={n.targetPath}>{t('notifications.open')}</a> : undefined}
                />
              </li>
            ))}
          </ul>
        </Box>
      </div>
    </Frame>
  );
}
