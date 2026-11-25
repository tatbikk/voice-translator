import 'server-only';
import { randomUUID } from 'node:crypto';
import { formatMoroccoDate, formatMoroccoTime } from '@mahkama/core';
import { translator } from '@/i18n/translate';
import { clock } from '../clock';
import { getDb } from '../db';
import { DocumentGenerationError, generatePdf, type GenerateInput, type TemplateName } from '../documents/generate';
import { sha256Hex } from '../documents/service';
import { documentStore } from '../documents/store';
import { appendEvent, appendStandaloneEvent, eventTransaction } from '../events/append';
import { draftStorageKey, sha256 } from './drafts';

// The documents the worker prints for the filing path (review P1-A-06): the
// fixed copy of an application pasted or deposited as a Word document (study:
// «نسخة ثابتة غير قابلة للتعديل هي التي تدخل الملف وتبلغ للخصم»), the receipt
// of a payment (art. 628: «بوصل يتضمن تاريخ وساعة الإجراء القضائي»), and
// «وصل الإيداع». Every page carries the demo line while the signature is simulated.

const t = translator('ar');

export function dirhamsText(cents: bigint | number): string {
  const value = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents));
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = value % 100n;
  return t('case.amount', { amount: fraction === 0n ? whole : `${whole},${fraction.toString().padStart(2, '0')}` });
}

/** The digest of the paragraphs a fixed copy is printed from. */
export const paragraphsDigest = (paragraphs: readonly string[]) => sha256(JSON.stringify(paragraphs));

function input(template: TemplateName, header: Omit<GenerateInput['header'], 'logoSlot' | 'dateLabel' | 'date' | 'nationalRefLabel' | 'caseNumberLabel'> & { caseNumberLabel?: string }, data: GenerateInput['data']): GenerateInput {
  return {
    template,
    header: {
      logoSlot: t('documents.logoSlot'),
      dateLabel: t('documents.date'),
      date: formatMoroccoDate(clock.now()),
      nationalRefLabel: t('documents.nationalRef'),
      caseNumberLabel: header.caseNumberLabel ?? t('documents.caseNumber'),
      ...header,
    },
    data,
    signatures: [],
    environmentLine: t('documents.environmentLine'),
    pageLabel: t('documents.pageLabel'),
  };
}

const draftRef = (draftId: string) => draftId.slice(0, 8).toUpperCase();

async function courtName(courtId: string | null): Promise<string> {
  if (!courtId) return t('documents.registry');
  return (await getDb().court.findUnique({ where: { id: courtId }, select: { name: true } }))?.name ?? t('documents.registry');
}

