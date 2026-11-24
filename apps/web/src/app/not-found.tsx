import { headers } from 'next/headers';
import { resolveLocale } from '@/i18n/locales';
import { translator } from '@/i18n/translate';
import { COOKIES, parseCookieHeader } from '@/server/http/cookies';

export default async function NotFound() {
  const locale = resolveLocale(parseCookieHeader((await headers()).get('cookie')).get(COOKIES.locale));
  const t = translator(locale);
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl">{t('errors.page.notFound.title')}</h1>
      <p className="mt-4 text-text-muted">{t('errors.page.notFound.text')}</p>
      <p className="mt-8">
        <a href="/">{t('errors.page.home')}</a>
      </p>
    </main>
  );
}
