// The declarative action table (contract §4.2). Every button of the interface is
// an entry of this table, and the list of available actions is computed from
// it, never from a second list. A legal specialist can read it without reading
// the rest of the code: who may act, under which condition, at which level, on
// which legal basis, and what the confirmation window says.
import type { ConditionCode } from './conditions';
import { lawArticles, PLATFORM_ADMINISTRATION, type LegalBasis } from './legal-basis';
import { ROLES, type RoleCode } from './roles';
import type { Resource, ResourceKind } from './subject';

/** The three levels of the study: human decision, deterministic script, AI assistance. */
export type ActionLevel = 'HUMAN_DECISION' | 'SCRIPT' | 'AI_ASSIST';

export const ACTION_CODES = [
  'dashboard.view',
  'notifications.view-own',
  'notifications.mark-read-own',
  'account.view-own',
  'account.switch-role',
  'admin.accounts.list',
  'admin.accounts.create',
  'admin.accounts.reissue-activation',
  'case.content.view',
  'demo.accounts.list',
  'demo.account.switch',
  'demo.outbox.view',
] as const;

export type ActionCode = (typeof ACTION_CODES)[number];

/** Who may hold the action, before conditions are evaluated. */
export type ActionHolders =
  | readonly RoleCode[]
  /** any user with an active session, whatever the role */
  | 'ANY_ACTIVE_USER'
  /** anyone past the visitor gate, with or without a session (demo tools only) */
  | 'ANY_VISITOR';

export interface ActionRule {
  readonly code: ActionCode;
  readonly level: ActionLevel;
  /** i18n keys: the button label and the three lines of the confirmation window */
  readonly labelKey: string;
  readonly effectKey: string;
  readonly notifiedKey: string;
  readonly legalBasis: LegalBasis | ((resource: Resource | undefined) => LegalBasis);
  /** true for every state-changing action shown as a button: it opens the confirmation window */
  readonly confirm: boolean;
  readonly holders: ActionHolders;
  readonly requires: readonly ConditionCode[];
  /** the kind of resource the action applies to, or null for actions without resource */
  readonly resourceKind: ResourceKind | null;
}

/**
 * Basis of creating an account, by the role it carries:
 * internal users of the information system (art. 624), professional accounts
 * (art. 625), public-law persons (art. 626), private-law persons (art. 627).
 */
export function accountCreationBasis(resource: Resource | undefined): LegalBasis {
  const role = resource?.kind === 'account-draft' || resource?.kind === 'account' ? resource.role : null;
  if (!role) return PLATFORM_ADMINISTRATION;
  switch (ROLES[role].accountBasis) {
    case 'INTERNAL':
      return lawArticles(624);
    case 'PROFESSIONAL':
      return lawArticles(625);
    case 'PUBLIC_PERSON':
      return lawArticles(626);
    case 'PRIVATE_PERSON':
      return lawArticles(627);
  }
}

const keys = (code: ActionCode) => ({
  labelKey: `actions.${code}.label`,
  effectKey: `actions.${code}.effect`,
  notifiedKey: `actions.${code}.notified`,
});

const rule = (
  code: ActionCode,
  definition: Omit<ActionRule, 'code' | 'labelKey' | 'effectKey' | 'notifiedKey'>,
): ActionRule => ({ code, ...keys(code), ...definition });

export const ACTIONS: Readonly<Record<ActionCode, ActionRule>> = {
  'dashboard.view': rule('dashboard.view', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_ACTIVE_USER',
    requires: [],
    resourceKind: null,
  }),
  'notifications.view-own': rule('notifications.view-own', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_ACTIVE_USER',
    requires: [],
    resourceKind: null,
  }),
  'notifications.mark-read-own': rule('notifications.mark-read-own', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_ACTIVE_USER',
    requires: ['RESOURCE_OWNED_BY_SUBJECT'],
    resourceKind: 'notification',
  }),
  'account.view-own': rule('account.view-own', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_ACTIVE_USER',
    requires: [],
    resourceKind: null,
  }),
  'account.switch-role': rule('account.switch-role', {
    level: 'HUMAN_DECISION',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_ACTIVE_USER',
    requires: ['HAS_MULTIPLE_ROLES'],
    resourceKind: null,
  }),
  'admin.accounts.list': rule('admin.accounts.list', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: ['SYSTEM_ADMIN'],
    requires: [],
    resourceKind: null,
  }),
  'admin.accounts.create': rule('admin.accounts.create', {
    level: 'HUMAN_DECISION',
    legalBasis: accountCreationBasis,
    confirm: true,
    holders: ['SYSTEM_ADMIN'],
    requires: [],
    resourceKind: 'account-draft',
  }),
  'admin.accounts.reissue-activation': rule('admin.accounts.reissue-activation', {
    level: 'HUMAN_DECISION',
    legalBasis: accountCreationBasis,
    confirm: true,
    holders: ['SYSTEM_ADMIN'],
    requires: ['TARGET_NOT_ACTIVATED', 'TARGET_NOT_DISABLED'],
    resourceKind: 'account',
  }),
  'case.content.view': rule('case.content.view', {
    // Nobody yet: the relation between users and case files arrives in Phase 1.
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: [],
    requires: ['SUBJECT_RELATED_TO_CASE'],
    resourceKind: 'case',
  }),
  'demo.accounts.list': rule('demo.accounts.list', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_VISITOR',
    requires: ['DEMO_TOOLS_ENABLED'],
    resourceKind: null,
  }),
  'demo.account.switch': rule('demo.account.switch', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_VISITOR',
    requires: ['DEMO_TOOLS_ENABLED', 'TARGET_IS_DEMO_ACCOUNT'],
    resourceKind: 'demo-account',
  }),
  'demo.outbox.view': rule('demo.outbox.view', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    holders: 'ANY_VISITOR',
    requires: ['DEMO_TOOLS_ENABLED'],
    resourceKind: null,
  }),
};

export function isActionCode(value: unknown): value is ActionCode {
  return typeof value === 'string' && (ACTION_CODES as readonly string[]).includes(value);
}

export function resolveLegalBasis(rule: ActionRule, resource?: Resource): LegalBasis {
  return typeof rule.legalBasis === 'function' ? rule.legalBasis(resource) : rule.legalBasis;
}
