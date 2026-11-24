import type { Locale } from './locales';
import { MESSAGES } from './messages';
import { translate } from './translate';

/** The messages a client form needs, already resolved for the locale (Arabic fallback). */
export function dictionary(locale: Locale, prefixes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(MESSAGES.ar)) {
    if (prefixes.some((p) => key.startsWith(p))) out[key] = translate(locale, key);
  }
  return out;
}
