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
import { paidAmountUncertain, type PaidAmount, type StoredAssessment } from '../payments/uncertainty';
import { draftStorageKey, sha256 } from './drafts';

// The documents the worker prints for the filing path (review P1-A-06): the
// fixed copy of an application pasted or deposited as a Word document (study:
// «نسخة ثابتة غير قابلة للتعديل هي التي تدخل الملف وتبلغ للخصم»), the receipt
// of a payment (art. 628: «بوصل يتضمن تاريخ وساعة الإجراء القضائي»),
// «وصل الإيداع», and «شهادة توقيع» of the electronic application once signed
// (decision 72). Every page carries the demo line while the signature is simulated.

const t = translator('ar');

export function dirhamsText(cents: bigint | number): string {
  const value = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents));
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = value % 100n;
  return t('case.amount', { amount: fraction === 0n ? whole : `${whole},${fraction.toString().padStart(2, '0')}` });
}

/**
 * The mark that goes with the amount of a fee in a printed receipt, or nothing: «قيمة مؤقتة غير
 * مؤكدة» while the amount rests on something the fee table marked uncertain, as the assessment
 * stored with the payment says (prompt, rule 5; independent review IR-26).
 */
export function provisionalMark(payment: PaidAmount, fileAssessments: readonly StoredAssessment[] = []): string {
  return paidAmountUncertain(payment, fileAssessments) ? t('common.provisionalValue') : '';
}

/** The digest of the paragraphs a fixed copy is printed from. */
export const paragraphsDigest = (paragraphs: readonly string[]) => sha256(JSON.stringify(paragraphs));

function input(
  template: TemplateName,
  header: Omit<GenerateInput['header'], 'logoSlot' | 'dateLabel' | 'date' | 'nationalRefLabel' | 'caseNumberLabel'> & { caseNumberLabel?: string },
  data: GenerateInput['data'],
  signatures: GenerateInput['signatures'] = [],
): GenerateInput {
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
    signatures,
    environmentLine: t('documents.environmentLine'),
    pageLabel: t('documents.pageLabel'),
  };
}

/** The draft's reference on its documents: digits only (no Latin letter in a document, review P2-L-21). */
const draftRef = (draftId: string) => String(Number.parseInt(draftId.slice(0, 8), 16)).padStart(10, '0');

