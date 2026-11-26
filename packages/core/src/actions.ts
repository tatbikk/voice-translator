// The declarative action table (contract §4.2). Every button of the interface is
// an entry of this table, and the list of available actions is computed from
// it, never from a second list. A legal specialist can read it without reading
// the rest of the code: who may act, under which condition, at which level, on
// which legal basis, and what the confirmation window says.
import type { ConditionCode } from './conditions';
import type { Holder } from './procedure/conditions';
import { PROCEDURE_ACTIONS, type ProcedureAction } from './procedure/transitions';
import { ruleInForce } from './rules/in-force';
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
  'case.view',
  'case.actions.list',
  'case.document.read',
  'events.chain-status.view',
  'environment.view',
  'demo.accounts.list',
  'demo.account.switch',
  'demo.outbox.view',
  // Phase 2: the filing path, the simulated payment, the registry office, the
  // cashier, the prosecution's referrals, the register lookup, the list of files.
  'filing.drafts.list',
  'filing.draft.read',
  'filing.draft.edit',
  'filing.draft.pay',
  'filing.draft.submit',
  'payment.view',
  'payment.simulate',
  'registers.commercial.lookup',
  'registry.incoming.list',
  'cashier.ledger.view',
  'prosecution.referrals.list',
  'cases.list',
] as const;

type BaseActionCode = (typeof ACTION_CODES)[number];

/** Every action: the platform actions above and the procedure's (procedure/transitions.ts). */
export type ActionCode = BaseActionCode | `case.${string}` | `envelope.${string}` | `filing.${string}` | `litigant.${string}`;

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
  readonly legalBasis: LegalBasis | ((resource: Resource | undefined, onDay?: string) => LegalBasis);
  /** true for every state-changing action shown as a button: it opens the confirmation window */
  readonly confirm: boolean;
  readonly holders: ActionHolders;
  readonly requires: readonly ConditionCode[];
  /** the kind of resource the action applies to, or null for actions without resource */
  readonly resourceKind: ResourceKind | null;
  /** false for an access that is not a button of the action bar (opening the case page) */
  readonly button: boolean;
  /** the procedural transition, for the actions of the procedure */
  readonly procedure?: ProcedureAction;
  /** for access actions to a case: who may hold them, and in which relation with the file */
  readonly caseHolders?: readonly Holder[];
}

/**
 * Basis of creating an account, by the role it carries:
 * internal users of the information system (art. 624), professional accounts
 * (art. 625), public-law persons (art. 626), private-law persons (art. 627).
 */
export const ACCOUNT_CREATION_BASIS = [
  {
    version: '2026-08-23.1',
    /** entry into force of Law 58.25: six months after its publication on 23 February 2026 (art. 643) */
    validFrom: '2026-08-23',
    validTo: null,
    articles: { INTERNAL: [624], PROFESSIONAL: [625], PUBLIC_PERSON: [626], PRIVATE_PERSON: [627] },
  },
] as const satisfies readonly {
  version: string;
  validFrom: string;
  validTo: string | null;
  articles: Readonly<Record<string, readonly number[]>>;
}[];

export function accountCreationBasis(resource: Resource | undefined, onDay?: string): LegalBasis {
  const role = resource?.kind === 'account-draft' || resource?.kind === 'account' ? resource.role : null;
  if (!role) return PLATFORM_ADMINISTRATION;
  // The table in force on the day of the act; before the law's entry into
  // force, the first table (accounts are created to prepare it).
  const table = (onDay ? ruleInForce(ACCOUNT_CREATION_BASIS, onDay) : null) ?? ACCOUNT_CREATION_BASIS[0];
  return lawArticles(...table.articles[ROLES[role].accountBasis]);
}

const JUDGES = ['JUDGE_RAPPORTEUR', 'JUDGE_IN_CHARGE', 'COUNSELLOR_RAPPORTEUR'] as const;
const CLERKS = [
  'CLERK_REGISTRATION',
  'CLERK_CASHIER',
  'CLERK_NOTIFICATION',
  'CLERK_HEARING',
  'CLERK_COPIES_ENFORCEMENT',
  'CHIEF_CLERK',
] as const;

/**
 * The judges and the staff of the file's court, each in its relation with the
 * file: the court's side of those who may open it. The prosecution and the royal
 * commissioner, though of the court, are not of them (decision 71).
 */
export const COURT_SIDE_HOLDERS: readonly Holder[] = [
  { roles: JUDGES, relations: ['RAPPORTEUR'] },
  { roles: [...JUDGES, 'PANEL_PRESIDENT', 'PANEL_MEMBER'], relations: ['PANEL'] },
  { roles: ['COURT_PRESIDENT', 'ENFORCEMENT_JUDGE', ...CLERKS], relations: ['COURT_STAFF'] },
];

