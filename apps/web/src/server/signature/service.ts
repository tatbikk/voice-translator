import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { SECURITY_POLICY, openCircle, signCircle, type RoleCode, type SignatureCircleState } from '@mahkama/core';
import { clock } from '../clock';
import { getDb } from '../db';
import { asJson } from '../json';
import { documentBytes } from '../documents/service';
import { appendEvent, appendStandaloneEvent, eventTransaction, type EventActor } from '../events/append';
import { activeLock, attemptsFor, DEFAULT_BUCKET, markAttemptSucceeded, reserveAttempt } from '../auth/attempts';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { signatureProvider } from './provider';

// The signature service (prompt, «التوقيع الإلكتروني»): the circle of signers in
// order, the personal signing secret (Argon2id, three failures lock it fifteen
// minutes, counted before the check, decision 39), the record of who signed,
// with which role, at which platform time and on which SHA-256 of the document,
// and the voiding of the circle when the document changed after a signature.
// No effect of the signed act is applied here: the caller applies it only once
// the circle is COMPLETED.

interface StoredSigner {
  readonly userId: string;
  readonly roleAssignmentId: string;
  readonly role: RoleCode;
}

export interface SignerRef {
  readonly userId: string;
  readonly roleAssignmentId: string;
}

const signingIdentifier = (userId: string) => createHash('sha256').update(`signing-secret:${userId}`).digest('hex');

export async function setSigningSecret(userId: string, secret: string, actor: EventActor | null = null): Promise<void> {
  const { passwordMin, passwordMax } = SECURITY_POLICY.fields;
  if (secret.length < Math.min(8, passwordMin) || secret.length > passwordMax) throw new Error('signing secret outside the policy');
  const secretHash = await hashPassword(secret);
  await eventTransaction(async (tx) => {
    await tx.signingCredential.upsert({
      where: { userId },
      create: { userId, secretHash, setAt: clock.systemNow() },
      update: { secretHash, setAt: clock.systemNow() },
    });
    await appendEvent(tx, { action: 'signature.secret.set', details: { userId }, actor });
  });
}

async function roleOf(ref: SignerRef): Promise<RoleCode | null> {
  const assignment = await getDb().roleAssignment.findFirst({
    where: { id: ref.roleAssignmentId, userId: ref.userId, revokedAt: null },
    select: { role: true },
  });
  return assignment?.role ?? null;
}

export async function openSignatureCircle(input: {
  documentId: string;
  purpose: string;
  signers: readonly SignerRef[];
  actor?: EventActor | null;
}): Promise<{ id: string }> {
  const doc = await getDb().document.findUnique({ where: { id: input.documentId }, select: { id: true, sha256: true, caseFileId: true } });
  if (!doc) throw new Error('signature circle: unknown document');
  const signers: StoredSigner[] = [];
  for (const ref of input.signers) {
    const role = await roleOf(ref);
    if (!role) throw new Error('signature circle: unknown signer');
    signers.push({ ...ref, role });
  }
  openCircle({ documentSha256: doc.sha256, signers: signers.map((s) => ({ userId: s.userId, role: s.role })) });
  const id = randomUUID();
  await eventTransaction(async (tx) => {
    await tx.signatureCircle.create({
      data: { id, documentId: doc.id, purpose: input.purpose, signers: asJson(signers), documentSha256: doc.sha256, openedAt: clock.now() },
    });
    await appendEvent(tx, {
      action: 'signature.circle.opened',
      details: { circleId: id, documentId: doc.id, documentSha256: doc.sha256, signers: signers.length, purpose: input.purpose },
      caseFileId: doc.caseFileId,
      actor: input.actor ?? null,
    });
  });
  return { id };
}

export type SignResult =
  | { readonly ok: true; readonly completed: boolean; readonly stampKey: string }
  | { readonly ok: false; readonly reason: 'NOT_YOUR_TURN' | 'CIRCLE_CLOSED' | 'INVALID_SECRET' | 'LOCKED' | 'NO_SECRET' | 'DOCUMENT_CHANGED' };

