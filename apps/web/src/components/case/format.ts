import { formatMoroccoDate, formatMoroccoTime } from '@mahkama/core';
import type { Translator } from '@/i18n/translate';

/** «486.000,00 درهم»: dirhams with the grouping used in Moroccan practice, Latin digits. */
export function dirhams(t: Translator, cents: bigint | number): string {
  const value = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return t('case.amount', { amount: `${negative ? '-' : ''}${whole},${fraction}` });
}

export function dateTime(t: Translator, at: Date): string {
  return t('common.dateTime', { date: formatMoroccoDate(at), time: formatMoroccoTime(at) });
}

/** A calendar day YYYY-MM-DD in the Moroccan long form. */
export function longDay(day: string): string {
  return formatMoroccoDate(new Date(`${day}T12:00:00Z`));
}
