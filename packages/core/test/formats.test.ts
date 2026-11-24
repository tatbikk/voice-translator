import { describe, expect, it } from 'vitest';
import {
  fixedClock,
  formatCaseNumber,
  formatMoroccoDate,
  formatMoroccoTime,
  moroccoCalendarDate,
  parseCaseNumber,
  parseCaseNumberParts,
  safeInternalPath,
  toLatinDigits,
} from '../src/index';

describe('Moroccan dates', () => {
  it('uses the month names used in Morocco', () => {
    const months = Array.from({ length: 12 }, (_, m) => formatMoroccoDate(new Date(Date.UTC(2026, m, 15, 12))));
    expect(months).toEqual([
      '15 يناير 2026',
      '15 فبراير 2026',
      '15 مارس 2026',
      '15 أبريل 2026',
      '15 ماي 2026',
      '15 يونيو 2026',
      '15 يوليوز 2026',
      '15 غشت 2026',
      '15 شتنبر 2026',
      '15 أكتوبر 2026',
      '15 نونبر 2026',
      '15 دجنبر 2026',
    ]);
  });

  it('formats the time on 24 hours with Latin digits in the Morocco time zone', () => {
    // Expressed through the IANA zone, never a fixed offset: the zone database
    // carries Morocco's legal time, Ramadan changes included.
    const time = formatMoroccoTime(new Date('2026-11-24T08:05:00.000Z'));
    expect(time).toMatch(/^\d{2}:\d{2}$/);
    expect(moroccoCalendarDate(new Date('2026-11-24T08:05:00.000Z'))).toBe('2026-11-24');
  });

  it('provides a controllable clock for tests', () => {
    const clock = fixedClock(new Date('2026-11-24T09:00:00.000Z'));
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-11-24T09:01:00.000Z');
  });
});

describe('case-file number', () => {
  it('reads and writes number, code, year', () => {
    expect(formatCaseNumber({ number: 1234, code: 8201, year: 2026 })).toBe('1234/8201/2026');
    expect(parseCaseNumber(' 1234 / 8201 / 2026 ')).toEqual({ number: 1234, code: 8201, year: 2026 });
  });

  it('accepts Arabic-Indic digits', () => {
    const indic = (n: string) => Array.from(n, (d) => String.fromCodePoint(0x0660 + Number(d))).join('');
    const extended = (n: string) => Array.from(n, (d) => String.fromCodePoint(0x06f0 + Number(d))).join('');
    expect(toLatinDigits(indic('2026'))).toBe('2026');
    expect(parseCaseNumber(`${indic('1234')}/${extended('8201')}/${indic('2026')}`)).toEqual({
      number: 1234,
      code: 8201,
      year: 2026,
    });
  });

  it('refuses malformed and out-of-range numbers', () => {
    for (const text of ['', '1234/8201', '1234-8201-2026', '0/8201/2026', '1/1/1999', '1/1/20260', 'abc/1/2026']) {
      expect(parseCaseNumber(text)).toBeNull();
    }
    expect(parseCaseNumberParts('12', '8201', '2026')).toEqual({ number: 12, code: 8201, year: 2026 });
    expect(parseCaseNumberParts('12a', '8201', '2026')).toBeNull();
  });
});

describe('safe internal redirect', () => {
  const origin = 'https://mahkama.example';

  it('keeps an internal path, its query and its fragment', () => {
    expect(safeInternalPath('/dashboard', origin)).toBe('/dashboard');
    expect(safeInternalPath('/track?x=1#a', origin)).toBe('/track?x=1#a');
  });

  it('sends everything else to the home page', () => {
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/%09/evil.example',
      '/%2F%2Fevil.example',
      '/%5Cevil.example',
      'javascript:alert(1)',
      ' /dashboard',
      '/dash board',
      'dashboard',
      '',
      undefined,
      42,
      `/a${String.fromCodePoint(0x2028)}b`,
      `/${'a'.repeat(3000)}`,
      // Dot segments that resolve to a protocol-relative "//host" (review S-01).
      '/.//evil.example',
      '/././/evil.example',
      '/%2e//evil.example',
      '/%2E//evil.example',
      '/a/..//evil.example',
      '/a/%2e%2e//evil.example',
      '/.//evil.example/dashboard?x=1',
    ]) {
      expect(safeInternalPath(value, origin)).toBe('/');
    }
  });
});
