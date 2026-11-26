// Closed catalogue of event-log entries (contract §4.3). The event log can never
// be edited or erased, so what enters it is constrained here: details hold only
// identifiers, hashes, counts, enumerated codes, booleans and timestamps. No free
// text, no e-mail, no name, no phone number, no code, no token.
import { z } from 'zod';
import { NOTE_REASONS } from './procedure/notes';

export type EventOutcome = 'DONE' | 'DENIED' | 'FAILED';

const id = z.uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const code = z.string().regex(/^[A-Za-z0-9_.:\-/[\]]{1,96}$/);
/**
 * The referrals of a file, each TARGET/GROUND/article/item joined by «:». A file
 * can carry three at once (arts. 18, 20 and 101), longer than one code (fix of the
 * verification of the review fixes): its own bound, from the same characters.
 */
const groundsList = z.string().regex(/^[A-Za-z0-9_.:\-/]{1,400}$/);
const iso = z.iso.datetime({ offset: false, precision: 3 });
const roleCode = z.string().regex(/^[A-Z_]{2,40}$/);
/** Fact codes of the core (CaseFact), joined by «:». */
const factCodes = z.string().regex(/^[A-Z_]{2,40}(:[A-Z_]{2,40}){0,19}$/);

const detailsOf = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

/** The kinds of dated rule tables (rules/*.json). */
export const RULE_KINDS = ['TIME_LIMITS', 'FEES', 'HOLIDAYS', 'INTEREST', 'CASE_TYPES', 'DISTRICTS', 'REFERRALS', 'JURISDICTION'] as const;

const channel = z.enum(['ELECTRONIC', 'PAPER']);
const draftDocumentKind = z.enum(['APPLICATION_ORIGINAL', 'APPLICATION_COPY', 'EXHIBIT', 'PAYMENT_RECEIPT']);

