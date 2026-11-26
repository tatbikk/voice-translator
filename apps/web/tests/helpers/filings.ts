// The filing path of Phase 2 driven through its API, as the wizard drives it
// (docs/phases/phase-2.md): a draft, its court and case type, the application
// (pasted, or uploaded), the case card and its attestation, the exhibits, the
// fee through the simulated gateway, then the signature and filing. Jobs of
// the worker (the fixed copy, the receipts) are run inline with runJobs().
import { expect } from 'vitest';
import { setSigningSecret } from '@/server/signature/service';
import { JOB_HANDLERS } from '@/server/jobs/handlers';
import { runDueJobs } from '@/server/jobs/queue';
import { CARD_SECTIONS, COMMERCIAL_PAYMENT, MODEL_CASE, MODEL_CASE_APPLICATION_TEXT, MODEL_CASE_EXHIBITS, type Card } from '../acceptance/model-case-filing.fixture';
import { describeResponse, type ApiResponse, type Client } from './http';
import { pdfBytes } from './samples';
import { trackSensitive } from './sensitive';

export interface DraftDocumentView {
  readonly id: string;
  readonly kind: 'APPLICATION_ORIGINAL' | 'APPLICATION_COPY' | 'EXHIBIT' | 'PAYMENT_RECEIPT';
  readonly title: string | null;
  readonly mediaType: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly declaredNature: string | null;
  readonly pageCount: number | null;
  readonly paperOriginalLocation: string | null;
}

export interface CheckView {
  readonly code: string;
  readonly level: 'WARNING' | 'BLOCKING';
  readonly article: number | null;
  readonly section: string | null;
  readonly partyKey: string | null;
}

