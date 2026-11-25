// The snapshot of a case file: what the core needs to know about it to decide
// which actions are available (study, «المسطرة آلة حالات»). The server builds
// it from the database for every request (src/server/cases/snapshot.ts); the
// core never reads the database, the clock or the request.
import type { CaseKind, CaseStatus } from './states';

/** Facts about the whole file, read from its data. */
export const CASE_FACTS = [
  'REGISTRATION_STAMPED',
  'REFERRED_TO_PROSECUTION',
  'REFERRED_TO_COMMISSIONER',
  'HEARING_SET',
  'HEARING_UPCOMING',
  'HEARING_IN_SESSION',
  'HEARING_HELD',
  'ENVELOPES_READY',
  'PAPER_CERTIFICATE_PENDING',
  'SERVICE_FAILED_ADDRESS',
  'ELECTRONIC_DOCUMENT',
  'INVESTIGATION_ONGOING',
  'INVESTIGATION_HELD',
  'DEPOSIT_MADE',
  'DEPOSIT_OTHER_AUTHORIZED',
  'MISSION_ACCEPTED',
  'MISSION_DECLINED',
  'EXPERT_PARTIES_SUMMONED',
  'ATTENDANCE_MINUTES_FILED',
  'REPORT_DEPOSITED',
  'REPORT_RETURNED',
  'FEE_STATEMENT_FILED',
  'FEES_ORDERED',
  'FEES_PAID',
  'MINUTES_RECORDED',
  'MINUTES_SIGNED',
  'JUDGMENT_DRAFTED',
  'SIGNATURE_CIRCLE_OPEN',
  'SIGNATURES_COMPLETE',
  'SIGNER_IMPEDED',
  'SINGLE_JUDGE',
  'PRONOUNCEMENT_DAY',
  'JUDGMENT_PRONOUNCED',
  'ACCOUNT_SERVICE_ANSWERED',
  'COPY_REQUEST_PENDING',
  'THIRD_PARTY_COPY_PENDING',
  'THIRD_PARTY_COPY_REFUSED',
  'DECISION_FINAL',
  'PROVISIONAL_ENFORCEMENT',
  'ENFORCEMENT_SUSPENDED',
  'COUNSELLOR_REPORT_FILED',
  'EXECUTORY_COPY_REQUESTED',
  'SECOND_EXECUTORY_COPY_REQUESTED',
  'ENFORCEMENT_REQUESTED',
  'DEMAND_ORDERED',
  'DEBTOR_REQUESTED_DELAY',
  'SETTLEMENT_OFFERED',
  'SETTLEMENT_ACCEPTED',
  'SETTLEMENT_REJECTED',
  'SETTLEMENT_APPROVED',
  'GARNISHMENT_MADE',
  'GARNISHMENT_NOTIFIED',
  'GARNISHEE_DECLARED',
  'GARNISHMENT_DISPUTED',
  'DISPUTE_RULED',
  'FUNDS_DELIVERED',
  'FUNDS_IN_TREASURY',
  'FUNDS_TRANSFERRED',
  'DIFFICULTY_RAISED',
  'DIFFICULTY_RULED',
  'PROVISIONAL_DIFFICULTY_FILED',
  'DEBT_SATISFIED',
  'RELEASE_ORDERED',
  'RELEASE_CONFIRMED',
] as const;
export type CaseFact = (typeof CASE_FACTS)[number];

/** Facts about one party. */
export const PARTY_FACTS = [
  'SERVED',
  'SERVICE_FAILED',
  'E_SERVICE_ACCEPTED',
  'DEPOSIT_DUE',
  'DEPOSIT_AUTHORIZED',
  'REMOTE_REQUESTED',
  'ATTENDED_PRONOUNCEMENT',
  'JUDGMENT_SERVED',
  'JUDGMENT_CREDITOR',
  'APPEALED',
  'HOLDS_EXECUTORY_COPY',
  'PAYMENT_DUE',
] as const;
export type PartyFact = (typeof PARTY_FACTS)[number];

export const PARTY_SIDES = [
  'PLAINTIFF',
  'DEFENDANT',
  'GUARANTOR',
  'APPELLANT',
  'RESPONDENT',
  'ENFORCEMENT_CREDITOR',
  'ENFORCEMENT_DEBTOR',
  'GARNISHEE',
] as const;
export type PartySide = (typeof PARTY_SIDES)[number];