function depositorName(depositor: unknown): string {
  const name = (depositor as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : '';
}

async function courtName(courtId: string | null): Promise<string> {
  if (!courtId) return t('documents.registry');
  return (await getDb().court.findUnique({ where: { id: courtId }, select: { name: true } }))?.name ?? t('documents.registry');
}

/** How a document job prints: its stop signal, and whether a failure is final. */
export interface PrintContext {
  readonly signal?: AbortSignal;
  readonly lastAttempt: boolean;
}

/**
 * A failed print is thrown back to the queue, which tries it again within its
 * attempts; only the last failure is recorded and ends the job (review P2-A-05).
 */
async function printOrRecord(template: TemplateName, generate: GenerateInput, caseFileId: string | null, context: PrintContext): Promise<Uint8Array | null> {
  try {
    return await generatePdf(generate, context.signal);
  } catch (error) {
    if (error instanceof DocumentGenerationError && context.lastAttempt) {
      await appendStandaloneEvent({ action: 'document.generation.failed', details: { template, errorClass: error.stage }, caseFileId });
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

/** The fixed copy of the application, for the paragraphs whose digest the job carries. */
export async function prepareFixedCopy(draftId: string, textDigest: string, context: PrintContext = { lastAttempt: true }): Promise<void> {
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
  const bytes = await printOrRecord('application-copy', generate, null, context);
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
export async function issuePaymentReceipt(paymentId: string, context: PrintContext = { lastAttempt: true }): Promise<void> {
  const payment = await getDb().payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      purpose: true,
      amountCents: true,
      operationRef: true,
      paidAt: true,
      method: true,
      draftId: true,
      courtId: true,
      caseFileId: true,
      payerUserId: true,
      receiptDocumentId: true,
      intent: { select: { breakdown: true } },
    },
  });
  if (!payment || payment.status !== 'SUCCEEDED' || !payment.draftId || payment.receiptDocumentId) return;
  const draftId = payment.draftId;
  if (await getDb().filingDocument.findFirst({ where: { draftId, kind: 'PAYMENT_RECEIPT' }, select: { id: true } })) return;
  // At the court's cash desk the payer is the depositor, never the clerk who recorded the
  // payment (art. 628; decision 60; review P2-L-04): the depositor's name is recorded
  // before the fee can be paid (check PAPER_DEPOSITOR_MISSING blocks the payment).
  const counter = payment.method === 'COUNTER';
  const depositor = counter
    ? depositorName((await getDb().filingDraft.findUnique({ where: { id: draftId }, select: { paperDepositor: true } }))?.paperDepositor ?? null)
    : '';
  const payer =
    !counter && payment.payerUserId ? ((await getDb().user.findUnique({ where: { id: payment.payerUserId }, select: { fullName: true } }))?.fullName ?? '') : '';
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
      counter,
      depositor,
      payer,
      amount: dirhamsText(payment.amountCents),
      provisional: provisionalMark(payment),
      operationRef: payment.operationRef,
      method: t(`filing.payment.method.${payment.method ?? 'ONLINE'}`),
      lines: [{ line: t('documents.paymentReceipt.simulated') }],
    },
  );
  const bytes = await printOrRecord('payment-receipt', generate, payment.caseFileId, context);
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

const isApplication = (d: { docType: string }) => d.docType === 'APPLICATION' || d.docType === 'APPLICATION_SOURCE';

/**
 * The column «نوعيتها» of the receipt (review P2-L-03): the nature declared (art. 631); else
 * «ولدتها المنصة» for what the platform printed; else, in a paper filing, the scan whose paper
 * original the registry keeps; else nothing.
 */
function natureText(d: { declaredNature: string | null; generated: boolean }, paper: boolean): string {
  if (d.declaredNature) return t(`case.nature.${d.declaredNature}`);
  if (d.generated) return t('documents.filingReceipt.generatedNature');
  return t(paper ? 'documents.filingReceipt.scannedNature' : 'case.nature.none');
}

/** «وصل الإيداع» (study, «المرحلة الأولى»; art. 77 and 628). */
export async function issueFilingReceipt(caseFileId: string, context: PrintContext = { lastAttempt: true }): Promise<void> {
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
      documents: { select: { id: true, docType: true, title: true, declaredNature: true, generated: true, sha256: true, paperOriginalLocation: true, depositedAt: true }, orderBy: { depositedAt: 'asc' } },
      payments: { where: { status: 'SUCCEEDED' }, select: { operationRef: true, amountCents: true, purpose: true, intent: { select: { breakdown: true } } } },
      fees: { select: { totalCents: true, breakdown: true } },
    },
  });
  if (!file?.filingDraft) return;
  if (file.documents.some((d) => d.docType === 'FILING_RECEIPT')) return;
  const draft = file.filingDraft;
  const at = file.registeredAt ?? clock.now();
  const depositor =
    file.filingChannel === 'PAPER'
      ? depositorName(draft.paperDepositor)
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
        // The application is named as such, not by the name of the file uploaded (review P2-L-03).
        title: isApplication(d) && !d.generated ? t('terms.initialApplication') : (d.title ?? t(`case.docType.${d.docType}`)),
        nature: natureText(d, file.filingChannel === 'PAPER'),
        hash: d.sha256,
      })),
      exhibitCount: filed.filter((d) => d.docType === 'EXHIBIT').length,
      paymentRef: payment?.operationRef ?? '',
      feeAmount: payment ? dirhamsText(payment.amountCents) : '',
      feeProvisional: payment ? provisionalMark(payment, file.fees) : '',
      paper: file.filingChannel === 'PAPER' && paperLocation ? [{ paperLocation }] : [],
      bailiff: bailiff ? [{ bailiffName: bailiff }] : [],
    },
  );
  const bytes = await printOrRecord('filing-receipt', generate, caseFileId, context);
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

// ---------------------------------------------------------------------------

/**
 * «شهادة توقيع» of the electronic application signed at registration (independent review IR-07,
 * decision 72). The fixed copy is printed before it is signed, and the signature is on its bytes,
 * which never change: the stamp «توقيع تجريبي», the signer and his role, the date and hour of the
 * signature (Morocco time), the references of the file and the hash signed go on a document of their
 * own, printed beside it. It joins the file linked to the document it attests, at that document's
 * visibility, once: a second run finds it and prints nothing.
 */
