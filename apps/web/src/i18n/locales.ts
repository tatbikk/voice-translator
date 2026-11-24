// Locales of the interface: Arabic is complete; French and Amazigh (Tifinagh)
// translate the top bar and the main navigation, and fall back to Arabic.
export const LOCALES = ['ar', 'fr', 'zgh'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

const TABLE: Readonly<Record<string, Locale>> = { ar: 'ar', fr: 'fr', zgh: 'zgh' };

/** Maps any cookie value through a fixed table; anything else is Arabic. */
export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  return Object.hasOwn(TABLE, value) ? (TABLE[value] ?? DEFAULT_LOCALE) : DEFAULT_LOCALE;
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function htmlLang(locale: Locale): string {
  return locale === 'zgh' ? 'zgh-Tfng' : locale === 'fr' ? 'fr-MA' : 'ar-MA';
}
