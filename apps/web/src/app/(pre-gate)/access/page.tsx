import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeInternalPath } from '@mahkama/core';
import { dictionary } from '@/i18n/dictionary';
import { directionOf, resolveLocale } from '@/i18n/locales';
import { translator } from '@/i18n/translate';
import { AccessForm } from '@/components/forms/AccessForm';
import { LogoSlot } from '@/components/shell/LogoSlot';
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
    <div dir={directionOf(locale)}>
      {/* The letterhead alone: no navigation and no demo tool before the gate. */}
      <header className="bg-paper">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 lg:py-4">
          <LogoSlot label={t('shell.logoSlot')} logoUrl={null} />
          <p className="font-naskh text-xl leading-tight font-bold text-ink-900 sm:text-2xl">{t('common.platformName')}</p>
        </div>
        <div aria-hidden="true" className="rule-letterhead" />
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-10 sm:py-14">
        <div className="card px-5 py-6 sm:px-8 sm:py-8">
          <h1 className="text-[1.75rem] sm:text-[2.125rem]">{t('screens.access')}</h1>
          <p className="mt-3 text-text-muted">{t('access.intro')}</p>
          <div className="mt-7">
            <AccessForm
              next={next}
              labels={{ code: t('auth.accessCode'), submit: t('access.submit') }}
              messages={dictionary(locale, ['errors.'])}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
