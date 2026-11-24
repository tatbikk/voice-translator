'use client';

import { translate } from '@/i18n/translate';
import { directionOf, resolveLocale } from '@/i18n/locales';
import { LogoSlot } from './LogoSlot';

// Error boundary view. Client side: the locale is read from the cookie the
// visitor can see (the language cookie is not HttpOnly). Without onRetry it
// needs no script at all (the global error page is static HTML, served only
// when the root layout itself fails, and carries no CSP nonce).
export function ErrorView({ onRetry }: { onRetry?: () => void }) {
  const match = typeof document === 'undefined' ? null : /(?:^|;\s*)__Host-mr-locale=([^;]+)/.exec(document.cookie);
  const locale = resolveLocale(match?.[1] ?? null);
  return (
    <div dir={directionOf(locale)}>
      <header className="bg-paper">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 lg:py-4">
          <LogoSlot label={translate(locale, 'shell.logoSlot')} logoUrl={null} />
          <p className="font-naskh text-xl leading-tight font-bold text-ink-900 sm:text-2xl">
            {translate(locale, 'common.platformName')}
          </p>
        </div>
        <div aria-hidden="true" className="rule-letterhead" />
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-10 sm:py-14">
        <div className="card px-5 py-6 sm:px-8 sm:py-8">
          <h1 className="text-[1.75rem] sm:text-[2.125rem]">{translate(locale, 'errors.page.error.title')}</h1>
          <p className="mt-4">{translate(locale, 'errors.page.error.text')}</p>
          <p className="mt-8 flex flex-wrap gap-6">
            {onRetry ? (
              <button type="button" className="underline" onClick={onRetry}>
                {translate(locale, 'errors.page.retry')}
              </button>
            ) : (
              <a href="">{translate(locale, 'errors.page.retry')}</a>
            )}
            <a href="/">{translate(locale, 'errors.page.home')}</a>
          </p>
        </div>
      </main>
    </div>
  );
}
