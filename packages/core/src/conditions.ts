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
  | 'SUBJECT_RELATED_TO_CASE';

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
  SUBJECT_RELATED_TO_CASE: {
    // Phase 0 has no relation between users and case files yet: always false.
    // Phase 1 replaces this by the real relation (party, counsel, assigned judge…).
    onFail: 'NOT_FOUND',
    test: (subject, resource) =>
      subject.kind === 'user' && resource?.kind === 'case' && resource.relatedUserIds.includes(subject.userId),
  },
};
