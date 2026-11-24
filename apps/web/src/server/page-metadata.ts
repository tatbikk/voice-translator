import 'server-only';
import type { Metadata } from 'next';
import { translate } from '@/i18n/translate';
import { currentLocale } from './permissions/guard';

/**
 * The document title of a page: its screen name, then the platform's name
 * («{screen} | منصة المحكمة الرقمية»). A screen reader announces it first, and it
 * names the browser tab (WCAG 2.4.2).
 */
export async function screenMetadata(screenKey: string): Promise<Metadata> {
  const locale = await currentLocale();
  return { title: { absolute: translate(locale, 'common.documentTitle', { screen: translate(locale, screenKey) }) } };
}