/** Who may open a case file (interface book): each role in its relation with the file. */
export const CASE_VIEW_HOLDERS: readonly Holder[] = [
  { roles: ['LAWYER'], relations: ['COUNSEL'] },
  ...COURT_SIDE_HOLDERS,
  { roles: ['PUBLIC_PROSECUTOR'], relations: ['PROSECUTION'] },
  { roles: ['ROYAL_COMMISSIONER'], relations: ['COMMISSIONER'] },
  { roles: ['LITIGANT'], relations: ['LITIGANT'] },
  { roles: ['PUBLIC_ADMIN_SUPERVISOR', 'PUBLIC_ADMIN_LITIGATION', 'STATE_JUDICIAL_AGENT'], relations: ['ADMIN_PARTY'] },
];

/** The two who file: the lawyer electronically, the registry office on paper. */
const FILERS: readonly RoleCode[] = ['LAWYER', 'CLERK_REGISTRATION'];

const keys = (code: ActionCode) => ({
  labelKey: `actions.${code}.label`,
  effectKey: `actions.${code}.effect`,
  notifiedKey: `actions.${code}.notified`,
});

const rule = (
  code: ActionCode,
  definition: Omit<ActionRule, 'code' | 'labelKey' | 'effectKey' | 'notifiedKey' | 'button'> & { button?: boolean },
): ActionRule => ({ code, ...keys(code), button: true, ...definition });

