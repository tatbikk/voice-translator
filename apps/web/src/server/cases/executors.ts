import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACTIONS, authorize, SECURITY_POLICY, type CaseSnapshot, type NotifyTarget, type UserSubject } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getEnv } from '../config/env';
import { sha256Hex } from '../documents/service';
import { documentStore } from '../documents/store';
import { appendEvent, appendStandaloneEvent, eventTransaction, type EventActor } from '../events/append';
import type { ErrorCode } from '../http/responses';
import { createNotification } from '../notifications/service';
import { caseTypeRules } from '../rules/store';
import { inspectUpload, uploadTitle } from '../uploads/inspect';
import { caseSnapshot } from './snapshot';

// The executors of the procedural acts, from Phase 2 on (decision 46). The
// route authorizes the act on a snapshot read before the transaction; the
// executor locks the file, rebuilds the snapshot inside the transaction and
// asks the core again, so two requests racing on the same file cannot both act
// (Phase 1 memo, row 17). What an act sets, notifies and files is declared in
// the core's table (P1-A-05); the executor only carries it out.

type Tx = Prisma.TransactionClient;

export type ExecutionResult =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly code: ErrorCode; readonly fields?: Record<string, string> };

interface Prepared<T> {
  readonly ok: true;
  readonly value: T;
}
interface Invalid {
  readonly ok: false;
  readonly status: number;
  readonly code: ErrorCode;
  readonly reason: string;
}

interface RunContext<T> {
  readonly tx: Tx;
  readonly caseFileId: string;
  readonly snapshot: CaseSnapshot;
  readonly subject: UserSubject;
  readonly actor: EventActor;
  readonly now: Date;
  readonly value: T;
}

export interface ExecutorInput {
  readonly body: unknown;
  readonly bytes: Uint8Array | null;
  readonly query: Readonly<Record<string, string>>;
}

interface Executor<T> {
  /** how the act receives its input: a JSON body, or the bytes of a document */
  readonly input: 'json' | 'upload';
  /** validation outside the transaction; an upload's bytes are stored here, under a generated key */
  prepare(input: ExecutorInput, caseFileId: string, now: Date): Promise<Prepared<T> | Invalid>;
  run(context: RunContext<T>): Promise<Record<string, unknown>>;
}

const invalid = (reason: string, status = 422, code: ErrorCode = 'INVALID_INPUT'): Invalid => ({ ok: false, status, code, reason });

// ---------------------------------------------------------------------------
// Who an act informs (NotifyTarget of the core's table).

