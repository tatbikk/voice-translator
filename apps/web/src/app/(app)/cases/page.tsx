import { statusLabelKey } from '@mahkama/core';
import type { Metadata } from 'next';
import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { dateTime } from '@/components/case/format';
import { CaseNumber } from '@/components/ui/CaseNumber';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';
import { ListCut } from '@/components/ui/ListCut';
import { listCutLines } from '@/components/shell/list-cut-lines';
import { clock } from '@/server/clock';
import { casesOf } from '@/server/filings/lists';
import { pageFrom, pageHref } from '@/server/lists/paging';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.cases');

// «لائحة الملفات» (study, «واجهة المحامي»): the files the user may open, a
// page at a time (the page in the address, ?page=N), and under the table how
// many are shown of how many (independent review IR-11).
export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requirePage('cases', 'cases.list');
  const t = translator(context.locale);
  const page = await casesOf(context.subject, { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() }, pageFrom((await searchParams).page));
  const rows = page.rows;
  const cut = listCutLines(t, page, { list: t('screens.cases'), hrefFor: (n) => pageHref('/cases', { page: page.page }, 'page', n) });
  const numberLabel = t('common.caseNumberLabel');
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.cases')} />
      {rows.length === 0 ? (
        <EmptyState text={t('cases.empty')} />
      ) : (
        <TableFrame label={t('screens.cases')}>
          <table className={TABLE.table}>
            <caption className="sr-only">{t('screens.cases')}</caption>
            <thead>
              <tr className={TABLE.headRow}>
                <th scope="col" className={TABLE.th}>{t('case.header.number')}</th>
                <th scope="col" className={TABLE.th}>{t('cases.columns.parties')}</th>
                <th scope="col" className={TABLE.th}>{t('case.header.type')}</th>
                <th scope="col" className={TABLE.th}>{t('case.header.status')}</th>
                <th scope="col" className={TABLE.th}>{t('case.header.nextHearing')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={TABLE.row}>
                  <th scope="row" className={TABLE.rowHeader}>
                    <a href={`/cases/${r.id}`}>
                      <CaseNumber value={r.number} labelTemplate={numberLabel} />
                    </a>
                    <span className="block text-sm font-normal text-text-muted">{r.courtName}</span>
                  </th>
                  <td className={TABLE.td}>{r.parties.join(t('filing.listSeparator'))}</td>
                  <td className={TABLE.td}>{r.caseType ? t(`case.type.${r.caseType}`) : t('case.type.unknown')}</td>
                  <td className={TABLE.td}>{r.awaitingRapporteur ? t('case.status.awaitingRapporteur') : t(statusLabelKey(r.status as Parameters<typeof statusLabelKey>[0]))}</td>
                  <td className={TABLE.td}>{r.nextHearing ? dateTime(t, r.nextHearing) : '—'}</td>
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