const BASE_ACTIONS: Readonly<Record<BaseActionCode, ActionRule>> = {
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
  'case.view': rule('case.view', {
    // The case page: whoever has a relation with the file (interface book,
    // «العناصر المشتركة»), never the system administration (rule 8 of the prompt).
    level: 'SCRIPT',
    legalBasis: lawArticles(624, 630),
    confirm: false,
    button: false,
    holders: CASE_VIEW_HOLDERS.flatMap((h) => h.roles),
    caseHolders: CASE_VIEW_HOLDERS,
    requires: [],
    resourceKind: 'case',
  }),
  'case.actions.list': rule('case.actions.list', {
    // «الإجراءات المتاحة» over the interface (review P1-A-03): whoever may open
    // the file, and those the file knows through a mission of their own, the
    // expert and the garnishee bank, who act in it without seeing the whole file.
    level: 'SCRIPT',
    legalBasis: lawArticles(624, 630),
    confirm: false,
    button: false,
    holders: [...CASE_VIEW_HOLDERS.flatMap((h) => h.roles), 'EXPERT', 'GARNISHEE_BANK'],
    caseHolders: [...CASE_VIEW_HOLDERS, { roles: ['EXPERT'], relations: ['EXPERT'] }, { roles: ['GARNISHEE_BANK'], relations: ['GARNISHEE'] }],
    requires: [],
    resourceKind: 'case',
  }),
  'case.document.read': rule('case.document.read', {
    // A document of the file: who may open the file, within the document's
    // visibility (a judgment before pronouncement: the panel, and the clerk when
    // the signature circle reaches him; interface book, «واجهة كتابة الضبط»).
    level: 'SCRIPT',
    legalBasis: lawArticles(631, 637),
    confirm: false,
    button: false,
    holders: CASE_VIEW_HOLDERS.flatMap((h) => h.roles),
    caseHolders: CASE_VIEW_HOLDERS,
    requires: [],
    resourceKind: 'case-document',
  }),
  'events.chain-status.view': rule('events.chain-status.view', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    button: false,
    holders: ['SYSTEM_ADMIN'],
    requires: [],
    resourceKind: null,
  }),
  'environment.view': rule('environment.view', {
    level: 'SCRIPT',
    legalBasis: PLATFORM_ADMINISTRATION,
    confirm: false,
    button: false,
    holders: 'ANY_VISITOR',
    requires: ['DEMO_MODE'],
    resourceKind: null,
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

  // -------------------------------------------------------------------------
  // Phase 2. A draft is its author's alone (memo row 2); filing it needs its
  // fee paid (row 3); a filed draft changes no more (row 26).
  'filing.drafts.list': rule('filing.drafts.list', {
    level: 'SCRIPT',
    legalBasis: lawArticles(76, 628),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: [],
    resourceKind: null,
  }),
  'filing.draft.read': rule('filing.draft.read', {
    level: 'SCRIPT',
    legalBasis: lawArticles(76, 77, 628),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: ['DRAFT_OWNED_BY_SUBJECT'],
    resourceKind: 'filing-draft',
  }),
  'filing.draft.edit': rule('filing.draft.edit', {
    level: 'HUMAN_DECISION',
    legalBasis: lawArticles(76, 77, 631),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: ['DRAFT_OWNED_BY_SUBJECT', 'DRAFT_OPEN'],
    resourceKind: 'filing-draft',
  }),
  'filing.draft.pay': rule('filing.draft.pay', {
    level: 'HUMAN_DECISION',
    legalBasis: lawArticles(619, 628),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: ['DRAFT_OWNED_BY_SUBJECT', 'DRAFT_OPEN', 'DRAFT_NOT_PAID'],
    resourceKind: 'filing-draft',
  }),
  'filing.draft.submit': rule('filing.draft.submit', {
    // The electronic filing is signed with the lawyer's secret (art. 76); the
    // paper filing bears the handwritten signature of its paper original.
    level: 'HUMAN_DECISION',
    legalBasis: lawArticles(76, 77, 628),
    confirm: true,
    button: false,
    holders: FILERS,
    requires: ['DRAFT_OWNED_BY_SUBJECT', 'DRAFT_OPEN', 'DRAFT_PAID'],
    resourceKind: 'filing-draft',
  }),
  'payment.view': rule('payment.view', {
    level: 'SCRIPT',
    legalBasis: lawArticles(628),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: ['INTENT_OWNED_BY_SUBJECT'],
    resourceKind: 'payment-intent',
  }),
  'payment.simulate': rule('payment.simulate', {
    level: 'HUMAN_DECISION',
    legalBasis: lawArticles(628),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: ['INTENT_OWNED_BY_SUBJECT', 'INTENT_PENDING'],
    resourceKind: 'payment-intent',
  }),
  'registers.commercial.lookup': rule('registers.commercial.lookup', {
    level: 'SCRIPT',
    legalBasis: lawArticles(77, 613),
    confirm: false,
    button: false,
    holders: FILERS,
    requires: [],
    resourceKind: null,
  }),
  'registry.incoming.list': rule('registry.incoming.list', {
    level: 'SCRIPT',
    legalBasis: lawArticles(76, 628),
    confirm: false,
    button: false,
    holders: ['CLERK_REGISTRATION'],
    requires: [],
    resourceKind: null,
  }),
  'cashier.ledger.view': rule('cashier.ledger.view', {
    level: 'SCRIPT',
    legalBasis: lawArticles(119, 619, 628),
    confirm: false,
    button: false,
    holders: ['CLERK_CASHIER'],
    requires: [],
    resourceKind: null,
  }),
  'prosecution.referrals.list': rule('prosecution.referrals.list', {
    level: 'SCRIPT',
    legalBasis: lawArticles(18, 20, 90),
    confirm: false,
    button: false,
    holders: ['PUBLIC_PROSECUTOR'],
    requires: [],
    resourceKind: null,
  }),
  'cases.list': rule('cases.list', {
    // The list of files: whoever may open a file; each file is then shown only
    // if the core relates the user to it (case.view).
    level: 'SCRIPT',
    legalBasis: lawArticles(624, 630),
    confirm: false,
    button: false,
    holders: [...new Set(CASE_VIEW_HOLDERS.flatMap((h) => h.roles))],
    requires: [],
    resourceKind: null,
  }),
};

function procedureRule(action: ProcedureAction): ActionRule {
  const code = action.code as ActionCode;
  return {
    code,
    ...keys(code),
    level: action.level,
    legalBasis: lawArticles(...action.articles),
    confirm: action.changesState,
    button: true,
    holders: [...new Set(action.holders.flatMap((h) => h.roles))],
    requires: [],
    resourceKind: action.resource,
    procedure: action,
  };
}

/** The whole action table: platform actions, then the procedure's. */
export const ACTIONS: Readonly<Record<BaseActionCode, ActionRule>> & Readonly<Partial<Record<string, ActionRule>>> = Object.freeze({
  ...BASE_ACTIONS,
  ...Object.fromEntries(PROCEDURE_ACTIONS.map((a) => [a.code, procedureRule(a)])),
});

export function isActionCode(value: unknown): value is ActionCode {
  return typeof value === 'string' && Object.hasOwn(ACTIONS, value);
}

export function resolveLegalBasis(rule: ActionRule, resource?: Resource, onDay?: string): LegalBasis {
  return typeof rule.legalBasis === 'function' ? rule.legalBasis(resource, onDay) : rule.legalBasis;
}
