// Demo data of Phase 0. Every person, body and court here is fictitious, named
// in the study's lettered manner (rule 11 of the prompt). E-mail addresses use
// the reserved .example domain; telephone numbers are visibly fictitious.
import type { RoleCode } from '@mahkama/core';

export const DEMO_EMAIL_DOMAIN = 'demo.mahkama.example';

export const DEMO_COURTS = {
  firstInstance: { code: 'demo-fi-commercial', name: 'المحكمة الابتدائية التجارية النموذجية', degree: 'FIRST_INSTANCE', specialty: 'COMMERCIAL' },
  appeal: { code: 'demo-ap-commercial', name: 'محكمة الاستئناف التجارية النموذجية', degree: 'APPEAL', specialty: 'COMMERCIAL' },
} as const;

export type DemoCourtKey = keyof typeof DEMO_COURTS;

export const DEMO_PANELS = {
  fiFirst: { court: 'firstInstance', name: 'الهيئة التجارية الأولى', kind: 'COLLEGIAL' },
  fiSecond: { court: 'firstInstance', name: 'الهيئة التجارية الثانية', kind: 'COLLEGIAL' },
  apFirst: { court: 'appeal', name: 'هيئة الاستئناف التجارية الأولى', kind: 'COLLEGIAL' },
} as const;

export type DemoPanelKey = keyof typeof DEMO_PANELS;

export const DEMO_ORGANIZATIONS = {
  lawFirm: { kind: 'LAW_FIRM', name: 'مكتب الأستاذة دال للمحاماة' },
  bank: { kind: 'BANK', name: 'البنك النموذجي' },
  administration: { kind: 'PUBLIC_ADMINISTRATION', name: 'الإدارة العمومية النموذجية' },
  stateAgency: { kind: 'STATE_JUDICIAL_AGENCY', name: 'مصلحة الوكيل القضائي النموذجية' },
} as const;

export type DemoOrganizationKey = keyof typeof DEMO_ORGANIZATIONS;

export interface DemoRole {
  readonly role: RoleCode;
  readonly court?: DemoCourtKey;
  readonly panel?: DemoPanelKey;
  readonly organization?: DemoOrganizationKey;
}

export interface DemoUser {
  readonly key: string;
  readonly fullName: string;
  readonly roles: readonly DemoRole[];
}

export const DEMO_USERS: readonly DemoUser[] = [
  { key: 'lawyer.plaintiff', fullName: 'الأستاذة دال', roles: [{ role: 'LAWYER', organization: 'lawFirm' }] },
  { key: 'lawyer.defendants', fullName: 'الأستاذ هاء', roles: [{ role: 'LAWYER' }] },
  { key: 'lawyer.assistant', fullName: 'السيدة واو', roles: [{ role: 'LAWYER_ASSISTANT', organization: 'lawFirm' }] },
  { key: 'clerk.registration', fullName: 'السيد زاي', roles: [{ role: 'CLERK_REGISTRATION', court: 'firstInstance' }] },
  { key: 'clerk.cashier', fullName: 'السيدة حاء', roles: [{ role: 'CLERK_CASHIER', court: 'firstInstance' }] },
  { key: 'clerk.notification', fullName: 'السيد طاء', roles: [{ role: 'CLERK_NOTIFICATION', court: 'firstInstance' }] },
  { key: 'clerk.hearing', fullName: 'السيدة ياء', roles: [{ role: 'CLERK_HEARING', court: 'firstInstance' }] },
  { key: 'clerk.copies', fullName: 'السيد كاف', roles: [{ role: 'CLERK_COPIES_ENFORCEMENT', court: 'firstInstance' }] },
  { key: 'clerk.chief', fullName: 'السيدة لام', roles: [{ role: 'CHIEF_CLERK', court: 'firstInstance' }] },
  { key: 'president.first-instance', fullName: 'القاضي ميم', roles: [{ role: 'COURT_PRESIDENT', court: 'firstInstance' }] },
  {
    key: 'judge.rapporteur',
    fullName: 'القاضية نون',
    roles: [
      { role: 'JUDGE_RAPPORTEUR', court: 'firstInstance', panel: 'fiFirst' },
      { role: 'PANEL_PRESIDENT', court: 'firstInstance', panel: 'fiSecond' },
    ],
  },
  { key: 'judge.in-charge', fullName: 'القاضي سين', roles: [{ role: 'JUDGE_IN_CHARGE', court: 'firstInstance' }] },
  { key: 'panel.president', fullName: 'القاضي عين', roles: [{ role: 'PANEL_PRESIDENT', court: 'firstInstance', panel: 'fiFirst' }] },
  { key: 'panel.member', fullName: 'القاضية فاء', roles: [{ role: 'PANEL_MEMBER', court: 'firstInstance', panel: 'fiFirst' }] },
  { key: 'prosecution', fullName: 'السيد صاد', roles: [{ role: 'PUBLIC_PROSECUTOR', court: 'firstInstance' }] },
  // The royal commissioner sits before administrative courts (articles 101, 107 of
  // Law 58.25); the demo has only commercial model courts, so the account is
  // attached to no court (open question in docs/open-questions.md).
  { key: 'royal-commissioner', fullName: 'السيدة قاف', roles: [{ role: 'ROYAL_COMMISSIONER' }] },
  { key: 'bailiff.first', fullName: 'السيد راء', roles: [{ role: 'BAILIFF', court: 'firstInstance' }] },
  { key: 'bailiff.second', fullName: 'السيدة شين', roles: [{ role: 'BAILIFF', court: 'firstInstance' }] },
  { key: 'expert.accounting', fullName: 'السيد تاء', roles: [{ role: 'EXPERT' }] },
  { key: 'enforcement-judge', fullName: 'القاضي ثاء', roles: [{ role: 'ENFORCEMENT_JUDGE', court: 'firstInstance' }] },
  { key: 'litigant', fullName: 'السيد جيم', roles: [{ role: 'LITIGANT' }] },
  { key: 'administration.supervisor', fullName: 'السيدة خاء', roles: [{ role: 'PUBLIC_ADMIN_SUPERVISOR', organization: 'administration' }] },
  { key: 'administration.litigation', fullName: 'السيد ذال', roles: [{ role: 'PUBLIC_ADMIN_LITIGATION', organization: 'administration' }] },
  { key: 'state-judicial-agent', fullName: 'السيد ضاد', roles: [{ role: 'STATE_JUDICIAL_AGENT', organization: 'stateAgency' }] },
  { key: 'bank', fullName: 'السيدة ظاء', roles: [{ role: 'GARNISHEE_BANK', organization: 'bank' }] },
  { key: 'system-admin', fullName: 'السيد غين', roles: [{ role: 'SYSTEM_ADMIN' }] },
  { key: 'rules-validator', fullName: 'السيدة كاف لام', roles: [{ role: 'RULES_LEGAL_VALIDATOR' }] },
  { key: 'president.appeal', fullName: 'القاضي ميم سين', roles: [{ role: 'COURT_PRESIDENT', court: 'appeal' }] },
  {
    key: 'counsellor.rapporteur',
    fullName: 'المستشار عين نون',
    roles: [{ role: 'COUNSELLOR_RAPPORTEUR', court: 'appeal', panel: 'apFirst' }],
  },
  {
    key: 'panel.president.appeal',
    fullName: 'المستشارة فاء راء',
    roles: [{ role: 'PANEL_PRESIDENT', court: 'appeal', panel: 'apFirst' }],
  },
];

