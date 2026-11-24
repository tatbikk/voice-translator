import 'server-only';
import type { ActionCode } from '@mahkama/core';

// Every API endpoint of the platform (contract §6). The refusal matrix of the
// integration tests walks this list, and an architecture test checks that it
// matches the route files exactly, so an endpoint cannot exist without being
// covered.

export interface EndpointMeta {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly access:
    | { readonly kind: 'public' | 'pre-gate' | 'gate' | 'session' }
    | { readonly kind: 'pending-session'; readonly states: readonly string[]; readonly action?: ActionCode }
    | { readonly kind: 'action' | 'demo'; readonly action: ActionCode };
  /** import path of the route module */
  readonly module: string;
  /** demo endpoints exist only in a demo build */
  readonly demoBuildOnly?: boolean;
}

export const ENDPOINTS: readonly EndpointMeta[] = [
  { id: 'healthz', method: 'GET', path: '/healthz', access: { kind: 'public' }, module: '@/app/healthz/route' },
  { id: 'access.submit', method: 'POST', path: '/api/v1/access', access: { kind: 'pre-gate' }, module: '@/app/api/v1/access/route' },
  { id: 'csrf.token', method: 'GET', path: '/api/v1/csrf', access: { kind: 'pre-gate' }, module: '@/app/api/v1/csrf/route' },
  { id: 'auth.login', method: 'POST', path: '/api/v1/auth/login', access: { kind: 'gate' }, module: '@/app/api/v1/auth/login/route' },
  {
    id: 'auth.second-factor',
    method: 'POST',
    path: '/api/v1/auth/second-factor',
    access: { kind: 'pending-session', states: ['PENDING_SECOND_FACTOR'] },
    module: '@/app/api/v1/auth/second-factor/route',
  },
  {
    id: 'auth.second-factor.resend',
    method: 'POST',
    path: '/api/v1/auth/second-factor/resend',
    access: { kind: 'pending-session', states: ['PENDING_SECOND_FACTOR'] },
    module: '@/app/api/v1/auth/second-factor/resend/route',
  },
  {
    id: 'auth.role',
    method: 'POST',
    path: '/api/v1/auth/role',
    access: { kind: 'pending-session', states: ['PENDING_ROLE'], action: 'account.switch-role' },
    module: '@/app/api/v1/auth/role/route',
  },
  { id: 'auth.logout', method: 'POST', path: '/api/v1/auth/logout', access: { kind: 'session' }, module: '@/app/api/v1/auth/logout/route' },
  {
    id: 'auth.reauth',
    method: 'POST',
    path: '/api/v1/auth/reauth',
    access: { kind: 'action', action: 'account.view-own' },
    module: '@/app/api/v1/auth/reauth/route',
  },
  { id: 'auth.activate', method: 'POST', path: '/api/v1/auth/activate', access: { kind: 'gate' }, module: '@/app/api/v1/auth/activate/route' },
  {
    id: 'notifications.list',
    method: 'GET',
    path: '/api/v1/notifications',
    access: { kind: 'action', action: 'notifications.view-own' },
    module: '@/app/api/v1/notifications/route',
  },
  {
    id: 'notifications.mark-read',
    method: 'POST',
    path: '/api/v1/notifications/:id/read',
    access: { kind: 'action', action: 'notifications.mark-read-own' },
    module: '@/app/api/v1/notifications/[id]/read/route',
  },
  { id: 'preferences.update', method: 'POST', path: '/api/v1/preferences', access: { kind: 'gate' }, module: '@/app/api/v1/preferences/route' },
  {
    id: 'admin.accounts.list',
    method: 'GET',
    path: '/api/v1/admin/accounts',
    access: { kind: 'action', action: 'admin.accounts.list' },
    module: '@/app/api/v1/admin/accounts/route',
  },
  {
    id: 'admin.accounts.create',
    method: 'POST',
    path: '/api/v1/admin/accounts',
    access: { kind: 'action', action: 'admin.accounts.create' },
    module: '@/app/api/v1/admin/accounts/route',
  },
  {
    id: 'admin.accounts.reissue-activation',
    method: 'POST',
    path: '/api/v1/admin/accounts/:id/activation',
    access: { kind: 'action', action: 'admin.accounts.reissue-activation' },
    module: '@/app/api/v1/admin/accounts/[id]/activation/route',
  },
  {
    id: 'public.case-status',
    method: 'GET',
    path: '/api/v1/public/case-status',
    access: { kind: 'gate' },
    module: '@/app/api/v1/public/case-status/route',
  },
  { id: 'public.hearings', method: 'GET', path: '/api/v1/public/hearings', access: { kind: 'gate' }, module: '@/app/api/v1/public/hearings/route' },
  {
    id: 'demo.outbox',
    method: 'GET',
    path: '/api/demo/outbox',
    access: { kind: 'demo', action: 'demo.outbox.view' },
    module: '@/app/api/demo/outbox/route.demo',
    demoBuildOnly: true,
  },
  {
    id: 'demo.accounts',
    method: 'GET',
    path: '/api/demo/accounts',
    access: { kind: 'demo', action: 'demo.accounts.list' },
    module: '@/app/api/demo/accounts/route.demo',
    demoBuildOnly: true,
  },
  {
    id: 'demo.switch-account',
    method: 'POST',
    path: '/api/demo/switch-account',
    access: { kind: 'demo', action: 'demo.account.switch' },
    module: '@/app/api/demo/switch-account/route.demo',
    demoBuildOnly: true,
  },
  { id: 'api.unknown.get', method: 'GET', path: '/api/*', access: { kind: 'public' }, module: '@/app/api/[...unknown]/route' },
  { id: 'api.unknown.post', method: 'POST', path: '/api/*', access: { kind: 'public' }, module: '@/app/api/[...unknown]/route' },
];
