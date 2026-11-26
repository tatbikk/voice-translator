import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACTIONS, authorize, CAPACITY_STATUSES, PUBLIC_ENTITY_KINDS, referralsFor, SECURITY_POLICY, sortReferrals, stripInvisible, type CaseSnapshot, type CaseTypeRule, type NotifyTarget, type Referral, type ReferralRuleSet, type UserSubject } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getEnv } from '../config/env';
import { getDb } from '../db';
import { sha256Hex } from '../documents/service';
import { documentStore } from '../documents/store';
import { appendEvent, appendStandaloneEvent, eventTransaction, type EventActor } from '../events/append';
import { basisOf } from '../events/basis';
import type { ErrorCode } from '../http/responses';
import { createNotification } from '../notifications/service';
import { caseTypeRules, referralRules, ruleSetId } from '../rules/store';
import { inspectUpload, uploadTitle } from '../uploads/inspect';
import { groundsText, referralArticles } from '../filings/registration';
import { actExecutors, DeclaredEffectError, type ActContext, type ActExecutor, type ExecutorInput, type Invalid } from './effects';
import { caseSnapshot } from './snapshot';

/** A stored code, when the core knows it. */
const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | undefined =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

// The executors of the procedural acts, from Phase 2 on (decision 46). The
// route authorizes the act on a snapshot read before the transaction; the
// executor locks the file, rebuilds the snapshot inside the transaction and
// asks the core again, so two requests racing on the same file cannot both act
// (Phase 1 memo, row 17). What an act notifies and files is declared in the
// core's table (P1-A-05) and carried out here; its next status, the facts it
// sets and the limits it closes and opens are applied after it by the applier
// (effects.ts, independent review IR-10, decision 73), through which every
// executor is registered. Every event an act writes carries its legal basis
// from the core's table (IR-12, decision 74).

type Tx = Prisma.TransactionClient;

export type ExecutionResult =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly code: ErrorCode; readonly fields?: Record<string, string> };

/** The legal basis of the act an executor carries out, on the day of the act. */
const basisOfAct = (code: string, context: ActContext<unknown>) => basisOf(code, context.now, { kind: 'case', snapshot: context.snapshot });

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
  context: ActContext<unknown>,
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

const stamp: ActExecutor<null> = {
  input: 'json',
  prepare(input) {
    return Promise.resolve(z.strictObject({}).safeParse(input.body ?? {}).success ? { ok: true, value: null } : invalid('BODY'));
  },
  // The stamp's fact (REGISTRATION_STAMPED, its moment) is the applier's: the table declares it.
  async run(context) {
    const { tx, caseFileId, actor, now } = context;
    await appendEvent(tx, { action: 'case.registration.stamped', details: { caseFileId }, caseFileId, actor, legalBasis: basisOfAct('case.registration.stamp', context) });
    return { data: { stampedAt: now.toISOString() } };
  },
};

const ReclassifyBody = z.strictObject({ caseType: z.string().regex(/^\d{4}$/) });

