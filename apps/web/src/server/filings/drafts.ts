import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import {
  CARD_SECTIONS,
  EMPTY_CARD,
  FilingCardSchema,
  SECURITY_POLICY,
  assessCourtFee,
  canonicalJson,
  feeClaims,
  moroccoDay,
  preSignatureChecks,
  principalValueCents,
  sectionContent,
  suggestCourt,
  type CardSection,
  type CaseTypeRule,
  type CourtSuggestion,
  type FeeAssessment,
  type FilingCard,
  type FilingCheck,
  type Resource,
  type Specialty,
  type UserSubject,
} from '@mahkama/core';
import type { FilingDraft, FilingDocument, Prisma } from '@/generated/prisma/client';
import { clock } from '../clock';
import { getDb } from '../db';
import { asJson } from '../json';
import { caseTypeRules, districtRules, feeSchedule, jurisdictionRules, referralRules } from '../rules/store';

// The filing draft (study, «المرحلة الأولى»; docs/phases/phase-2.md): what the
// lawyer (or, on paper, the registry clerk) prepares before filing. It belongs
// to its author alone: the core decides it on the resource built here
// (filing-draft), and every route of the draft is refused to anyone else as
// for a draft that does not exist. The fee is always computed here from the
// card's claims, never received from the client; once paid, it is bound to a
// digest of the claims, the court and the fee schedule.

type Tx = Prisma.TransactionClient;
type Db = ReturnType<typeof getDb> | Tx;

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export function parseCard(value: unknown): FilingCard {
  const parsed = FilingCardSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_CARD;
}

const sectionDigest = (card: FilingCard, section: CardSection) => sha256(canonicalJson(sectionContent(card, section)));

/** The sections whose attestation «مطابق للمقال» still matches their content. */
export function attestedSections(card: FilingCard, attestations: unknown): CardSection[] {
  const stored = attestations !== null && typeof attestations === 'object' ? (attestations as Record<string, unknown>) : {};
  return CARD_SECTIONS.filter((section) => stored[section] === sectionDigest(card, section));
}

export function attestationsFor(card: FilingCard, previous: unknown, sections: readonly CardSection[]): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const section of attestedSections(card, previous)) kept[section] = sectionDigest(card, section);
  for (const section of sections) kept[section] = sectionDigest(card, section);
  return kept;
}

// ---------------------------------------------------------------------------
// The fee and its payment

export interface DraftFee {
  readonly assessment: FeeAssessment;
  readonly version: string;
  /** the day the schedule applied is in force from (YYYY-MM-DD), shown instead of its version (review P2-L-36) */
  readonly validFrom: string;
  readonly uncertain: boolean;
  readonly digest: string;
}

/** The digest the payment is bound to: the claims, the court and the fee schedule's version. */
export function feeDigest(card: FilingCard, courtId: string | null, version: string): string {
  return sha256(canonicalJson({ claims: feeClaims(card), courtId, version }));
}

export async function draftFee(card: FilingCard, courtId: string | null, at: Date): Promise<DraftFee> {
  const schedule = await feeSchedule(at);
  const assessment = assessCourtFee({ claims: feeClaims(card), filing: 'APPLICATION', schedule });
  return {
    assessment,
    version: schedule.version,
    validFrom: schedule.validFrom,
    uncertain: assessment.lines.some((l) => l.uncertain),
    digest: feeDigest(card, courtId, schedule.version),
  };
}

interface IntentLike {
  readonly id: string;
  readonly status: string;
  readonly inputsDigest: string;
  readonly breakdown: unknown;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export const intentVersion = (intent: Pick<IntentLike, 'breakdown'>) => {
  const breakdown = intent.breakdown as { version?: unknown } | null;
  return typeof breakdown?.version === 'string' ? breakdown.version : '';
};

/** The successful payment that covers the draft's current claims, if any (memo rows 3 and 4). */
export function coveringIntent<T extends IntentLike>(draft: Pick<FilingDraft, 'courtId'>, card: FilingCard, intents: readonly T[]): T | null {
  return intents.find((i) => i.status === 'SUCCEEDED' && i.inputsDigest === feeDigest(card, draft.courtId, intentVersion(i))) ?? null;
}

/** The claims are locked once any payment succeeded (decision 57). */
export const claimsLocked = (intents: readonly IntentLike[]) => intents.some((i) => i.status === 'SUCCEEDED');

export function paymentStatus(intents: readonly IntentLike[], covering: IntentLike | null, now: Date): 'NONE' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' {
  if (covering) return 'SUCCEEDED';
  const latest = [...intents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) return 'NONE';
  if (latest.status === 'PENDING' && latest.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return latest.status as 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
}

// ---------------------------------------------------------------------------
// Loading and authorization

export type DraftWithParts = FilingDraft & {
  documents: FilingDocument[];
  intents: { id: string; status: string; inputsDigest: string; breakdown: Prisma.JsonValue; expiresAt: Date; createdAt: Date; amountCents: bigint; payment: { operationRef: string; paidAt: Date; id: string } | null }[];
};

export async function loadDraft(draftId: string, db: Db = getDb()): Promise<DraftWithParts | null> {
  return db.filingDraft.findUnique({
    where: { id: draftId },
    include: {
      documents: { where: { removedAt: null }, orderBy: [{ position: 'asc' }, { uploadedAt: 'asc' }] },
      intents: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, inputsDigest: true, breakdown: true, expiresAt: true, createdAt: true, amountCents: true, payment: { select: { id: true, operationRef: true, paidAt: true } } },
      },
    },
  });
}

