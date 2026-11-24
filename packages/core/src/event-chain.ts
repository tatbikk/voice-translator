// Keyed hash chain of the event log (contract §4.3). Each record carries the hash
// of the one before it, computed as HMAC-SHA256 with a key that never enters the
// database: editing any row, deleting or reordering rows, or recomputing the
// chain without the key, is detected by verifyChain().
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { LegalBasis } from './legal-basis';

export const GENESIS_HASH = '0'.repeat(64);

export type JsonPrimitive = string | number | boolean | null;

export interface EventRecord {
  readonly seq: number;
  readonly id: string;
  /** platform time, UTC ISO with milliseconds */
  readonly occurredAt: string;
  /** system time, UTC ISO with milliseconds */
  readonly recordedAt: string;
  readonly actorUserId: string | null;
  readonly actorRoleAssignmentId: string | null;
  readonly actorRole: string | null;
  readonly viaDemoSwitch: boolean;
  readonly clientIdHash: string | null;
  readonly action: string;
  readonly outcome: 'DONE' | 'DENIED' | 'FAILED';
  readonly caseFileId: string | null;
  readonly legalBasis: LegalBasis | null;
  readonly details: Readonly<Record<string, JsonPrimitive>>;
  readonly keyVersion: number;
}

export interface ChainedEventRecord extends EventRecord {
  readonly prevHash: string;
  readonly hash: string;
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function canonicalValue(value: unknown, path: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`canonicalize: non-integer number at ${path}`);
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v, i) => canonicalValue(v, `${path}[${String(i)}]`)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalValue(v, `${path}.${k}`)}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported value at ${path}`);
}

/**
 * Canonical form of a record: UTF-8 JSON, object keys sorted by code point at
 * every level, integers only, timestamps as UTC ISO with milliseconds, seq as a
 * decimal string, no whitespace. Any other shape is refused.
 */
export function canonicalize(record: EventRecord): string {
  if (!Number.isSafeInteger(record.seq) || record.seq < 1) throw new Error('canonicalize: invalid seq');
  if (!ISO_MS.test(record.occurredAt) || !ISO_MS.test(record.recordedAt)) {
    throw new Error('canonicalize: timestamps must be UTC ISO with milliseconds');
  }
  const { seq, ...rest } = record;
  return canonicalValue({ ...rest, seq: String(seq) }, '$');
}

export function computeEventHash(key: Uint8Array, prevHash: string, record: EventRecord): string {
  if (key.length < 32) throw new Error('event-chain key too short');
  return createHmac('sha256', key).update(`${prevHash}\n${canonicalize(record)}`, 'utf8').digest('hex');
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export type ChainFailureReason =
  | 'HASH_MISMATCH'
  | 'PREV_HASH_MISMATCH'
  | 'SEQ_GAP'
  | 'ANCHOR_MISMATCH'
  | 'HEAD_BEHIND_ANCHOR'
  | 'UNKNOWN_KEY_VERSION';

export type ChainVerification =
  | { readonly ok: true; readonly count: number; readonly head: { readonly seq: number; readonly hash: string } | null }
  | { readonly ok: false; readonly brokenAtSeq: number; readonly reason: ChainFailureReason };

/**
 * Verifies rows given in ascending seq order.
 * Without an anchor, rows must start at seq 1 from the genesis hash.
 * With an anchor (a head verified earlier and kept outside the database), rows
 * must start at the anchored row, whose hash must not have changed; the
 * verification continues from there (incremental mode).
 */
export function verifyChain(
  keyring: (version: number) => Uint8Array | undefined,
  rows: Iterable<ChainedEventRecord>,
  options: { anchor?: { readonly seq: number; readonly hash: string } } = {},
): ChainVerification {
  const { anchor } = options;
  let expectedSeq = anchor ? anchor.seq : 1;
  let expectedPrev: string | null = anchor ? null : GENESIS_HASH;
  let count = 0;
  let head: { seq: number; hash: string } | null = null;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      if (anchor && count === 0) return { ok: false, brokenAtSeq: anchor.seq, reason: 'HEAD_BEHIND_ANCHOR' };
      return { ok: false, brokenAtSeq: expectedSeq, reason: 'SEQ_GAP' };
    }
    if (anchor && count === 0 && !sameHash(row.hash, anchor.hash)) {
      return { ok: false, brokenAtSeq: row.seq, reason: 'ANCHOR_MISMATCH' };
    }
    if (expectedPrev !== null && !sameHash(row.prevHash, expectedPrev)) {
      return { ok: false, brokenAtSeq: row.seq, reason: 'PREV_HASH_MISMATCH' };
    }
    const key = keyring(row.keyVersion);
    if (!key) return { ok: false, brokenAtSeq: row.seq, reason: 'UNKNOWN_KEY_VERSION' };
    const { prevHash, hash, ...record } = row;
    if (!sameHash(computeEventHash(key, prevHash, record), hash)) {
      return { ok: false, brokenAtSeq: row.seq, reason: 'HASH_MISMATCH' };
    }
    expectedPrev = hash;
    expectedSeq = row.seq + 1;
    head = { seq: row.seq, hash };
    count += 1;
  }

  if (anchor && count === 0) return { ok: false, brokenAtSeq: anchor.seq, reason: 'HEAD_BEHIND_ANCHOR' };
  return { ok: true, count, head };
}
