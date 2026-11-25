import { formatMoroccoDate } from '@mahkama/core';
import type { Metadata } from 'next';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { NewFilingButton } from '@/components/filing/NewFilingButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';
import { clock } from '@/server/clock';
import { draftsOf } from '@/server/filings/lists';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.filings');

// «مشاريع الإيداع»: the lawyer's drafts, saved at any screen, and «دعوى جديدة».
export default async function FilingsPage() {
  const context = await requirePage('filings', 'filing.drafts.list');
  const t = translator(context.locale);
  const drafts = await draftsOf(context.subject, { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() });
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.filings')}>
        <p className="mt-2 max-w-3xl text-text-muted">{t('filing.list.intro')}</p>
      </PageHeader>
      <div className="mb-8">
        <NewFilingButton path="/api/v1/filings" label={t('filing.newCase')} dict={dictionary(context.locale, ['errors.'])} />
      </div>
      {drafts.length === 0 ? (
        <EmptyState text={t('filing.list.empty')} />
      ) : (
        <TableFrame label={t('screens.filings')}>
          <table className={TABLE.table}>
            <caption className="sr-only">{t('screens.filings')}</caption>
            <thead>
              <tr className={TABLE.headRow}>
                <th scope="col" className={TABLE.th}>{t('filing.list.columns.caseType')}</th>
                <th scope="col" className={TABLE.th}>{t('filing.list.columns.court')}</th>
                <th scope="col" className={TABLE.th}>{t('filing.list.columns.status')}</th>
                <th scope="col" className={TABLE.th}>{t('filing.list.columns.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} className={TABLE.row}>
                  <th scope="row" className={TABLE.rowHeader}>
                    <a href={d.status === 'FILED' ? `/filings/${d.id}/receipt` : `/filings/${d.id}`}>{d.caseType ? t(`case.type.${d.caseType}`) : t('filing.list.noCaseType')}</a>
                  </th>
                  <td className={TABLE.td}>{d.courtName ?? '—'}</td>
                  <td className={TABLE.td}>{t(`filing.list.status.${d.status}`)}</td>
                  <td className={TABLE.td}>{formatMoroccoDate(d.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Frame>
  );
}
