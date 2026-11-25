import 'server-only';
import { randomUUID } from 'node:crypto';
import { filingReady, lawArticles, moroccoDay, referralsFor, type CardParty, type LegalBasis, type Referral, type ReferralRuleSet, type UserSubject } from '@mahkama/core';
import type { Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getEnv } from '../config/env';
import { getDb } from '../db';
import { sha256Hex } from '../documents/service';
import { documentStore } from '../documents/store';
import { appendEvent, appendStandaloneEvent, eventTransaction, type EventActor } from '../events/append';
import type { ErrorCode } from '../http/responses';
import { enqueue } from '../jobs/queue';
import { createNotification } from '../notifications/service';
import { referralRules, ruleSetId } from '../rules/store';
import { checkSigningSecret, signAloneInTransaction } from '../signature/service';
import { caseTypeOf, checksOf, coveringIntent, loadDraft, parseCard, type DraftWithParts } from './drafts';

// Filing and registration in one transaction (study, «المرحلة الثانية»: «في
// اللحظة التي يكتمل فيها الإيداع والأداء، يقيد النظام القضية في السجل
// الإلكتروني ويمنحها رقما»; decision 58). The signing secret is checked first,
// outside the transaction (its attempts count even if the filing fails); then,
// under the draft's lock, the platform checks again that the draft is open and
// paid, gives the next number of the court's register for the year (decision
// 53) and the national identifier, creates the file at «مقيد» with its parties,
// claims, documents, fee and payment, signs the fixed copy, decides and records
// the referrals (even when none is due), informs whoever must be informed, and
// asks the worker for «وصل الإيداع».

type Tx = Prisma.TransactionClient;

export type SubmitOutcome =
  | { readonly ok: true; readonly caseFileId: string; readonly number: number; readonly code: number; readonly year: number; readonly nationalRef: string }
  | { readonly ok: false; readonly status: number; readonly code: ErrorCode };

async function refused(draftId: string, actor: EventActor, status: number, code: ErrorCode): Promise<SubmitOutcome> {
  await appendStandaloneEvent({ action: 'filing.refused', details: { draftId, reason: code }, actor });
  return { ok: false, status, code };
}

/** The next number of the court's register for the year: one row per court and year, under lock. */
async function nextNumber(tx: Tx, courtId: string, year: number): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number | bigint }[]>`
    INSERT INTO "CaseSequence" ("courtId", "year", "lastNumber")
    VALUES (${courtId}::uuid, ${year}, COALESCE((SELECT MAX("number") FROM "CaseFile" WHERE "courtId" = ${courtId}::uuid AND "year" = ${year}), 0) + 1)
    ON CONFLICT ("courtId", "year") DO UPDATE
      SET "lastNumber" = GREATEST("CaseSequence"."lastNumber", COALESCE((SELECT MAX("number") FROM "CaseFile" WHERE "courtId" = ${courtId}::uuid AND "year" = ${year}), 0)) + 1
    RETURNING "lastNumber" AS n`;
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('register: no number');
  return Number(n);
}

/** «المعرف الوطني الموحد» (س35): prefix, year, court, number; never the code, which may be corrected. */
export function nationalRefOf(mode: 'demo' | 'production', year: number, courtCode: string, number: number): string {
  const court = courtCode.toUpperCase().replace(/^DEMO-/, '').replace(/[^A-Z0-9-]/g, '');
  return `${mode === 'demo' ? 'DEMO' : 'MA'}-${String(year)}-${court}-${String(number).padStart(6, '0')}`;
}

const DOC_TYPES = { APPLICATION_COPY: 'APPLICATION', APPLICATION_ORIGINAL: 'APPLICATION_SOURCE', EXHIBIT: 'EXHIBIT', PAYMENT_RECEIPT: 'PAYMENT_RECEIPT' } as const;

function addressesOf(party: CardParty, now: Date): Prisma.PartyAddressCreateWithoutPartyInput[] {
  const out: Prisma.PartyAddressCreateWithoutPartyInput[] = [];
  const add = (kind: 'DOMICILE' | 'RESIDENCE' | 'REGISTERED_OFFICE' | 'BRANCH' | 'ELECTRONIC' | 'PHONE', value: string | undefined, source: 'DECLARED' | 'COMMERCIAL_REGISTER' = 'DECLARED') => {
    if (value) out.push({ kind, value, source, validFrom: now });
  };
  add('DOMICILE', party.domicile?.value, party.domicile?.source);
  add('RESIDENCE', party.residence?.value, party.residence?.source);
  add('REGISTERED_OFFICE', party.registeredOffice?.value, party.registeredOffice?.source);
  add('BRANCH', party.branch?.value, party.branch?.source);
  add('ELECTRONIC', party.email);
  add('PHONE', party.phone);
  return out;
}

