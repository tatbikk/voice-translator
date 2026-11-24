import 'server-only';
import { createHmac } from 'node:crypto';
import type { ReplaceableComponent } from '@mahkama/core';
import { masterKey } from '../keys';

// The signature provider (prompt, «التوقيع الإلكتروني»): one internal interface,
// simulated today, a qualified trust service provider under Law 43.20 tomorrow.
// The circle, the order of signers, the signing secret and the record are the
// platform's; only the act of signing is the provider's.

export interface SignRequest {
  readonly documentSha256: string;
  readonly signerUserId: string;
  readonly signerRole: string;
  readonly at: Date;
}

export interface SignatureRecord {
  readonly providerRef: string;
  readonly documentSha256: string;
  readonly signedAt: Date;
  /** a simulated signature carries the visible stamp «توقيع تجريبي» */
  readonly simulated: boolean;
}

export interface SignatureProvider {
  readonly component: ReplaceableComponent;
  sign(request: SignRequest): Promise<SignatureRecord>;
  verify(record: { documentSha256: string; providerRef: string; signedAt: Date }, currentSha256: string): Promise<'VALID' | 'DOCUMENT_CHANGED' | 'INVALID'>;
}

const HASH = /^[0-9a-f]{64}$/;

function simulatedProvider(): SignatureProvider {
  // The reference is an HMAC of what was signed, under a key derived from the
  // master key: a signature row whose hash or time was altered in the database
  // no longer verifies.
  const key = () => masterKey('signature-simulated-v1');
  const refOf = (sha: string, user: string, at: Date) => createHmac('sha256', key()).update(`${sha}|${user}|${at.toISOString()}`).digest('hex');
  return {
    component: {
      id: 'signature',
      nameKey: 'components.signature.name',
      descriptionKey: 'components.signature.description',
      replacementKey: 'components.signature.replacement',
      implementation: 'simulated',
    },
    async sign(request) {
      await Promise.resolve();
      if (!HASH.test(request.documentSha256)) throw new Error('invalid document hash');
      return {
        providerRef: `sim:${request.signerUserId}:${refOf(request.documentSha256, request.signerUserId, request.at)}`,
        documentSha256: request.documentSha256,
        signedAt: request.at,
        simulated: true,
      };
    },
    async verify(record, currentSha256) {
      await Promise.resolve();
      const [, user = '', mac = ''] = record.providerRef.split(':');
      if (refOf(record.documentSha256, user, record.signedAt) !== mac) return 'INVALID';
      return record.documentSha256 === currentSha256 ? 'VALID' : 'DOCUMENT_CHANGED';
    },
  };
}

let provider: SignatureProvider | null = null;

export function signatureProvider(): SignatureProvider {
  provider ??= simulatedProvider();
  return provider;
}

export function setSignatureProviderForTests(next: SignatureProvider | null): void {
  provider = next;
}
