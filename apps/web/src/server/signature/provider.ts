import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
  /** the circle and the signer's position in it: a signature belongs to one place of one circle */
  readonly circleId: string;
  readonly position: number;
  readonly at: Date;
}

export interface SignatureRecord {
  readonly providerRef: string;
  readonly documentSha256: string;
  readonly signedAt: Date;
  /** a simulated signature carries the visible stamp «توقيع تجريبي» */
  readonly simulated: boolean;
}

/**
 * A signature as the platform recorded it (the row of "Signature"). Verification
 * reads who signed, with which role, where and when from this record, never from
 * the provider's reference (review P1-S-09).
 */
export interface SignedRecord {
  readonly providerRef: string;
  readonly documentSha256: string;
  readonly signedAt: Date;
  readonly signerUserId: string;
  readonly signerRole: string;
  readonly circleId: string;
  readonly position: number;
}

export type VerificationStatus = 'VALID' | 'DOCUMENT_CHANGED' | 'INVALID';

export interface SignatureProvider {
  readonly component: ReplaceableComponent;
  sign(request: SignRequest): Promise<SignatureRecord>;
  verify(record: SignedRecord, currentSha256: string): Promise<VerificationStatus>;
}

const HASH = /^[0-9a-f]{64}$/;
const REF_PREFIX = 'sim-v2:';

/** Constant-time comparison of two references (review P1-S-09). */
export function sameReference(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function simulatedProvider(): SignatureProvider {
  // The reference is an HMAC, under a key derived from the master key, of
  // everything the signature attests: the document's hash, the signer, the role,
  // the circle, the position in it and the platform time. A signature row whose
  // hash, time, signer, role, circle or position was altered or copied in the
  // database no longer verifies. References made before these fields were bound
  // (prefix "sim:") are no longer accepted: they verify INVALID.
  const key = () => masterKey('signature-simulated-v1');
  const refOf = (r: { documentSha256: string; signerUserId: string; signerRole: string; circleId: string; position: number; at: Date }) =>
    `${REF_PREFIX}${createHmac('sha256', key())
      .update(JSON.stringify([r.documentSha256, r.signerUserId, r.signerRole, r.circleId, r.position, r.at.toISOString()]))
      .digest('hex')}`;
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
      if (!Number.isInteger(request.position) || request.position < 0) throw new Error('invalid position');
      return {
        providerRef: refOf(request),
        documentSha256: request.documentSha256,
        signedAt: request.at,
        simulated: true,
      };
    },
    async verify(record, currentSha256) {
      await Promise.resolve();
      if (!HASH.test(record.documentSha256) || !Number.isInteger(record.position)) return 'INVALID';
      if (!sameReference(record.providerRef, refOf({ ...record, at: record.signedAt }))) return 'INVALID';
      return sameReference(record.documentSha256, currentSha256) ? 'VALID' : 'DOCUMENT_CHANGED';
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