export async function issueSignatureCertificate(documentId: string, context: PrintContext = { lastAttempt: true }): Promise<void> {
  const db = getDb();
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      caseFileId: true,
      sha256: true,
      docType: true,
      title: true,
      generated: true,
      visibility: true,
      caseFile: { select: { number: true, code: true, year: true, nationalRef: true, court: { select: { name: true } } } },
      // The circle of the filing, completed on the hash the document still has.
      circles: {
        where: { status: 'COMPLETED', purpose: 'APPLICATION_FILING' },
        orderBy: { openedAt: 'asc' },
        select: { id: true, documentSha256: true, signatures: { orderBy: { position: 'asc' }, select: { signerUserId: true, signerRole: true, signedAt: true, provider: true } } },
      },
    },
  });
  if (!doc) return;
  const circle = doc.circles.find((c) => c.documentSha256 === doc.sha256 && c.signatures.length > 0);
  if (!circle) return;
  if (await db.document.findFirst({ where: { attestsDocumentId: doc.id, docType: 'SIGNATURE_CERTIFICATE' }, select: { id: true } })) return;

  const names = new Map(
    (await db.user.findMany({ where: { id: { in: circle.signatures.map((s) => s.signerUserId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );
  const signers = circle.signatures.map((s) => ({
    name: names.get(s.signerUserId) ?? '',
    role: t(`roles.${s.signerRole}`),
    when: t('documents.signedAt', { date: formatMoroccoDate(s.signedAt), time: formatMoroccoTime(s.signedAt) }),
    stamp: t(s.provider === 'SIMULATED' ? 'signature.stamp.simulated' : 'signature.stamp.qualified'),
  }));
  const signedTitle = isApplication(doc) ? t(doc.generated ? 'documents.title.application-copy' : 'terms.initialApplication') : (doc.title ?? t(`case.docType.${doc.docType}`));
  const file = doc.caseFile;
  const generate = input(
    'signature-certificate',
    {
      headerLines: [file.court.name, t('documents.registry')],
      title: t('documents.title.signature-certificate'),
      caseNumber: `${String(file.number)}/${String(file.code)}/${String(file.year)}`,
      nationalRef: file.nationalRef,
    },
    {
      intro: t('documents.signatureCertificate.intro'),
      rows: [
        { label: t('documents.signatureCertificate.document'), value: signedTitle },
        ...signers.flatMap((s) => [
          { label: t('documents.signatureCertificate.signer'), value: s.name },
          { label: t('documents.signatureCertificate.role'), value: s.role },
          { label: t('documents.signatureCertificate.signedAt'), value: s.when },
          { label: t('documents.signatureCertificate.kind'), value: s.stamp },
        ]),
      ],
      hashLabel: t('documents.signatureCertificate.hash'),
      hash: circle.documentSha256,
      closing: t('documents.signatureCertificate.closing'),
    },
    signers.map((s) => ({ role: s.role, name: s.name, stamp: s.stamp, when: s.when, pendingText: '' })),
  );
  const bytes = await printOrRecord('signature-certificate', generate, doc.caseFileId, context);
  if (!bytes) return;
  const id = randomUUID();
  const key = `cases/${doc.caseFileId}/${id}`;
  const digest = sha256Hex(bytes);
  await documentStore().put(key, bytes, 'application/pdf');
  await eventTransaction(async (tx) => {
    // The document attested is locked: one certificate, whatever runs at the same time.
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${doc.id}::uuid FOR UPDATE`;
    if (await tx.document.findFirst({ where: { attestsDocumentId: doc.id, docType: 'SIGNATURE_CERTIFICATE' }, select: { id: true } })) return;
    await tx.document.create({
      data: {
        id,
        caseFileId: doc.caseFileId,
        storageKey: key,
        sha256: digest,
        byteSize: bytes.byteLength,
        mediaType: 'application/pdf',
        docType: 'SIGNATURE_CERTIFICATE',
        title: t('documents.title.signature-certificate'),
        channel: 'ELECTRONIC',
        depositedAt: clock.now(),
        generated: true,
        simulated: circle.signatures.some((s) => s.provider === 'SIMULATED'),
        visibility: doc.visibility,
        attestsDocumentId: doc.id,
      },
    });
    await appendEvent(tx, { action: 'document.stored', details: { documentId: id, sha256: digest, byteSize: bytes.byteLength, generated: true, docType: 'SIGNATURE_CERTIFICATE' }, caseFileId: doc.caseFileId });
    await appendEvent(tx, { action: 'signature.certificate.issued', details: { caseFileId: doc.caseFileId, documentId: id, attestsDocumentId: doc.id, circleId: circle.id }, caseFileId: doc.caseFileId });
  });
}
