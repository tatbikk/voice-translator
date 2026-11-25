import type { Metadata } from 'next';
import { translator, type Translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { dateTime, dirhams } from '@/components/case/format';
import { CaseNumber } from '@/components/ui/CaseNumber';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { TABLE } from '@/components/ui/table-style';
import { TableFrame } from '@/components/ui/TableFrame';
import { draftResource } from '@/server/filings/drafts';
import { receiptView } from '@/server/filings/receipt';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.filings-:draftId-receipt');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ReceiptDocument = NonNullable<Awaited<ReturnType<typeof receiptView>>>['documents'][number];

/** The application is named as such on the receipt, not by the name of the file uploaded (review P2-L-03). */
const isApplication = (d: ReceiptDocument) => d.docType === 'APPLICATION' || d.docType === 'APPLICATION_SOURCE';

/**
 * The column «نوعية الوثيقة» (review P2-L-03): the nature declared (art. 631); else «ولدتها
 * المنصة» for what the platform printed; else, in a paper filing, the scan whose paper
 * original the registry keeps; else nothing.
 */
function natureText(t: Translator, d: ReceiptDocument, paper: boolean): string {
  if (d.declaredNature) return t(`case.nature.${d.declaredNature}`);
  if (d.generated) return t('filing.receipt.generated');
  return t(paper ? 'filing.receipt.scanned' : 'case.nature.none');
}

// «وصل الإيداع» (study, «المرحلة الأولى»; art. 628): the number of the file,
// its national identifier, the date and hour of filing, each document with its
// declared nature and its fingerprint, and the payment.
export default async function ReceiptPage({ params }: { params: Promise<{ draftId: string }> }) {
  const context = await requirePage('filing.receipt', 'filing.draft.read', async () => {
    const { draftId } = await params;
    return UUID.test(draftId) ? draftResource(draftId) : null;
  });
  const t = translator(context.locale);
  const { draftId } = await params;
  const receipt = await receiptView(draftId);
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.filings-:draftId-receipt')} />
      {!receipt ? (
        <Notice tone="info">
          {t('filing.receipt.notFiled')} <a href={`/filings/${draftId}`}>{t('filing.receipt.backToDraft')}</a>
        </Notice>
      ) : (
        <>
          <dl className="card mb-8 grid gap-x-8 gap-y-3 px-5 py-5 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-text-muted">{t('case.header.number')}</dt>
              <dd className="text-lg font-semibold">
                <CaseNumber value={receipt.number} labelTemplate={t('common.caseNumberLabel')} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t('case.header.nationalRef')}</dt>
              <dd>
                <bdi className="ltr-run" dir="ltr">{receipt.nationalRef}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t('case.header.court')}</dt>
              <dd>{receipt.courtName}</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t('filing.receipt.filedAt')}</dt>
              <dd>{receipt.registeredAt ? dateTime(t, receipt.registeredAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t('filing.receipt.channel')}</dt>
              <dd>{t(`case.channel.${receipt.channel}`)}</dd>
            </div>
            {receipt.payment ? (
              <div>
                <dt className="text-sm text-text-muted">{t('filing.receipt.payment')}</dt>
                <dd>
                  {dirhams(t, receipt.payment.amountCents)} — <bdi dir="ltr">{receipt.payment.operationRef}</bdi>
                </dd>
              </div>
            ) : null}
            {receipt.bailiffName ? (
              <div>
                <dt className="text-sm text-text-muted">{t('filing.sign.bailiff')}</dt>
                <dd>{receipt.bailiffName}</dd>
              </div>
            ) : null}
          </dl>
          <TableFrame label={t('filing.receipt.documents')}>
            <table className={TABLE.table}>
              <caption className="sr-only">{t('filing.receipt.documents')}</caption>
              <thead>
                <tr className={TABLE.headRow}>
                  <th scope="col" className={TABLE.th}>{t('case.documents.columns.document')}</th>
                  <th scope="col" className={TABLE.th}>{t('terms.documentNature')}</th>
                  <th scope="col" className={TABLE.th}>{t('filing.receipt.fingerprint')}</th>
                </tr>
              </thead>
              <tbody>
                {receipt.documents.map((d) => (
                  <tr key={d.id} className={TABLE.row}>
                    <th scope="row" className={TABLE.rowHeader}>{isApplication(d) && !d.generated ? t('terms.initialApplication') : (d.title ?? t(`case.docType.${d.docType}`))}</th>
                    <td className={TABLE.td}>{natureText(t, d, receipt.channel === 'PAPER')}</td>
                    <td className={TABLE.td}>
                      <code dir="ltr" className="text-xs break-all">{d.sha256}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <div className="mt-8 flex flex-wrap gap-6">
            <a href={`/cases/${receipt.caseFileId}`}>{t('filing.receipt.casePage')}</a>
            {receipt.receiptDocumentId ? (
              <a href={`/api/v1/cases/${receipt.caseFileId}/documents/${receipt.receiptDocumentId}/file`}>{t('filing.receipt.download')}</a>
            ) : (
              <span className="text-text-muted">{t('filing.receipt.printing')}</span>
            )}
          </div>
        </>
      )}
    </Frame>
  );
}
