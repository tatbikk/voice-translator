import { safeInternalPath } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { translator } from '@/i18n/translate';
import { ReauthForm } from '@/components/forms/ReauthForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { Frame } from '@/components/shell/Frames';
import { getEnv } from '@/server/config/env';
import { requirePage } from '@/server/permissions/guard';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.reauth');

// «إعادة التحقق من الهوية» before a sensitive action.
export default async function ReauthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requirePage('reauth', 'account.view-own');
  const t = translator(context.locale);
  const params = await searchParams;
  const next = safeInternalPath(typeof params.next === 'string' ? params.next : '/account', getEnv().appOrigin);
  return (
    <Frame context={context} width="narrow">
      <PageHeader title={t('screens.reauth')} intro={t('reauth.intro')} />
      <ReauthForm next={next} labels={{ password: t('auth.password'), submit: t('reauth.submit') }} messages={dictionary(context.locale, ['errors.'])} />
    </Frame>
  );
}
