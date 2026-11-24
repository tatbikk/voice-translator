import 'server-only';
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
// the transitions of later phases (CaseFile.facts, CaseParty.facts) are joined
// with facts derived here from the data (a hearing set, a circle open…). The
// platform time is given, never read here.

const CASE_FACT_SET: ReadonlySet<string> = new Set(CASE_FACTS);
const PARTY_FACT_SET: ReadonlySet<string> = new Set(PARTY_FACTS);
const DEADLINE_SET: ReadonlySet<string> = new Set(DEADLINE_CODES);

/** Stored facts are kept only when the core knows them. */
function asFacts<T extends string>(values: readonly string[], allowed: ReadonlySet<string>): T[] {
  return values.filter((v): v is T => allowed.has(v));
}

export async function caseSnapshot(caseFileId: string, now: Date, options: { summonsCodeHolder?: UserSubject | null } = {}): Promise<CaseSnapshot | null> {
  const db = getDb();
  const file = await db.caseFile.findUnique({
    where: { id: caseFileId },
    include: {
      nextHearing: { select: { startsAt: true, heldAt: true } },
      parties: {
        orderBy: { position: 'asc' },
        include: { representations: { where: { endedAt: null }, select: { lawyerUserId: true } } },
      },
      timeLimits: { where: { status: 'RUNNING' }, select: { ruleCode: true, partyId: true, endsAt: true } },
      investigations: { orderBy: { createdAt: 'desc' }, take: 1, select: { expertUserId: true } },
      decisions: { select: { kind: true, pronouncedAt: true, final: true, provisionalEnforcement: true, signatureCircleId: true } },
      documents: { where: { generated: false, channel: 'ELECTRONIC' }, take: 1, select: { id: true } },
      enforcement: { where: { kind: 'GARNISHMENT' }, select: { organizationId: true } },
    },
  });
  if (!file) return null;

  const facts = new Set<CaseFact>(asFacts(file.facts, CASE_FACT_SET));
  if (file.registrationStampedAt) facts.add('REGISTRATION_STAMPED');
  if (file.referredToProsecutionAt) facts.add('REFERRED_TO_PROSECUTION');
  if (file.documents.length > 0) facts.add('ELECTRONIC_DOCUMENT');
  const hearing = file.nextHearing;
  if (hearing) {
    facts.add('HEARING_SET');
    if (hearing.heldAt) facts.add('HEARING_HELD');
    else if (hearing.startsAt.getTime() > now.getTime()) facts.add('HEARING_UPCOMING');
    else if (moroccoDay(hearing.startsAt) === moroccoDay(now)) facts.add('HEARING_IN_SESSION');
  }
  if (file.pronouncementDate && file.pronouncementDate === moroccoDay(now)) facts.add('PRONOUNCEMENT_DAY');

  // The judgment and its signature circle.
  const judgment = file.decisions.find((d) => d.kind === 'JUDGMENT' || d.kind === 'APPELLATE_DECISION');
  let nextSignerUserIds: string[] = [];
  if (judgment) {
    if (judgment.pronouncedAt) facts.add('JUDGMENT_PRONOUNCED');
    if (judgment.final) facts.add('DECISION_FINAL');
    if (judgment.provisionalEnforcement) facts.add('PROVISIONAL_ENFORCEMENT');
    if (judgment.signatureCircleId) {
      const circle = await db.signatureCircle.findUnique({
        where: { id: judgment.signatureCircleId },
        select: { status: true, signers: true, _count: { select: { signatures: true } } },
      });
      if (circle?.status === 'COMPLETED') facts.add('SIGNATURES_COMPLETE');
      if (circle?.status === 'OPEN') {
        facts.add('SIGNATURE_CIRCLE_OPEN');
        const signers = circle.signers as unknown as { userId: string }[];
        const next = signers[circle._count.signatures];
        if (next) nextSignerUserIds = [next.userId];
      }
    }
  }

  return {
    caseFileId: file.id,
    kind: file.kind,
    status: file.status,
    courtId: file.courtId,
    panelId: file.panelId,
    administrativeCourt: false,
    rapporteurUserId: file.rapporteurUserId,
    expertUserId: file.investigations[0]?.expertUserId ?? null,
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
      .map((t) => ({ code: t.ruleCode as DeadlineCode, partyId: t.partyId, endsAt: t.endsAt })),
    nextSignerUserIds,
    minutesNextSignerUserIds: [],
    garnisheeOrganizationIds: file.enforcement.map((e) => e.organizationId).filter((o): o is string => o !== null),
    summonsCodeHolderUserIds: options.summonsCodeHolder ? [options.summonsCodeHolder.userId] : [],
    cassationAccreditedUserIds: [],
  };
}
