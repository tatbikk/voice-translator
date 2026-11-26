// Interface texts (contract §9, docs/glossary.md): the Arabic files are the
// reference; every label of a role, a procedural state, a notification kind and
// a space equals the approved term of the glossary letter for letter; the
// glossary's style rules hold for every Arabic text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_CODES, ROLE_CODES, ROLES } from '@mahkama/core';
import { AR_FILES, MESSAGES } from '@/i18n/messages';
import { PAGES } from '@/server/http/page-registry';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const ar = MESSAGES.ar;

interface GlossaryRow {
  readonly term: string;
  readonly keys: readonly string[];
}

function glossaryRows(): GlossaryRow[] {
  const rows: GlossaryRow[] = [];
  for (const line of readFileSync(join(REPO, 'docs', 'glossary.md'), 'utf8').split('\n')) {
    if (!line.startsWith('|') || line.startsWith('| ---')) continue;
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    const [, term, , keyCell] = cells;
    if (term === undefined || keyCell === undefined) continue;
    const keys = Array.from(keyCell.matchAll(/`([A-Za-z][\w.-]*)`/g), (m) => m[1] ?? '').filter(Boolean);
    if (keys.length > 0) rows.push({ term, keys });
  }
  return rows;
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const placeholders = (text: string) => Array.from(text.matchAll(PLACEHOLDER), (m) => m[1]).sort();

// Arabic-Indic and Eastern Arabic-Indic digits, built from code points.
const range = (from: number, to: number) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const INDIC_DIGITS = new RegExp(`[${range(0x660, 0x669)}${range(0x6f0, 0x6f9)}]`, 'u');

const BANNED_PHRASES = ['رائع', 'تهانينا', 'أوشكت على الانتهاء', 'مرحبا بك', 'مرحبا'];
const TECHNICAL_TERMS = /\b(OTP|2FA|MFA|session|token|CSRF|cookie|API|JSON|HTTP|URL|database|bug)\b/i;
/** Keys whose value is a language name written in that language. */
const LANGUAGE_NAME_KEYS = /^shell\.language\./;

describe('message files', () => {
  it('define each key in one Arabic file only', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [file, messages] of Object.entries(AR_FILES)) {
      for (const key of Object.keys(messages)) {
        const previous = seen.get(key);
        if (previous) duplicates.push(`${key} (${previous}, ${file})`);
        seen.set(key, file);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('translate into French and Tamazight only keys that exist in Arabic, with the same placeholders', () => {
    for (const locale of ['fr', 'zgh'] as const) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(Object.hasOwn(ar, key), `${locale}: ${key}`).toBe(true);
        expect(placeholders(value), `${locale}: ${key}`).toEqual(placeholders(ar[key] ?? ''));
      }
    }
  });

  it('give every page a screen title', () => {
    for (const page of PAGES) {
      const name = page.path === '/' ? 'home' : page.path.slice(1).replaceAll('/', '-');
      expect(Object.hasOwn(ar, `screens.${name}`), page.path).toBe(true);
    }
  });

  it('name every role, and the president of an appeal court separately', () => {
    for (const code of ROLE_CODES) {
      expect(ar[`roles.${code}`], code).toBeTruthy();
      expect(ROLES[code].code).toBe(code);
    }
    expect(ar['roles.COURT_PRESIDENT_APPEAL']).toBeTruthy();
  });

  it('word every check before signature, the missing category of a public-law person included (independent review IR-01)', () => {
    for (const code of CHECK_CODES) expect(ar[`filing.check.${code}`], code).toBeTruthy();
    expect(CHECK_CODES.map(String)).toContain('PUBLIC_ENTITY_KIND_MISSING');
    // The card shows the category as a required field, and says why.
    expect(ar['filing.card.requiredField']).toContain('{label}');
    expect(ar['filing.card.publicEntityKindHint']).toBeTruthy();
  });
});

describe('glossary', () => {
  const rows = glossaryRows();

  it('is parsed', () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  it('fixes the label of every role, state, notification kind and space, letter for letter', () => {
    const governed = /^(roles|states|notificationKinds|spaces)\./;
    const checked = rows.flatMap((row) => row.keys.filter((k) => governed.test(k)).map((key) => ({ key, term: row.term })));
    expect(checked.length).toBeGreaterThan(40);
    for (const { key, term } of checked) {
      expect(ar[key], key).toBe(term);
    }
  });

  it('is respected by every other key already in use', () => {
    for (const row of rows) {
      for (const key of row.keys) {
        const value = ar[key];
        // Keys of later phases are not in the files yet; templates carry placeholders.
        if (value === undefined || value.includes('{')) continue;
        expect(value, key).toBe(row.term);
      }
    }
  });
});

describe('style of the Arabic texts', () => {
  const entries = Object.entries(ar);

  it('has no exclamation mark and no emoji', () => {
    for (const [key, value] of entries) {
      expect(value.includes('!') || value.includes('¡'), key).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(value), key).toBe(false);
    }
  });

  it('has no friendly or commercial phrase', () => {
    for (const [key, value] of entries) {
      for (const phrase of BANNED_PHRASES) expect(value.includes(phrase), `${key}: ${phrase}`).toBe(false);
    }
  });

  it('has no technical term and no Latin text outside language names', () => {
    for (const [key, value] of entries) {
      if (LANGUAGE_NAME_KEYS.test(key)) continue;
      const text = value.replace(PLACEHOLDER, '');
      expect(TECHNICAL_TERMS.test(text), key).toBe(false);
      expect(/[A-Za-z]/.test(text), key).toBe(false);
    }
  });

  it('writes numbers with Latin digits', () => {
    for (const [key, value] of entries) expect(INDIC_DIGITS.test(value), key).toBe(false);
  });

  it('refers to articles of this law, never to the repealed "فصل"', () => {
    for (const [key, value] of entries) expect(/الفصل\s+\d/.test(value), key).toBe(false);
  });
});