const reclassify: ActExecutor<{ caseType: string; rule: CaseTypeRule; rules: ReferralRuleSet; referralRuleSetId: string }> = {
  input: 'json',
  async prepare(input, _caseFileId, now) {
    const parsed = ReclassifyBody.safeParse(input.body);
    if (!parsed.success) return invalid('BODY');
    const [types, rules] = await Promise.all([caseTypeRules(now), referralRules(now)]);
    const rule = types.types.find((t) => t.code === parsed.data.caseType);
    if (!rule) return invalid('UNKNOWN_CASE_TYPE');
    return { ok: true, value: { caseType: parsed.data.caseType, rule, rules, referralRuleSetId: await ruleSetId('REFERRALS', rules.version) } };
  },
  async run(context) {
    const { tx, caseFileId, actor, now, value } = context;
    const file = await tx.caseFile.findUniqueOrThrow({
      where: { id: caseFileId },
      select: {
        code: true,
        caseType: true,
        courtId: true,
        referredToProsecutionAt: true,
        referredToCommissionerAt: true,
        court: { select: { specialty: true } },
        parties: { select: { personKind: true, publicEntityKind: true, capacityStatus: true } },
        referrals: { select: { target: true, ground: true, article: true, item: true, reasonCode: true } },
      },
    });
    const toCode = Number(value.caseType);
    if (file.caseType === value.caseType && file.code === toCode) throw new InputRefused('SAME_CASE_TYPE');
    // A case type belongs to a specialty: it must be the court's own (review P2-S-05).
    if (value.rule.specialty !== file.court.specialty) throw new InputRefused('CASE_TYPE_OF_ANOTHER_SPECIALTY');
    // The number and the national identifier stay; only the code changes (decision 53).
    await tx.caseFile.update({ where: { id: caseFileId }, data: { caseType: value.caseType, code: toCode, classificationCorrectedAt: now } });
    await appendEvent(tx, {
      action: 'case.registration.reclassified',
      details: { caseFileId, fromCode: file.code, toCode },
      caseFileId,
      actor,
      legalBasis: basisOfAct('case.registration.reclassify', context),
    });

    // The referrals the new type makes due are added (review P2-S-05); one already made stays.
    const parties = file.parties.map((p) => ({
      personKind: p.personKind,
      publicEntityKind: oneOf(p.publicEntityKind, PUBLIC_ENTITY_KINDS),
      capacityStatus: oneOf(p.capacityStatus, CAPACITY_STATUSES),
    }));
    const due = referralsFor({ courtSpecialty: file.court.specialty, caseType: value.rule, parties, rules: value.rules });
    const added = due.filter((r) => !file.referrals.some((e) => e.target === r.target && e.ground === r.ground));
    for (const referral of added) {
      await tx.caseReferral.create({
        data: { caseFileId, target: referral.target, ground: referral.ground, article: referral.article, item: referral.item, reasonCode: referral.reasonCode, ruleSetId: value.referralRuleSetId, createdAt: now },
      });
    }
    const toProsecution = added.some((r) => r.target === 'PROSECUTION') && file.referredToProsecutionAt === null;
    const toCommissioner = added.some((r) => r.target === 'ROYAL_COMMISSIONER') && file.referredToCommissionerAt === null;
    if (toProsecution || toCommissioner) {
      await tx.caseFile.update({
        where: { id: caseFileId },
        data: { ...(toProsecution ? { referredToProsecutionAt: now } : {}), ...(toCommissioner ? { referredToCommissionerAt: now } : {}) },
      });
    }
    // The review records every referral the file now has, those made before included: «none due»
    // is written only when there is none (fix review M4).
    const standing: Referral[] = sortReferrals([
      ...file.referrals.map((r) => ({ target: r.target, ground: r.ground, article: r.article, item: r.item, reasonCode: r.reasonCode }) as Referral),
      ...added,
    ]);
    await appendEvent(tx, {
      action: 'case.referrals.reviewed',
      details: { caseFileId, ruleVersion: value.rules.version, referrals: standing.length, grounds: groundsText(standing) },
      caseFileId,
      legalBasis: referralArticles(value.rules),
    });
    await inform(tx, context, 'case.registration.reclassify', 'notifications.case.reclassified', { code: toCode });
    const roles = [...(toProsecution ? (['PUBLIC_PROSECUTOR'] as const) : []), ...(toCommissioner ? (['ROYAL_COMMISSIONER'] as const) : [])];
    if (roles.length > 0) {
      const holders = await tx.roleAssignment.findMany({ where: { role: { in: [...roles] }, courtId: file.courtId, revokedAt: null }, select: { userId: true } });
      const number = await tx.caseFile.findUniqueOrThrow({ where: { id: caseFileId }, select: { number: true, code: true, year: true } });
      for (const userId of new Set(holders.map((h) => h.userId))) {
        await createNotification(tx, {
          userId,
          kind: 'INFORMATION',
          templateKey: 'notifications.case.referred-reclassified',
          params: { number: `${String(number.number)}/${String(number.code)}/${String(number.year)}` },
          targetPath: `/cases/${caseFileId}`,
          caseFileId,
        });
      }
    }
    return { data: { code: toCode, referrals: added.length } };
  },
};

export const NOTE_REASONS = ['FEE_SHORTFALL', 'CLASSIFICATION', 'PARTIES', 'OTHER'] as const;
const NoteBody = z.strictObject({ reason: z.enum(NOTE_REASONS), text: z.string().trim().min(1).max(2000) });

