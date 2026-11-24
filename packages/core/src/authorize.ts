// The single authorization function (contract §4.2). Deny by default: an
// unknown action, a missing subject, a role not listed or a failed condition is
// a refusal. The server calls it on every request; the interface only displays
// what availableActions() returns, which is derived from the same table.
import { ACTIONS, isActionCode, type ActionRule } from './actions';
import { CONDITIONS } from './conditions';
import type { RoleCode } from './roles';
import type { AuthorizationContext, Resource, Subject } from './subject';

export type DenyReason =
  | 'UNAUTHENTICATED'
  | 'ROLE_NOT_PERMITTED'
  | 'CONDITION_NOT_MET'
  | 'UNKNOWN_ACTION'
  | 'MODE_NOT_PERMITTED'
  | 'NOT_FOUND';

export type Decision =
  | { readonly allowed: true; readonly rule: ActionRule }
  | { readonly allowed: false; readonly reason: DenyReason };

/** Roles that may never read the content of a case file (rule 8 of the prompt). */
const NEVER_CASE_CONTENT: readonly RoleCode[] = ['SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR'];

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

export function authorize(
  subject: Subject,
  action: string,
  resource: Resource | undefined,
  context: AuthorizationContext,
): Decision {
  if (!isActionCode(action)) return deny('UNKNOWN_ACTION');
  const rule = ACTIONS[action];

  // Mode conditions are evaluated first: in production mode a demo action does
  // not exist, whoever asks.
  for (const code of rule.requires) {
    const condition = CONDITIONS[code];
    if (condition.onFail === 'MODE_NOT_PERMITTED' && !condition.test(subject, resource, context)) {
      return deny('MODE_NOT_PERMITTED');
    }
  }

  if (rule.holders !== 'ANY_VISITOR') {
    if (subject.kind !== 'user') return deny('UNAUTHENTICATED');
    if (action.startsWith('case.') && NEVER_CASE_CONTENT.includes(subject.role)) return deny('NOT_FOUND');
    if (rule.holders !== 'ANY_ACTIVE_USER' && !rule.holders.includes(subject.role)) {
      return deny('ROLE_NOT_PERMITTED');
    }
  }

  if (rule.resourceKind !== null && resource?.kind !== rule.resourceKind) {
    // An action applied to the wrong kind of resource, or without its resource.
    return deny('NOT_FOUND');
  }

  for (const code of rule.requires) {
    const condition = CONDITIONS[code];
    if (condition.onFail === 'MODE_NOT_PERMITTED') continue;
    if (!condition.test(subject, resource, context)) {
      return deny(condition.onFail === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONDITION_NOT_MET');
    }
  }

  return { allowed: true, rule };
}

/**
 * The actions the subject may take, on the given resource (or on none). This is
 * what the action bar displays; it can never contain an action that authorize()
 * would refuse, because it is computed by calling authorize().
 */
export function availableActions(
  subject: Subject,
  resource: Resource | undefined,
  context: AuthorizationContext,
): ActionRule[] {
  const kind = resource?.kind ?? null;
  return Object.values(ACTIONS).filter(
    (rule) => rule.resourceKind === kind && authorize(subject, rule.code, resource, context).allowed,
  );
}