async function printOrRecord(template: TemplateName, generate: GenerateInput, caseFileId: string | null): Promise<Uint8Array | null> {
  try {
    return await generatePdf(generate);
  } catch (error) {
    if (error instanceof DocumentGenerationError) {
      await appendStandaloneEvent({ action: 'document.generation.failed', details: { template, errorClass: error.stage }, caseFileId });
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

/** The fixed copy of the application, for the paragraphs whose digest the job carries. */
export async function prepareFixedCopy(draftId: string, textDigest: string): Promise<void> {
  const draft = await getDb().filingDraft.findUnique({ where: { id: draftId }, select: { id: true, status: true, courtId: true, applicationParagraphs: true, fixedCopyStatus: true } });
  if (!draft || draft.status !== 'DRAFT') return;
  const paragraphs = Array.isArray(draft.applicationParagraphs) ? draft.applicationParagraphs.filter((p): p is string => typeof p === 'string') : [];
  // A newer text replaced the one this job was for: its own job prints it.
  if (paragraphs.length === 0 || paragraphsDigest(paragraphs) !== textDigest) return;
  const generate = input(
    'application-copy',
    {
      headerLines: [await courtName(draft.courtId), t('documents.registry')],
      title: t('documents.title.application-copy'),
      caseNumberLabel: t('documents.draftRef'),
      caseNumber: draftRef(draft.id),
      nationalRef: t('documents.notRegistered'),
    },
    { intro: t('documents.fixedCopy.intro'), paragraphs: paragraphs.map((text, i) => ({ n: i + 1, text })) },
  );
  const bytes = await printOrRecord('application-copy', generate, null);
  if (!bytes) {
    await getDb().filingDraft.updateMany({ where: { id: draftId, status: 'DRAFT' }, data: { fixedCopyStatus: 'FAILED', updatedAt: clock.now() } });
    return;
  }
  const key = draftStorageKey(draftId);
  const digest = sha256Hex(bytes);
  await documentStore().put(key, bytes, 'application/pdf');
  await eventTransaction(async (tx) => {
    // The draft is read again under lock: the text must still be the one printed.
    const locked = await tx.$queryRaw<{ status: string; paragraphs: unknown }[]>`
      SELECT status::text AS status, "applicationParagraphs" AS paragraphs FROM "FilingDraft" WHERE id = ${draftId}::uuid FOR UPDATE`;
    const current = locked[0];
    if (!current || current.status !== 'DRAFT' || !Array.isArray(current.paragraphs) || paragraphsDigest(current.paragraphs as string[]) !== textDigest) return;
    const now = clock.now();
    await tx.filingDocument.updateMany({ where: { draftId, kind: 'APPLICATION_COPY', removedAt: null }, data: { removedAt: now } });
    const id = randomUUID();
    await tx.filingDocument.create({
      data: {
        id,
        draftId,
        kind: 'APPLICATION_COPY',
        storageKey: key,
        sha256: digest,
        byteSize: bytes.byteLength,
        mediaType: 'application/pdf',
        title: t('documents.title.application-copy'),
        generated: true,
        uploadedAt: now,
      },
    });
    await tx.filingDraft.update({ where: { id: draftId }, data: { fixedCopyStatus: 'READY', updatedAt: now } });
    await appendEvent(tx, { action: 'filing.fixed-copy.prepared', details: { draftId, documentId: id, sha256: digest, paragraphs: paragraphs.length } });
  });
}

// ---------------------------------------------------------------------------

/** «وصل الأداء» of a successful payment, kept with the draft and joining the file on registration. */
export async function issuePaymentReceipt(paymentId: string): Promise<void> {
  const payment = await getDb().payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, amountCents: true, operationRef: true, paidAt: true, method: true, draftId: true, courtId: true, caseFileId: true, payerUserId: true, receiptDocumentId: true },
  });
  if (!payment || payment.status !== 'SUCCEEDED' || !payment.draftId || payment.receiptDocumentId) return;
  const draftId = payment.draftId;
  if (await getDb().filingDocument.findFirst({ where: { draftId, kind: 'PAYMENT_RECEIPT' }, select: { id: true } })) return;
  const payer = payment.payerUserId ? (await getDb().user.findUnique({ where: { id: payment.payerUserId }, select: { fullName: true } }))?.fullName ?? '' : '';
  const generate = input(
    'payment-receipt',
    {
      headerLines: [await courtName(payment.courtId), t('documents.registry')],
      title: t('documents.title.payment-receipt'),
      caseNumberLabel: t('documents.draftRef'),
      caseNumber: draftRef(draftId),
      nationalRef: t('documents.notRegistered'),
    },
    {
      paidDate: formatMoroccoDate(payment.paidAt),
      paidTime: formatMoroccoTime(payment.paidAt),
      subject: t('documents.paymentReceipt.subject'),
      payer,
      amount: dirhamsText(payment.amountCents),
      operationRef: payment.operationRef,
      method: t(`filing.payment.method.${payment.method ?? 'ONLINE'}`),
      lines: [{ line: t('documents.paymentReceipt.simulated') }],
    },
  );
  const bytes = await printOrRecord('payment-receipt', generate, payment.caseFileId);
  if (!bytes) return;
  const key = draftStorageKey(draftId);
  const digest = sha256Hex(bytes);
  await documentStore().put(key, bytes, 'application/pdf');
  await eventTransaction(async (tx) => {
    // The draft is locked: the receipt joins either the draft, or the file it became.
    await tx.$queryRaw`SELECT id FROM "FilingDraft" WHERE id = ${draftId}::uuid FOR UPDATE`;
    if (await tx.filingDocument.findFirst({ where: { draftId, kind: 'PAYMENT_RECEIPT' }, select: { id: true } })) return;
    const now = clock.now();
    const id = randomUUID();
    const draft = await tx.filingDraft.findUnique({ where: { id: draftId }, select: { caseFileId: true } });
    await tx.filingDocument.create({
      data: { id, draftId, kind: 'PAYMENT_RECEIPT', storageKey: key, sha256: digest, byteSize: bytes.byteLength, mediaType: 'application/pdf', title: t('documents.title.payment-receipt'), generated: true, uploadedAt: now },
    });
    if (draft?.caseFileId) {
      // The draft was filed before the receipt was printed: it joins the file at once.
      const documentId = randomUUID();
      await tx.document.create({
        data: {
          id: documentId,
          caseFileId: draft.caseFileId,
          storageKey: key,
          sha256: digest,
          byteSize: bytes.byteLength,
          mediaType: 'application/pdf',
          docType: 'PAYMENT_RECEIPT',
          title: t('documents.title.payment-receipt'),
          channel: 'ELECTRONIC',
          depositedAt: now,
          generated: true,
          simulated: true,
          visibility: 'CASE',
        },
      });
      await tx.filingDocument.update({ where: { id }, data: { documentId } });
      // The payment points at the receipt once, at the file's document (trigger money_record_guard).
      await tx.payment.update({ where: { id: paymentId }, data: { receiptDocumentId: documentId } });
    }
    await appendEvent(tx, { action: 'payment.receipt.issued', details: { draftId, paymentId, documentId: id }, caseFileId: draft?.caseFileId ?? null });
  });
}

