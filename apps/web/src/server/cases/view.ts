import 'server-only';
import {
  documentVisible,
  holdsRelation,
  readsRegistryNotes,
  seesPartyContacts,
  storedFeeUncertain,
  type CaseSnapshot,
  type UserSubject,
} from '@mahkama/core';
import { clock } from '../clock';
import { getDb } from '../db';
import { timeLimitRules } from '../rules/store';

// What the eight tabs of the case page show (interface book, «العناصر
// المشتركة»), read-only, already filtered for the subject: a document or a
// decision the subject may not see is not loaded at all. The timeline is a view
// of the event log, never a second record (prompt, rule 4).

export const CASE_TABS = ['timeline', 'documents', 'parties', 'claims', 'services', 'deadlines', 'payments', 'decisions'] as const;
export type CaseTab = (typeof CASE_TABS)[number];

export interface CaseHeader {
  readonly id: string;
  readonly nationalRef: string;
  readonly number: { number: number; code: number; year: number };
  readonly courtName: string;
  readonly courtDegree: 'FIRST_INSTANCE' | 'APPEAL';
  readonly panelName: string | null;
  readonly kind: 'FIRST_INSTANCE' | 'APPEAL' | 'ENFORCEMENT';
  readonly caseType: string | null;
  readonly subject: string | null;
  readonly status: string;
  readonly nextHearing: Date | null;
  readonly rapporteurName: string | null;
}

export interface CaseView {
  readonly header: CaseHeader;
  readonly timeline: readonly { seq: string; action: string; detailAction: string | null; occurredAt: Date; actorRole: string | null; articles: readonly number[]; referrals: number | null }[];
  readonly documents: readonly {
    id: string;
    docType: string;
    title: string | null;
    declaredNature: string | null;
    channel: string;
    depositor: string | null;
    depositedAt: Date;
    generated: boolean;
    simulated: boolean;
    withdrawn: boolean;
    signatures: number;
    /** a signature of the simulated provider: the document carries the visible stamp «توقيع تجريبي» (audit G046) */
    simulatedSignature: boolean;
  }[];
  readonly parties: readonly {
    id: string;
    side: string;
    personKind: string;
    displayName: string;
    legalForm: string | null;
    legalRepresentative: string | null;
    /** trade register or identity number: to the court and to counsel only (review P1-S-14) */
    idNumber: string | null;
    counsel: readonly string[];
    addresses: readonly { kind: string; value: string; source: string }[];
    eServiceAcceptedAt: Date | null;
  }[];
  /** the notes of the registry office to the judge (art. 619): never shown to a party or its counsel */
  readonly notes: readonly { id: string; reason: string; text: string; createdAt: Date; authorRole: string }[];
  readonly claims: readonly { id: string; category: string; nature: string; amountCents: bigint | null; party: string | null }[];
  readonly services: readonly {
    id: string;
    party: string;
    purpose: string;
    channel: string;
    status: string;
    dispatchedAt: Date | null;
    servedAt: Date | null;
    deemedServedAt: Date | null;
    proof: 'CERTIFICATE' | 'RECEIPT_NOTICE' | null;
  }[];
  readonly deadlines: readonly {
    id: string;
    ruleCode: string;
    party: string | null;
    startsAt: Date;
    endsAt: Date;
    lastDay: string;
    status: string;
    uncertain: boolean;
    articles: readonly number[];
  }[];
  readonly payments: {
    readonly fees: readonly { id: string; filing: string; totalCents: bigint; assessedAt: Date; uncertain: boolean }[];
    readonly payments: readonly { id: string; purpose: string; amountCents: bigint; status: string; operationRef: string; paidAt: Date }[];
    readonly treasury: readonly { id: string; direction: string; purpose: string; amountCents: bigint; at: Date }[];
  };
  readonly decisions: readonly { id: string; kind: string; subjectCode: string; issuedAt: Date; pronouncedAt: Date | null; final: boolean }[];
}

