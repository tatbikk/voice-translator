import 'server-only';
import { randomUUID } from 'node:crypto';
import { SECURITY_POLICY, filingReady, type Resource, type UserSubject } from '@mahkama/core';
import { clock } from '../clock';
import { getDb } from '../db';
import { appendEvent, appendStandaloneEvent, eventTransaction, type EventActor } from '../events/append';
import { asJson } from '../json';
import { enqueue } from '../jobs/queue';
import { ruleSetId } from '../rules/store';
import { checksOf, draftFee, parseCard, type DraftWithParts } from '../filings/drafts';
import { paymentGateway, type GatewayOutcome } from './gateway';

// Payments of the filing path (prompt, «الأداء»): the platform computes the
// amount from the claims, opens a payment on the gateway, and records its
// outcome once. A successful payment produces the payment, its operation
// reference, the treasury entry («قيد في محاسبة الصندوق») and the receipt. A
// failure or a cancellation is recorded and changes nothing else.

export type OpenResult =
  | { readonly ok: true; readonly intentId: string; readonly amountCents: number }
  | { readonly ok: false; readonly status: number; readonly code: 'DRAFT_INCOMPLETE' | 'NO_RULE_IN_FORCE' };

/** Opens a payment for the draft's fee, once nothing blocks the filing (memo rows 3 and 4). */
export async function openPayment(draft: DraftWithParts, subject: UserSubject, actor: EventActor): Promise<OpenResult> {
  const now = clock.now();
  const refuse = async (code: 'DRAFT_INCOMPLETE' | 'NO_RULE_IN_FORCE'): Promise<OpenResult> => {
    await appendStandaloneEvent({ action: 'filing.refused', details: { draftId: draft.id, reason: code }, actor });
    return { ok: false, status: 409, code };
  };
  const checks = await checksOf(draft, now);
  if (!filingReady(checks)) return refuse('DRAFT_INCOMPLETE');
  const card = parseCard(draft.card);
  const fee = await draftFee(card, draft.courtId, now).catch(() => null);
  if (!fee) return refuse('NO_RULE_IN_FORCE');
  const feeRuleSetId = await ruleSetId('FEES', fee.version);
  const id = randomUUID();
  await eventTransaction(async (tx) => {
    // An earlier pending payment of the draft lapses: one page at a time.
    await tx.paymentIntent.updateMany({ where: { draftId: draft.id, status: 'PENDING' }, data: { status: 'EXPIRED', completedAt: now } });
    await tx.paymentIntent.create({
      data: {
        id,
        draftId: draft.id,
        purpose: 'COURT_FEE',
        amountCents: BigInt(fee.assessment.totalCents),
        inputsDigest: fee.digest,
        breakdown: asJson({ version: fee.version, ...fee.assessment }),
        ruleSetId: feeRuleSetId,
        method: draft.channel === 'PAPER' ? 'COUNTER' : 'ONLINE',
        createdByUserId: subject.userId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SECURITY_POLICY.paymentIntent.ttlMs),
      },
    });
    await appendEvent(tx, {
      action: 'payment.intent.opened',
      details: { intentId: id, draftId: draft.id, amountCents: fee.assessment.totalCents, method: draft.channel === 'PAPER' ? 'COUNTER' : 'ONLINE', ruleVersion: fee.version },
      actor,
    });
  });
  return { ok: true, intentId: id, amountCents: fee.assessment.totalCents };
}

export interface IntentRow {
  readonly id: string;
  readonly draftId: string;
  readonly createdByUserId: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  readonly expiresAt: Date;
  readonly amountCents: bigint;
  readonly method: 'ONLINE' | 'COUNTER';
}

export async function loadIntent(intentId: string): Promise<IntentRow | null> {
  return getDb().paymentIntent.findUnique({
    where: { id: intentId },
    select: { id: true, draftId: true, createdByUserId: true, status: true, expiresAt: true, amountCents: true, method: true },
  });
}

