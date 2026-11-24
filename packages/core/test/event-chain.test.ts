import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  canonicalize,
  computeEventHash,
  verifyChain,
  type ChainedEventRecord,
  type EventRecord,
} from '../src/index';

const key = randomBytes(32);
const otherKey = randomBytes(32);
const keyring = (version: number) => (version === 1 ? key : undefined);

function record(seq: number, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    seq,
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    occurredAt: '2026-11-24T09:00:00.000Z',
    recordedAt: '2026-11-24T09:00:00.123Z',
    actorUserId: null,
    actorRoleAssignmentId: null,
    actorRole: null,
    viaDemoSwitch: false,
    clientIdHash: null,
    action: 'auth.logout',
    outcome: 'DONE',
    caseFileId: null,
    legalBasis: null,
    details: {},
    keyVersion: 1,
    ...overrides,
  };
}

function chain(length: number, signingKey: Uint8Array = key): ChainedEventRecord[] {
  const rows: ChainedEventRecord[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= length; seq += 1) {
    const r = record(seq, { details: { remaining: seq } });
    const hash = computeEventHash(signingKey, prev, r);
    rows.push({ ...r, prevHash: prev, hash });
    prev = hash;
  }
  return rows;
}

describe('canonical form', () => {
  it('is independent of key order', () => {
    const a = record(1, { details: { b: 1, a: 2 } });
    const b = record(1, { details: { a: 2, b: 1 } });
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('refuses floats and timestamps without milliseconds', () => {
    expect(() => canonicalize(record(1, { details: { x: 1.5 } }))).toThrow();
    expect(() => canonicalize(record(1, { occurredAt: '2026-11-24T09:00:00Z' }))).toThrow();
  });

  it('includes the legal basis and keeps Arabic text exactly', () => {
    const withBasis = record(1, { legalBasis: { kind: 'LAW', law: '58.25', articles: [628] } });
    expect(canonicalize(withBasis)).toContain('"articles":[628]');
    const arabic = record(1, { details: { note: 'المادة 628' } });
    expect(canonicalize(arabic)).toContain('المادة 628');
  });
});

describe('verification', () => {
  it('accepts an intact chain and returns its head', () => {
    const rows = chain(5);
    expect(verifyChain(keyring, rows)).toEqual({ ok: true, count: 5, head: { seq: 5, hash: rows[4]!.hash } });
  });

  it('accepts the empty chain', () => {
    expect(verifyChain(keyring, [])).toEqual({ ok: true, count: 0, head: null });
  });

  it('detects a changed field', () => {
    const rows = chain(5);
    rows[2] = { ...rows[2]!, actorUserId: '99999999-9999-4999-8999-999999999999' };
    expect(verifyChain(keyring, rows)).toMatchObject({ ok: false, brokenAtSeq: 3, reason: 'HASH_MISMATCH' });
  });

  it('detects a removed row', () => {
    const rows = chain(5);
    rows.splice(2, 1);
    expect(verifyChain(keyring, rows)).toMatchObject({ ok: false, brokenAtSeq: 3, reason: 'SEQ_GAP' });
  });

  it('detects reordered rows', () => {
    const rows = chain(5);
    [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    expect(verifyChain(keyring, rows).ok).toBe(false);
  });

  it('detects a chain recomputed without the key', () => {
    const forged = chain(5, otherKey);
    expect(verifyChain(keyring, forged)).toMatchObject({ ok: false, brokenAtSeq: 1, reason: 'HASH_MISMATCH' });
  });

  it('detects a row whose seq was renumbered to hide a deletion', () => {
    const rows = chain(5);
    rows.splice(2, 1);
    const renumbered = rows.map((r, i) => ({ ...r, seq: i + 1 }));
    expect(verifyChain(keyring, renumbered).ok).toBe(false);
  });

  it('refuses an unknown key version', () => {
    const rows = chain(2).map((r) => ({ ...r, keyVersion: 7 }));
    expect(verifyChain(keyring, rows)).toMatchObject({ ok: false, reason: 'UNKNOWN_KEY_VERSION' });
  });
});

describe('incremental verification from an anchor', () => {
  it('continues from the anchored head', () => {
    const rows = chain(6);
    const anchor = { seq: 3, hash: rows[2]!.hash };
    expect(verifyChain(keyring, rows.slice(2), { anchor })).toEqual({
      ok: true,
      count: 4,
      head: { seq: 6, hash: rows[5]!.hash },
    });
  });

  it('detects a change of the anchored row', () => {
    const rows = chain(6);
    const anchor = { seq: 3, hash: rows[2]!.hash };
    const tampered = rows.slice(2);
    tampered[0] = { ...tampered[0]!, hash: rows[3]!.hash };
    expect(verifyChain(keyring, tampered, { anchor })).toMatchObject({ ok: false, reason: 'ANCHOR_MISMATCH' });
  });

  it('detects that the chain is now shorter than the anchored head', () => {
    const rows = chain(6);
    const anchor = { seq: 6, hash: rows[5]!.hash };
    expect(verifyChain(keyring, [], { anchor })).toMatchObject({ ok: false, reason: 'HEAD_BEHIND_ANCHOR' });
    expect(verifyChain(keyring, rows.slice(6), { anchor })).toMatchObject({ ok: false, reason: 'HEAD_BEHIND_ANCHOR' });
  });
});
