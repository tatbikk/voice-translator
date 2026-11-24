// Time as the core sees it: an interface, never a read of the system clock.
// now() is platform time (legal time); systemNow() is real elapsed time used by
// security timers only. Formatting follows Morocco: Africa/Casablanca, the month
// names used in Morocco (provided by ICU for the ar-MA locale), Latin digits.

export interface Clock {
  now(): Date;
  systemNow(): Date;
}

export const MOROCCO_TZ = 'Africa/Casablanca';

const dateFormat = new Intl.DateTimeFormat('ar-MA', {
  timeZone: MOROCCO_TZ,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  numberingSystem: 'latn',
});

const timeFormat = new Intl.DateTimeFormat('ar-MA', {
  timeZone: MOROCCO_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  numberingSystem: 'latn',
});

const isoDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOROCCO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** «24 نونبر 2026» */
export function formatMoroccoDate(date: Date): string {
  return dateFormat.format(date);
}

/** «09:05» */
export function formatMoroccoTime(date: Date): string {
  return timeFormat.format(date);
}

/** Calendar date in Morocco, as YYYY-MM-DD. */
export function moroccoCalendarDate(date: Date): string {
  return isoDateFormat.format(date);
}

export interface ControllableClock extends Clock {
  advance(ms: number): void;
  set(date: Date): void;
}

/** A clock for tests: both readings start at `at` and move only when told. */
export function fixedClock(at: Date): ControllableClock {
  let current = at.getTime();
  return {
    now: () => new Date(current),
    systemNow: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
    set(date: Date) {
      current = date.getTime();
    },
  };
}