async function courtPresidentOf(tx: Tx, courtId: string): Promise<string | null> {
  const holder = await tx.roleAssignment.findFirst({
    where: { role: 'COURT_PRESIDENT', courtId, revokedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  return holder?.userId ?? null;
}

async function recipientsOf(tx: Tx, snapshot: CaseSnapshot, targets: readonly NotifyTarget[]): Promise<Map<NotifyTarget, string[]>> {
  const out = new Map<NotifyTarget, string[]>();
  for (const target of targets) {
    if (target === 'RAPPORTEUR') out.set(target, snapshot.rapporteurUserId ? [snapshot.rapporteurUserId] : []);
    else if (target === 'RAPPORTEUR_OR_PRESIDENT') {
      const president = snapshot.rapporteurUserId ? null : await courtPresidentOf(tx, snapshot.courtId);
      const userId = snapshot.rapporteurUserId ?? president;
      out.set(target, userId ? [userId] : []);
    } else out.set(target, [...new Set(snapshot.parties.flatMap((p) => p.counselUserIds))]);
  }
  return out;
}

async function inform(
  tx: Tx,
  context: RunContext<unknown>,
  code: string,
  templateKey: string,
  params: Record<string, string | number> = {},
): Promise<void> {
  const targets = ACTIONS[code]?.procedure?.notifies ?? [];
  const recipients = await recipientsOf(tx, context.snapshot, targets);
  const users = new Set([...recipients.values()].flat());
  users.delete(context.subject.userId);
  if (users.size === 0) return;
  const file = await tx.caseFile.findUniqueOrThrow({ where: { id: context.caseFileId }, select: { number: true, code: true, year: true } });
  for (const userId of users) {
    await createNotification(tx, {
      userId,
      kind: 'INFORMATION',
      templateKey,
      params: { number: `${String(file.number)}/${String(file.code)}/${String(file.year)}`, ...params },
      targetPath: `/cases/${context.caseFileId}`,
      caseFileId: context.caseFileId,
    });
  }
}

// ---------------------------------------------------------------------------
// Station 2: the registry office (three buttons, none to reject).

const stamp: Executor<null> = {
  input: 'json',
  async prepare(input) {
    return z.strictObject({}).safeParse(input.body ?? {}).success ? { ok: true, value: null } : invalid('BODY');
  },
  async run({ tx, caseFileId, actor, now }) {
    await tx.caseFile.update({ where: { id: caseFileId }, data: { registrationStampedAt: now } });
    await appendEvent(tx, { action: 'case.registration.stamped', details: { caseFileId }, caseFileId, actor });
    return { stampedAt: now.toISOString() };
  },
};

const ReclassifyBody = z.strictObject({ caseType: z.string().regex(/^\d{4}$/) });

const reclassify: Executor<{ caseType: string }> = {
  input: 'json',
  async prepare(input, _caseFileId, now) {
    const parsed = ReclassifyBody.safeParse(input.body);
    if (!parsed.success) return invalid('BODY');
    const rules = await caseTypeRules(now);
    if (!rules.types.some((t) => t.code === parsed.data.caseType)) return invalid('UNKNOWN_CASE_TYPE');
    return { ok: true, value: parsed.data };
  },
  async run(context) {
    const { tx, caseFileId, actor, now, value } = context;
    const file = await tx.caseFile.findUniqueOrThrow({ where: { id: caseFileId }, select: { code: true, caseType: true } });
    const toCode = Number(value.caseType);
    if (file.caseType === value.caseType && file.code === toCode) throw new InputRefused('SAME_CASE_TYPE');
    // The number and the national identifier stay; only the code changes (decision 53).
    await tx.caseFile.update({ where: { id: caseFileId }, data: { caseType: value.caseType, code: toCode, classificationCorrectedAt: now } });
    await appendEvent(tx, { action: 'case.registration.reclassified', details: { caseFileId, fromCode: file.code, toCode }, caseFileId, actor });
    await inform(tx, context, 'case.registration.reclassify', 'notifications.case.reclassified', { code: toCode });
    return { code: toCode };
  },
};

export const NOTE_REASONS = ['FEE_SHORTFALL', 'CLASSIFICATION', 'PARTIES', 'OTHER'] as const;
const NoteBody = z.strictObject({ reason: z.enum(NOTE_REASONS), text: z.string().trim().min(1).max(2000) });

const noteToJudge: Executor<z.infer<typeof NoteBody>> = {
  input: 'json',
  async prepare(input) {
    const parsed = NoteBody.safeParse(input.body);
    return parsed.success ? { ok: true, value: parsed.data } : invalid('BODY');
  },
  async run(context) {
    const { tx, caseFileId, subject, actor, now, value, snapshot } = context;
    // The rapporteur once assigned; the court president before (art. 619).
    const addressee = snapshot.rapporteurUserId ?? (await courtPresidentOf(tx, snapshot.courtId));
    const noteId = randomUUID();
    await tx.caseNote.create({
      data: { id: noteId, caseFileId, authorUserId: subject.userId, authorRole: subject.role, reason: value.reason, text: value.text, addressedToUserId: addressee, createdAt: now },
    });
    // The event records that a note exists and why, never its text (memo row 25).
    await appendEvent(tx, { action: 'case.note.added', details: { caseFileId, noteId, reason: value.reason }, caseFileId, actor });
    await inform(tx, context, 'case.registration.note-to-judge', 'notifications.case.note-to-judge');
    return { noteId };
  },
};

// ---------------------------------------------------------------------------
// Written conclusions of the prosecution, opinion of the commissioner: a PDF.

interface StoredUpload {
  readonly documentId: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly title: string | null;
}

const UploadQuery = z.strictObject({ name: z.string().min(1).max(255), title: z.string().trim().max(SECURITY_POLICY.uploads.titleMaxChars).optional() });

function filedDocument(code: string): Executor<StoredUpload> {
  return {
    input: 'upload',
    async prepare(input, caseFileId) {
      const query = UploadQuery.safeParse(input.query);
      if (!query.success) return invalid('QUERY');
      const bytes = input.bytes ?? new Uint8Array();
      if (bytes.byteLength === 0) return invalid('EMPTY', 415, 'FILE_TYPE_MISMATCH');
      const inspected = inspectUpload(bytes, { declaredName: query.data.name, accept: ['pdf'] });
      if (!inspected.ok) {
        const status = inspected.reason === 'UNSAFE' ? 422 : 415;
        const errorCode = inspected.reason === 'UNSAFE' ? 'FILE_UNSAFE' : inspected.reason === 'TYPE_MISMATCH' ? 'FILE_TYPE_MISMATCH' : 'FILE_TYPE_NOT_ACCEPTED';
        return invalid(inspected.reason, status, errorCode);
      }
      const documentId = randomUUID();
      const storageKey = `cases/${caseFileId}/${documentId}`;
      // The bytes first: a row never points at a missing object (documents/service.ts).
      await documentStore().put(storageKey, bytes, 'application/pdf');
      const title = query.data.title && query.data.title !== '' ? query.data.title : uploadTitle(query.data.name);
      return { ok: true, value: { documentId, storageKey, sha256: sha256Hex(bytes), byteSize: bytes.byteLength, title } };
    },
    async run(context) {
      const { tx, caseFileId, subject, actor, now, value } = context;
      const docType = ACTIONS[code]?.procedure?.files;
      if (!docType) throw new Error(`executor: ${code} files no document`);
      await tx.document.create({
        data: {
          id: value.documentId,
          caseFileId,
          storageKey: value.storageKey,
          sha256: value.sha256,
          byteSize: value.byteSize,
          mediaType: 'application/pdf',
          docType,
          title: value.title,
          declaredNature: 'ORIGINAL',
          channel: 'ELECTRONIC',
          depositedByUserId: subject.userId,
          depositedByPartyId: null,
          depositedAt: now,
          generated: false,
          visibility: 'CASE',
        },
      });
      await appendEvent(tx, {
        action: 'document.stored',
        details: { documentId: value.documentId, sha256: value.sha256, byteSize: value.byteSize, generated: false, docType },
        caseFileId,
        actor,
      });
      await appendEvent(tx, { action: 'case.document.filed', details: { caseFileId, documentId: value.documentId, action: code }, caseFileId, actor });
      await inform(tx, context, code, 'notifications.case.document-filed', { docType });
      return { documentId: value.documentId };
    },
  };
}

// ---------------------------------------------------------------------------

const EXECUTORS: Readonly<Record<string, Executor<never>>> = {
  'case.registration.stamp': stamp as Executor<never>,
  'case.registration.reclassify': reclassify as Executor<never>,
  'case.registration.note-to-judge': noteToJudge as Executor<never>,
  'case.prosecution.conclusions': filedDocument('case.prosecution.conclusions') as Executor<never>,
  'case.commissioner.opinion': filedDocument('case.commissioner.opinion') as Executor<never>,
};

/** The acts executed from the generic routes, by how they receive their input. */
export function executorKind(code: string): 'json' | 'upload' | null {
  return EXECUTORS[code]?.input ?? null;
}

/** A refusal raised by an executor once inside its transaction: nothing it wrote stays. */
class InputRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export async function executeCaseAction(
  code: string,
  caseFileId: string,
  subject: UserSubject,
  actor: EventActor,
  input: ExecutorInput,
): Promise<ExecutionResult> {
  const executor = EXECUTORS[code] as Executor<unknown> | undefined;
  if (!executor) return { ok: false, status: 409, code: 'ACTION_NOT_EXECUTABLE_HERE' };
  const refuse = async (reason: string, status: number, errorCode: ErrorCode): Promise<ExecutionResult> => {
    await appendStandaloneEvent({ action: 'case.action.refused', details: { caseFileId, action: code, reason }, caseFileId, actor });
    return { ok: false, status, code: errorCode };
  };

  const prepared = await executor.prepare(input, caseFileId, clock.now());
  if (!prepared.ok) return refuse(prepared.reason, prepared.status, prepared.code);

  const env = getEnv();
  const outcome = await eventTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CaseFile" WHERE id = ${caseFileId}::uuid FOR UPDATE`;
    const now = clock.now();
    const snapshot = await caseSnapshot(caseFileId, now, { db: tx });
    if (!snapshot) return { refused: 'NOT_FOUND' as const };
    const decision = authorize(subject, code, { kind: 'case', snapshot }, { mode: env.mode, demoToolsEnabled: env.demoToolsEnabled, now });
    if (!decision.allowed) return { refused: 'ACTION_NO_LONGER_AVAILABLE' as const };
    return { data: await executor.run({ tx, caseFileId, snapshot, subject, actor, now, value: prepared.value }) };
  }).catch((error: unknown) => {
    // A refusal raised inside the transaction rolls back whatever the act had written.
    if (error instanceof InputRefused) return { invalid: error.reason };
    throw error;
  });
  if ('refused' in outcome) {
    return outcome.refused === 'NOT_FOUND' ? { ok: false, status: 404, code: 'NOT_FOUND' } : refuse('STATE_CHANGED', 409, 'ACTION_NO_LONGER_AVAILABLE');
  }
  if ('invalid' in outcome) return refuse(outcome.invalid, 422, 'INVALID_INPUT');
  return { ok: true, data: outcome.data };
}