/** The resource the core decides a draft's actions on. */
export function draftResourceOf(draft: DraftWithParts): Extract<Resource, { kind: 'filing-draft' }> {
  const card = parseCard(draft.card);
  return {
    kind: 'filing-draft',
    ownerUserId: draft.ownerUserId,
    channel: draft.channel,
    courtId: draft.courtId,
    status: draft.status,
    paid: coveringIntent(draft, card, draft.intents) !== null,
  };
}

export async function draftResource(draftId: string): Promise<Resource | null> {
  const draft = await loadDraft(draftId);
  return draft ? draftResourceOf(draft) : null;
}

// ---------------------------------------------------------------------------
// Reference data for the wizard

export interface CourtOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly specialty: Specialty;
  readonly degree: 'FIRST_INSTANCE' | 'APPEAL';
}

export async function firstInstanceCourts(db: Db = getDb()): Promise<CourtOption[]> {
  const rows = await db.court.findMany({ where: { degree: 'FIRST_INSTANCE' }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, specialty: true, degree: true } });
  return rows;
}

export async function caseTypeOf(code: string | null, at: Date): Promise<CaseTypeRule | null> {
  if (!code) return null;
  const rules = await caseTypeRules(at);
  return rules.types.find((t) => t.code === code) ?? null;
}

export async function suggestionFor(draft: Pick<FilingDraft, 'caseType' | 'defendantLocality'>, card: FilingCard, at: Date): Promise<CourtSuggestion> {
  const [caseType, districts, jurisdiction, courts] = await Promise.all([caseTypeOf(draft.caseType, at), districtRules(at), jurisdictionRules(at), firstInstanceCourts()]);
  const defendant = card.parties.find((p) => p.side !== 'PLAINTIFF');
  return suggestCourt({
    caseType,
    defendantLocality: draft.defendantLocality,
    principalCents: principalValueCents(card.claims, jurisdiction),
    defendantIsCompany: defendant?.personKind === 'LEGAL',
    districts,
    courts,
    jurisdiction,
  });
}

/** «جدول المفوضين العاملين بدائرة المحكمة» (art. 87): the bailiffs of the chosen court. */
export async function bailiffsOf(courtId: string | null, db: Db = getDb()): Promise<{ userId: string; name: string }[]> {
  if (!courtId) return [];
  const rows = await db.roleAssignment.findMany({
    where: { role: 'BAILIFF', courtId, revokedAt: null, user: { disabledAt: null } },
    select: { userId: true, user: { select: { fullName: true } } },
    orderBy: { user: { fullName: 'asc' } },
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.fullName }));
}

/** The lawyers of the platform's roster, for a paper filing made through a lawyer. */
export async function lawyersRoster(db: Db = getDb()): Promise<{ userId: string; name: string }[]> {
  const rows = await db.roleAssignment.findMany({
    where: { role: 'LAWYER', revokedAt: null, user: { disabledAt: null } },
    select: { userId: true, user: { select: { fullName: true } } },
    orderBy: { user: { fullName: 'asc' } },
    take: 200,
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.fullName }));
}

// ---------------------------------------------------------------------------
// The check before signature

async function filerOf(draft: FilingDraft): Promise<{ professionalNumber: string | null; professionalBody: string | null; email: string | null } | null> {
  if (draft.channel === 'PAPER') return null;
  const assignment = await getDb().roleAssignment.findUnique({
    where: { id: draft.ownerRoleAssignmentId },
    select: { professionalNumber: true, professionalBody: true, user: { select: { email: true } } },
  });
  return { professionalNumber: assignment?.professionalNumber ?? null, professionalBody: assignment?.professionalBody ?? null, email: assignment?.user.email ?? null };
}

