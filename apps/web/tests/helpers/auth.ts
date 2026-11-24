// The visitor and login flows of contract §6, driven through the route
// handlers: visitor passphrase → login → code read from "OutboundMessage"
// (written by the simulated messaging provider) → second factor → role
// selection when the user holds several roles.
import type { RoleCode } from '@mahkama/core';
import { liveSession, outboundTo, sql, type SessionRow } from './db';
import { requireEnv } from './env';
import type { TestUser } from './factories';
import { COOKIE, Client, describeResponse, type ApiResponse } from './http';
import { trackSensitive } from './sensitive';

export function accessCode(): string {
  return requireEnv('ACCESS_CODE');
}

export function expectStatus(res: ApiResponse, status: number, what = 'request'): void {
  if (res.status !== status) {
    throw new Error(`${what}: expected ${String(status)}, got ${describeResponse(res)}`);
  }
}

/** POST /api/v1/access with the visitor passphrase (after fetching a CSRF token before the gate). */
export async function passGate(client: Client, code: string = accessCode(), next?: string): Promise<ApiResponse> {
  return client.post('/api/v1/access', next === undefined ? { code } : { code, next });
}

/** A new browser that has passed the visitor gate. */
export async function visitor(options: { ip?: string | null } = {}): Promise<Client> {
  const client = new Client(options);
  expectStatus(await passGate(client), 200, 'visitor passphrase');
  if (!client.cookie(COOKIE.access)) throw new Error('POST /api/v1/access set no __Host-mr-access cookie');
  return client;
}

export async function smsIds(userId: string): Promise<Set<string>> {
  return new Set((await outboundTo(userId, 'SMS')).map((m) => m.id));
}

const CODE = /(?<!\d)\d{6}(?!\d)/g;

export function codesIn(body: string): string[] {
  return body.match(CODE) ?? [];
}

/** The code of the newest SMS sent to the user that is not in `before`. */
export async function newCodeFor(userId: string, before: ReadonlySet<string>): Promise<string> {
  const fresh = (await outboundTo(userId, 'SMS')).filter((m) => !before.has(m.id));
  const withCode = fresh.filter((m) => codesIn(m.body).length === 1);
  const message = withCode[withCode.length - 1];
  if (!message) throw new Error(`no new SMS with exactly one six-digit code (${String(fresh.length)} new SMS)`);
  const code = codesIn(message.body)[0]!;
  trackSensitive('code', code);
  return code;
}

/** A six-digit code different from `code` (a wrong guess). */
export function wrongCode(code: string): string {
  const n = (Number(code) + 1 + Math.floor(Math.random() * 999_998)) % 1_000_000;
  const guess = String(n).padStart(6, '0');
  return guess === code ? String((n + 1) % 1_000_000).padStart(6, '0') : guess;
}

export interface PendingLogin {
  readonly client: Client;
  readonly response: ApiResponse;
  /** the code sent for this login */
  readonly code: string;
}

/** Visitor gate (if needed) and POST /api/v1/auth/login; returns the code sent to the user. */
export async function startLogin(user: TestUser, options: { client?: Client; password?: string } = {}): Promise<PendingLogin> {
  const client = options.client ?? new Client();
  if (!client.cookie(COOKIE.access)) expectStatus(await passGate(client), 200, 'visitor passphrase');
  const password = options.password ?? user.password;
  if (password === null) throw new Error('startLogin: the user has no password');
  const before = await smsIds(user.id);
  const response = await client.post('/api/v1/auth/login', { email: user.email, password });
  expectStatus(response, 200, 'login');
  const code = await newCodeFor(user.id, before);
  return { client, response, code };
}

export async function submitCode(client: Client, code: string): Promise<ApiResponse> {
  return client.post('/api/v1/auth/second-factor', { code });
}

export async function resendCode(client: Client): Promise<ApiResponse> {
  return client.post('/api/v1/auth/second-factor/resend');
}

export async function selectRole(client: Client, roleAssignmentId: string): Promise<ApiResponse> {
  return client.post('/api/v1/auth/role', { roleAssignmentId });
}

export async function reauthenticate(client: Client, password: string): Promise<ApiResponse> {
  return client.post('/api/v1/auth/reauth', { password });
}

export async function currentSession(user: TestUser): Promise<SessionRow> {
  const session = await liveSession(user.id);
  if (!session) throw new Error('the user has no live session');
  return session;
}

export interface LoginOptions {
  readonly client?: Client;
  /** the role to select when the user holds several */
  readonly role?: RoleCode;
  readonly roleAssignmentId?: string;
  /** stop before role selection, leaving a PENDING_ROLE session */
  readonly stopAtRole?: boolean;
}

/** The full login of contract §6, ending with an ACTIVE session (or PENDING_ROLE with stopAtRole). */
export async function login(user: TestUser, options: LoginOptions = {}): Promise<Client> {
  const pending = await startLogin(user, options.client ? { client: options.client } : {});
  const client = pending.client;
  expectStatus(await submitCode(client, pending.code), 200, 'second factor');
  let session = await currentSession(user);
  if (session.state === 'PENDING_ROLE' && !options.stopAtRole) {
    const target =
      options.roleAssignmentId ??
      (options.role ? user.roles.find((r) => r.role === options.role)?.id : undefined) ??
      user.roleAssignmentId;
    expectStatus(await selectRole(client, target), 200, 'role selection');
    session = await currentSession(user);
  }
  const expected = options.stopAtRole && user.roles.length > 1 ? 'PENDING_ROLE' : 'ACTIVE';
  if (session.state !== expected) throw new Error(`login ended in state ${session.state}, expected ${expected}`);
  return client;
}

/** A session still waiting for the second factor. */
export async function pendingSecondFactor(user: TestUser, client?: Client): Promise<PendingLogin> {
  return startLogin(user, client ? { client } : {});
}

/** Moves the last activity of every live session of the user back by `minutes`. */
export async function ageSessions(userId: string, minutes: number): Promise<void> {
  await sql(
    `UPDATE "Session" SET "lastSeenAt" = "lastSeenAt" - make_interval(mins => $2::int)
      WHERE "userId" = $1 AND "revokedAt" IS NULL`,
    [userId, minutes],
  );
}
