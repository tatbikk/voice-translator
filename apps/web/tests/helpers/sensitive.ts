// Every secret, code, token, password, e-mail, name and phone number the tests
// use is recorded here, so that memo rows 16 and 17 can check that none of
// them reaches the event log, the technical log or an API answer.
// Failure messages never print a value: only its kind, length and first two
// characters.

export type SensitiveKind = 'secret' | 'password' | 'code' | 'token' | 'email' | 'name' | 'phone' | 'reference';

interface Tracked {
  readonly kind: SensitiveKind;
  readonly value: string;
}

const tracked = new Map<string, Tracked>();

export function trackSensitive(kind: SensitiveKind, value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  const v = value.trim();
  if (v.length === 0) return;
  tracked.set(`${kind}:${v}`, { kind, value: v });
}

/** The configuration secrets of the current environment (contract §3). */
export function trackEnvironmentSecrets(): void {
  for (const name of ['SESSION_SECRET', 'SECRETS_MASTER_KEY', 'ACCESS_CODE', 'APP_DB_PASSWORD', 'SEED_DEMO_PASSWORD']) {
    trackSensitive('secret', process.env[name]);
  }
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    const url = process.env[name];
    if (!url) continue;
    try {
      trackSensitive('secret', decodeURIComponent(new URL(url).password));
    } catch {
      // not a URL: nothing to extract
    }
  }
}

export function trackedValues(kinds?: readonly SensitiveKind[]): Tracked[] {
  return [...tracked.values()].filter((t) => !kinds || kinds.includes(t.kind));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describe(t: Tracked): string {
  return `${t.kind} (${String(t.value.length)} characters, starting "${t.value.slice(0, 2)}…")`;
}

function occursIn(haystack: string, t: Tracked): boolean {
  if (t.kind === 'code') {
    // A six-digit code may appear by chance inside a hexadecimal hash or a
    // UUID; only a standalone occurrence counts.
    return new RegExp(`(?<![0-9A-Za-z])${escapeRegExp(t.value)}(?![0-9A-Za-z])`).test(haystack);
  }
  if (t.value.length < 6) return false;
  if (t.kind === 'email') return haystack.toLowerCase().includes(t.value.toLowerCase());
  return haystack.includes(t.value);
}

/** Descriptions of the tracked values found in `haystack` (empty when none). */
export function findLeaks(haystack: string, kinds?: readonly SensitiveKind[]): string[] {
  return trackedValues(kinds)
    .filter((t) => occursIn(haystack, t))
    .map(describe);
}
