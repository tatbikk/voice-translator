import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { ConfirmForm } from '@/components/forms/ConfirmForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { requirePending } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.login-confirm');

// «وسيلة التأكيد الثانية»: the six-digit code sent to the account's phone (in
// the demo environment: to the outbox).
export default async function ConfirmPage() {
  const context = await requirePending('login.confirm', ['PENDING_SECOND_FACTOR']);
  const t = translator(context.locale);
  return (
    <Frame context={context} width="narrow">
      <PageHeader title={t('screens.login-confirm')} intro={t('confirm.intro')} />
      <ConfirmForm
        labels={{
          code: t('auth.confirmationCode'),
          submit: t('confirm.submit'),
          resend: t('auth.resendCode'),
          resent: t('confirm.resent'),
        }}
        messages={dictionary(context.locale, ['errors.'])}
      />
      {context.demoToolsEnabled ? (
        <p className="mt-8">
          <a href="/demo/outbox">{t('confirm.outboxLink')}</a>
        </p>
      ) : null}
    </Frame>
  );
}