export function demoEmail(key: string): string {
  return `${key}@${DEMO_EMAIL_DOMAIN}`;
}

export function demoPhone(index: number): string {
  return `+000 0000 ${String(index + 1).padStart(4, '0')}`;
}

/** The seeded demo accounts, for the end-to-end tests. Password: SEED_DEMO_PASSWORD. */
export const DEMO_ACCOUNTS: readonly { email: string; role: string; roleAssignmentCount: number }[] = DEMO_USERS.flatMap((user) =>
  user.roles.map((r) => ({ email: demoEmail(user.key), role: r.role, roleAssignmentCount: user.roles.length })),
);

export interface DemoCase {
  readonly court: DemoCourtKey;
  readonly number: number;
  readonly code: number;
  readonly year: number;
  readonly status:
    | 'REGISTERED'
    | 'RAPPORTEUR_ASSIGNED'
    | 'IN_NOTIFICATION'
    | 'IN_PREPARATION'
    | 'IN_EXPERTISE'
    | 'IN_DELIBERATION'
    | 'JUDGMENT_ISSUED';
  /** days from today (platform time) of the next hearing, if any */
  readonly hearingInDays: number | null;
  readonly hearingTime: string;
  readonly panel: DemoPanelKey;
  readonly room: string;
}

// Six case files at different stages (the model case itself is not created:
// Phase 2 files it from the first screen). The code inside each number is the
// code of the file's case type in rules/case-types.json (decision 53; review of
// IR-40): 8201 for a commercial payment, 8202 for the damages claim of 1067, and
// the appeal 312 the type of its file (decision 81). The codes are assumed (س21).
export const DEMO_CASES: readonly DemoCase[] = [
  { court: 'firstInstance', number: 1201, code: 8201, year: 2026, status: 'REGISTERED', hearingInDays: null, hearingTime: '09:30', panel: 'fiFirst', room: 'القاعة 2' },
  { court: 'firstInstance', number: 1188, code: 8201, year: 2026, status: 'IN_NOTIFICATION', hearingInDays: 5, hearingTime: '09:30', panel: 'fiFirst', room: 'القاعة 2' },
  { court: 'firstInstance', number: 1150, code: 8201, year: 2026, status: 'IN_PREPARATION', hearingInDays: 5, hearingTime: '10:30', panel: 'fiSecond', room: 'القاعة 3' },
  { court: 'firstInstance', number: 1103, code: 8201, year: 2026, status: 'IN_EXPERTISE', hearingInDays: 19, hearingTime: '09:30', panel: 'fiFirst', room: 'القاعة 2' },
  { court: 'firstInstance', number: 1067, code: 8202, year: 2026, status: 'IN_DELIBERATION', hearingInDays: 7, hearingTime: '11:00', panel: 'fiSecond', room: 'القاعة 3' },
  { court: 'firstInstance', number: 980, code: 8201, year: 2026, status: 'JUDGMENT_ISSUED', hearingInDays: null, hearingTime: '09:30', panel: 'fiFirst', room: 'القاعة 2' },
  { court: 'appeal', number: 312, code: 8201, year: 2026, status: 'IN_PREPARATION', hearingInDays: 12, hearingTime: '10:00', panel: 'apFirst', room: 'القاعة 1' },
];