export const SIMULATED_STAMP_KEY = 'signature.stamp.simulated';

async function circleState(circleId: string) {
  const circle = await getDb().signatureCircle.findUnique({
    where: { id: circleId },
    include: { signatures: { select: { position: true } }, document: { select: { caseFileId: true, storageKey: true } } },
  });
  if (!circle) return null;
  const signers = circle.signers as unknown as StoredSigner[];
  const signedCount = circle.signatures.length;
  const state: SignatureCircleState = {
    documentSha256: circle.documentSha256,
    signers: signers.map((s) => ({ userId: s.userId, role: s.role })),
    signedCount,
    status: circle.status,
    nextSigner: circle.status === 'OPEN' ? (signers[signedCount] ?? null) : null,
  };
  return { circle, signers, state };
}

export async function signDocument(input: SignerRef & { circleId: string; secret: string; actor?: EventActor | null }): Promise<SignResult> {
  const loaded = await circleState(input.circleId);
  if (!loaded) return { ok: false, reason: 'CIRCLE_CLOSED' };
  const { circle, signers, state } = loaded;
  const caseFileId = circle.document.caseFileId;
  const refuse = async (reason: 'NOT_YOUR_TURN' | 'CIRCLE_CLOSED' | 'INVALID_SECRET' | 'LOCKED' | 'NO_SECRET'): Promise<SignResult> => {
    await appendStandaloneEvent({ action: 'signature.refused', details: { circleId: circle.id, reason }, caseFileId, actor: input.actor ?? null });
    return { ok: false, reason };
  };

  if (state.status !== 'OPEN') return refuse('CIRCLE_CLOSED');
  const next = signers[state.signedCount];
  if (!next || next.userId !== input.userId || next.roleAssignmentId !== input.roleAssignmentId) return refuse('NOT_YOUR_TURN');
  const role = await roleOf(input);
  if (role !== next.role) return refuse('NOT_YOUR_TURN');

  // The signing secret: lock first, then the attempt is counted before the check.
  const identifierHash = signingIdentifier(input.userId);
  if (await activeLock(identifierHash, DEFAULT_BUCKET)) return refuse('LOCKED');
  const credential = await getDb().signingCredential.findUnique({ where: { userId: input.userId }, select: { secretHash: true } });
  if (!credential) return refuse('NO_SECRET');
  const policy = SECURITY_POLICY.signaturePin;
  const attemptId = await reserveAttempt('SIGNING_SECRET', { identifierHash, bucket: DEFAULT_BUCKET, clientIdHash: null });
  const since = await lastEndedLockForSigning(identifierHash);
  const failures = (await attemptsFor('SIGNING_SECRET', identifierHash, DEFAULT_BUCKET, policy.windowMs, since)).filter((a) => !a.ok).length;
  if (failures > policy.maxFailures) return refuse('LOCKED');
  if (!(await verifyPassword(credential.secretHash, input.secret))) {
    if (failures >= policy.maxFailures) {
      const now = clock.systemNow();
      await getDb().lockout.create({
        data: { identifierHash, bucket: DEFAULT_BUCKET.storage, cause: 'SIGNING_SECRET', createdAt: now, until: new Date(now.getTime() + policy.lockMs) },
      });
    }
    return refuse('INVALID_SECRET');
  }
  await markAttemptSucceeded(attemptId);

  // The document must still have the hash the circle was opened on.
  const current = await documentBytes(circle.document);
  const currentSha = current?.sha256 ?? '0'.repeat(64);
  const outcome = signCircle(state, { signer: { userId: next.userId, role: next.role }, documentSha256: currentSha, at: clock.now() });
  if (!outcome.ok) {
    if (outcome.reason === 'DOCUMENT_CHANGED') {
      await eventTransaction(async (tx) => {
        await tx.signatureCircle.update({ where: { id: circle.id }, data: { status: 'VOIDED', voidReason: 'DOCUMENT_CHANGED' } });
        await appendEvent(tx, {
          action: 'signature.circle.voided',
          details: { circleId: circle.id, documentId: circle.documentId, reason: 'DOCUMENT_CHANGED', currentSha256: currentSha },
          caseFileId,
          actor: input.actor ?? null,
        });
      });
      return { ok: false, reason: 'DOCUMENT_CHANGED' };
    }
    return refuse(outcome.reason);
  }

  const record = await signatureProvider().sign({ documentSha256: currentSha, signerUserId: next.userId, signerRole: next.role, at: clock.now() });
  const completed = outcome.circle.status === 'COMPLETED';
  await eventTransaction(async (tx) => {
    await tx.signature.create({
      data: {
        circleId: circle.id,
        position: state.signedCount,
        signerUserId: next.userId,
        signerRoleAssignmentId: next.roleAssignmentId,
        signerRole: next.role,
        documentSha256: record.documentSha256,
        signedAt: record.signedAt,
        provider: signatureProvider().component.implementation === 'simulated' ? 'SIMULATED' : 'QUALIFIED',
        providerRef: record.providerRef,
      },
    });
    if (completed) await tx.signatureCircle.update({ where: { id: circle.id }, data: { status: 'COMPLETED', completedAt: clock.now() } });
    await appendEvent(tx, {
      action: 'signature.signed',
      details: {
        circleId: circle.id,
        documentId: circle.documentId,
        position: state.signedCount,
        documentSha256: record.documentSha256,
        provider: record.simulated ? 'SIMULATED' : 'QUALIFIED',
      },
      caseFileId,
      actor: input.actor ?? null,
    });
  });
  if (completed) {
    await appendStandaloneEvent({ action: 'signature.circle.completed', details: { circleId: circle.id, documentId: circle.documentId }, caseFileId, actor: input.actor ?? null });
  }
  return { ok: true, completed, stampKey: record.simulated ? SIMULATED_STAMP_KEY : 'signature.stamp.qualified' };
}

