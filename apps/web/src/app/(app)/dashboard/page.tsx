import { formatMoroccoDate, formatMoroccoTime, roleLabelKey } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { Box } from '@/components/ui/Box';
import { NotificationItem } from '@/components/ui/NotificationItem';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { notificationText } from '@/components/shell/notification-text';
import { dashboardFor } from '@/server/dashboard/service';
import { requirePage } from '@/server/permissions/guard';
import { clock } from '@/server/clock';
import { CaseNumber } from '@/components/ui/CaseNumber';
import { longDay } from '@/components/case/format';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.dashboard');

// «لوحة البداية»: what is expected of the user before the list of files, in
// three boxes common to every role (study, «العناصر المشتركة»).
export default async function DashboardPage() {
  const context = await requirePage('dashboard', 'dashboard.view');
  const t = translator(context.locale);
  const { subject, session } = context;
  const data = await dashboardFor(subject, session.session.previousLoginAt, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
    now: clock.now(),
  });
  const numberLabel = t('common.caseNumberLabel');
  const roleText = t(roleLabelKey(subject.role, session.courtDegree));
  const dateTime = (d: Date) => t('common.dateTime', { date: formatMoroccoDate(d), time: formatMoroccoTime(d) });
  return (
    <Frame context={context}>
      <PageHeader
        title={t('screens.dashboard')}
        kicker={t('dashboard.roleLine', { role: roleText })}
      >
        <p className="mt-2 text-sm text-text-muted">
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
          headingLabel={t('dashboard.box.headingLabel', { title: t('dashboard.boxes.awaitingAction'), count: data.waiting.length })}
          emptyText={t('dashboard.empty.awaitingAction')}
        >
          <ul className="space-y-3">
            {data.waiting.map((w) => (
              <li key={`${w.caseFileId}:${w.labelKey}`} className="text-sm">
                <a href={`/cases/${w.caseFileId}`} className="font-semibold">
                  {t(w.labelKey)}
                </a>
                <span className="block text-text-muted">
                  <CaseNumber value={{ number: w.number, code: w.code, year: w.year }} labelTemplate={numberLabel} />
                </span>
              </li>
            ))}
          </ul>
        </Box>
        <Box
          id="deadlines"
          title={t('dashboard.boxes.approachingDeadlines')}
          count={data.deadlines.length}
          headingLabel={t('dashboard.box.headingLabel', { title: t('dashboard.boxes.approachingDeadlines'), count: data.deadlines.length })}
          emptyText={t('dashboard.empty.approachingDeadlines')}
        >
          <ul className="space-y-3">
            {data.deadlines.map((d) => (
              <li key={`${d.caseFileId}:${d.ruleCode}:${d.endsAt.toISOString()}`} className="text-sm">
                <a href={`/cases/${d.caseFileId}`} className="font-semibold">
                  {t(`case.deadlines.rule.${d.ruleCode}`)}
                </a>
                <span className="block text-text-muted">
                  {t('dashboard.deadline.lastDay', { day: longDay(d.lastDay) })}
                  {d.party ? ` — ${d.party}` : ''}
                </span>
                <span className="block text-text-muted">
                  <CaseNumber value={{ number: d.number, code: d.code, year: d.year }} labelTemplate={numberLabel} />
                </span>
              </li>
            ))}
          </ul>
        </Box>
        <Box
          id="new"
          title={t('dashboard.boxes.newSinceLastLogin')}
          count={data.newSinceLastLogin.length}
          headingLabel={t('dashboard.box.headingLabel', { title: t('dashboard.boxes.newSinceLastLogin'), count: data.newSinceLastLogin.length })}
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
                  surface="canvas"
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
