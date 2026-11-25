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
import { clock } from '@/server/clock';
import { casesOf } from '@/server/filings/lists';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.cases');

// «لائحة الملفات» (study, «واجهة المحامي»): the files the user may open.
export default async function CasesPage() {
  const context = await requirePage('cases', 'cases.list');
  const t = translator(context.locale);
  const rows = await casesOf(context.subject, { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() });
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
    </Frame>
  );
}
