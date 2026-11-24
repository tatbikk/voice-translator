import { redirect } from 'next/navigation';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { LoginForm } from '@/components/forms/LoginForm';
import { Notice } from '@/components/ui/Notice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { requireGate } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.login');

// «الدخول»: e-mail and password, then the confirmation code.
export default async function LoginPage() {
  const context = await requireGate('login');
  if (context.session?.subject) redirect('/dashboard');
  const t = translator(context.locale);
  return (
    <Frame context={context} width="narrow">
      <PageHeader title={t('screens.login')} intro={t('login.intro')} />
      {context.demoToolsEnabled ? (
        <div className="mb-6">
          <Notice>{t('login.demoAccounts')}</Notice>
        </div>
      ) : null}
      <LoginForm
        labels={{ email: t('auth.email'), password: t('auth.password'), submit: t('login.submit') }}
        messages={dictionary(context.locale, ['errors.'])}
      />
    </Frame>
  );
}
