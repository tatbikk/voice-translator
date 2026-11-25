import type { Metadata } from 'next';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { Frame } from '@/components/shell/Frames';
import { dateTime, dirhams } from '@/components/case/format';
import { GatewayButtons } from '@/components/payment/GatewayButtons';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { clock } from '@/server/clock';
import { intentResource } from '@/server/payments/service';
import { intentView } from '@/server/filings/receipt';
import { screenMetadata } from '@/server/page-metadata';
import { requirePage } from '@/server/permissions/guard';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.payments-:intentId');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// «أداء (محاكاة)» (prompt, «الأداء»): the page of the simulated gateway, with
// its three answers; once paid, «وصل الأداء» with the operation reference.
export default async function PaymentPage({ params }: { params: Promise<{ intentId: string }> }) {
  const context = await requirePage('payment', 'payment.view', async () => {
    const { intentId } = await params;
    return UUID.test(intentId) ? intentResource(intentId) : null;
  });
  const t = translator(context.locale);
  const { intentId } = await params;
  const intent = await intentView(intentId, clock.now());
  if (!intent) return null;
  const back = `/filings/${intent.draftId}?step=${intent.status === 'SUCCEEDED' ? '6' : '5'}`;
  return (
    <Frame context={context}>
      <PageHeader title={t('payment.simulatedTitle')} {...(intent.courtName ? { kicker: intent.courtName } : {})} />
      <div className="mb-6">
        <Notice tone="warning">{t('payment.simulatedNotice')}</Notice>
      </div>
      <dl className="card mb-8 grid gap-x-8 gap-y-3 px-5 py-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-text-muted">{t('payment.amount')}</dt>
          <dd className="text-lg font-semibold">{dirhams(t, intent.amountCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-muted">{t('payment.method')}</dt>
          <dd>{t(`filing.payment.method.${intent.method}`)}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-muted">{t('payment.purpose')}</dt>
          <dd>{t('terms.courtFee')}</dd>
        </div>
      </dl>
      {intent.status === 'PENDING' ? (
        <section aria-labelledby="gateway-title">
          <h2 id="gateway-title" className="mb-4 text-xl">{t('payment.choose')}</h2>
          <GatewayButtons
            intentId={intent.id}
            dict={dictionary(context.locale, ['errors.'])}
            labels={{ SUCCEEDED: t('payment.succeed'), FAILED: t('payment.fail'), CANCELLED: t('common.cancel') }}
          />
        </section>
      ) : intent.status === 'SUCCEEDED' && intent.payment ? (
        <section aria-labelledby="receipt-title" className="card px-5 py-5">
          <h2 id="receipt-title" className="text-xl">{t('payment.receipt')}</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-text-muted">{t('payment.operationRef')}</dt>
              <dd>
                <bdi dir="ltr">{intent.payment.operationRef}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t('payment.paidAt')}</dt>
              <dd>{dateTime(t, intent.payment.paidAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t('payment.amount')}</dt>
              <dd>{dirhams(t, intent.amountCents)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-text-muted">{t('payment.treasuryEntry')}</p>
          {intent.receiptDocumentId ? (
            <p className="mt-2">
              <a href={`/api/v1/filings/${intent.draftId}/documents/${intent.receiptDocumentId}/file`}>{t('payment.downloadReceipt')}</a>
            </p>
          ) : (
            <p className="mt-2 text-sm text-text-muted">{t('payment.receiptPrinting')}</p>
          )}
        </section>
      ) : (
        <Notice tone="error">{t(`payment.outcome.${intent.status}`)}</Notice>
      )}
      <p className="mt-8">
        <a href={back}>{t('payment.backToDraft')}</a>
      </p>
    </Frame>
  );
}
