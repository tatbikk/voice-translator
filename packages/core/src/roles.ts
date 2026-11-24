// Roles and spaces (contract §4.1). The thirteen spaces are those of the
// study's «دفتر الواجهات»; the roles are the study's, never merged. Labels are
// i18n keys: the Arabic text lives in the web app's message files.

export const SPACES = [
  'lawyer',
  'clerk',
  'court_president',
  'judge_rapporteur',
  'panel',
  'prosecution',
  'bailiff',
  'expert',
  'enforcement_judge',
  'litigant',
  'public_administration',
  'bank',
  'system_admin',
] as const;

export type SpaceCode = (typeof SPACES)[number];

export const ROLE_CODES = [
  'LAWYER',
  'LAWYER_ASSISTANT',
  'CLERK_REGISTRATION',
  'CLERK_CASHIER',
  'CLERK_NOTIFICATION',
  'CLERK_HEARING',
  'CLERK_COPIES_ENFORCEMENT',
  'CHIEF_CLERK',
  'COURT_PRESIDENT',
  'JUDGE_RAPPORTEUR',
  'JUDGE_IN_CHARGE',
  'COUNSELLOR_RAPPORTEUR',
  'PANEL_PRESIDENT',
  'PANEL_MEMBER',
  'PUBLIC_PROSECUTOR',
  'ROYAL_COMMISSIONER',
  'BAILIFF',
  'EXPERT',
  'ENFORCEMENT_JUDGE',
  'LITIGANT',
  'PUBLIC_ADMIN_SUPERVISOR',
  'PUBLIC_ADMIN_LITIGATION',
  'STATE_JUDICIAL_AGENT',
  'GARNISHEE_BANK',
  'SYSTEM_ADMIN',
  'RULES_LEGAL_VALIDATOR',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export type CourtDegree = 'FIRST_INSTANCE' | 'APPEAL';

/**
 * Which article of Law 58.25 an account of this role rests on:
 * - INTERNAL: users of the information system managed by the judicial authority (art. 624);
 * - PROFESSIONAL: professional accounts on the platforms of art. 625 (lawyers and their
 *   firms, bailiffs, judicial experts…);
 * - PUBLIC_PERSON: public-law persons that must declare their electronic addresses (art. 626);
 * - PRIVATE_PERSON: private-law natural or legal persons that may do so (art. 627).
 */
export type AccountBasisGroup = 'INTERNAL' | 'PROFESSIONAL' | 'PUBLIC_PERSON' | 'PRIVATE_PERSON';

export interface RoleDefinition {
  readonly code: RoleCode;
  readonly space: SpaceCode;
  readonly requiresCourt: boolean;
  readonly requiresOrganization: boolean;
  /** An exclusive role cannot be combined with any other role of the same user. */
  readonly exclusive: boolean;
  readonly accountBasis: AccountBasisGroup;
}

const role = (
  code: RoleCode,
  space: SpaceCode,
  accountBasis: AccountBasisGroup,
  options: { court?: boolean; organization?: boolean; exclusive?: boolean } = {},
): RoleDefinition => ({
  code,
  space,
  accountBasis,
  requiresCourt: options.court ?? false,
  requiresOrganization: options.organization ?? false,
  exclusive: options.exclusive ?? false,
});

export const ROLES: Readonly<Record<RoleCode, RoleDefinition>> = {
  LAWYER: role('LAWYER', 'lawyer', 'PROFESSIONAL'),
  LAWYER_ASSISTANT: role('LAWYER_ASSISTANT', 'lawyer', 'PROFESSIONAL', { organization: true }),
  CLERK_REGISTRATION: role('CLERK_REGISTRATION', 'clerk', 'INTERNAL', { court: true }),
  CLERK_CASHIER: role('CLERK_CASHIER', 'clerk', 'INTERNAL', { court: true }),
  CLERK_NOTIFICATION: role('CLERK_NOTIFICATION', 'clerk', 'INTERNAL', { court: true }),
  CLERK_HEARING: role('CLERK_HEARING', 'clerk', 'INTERNAL', { court: true }),
  CLERK_COPIES_ENFORCEMENT: role('CLERK_COPIES_ENFORCEMENT', 'clerk', 'INTERNAL', { court: true }),
  CHIEF_CLERK: role('CHIEF_CLERK', 'clerk', 'INTERNAL', { court: true }),
  COURT_PRESIDENT: role('COURT_PRESIDENT', 'court_president', 'INTERNAL', { court: true }),
  JUDGE_RAPPORTEUR: role('JUDGE_RAPPORTEUR', 'judge_rapporteur', 'INTERNAL', { court: true }),
  JUDGE_IN_CHARGE: role('JUDGE_IN_CHARGE', 'judge_rapporteur', 'INTERNAL', { court: true }),
  COUNSELLOR_RAPPORTEUR: role('COUNSELLOR_RAPPORTEUR', 'judge_rapporteur', 'INTERNAL', { court: true }),
  PANEL_PRESIDENT: role('PANEL_PRESIDENT', 'panel', 'INTERNAL', { court: true }),
  PANEL_MEMBER: role('PANEL_MEMBER', 'panel', 'INTERNAL', { court: true }),
  PUBLIC_PROSECUTOR: role('PUBLIC_PROSECUTOR', 'prosecution', 'INTERNAL', { court: true }),
  ROYAL_COMMISSIONER: role('ROYAL_COMMISSIONER', 'prosecution', 'INTERNAL', { court: true }),
  BAILIFF: role('BAILIFF', 'bailiff', 'PROFESSIONAL', { court: true }),
  EXPERT: role('EXPERT', 'expert', 'PROFESSIONAL'),
  ENFORCEMENT_JUDGE: role('ENFORCEMENT_JUDGE', 'enforcement_judge', 'INTERNAL', { court: true }),
  LITIGANT: role('LITIGANT', 'litigant', 'PRIVATE_PERSON'),
  PUBLIC_ADMIN_SUPERVISOR: role('PUBLIC_ADMIN_SUPERVISOR', 'public_administration', 'PUBLIC_PERSON', {
    organization: true,
  }),
  PUBLIC_ADMIN_LITIGATION: role('PUBLIC_ADMIN_LITIGATION', 'public_administration', 'PUBLIC_PERSON', {
    organization: true,
  }),
  STATE_JUDICIAL_AGENT: role('STATE_JUDICIAL_AGENT', 'public_administration', 'PUBLIC_PERSON', {
    organization: true,
  }),
  GARNISHEE_BANK: role('GARNISHEE_BANK', 'bank', 'PRIVATE_PERSON', { organization: true }),
  SYSTEM_ADMIN: role('SYSTEM_ADMIN', 'system_admin', 'INTERNAL', { exclusive: true }),
  RULES_LEGAL_VALIDATOR: role('RULES_LEGAL_VALIDATOR', 'system_admin', 'INTERNAL', { exclusive: true }),
};

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}

/** i18n key of a role's label. The court president is «الرئيس الأول» at an appeal court. */
export function roleLabelKey(code: RoleCode, courtDegree?: CourtDegree | null): string {
  if (code === 'COURT_PRESIDENT' && courtDegree === 'APPEAL') return 'roles.COURT_PRESIDENT_APPEAL';
  return `roles.${code}`;
}

export function spaceLabelKey(space: SpaceCode): string {
  return `spaces.${space}`;
}

/**
 * Whether a new role may be added to a user who already holds `existing`.
 * Exclusive roles (system administration) never combine with another role, and
 * the two halves of the double signature are never held by the same person.
 */
export function canCombineRoles(existing: readonly RoleCode[], added: RoleCode): boolean {
  if (existing.length === 0) return true;
  if (ROLES[added].exclusive) return false;
  return !existing.some((code) => ROLES[code].exclusive);
}
