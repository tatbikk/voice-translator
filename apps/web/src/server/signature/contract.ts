import 'server-only';
import { createHash } from 'node:crypto';
import type { SignatureProvider } from './provider';

// Contract of SignatureProvider: what the simulated provider does today and a
// qualified trust service provider (Law 43.20) must do tomorrow.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`signature contract: ${message}`);
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const AT = new Date(Date.UTC(2027, 2, 15, 9, 30));

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
      const record = await provider.sign({ documentSha256: hash, signerUserId: 'signer-1', signerRole: 'PANEL_PRESIDENT', at: AT });
      assert(record.documentSha256 === hash, 'the record keeps the hash signed');
      assert(record.signedAt.getTime() === AT.getTime(), 'the record keeps the time of signing');
      assert(record.providerRef.length > 0, 'a reference is returned');
      assert((await provider.verify(record, hash)) === 'VALID', 'the same hash verifies');
    },
  },
  {
    name: 'reports a document changed after signing',
    run: async (provider) => {
      const record = await provider.sign({ documentSha256: sha('a'), signerUserId: 'signer-1', signerRole: 'PANEL_PRESIDENT', at: AT });
      assert((await provider.verify(record, sha('b'))) === 'DOCUMENT_CHANGED', 'another hash must not verify');
    },
  },
  {
    name: 'refuses to sign something that is not a SHA-256',
    run: async (provider) => {
      let refused = false;
      try {
        await provider.sign({ documentSha256: 'not-a-hash', signerUserId: 'signer-1', signerRole: 'PANEL_PRESIDENT', at: AT });
      } catch {
        refused = true;
      }
      assert(refused, 'an invalid hash must be refused');
    },
  },
];