const effectiveStatus = (intent: Pick<IntentRow, 'status' | 'expiresAt'>, now: Date) =>
  intent.status === 'PENDING' && intent.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : intent.status;

/** The resource the core decides the gateway page on. */
export async function intentResource(intentId: string): Promise<Resource | null> {
  const intent = await loadIntent(intentId);
  if (!intent) return null;
  return { kind: 'payment-intent', ownerUserId: intent.createdByUserId, status: effectiveStatus(intent, clock.now()) };
}

export type SettleOutcome =
  | { readonly ok: true; readonly status: GatewayOutcome; readonly paymentId: string; readonly operationRef: string; readonly paidAt: Date; readonly amountCents: number }
  | { readonly ok: false; readonly code: 'PAYMENT_ALREADY_COMPLETED' };

/** Records the outcome the payer chose on «أداء (محاكاة)»: once, under the intent's lock (memo row 5). */
export async function settlePayment(intentId: string, subject: UserSubject, chosen: GatewayOutcome, actor: EventActor): Promise<SettleOutcome> {
  const outcome = await eventTransaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; expiresAt: Date }[]>`
      SELECT status::text AS status, "expiresAt" FROM "PaymentIntent" WHERE id = ${intentId}::uuid FOR UPDATE`;
    const row = locked[0];
    const now = clock.now();
    if (!row || row.status !== 'PENDING') return null;
    if (row.expiresAt.getTime() <= now.getTime()) {
      await tx.paymentIntent.update({ where: { id: intentId }, data: { status: 'EXPIRED', completedAt: now } });
      await appendEvent(tx, { action: 'payment.expired', details: { intentId }, actor });
      return null;
    }
    const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId }, include: { draft: { select: { id: true, courtId: true, card: true } } } });
    const result = await paymentGateway().settle({ intentId, amountCents: intent.amountCents, chosen, at: now });
    const paymentId = randomUUID();
    await tx.payment.create({
      data: {
        id: paymentId,
        caseFileId: null,
        courtId: intent.draft.courtId,
        draftId: intent.draftId,
        intentId,
        method: intent.method,
        purpose: 'COURT_FEE',
        amountCents: intent.amountCents,
        payerUserId: subject.userId,
        status: result.status,
        operationRef: result.operationRef,
        paidAt: now,
      },
    });
    await tx.paymentIntent.update({ where: { id: intentId }, data: { status: result.status, completedAt: now } });
    if (result.status === 'SUCCEEDED') {
      // «قيد في محاسبة الصندوق», and the fee as it was paid.
      await tx.treasuryEntry.create({
        data: { courtId: intent.draft.courtId, draftId: intent.draftId, paymentId, direction: 'IN', amountCents: intent.amountCents, purpose: 'COURT_FEE', at: now },
      });
      const breakdown = intent.breakdown as { totalCents?: number };
      await tx.feeAssessment.create({
        data: {
          draftId: intent.draftId,
          filing: 'APPLICATION',
          ruleSetId: intent.ruleSetId,
          totalCents: BigInt(breakdown.totalCents ?? Number(intent.amountCents)),
          breakdown: intent.breakdown ?? {},
          inputsDigest: intent.inputsDigest,
          assessedAt: now,
        },
      });
      await appendEvent(tx, { action: 'payment.succeeded', details: { intentId, paymentId, amountCents: Number(intent.amountCents), operationRef: result.operationRef }, actor });
      await enqueue(tx, 'payment.receipt', { paymentId });
    } else {
      await appendEvent(tx, { action: result.status === 'FAILED' ? 'payment.failed' : 'payment.cancelled', details: { intentId, paymentId }, actor });
    }
    return { status: result.status, paymentId, operationRef: result.operationRef, paidAt: now, amountCents: Number(intent.amountCents) };
  });
  if (!outcome) {
    await appendStandaloneEvent({ action: 'filing.refused', details: { draftId: null, reason: 'PAYMENT_ALREADY_COMPLETED' }, actor });
    return { ok: false, code: 'PAYMENT_ALREADY_COMPLETED' };
  }
  return { ok: true, ...outcome };
}
