// Account administration flows: an administrator's session (with or without a
// recent re-authentication), the body of «إنشاء حساب» (contract §6), and the
// activation link read from the e-mail the simulated provider wrote.
import { randomBytes } from 'node:crypto';
import type { RoleCode } from '@mahkama/core';
import { expectStatus, login, reauthenticate } from './auth';
import { outboundTo } from './db';
import { appUrl } from './env';
import { createUser, newEmail, type TestUser } from './factories';
import type { ApiResponse, Client, RequestOptions } from './http';
import { trackSensitive } from './sensitive';

export interface AccountDraft {
  fullName: string;
  email: string;
  phone: string;
  role: RoleCode;
  courtId?: string;
  organizationName?: string;
  requestReference?: string;
}

let drafts = 0;

export function accountDraft(overrides: Partial<AccountDraft> = {}): AccountDraft {
  drafts += 1;
  const fullName = `الأستاذ المنشأ ${String(drafts)} ${randomBytes(2).toString('hex')}`;
  const phone = `+2126${String(30_000_000 + drafts * 7 + randomBytes(1)[0]!)}`;
  const requestReference = `REQ-2026-${randomBytes(5).toString('hex')}`;
  trackSensitive('name', fullName);
  trackSensitive('phone', phone);
  trackSensitive('reference', requestReference);
  const draft: AccountDraft = { fullName, email: newEmail('created'), phone, role: 'LAWYER', requestReference, ...overrides };
  trackSensitive('email', draft.email);
  if (draft.requestReference) trackSensitive('reference', draft.requestReference);
  return draft;
}

export interface AdminSession {
  readonly admin: TestUser;
  readonly client: Client;
}

/** A SYSTEM_ADMIN with an ACTIVE session, re-authenticated unless `reauth` is false. */
export async function adminSession(options: { reauth?: boolean; user?: TestUser } = {}): Promise<AdminSession> {
  const admin = options.user ?? (await createUser({ roles: ['SYSTEM_ADMIN'] }));
  const client = await login(admin);
  if (options.reauth ?? true) {
    expectStatus(await reauthenticate(client, admin.password ?? ''), 200, 're-authentication');
  }
  return { admin, client };
}

export function createAccount(client: Client, draft: Partial<AccountDraft>, options: RequestOptions = {}): Promise<ApiResponse> {
  return client.post('/api/v1/admin/accounts', draft, options);
}

export function reissueActivation(client: Client, userId: string): Promise<ApiResponse> {
  return client.post(`/api/v1/admin/accounts/${userId}/activation`);
}

const LINK = /(https?:\/\/[^\s"'<>]+)?\/activate#token=([A-Za-z0-9_-]+)/g;

export interface ActivationLink {
  readonly link: string;
  readonly token: string;
  readonly messageId: string;
}

export async function emailIds(userId: string): Promise<Set<string>> {
  return new Set((await outboundTo(userId, 'EMAIL')).map((m) => m.id));
}

/** The activation link of the newest e-mail sent to the user that is not in `before`. */
export async function activationLinkFor(userId: string, before: ReadonlySet<string> = new Set()): Promise<ActivationLink> {
  const fresh = (await outboundTo(userId, 'EMAIL')).filter((m) => !before.has(m.id));
  for (const message of [...fresh].reverse()) {
    const matches = [...message.body.matchAll(LINK)];
    const match = matches[matches.length - 1];
    if (match) {
      const token = match[2]!;
      trackSensitive('token', token);
      return { link: match[0], token, messageId: message.id };
    }
  }
  throw new Error(`no new e-mail with an activation link (${String(fresh.length)} new e-mails)`);
}

export function expectedLinkPrefix(): string {
  return `${appUrl()}/activate#token=`;
}

export async function activate(client: Client, token: string, password: string): Promise<ApiResponse> {
  return client.post('/api/v1/auth/activate', { token, password });
}
