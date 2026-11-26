import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  stripInvisible,
  CARD_ADDRESS_FIELDS,
  CARD_SECTIONS,
  FilingCardSchema,
  SECURITY_POLICY,
  canonicalJson,
  type CardAddress,
  type CardSection,
  type FilingCard,
  type UserSubject,
} from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { sha256Hex } from '../documents/service';
import { documentStore } from '../documents/store';
import { appendEvent, appendStandaloneEvent, eventTransaction, type EventActor } from '../events/append';
import { basisOf } from '../events/basis';
import type { ErrorCode } from '../http/responses';
import { enqueue } from '../jobs/queue';
import { asJson } from '../json';
import { commercialRegister } from '../registers/commercial';
import { caseTypeRules, districtRules } from '../rules/store';
import { docxParagraphs, inspectUpload, isArchiveRefusal, pastedParagraphs, uploadTitle, type UploadType } from '../uploads/inspect';
import {
  attestationsFor,
  bailiffsOf,
  claimsLocked,
  documentLimitReached,
  draftStorageKey,
  lawyersRoster,
  newDraftData,
  parseCard,
  suggestionFor,
  type DraftWithParts,
} from './drafts';
import { paragraphsDigest } from './generated';

// The operations on a draft. Each is authorized by the core before it runs
// (filing.draft.edit on the draft's resource); here the content is checked: a
// field that names a court, a bailiff, a case type or a lawyer must name one
// the platform knows for this draft, the claims are locked once paid, and a
// file is known by its bytes. A refusal for its content is recorded in the
// event log (filing.refused), without any of the card's content. Every event an
// operation writes carries the basis of the action that authorized it (independent
// review IR-12, decision 74).

type Tx = Prisma.TransactionClient;

export type Failure = { readonly ok: false; readonly status: number; readonly code: ErrorCode; readonly fields?: Record<string, string> };
export type Outcome<T = undefined> = { readonly ok: true; readonly value: T } | Failure;

const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

async function refused(draftId: string | null, actor: EventActor, status: number, code: ErrorCode, fields?: Record<string, string>): Promise<Failure> {
  await appendStandaloneEvent({ action: 'filing.refused', details: { draftId, reason: code }, actor });
  return { ok: false, status, code, ...(fields ? { fields } : {}) };
}