/** Codes of the time limits of the rule table (rules/time-limits.json). */
export const DEADLINE_CODES = [
  'APPEAL',
  'CASSATION',
  'CURE_DEFECTS',
  'REPLY',
  'INVESTIGATION_DEPOSIT',
  'EXPERT_CHALLENGE',
  'CHALLENGE_RULING',
  'EXPERT_REPORT',
  'EXPERT_SUMMONS_NOTICE',
  'FEE_OBJECTION',
  'RETURN_TO_HEARING',
  'COUNSELLOR_PREPARATION',
  'DEEMED_SERVICE_AFTER_REFUSAL',
  'APPEARANCE_IN_DISTRICT',
  'APPEARANCE_IN_KINGDOM',
  'APPEARANCE_ABROAD',
  'APPEAL_TRANSMISSION',
  'JUDGMENT_SUBSTITUTE_SIGNATURE',
  'ENFORCEABILITY',
  'ENFORCEMENT_DEMAND',
  'COLLECTION_DEPOSIT',
  'EXECUTORY_SEIZURE',
  'GARNISHMENT_NOTICE',
  'GARNISHEE_DECLARATION',
  'GARNISHMENT_DISPUTE',
  'FUNDS_PAYMENT',
] as const;
export type DeadlineCode = (typeof DEADLINE_CODES)[number];

export interface PartySnapshot {
  readonly partyId: string;
  readonly side: PartySide;
  /** lawyers who currently represent the party */
  readonly counselUserIds: readonly string[];
  /** the litigant's own account, when the party has one */
  readonly litigantUserId: string | null;
  /** the institutional account of a public-law party */
  readonly organizationId: string | null;
  readonly facts: readonly PartyFact[];
}

export interface RunningDeadline {
  readonly code: DeadlineCode;
  /** the party the time limit runs against, or null for the file */
  readonly partyId: string | null;
  readonly endsAt: Date;
  /**
   * The status stored with the limit (default RUNNING, read against endsAt).
   * A limit recorded ELAPSED stays elapsed; one MET or CLOSED is neither open
   * nor elapsed, and grants nothing (review P1-S-02).
   */
  readonly status?: 'RUNNING' | 'MET' | 'ELAPSED' | 'CLOSED';
}

export interface CaseSnapshot {
  readonly caseFileId: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly courtId: string;
  readonly panelId: string | null;
  readonly administrativeCourt: boolean;
  readonly rapporteurUserId: string | null;
  readonly expertUserId: string | null;
  readonly facts: readonly CaseFact[];
  readonly parties: readonly PartySnapshot[];
  /** the time limits of the file that are not closed */
  readonly deadlines: readonly RunningDeadline[];
  /** who must sign the judgment now (the open circle's next signer) */
  readonly nextSignerUserIds: readonly string[];
  /** the documents whose open circle waits for one of nextSignerUserIds (review P1-S-03) */
  readonly nextSignerDocumentIds?: readonly string[];
  /** who must sign the hearing minutes now */
  readonly minutesNextSignerUserIds: readonly string[];
  /** banks holding a garnishment of this enforcement file */
  readonly garnisheeOrganizationIds: readonly string[];
  /** lawyers who presented the summons code of this file in this request */
  readonly summonsCodeHolderUserIds: readonly string[];
  /** lawyers admitted before the Court of Cassation (art. 376) */
  readonly cassationAccreditedUserIds: readonly string[];
}

export const ENVELOPE_FACTS = ['DEMAND_RECORDED', 'DEBTOR_REFUSED', 'AMOUNT_COLLECTED'] as const;
export type EnvelopeFact = (typeof ENVELOPE_FACTS)[number];

/** The envelope (الطي) a bailiff receives: the only part of a file the bailiff sees. */
export interface EnvelopeSnapshot {
  readonly envelopeId: string;
  readonly caseFileId: string;
  readonly purpose: 'SERVICE' | 'ENFORCEMENT';
  readonly agentUserId: string | null;
  readonly status: 'READY' | 'DISPATCHED' | 'IN_PROGRESS' | 'DONE';
  readonly facts: readonly EnvelopeFact[];
  readonly deadlines: readonly RunningDeadline[];
}