export interface DraftView {
  readonly draft: {
    readonly id: string;
    readonly channel: 'ELECTRONIC' | 'PAPER';
    readonly status: 'DRAFT' | 'FILED';
    readonly courtId: string | null;
    readonly suggestedCourtId: string | null;
    readonly caseType: string | null;
    readonly card: Card;
    readonly applicationMode: 'UPLOAD' | 'PASTE' | 'SCAN' | null;
    readonly fixedCopyStatus: 'NONE' | 'PENDING' | 'READY' | 'FAILED';
    readonly designatedBailiffUserId: string | null;
    readonly attestations: readonly string[];
    readonly caseFileId: string | null;
  };
  readonly documents: readonly DraftDocumentView[];
  readonly fee: { readonly totalCents: number; readonly uncertain: boolean; readonly lines: readonly { kind: string; amountCents: number; basis: string; uncertain: boolean; claimNature?: string | null }[]; readonly excluded: readonly string[] } | null;
  readonly payment: { readonly status: 'NONE' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED'; readonly intentId: string | null; readonly operationRef: string | null };
  readonly claimsLocked: boolean;
  readonly checks: readonly CheckView[];
  readonly suggestion: { readonly courtId: string | null; readonly thresholdExceeded: boolean | null } | null;
  readonly bailiffs: readonly { readonly userId: string; readonly name: string }[];
}

export interface FiledCase {
  readonly caseFileId: string;
  readonly number: number;
  readonly code: number;
  readonly year: number;
  readonly nationalRef: string;
}

function expectOk(res: ApiResponse, what: string): void {
  expect(res.status, `${what}: ${describeResponse(res)}`).toBe(200);
}

/** Runs the worker's due jobs now (the fixed copy, the receipts). */
export async function runJobs(): Promise<number> {
  let total = 0;
  for (let round = 0; round < 5; round += 1) {
    const ran = await runDueJobs(JOB_HANDLERS);
    total += ran;
    if (ran === 0) break;
  }
  return total;
}

/** The signing secret of a test user (decision 48: the demo password, hashed apart). */
export async function giveSigningSecret(userId: string, secret = 'Signing-secret-2026'): Promise<string> {
  trackSensitive('password', secret);
  await setSigningSecret(userId, secret);
  return secret;
}

export async function createDraft(client: Client): Promise<string> {
  const res = await client.post<{ draftId: string }>('/api/v1/filings', {});
  expectOk(res, 'new filing');
  return res.data!.draftId;
}

export async function createPaperDraft(client: Client): Promise<string> {
  const res = await client.post<{ draftId: string }>('/api/v1/filings/paper', {});
  expectOk(res, 'paper filing');
  return res.data!.draftId;
}

export async function getDraft(client: Client, draftId: string): Promise<DraftView> {
  const res = await client.get<DraftView>(`/api/v1/filings/${draftId}`);
  expectOk(res, 'read draft');
  return res.data!;
}

export function updateDraft(client: Client, draftId: string, body: Record<string, unknown>): Promise<ApiResponse<DraftView>> {
  return client.post<DraftView>(`/api/v1/filings/${draftId}`, body);
}

export function pasteApplication(client: Client, draftId: string, text: string): Promise<ApiResponse> {
  return client.post(`/api/v1/filings/${draftId}/application-text`, { text });
}

export interface UploadOptions {
  readonly kind: 'APPLICATION' | 'EXHIBIT';
  /** the file name as the browser sends it; its extension is checked against the content */
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly title?: string;
  readonly nature?: 'ORIGINAL' | 'CERTIFIED_COPY' | 'PHOTOCOPY';
  readonly pages?: number;
  readonly location?: string;
  readonly headers?: Readonly<Record<string, string | null>>;
}

export function upload(client: Client, draftId: string, options: UploadOptions): Promise<ApiResponse<{ documentId: string; mediaType: string; sha256: string }>> {
  return client.post(`/api/v1/filings/${draftId}/documents`, undefined, {
    query: {
      kind: options.kind,
      name: options.name,
      title: options.title,
      nature: options.nature,
      pages: options.pages,
      location: options.location,
    },
    rawBody: Buffer.from(options.bytes),
    headers: { 'content-type': 'application/octet-stream', ...options.headers },
  });
}

export function updateDocument(client: Client, draftId: string, documentId: string, body: Record<string, unknown>): Promise<ApiResponse> {
  return client.post(`/api/v1/filings/${draftId}/documents/${documentId}`, body);
}

export async function openPayment(client: Client, draftId: string): Promise<{ intentId: string; amountCents: number }> {
  const res = await client.post<{ intentId: string; amountCents: number }>(`/api/v1/filings/${draftId}/payment`, {});
  expectOk(res, 'open payment');
  return res.data!;
}

export function settle(client: Client, intentId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'): Promise<ApiResponse<{ status: string; operationRef: string | null }>> {
  return client.post(`/api/v1/payments/${intentId}/outcome`, { outcome });
}

export function submit(client: Client, draftId: string, body: Record<string, unknown> = {}): Promise<ApiResponse<FiledCase>> {
  return client.post<FiledCase>(`/api/v1/filings/${draftId}/submit`, body);
}

export async function attestAll(client: Client, draftId: string): Promise<void> {
  expectOk(await updateDraft(client, draftId, { attest: [...CARD_SECTIONS] }), 'attest card');
}

export interface PrepareOptions {
  readonly card?: Card;
  readonly caseType?: string;
  readonly defendantLocality?: string;
  /** paste the application (default), or upload it as a PDF */
  readonly application?: 'paste' | 'pdf';
  readonly exhibits?: number;
  readonly bailiffUserId?: string;
}

/** A draft ready to be paid: court, case type, application, card attested, exhibits declared. */
export async function prepareDraft(client: Client, options: PrepareOptions = {}): Promise<string> {
  const draftId = await createDraft(client);
  const first = await updateDraft(client, draftId, {
    caseType: options.caseType ?? COMMERCIAL_PAYMENT,
    defendantLocality: options.defendantLocality ?? 'casablanca',
  });
  expectOk(first, 'case type and court');
  const suggested = first.data!.suggestion?.courtId ?? null;
  expect(suggested, 'a court is suggested for the defendant’s locality').not.toBeNull();
  expectOk(await updateDraft(client, draftId, { courtId: suggested }), 'choose court');

  if ((options.application ?? 'paste') === 'paste') {
    expectOk(await pasteApplication(client, draftId, MODEL_CASE_APPLICATION_TEXT), 'paste application');
    await runJobs();
  } else {
    expectOk(await upload(client, draftId, { kind: 'APPLICATION', name: 'maqal.pdf', bytes: pdfBytes('application') }), 'upload application');
  }

  expectOk(await updateDraft(client, draftId, { card: options.card ?? MODEL_CASE }), 'case card');
  await attestAll(client, draftId);
  const exhibits = MODEL_CASE_EXHIBITS.slice(0, options.exhibits ?? 3);
  for (const [i, exhibit] of exhibits.entries()) {
    expectOk(
      await upload(client, draftId, { kind: 'EXHIBIT', name: `exhibit-${String(i + 1)}.pdf`, bytes: pdfBytes(exhibit.title), title: exhibit.title, nature: exhibit.nature }),
      `exhibit ${String(i + 1)}`,
    );
  }
  if (options.bailiffUserId) expectOk(await updateDraft(client, draftId, { bailiffUserId: options.bailiffUserId }), 'designate bailiff');
  const view = await getDraft(client, draftId);
  expect(view.draft.fixedCopyStatus, 'the fixed copy of the application is ready').toBe('READY');
  return draftId;
}

/** Pays the fee of a prepared draft through the simulated gateway. */
export async function payDraft(client: Client, draftId: string): Promise<string> {
  const { intentId } = await openPayment(client, draftId);
  const res = await settle(client, intentId, 'SUCCEEDED');
  expectOk(res, 'payment succeeded');
  await runJobs();
  return intentId;
}

/** The whole electronic path, from the first screen to the receipt. */
export async function fileCase(client: Client, secret: string, options: PrepareOptions = {}): Promise<FiledCase & { draftId: string }> {
  const draftId = await prepareDraft(client, options);
  await payDraft(client, draftId);
  const res = await submit(client, draftId, { secret });
  expectOk(res, 'sign and file');
  await runJobs();
  return { ...res.data!, draftId };
}
