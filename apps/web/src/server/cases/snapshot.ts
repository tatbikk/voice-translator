import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import {
  CASE_FACTS,
  DEADLINE_CODES,
  PARTY_FACTS,
  moroccoDay,
  type CaseFact,
  type CaseSnapshot,
  type DeadlineCode,
  type PartyFact,
  type UserSubject,
} from '@mahkama/core';
import { getDb } from '../db';

// Builds the snapshot of a case file from the database, for one request: what
// the core needs to decide the available actions (CaseSnapshot). Facts stored by
// the applier of the acts' declarations (CaseFile.facts, decision 73) and by the
// demo data (CaseParty.facts) are joined with facts derived here from the data
// (a hearing set, a circle open…). The platform time is given, never read here.

/**
 * The facts of a file read from its data, never from a stored code (decision 73):
 * the moment of the stamp and of the referrals, an electronic document, the
 * envelopes ready to be sent, the latest investigation's columns, the hearing,
 * the day of pronouncement, the judgment and its signature circle. A code of one
 * of them found in CaseFile.facts is ignored, so that a stored fact never
 * contradicts the data. Every other fact of the file is stored.
 */
export const DERIVED_CASE_FACTS: ReadonlySet<CaseFact> = new Set<CaseFact>([
  'REGISTRATION_STAMPED',
  'REFERRED_TO_PROSECUTION',
  'REFERRED_TO_COMMISSIONER',
  'ELECTRONIC_DOCUMENT',
  'ENVELOPES_READY',
  'DEPOSIT_MADE',
  'MISSION_ACCEPTED',
  'MISSION_DECLINED',
  'EXPERT_PARTIES_SUMMONED',
  'REPORT_DEPOSITED',
  'REPORT_RETURNED',
  'FEES_ORDERED',
  'FEES_PAID',
  'HEARING_SET',
  'HEARING_HELD',
  'HEARING_UPCOMING',
  'HEARING_IN_SESSION',
  'PRONOUNCEMENT_DAY',
  'JUDGMENT_PRONOUNCED',
  'DECISION_FINAL',
  'PROVISIONAL_ENFORCEMENT',
  'SIGNATURES_COMPLETE',
  'SIGNATURE_CIRCLE_OPEN',
]);

/**
 * The facts of the file's latest investigation, each from its column (decision
 * 73). The list's query reads the same columns (cases/scope.ts, decision 76).
 */
export const INVESTIGATION_FACT_COLUMNS = {
  DEPOSIT_MADE: 'depositedAt',
  MISSION_ACCEPTED: 'acceptedAt',
  MISSION_DECLINED: 'declinedAt',
  EXPERT_PARTIES_SUMMONED: 'partiesSummonedAt',
  REPORT_DEPOSITED: 'reportDepositedAt',
  REPORT_RETURNED: 'returnedAt',
  FEES_ORDERED: 'feesOrderedCents',
  FEES_PAID: 'feesPaidAt',
} as const satisfies Partial<Record<CaseFact, keyof Prisma.InvestigationWhereInput>>;

/** The decisions whose fields and signature circle make the judgment's facts. */
export const JUDGMENT_DECISION_KINDS: readonly string[] = ['JUDGMENT', 'APPELLATE_DECISION'];

const CASE_FACT_SET: ReadonlySet<string> = new Set(CASE_FACTS.filter((f) => !DERIVED_CASE_FACTS.has(f)));
const PARTY_FACT_SET: ReadonlySet<string> = new Set(PARTY_FACTS);
const DEADLINE_SET: ReadonlySet<string> = new Set(DEADLINE_CODES);

/** Stored facts are kept only when the core knows them. */
function asFacts<T extends string>(values: readonly string[], allowed: ReadonlySet<string>): T[] {
  return values.filter((v): v is T => allowed.has(v));
}

