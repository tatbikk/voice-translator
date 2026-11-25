import { authorize, formatMoroccoDate, formatMoroccoTime, roleLabelKey } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { NewFilingButton } from '@/components/filing/NewFilingButton';
import { prosecutionReferrals, type ReferredFile } from '@/server/offices/prosecution';
import type { Translator } from '@/i18n/translate';
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
import { buttonClass } from '@/components/ui/Button';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.dashboard');

// «لوحة البداية»: what is expected of the user before the list of files, in
// three boxes common to every role (study, «العناصر المشتركة»).
export default async function DashboardPage() {
  const context = await requirePage('dashboard', 'dashboard.view');
  const t = translator(context.locale);
  const { subject, session } = context;
  const authContext = { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() };
  const [data, referrals] = await Promise.all([dashboardFor(subject, session.session.previousLoginAt, authContext), prosecutionReferrals(subject, authContext)]);
  const canFile = authorize(subject, 'filing.new', { kind: 'new-filing' }, authContext).allowed;
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
      {canFile ? (
        <div className="mb-6">
          <NewFilingButton path="/api/v1/filings" label={t('filing.newCase')} dict={dictionary(context.locale, ['errors.'])} />
        </div>
      ) : null}
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
      {referrals ? (
        <section aria-labelledby="referrals-title" className="mt-10">
          <h2 id="referrals-title" className="mb-4 text-2xl">
            {t('prosecution.referrals')}
          </h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <ReferralList t={t} title={t('prosecution.principalParty')} rows={referrals.principalParty} />
            <ReferralList t={t} title={t('prosecution.communication')} rows={referrals.communication} />
          </div>
        </section>
      ) : null}
    </Frame>
  );
}

function ReferralList({ t, title, rows }: { t: Translator; title: string; rows: readonly ReferredFile[] }) {
  const numberLabel = t('common.caseNumberLabel');
  return (
    <div className="card px-5 py-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-text-muted">{t('prosecution.none')}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={`${r.caseFileId}:${String(r.article)}`} className="text-sm">
              <a href={`/cases/${r.caseFileId}`} className="font-semibold">
                <CaseNumber value={r.number} labelTemplate={numberLabel} />
              </a>
              <span className="block text-text-muted">
                {t(`prosecution.reason.${r.reasonCode}`)} — {t(r.item ? 'prosecution.basisItem' : 'prosecution.basis', { article: r.article, item: r.item ?? '' })}
              </span>
              {/* The study's button: «الاطلاع على الملف» (audit G083). */}
              <a href={`/cases/${r.caseFileId}`} className={buttonClass('secondary', 'mt-2')}>
                {t('actions.case.prosecution.view.label')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