export const EVENT_TYPES = {
  'access.code.accepted': { outcome: 'DONE', details: detailsOf({}) },
  'access.code.rejected': { outcome: 'DENIED', details: detailsOf({}) },
  'access.code.blocked': { outcome: 'DENIED', details: detailsOf({ scope: z.enum(['client', 'global']) }) },
  'access.denied': {
    outcome: 'DENIED',
    details: detailsOf({
      step: z.enum(['GATE', 'MODE', 'CSRF', 'SESSION', 'RATE', 'PARAMS', 'AUTHZ', 'REAUTH', 'BODY', 'METHOD']),
      reason: code,
      target: code,
    }),
  },
  'access.throttled': {
    outcome: 'DENIED',
    details: detailsOf({ scope: z.enum(['client', 'session', 'global']), suppressedCount: count, windowStart: iso }),
  },
  'auth.login.succeeded': { outcome: 'DONE', details: detailsOf({ identifierHash: hash }) },
  'auth.login.failed': {
    outcome: 'DENIED',
    details: detailsOf({ identifierHash: hash, reason: z.enum(['INVALID_CREDENTIALS']) }),
  },
  'auth.login.blocked': {
    outcome: 'DENIED',
    details: detailsOf({ identifierHash: hash, bucket: z.enum(['default', 'device']) }),
  },
  'auth.login.throttled': { outcome: 'DENIED', details: detailsOf({}) },
  'auth.second-factor.issued': { outcome: 'DONE', details: detailsOf({ challengeId: id }) },
  'auth.second-factor.failed': { outcome: 'DENIED', details: detailsOf({ remaining: count }) },
  'auth.second-factor.succeeded': { outcome: 'DONE', details: detailsOf({}) },
  'auth.second-factor.refused': {
    outcome: 'DENIED',
    details: detailsOf({ reason: z.enum(['ISSUANCE_CAP', 'LOCKED', 'EXPIRED']) }),
  },
  'auth.account.locked': {
    outcome: 'DONE',
    details: detailsOf({
      cause: z.enum(['PASSWORD', 'SECOND_FACTOR', 'REAUTH']),
      bucket: z.enum(['default', 'device']),
      until: iso,
      /** whether the account holder was told; false past the daily cap of notices (review S-08) */
      notified: z.boolean(),
    }),
  },
  'auth.role.selected': { outcome: 'DONE', details: detailsOf({ roleAssignmentId: id, role: roleCode }) },
  'auth.logout': { outcome: 'DONE', details: detailsOf({}) },
  'auth.session.expired': { outcome: 'DONE', details: detailsOf({ kind: z.enum(['IDLE', 'ABSOLUTE', 'PENDING']) }) },
  'auth.session.revoked': {
    outcome: 'DONE',
    details: detailsOf({
      cause: z.enum([
        'USER_DISABLED',
        'ROLE_REVOKED',
        'NEW_LOGIN',
        'DEMO_SWITCH',
        'REAUTH_LOCK',
        'SECOND_FACTOR_LOCK',
        'LOGOUT',
      ]),
    }),
  },
  'auth.reauth.succeeded': { outcome: 'DONE', details: detailsOf({}) },
  'auth.reauth.failed': { outcome: 'DENIED', details: detailsOf({}) },
  'auth.reauth.blocked': { outcome: 'DENIED', details: detailsOf({ bucket: z.enum(['default', 'device']) }) },
  'account.activated': { outcome: 'DONE', details: detailsOf({ userId: id }) },
  'account.activation.failed': {
    outcome: 'DENIED',
    details: detailsOf({ reason: z.enum(['INVALID_TOKEN', 'PASSWORD_POLICY', 'THROTTLED']) }),
  },
  'admin.account.created': {
    outcome: 'DONE',
    details: detailsOf({
      newUserId: id,
      role: roleCode,
      courtId: id.nullable(),
      requestReferenceHash: hash,
    }),
  },
  /** a role added to an account that already existed (review A-18) */
  'admin.role.granted': {
    outcome: 'DONE',
    details: detailsOf({
      userId: id,
      role: roleCode,
      courtId: id.nullable(),
      requestReferenceHash: hash,
    }),
  },
  'admin.account.activation-reissued': { outcome: 'DONE', details: detailsOf({ userId: id }) },
  'notification.read': { outcome: 'DONE', details: detailsOf({ notificationId: id }) },
  'preferences.updated': {
    outcome: 'DONE',
    details: detailsOf({
      locale: z.enum(['ar', 'fr', 'zgh']).nullable(),
      readingSize: z.number().int().min(0).max(2).nullable(),
      readingContrast: z.number().int().min(0).max(1).nullable(),
    }),
  },
  'demo.account.switched': { outcome: 'DONE', details: detailsOf({ fromUserId: id.nullable(), toUserId: id }) },
  'demo.outbox.viewed': { outcome: 'DONE', details: detailsOf({ count }) },
  'demo.data.seeded': { outcome: 'DONE', details: detailsOf({ users: count, caseFiles: count }) },
  /** review IR-40: a demo file seeded with a name in place of a case-type code gets the code */
  // The code inside the number goes with the type (review of IR-40); events written before carry the type alone.
  'demo.case.type.recoded': { outcome: 'DONE', details: detailsOf({ caseFileId: id, fromType: code, toType: code, fromCode: count.exactOptional(), toCode: count.exactOptional() }) },
  'demo.data.reset': {
    outcome: 'DONE',
    details: detailsOf({ previousHeadSeq: count.nullable(), previousHeadHash: hash.nullable() }),
  },
  'rules.loaded': {
    outcome: 'DONE',
    details: detailsOf({ kind: z.enum(RULE_KINDS), version: code, contentSha256: hash }),
  },
  'document.stored': {
    outcome: 'DONE',
    details: detailsOf({ documentId: id, sha256: hash, byteSize: count, generated: z.boolean(), docType: code }),
  },
  'document.downloaded': { outcome: 'DONE', details: detailsOf({ documentId: id }) },
  /** the stored bytes no longer have the document's hash: nothing is served (review P1-S-11) */
  'document.integrity.failed': { outcome: 'FAILED', details: detailsOf({ documentId: id, currentSha256: hash }) },
  'document.generation.failed': { outcome: 'FAILED', details: detailsOf({ template: code, errorClass: code }) },
  'signature.secret.set': { outcome: 'DONE', details: detailsOf({ userId: id }) },
  'signature.circle.opened': {
    outcome: 'DONE',
    details: detailsOf({ circleId: id, documentId: id, documentSha256: hash, signers: count, purpose: code }),
  },
  'signature.signed': {
    outcome: 'DONE',
    details: detailsOf({ circleId: id, documentId: id, position: count, documentSha256: hash, provider: code }),
  },
  'signature.refused': {
    outcome: 'DENIED',
    details: detailsOf({ circleId: id, reason: z.enum(['NOT_YOUR_TURN', 'CIRCLE_CLOSED', 'INVALID_SECRET', 'LOCKED', 'NO_SECRET']) }),
  },
  'signature.circle.completed': { outcome: 'DONE', details: detailsOf({ circleId: id, documentId: id }) },
  'signature.circle.voided': {
    outcome: 'DONE',
    details: detailsOf({ circleId: id, documentId: id, reason: z.enum(['DOCUMENT_CHANGED']), currentSha256: hash }),
  },
  'signature.verified': {
    outcome: 'DONE',
    details: detailsOf({ documentId: id, valid: count, changed: count }),
  },
  'case.action.not-executed': { outcome: 'DENIED', details: detailsOf({ action: code }) },

  // Phase 2: the filing path. Details never hold the card's content: names,
  // numbers and addresses stay in the draft and the file (memo row 25).
  'filing.draft.created': { outcome: 'DONE', details: detailsOf({ draftId: id, channel }) },
  /** fields: the names of the parts changed, joined by «:» (CASE_TYPE, COURT, LOCALITY, CARD, ATTESTATION, BAILIFF, DEPOSITOR, LAWYER, APPLICATION_MODE) */
  'filing.draft.updated': {
    outcome: 'DONE',
    details: detailsOf({ draftId: id, fields: z.string().regex(/^[A-Z_]{2,20}(:[A-Z_]{2,20}){0,9}$/) }),
  },
  'filing.application.pasted': { outcome: 'DONE', details: detailsOf({ draftId: id, paragraphs: count, characters: count }) },
  'filing.document.uploaded': {
    outcome: 'DONE',
    details: detailsOf({ draftId: id, documentId: id, kind: draftDocumentKind, mediaType: code, sha256: hash, byteSize: count }),
  },
  'filing.document.updated': { outcome: 'DONE', details: detailsOf({ draftId: id, documentId: id, removed: z.boolean() }) },
  'filing.fixed-copy.prepared': { outcome: 'DONE', details: detailsOf({ draftId: id, documentId: id, sha256: hash, paragraphs: count }) },
  /** a request of the filing path refused for its content, not its access (the access refusals are access.denied) */
  'filing.refused': {
    outcome: 'DENIED',
    // documentId: the document asked for through the draft, when it is not one of the draft's (decision 77)
    details: detailsOf({ draftId: id.nullable(), documentId: id.exactOptional(), reason: code }),
  },
  'filing.submitted': { outcome: 'DONE', details: detailsOf({ draftId: id, caseFileId: id, channel }) },
  'filing.receipt.issued': { outcome: 'DONE', details: detailsOf({ caseFileId: id, documentId: id }) },
  /** «شهادة توقيع» printed beside the signed application, linked to it (independent review IR-07, decision 72) */
  'signature.certificate.issued': { outcome: 'DONE', details: detailsOf({ caseFileId: id, documentId: id, attestsDocumentId: id, circleId: id }) },
  'payment.intent.opened': {
    outcome: 'DONE',
    details: detailsOf({ intentId: id, draftId: id, amountCents: count, method: z.enum(['ONLINE', 'COUNTER']), ruleVersion: code }),
  },
  'payment.succeeded': { outcome: 'DONE', details: detailsOf({ intentId: id, paymentId: id, amountCents: count, operationRef: code }) },
  'payment.failed': { outcome: 'DONE', details: detailsOf({ intentId: id, paymentId: id }) },
  'payment.cancelled': { outcome: 'DONE', details: detailsOf({ intentId: id, paymentId: id }) },
  'payment.expired': { outcome: 'DONE', details: detailsOf({ intentId: id }) },
  'payment.receipt.issued': { outcome: 'DONE', details: detailsOf({ draftId: id, paymentId: id, documentId: id }) },
  'registers.commercial.looked-up': { outcome: 'DONE', details: detailsOf({ found: z.boolean() }) },
  /** with the version of the districts table each address was placed by, within or outside the court's district (independent review IR-08) */
  'case.registered': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, draftId: id, number: count, code: count, year: count, channel, districtsVersion: code }),
  },
  /**
   * Recorded even when no referral is due (study, «المرحلة الثانية»): the number
   * of referrals, and each as TARGET/GROUND/article/item, joined by «:» (NONE when none).
   */
  'case.referrals.reviewed': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, ruleVersion: code, referrals: count, grounds: groundsList }),
  },
  'case.registration.stamped': { outcome: 'DONE', details: detailsOf({ caseFileId: id }) },
  'case.registration.reclassified': { outcome: 'DONE', details: detailsOf({ caseFileId: id, fromCode: count, toCode: count }) },
  'case.note.added': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, noteId: id, reason: z.enum(NOTE_REASONS) }),
  },
  'case.document.filed': { outcome: 'DONE', details: detailsOf({ caseFileId: id, documentId: id, action: code }) },
  /** an executor found the file changed since its authorization (a race), or the input invalid */
  'case.action.refused': { outcome: 'DENIED', details: detailsOf({ caseFileId: id, action: code, reason: code }) },
  /** the declared next status of an act, applied by the applier (independent review IR-10); in the demo data, the seeded history */
  'case.transition.recorded': {
    outcome: 'DONE',
    details: detailsOf({ action: code, fromStatus: code, toStatus: code }),
  },
  /** the facts an act declares (transitions.ts «sets»), established by the applier (decision 73), joined by «:» */
  'case.facts.set': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, action: code, facts: factCodes }),
  },
  /** the stored facts an act ends (transitions.ts «clears», review of the fix), retracted by the applier, joined by «:» */
  'case.facts.cleared': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, action: code, facts: factCodes }),
  },
  /**
   * a time limit an act opens (transitions.ts «opens»), computed with the time-limit table in force on the
   * day of its trigger and the calendar in force on the day of the computation (decision 73)
   */
  'case.time-limit.opened': {
    outcome: 'DONE',
    details: detailsOf({
      caseFileId: id,
      timeLimitId: id,
      action: code,
      ruleCode: code,
      ruleVersion: code,
      calendarVersion: code,
      partyId: id.nullable(),
      lastDay: z.iso.date(),
      uncertain: z.boolean(),
    }),
  },
  /** a running time limit an act meets: the act it awaited, done within it (transitions.ts «meets») */
  'case.time-limit.met': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, timeLimitId: id, action: code, ruleCode: code }),
  },
  /** a running time limit an act ends without meeting it (transitions.ts «closes») */
  'case.time-limit.closed': {
    outcome: 'DONE',
    details: detailsOf({ caseFileId: id, timeLimitId: id, action: code, ruleCode: code }),
  },
  'events.chain.verified': {
    outcome: 'DONE',
    details: detailsOf({ headSeq: count, mode: z.enum(['INCREMENTAL', 'FULL']) }),
  },
  'events.chain.broken': {
    outcome: 'FAILED',
    details: detailsOf({ brokenAtSeq: count, reason: code }),
  },
  /** a rule table loaded open-ended receives its end date, nothing else changed (load-rules, review P1-A-18) */
  'rules.closed': {
    outcome: 'DONE',
    details: detailsOf({ kind: code, version: code, validTo: z.iso.date(), previousSha256: hash, contentSha256: hash }),
  },
  'system.boot': {
    outcome: 'DONE',
    details: detailsOf({ mode: z.enum(['demo', 'production']), simulatedComponents: count, process: z.enum(['web', 'worker']) }),
  },
} as const satisfies Record<string, { outcome: EventOutcome; details: z.ZodType }>;

export type EventAction = keyof typeof EVENT_TYPES;
export type EventDetails<A extends EventAction> = z.infer<(typeof EVENT_TYPES)[A]['details']>;

export function isEventAction(value: unknown): value is EventAction {
  return typeof value === 'string' && Object.hasOwn(EVENT_TYPES, value);
}

export class EventValidationError extends Error {
  constructor(readonly action: string, readonly issues: readonly string[]) {
    super(`invalid details for event ${action}: ${issues.join('; ')}`);
    this.name = 'EventValidationError';
  }
}

/** Validates the details of an event against its schema; unknown keys are refused. */
export function validateEventDetails<A extends EventAction>(action: A, details: unknown): EventDetails<A> {
  if (!isEventAction(action)) throw new EventValidationError(String(action), ['unknown event action']);
  const result = EVENT_TYPES[action].details.safeParse(details);
  if (!result.success) {
    throw new EventValidationError(
      action,
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`),
    );
  }
  return result.data as EventDetails<A>;
}

export function eventOutcome(action: EventAction): EventOutcome {
  return EVENT_TYPES[action].outcome;
}