export async function caseSnapshot(
  caseFileId: string,
  now: Date,
  options: { summonsCodeHolder?: UserSubject | null; db?: Prisma.TransactionClient } = {},
): Promise<CaseSnapshot | null> {
  // An executor builds the snapshot inside its transaction, after locking the file (Phase 1 memo, row 17).
  const db = options.db ?? getDb();
  const file = await db.caseFile.findUnique({
    where: { id: caseFileId },
    include: {
      court: { select: { specialty: true } },
      nextHearing: { select: { startsAt: true, heldAt: true } },
      parties: {
        orderBy: { position: 'asc' },
        include: { representations: { where: { endedAt: null }, select: { lawyerUserId: true } } },
      },
      // Every limit with its stored status: one recorded ELAPSED must not read as absent (review P1-S-02).
      timeLimits: { select: { ruleCode: true, partyId: true, endsAt: true, status: true } },
      // The latest investigation, as the database marks it (decision 76): its expert, and the facts
      // its columns record (review of the IR-10 fix).
      investigations: {
        where: { latest: true },
        take: 1,
        select: {
          expertUserId: true,
          depositedAt: true,
          acceptedAt: true,
          declinedAt: true,
          partiesSummonedAt: true,
          reportDepositedAt: true,
          returnedAt: true,
          feesOrderedCents: true,
          feesPaidAt: true,
        },
      },
      envelopes: { where: { status: 'READY' }, take: 1, select: { id: true } },
      decisions: { select: { kind: true, pronouncedAt: true, final: true, provisionalEnforcement: true, signatureCircleId: true } },
      documents: { where: { generated: false, channel: 'ELECTRONIC' }, take: 1, select: { id: true } },
      enforcement: { where: { kind: 'GARNISHMENT' }, select: { organizationId: true } },
    },
  });
  if (!file) return null;

  const facts = new Set<CaseFact>(asFacts(file.facts, CASE_FACT_SET));
  if (file.registrationStampedAt) facts.add('REGISTRATION_STAMPED');
  if (file.referredToProsecutionAt) facts.add('REFERRED_TO_PROSECUTION');
  if (file.referredToCommissionerAt) facts.add('REFERRED_TO_COMMISSIONER');
  if (file.documents.length > 0) facts.add('ELECTRONIC_DOCUMENT');
  if (file.envelopes.length > 0) facts.add('ENVELOPES_READY');
  const investigation = file.investigations[0];
  if (investigation) {
    for (const [fact, column] of Object.entries(INVESTIGATION_FACT_COLUMNS) as [CaseFact, keyof typeof investigation][]) {
      if (investigation[column] !== null) facts.add(fact);
    }
  }
  const hearing = file.nextHearing;
  if (hearing) {
    facts.add('HEARING_SET');
    if (hearing.heldAt) facts.add('HEARING_HELD');
    else if (hearing.startsAt.getTime() > now.getTime()) facts.add('HEARING_UPCOMING');
    else if (moroccoDay(hearing.startsAt) === moroccoDay(now)) facts.add('HEARING_IN_SESSION');
  }
  if (file.pronouncementDate && file.pronouncementDate === moroccoDay(now)) facts.add('PRONOUNCEMENT_DAY');

  // The judgment and its signature circle.
  const judgment = file.decisions.find((d) => JUDGMENT_DECISION_KINDS.includes(d.kind));
  let nextSignerUserIds: string[] = [];
  let nextSignerDocumentIds: string[] = [];
  if (judgment) {
    if (judgment.pronouncedAt) facts.add('JUDGMENT_PRONOUNCED');
    if (judgment.final) facts.add('DECISION_FINAL');
    if (judgment.provisionalEnforcement) facts.add('PROVISIONAL_ENFORCEMENT');
    if (judgment.signatureCircleId) {
      const circle = await db.signatureCircle.findUnique({
        where: { id: judgment.signatureCircleId },
        select: { status: true, signers: true, documentId: true, _count: { select: { signatures: true } } },
      });
      const signerCount = Array.isArray(circle?.signers) ? circle.signers.length : Number.POSITIVE_INFINITY;
      // Complete only with every signature present, whatever the stored status says (review P1-S-04).
      if (circle?.status === 'COMPLETED' && circle._count.signatures >= signerCount) facts.add('SIGNATURES_COMPLETE');
      if (circle?.status === 'OPEN') {
        facts.add('SIGNATURE_CIRCLE_OPEN');
        const signers = circle.signers as unknown as { userId: string }[];
        const next = signers[circle._count.signatures];
        if (next) {
          nextSignerUserIds = [next.userId];
          nextSignerDocumentIds = [circle.documentId];
        }
      }
    }
  }

  return {
    caseFileId: file.id,
    kind: file.kind,
    status: file.status,
    courtId: file.courtId,
    panelId: file.panelId,
    // From the court's specialty (review P1-A-04, in part).
    administrativeCourt: file.court.specialty === 'ADMINISTRATIVE',
    rapporteurUserId: file.rapporteurUserId,
    expertUserId: investigation?.expertUserId ?? null,
    facts: [...facts],
    parties: file.parties.map((p) => {
      const partyFacts = new Set<PartyFact>(asFacts(p.facts, PARTY_FACT_SET));
      if (p.eServiceAcceptedAt) partyFacts.add('E_SERVICE_ACCEPTED');
      return {
        partyId: p.id,
        side: p.side,
        counselUserIds: p.representations.map((r) => r.lawyerUserId),
        litigantUserId: p.litigantUserId,
        organizationId: p.organizationId,
        facts: [...partyFacts],
      };
    }),
    deadlines: file.timeLimits
      .filter((t) => DEADLINE_SET.has(t.ruleCode))
      .map((t) => ({ code: t.ruleCode as DeadlineCode, partyId: t.partyId, endsAt: t.endsAt, status: t.status })),
    nextSignerUserIds,
    nextSignerDocumentIds,
    minutesNextSignerUserIds: [],
    garnisheeOrganizationIds: file.enforcement.map((e) => e.organizationId).filter((o): o is string => o !== null),
    summonsCodeHolderUserIds: options.summonsCodeHolder ? [options.summonsCodeHolder.userId] : [],
    cassationAccreditedUserIds: [],
  };
}
