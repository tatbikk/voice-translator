import { DEFAULT_LOCALE, type Locale } from './locales';
import { MESSAGES } from './messages';

export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function hasMessage(key: string, locale: Locale = DEFAULT_LOCALE): boolean {
  return Object.hasOwn(MESSAGES[locale], key) || Object.hasOwn(MESSAGES[DEFAULT_LOCALE], key);
}

/** Message lookup with Arabic fallback. A missing key returns the key itself. */
export function translate(locale: Locale, key: string, params: MessageParams = {}): string {
  const own = MESSAGES[locale];
  const template = Object.hasOwn(own, key)
    ? own[key]
    : Object.hasOwn(MESSAGES[DEFAULT_LOCALE], key)
      ? MESSAGES[DEFAULT_LOCALE][key]
      : undefined;
  if (template === undefined) return key;
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** True when the locale has its own translation of the key (no fallback). */
export function isTranslated(locale: Locale, key: string): boolean {
  return Object.hasOwn(MESSAGES[locale], key);
}

export type Translator = (key: string, params?: MessageParams) => string;

export function translator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
}
