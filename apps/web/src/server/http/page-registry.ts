import 'server-only';
import type { ActionCode } from '@mahkama/core';

// Every page of the platform with its guard (contract §7). An architecture
// test checks that each page file calls the declared guard first and is listed
// here; the page refusal matrix of the end-to-end tests walks this list.

export interface PageMeta {
  readonly id: string;
  readonly path: string;
  readonly guard: 'none' | 'gate' | 'pending' | 'page' | 'demo';
  readonly action?: ActionCode;
  /** the file, relative to src/app */
  readonly file: string;
  readonly demoBuildOnly?: boolean;
  /** shown only in the demo environment */
  readonly demoModeOnly?: boolean;
}

export const PAGES: readonly PageMeta[] = [
  { id: 'access', path: '/access', guard: 'none', file: '(pre-gate)/access/page.tsx' },
  { id: 'home', path: '/', guard: 'gate', file: '(gate)/page.tsx' },
  { id: 'track', path: '/track', guard: 'gate', file: '(gate)/track/page.tsx' },
  { id: 'hearings', path: '/hearings', guard: 'gate', file: '(gate)/hearings/page.tsx' },
  { id: 'environment', path: '/environment', guard: 'gate', file: '(gate)/environment/page.tsx', demoModeOnly: true },
  { id: 'login', path: '/login', guard: 'gate', file: '(gate)/login/page.tsx' },
  { id: 'login.confirm', path: '/login/confirm', guard: 'pending', file: '(gate)/login/confirm/page.tsx' },
  { id: 'login.role', path: '/login/role', guard: 'pending', action: 'account.switch-role', file: '(gate)/login/role/page.tsx' },
  { id: 'activate', path: '/activate', guard: 'gate', file: '(gate)/activate/page.tsx' },
  { id: 'dashboard', path: '/dashboard', guard: 'page', action: 'dashboard.view', file: '(app)/dashboard/page.tsx' },
  { id: 'notifications', path: '/notifications', guard: 'page', action: 'notifications.view-own', file: '(app)/notifications/page.tsx' },
  { id: 'account', path: '/account', guard: 'page', action: 'account.view-own', file: '(app)/account/page.tsx' },
  { id: 'reauth', path: '/reauth', guard: 'page', action: 'account.view-own', file: '(app)/reauth/page.tsx' },
  { id: 'case', path: '/cases/:caseId', guard: 'page', action: 'case.view', file: '(app)/cases/[caseId]/page.tsx' },
  // Phase 2: the filing path, the simulated gateway, the registry office, the cashier, the list of files.
  { id: 'cases', path: '/cases', guard: 'page', action: 'cases.list', file: '(app)/cases/page.tsx' },
  { id: 'filings', path: '/filings', guard: 'page', action: 'filing.drafts.list', file: '(app)/filings/page.tsx' },
  { id: 'filing', path: '/filings/:draftId', guard: 'page', action: 'filing.draft.read', file: '(app)/filings/[draftId]/page.tsx' },
  { id: 'filing.receipt', path: '/filings/:draftId/receipt', guard: 'page', action: 'filing.draft.read', file: '(app)/filings/[draftId]/receipt/page.tsx' },
  { id: 'payment', path: '/payments/:intentId', guard: 'page', action: 'payment.view', file: '(app)/payments/[intentId]/page.tsx' },
  { id: 'registry', path: '/registry', guard: 'page', action: 'registry.incoming.list', file: '(app)/registry/page.tsx' },
  { id: 'cashier', path: '/cashier', guard: 'page', action: 'cashier.ledger.view', file: '(app)/cashier/page.tsx' },
  { id: 'admin.accounts', path: '/admin/accounts', guard: 'page', action: 'admin.accounts.list', file: '(app)/admin/accounts/page.tsx' },
  {
    id: 'admin.accounts.new',
    path: '/admin/accounts/new',
    guard: 'page',
    // The form is shown to whoever may list accounts (the administrator); the
    // submission itself is authorized as admin.accounts.create.
    action: 'admin.accounts.list',
    file: '(app)/admin/accounts/new/page.tsx',
  },
  {
    id: 'demo.outbox',
    path: '/demo/outbox',
    guard: 'demo',
    action: 'demo.outbox.view',
    file: '(gate)/demo/outbox/page.demo.tsx',
    demoBuildOnly: true,
  },
];
