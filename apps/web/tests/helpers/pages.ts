// The pages of Phases 0 to 2 and their guards, stated independently from the page
// registry (contract §7 table). The architecture tests compare PAGES with this
// list; the end-to-end page matrix walks it.
import { PAGE_TITLES } from './labels';

export type GuardKind = 'none' | 'gate' | 'pending' | 'page' | 'demo';

export interface ExpectedPage {
  readonly path: string;
  /** guards the contract allows for this page */
  readonly guards: readonly GuardKind[];
  /** actions the contract allows for requirePage / requireDemo (empty: no action) */
  readonly actions: readonly string[];
  readonly title: string;
  /** needs a session (redirects to /login without one) */
  readonly session: 'none' | 'pending-second-factor' | 'pending-role' | 'active';
  readonly adminOnly?: boolean;
  readonly demoOnly?: boolean;
}

export const EXPECTED_PAGES: readonly ExpectedPage[] = [
  { path: '/access', guards: ['none'], actions: [], title: PAGE_TITLES.access, session: 'none' },
  { path: '/', guards: ['gate'], actions: [], title: PAGE_TITLES.home, session: 'none' },
  { path: '/track', guards: ['gate'], actions: [], title: PAGE_TITLES.track, session: 'none' },
  { path: '/hearings', guards: ['gate'], actions: [], title: PAGE_TITLES.hearings, session: 'none' },
  { path: '/environment', guards: ['gate'], actions: [], title: PAGE_TITLES.environment, session: 'none', demoOnly: true },
  { path: '/login', guards: ['gate'], actions: [], title: PAGE_TITLES.login, session: 'none' },
  { path: '/login/confirm', guards: ['pending'], actions: [], title: PAGE_TITLES.loginConfirm, session: 'pending-second-factor' },
  {
    path: '/login/role',
    guards: ['pending', 'page'],
    actions: ['account.switch-role'],
    title: PAGE_TITLES.loginRole,
    session: 'pending-role',
  },
  { path: '/activate', guards: ['gate'], actions: [], title: PAGE_TITLES.activate, session: 'none' },
  { path: '/dashboard', guards: ['page'], actions: ['dashboard.view'], title: PAGE_TITLES.dashboard, session: 'active' },
  { path: '/notifications', guards: ['page'], actions: ['notifications.view-own'], title: PAGE_TITLES.notifications, session: 'active' },
  { path: '/account', guards: ['page'], actions: ['account.view-own'], title: PAGE_TITLES.account, session: 'active' },
  // Phase 1: the case page, for whoever the core relates to the file (study «العناصر المشتركة»).
  { path: '/cases/:caseId', guards: ['page'], actions: ['case.view'], title: PAGE_TITLES.caseFile, session: 'active' },
  // Phase 2: the filing path, the simulated payment page, the registry office, the cashier, the list of files.
  { path: '/cases', guards: ['page'], actions: ['cases.list'], title: PAGE_TITLES.cases, session: 'active' },
  { path: '/filings', guards: ['page'], actions: ['filing.drafts.list'], title: PAGE_TITLES.filings, session: 'active' },
  { path: '/filings/:draftId', guards: ['page'], actions: ['filing.draft.read'], title: PAGE_TITLES.filing, session: 'active' },
  { path: '/filings/:draftId/receipt', guards: ['page'], actions: ['filing.draft.read'], title: PAGE_TITLES.receipt, session: 'active' },
  { path: '/payments/:intentId', guards: ['page'], actions: ['payment.view'], title: PAGE_TITLES.payment, session: 'active' },
  { path: '/registry', guards: ['page'], actions: ['registry.incoming.list'], title: PAGE_TITLES.registry, session: 'active' },
  { path: '/cashier', guards: ['page'], actions: ['cashier.ledger.view'], title: PAGE_TITLES.cashier, session: 'active' },
  { path: '/reauth', guards: ['page'], actions: ['account.view-own'], title: PAGE_TITLES.reauth, session: 'active' },
  {
    path: '/admin/accounts',
    guards: ['page'],
    actions: ['admin.accounts.list'],
    title: PAGE_TITLES.adminAccounts,
    session: 'active',
    adminOnly: true,
  },
  {
    path: '/admin/accounts/new',
    guards: ['page'],
    actions: ['admin.accounts.list', 'admin.accounts.create'],
    title: PAGE_TITLES.adminAccountsNew,
    session: 'active',
    adminOnly: true,
  },
  {
    path: '/demo/outbox',
    guards: ['demo'],
    actions: ['demo.outbox.view'],
    title: PAGE_TITLES.demoOutbox,
    session: 'none',
    demoOnly: true,
  },
];
