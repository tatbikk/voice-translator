import 'server-only';
import { getDb } from '../db';

// What «وصل الإيداع» and «أداء (محاكاة)» show (study, «المرحلة الأولى»;
// prompt, «الأداء»), read for a draft or an intent the page has authorized.

export interface ReceiptView {
  readonly draftId: string;
  readonly caseFileId: string;
  readonly number: { readonly number: number; readonly code: number; readonly year: number };
  readonly nationalRef: string;
  readonly courtName: string;
  readonly channel: 'ELECTRONIC' | 'PAPER';
  readonly registeredAt: Date | null;
  readonly documents: readonly { readonly id: string; readonly docType: string; readonly title: string | null; readonly declaredNature: string | null; readonly sha256: string; readonly generated: boolean }[];
  readonly payment: { readonly operationRef: string; readonly amountCents: bigint; readonly paidAt: Date } | null;
  /** the generated receipt, once the worker has printed it */
  readonly receiptDocumentId: string | null;
  readonly bailiffName: string | null;
}

export async function receiptView(draftId: string): Promise<ReceiptView | null> {
  const db = getDb();
  const draft = await db.filingDraft.findUnique({
    where: { id: draftId },
    select: { id: true, channel: true, caseFileId: true, documents: { where: { removedAt: null, documentId: { not: null } }, select: { documentId: true } } },
  });
  if (!draft?.caseFileId) return null;
  // The receipt shows what was filed with the draft, as it was filed (review P2-S-06): never a
  // document the file received later, which the draft's author may not be entitled to see.
  const filed = new Set(draft.documents.map((d) => d.documentId));
  const file = await db.caseFile.findUnique({
    where: { id: draft.caseFileId },
    select: {
      id: true,
      number: true,
      code: true,
      year: true,
      nationalRef: true,
      registeredAt: true,
      designatedBailiffUserId: true,
      court: { select: { name: true } },
      documents: { orderBy: { depositedAt: 'asc' }, select: { id: true, docType: true, title: true, declaredNature: true, sha256: true, generated: true } },
      payments: { where: { status: 'SUCCEEDED' }, orderBy: { paidAt: 'asc' }, take: 1, select: { operationRef: true, amountCents: true, paidAt: true } },
    },
  });
  if (!file) return null;
  const bailiff = file.designatedBailiffUserId ? await db.user.findUnique({ where: { id: file.designatedBailiffUserId }, select: { fullName: true } }) : null;
  return {
    draftId: draft.id,
    caseFileId: file.id,
    number: { number: file.number, code: file.code, year: file.year },
    nationalRef: file.nationalRef,
    courtName: file.court.name,
    channel: draft.channel,
    registeredAt: file.registeredAt,
    documents: file.documents.filter((d) => filed.has(d.id)),
    payment: file.payments[0] ?? null,
    receiptDocumentId: file.documents.find((d) => d.docType === 'FILING_RECEIPT')?.id ?? null,
    bailiffName: bailiff?.fullName ?? null,
  };
}

export interface IntentView {
  readonly id: string;
  readonly draftId: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  readonly amountCents: bigint;
  readonly method: 'ONLINE' | 'COUNTER';
  readonly expiresAt: Date;
  readonly courtName: string | null;
  readonly payment: { readonly operationRef: string; readonly paidAt: Date; readonly status: string } | null;
  /** the generated «وصل الأداء», once printed */
  readonly receiptDocumentId: string | null;
}

export async function intentView(intentId: string, now: Date): Promise<IntentView | null> {
  const db = getDb();
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      draftId: true,
      status: true,
      amountCents: true,
      method: true,
      expiresAt: true,
      payment: { select: { operationRef: true, paidAt: true, status: true } },
      draft: { select: { court: { select: { name: true } } } },
    },
  });
  if (!intent) return null;
  const receipt = intent.status === 'SUCCEEDED' ? await db.filingDocument.findFirst({ where: { draftId: intent.draftId, kind: 'PAYMENT_RECEIPT' }, select: { id: true } }) : null;
  return {
    id: intent.id,
    draftId: intent.draftId,
    status: intent.status === 'PENDING' && intent.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : intent.status,
    amountCents: intent.amountCents,
    method: intent.method,
    expiresAt: intent.expiresAt,
    courtName: intent.draft.court?.name ?? null,
    payment: intent.payment,
    receiptDocumentId: receipt?.id ?? null,
  };
}
