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
  | 'DEMO_MODE';

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
};