export async function checksOf(draft: DraftWithParts, at: Date): Promise<FilingCheck[]> {
  const card = parseCard(draft.card);
  const [caseType, referrals, jurisdiction, court, filer] = await Promise.all([
    caseTypeOf(draft.caseType, at),
    referralRules(at),
    jurisdictionRules(at),
    draft.courtId ? getDb().court.findUnique({ where: { id: draft.courtId }, select: { specialty: true } }) : Promise.resolve(null),
    filerOf(draft),
  ]);
  const application = draft.documents.find((d) => d.kind === 'APPLICATION_COPY') ?? null;
  const present = draft.applicationMode === 'PASTE' ? (draft.applicationText ?? '') !== '' : draft.documents.some((d) => d.kind === 'APPLICATION_ORIGINAL' || d.kind === 'APPLICATION_COPY');
  const depositor = draft.paperDepositor as { name?: unknown } | null;
  return preSignatureChecks({
    channel: draft.channel,
    card,
    attested: attestedSections(card, draft.attestations),
    application: { present, fixedCopyReady: application !== null && draft.fixedCopyStatus === 'READY' },
    documents: draft.documents
      .filter((d) => d.kind === 'EXHIBIT' || (draft.channel === 'PAPER' && d.kind === 'APPLICATION_COPY'))
      .map((d) => ({
        id: d.id,
        kind: d.kind === 'EXHIBIT' ? 'EXHIBIT' : 'APPLICATION',
        declaredNature: d.declaredNature,
        pageCount: d.pageCount,
        paperOriginalLocation: d.paperOriginalLocation,
      })),
    filer,
    caseType,
    courtSpecialty: court?.specialty ?? null,
    referrals,
    jurisdiction,
    paperDepositor: typeof depositor?.name === 'string' ? { name: depositor.name } : null,
  });
}

// ---------------------------------------------------------------------------
// The view of a draft (the API and the wizard read the same)

export interface DraftView {
  readonly draft: {
    readonly id: string;
    readonly channel: 'ELECTRONIC' | 'PAPER';
    readonly status: 'DRAFT' | 'FILED';
    readonly courtId: string | null;
    readonly suggestedCourtId: string | null;
    readonly caseType: string | null;
    readonly defendantLocality: string | null;
    readonly card: FilingCard;
    readonly applicationMode: 'UPLOAD' | 'PASTE' | 'SCAN' | null;
    readonly applicationText: string | null;
    readonly fixedCopyStatus: 'NONE' | 'PENDING' | 'READY' | 'FAILED';
    readonly designatedBailiffUserId: string | null;
    readonly attestations: readonly CardSection[];
    readonly paperDepositor: { readonly name: string; readonly idNumber?: string; readonly quality?: string } | null;
    readonly paperLawyerUserId: string | null;
    readonly caseFileId: string | null;
    readonly filedAt: string | null;
  };
  readonly documents: readonly {
    readonly id: string;
    readonly kind: 'APPLICATION_ORIGINAL' | 'APPLICATION_COPY' | 'EXHIBIT' | 'PAYMENT_RECEIPT';
    readonly title: string | null;
    readonly mediaType: string;
    readonly sha256: string;
    readonly byteSize: number;
    readonly declaredNature: string | null;
    readonly pageCount: number | null;
    readonly paperOriginalLocation: string | null;
    readonly generated: boolean;
  }[];
  readonly fee: { readonly totalCents: number; readonly baseCents: number; readonly uncertain: boolean; readonly version: string; readonly validFrom: string; readonly lines: readonly { kind: string; amountCents: number; baseCents: number | null; rateBasisPoints: number | null; basis: string; uncertain: boolean }[]; readonly excluded: readonly string[] } | null;
  readonly payment: {
    readonly status: 'NONE' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
    readonly intentId: string | null;
    readonly operationRef: string | null;
    readonly amountCents: number | null;
    readonly paidAt: string | null;
  };
  readonly claimsLocked: boolean;
  readonly checks: readonly FilingCheck[];
  readonly suggestion: (CourtSuggestion & { readonly courtName: string | null }) | null;
  readonly bailiffs: readonly { readonly userId: string; readonly name: string }[];
  readonly courts: readonly { readonly id: string; readonly name: string }[];
  readonly caseTypes: readonly { readonly code: string; readonly specialty: Specialty }[];
  readonly localities: readonly string[];
  readonly lawyers: readonly { readonly userId: string; readonly name: string }[];
}