export async function caseView(caseFileId: string, subject: UserSubject, snapshot: CaseSnapshot): Promise<CaseView | null> {
  const db = getDb();
  const file = await db.caseFile.findUnique({
    where: { id: caseFileId },
    include: {
      court: { select: { name: true, degree: true } },
      panel: { select: { name: true } },
      rapporteur: { select: { fullName: true } },
      nextHearing: { select: { startsAt: true } },
      parties: {
        orderBy: { position: 'asc' },
        include: {
          addresses: { where: { supersededAt: null }, orderBy: { validFrom: 'asc' } },
          representations: { where: { endedAt: null }, include: { lawyer: { select: { fullName: true } } } },
        },
      },
      claims: { orderBy: { filedAt: 'asc' } },
      documents: { orderBy: { depositedAt: 'asc' }, include: { circles: { include: { signatures: { select: { provider: true } } } } } },
      envelopes: { orderBy: { createdAt: 'asc' }, include: { certificate: { select: { id: true } }, receipt: { select: { id: true } } } },
      timeLimits: { orderBy: { endsAt: 'asc' } },
      fees: { orderBy: { assessedAt: 'asc' } },
      payments: { orderBy: { paidAt: 'asc' } },
      treasury: { orderBy: { at: 'asc' } },
      decisions: { orderBy: { issuedAt: 'asc' } },
      notes: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!file) return null;
  const partyName = new Map(file.parties.map((p) => [p.id, p.displayName]));
  const panelSide = holdsRelation(subject, snapshot, 'PANEL') || holdsRelation(subject, snapshot, 'RAPPORTEUR');
  // Identity numbers and electronic contacts of the parties: the court and counsel
  // see them; a litigant, an administration or another participant sees its own only.
  const seesContacts = seesPartyContacts(subject);
  const ownParty = (p: { litigantUserId: string | null }) => p.litigantUserId === subject.userId;
  const notesVisible = (n: { addressedToUserId: string | null }) => readsRegistryNotes(subject, snapshot, n.addressedToUserId);
  // A note of the registry is the court's: its very existence stays off the timeline of whoever may not read it.
  const notesKnown = readsRegistryNotes(subject, snapshot, null) || file.notes.some((n) => notesVisible(n));

  const events = await db.event.findMany({
    where: { caseFileId, outcome: 'DONE' },
    orderBy: { seq: 'asc' },
    select: { seq: true, action: true, occurredAt: true, actorRole: true, legalBasis: true, details: true },
  });

  let rules: Awaited<ReturnType<typeof timeLimitRules>> | null = null;
  try {
    rules = await timeLimitRules(clock.now());
  } catch {
    rules = null;
  }
  // The timeline shows only what the viewer may know (review P1-S-01): nothing
  // about a document hidden from them, and nothing of the deliberation outside the panel.
  const visibleDocumentIds = new Set(file.documents.filter((d) => documentVisible(subject, snapshot, d.visibility, d.id)).map((d) => d.id));

  return {
    header: {
      id: file.id,
      nationalRef: file.nationalRef,
      number: { number: file.number, code: file.code, year: file.year },
      courtName: file.court.name,
      courtDegree: file.court.degree,
      panelName: file.panel?.name ?? null,
      kind: file.kind,
      caseType: file.caseType,
      subject: file.subject,
      status: file.status,
      nextHearing: file.nextHearing?.startsAt ?? null,
      rapporteurName: file.rapporteur?.fullName ?? null,
    },
    timeline: events
      .filter((e) => timelineVisible(e.action, e.details, visibleDocumentIds, panelSide))
      .filter((e) => e.action !== 'case.note.added' || notesKnown)
      .map((e) => ({
      seq: e.seq.toString(),
      action: e.action,
      detailAction: typeof (e.details as { action?: unknown }).action === 'string' ? ((e.details as { action: string }).action) : null,
      occurredAt: e.occurredAt,
      actorRole: e.actorRole,
      articles: isLawBasis(e.legalBasis) ? e.legalBasis.articles : [],
      // How many referrals the review found: «ولم يجد موجبا للإحالة» when none (study, «المرحلة الثانية»).
      referrals: e.action === 'case.referrals.reviewed' && typeof (e.details as { referrals?: unknown }).referrals === 'number' ? (e.details as { referrals: number }).referrals : null,
    })),
    documents: file.documents
      .filter((d) => documentVisible(subject, snapshot, d.visibility, d.id))
      .map((d) => ({
        id: d.id,
        docType: d.docType,
        title: d.title,
        declaredNature: d.declaredNature,
        channel: d.channel,
        depositor: d.depositedByPartyId ? (partyName.get(d.depositedByPartyId) ?? null) : null,
        depositedAt: d.depositedAt,
        generated: d.generated,
        simulated: d.simulated,
        withdrawn: d.withdrawnAt !== null,
        signatures: d.circles.reduce((n, c) => n + c.signatures.length, 0),
        simulatedSignature: d.circles.some((c) => c.signatures.some((s) => s.provider === 'SIMULATED')),
      })),
    parties: file.parties.map((p) => ({
      id: p.id,
      side: p.side,
      personKind: p.personKind,
      displayName: p.displayName,
      legalForm: p.legalForm,
      legalRepresentative: p.legalRepresentative,
      idNumber: seesContacts || ownParty(p) ? p.idNumber : null,
      counsel: p.representations.map((r) => r.lawyer.fullName),
      addresses: p.addresses
        .filter((a) => seesContacts || ownParty(p) || !PRIVATE_ADDRESS_KINDS.has(a.kind))
        .map((a) => ({ kind: a.kind, value: a.value, source: a.source })),
      eServiceAcceptedAt: p.eServiceAcceptedAt,
    })),
    notes: file.notes.filter(notesVisible).map((n) => ({ id: n.id, reason: n.reason, text: n.text, createdAt: n.createdAt, authorRole: n.authorRole })),
    claims: file.claims.map((c) => ({
      id: c.id,
      category: c.category,
      nature: c.nature,
      amountCents: c.amountCents,
      party: c.partyId ? (partyName.get(c.partyId) ?? null) : null,
    })),
    services: file.envelopes.map((e) => ({
      id: e.id,
      party: partyName.get(e.partyId) ?? '',
      purpose: e.purpose,
      channel: e.channel,
      status: e.status,
      dispatchedAt: e.dispatchedAt,
      servedAt: e.servedAt,
      deemedServedAt: e.deemedServedAt,
      proof: e.certificate ? 'CERTIFICATE' : e.receipt ? 'RECEIPT_NOTICE' : null,
    })),
    deadlines: file.timeLimits.map((t) => {
      const rule = rules?.rules.find((r) => r.code === t.ruleCode);
      return {
        id: t.id,
        ruleCode: t.ruleCode,
        party: t.partyId ? (partyName.get(t.partyId) ?? null) : null,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        lastDay: t.lastDay,
        status: t.status,
        uncertain: computationUncertain(t.computation),
        articles: rule?.articles ?? [],
      };
    }),
    payments: {
      fees: file.fees.map((f) => ({
        id: f.id,
        filing: f.filing,
        totalCents: f.totalCents,
        assessedAt: f.assessedAt,
        // Read from the assessment as it was stored, as everywhere the amount is shown (independent review IR-26).
        uncertain: storedFeeUncertain(f.breakdown),
      })),
      payments: file.payments.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        amountCents: p.amountCents,
        status: p.status,
        operationRef: p.operationRef,
        paidAt: p.paidAt,
      })),
      treasury: file.treasury.map((e) => ({ id: e.id, direction: e.direction, purpose: e.purpose, amountCents: e.amountCents, at: e.at })),
    },
    // A judgment not yet pronounced exists only for the panel (and for the
    // clerk whose turn it is to sign, through the document itself).
    decisions: file.decisions
      .filter((d) => d.pronouncedAt !== null || !['JUDGMENT', 'APPELLATE_DECISION'].includes(d.kind) || panelSide)
      .map((d) => ({ id: d.id, kind: d.kind, subjectCode: d.subjectCode, issuedAt: d.issuedAt, pronouncedAt: d.pronouncedAt, final: d.final })),
  };
}