function subjectOf(summary: string): string | null {
  const text = summary.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= 140) return text;
  const cut = text.slice(0, 140);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).trim()}…`;
}

/** The grounds of the referrals as the event records them (one code, «NONE» when none is due). */
/** The articles the referral review applies, read from the rule set itself (arts. 18, 20 and 101 today). */
export function referralArticles(rules: ReferralRuleSet): LegalBasis {
  return lawArticles(...[...new Set([rules.prosecution.principalParty.article, rules.prosecution.communication.article, rules.royalCommissioner.article])].sort((a, b) => a - b));
}

export const groundsText = (referrals: readonly Referral[]) =>
  referrals.length === 0 ? 'NONE' : referrals.map((r) => [r.target, r.ground, r.article, r.item ?? 0].join('/')).join(':');

export async function submitDraft(draftId: string, subject: UserSubject, secret: string | null, actor: EventActor): Promise<SubmitOutcome> {
  const draft = await loadDraft(draftId);
  if (!draft) return refused(draftId, actor, 404, 'NOT_FOUND');
  const now = clock.now();

  // 1. Nothing blocks the filing (the fee itself was checked by the core).
  const checks = await checksOf(draft, now);
  if (!filingReady(checks)) return refused(draftId, actor, 409, 'DRAFT_INCOMPLETE');
  const copy = draft.documents.find((d) => d.kind === 'APPLICATION_COPY');
  if (!copy || !draft.courtId || !draft.caseType) return refused(draftId, actor, 409, 'DRAFT_INCOMPLETE');

  // 2. The signature of the electronic filing (art. 76): the secret before anything else.
  if (draft.channel === 'ELECTRONIC') {
    if (!secret) return refused(draftId, actor, 422, 'SIGNING_SECRET_INVALID');
    const checked = await checkSigningSecret(subject.userId, secret);
    if (checked === 'LOCKED') return refused(draftId, actor, 423, 'SIGNING_LOCKED');
    if (checked === 'NO_SECRET') return refused(draftId, actor, 409, 'NO_SIGNING_SECRET');
    if (checked === 'INVALID_SECRET') return refused(draftId, actor, 422, 'SIGNING_SECRET_INVALID');
  }

  // 3. The copy signed is the one the lawyer saw: its bytes still have their hash (memo row 20).
  const stored = await documentStore().get(copy.storageKey);
  if (!stored || sha256Hex(stored) !== copy.sha256) return refused(draftId, actor, 409, 'DOCUMENT_CHANGED');

  const card = parseCard(draft.card);
  const [caseType, rules, court] = await Promise.all([
    caseTypeOf(draft.caseType, now),
    referralRules(now),
    getDb().court.findUniqueOrThrow({ where: { id: draft.courtId }, select: { id: true, code: true, specialty: true } }),
  ]);
  if (!caseType) return refused(draftId, actor, 409, 'DRAFT_INCOMPLETE');
  if (card.parties.length === 0) return refused(draftId, actor, 409, 'DRAFT_INCOMPLETE');
  const referralRuleSetId = await ruleSetId('REFERRALS', rules.version);
  const env = getEnv();
  const year = Number(moroccoDay(now).slice(0, 4));

  const result = await eventTransaction(async (tx): Promise<SubmitOutcome> => {
    // 4. Under the draft's lock: still open, still paid (memo rows 3 and 6).
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "FilingDraft" WHERE id = ${draftId}::uuid FOR UPDATE`;
    if (locked[0]?.status !== 'DRAFT') return { ok: false, status: 409, code: 'ALREADY_FILED' };
    const fresh = (await loadDraft(draftId, tx)) as DraftWithParts;
    const freshCard = parseCard(fresh.card);
    const intent = coveringIntent(fresh, freshCard, fresh.intents);
    const payment = intent?.payment ?? null;
    if (!intent || !payment) return { ok: false, status: 409, code: 'DRAFT_INCOMPLETE' };
    // Everything the file is built from is read again under the lock (review P2-A-01): the
    // court and the case type the number and the referrals rest on, the copy signed, the checks.
    if (fresh.courtId !== draft.courtId || fresh.caseType !== draft.caseType) return { ok: false, status: 409, code: 'DRAFT_CHANGED' };
    const freshCopy = fresh.documents.find((d) => d.kind === 'APPLICATION_COPY');
    if (!freshCopy || freshCopy.id !== copy.id || freshCopy.sha256 !== copy.sha256) return { ok: false, status: 409, code: 'DOCUMENT_CHANGED' };
    if (!filingReady(await checksOf(fresh, now))) return { ok: false, status: 409, code: 'DRAFT_INCOMPLETE' };
    // The bailiff designated is still one of the court's district (art. 87, review P2-S-08).
    if (fresh.designatedBailiffUserId) {
      const bailiff = await tx.roleAssignment.findFirst({ where: { userId: fresh.designatedBailiffUserId, role: 'BAILIFF', courtId: fresh.courtId, revokedAt: null }, select: { id: true } });
      if (!bailiff) return { ok: false, status: 409, code: 'DRAFT_CHANGED' };
    }
    const referrals = referralsFor({ courtSpecialty: court.specialty, caseType, parties: freshCard.parties, rules });

    // 5. The register: the next number, the national identifier (decision 53).
    const number = await nextNumber(tx, court.id, year);
    const code = Number(fresh.caseType);
    const nationalRef = nationalRefOf(env.mode, year, court.code, number);
    const caseFileId = randomUUID();
    const prosecution = referrals.some((r) => r.target === 'PROSECUTION');
    const commissioner = referrals.some((r) => r.target === 'ROYAL_COMMISSIONER');
    const paperLawyer = fresh.channel === 'PAPER' ? fresh.paperLawyerUserId : null;
    const filer = fresh.channel === 'ELECTRONIC' ? fresh.ownerUserId : paperLawyer;
    const marksCounsel = freshCard.parties.some((p) => p.side === 'PLAINTIFF' && p.representedByFiler === true);
    await tx.caseFile.create({
      data: {
        id: caseFileId,
        nationalRef,
        courtId: court.id,
        number,
        code,
        year,
        status: 'REGISTERED',
        isDemo: env.mode === 'demo',
        createdAt: now,
        kind: 'FIRST_INSTANCE',
        caseType: fresh.caseType,
        subject: subjectOf(freshCard.summary),
        procedure: fresh.procedure,
        registeredAt: now,
        referredToProsecutionAt: prosecution ? now : null,
        referredToCommissionerAt: commissioner ? now : null,
        filingChannel: fresh.channel,
        filedByUserId: fresh.ownerUserId,
        designatedBailiffUserId: fresh.designatedBailiffUserId,
      },
    });

    // 6. The parties, their addresses with their source, counsel, the claims.
    const partyIds = new Map<string, string>();
    for (const [position, party] of freshCard.parties.entries()) {
      const id = randomUUID();
      partyIds.set(party.key, id);
      await tx.caseParty.create({
        data: {
          id,
          caseFileId,
          side: party.side,
          personKind: party.personKind,
          displayName: party.name,
          legalForm: party.legalForm ?? null,
          legalRepresentative: party.legalRepresentative ?? null,
          idNumber: party.idNumber ?? null,
          publicEntityKind: party.publicEntityKind ?? null,
          capacityStatus: party.capacityStatus ?? null,
          agentName: party.agent?.name ?? null,
          agentAddress: party.agent?.address ?? null,
          position: position + 1,
          addresses: { create: addressesOf(party, now) },
        },
      });
      // Counsel of the filing is a plaintiff's only (review P2-S-02; the card's schema refuses it on another side).
      // On paper, the lawyer the clerk picked from the roster acts for the plaintiffs the card marks,
      // or for every plaintiff when it marks none (decision 59).
      if (filer && party.side === 'PLAINTIFF' && (party.representedByFiler === true || (paperLawyer !== null && !marksCounsel))) {
        await tx.representation.create({ data: { partyId: id, lawyerUserId: filer, startedAt: now } });
      }
    }
    const plaintiffId = freshCard.parties.filter((p) => p.side === 'PLAINTIFF').map((p) => partyIds.get(p.key))[0] ?? null;
    for (const claim of freshCard.claims) {
      await tx.claim.create({
        data: {
          caseFileId,
          partyId: plaintiffId,
          category: 'PRINCIPAL',
          nature: claim.nature,
          amountCents: claim.amountCents === null ? null : BigInt(claim.amountCents),
          basis: claim.description ?? null,
          filedAt: now,
        },
      });
    }

    // 7. The documents join the file under the same stored objects.
    let applicationDocumentId: string | null = null;
    let receiptDocumentId: string | null = null;
    let applicationSha: string | null = null;
    for (const doc of fresh.documents) {
      const documentId = randomUUID();
      const docType = DOC_TYPES[doc.kind];
      await tx.document.create({
        data: {
          id: documentId,
          caseFileId,
          storageKey: doc.storageKey,
          sha256: doc.sha256,
          byteSize: doc.byteSize,
          mediaType: doc.mediaType,
          docType,
          title: doc.title,
          declaredNature: doc.declaredNature,
          channel: fresh.channel,
          paperOriginalLocation: doc.paperOriginalLocation,
          pageCount: doc.pageCount,
          depositedByUserId: fresh.ownerUserId,
          depositedByPartyId: plaintiffId,
          depositedAt: doc.uploadedAt,
          generated: doc.generated,
          simulated: doc.kind === 'PAYMENT_RECEIPT',
          visibility: 'CASE',
        },
      });
      await tx.filingDocument.update({ where: { id: doc.id }, data: { documentId } });
      await appendEvent(tx, { action: 'document.stored', details: { documentId, sha256: doc.sha256, byteSize: doc.byteSize, generated: doc.generated, docType }, caseFileId, actor });
      if (doc.kind === 'APPLICATION_COPY') {
        applicationDocumentId = documentId;
        applicationSha = doc.sha256;
        const paragraphs = Array.isArray(fresh.applicationParagraphs) ? fresh.applicationParagraphs.filter((p): p is string => typeof p === 'string') : [];
        if (doc.generated && paragraphs.length > 0) {
          await tx.documentParagraph.createMany({ data: paragraphs.map((text, i) => ({ documentId, position: i + 1, text })) });
        }
      }
      if (doc.kind === 'PAYMENT_RECEIPT') receiptDocumentId = documentId;
    }
    if (!applicationDocumentId || !applicationSha) throw new Error('registration: no application copy');

    // 8. The signature of the electronic application (art. 76).
    if (fresh.channel === 'ELECTRONIC') {
      await signAloneInTransaction(tx, {
        documentId: applicationDocumentId,
        documentSha256: applicationSha,
        caseFileId,
        purpose: 'APPLICATION_FILING',
        signer: { userId: subject.userId, roleAssignmentId: subject.roleAssignmentId, role: subject.role },
        actor,
      });
    }

    // 9. The fee, its payment and the treasury entry are linked to the file.
    await tx.payment.update({ where: { id: payment.id }, data: { caseFileId, ...(receiptDocumentId ? { receiptDocumentId } : {}) } });
    await tx.treasuryEntry.updateMany({ where: { paymentId: payment.id, caseFileId: null }, data: { caseFileId } });
    await tx.feeAssessment.updateMany({ where: { draftId, inputsDigest: intent.inputsDigest, caseFileId: null }, data: { caseFileId } });

    // 10. The referrals, recorded even when none is due.
    for (const referral of referrals) {
      await tx.caseReferral.create({
        data: { caseFileId, target: referral.target, ground: referral.ground, article: referral.article, item: referral.item, reasonCode: referral.reasonCode, ruleSetId: referralRuleSetId, createdAt: now },
      });
    }

    await tx.filingDraft.update({ where: { id: draftId }, data: { status: 'FILED', filedAt: now, caseFileId, updatedAt: now } });
    await appendEvent(tx, { action: 'filing.submitted', details: { draftId, caseFileId, channel: fresh.channel }, caseFileId, actor });
    await appendEvent(tx, { action: 'case.registered', details: { caseFileId, draftId, number, code, year, channel: fresh.channel }, caseFileId, actor });
    await appendEvent(tx, {
      action: 'case.referrals.reviewed',
      details: { caseFileId, ruleVersion: rules.version, referrals: referrals.length, grounds: groundsText(referrals) },
      caseFileId,
      legalBasis: referralArticles(rules),
    });

    // 11. Who is informed: the filer, and whoever the file is referred to.
    const params = { number: `${String(number)}/${String(code)}/${String(year)}` };
    const target = `/cases/${caseFileId}`;
    const informed = new Set<string>([fresh.ownerUserId, ...(paperLawyer ? [paperLawyer] : [])]);
    for (const userId of informed) {
      await createNotification(tx, { userId, kind: 'INFORMATION', templateKey: 'notifications.case.registered', params, targetPath: target, caseFileId });
    }
    const referredRoles = [...(prosecution ? (['PUBLIC_PROSECUTOR'] as const) : []), ...(commissioner ? (['ROYAL_COMMISSIONER'] as const) : [])];
    if (referredRoles.length > 0) {
      const holders = await tx.roleAssignment.findMany({ where: { role: { in: [...referredRoles] }, courtId: court.id, revokedAt: null }, select: { userId: true } });
      for (const userId of new Set(holders.map((h) => h.userId))) {
        await createNotification(tx, { userId, kind: 'INFORMATION', templateKey: 'notifications.case.referred', params, targetPath: target, caseFileId });
      }
    }
    await enqueue(tx, 'filing.receipt', { caseFileId });
    return { ok: true, caseFileId, number, code, year, nationalRef };
  });
  if (!result.ok) return refused(draftId, actor, result.status, result.code);
  return result;
}
