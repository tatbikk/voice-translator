import type { Metadata } from 'next';
import { translator, type Translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { dateTime, dirhams } from '@/components/case/format';
import { CaseNumber } from '@/components/ui/CaseNumber';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';
import { clock } from '@/server/clock';
import { cashierLedger, type LedgerPayment } from '@/server/offices/cashier';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.cashier');

// «الصندوق» (study, «واجهة كتابة الضبط»): «الأداءات الواردة ومطابقتها للطلبات»
// and «المبالغ المودعة على ذمة إجراءات التحقيق».
export default async function CashierPage() {
  const context = await requirePage('cashier', 'cashier.ledger.view');
  const t = translator(context.locale);
  const ledger = await cashierLedger(context.subject, { mode: context.mode, demoToolsEnabled: context.demoToolsEnabled, now: clock.now() });
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.cashier')}>
        <p className="mt-2 max-w-3xl text-text-muted">{t('cashier.intro')}</p>
      </PageHeader>
      <section aria-labelledby="payments-title" className="mb-10">
        <h2 id="payments-title" className="mb-4 text-2xl">{t('cashier.incoming')}</h2>
        <Ledger t={t} rows={ledger.payments} empty={t('cashier.emptyPayments')} label={t('cashier.incoming')} match />
      </section>
      <section aria-labelledby="deposits-title">
        <h2 id="deposits-title" className="mb-4 text-2xl">{t('cashier.deposits')}</h2>
        <Ledger t={t} rows={ledger.deposits} empty={t('cashier.emptyDeposits')} label={t('cashier.deposits')} match={false} />
      </section>
    </Frame>
  );
}

function Ledger({ t, rows, empty, label, match }: { t: Translator; rows: readonly LedgerPayment[]; empty: string; label: string; match: boolean }) {
  if (rows.length === 0) return <EmptyState text={empty} />;
  const numberLabel = t('common.caseNumberLabel');
  return (
    <TableFrame label={label}>
      <table className={TABLE.table}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className={TABLE.th}>{t('cashier.columns.operation')}</th>
            <th scope="col" className={TABLE.th}>{t('cashier.columns.file')}</th>
            <th scope="col" className={TABLE.th}>{t('cashier.columns.amount')}</th>
            <th scope="col" className={TABLE.th}>{t('cashier.columns.method')}</th>
            <th scope="col" className={TABLE.th}>{t('cashier.columns.status')}</th>
            {match ? <th scope="col" className={TABLE.th}>{t('cashier.columns.match')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={TABLE.row}>
              <th scope="row" className={TABLE.rowHeader}>
                <bdi dir="ltr">{r.operationRef}</bdi>
                <span className="block text-sm font-normal text-text-muted">{dateTime(t, r.paidAt)}</span>
              </th>
              <td className={TABLE.td}>{r.caseFile ? <a href={`/cases/${r.caseFile.id}`}><CaseNumber value={r.caseFile} labelTemplate={numberLabel} /></a> : t('cashier.notFiled')}</td>
              <td className={TABLE.td}>{dirhams(t, r.amountCents)}</td>
              <td className={TABLE.td}>{t(`filing.payment.method.${r.method ?? 'ONLINE'}`)}</td>
              <td className={TABLE.td}>{t(`cashier.status.${r.status}`)}</td>
              {match ? (
                <td className={TABLE.td}>
                  {r.status !== 'SUCCEEDED' ? '—' : r.assessedCents === null ? t('cashier.match.unknown') : r.assessedCents === r.amountCents ? t('cashier.match.yes') : t('cashier.match.no', { amount: dirhams(t, r.assessedCents) })}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
