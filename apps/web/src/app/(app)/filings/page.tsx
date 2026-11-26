import { authorize, formatMoroccoDate } from '@mahkama/core';
import type { Metadata } from 'next';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { NewFilingButton } from '@/components/filing/NewFilingButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';
import { ListCut } from '@/components/ui/ListCut';
import { listCutLines } from '@/components/shell/list-cut-lines';
import { clock } from '@/server/clock';
import { draftsOf } from '@/server/filings/lists';
import { pageFrom, pageHref } from '@/server/lists/paging';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.filings');

// «مشاريع الإيداع»: the lawyer's drafts, saved at any screen, and «دعوى جديدة»;
// a page at a time (?page=N), saying how many are shown of how many
// (independent review IR-11).
export default async function FilingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requirePage('filings', 'filing.drafts.list');
  const t = translator(context.locale);
  const authContext = { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() };
  const page = await draftsOf(context.subject, authContext, pageFrom((await searchParams).page));
  const drafts = page.rows;
  const cut = listCutLines(t, page, { list: t('screens.filings'), hrefFor: (n) => pageHref('/filings', { page: page.page }, 'page', n) });
  // A button is shown only to whoever holds its act (the registry clerk lists the paper drafts, files none here).
  const canFile = authorize(context.subject, 'filing.new', { kind: 'new-filing' }, authContext).allowed;
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.filings')}>
        <p className="mt-2 max-w-3xl text-text-muted">{t('filing.list.intro')}</p>
      </PageHeader>
      {canFile ? (
        <div className="mb-8">
          <NewFilingButton path="/api/v1/filings" label={t('filing.newCase')} dict={dictionary(context.locale, ['errors.'])} />
        </div>
      ) : null}
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
      <ListCut lines={cut} />
    </Frame>
  );
}
