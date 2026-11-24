import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeInternalPath } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { directionOf, resolveLocale } from '@/i18n/locales';
import { translator } from '@/i18n/translate';
import { AccessForm } from '@/components/forms/AccessForm';
import { getEnv } from '@/server/config/env';
import { gateRequired, verifyAccessCookieValue } from '@/server/auth/access-gate';
import { COOKIES, parseCookieHeader } from '@/server/http/cookies';
import type { Metadata } from 'next';
import { screenMetadata } from '@/server/page-metadata';

export const generateMetadata = (): Promise<Metadata> => screenMetadata('screens.access');

// «كلمة عبور الزوار»: the only page shown before the visitor gate. It renders
// no demo tool and no platform data.
export default async function AccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const nextParam = typeof params.next === 'string' ? params.next : '/';
  const next = safeInternalPath(nextParam, getEnv().appOrigin);
  if (!gateRequired()) redirect(next);
  const cookies = parseCookieHeader((await headers()).get('cookie'));
  if (verifyAccessCookieValue(cookies.get(COOKIES.access))) redirect(next);
  const locale = resolveLocale(cookies.get(COOKIES.locale));
  const t = translator(locale);
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16" dir={directionOf(locale)}>
      <p className="font-naskh text-lg font-bold text-ink-900">{t('common.platformName')}</p>
      <h1 className="mt-6 text-2xl">{t('screens.access')}</h1>
      <p className="mt-3 text-text-muted">{t('access.intro')}</p>
      <div className="mt-8">
        <AccessForm
          next={next}
          labels={{ code: t('auth.accessCode'), submit: t('access.submit') }}
          messages={dictionary(locale, ['errors.'])}
        />
      </div>
    </main>
  );
}
