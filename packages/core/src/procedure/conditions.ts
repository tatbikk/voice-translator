// The vocabulary of the declarative action table (transitions.ts): who holds
// an action in relation to the file, and under which conditions. Each term is
// a pure predicate on the snapshot, the subject and the platform time.
import type { RoleCode } from '../roles';
import type { UserSubject } from '../subject';
import type { CaseFact, CaseSnapshot, DeadlineCode, EnvelopeFact, EnvelopeSnapshot, PartyFact, PartySide, PartySnapshot, RunningDeadline } from './snapshot';

/** The relation a subject must have with the file. */
export type Relation =
  /** a lawyer representing a party of the file */
  | 'COUNSEL'
  /** a lawyer not yet representing anyone, who presented the summons code */
  | 'SUMMONS_HOLDER'
  /** the judge or counsellor in charge of preparing the file */
  | 'RAPPORTEUR'
  /** a member of the file's panel (president, member) */
  | 'PANEL'
  /** an official of the court before which the file is pending */
  | 'COURT_STAFF'
  /** the prosecution, once the file was referred to it */
  | 'PROSECUTION'
  /** the royal commissioner, once a copy of the application was handed to him (art. 101) */
  | 'COMMISSIONER'
  /** the expert appointed in the file */
  | 'EXPERT'
  /** a party with its own account that accepted electronic service */
  | 'LITIGANT'
  /** the institutional account of a public-law party */
  | 'ADMIN_PARTY'
  /** the garnishee bank of the file */
  | 'GARNISHEE'
  /** whose turn it is in the judgment's signature circle */
  | 'NEXT_SIGNER'
  /** whose turn it is to sign the hearing minutes */
  | 'MINUTES_SIGNER'
  /** a lawyer admitted before the Court of Cassation */
  | 'CASSATION_ACCREDITED'
  /** the bailiff the envelope is assigned to */
  | 'AGENT';

export interface Holder {
  readonly roles: readonly RoleCode[];
  /** all of them must hold */
  readonly relations: readonly Relation[];
}

export type DeadlineState =
  /** running, and not yet elapsed */
  | 'OPEN'
  /** elapsed without being met */
  | 'ELAPSED'
  /** open, or not started yet */
  | 'NOT_ELAPSED';

export interface PartyCondition {
  readonly sides?: readonly PartySide[];
  readonly facts?: readonly PartyFact[];
  readonly notFacts?: readonly PartyFact[];
  readonly deadline?: { readonly code: DeadlineCode; readonly state: DeadlineState };
  readonly anyOf?: readonly PartyCondition[];
}

export type Condition =
  | { readonly fact: CaseFact }
  | { readonly notFact: CaseFact }
  | { readonly anyOf: readonly Condition[] }
  | { readonly deadline: DeadlineCode; readonly state: DeadlineState }
  /** at least one party represented by the subject (or the subject's own party) */
  | { readonly clientParty: PartyCondition }
  /** at least one party of the file */
  | { readonly anyParty: PartyCondition }
  | { readonly rapporteur: 'ASSIGNED' | 'NONE' }
  | { readonly administrativeCourt: true };

export type EnvelopeCondition =
  | { readonly purpose: EnvelopeSnapshot['purpose'] }
  | { readonly envelopeStatus: EnvelopeSnapshot['status'] }
  | { readonly envelopeFact: EnvelopeFact }
  | { readonly notEnvelopeFact: EnvelopeFact }
  | { readonly envelopeDeadline: DeadlineCode; readonly state: DeadlineState };

const RAPPORTEUR_ROLES: readonly RoleCode[] = ['JUDGE_RAPPORTEUR', 'JUDGE_IN_CHARGE', 'COUNSELLOR_RAPPORTEUR'];

/**
 * The roles that sit on a panel: its president and members, and the judges who
 * prepare its files. Only they hold the PANEL relation, whatever panel another
 * role assignment may carry (review P1-S-12).
 */
export const PANEL_ROLES: readonly RoleCode[] = ['PANEL_PRESIDENT', 'PANEL_MEMBER', ...RAPPORTEUR_ROLES];

export function deadlineState(
  deadlines: readonly RunningDeadline[],
  code: DeadlineCode,
  partyId: string | null,
  now: Date,
): 'OPEN' | 'ELAPSED' | 'CLOSED' | 'ABSENT' {
  const matching = deadlines.filter((d) => d.code === code && d.partyId === partyId);
  if (matching.length === 0) return 'ABSENT';
  const states = matching.map((d) => {
    const status = d.status ?? 'RUNNING';
    if (status === 'ELAPSED') return 'ELAPSED';
    if (status === 'MET' || status === 'CLOSED') return 'CLOSED';
    return d.endsAt.getTime() > now.getTime() ? 'OPEN' : 'ELAPSED';
  });
  if (states.includes('OPEN')) return 'OPEN';
  if (states.includes('ELAPSED')) return 'ELAPSED';
  return 'CLOSED';
}

function deadlineMatches(actual: 'OPEN' | 'ELAPSED' | 'CLOSED' | 'ABSENT', wanted: DeadlineState): boolean {
  if (wanted === 'OPEN') return actual === 'OPEN';
  if (wanted === 'ELAPSED') return actual === 'ELAPSED';
  // NOT_ELAPSED: open, or not started yet; a limit met or closed grants nothing more.
  return actual === 'OPEN' || actual === 'ABSENT';
}