export async function draftView(draft: DraftWithParts, subject: UserSubject): Promise<DraftView> {
  const now = clock.now();
  const card = parseCard(draft.card);
  const [checks, suggestion, bailiffs, courts, caseTypes, districts, fee, lawyers] = await Promise.all([
    checksOf(draft, now),
    suggestionFor(draft, card, now),
    bailiffsOf(draft.courtId),
    draft.channel === 'PAPER' && subject.courtId
      ? getDb().court.findMany({ where: { id: subject.courtId }, select: { id: true, name: true } })
      : firstInstanceCourts().then((list) => list.map((c) => ({ id: c.id, name: c.name }))),
    caseTypeRules(now),
    districtRules(now),
    draftFee(card, draft.courtId, now).catch(() => null),
    draft.channel === 'PAPER' ? lawyersRoster() : Promise.resolve([]),
  ]);
  const covering = coveringIntent(draft, card, draft.intents);
  const latest = [...draft.intents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const shown = covering ?? latest;
  const suggestedName = suggestion.courtId ? (courts.find((c) => c.id === suggestion.courtId)?.name ?? (await getDb().court.findUnique({ where: { id: suggestion.courtId }, select: { name: true } }))?.name ?? null) : null;
  return {
    draft: {
      id: draft.id,
      channel: draft.channel,
      status: draft.status,
      courtId: draft.courtId,
      suggestedCourtId: draft.suggestedCourtId,
      caseType: draft.caseType,
      defendantLocality: draft.defendantLocality,
      card,
      applicationMode: draft.applicationMode,
      applicationText: draft.applicationText,
      fixedCopyStatus: draft.fixedCopyStatus,
      designatedBailiffUserId: draft.designatedBailiffUserId,
      attestations: attestedSections(card, draft.attestations),
      paperDepositor: (draft.paperDepositor as DraftView['draft']['paperDepositor']) ?? null,
      paperLawyerUserId: draft.paperLawyerUserId,
      caseFileId: draft.caseFileId,
      filedAt: draft.filedAt?.toISOString() ?? null,
    },
    documents: draft.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      mediaType: d.mediaType,
      sha256: d.sha256,
      byteSize: d.byteSize,
      declaredNature: d.declaredNature,
      pageCount: d.pageCount,
      paperOriginalLocation: d.paperOriginalLocation,
      generated: d.generated,
    })),
    fee: fee
      ? {
          totalCents: fee.assessment.totalCents,
          baseCents: fee.assessment.baseCents,
          uncertain: fee.uncertain,
          version: fee.version,
          validFrom: fee.validFrom,
          lines: fee.assessment.lines.map((l) => ({ ...l })),
          excluded: [...fee.assessment.excluded],
        }
      : null,
    payment: {
      status: paymentStatus(draft.intents, covering, now),
      intentId: shown?.id ?? null,
      operationRef: covering?.payment?.operationRef ?? null,
      amountCents: shown ? Number(shown.amountCents) : null,
      paidAt: covering?.payment?.paidAt.toISOString() ?? null,
    },
    claimsLocked: claimsLocked(draft.intents),
    checks,
    suggestion: { ...suggestion, courtName: suggestedName },
    bailiffs,
    courts,
    caseTypes: caseTypes.types.map((t) => ({ code: t.code, specialty: t.specialty })),
    localities: districts.localities,
    lawyers,
  };
}

// ---------------------------------------------------------------------------
// Limits

export function documentLimitReached(draft: DraftWithParts, addingBytes: number): boolean {
  const uploaded = draft.documents.filter((d) => !d.generated);
  const total = uploaded.reduce((n, d) => n + d.byteSize, 0);
  return uploaded.length >= SECURITY_POLICY.uploads.draftMaxDocuments || total + addingBytes > SECURITY_POLICY.uploads.draftMaxTotalBytes;
}

/** The storage key of a draft's object: generated, never chosen by the depositor. */
export const draftStorageKey = (draftId: string) => `drafts/${draftId}/${randomUUID()}`;

export function newDraftData(subject: UserSubject, channel: 'ELECTRONIC' | 'PAPER'): Prisma.FilingDraftUncheckedCreateInput {
  const now = clock.now();
  return {
    ownerUserId: subject.userId,
    ownerRoleAssignmentId: subject.roleAssignmentId,
    channel,
    courtId: channel === 'PAPER' ? subject.courtId : null,
    card: asJson(EMPTY_CARD),
    attestations: {},
    applicationMode: channel === 'PAPER' ? 'SCAN' : null,
    createdAt: now,
    updatedAt: now,
  };
}

export const todayOf = (at: Date) => moroccoDay(at);
