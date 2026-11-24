// The signature circle (prompt, «التوقيع الإلكتروني»; articles 110 and 632;
// study, station 8): signers in a fixed order, the effect only once the last
// one signed, and a document whose hash changed after the first signature
// voids the circle, which must then start again.
import type { RoleCode } from '../roles';

export interface CircleSigner {
  readonly userId: string;
  readonly role: RoleCode;
}

export interface SignatureCircleState {
  readonly documentSha256: string;
  readonly signers: readonly CircleSigner[];
  /** how many signers have signed, in order */
  readonly signedCount: number;
  readonly status: 'OPEN' | 'COMPLETED' | 'VOIDED';
  readonly nextSigner: CircleSigner | null;
}

export function openCircle(input: { documentSha256: string; signers: readonly CircleSigner[] }): SignatureCircleState {
  if (input.signers.length === 0) throw new Error('a signature circle needs at least one signer');
  return { documentSha256: input.documentSha256, signers: input.signers, signedCount: 0, status: 'OPEN', nextSigner: input.signers[0] ?? null };
}

export type SignOutcome =
  | { readonly ok: true; readonly circle: SignatureCircleState }
  | { readonly ok: false; readonly reason: 'NOT_YOUR_TURN' | 'CIRCLE_CLOSED'; readonly circle?: undefined }
  | { readonly ok: false; readonly reason: 'DOCUMENT_CHANGED'; readonly circle: SignatureCircleState };

export function signCircle(
  circle: SignatureCircleState,
  input: { signer: CircleSigner; documentSha256: string; at: Date },
): SignOutcome {
  if (circle.status !== 'OPEN') return { ok: false, reason: 'CIRCLE_CLOSED' };
  const next = circle.signers[circle.signedCount];
  if (!next || next.userId !== input.signer.userId || next.role !== input.signer.role) return { ok: false, reason: 'NOT_YOUR_TURN' };
  if (input.documentSha256 !== circle.documentSha256) {
    return { ok: false, reason: 'DOCUMENT_CHANGED', circle: { ...circle, status: 'VOIDED', nextSigner: null } };
  }
  const signedCount = circle.signedCount + 1;
  const done = signedCount === circle.signers.length;
  return {
    ok: true,
    circle: { ...circle, signedCount, status: done ? 'COMPLETED' : 'OPEN', nextSigner: done ? null : (circle.signers[signedCount] ?? null) },
  };
}

/** A signature holds while the document still has the hash it had when signed. */
export function verifySignature(record: { documentSha256: string }, currentSha256: string): 'VALID' | 'DOCUMENT_CHANGED' {
  return record.documentSha256 === currentSha256 ? 'VALID' : 'DOCUMENT_CHANGED';
}