/** Locks the draft's row and checks that it is still open (a filed draft changes no more). */
async function lockOpenDraft(tx: Tx, draftId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "FilingDraft" WHERE id = ${draftId}::uuid FOR UPDATE`;
  return rows[0]?.status === 'DRAFT';
}

// ---------------------------------------------------------------------------

export async function createDraft(subject: UserSubject, channel: 'ELECTRONIC' | 'PAPER', actor: EventActor): Promise<Outcome<string>> {
  const id = randomUUID();
  const created = await eventTransaction(async (tx) => {
    // An account holds a bounded number of open drafts (review P2-S-07); the event log's lock serializes the count.
    // A draft left untouched for the window no longer counts: an abandoned draft never locks the account out (fix review M3).
    const since = new Date(clock.now().getTime() - SECURITY_POLICY.filing.openDraftWindowMs);
    const open = await tx.filingDraft.count({ where: { ownerUserId: subject.userId, status: 'DRAFT', updatedAt: { gte: since } } });
    if (open >= SECURITY_POLICY.filing.maxOpenDrafts) return false;
    await tx.filingDraft.create({ data: { id, ...newDraftData(subject, channel) } });
    await appendEvent(tx, { action: 'filing.draft.created', details: { draftId: id, channel }, actor, legalBasis: basisOf(channel === 'PAPER' ? 'filing.paper' : 'filing.new', clock.now()) });
    return true;
  });
  if (!created) return refused(null, actor, 409, 'DRAFT_LIMIT');
  return done(id);
}

// ---------------------------------------------------------------------------

const uuid = z.uuid();
export const UpdateDraftBody = z
  .object({
    caseType: z.string().regex(/^\d{3,5}$/).nullable().optional(),
    courtId: uuid.nullable().optional(),
    defendantLocality: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).nullable().optional(),
    card: z.unknown().optional(),
    attest: z.array(z.enum(CARD_SECTIONS)).max(CARD_SECTIONS.length).optional(),
    bailiffUserId: uuid.nullable().optional(),
    paperDepositor: z
      .object({
        name: z.string().trim().min(1).max(200),
        idNumber: z.string().trim().max(60).optional(),
        quality: z.string().trim().max(200).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    paperLawyerUserId: uuid.nullable().optional(),
  })
  .strict();
export type UpdateDraftInput = z.infer<typeof UpdateDraftBody>;

const sameClaims = (a: FilingCard, b: FilingCard) => canonicalJson(a.claims) === canonicalJson(b.claims);
/** The depositor recorded on a paper draft, if a name was. */
const hasDepositor = (value: unknown) => typeof (value as { name?: unknown } | null)?.name === 'string' && (value as { name: string }).name.trim() !== '';
const depositorDiffers = (a: unknown, b: unknown) => canonicalJson(a ?? null) !== canonicalJson(b ?? null);

function cardFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const name = ['card', ...issue.path.map(String)].join('.');
    fields[name] ??= issue.code === 'too_big' ? 'errors.field.tooLong' : 'errors.field.invalid';
  }
  return fields;
}

const ADDRESS_FIELDS = CARD_ADDRESS_FIELDS;
/** A locality code of the districts table, as the card's schema accepts it. */
const LOCALITY_CODE = /^[a-z][a-z0-9-]{1,40}$/;

/**
 * The addresses of the card sent whose locality the districts table in force does not
 * list (independent review IR-08): the card offers its localities only, and the file's
 * court reads its district from them. Keyed as the card's other field errors.
 */
function unknownLocalities(card: FilingCard, localities: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [index, party] of card.parties.entries()) {
    for (const field of ADDRESS_FIELDS) {
      const locality = party[field]?.locality;
      if (locality !== undefined && !localities.includes(locality)) fields[`card.parties.${String(index)}.${field}.locality`] = 'errors.field.invalid';
    }
  }
  return fields;
}
const sameText = (a: string, b: string) => stripInvisible(a).replace(/\s+/g, ' ').trim() === stripInvisible(b).replace(/\s+/g, ' ').trim();

/** An address with neither locality nor country: whether it lies within the court's district is unknown. */
const placeless = (address: CardAddress): CardAddress => {
  const { locality: _locality, country: _country, ...rest } = address;
  return rest;
};

/**
 * The source «السجل التجاري» is the server's to give, never the browser's
 * (review P2-A-08): an address keeps it only when the register answers, for the
 * company's number and name, that very address as its registered office or its
 * branch; the locality is then the register's too (fix review L2). Any other
 * address claimed from the register is kept as declared, and keeps no place: the
 * register's locality does not stay with an office the register does not give as
 * it is, typed again or of another company (review of IR-08). Its place unknown,
 * so is whether it lies within the court's district (decision 69).
 */
async function withRegisterSources(card: FilingCard): Promise<FilingCard> {
  const parties = await Promise.all(
    card.parties.map(async (party) => {
      const claimed = ADDRESS_FIELDS.filter((field) => party[field]?.source === 'COMMERCIAL_REGISTER');
      if (claimed.length === 0) return party;
      const entry =
        party.personKind === 'LEGAL' && party.idNumber ? await commercialRegister().lookup(party.idNumber).catch(() => null) : null;
      const next = { ...party };
      const sameCompany = entry !== null && sameText(entry.name, party.name);
      for (const field of claimed) {
        const address = party[field];
        if (!address) continue;
        const given = field === 'registeredOffice' ? entry?.registeredOffice : field === 'branch' ? entry?.branch : null;
        if (!sameCompany || !given || !sameText(given, address.value)) next[field] = { ...placeless(address), source: 'DECLARED' };
        else {
          // The register's own locality for the address it gives (it gives one for the registered
          // office only), never a locality or a country typed beside it.
          const locality = field === 'registeredOffice' && entry.locality && LOCALITY_CODE.test(entry.locality) ? entry.locality : null;
          next[field] = { ...placeless(address), ...(locality ? { locality } : {}) };
        }
      }
      return next;
    }),
  );
  return { ...card, parties };
}

/** The attested sections whose parties the server changed while saving the card. */
function sectionsRewritten(sent: FilingCard, saved: FilingCard): CardSection[] {
  const out = new Set<CardSection>();
  for (const [index, party] of saved.parties.entries()) {
    if (canonicalJson(party) !== canonicalJson(sent.parties[index])) out.add(party.side === 'PLAINTIFF' ? 'PLAINTIFFS' : 'DEFENDANTS');
  }
  return [...out];
}

export async function updateDraft(draft: DraftWithParts, subject: UserSubject, body: UpdateDraftInput, actor: EventActor): Promise<Outcome> {
  const now = clock.now();
  const invalid = (field: string) => refused(draft.id, actor, 422, 'INVALID_INPUT', { [field]: 'errors.field.invalid' });
  const changed: string[] = [];
  const data: Prisma.FilingDraftUpdateInput = {};
  const current = parseCard(draft.card);
  let card = current;
  let rewritten: CardSection[] = [];
  const locked = claimsLocked(draft.intents);

  if (body.card !== undefined) {
    const parsed = FilingCardSchema.safeParse(body.card);
    if (!parsed.success) return refused(draft.id, actor, 422, 'INVALID_INPUT', cardFieldErrors(parsed.error));
    const unknown = unknownLocalities(parsed.data, (await districtRules(now)).localities);
    if (Object.keys(unknown).length > 0) return refused(draft.id, actor, 422, 'INVALID_INPUT', unknown);
    card = await withRegisterSources(parsed.data);
    // A section the server rewrote (an address no longer «from the register») is not attested in
    // this request: the depositor attests what he sees, and sees it again first.
    rewritten = sectionsRewritten(parsed.data, card);
    // Once paid, the claims the fee was computed on do not change (decision 57).
    if (locked && !sameClaims(card, current)) return refused(draft.id, actor, 409, 'CLAIMS_LOCKED');
    data.card = asJson(card);
    changed.push('CARD');
  }
  if (body.caseType !== undefined) {
    if (body.caseType !== null && !(await caseTypeRules(now)).types.some((t) => t.code === body.caseType)) return invalid('caseType');
    data.caseType = body.caseType;
    changed.push('CASE_TYPE');
  }
  if (body.defendantLocality !== undefined) {
    if (body.defendantLocality !== null && !(await districtRules(now)).localities.includes(body.defendantLocality)) return invalid('defendantLocality');
    data.defendantLocality = body.defendantLocality;
    changed.push('LOCALITY');
  }
  let courtId = draft.courtId;
  if (body.courtId !== undefined && body.courtId !== draft.courtId) {
    if (draft.channel === 'PAPER') return invalid('courtId'); // the court of a paper filing is the clerk's (memo row 24)
    if (locked) return refused(draft.id, actor, 409, 'CLAIMS_LOCKED');
    if (body.courtId !== null) {
      const court = await getDb().court.findUnique({ where: { id: body.courtId }, select: { degree: true } });
      if (court?.degree !== 'FIRST_INSTANCE') return invalid('courtId');
    }
    courtId = body.courtId;
    data.court = body.courtId === null ? { disconnect: true } : { connect: { id: body.courtId } };
    changed.push('COURT');
  }
  if (body.bailiffUserId !== undefined) {
    if (body.bailiffUserId !== null && !(await bailiffsOf(courtId)).some((b) => b.userId === body.bailiffUserId)) return invalid('bailiffUserId');
    data.designatedBailiffUserId = body.bailiffUserId;
    changed.push('BAILIFF');
  } else if (courtId !== draft.courtId && draft.designatedBailiffUserId && !(await bailiffsOf(courtId)).some((b) => b.userId === draft.designatedBailiffUserId)) {
    // The bailiff designated works in the district of the former court only (art. 87, review P2-S-08).
    data.designatedBailiffUserId = null;
    changed.push('BAILIFF');
  }
  if (body.paperDepositor !== undefined) {
    if (draft.channel !== 'PAPER') return invalid('paperDepositor');
    // The payment receipt names the depositor (art. 628): once paid, he no longer changes (fix review L4);
    // a draft paid with no depositor recorded may still have one entered, and be filed.
    if (locked && hasDepositor(draft.paperDepositor) && depositorDiffers(body.paperDepositor, draft.paperDepositor)) return refused(draft.id, actor, 409, 'DEPOSITOR_LOCKED');
    data.paperDepositor = body.paperDepositor === null ? { set: null } : asJson(body.paperDepositor);
    changed.push('DEPOSITOR');
  }
  if (body.paperLawyerUserId !== undefined) {
    if (draft.channel !== 'PAPER') return invalid('paperLawyerUserId');
    if (body.paperLawyerUserId !== null && !(await lawyersRoster()).some((l) => l.userId === body.paperLawyerUserId)) return invalid('paperLawyerUserId');
    data.paperLawyerUserId = body.paperLawyerUserId;
    changed.push('LAWYER');
  }
  if (body.attest !== undefined) changed.push('ATTESTATION');
  // The attestation of a section holds while its content does not change.
  data.attestations = attestationsFor(card, draft.attestations, (body.attest ?? []).filter((s) => !rewritten.includes(s)));
  if (changed.includes('CASE_TYPE') || changed.includes('LOCALITY') || changed.includes('CARD')) {
    const suggestion = await suggestionFor(
      { caseType: body.caseType !== undefined ? body.caseType : draft.caseType, defendantLocality: body.defendantLocality !== undefined ? body.defendantLocality : draft.defendantLocality },
      card,
      now,
    );
    data.suggestedCourtId = suggestion.courtId;
  }
  data.updatedAt = now;

  const applied = await eventTransaction(async (tx): Promise<boolean | 'LOCKED' | 'DEPOSITOR'> => {
    if (!(await lockOpenDraft(tx, draft.id))) return false;
    // What this update writes is compared with the draft as stored under its lock, not as read before.
    const stored = await tx.filingDraft.findUniqueOrThrow({ where: { id: draft.id }, select: { card: true, courtId: true, paperDepositor: true } });
    const storedCard = parseCard(stored.card);
    const claimsChange = body.card !== undefined && !sameClaims(card, storedCard);
    const courtChange = body.courtId !== undefined && courtId !== stored.courtId;
    const depositorChange = body.paperDepositor !== undefined && depositorDiffers(body.paperDepositor, stored.paperDepositor);
    // A payment recorded since the draft was read locks its claims, its court and its depositor
    // too (fix review M1).
    if (!locked && (await tx.paymentIntent.count({ where: { draftId: draft.id, status: 'SUCCEEDED' } })) > 0) {
      if (claimsChange || courtChange) return 'LOCKED';
      if (depositorChange && hasDepositor(stored.paperDepositor)) return 'DEPOSITOR';
    }
    await tx.filingDraft.update({ where: { id: draft.id }, data });
    const legalBasis = basisOf('filing.draft.edit', now);
    await appendEvent(tx, { action: 'filing.draft.updated', details: { draftId: draft.id, fields: changed.length ? changed.join(':') : 'ATTESTATION' }, actor, legalBasis });
    // A payment opened on other claims, another court or, at the counter, another depositor
    // covers nothing: it lapses now, before the page offers to complete it (audit G025;
    // the receipt of a counter payment names its depositor, fix review L4).
    if (claimsChange || courtChange || depositorChange) {
      const pending = await tx.paymentIntent.findMany({ where: { draftId: draft.id, status: 'PENDING' }, select: { id: true } });
      for (const intent of pending) {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED', completedAt: now } });
        await appendEvent(tx, { action: 'payment.expired', details: { intentId: intent.id }, actor, legalBasis });
      }
    }
    return true;
  });
  if (applied === 'LOCKED') return refused(draft.id, actor, 409, 'CLAIMS_LOCKED');
  if (applied === 'DEPOSITOR') return refused(draft.id, actor, 409, 'DEPOSITOR_LOCKED');
  if (!applied) return refused(draft.id, actor, 409, 'ALREADY_FILED');
  return done(undefined);
}

// ---------------------------------------------------------------------------

/** The application pasted in the editor: kept as deposited, split into numbered paragraphs, its fixed copy printed by the worker. */
export async function pasteApplication(draft: DraftWithParts, text: string, actor: EventActor): Promise<Outcome> {
  if (draft.channel !== 'ELECTRONIC') return refused(draft.id, actor, 422, 'INVALID_INPUT', { text: 'errors.field.invalid' });
  const { maxChars, maxParagraphs } = SECURITY_POLICY.applicationText;
  const paragraphs = pastedParagraphs(text);
  if (paragraphs.length === 0) return refused(draft.id, actor, 422, 'INVALID_INPUT', { text: 'errors.field.tooShort' });
  if (text.length > maxChars || paragraphs.length > maxParagraphs) return refused(draft.id, actor, 422, 'INVALID_INPUT', { text: 'errors.field.tooLong' });
  const textDigest = paragraphsDigest(paragraphs);
  const now = clock.now();
  const applied = await eventTransaction(async (tx) => {
    if (!(await lockOpenDraft(tx, draft.id))) return false;
    await tx.filingDocument.updateMany({ where: { draftId: draft.id, kind: { in: ['APPLICATION_ORIGINAL', 'APPLICATION_COPY'] }, removedAt: null }, data: { removedAt: now } });
    await tx.filingDraft.update({
      where: { id: draft.id },
      data: { applicationMode: 'PASTE', applicationText: text, applicationParagraphs: asJson(paragraphs), fixedCopyStatus: 'PENDING', updatedAt: now },
    });
    await enqueue(tx, 'filing.fixed-copy', { draftId: draft.id, textDigest, legalBasis: basisOf('filing.draft.edit', now) });
    await appendEvent(tx, {
      action: 'filing.application.pasted',
      details: { draftId: draft.id, paragraphs: paragraphs.length, characters: text.length },
      actor,
      legalBasis: basisOf('filing.draft.edit', now),
    });
    return true;
  });
  if (!applied) return refused(draft.id, actor, 409, 'ALREADY_FILED');
  return done(undefined);
}

// ---------------------------------------------------------------------------

export const UploadParams = z
  .object({
    draftId: uuid,
    kind: z.enum(['APPLICATION', 'EXHIBIT']),
    name: z.string().min(1).max(255),
    title: z.string().transform(stripInvisible).pipe(z.string().trim().max(SECURITY_POLICY.uploads.titleMaxChars)).optional(),
    nature: z.enum(['ORIGINAL', 'CERTIFIED_COPY', 'PHOTOCOPY']).optional(),
    pages: z.coerce.number().int().min(1).max(10_000).optional(),
    location: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type UploadMeta = z.infer<typeof UploadParams>;

/** The types and the size accepted at the place of an upload (decision 62). */
export function uploadPolicy(channel: 'ELECTRONIC' | 'PAPER', kind: UploadMeta['kind']): { accept: readonly UploadType[]; maxBytes: number } {
  const limits = SECURITY_POLICY.uploads;
  if (channel === 'PAPER') return { accept: ['pdf', 'jpeg', 'png'], maxBytes: limits.scanMaxBytes };
  if (kind === 'APPLICATION') return { accept: ['pdf', 'docx'], maxBytes: limits.applicationMaxBytes };
  return { accept: ['pdf', 'jpeg', 'png'], maxBytes: limits.exhibitMaxBytes };
}

const REFUSAL_CODES = { TYPE_MISMATCH: 'FILE_TYPE_MISMATCH', TYPE_NOT_ACCEPTED: 'FILE_TYPE_NOT_ACCEPTED', UNSAFE: 'FILE_UNSAFE' } as const;
const REFUSAL_STATUS = { TYPE_MISMATCH: 415, TYPE_NOT_ACCEPTED: 415, UNSAFE: 422 } as const;

export async function uploadDocument(
  draft: DraftWithParts,
  meta: UploadMeta,
  bytes: Uint8Array,
  actor: EventActor,
): Promise<Outcome<{ documentId: string; mediaType: string; sha256: string }>> {
  const policy = uploadPolicy(draft.channel, meta.kind);
  if (bytes.byteLength > policy.maxBytes) return refused(draft.id, actor, 413, 'PAYLOAD_TOO_LARGE');
  if (bytes.byteLength === 0) return refused(draft.id, actor, 415, 'FILE_TYPE_MISMATCH');
  const inspected = inspectUpload(bytes, { declaredName: meta.name, accept: policy.accept });
  if (!inspected.ok) return refused(draft.id, actor, REFUSAL_STATUS[inspected.reason], REFUSAL_CODES[inspected.reason]);
  if (documentLimitReached(draft, bytes.byteLength)) return refused(draft.id, actor, 409, 'DRAFT_DOCUMENT_LIMIT');
  // What the draft ever stored counts, removed documents included: an upload-and-remove loop stops (review P2-S-07).
  const stored = await getDb().filingDocument.aggregate({ where: { draftId: draft.id, generated: false }, _sum: { byteSize: true } });
  if ((stored._sum.byteSize ?? 0) + bytes.byteLength > SECURITY_POLICY.uploads.draftMaxStoredBytes) return refused(draft.id, actor, 409, 'DRAFT_DOCUMENT_LIMIT');

  const application = meta.kind === 'APPLICATION';
  let paragraphs: string[] | null = null;
  if (application && inspected.type === 'docx') {
    try {
      paragraphs = docxParagraphs(bytes);
    } catch (error) {
      if (isArchiveRefusal(error)) return refused(draft.id, actor, 422, 'FILE_UNSAFE');
      throw error;
    }
    if (paragraphs.length === 0) return refused(draft.id, actor, 422, 'INVALID_INPUT', { file: 'errors.field.tooShort' });
  }

  const id = randomUUID();
  const key = draftStorageKey(draft.id);
  const digest = sha256Hex(bytes);
  // The bytes first: a row never points at a missing object (src/server/documents/service.ts).
  await documentStore().put(key, bytes, inspected.mediaType);
  const kind = application ? (inspected.type === 'docx' ? 'APPLICATION_ORIGINAL' : 'APPLICATION_COPY') : 'EXHIBIT';
  const now = clock.now();
  const applied = await eventTransaction(async (tx) => {
    if (!(await lockOpenDraft(tx, draft.id))) return false;
    if (application) {
      await tx.filingDocument.updateMany({ where: { draftId: draft.id, kind: { in: ['APPLICATION_ORIGINAL', 'APPLICATION_COPY'] }, removedAt: null }, data: { removedAt: now } });
    }
    const position = await tx.filingDocument.count({ where: { draftId: draft.id } });
    await tx.filingDocument.create({
      data: {
        id,
        draftId: draft.id,
        kind,
        storageKey: key,
        sha256: digest,
        byteSize: bytes.byteLength,
        mediaType: inspected.mediaType,
        title: meta.title?.trim() || uploadTitle(meta.name),
        declaredNature: application && draft.channel === 'ELECTRONIC' ? 'ORIGINAL' : (meta.nature ?? null),
        pageCount: meta.pages ?? null,
        paperOriginalLocation: meta.location ?? null,
        position,
        uploadedAt: now,
      },
    });
    if (application) {
      await tx.filingDraft.update({
        where: { id: draft.id },
        data: {
          applicationMode: draft.channel === 'PAPER' ? 'SCAN' : 'UPLOAD',
          applicationText: null,
          applicationParagraphs: paragraphs ? asJson(paragraphs) : { set: null },
          // A PDF or a scan is fixed as deposited; a Word document is printed by the worker.
          fixedCopyStatus: paragraphs ? 'PENDING' : 'READY',
          updatedAt: now,
        },
      });
      if (paragraphs) await enqueue(tx, 'filing.fixed-copy', { draftId: draft.id, textDigest: paragraphsDigest(paragraphs), legalBasis: basisOf('filing.draft.edit', now) });
    } else {
      await tx.filingDraft.update({ where: { id: draft.id }, data: { updatedAt: now } });
    }
    await appendEvent(tx, {
      action: 'filing.document.uploaded',
      details: { draftId: draft.id, documentId: id, kind, mediaType: inspected.mediaType, sha256: digest, byteSize: bytes.byteLength },
      actor,
      legalBasis: basisOf('filing.draft.edit', now),
    });
    return true;
  });
  if (!applied) return refused(draft.id, actor, 409, 'ALREADY_FILED');
  return done({ documentId: id, mediaType: inspected.mediaType, sha256: digest });
}

// ---------------------------------------------------------------------------

export const UpdateDocumentBody = z
  .object({
    title: z.string().transform(stripInvisible).pipe(z.string().trim().min(1).max(SECURITY_POLICY.uploads.titleMaxChars)).optional(),
    nature: z.enum(['ORIGINAL', 'CERTIFIED_COPY', 'PHOTOCOPY']).nullable().optional(),
    pageCount: z.number().int().min(1).max(10_000).nullable().optional(),
    location: z.string().trim().min(1).max(200).nullable().optional(),
    remove: z.literal(true).optional(),
  })
  .strict();
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentBody>;

export async function updateDocument(draft: DraftWithParts, documentId: string, body: UpdateDocumentInput, actor: EventActor): Promise<Outcome> {
  const doc = draft.documents.find((d) => d.id === documentId);
  // A document of another draft is unknown here, and the request is a refusal like any other (independent review IR-17).
  if (!doc) return refused(draft.id, actor, 404, 'NOT_FOUND');
  if (doc.generated) return refused(draft.id, actor, 422, 'INVALID_INPUT', { document: 'errors.field.invalid' });
  const now = clock.now();
  const applied = await eventTransaction(async (tx) => {
    if (!(await lockOpenDraft(tx, draft.id))) return false;
    if (body.remove) {
      await tx.filingDocument.update({ where: { id: documentId }, data: { removedAt: now } });
      if (doc.kind === 'APPLICATION_ORIGINAL' || doc.kind === 'APPLICATION_COPY') {
        await tx.filingDocument.updateMany({ where: { draftId: draft.id, kind: 'APPLICATION_COPY', removedAt: null }, data: { removedAt: now } });
        await tx.filingDraft.update({ where: { id: draft.id }, data: { applicationMode: draft.channel === 'PAPER' ? 'SCAN' : null, applicationParagraphs: { set: null }, fixedCopyStatus: 'NONE', updatedAt: now } });
      }
    } else {
      await tx.filingDocument.update({
        where: { id: documentId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.nature !== undefined ? { declaredNature: body.nature } : {}),
          ...(body.pageCount !== undefined ? { pageCount: body.pageCount } : {}),
          ...(body.location !== undefined ? { paperOriginalLocation: body.location } : {}),
        },
      });
    }
    await appendEvent(tx, { action: 'filing.document.updated', details: { draftId: draft.id, documentId, removed: body.remove === true }, actor, legalBasis: basisOf('filing.draft.edit', now) });
    return true;
  });
  if (!applied) return refused(draft.id, actor, 409, 'ALREADY_FILED');
  return done(undefined);
}

/** A document of the draft for its author, as long as its bytes still have their hash. */
export async function draftDocumentFile(
  draft: DraftWithParts,
  documentId: string,
  actor: EventActor,
): Promise<{ bytes: Uint8Array; mediaType: string; title: string | null } | 'NOT_FOUND' | 'INTEGRITY'> {
  const doc = draft.documents.find((d) => d.id === documentId) ?? (await getDb().filingDocument.findFirst({ where: { id: documentId, draftId: draft.id } }));
  if (!doc) {
    // A document of another draft is unknown here, and the request is a refusal like any other (independent review IR-17).
    await refused(draft.id, actor, 404, 'NOT_FOUND');
    return 'NOT_FOUND';
  }
  const bytes = await documentStore().get(doc.storageKey);
  if (!bytes) return 'NOT_FOUND';
  // Each download is recorded, as on the file (decision 47, audit G100); and a changed copy too.
  const legalBasis = basisOf('filing.draft.read', clock.now());
  if (sha256Hex(bytes) !== doc.sha256) {
    await appendStandaloneEvent({ action: 'document.integrity.failed', details: { documentId: doc.id, currentSha256: sha256Hex(bytes) }, actor, legalBasis });
    return 'INTEGRITY';
  }
  await appendStandaloneEvent({ action: 'document.downloaded', details: { documentId: doc.id }, actor, legalBasis });
  return { bytes, mediaType: doc.mediaType, title: doc.title };
}