async function lastEndedLockForSigning(identifierHash: string): Promise<Date | null> {
  const row = await getDb().lockout.findFirst({
    where: { identifierHash, bucket: DEFAULT_BUCKET.storage, cause: 'SIGNING_SECRET', until: { lte: clock.systemNow() } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row ? new Date(row.createdAt.getTime() + 1) : null;
}

export interface SignatureView {
  readonly signatureId: string;
  readonly circleId: string;
  readonly position: number;
  readonly signerUserId: string;
  readonly signerRole: string;
  readonly signedAt: Date;
  readonly simulated: boolean;
  readonly status: 'VALID' | 'DOCUMENT_CHANGED' | 'INVALID';
}

/** «التحقق من التوقيع»: every signature of the document against its current bytes. */
export async function verifyDocumentSignatures(documentId: string, actor: EventActor | null = null): Promise<SignatureView[]> {
  const doc = await getDb().document.findUnique({ where: { id: documentId }, select: { storageKey: true, caseFileId: true } });
  if (!doc) return [];
  const current = await documentBytes(doc);
  const currentSha = current?.sha256 ?? '0'.repeat(64);
  const signatures = await getDb().signature.findMany({
    where: { circle: { documentId } },
    orderBy: [{ circleId: 'asc' }, { position: 'asc' }],
  });
  const views: SignatureView[] = [];
  for (const s of signatures) {
    const status = await signatureProvider().verify({ documentSha256: s.documentSha256, providerRef: s.providerRef, signedAt: s.signedAt }, currentSha);
    views.push({
      signatureId: s.id,
      circleId: s.circleId,
      position: s.position,
      signerUserId: s.signerUserId,
      signerRole: s.signerRole,
      signedAt: s.signedAt,
      simulated: s.provider === 'SIMULATED',
      status,
    });
  }
  await appendStandaloneEvent({
    action: 'signature.verified',
    details: { documentId, valid: views.filter((v) => v.status === 'VALID').length, changed: views.filter((v) => v.status !== 'VALID').length },
    caseFileId: doc.caseFileId,
    actor,
  });
  return views;
}

