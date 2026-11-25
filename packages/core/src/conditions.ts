// Named, pure predicates used by the action table. A failed condition maps to
// the refusal reason the caller sees: ownership failures answer "not found" so
// that a refusal never reveals that a resource exists.
import type { AuthorizationContext, Resource, Subject } from './subject';

export type ConditionCode =
  | 'RESOURCE_OWNED_BY_SUBJECT'
  | 'HAS_MULTIPLE_ROLES'
  | 'DEMO_TOOLS_ENABLED'
  | 'TARGET_IS_DEMO_ACCOUNT'
  | 'TARGET_NOT_ACTIVATED'
  | 'TARGET_NOT_DISABLED'
  | 'DEMO_MODE'
  | 'DRAFT_OWNED_BY_SUBJECT'
  | 'DRAFT_OPEN'
  | 'DRAFT_PAID'
  | 'DRAFT_NOT_PAID'
  | 'INTENT_OWNED_BY_SUBJECT'
  | 'INTENT_PENDING';

export type ConditionFailure = 'NOT_FOUND' | 'CONDITION_NOT_MET' | 'MODE_NOT_PERMITTED';

interface ConditionDefinition {
  readonly onFail: ConditionFailure;
  readonly test: (subject: Subject, resource: Resource | undefined, context: AuthorizationContext) => boolean;
}

export const CONDITIONS: Readonly<Record<ConditionCode, ConditionDefinition>> = {
  RESOURCE_OWNED_BY_SUBJECT: {
    onFail: 'NOT_FOUND',
    test: (subject, resource) =>
      subject.kind === 'user' && resource?.kind === 'notification' && resource.ownerUserId === subject.userId,
  },
  HAS_MULTIPLE_ROLES: {
    onFail: 'CONDITION_NOT_MET',
    test: (subject) => subject.kind === 'user' && subject.roleCount > 1,
  },
  DEMO_TOOLS_ENABLED: {
    onFail: 'MODE_NOT_PERMITTED',
    test: (_subject, _resource, context) => context.mode === 'demo' && context.demoToolsEnabled,
  },
  TARGET_IS_DEMO_ACCOUNT: {
    // A non-demo account is answered exactly like an unknown one.
    onFail: 'NOT_FOUND',
    test: (_subject, resource) => resource?.kind === 'demo-account' && resource.isDemo,
  },
  TARGET_NOT_ACTIVATED: {
    onFail: 'CONDITION_NOT_MET',
    test: (_subject, resource) => resource?.kind === 'account' && !resource.activated,
  },
  TARGET_NOT_DISABLED: {
    onFail: 'CONDITION_NOT_MET',
    test: (_subject, resource) => resource?.kind === 'account' && !resource.disabled,
  },
  DEMO_MODE: {
    // The page «مكونات بيئة العرض» exists in the demo environment only.
    onFail: 'MODE_NOT_PERMITTED',
    test: (_subject, _resource, context) => context.mode === 'demo',
  },
  DRAFT_OWNED_BY_SUBJECT: {
    // A filing draft is its author's alone (Phase 2 memo, row 2): a lawyer's
    // electronic draft, or a registry clerk's paper draft at the clerk's court.
    // Anyone else meets a draft that does not exist.
    onFail: 'NOT_FOUND',
    test: (subject, resource) => {
      if (subject.kind !== 'user' || resource?.kind !== 'filing-draft' || resource.ownerUserId !== subject.userId) return false;
      if (resource.channel === 'ELECTRONIC') return subject.role === 'LAWYER';
      return subject.role === 'CLERK_REGISTRATION' && subject.courtId !== null && subject.courtId === resource.courtId;
    },
  },
  DRAFT_OPEN: {
    onFail: 'CONDITION_NOT_MET',
    test: (_subject, resource) => resource?.kind === 'filing-draft' && resource.status === 'DRAFT',
  },
  DRAFT_PAID: {
    // «لا يتم الإيداع بلا أداء» (prompt, «الأداء»; Phase 2 memo, row 3).
    onFail: 'CONDITION_NOT_MET',
    test: (_subject, resource) => resource?.kind === 'filing-draft' && resource.paid,
  },
  DRAFT_NOT_PAID: {
    onFail: 'CONDITION_NOT_MET',
    test: (_subject, resource) => resource?.kind === 'filing-draft' && !resource.paid,
  },
  INTENT_OWNED_BY_SUBJECT: {
    onFail: 'NOT_FOUND',
    test: (subject, resource) => subject.kind === 'user' && resource?.kind === 'payment-intent' && resource.ownerUserId === subject.userId,
  },
  INTENT_PENDING: {
    onFail: 'CONDITION_NOT_MET',
    test: (_subject, resource) => resource?.kind === 'payment-intent' && resource.status === 'PENDING',
  },
};
