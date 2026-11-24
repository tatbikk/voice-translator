'use client';

import { translate } from '@/i18n/translate';
import { resolveLocale } from '@/i18n/locales';

// Error boundary view. Client side: the locale is read from the cookie the
// visitor can see (the language cookie is not HttpOnly). Without onRetry it
// needs no script at all (the global error page is static HTML, served only
// when the root layout itself fails, and carries no CSP nonce).
export function ErrorView({ onRetry }: { onRetry?: () => void }) {
  const match = typeof document === 'undefined' ? null : /(?:^|;\s*)__Host-mr-locale=([^;]+)/.exec(document.cookie);
  const locale = resolveLocale(match?.[1] ?? null);
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <div className="card px-6 py-8 sm:px-8">
        <h1 className="text-2xl">{translate(locale, 'errors.page.error.title')}</h1>
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
  );
}
