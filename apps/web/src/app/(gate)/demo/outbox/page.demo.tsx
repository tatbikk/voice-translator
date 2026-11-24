import { formatMoroccoDate, formatMoroccoTime } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { requireDemo } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.demo-outbox');

// «صندوق الرسائل الصادرة» (demo tool). Built only with DEMO_BUILD=true.
export default async function OutboxPage() {
  const context = await requireDemo('demo.outbox', 'demo.outbox.view');
  const t = translator(context.locale);
  const { outboxFor } = await import('@/demo/server/services');
  const items = await outboxFor(context.session?.session.id ?? null, context.session?.actor ?? null, context.clientIdHash);
  return (
    <Frame context={context}>
      <PageHeader title={t('screens.demo-outbox')} intro={t('demo.outbox.intro')}>
        <p className="mt-2 text-sm text-text-muted">{t('demo.outbox.scope')}</p>
      </PageHeader>
      {items.length === 0 ? (
        <EmptyState text={t('demo.outbox.empty')} />
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id} className="card px-5 py-4">
              <p className="text-sm text-text-muted">
                <span className="font-semibold text-ink-800">{t(`demo.outbox.channel.${m.channel}`)}</span>
                <span aria-hidden="true"> · </span>
                {t('common.dateTime', { date: formatMoroccoDate(m.createdAt), time: formatMoroccoTime(m.createdAt) })}
              </p>
              <dl className="mt-2 grid gap-1 sm:grid-cols-[8rem_1fr]">
                <dt className="font-semibold">{t('demo.outbox.columns.sender')}</dt>
                <dd>{m.sender}</dd>
                <dt className="font-semibold">{t('demo.outbox.columns.recipient')}</dt>
                <dd>
                  <bdi dir="ltr">{m.recipientAddress}</bdi>
                </dd>
                <dt className="font-semibold">{t('demo.outbox.columns.body')}</dt>
                <dd className="break-words">{m.body}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