const PRIVATE_ADDRESS_KINDS: ReadonlySet<string> = new Set(['ELECTRONIC', 'PHONE']);

/**
 * «قيمة مؤقتة غير مؤكدة» for a stored time limit, from what its computation
 * relied on as recorded with it (review P1-A-09), not from the rule table in
 * force today. A computation that does not record it is shown uncertain.
 */
export function computationUncertain(computation: unknown): boolean {
  const uncertainties = (typeof computation === 'object' && computation !== null ? computation : {}) as { uncertainties?: unknown };
  return !Array.isArray(uncertainties.uncertainties) || uncertainties.uncertainties.length > 0;
}

function isLawBasis(value: unknown): value is { kind: 'LAW'; articles: number[] } {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'LAW' && Array.isArray((value as { articles?: unknown }).articles);
}

/** Access records: kept in the event log, never shown on the file's timeline. */
const ACCESS_RECORDS: ReadonlySet<string> = new Set(['document.downloaded', 'signature.verified']);
/** Acts of the deliberation, secret until pronouncement (art. 108): the panel's alone. */
const DELIBERATION_ACTS: ReadonlySet<string> = new Set(['case.deliberation.open', 'case.judgment.draft', 'case.judgment.sign', 'case.judgment.sign-substitute']);

export function timelineVisible(action: string, details: unknown, visibleDocumentIds: ReadonlySet<string>, panelSide: boolean): boolean {
  if (ACCESS_RECORDS.has(action)) return false;
  const d = (typeof details === 'object' && details !== null ? details : {}) as { documentId?: unknown; action?: unknown };
  if (typeof d.documentId === 'string' && !visibleDocumentIds.has(d.documentId)) return false;
  if (action === 'case.transition.recorded' && typeof d.action === 'string' && DELIBERATION_ACTS.has(d.action) && !panelSide) return false;
  return true;
}