const noteToJudge: ActExecutor<z.infer<typeof NoteBody>> = {
  input: 'json',
  prepare(input) {
    const parsed = NoteBody.safeParse(input.body);
    return Promise.resolve(parsed.success ? { ok: true, value: parsed.data } : invalid('BODY'));
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
    await appendEvent(tx, {
      action: 'case.note.added',
      details: { caseFileId, noteId, reason: value.reason },
      caseFileId,
      actor,
      legalBasis: basisOfAct('case.registration.note-to-judge', context),
    });
    await inform(tx, context, 'case.registration.note-to-judge', 'notifications.case.note-to-judge');
    return { data: { noteId } };
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

const UploadQuery = z.strictObject({
  name: z.string().min(1).max(255),
  // A title keeps no invisible or direction mark (review P2-S-11).
  title: z.string().transform(stripInvisible).pipe(z.string().trim().max(SECURITY_POLICY.uploads.titleMaxChars)).optional(),
});

function filedDocument(code: string): ActExecutor<StoredUpload> {
  return {
    input: 'upload',
    async prepare(input, caseFileId) {
      const query = UploadQuery.safeParse(input.query);
      if (!query.success) return invalid('QUERY');
      // A cap on what one act files on one file, before any byte is stored (review P2-A-10).
      const docType = ACTIONS[code]?.procedure?.files;
      const filed = docType ? await getDb().document.count({ where: { caseFileId, docType, generated: false } }) : 0;
      if (filed >= SECURITY_POLICY.uploads.caseMaxFiledPerAct) return invalid('CASE_DOCUMENT_LIMIT', 409, 'CASE_DOCUMENT_LIMIT');
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
      const legalBasis = basisOfAct(code, context);
      await appendEvent(tx, {
        action: 'document.stored',
        details: { documentId: value.documentId, sha256: value.sha256, byteSize: value.byteSize, generated: false, docType },
        caseFileId,
        actor,
        legalBasis,
      });
      await appendEvent(tx, { action: 'case.document.filed', details: { caseFileId, documentId: value.documentId, action: code }, caseFileId, actor, legalBasis });
      await inform(tx, context, code, 'notifications.case.document-filed', { docTypeKey: `case.docType.${docType}` });
      return { data: { documentId: value.documentId } };
    },
  };
}

// ---------------------------------------------------------------------------

// Registered through the applier, which applies each act's declaration after it.
const EXECUTORS = actExecutors({
  'case.registration.stamp': stamp as ActExecutor<never>,
  'case.registration.reclassify': reclassify as ActExecutor<never>,
  'case.registration.note-to-judge': noteToJudge as ActExecutor<never>,
  'case.prosecution.conclusions': filedDocument('case.prosecution.conclusions') as ActExecutor<never>,
  'case.commissioner.opinion': filedDocument('case.commissioner.opinion') as ActExecutor<never>,
});

/** The acts executed from the generic routes, by how they receive their input. */
export function executorKind(code: string): 'json' | 'upload' | null {
  return EXECUTORS.kind(code);
}

/** The acts that have an executor. */
export function executableActs(): readonly string[] {
  return EXECUTORS.codes();
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
  if (EXECUTORS.kind(code) === null) return { ok: false, status: 409, code: 'ACTION_NOT_EXECUTABLE_HERE' };
  const refuse = async (reason: string, status: number, errorCode: ErrorCode): Promise<ExecutionResult> => {
    await appendStandaloneEvent({ action: 'case.action.refused', details: { caseFileId, action: code, reason }, caseFileId, actor });
    return { ok: false, status, code: errorCode };
  };

  const prepared = await EXECUTORS.prepare(code, input, caseFileId, clock.now());
  if (!prepared.ok) return refuse(prepared.reason, prepared.status, prepared.code);

  const env = getEnv();
  const outcome = await eventTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CaseFile" WHERE id = ${caseFileId}::uuid FOR UPDATE`;
    const now = clock.now();
    const snapshot = await caseSnapshot(caseFileId, now, { db: tx });
    if (!snapshot) return { refused: 'NOT_FOUND' as const };
    const decision = authorize(subject, code, { kind: 'case', snapshot }, { mode: env.mode, demoToolsEnabled: env.demoToolsEnabled, now });
    if (!decision.allowed) return { refused: 'ACTION_NO_LONGER_AVAILABLE' as const };
    return { data: await EXECUTORS.execute(code, { tx, caseFileId, snapshot, subject, actor, now, value: prepared.value }) };
  }).catch(async (error: unknown) => {
    // A refusal raised inside the transaction rolls back whatever the act had written.
    if (error instanceof InputRefused) return { invalid: error.reason };
    // A declared effect that did not hold: nothing of the act stays, and the failure is recorded.
    if (error instanceof DeclaredEffectError) await appendStandaloneEvent({ action: 'case.action.refused', details: { caseFileId, action: code, reason: 'EFFECT_NOT_HELD' }, caseFileId, actor });
    throw error;
  });
  if ('refused' in outcome) {
    return outcome.refused === 'NOT_FOUND' ? { ok: false, status: 404, code: 'NOT_FOUND' } : refuse('STATE_CHANGED', 409, 'ACTION_NO_LONGER_AVAILABLE');
  }
  if ('invalid' in outcome) return refuse(outcome.invalid, 422, 'INVALID_INPUT');
  return { ok: true, data: outcome.data };
}
