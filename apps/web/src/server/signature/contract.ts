import 'server-only';
import { createHash } from 'node:crypto';
import type { SignatureProvider, SignatureRecord, SignedRecord, SignRequest } from './provider';

// Contract of SignatureProvider: what the simulated provider does today and a
// qualified trust service provider (Law 43.20) must do tomorrow.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`signature contract: ${message}`);
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const AT = new Date(Date.UTC(2027, 2, 15, 9, 30));
const CIRCLE = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_CIRCLE = '1f1e1d1c-1b1a-4918-8716-151413121110';

const request = (documentSha256: string): SignRequest => ({
  documentSha256,
  signerUserId: 'signer-1',
  signerRole: 'PANEL_PRESIDENT',
  circleId: CIRCLE,
  position: 0,
  at: AT,
});

/** The row the platform records for a signature: the request's facts and the provider's answer. */
const rowOf = (req: SignRequest, record: SignatureRecord): SignedRecord => ({
  providerRef: record.providerRef,
  documentSha256: record.documentSha256,
  signedAt: record.signedAt,
  signerUserId: req.signerUserId,
  signerRole: req.signerRole,
  circleId: req.circleId,
  position: req.position,
});

export const SIGNATURE_CONTRACT: readonly { name: string; run: (provider: SignatureProvider) => Promise<void> }[] = [
  {
    name: 'describes itself as the replaceable signature component',
    run: async (provider) => {
      await Promise.resolve();
      assert(provider.component.id === 'signature', 'component id must be "signature"');
      assert(['simulated', 'real', 'test'].includes(provider.component.implementation), 'implementation kind');
    },
  },
  {
    name: 'signs the given hash at the given time, and verifies it against the same hash',
    run: async (provider) => {
      const hash = sha('document');
      const req = request(hash);
      const record = await provider.sign(req);
      assert(record.documentSha256 === hash, 'the record keeps the hash signed');
      assert(record.signedAt.getTime() === AT.getTime(), 'the record keeps the time of signing');
      assert(record.providerRef.length > 0, 'a reference is returned');
      assert((await provider.verify(rowOf(req, record), hash)) === 'VALID', 'the same hash verifies');
    },
  },
  {
    name: 'reports a document changed after signing',
    run: async (provider) => {
      const req = request(sha('a'));
      const record = await provider.sign(req);
      assert((await provider.verify(rowOf(req, record), sha('b'))) === 'DOCUMENT_CHANGED', 'another hash must not verify');
    },
  },
  {
    // Review P1-S-09: what the signature attests is read from the platform's record;
    // a record altered or copied elsewhere after signing is not a valid signature.
    name: 'reports a tampered record as INVALID: signer, role, circle, position, time, hash or reference changed',
    run: async (provider) => {
      const hash = sha('tamper');
      const req = request(hash);
      const row = rowOf(req, await provider.sign(req));
      assert((await provider.verify(row, hash)) === 'VALID', 'the untouched record verifies');
      const otherHash = sha('another document');
      const flipped = `${row.providerRef.slice(0, -1)}${row.providerRef.endsWith('0') ? '1' : '0'}`;
      const tampered: readonly [string, SignedRecord, string][] = [
        ['another signer', { ...row, signerUserId: 'signer-2' }, hash],
        ['another role', { ...row, signerRole: 'PANEL_MEMBER' }, hash],
        ['another circle', { ...row, circleId: OTHER_CIRCLE }, hash],
        ['another position', { ...row, position: 1 }, hash],
        ['another time', { ...row, signedAt: new Date(AT.getTime() + 60_000) }, hash],
        ['another hash, presented with its own document', { ...row, documentSha256: otherHash }, otherHash],
        ['a changed reference', { ...row, providerRef: flipped }, hash],
        ['an empty reference', { ...row, providerRef: '' }, hash],
      ];
      for (const [what, record, current] of tampered) {
        assert((await provider.verify(record, current)) === 'INVALID', `a record with ${what} must verify INVALID`);
      }
    },
  },
  {
    name: 'refuses to sign something that is not a SHA-256',
    run: async (provider) => {
      let refused = false;
      try {
        await provider.sign(request('not-a-hash'));
      } catch {
        refused = true;
      }
      assert(refused, 'an invalid hash must be refused');
    },
  },
];
