// Closed catalogue of event-log entries (contract §4.3). The event log can never
// be edited or erased, so what enters it is constrained here: details hold only
// identifiers, hashes, counts, enumerated codes, booleans and timestamps. No free
// text, no e-mail, no name, no phone number, no code, no token.
import { z } from 'zod';

export type EventOutcome = 'DONE' | 'DENIED' | 'FAILED';

const id = z.uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const code = z.string().regex(/^[A-Za-z0-9_.:\-/[\]]{1,96}$/);
const iso = z.iso.datetime({ offset: false, precision: 3 });
const roleCode = z.string().regex(/^[A-Z_]{2,40}$/);

const detailsOf = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

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
    details: detailsOf({ scope: z.enum(['client', 'session']), suppressedCount: count, windowStart: iso }),
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
  'admin.account.activation-reissued': { outcome: 'DONE', details: detailsOf({ userId: id }) },
  'notification.read': { outcome: 'DONE', details: detailsOf({ notificationId: id }) },
  'demo.account.switched': { outcome: 'DONE', details: detailsOf({ fromUserId: id.nullable(), toUserId: id }) },
  'demo.outbox.viewed': { outcome: 'DONE', details: detailsOf({ count }) },
  'demo.data.seeded': { outcome: 'DONE', details: detailsOf({ users: count, caseFiles: count }) },
  'demo.data.reset': {
    outcome: 'DONE',
    details: detailsOf({ previousHeadSeq: count.nullable(), previousHeadHash: hash.nullable() }),
  },
  'events.chain.verified': {
    outcome: 'DONE',
    details: detailsOf({ headSeq: count, mode: z.enum(['INCREMENTAL', 'FULL']) }),
  },
  'events.chain.broken': {
    outcome: 'FAILED',
    details: detailsOf({ brokenAtSeq: count, reason: code }),
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