// ---------------------------------------------------------------------------

/** «وصل الإيداع» (study, «المرحلة الأولى»; art. 77 and 628). */
export async function issueFilingReceipt(caseFileId: string): Promise<void> {
  const db = getDb();
  const file = await db.caseFile.findUnique({
    where: { id: caseFileId },
    select: {
      id: true,
      number: true,
      code: true,
      year: true,
      nationalRef: true,
      registeredAt: true,
      filingChannel: true,
      designatedBailiffUserId: true,
      court: { select: { name: true } },
      filingDraft: { select: { id: true, ownerUserId: true, paperDepositor: true } },
      documents: { select: { id: true, docType: true, title: true, declaredNature: true, sha256: true, paperOriginalLocation: true, depositedAt: true }, orderBy: { depositedAt: 'asc' } },
      payments: { where: { status: 'SUCCEEDED' }, select: { operationRef: true, amountCents: true } },
    },
  });
  if (!file?.filingDraft) return;
  if (file.documents.some((d) => d.docType === 'FILING_RECEIPT')) return;
  const draft = file.filingDraft;
  const at = file.registeredAt ?? clock.now();
  const depositor =
    file.filingChannel === 'PAPER'
      ? String((draft.paperDepositor as { name?: unknown } | null)?.name ?? '')
      : ((await db.user.findUnique({ where: { id: draft.ownerUserId }, select: { fullName: true } }))?.fullName ?? '');
  const bailiff = file.designatedBailiffUserId ? (await db.user.findUnique({ where: { id: file.designatedBailiffUserId }, select: { fullName: true } }))?.fullName ?? null : null;
  const filed = file.documents.filter((d) => d.docType === 'APPLICATION' || d.docType === 'APPLICATION_SOURCE' || d.docType === 'EXHIBIT');
  const payment = file.payments[0];
  const paperLocation = file.documents.find((d) => d.docType === 'APPLICATION')?.paperOriginalLocation ?? null;
  const generate = input(
    'filing-receipt',
    {
      headerLines: [file.court.name, t('documents.registry')],
      title: t('documents.title.filing-receipt'),
      caseNumber: `${String(file.number)}/${String(file.code)}/${String(file.year)}`,
      nationalRef: file.nationalRef,
    },
    {
      filingName: t('documents.filingReceipt.filingName'),
      channelPhrase: t(`documents.filingReceipt.channel.${file.filingChannel ?? 'ELECTRONIC'}`),
      depositor,
      depositDate: formatMoroccoDate(at),
      depositTime: formatMoroccoTime(at),
      documents: filed.map((d) => ({
        title: d.title ?? t(`case.documents.type.${d.docType}`),
        nature: d.declaredNature ? t(`case.documents.nature.${d.declaredNature}`) : t('documents.filingReceipt.generatedNature'),
        hash: d.sha256,
      })),
      exhibitCount: filed.filter((d) => d.docType === 'EXHIBIT').length,
      paymentRef: payment?.operationRef ?? '',
      feeAmount: payment ? dirhamsText(payment.amountCents) : '',
      paper: file.filingChannel === 'PAPER' && paperLocation ? [{ paperLocation }] : [],
      bailiff: bailiff ? [{ bailiffName: bailiff }] : [],
    },
  );
  const bytes = await printOrRecord('filing-receipt', generate, caseFileId);
  if (!bytes) return;
  const id = randomUUID();
  const key = `cases/${caseFileId}/${id}`;
  const digest = sha256Hex(bytes);
  await documentStore().put(key, bytes, 'application/pdf');
  await eventTransaction(async (tx) => {
    const exists = await tx.document.findFirst({ where: { caseFileId, docType: 'FILING_RECEIPT' }, select: { id: true } });
    if (exists) return;
    await tx.document.create({
      data: {
        id,
        caseFileId,
        storageKey: key,
        sha256: digest,
        byteSize: bytes.byteLength,
        mediaType: 'application/pdf',
        docType: 'FILING_RECEIPT',
        title: t('documents.title.filing-receipt'),
        channel: file.filingChannel ?? 'ELECTRONIC',
        depositedAt: clock.now(),
        generated: true,
        simulated: true,
        visibility: 'CASE',
      },
    });
    await appendEvent(tx, { action: 'document.stored', details: { documentId: id, sha256: digest, byteSize: bytes.byteLength, generated: true, docType: 'FILING_RECEIPT' }, caseFileId });
    await appendEvent(tx, { action: 'filing.receipt.issued', details: { caseFileId, documentId: id }, caseFileId });
  });
}
