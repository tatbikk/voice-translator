import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { ActivateForm } from '@/components/forms/ActivateForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { requireGate } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.activate');

// «تفعيل الحساب»: the person sets the password of an account created for them.
export default async function ActivatePage() {
  const context = await requireGate('activate');
  const t = translator(context.locale);
  return (
    <Frame context={context} width="narrow">
      <PageHeader title={t('screens.activate')} />
      <ActivateForm
        labels={{
          password: t('activate.password'),
          confirm: t('activate.passwordConfirm'),
          submit: t('activate.submit'),
          done: t('activate.done'),
          mismatch: t('activate.mismatch'),
          noToken: t('activate.noToken'),
          login: t('activate.goToLogin'),
          hint: t('activate.intro'),
        }}
        messages={dictionary(context.locale, ['errors.'])}
      />
    </Frame>
  );
}