/** The parties the subject acts for: those it represents, or its own. */
export function clientParties(subject: UserSubject, snapshot: CaseSnapshot): readonly PartySnapshot[] {
  return snapshot.parties.filter((p) => p.counselUserIds.includes(subject.userId) || p.litigantUserId === subject.userId);
}

export function holdsRelation(subject: UserSubject, snapshot: CaseSnapshot, relation: Relation): boolean {
  const user = subject.userId;
  switch (relation) {
    case 'COUNSEL':
      return subject.role === 'LAWYER' && snapshot.parties.some((p) => p.counselUserIds.includes(user));
    case 'SUMMONS_HOLDER':
      return (
        subject.role === 'LAWYER' &&
        snapshot.summonsCodeHolderUserIds.includes(user) &&
        !snapshot.parties.some((p) => p.counselUserIds.includes(user))
      );
    case 'RAPPORTEUR':
      return RAPPORTEUR_ROLES.includes(subject.role) && snapshot.rapporteurUserId === user && subject.courtId === snapshot.courtId;
    case 'PANEL':
      return (
        PANEL_ROLES.includes(subject.role) &&
        snapshot.panelId !== null &&
        subject.panelId === snapshot.panelId &&
        subject.courtId === snapshot.courtId
      );
    case 'COURT_STAFF':
      return subject.courtId !== null && subject.courtId === snapshot.courtId;
    case 'PROSECUTION':
      return subject.courtId === snapshot.courtId && snapshot.facts.includes('REFERRED_TO_PROSECUTION');
    case 'COMMISSIONER':
      return (
        subject.role === 'ROYAL_COMMISSIONER' &&
        subject.courtId !== null &&
        subject.courtId === snapshot.courtId &&
        snapshot.administrativeCourt &&
        snapshot.facts.includes('REFERRED_TO_COMMISSIONER')
      );
    case 'EXPERT':
      return snapshot.expertUserId === user;
    case 'LITIGANT':
      return snapshot.parties.some((p) => p.litigantUserId === user && p.facts.includes('E_SERVICE_ACCEPTED'));
    case 'ADMIN_PARTY':
      return subject.organizationId !== null && snapshot.parties.some((p) => p.organizationId === subject.organizationId);
    case 'GARNISHEE':
      return subject.organizationId !== null && snapshot.garnisheeOrganizationIds.includes(subject.organizationId);
    case 'NEXT_SIGNER':
      return snapshot.nextSignerUserIds.includes(user);
    case 'MINUTES_SIGNER':
      return snapshot.minutesNextSignerUserIds.includes(user);
    case 'CASSATION_ACCREDITED':
      return snapshot.cassationAccreditedUserIds.includes(user);
    case 'AGENT':
      return false;
  }
}

function partyMatches(party: PartySnapshot, condition: PartyCondition, snapshot: CaseSnapshot, now: Date): boolean {
  if (condition.sides && !condition.sides.includes(party.side)) return false;
  if (condition.facts?.some((f) => !party.facts.includes(f))) return false;
  if (condition.notFacts?.some((f) => party.facts.includes(f))) return false;
  if (condition.deadline) {
    const actual = deadlineState(snapshot.deadlines, condition.deadline.code, party.partyId, now);
    if (!deadlineMatches(actual, condition.deadline.state)) return false;
  }
  if (condition.anyOf && !condition.anyOf.some((c) => partyMatches(party, c, snapshot, now))) return false;
  return true;
}

export function conditionHolds(condition: Condition, subject: UserSubject, snapshot: CaseSnapshot, now: Date): boolean {
  if ('fact' in condition) return snapshot.facts.includes(condition.fact);
  if ('notFact' in condition) return !snapshot.facts.includes(condition.notFact);
  if ('anyOf' in condition) return condition.anyOf.some((c) => conditionHolds(c, subject, snapshot, now));
  if ('deadline' in condition) return deadlineMatches(deadlineState(snapshot.deadlines, condition.deadline, null, now), condition.state);
  if ('clientParty' in condition) return clientParties(subject, snapshot).some((p) => partyMatches(p, condition.clientParty, snapshot, now));
  if ('anyParty' in condition) return snapshot.parties.some((p) => partyMatches(p, condition.anyParty, snapshot, now));
  if ('rapporteur' in condition) return (snapshot.rapporteurUserId !== null) === (condition.rapporteur === 'ASSIGNED');
  return snapshot.administrativeCourt;
}

export function envelopeConditionHolds(condition: EnvelopeCondition, envelope: EnvelopeSnapshot, now: Date): boolean {
  if ('purpose' in condition) return envelope.purpose === condition.purpose;
  if ('envelopeStatus' in condition) return envelope.status === condition.envelopeStatus;
  if ('envelopeFact' in condition) return envelope.facts.includes(condition.envelopeFact);
  if ('notEnvelopeFact' in condition) return !envelope.facts.includes(condition.notEnvelopeFact);
  return deadlineMatches(deadlineState(envelope.deadlines, condition.envelopeDeadline, null, now), condition.state);
}
