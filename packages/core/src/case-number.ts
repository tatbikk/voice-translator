// The case-file number familiar to litigants: number, then code, then year
// (for example 1234/8201/2026). Arabic-Indic digits are accepted on input.

export interface CaseNumber {
  readonly number: number;
  readonly code: number;
  readonly year: number;
}

/** Converts Arabic-Indic (U+0660-0669) and extended Arabic-Indic (U+06F0-06F9) digits to Latin digits. */
export function toLatinDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0660 && cp <= 0x0669) out += String(cp - 0x0660);
    else if (cp >= 0x06f0 && cp <= 0x06f9) out += String(cp - 0x06f0);
    else out += ch;
  }
  return out;
}

export const CASE_NUMBER_LIMITS = {
  number: { min: 1, max: 999_999 },
  code: { min: 1, max: 9_999 },
  year: { min: 2000, max: 2100 },
} as const;

export function isValidCaseNumber(value: CaseNumber): boolean {
  const within = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max;
  return (
    within(value.number, CASE_NUMBER_LIMITS.number) &&
    within(value.code, CASE_NUMBER_LIMITS.code) &&
    within(value.year, CASE_NUMBER_LIMITS.year)
  );
}

export function formatCaseNumber(value: CaseNumber): string {
  return `${String(value.number)}/${String(value.code)}/${String(value.year)}`;
}

export function parseCaseNumber(text: string): CaseNumber | null {
  const match = /^\s*(\d{1,6})\s*\/\s*(\d{1,4})\s*\/\s*(\d{4})\s*$/.exec(toLatinDigits(text));
  if (!match) return null;
  const value = { number: Number(match[1]), code: Number(match[2]), year: Number(match[3]) };
  return isValidCaseNumber(value) ? value : null;
}

export function parseCaseNumberParts(number: string, code: string, year: string): CaseNumber | null {
  const digits = (s: string) => /^\d{1,6}$/.test(s);
  const n = toLatinDigits(number.trim());
  const c = toLatinDigits(code.trim());
  const y = toLatinDigits(year.trim());
  if (!digits(n) || !digits(c) || !/^\d{4}$/.test(y)) return null;
  const value = { number: Number(n), code: Number(c), year: Number(y) };
  return isValidCaseNumber(value) ? value : null;
}
