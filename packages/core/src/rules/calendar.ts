// Calendar days and instants in Morocco (prompt, rule 6: «والتوقيت المعتمد توقيت
// المغرب»). A day is written YYYY-MM-DD; an instant is a Date. The offset of
// Africa/Casablanca changes during Ramadan, so it is read from the time-zone
// database for every conversion, never assumed.
import { MOROCCO_TZ } from '../clock';

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOROCCO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface LocalTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function moroccoLocal(at: Date): LocalTime {
  const values: Record<string, number> = {};
  for (const part of parts.formatToParts(at)) if (part.type !== 'literal') values[part.type] = Number(part.value);
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The calendar day in Morocco of an instant. */
export function moroccoDay(at: Date): string {
  const l = moroccoLocal(at);
  return `${pad(l.year, 4)}-${pad(l.month)}-${pad(l.day)}`;
}

/** «YYYY-MM-DD HH:mm» in Morocco as an instant. */
export function moroccoInstant(local: string): Date {
  const text = local.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.slice(0, 10)) && (text.length === 10 || /^[ T]\d{2}:\d{2}$/.test(text.slice(10)))
    ? [text, text.slice(0, 4), text.slice(5, 7), text.slice(8, 10), text.slice(11, 13) || '00', text.slice(14, 16) || '00']
    : null;
  if (!match) throw new Error(`not a Morocco local time: ${local}`);
  const [, y, mo, d, h = '00', mi = '00'] = match;
  const wanted = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Two passes settle the offset, including on the days it changes.
  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    const l = moroccoLocal(new Date(guess));
    const seen = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
    guess += wanted - seen;
  }
  return new Date(guess);
}

/** The first instant of a day in Morocco. */
export function startOfMoroccoDay(day: string): Date {
  return moroccoInstant(`${day} 00:00`);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n));
  return t.toISOString().slice(0, 10);
}

export function addMonths(day: string, n: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Days strictly between two days (both excluded). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) - 1;
}

export function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** The days on which a time limit cannot end (art. 603), as data. */
export interface HolidayCalendar {
  /** official holidays, YYYY-MM-DD */
  readonly dates: readonly string[];
  /** weekly days off, 0 for Sunday to 6 for Saturday */
  readonly weekendDays: readonly number[];
}

export function isHoliday(calendar: HolidayCalendar, day: string): boolean {
  return calendar.weekendDays.includes(weekday(day)) || calendar.dates.includes(day);
}
