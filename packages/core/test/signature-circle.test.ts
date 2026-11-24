// The signature circle (prompt, «التوقيع الإلكتروني»; study, station 8; articles
// 110 and 632): signers in order, no effect before the circle is complete, and
// a document changed after the first signature voids the circle.
import { describe, expect, it } from 'vitest';
import { openCircle, signCircle, verifySignature, type SignatureCircleState } from '../src/index';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const president = { userId: 'u-president', role: 'PANEL_PRESIDENT' } as const;
const rapporteur = { userId: 'u-rapporteur', role: 'JUDGE_RAPPORTEUR' } as const;
const clerk = { userId: 'u-clerk', role: 'CLERK_HEARING' } as const;
const at = new Date('2027-03-15T09:30:00Z');

const fresh = (): SignatureCircleState => openCircle({ documentSha256: HASH, signers: [president, rapporteur, clerk] });

describe('signature circle', () => {
  it('asks the signers in order and is complete only after the last one', () => {
    let circle = fresh();
    expect(circle.nextSigner).toEqual(president);
    for (const signer of [president, rapporteur]) {
      const result = signCircle(circle, { signer, documentSha256: HASH, at });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      circle = result.circle;
      expect(circle.status).toBe('OPEN');
    }
    const last = signCircle(circle, { signer: clerk, documentSha256: HASH, at });
    expect(last.ok && last.circle.status).toBe('COMPLETED');
    expect(last.ok && last.circle.nextSigner).toBeNull();
  });

  it('refuses a signer whose turn has not come, even with the right document', () => {
    const result = signCircle(fresh(), { signer: clerk, documentSha256: HASH, at });
    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('refuses the right person under another role', () => {
    const result = signCircle(fresh(), { signer: { userId: president.userId, role: 'PANEL_MEMBER' }, documentSha256: HASH, at });
    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('voids the circle when the document changed after the first signature', () => {
    const first = signCircle(fresh(), { signer: president, documentSha256: HASH, at });
    if (!first.ok) throw new Error('first signature refused');
    const second = signCircle(first.circle, { signer: rapporteur, documentSha256: OTHER, at });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('DOCUMENT_CHANGED');
    expect(second.circle?.status).toBe('VOIDED');
  });

  it('refuses any signature on a voided or completed circle', () => {
    const voided: SignatureCircleState = { ...fresh(), status: 'VOIDED' };
    expect(signCircle(voided, { signer: president, documentSha256: HASH, at })).toEqual({ ok: false, reason: 'CIRCLE_CLOSED' });
  });

  it('verifies a signature against the current bytes of the document', () => {
    expect(verifySignature({ documentSha256: HASH }, HASH)).toBe('VALID');
    expect(verifySignature({ documentSha256: HASH }, OTHER)).toBe('DOCUMENT_CHANGED');
  });
});
