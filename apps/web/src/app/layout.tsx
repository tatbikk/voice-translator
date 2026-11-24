import '@fontsource-variable/noto-naskh-arabic/index.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-500.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import '@fontsource/noto-sans-tifinagh/400.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { directionOf, htmlLang, resolveLocale } from '@/i18n/locales';
import { translate } from '@/i18n/translate';
import { NonceProvider } from '@/components/ui/NonceProvider';
import { COOKIES, parseCookieHeader } from '@/server/http/cookies';

export async function generateMetadata(): Promise<Metadata> {
  const cookies = parseCookieHeader((await headers()).get('cookie'));
  const locale = resolveLocale(cookies.get(COOKIES.locale));
  return {
    title: translate(locale, 'common.platformName'),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// Reading the request headers makes every route dynamic: each page then
// carries the per-request nonce of the content security policy.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const incoming = await headers();
  const nonce = incoming.get('x-nonce') ?? '';
  const cookies = parseCookieHeader(incoming.get('cookie'));
  const locale = resolveLocale(cookies.get(COOKIES.locale));
  const reading = /^s([0-2])c([01])$/.exec(cookies.get(COOKIES.reading) ?? '');
  return (
    <html
      lang={htmlLang(locale)}
      dir={directionOf(locale)}
      data-text-size={reading?.[1] ?? '0'}
      data-contrast={reading?.[2] ?? '0'}
    >
      <body className="min-h-screen bg-canvas text-text antialiased">
        <NonceProvider nonce={nonce}>{children}</NonceProvider>
      </body>
    </html>
  );
}
