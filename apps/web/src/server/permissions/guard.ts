import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { authorize, safeInternalPath, type ActionCode, type Resource, type Subject, type UserSubject } from '@mahkama/core';
import { resolveLocale, type Locale } from '@/i18n/locales';
import { getEnv } from '../config/env';
import { clock } from '../clock';
import { hasAccess } from '../auth/access-gate';
import { clientIdHash } from '../auth/client-id';
import { resolveSession, type SessionContext, type SessionState } from '../auth/sessions';
import { COOKIES, parseCookieHeader, readCookie } from '../http/cookies';
import { recordRefusal } from '../security/refusals';

// Page guards (contract §7). Every page and every layout of the (gate) and
// (app) groups calls exactly one of them as its first statement. The request
// interceptor (proxy.ts) is never relied upon as a guard: every check is made
// again here, on the server, for every page.

export interface GateContext {
  readonly req: Request;
  readonly path: string;
  readonly locale: Locale;
  readonly session: SessionContext | null;
  readonly subject: Subject;
  readonly clientIdHash: string;
  readonly mode: 'demo' | 'production';
  readonly demoToolsEnabled: boolean;
}

export interface PageContext extends GateContext {
  readonly session: SessionContext;
  readonly subject: UserSubject;
}

async function currentRequest(): Promise<{ req: Request; path: string }> {
  const incoming = await headers();
  const origin = getEnv().appOrigin;
  const path = safeInternalPath(incoming.get('x-mr-path') ?? '/', origin);
  return { req: new Request(new URL(path, origin), { headers: new Headers(incoming) }), path };
}

function loginRedirect(path: string): never {
  redirect(`/login?next=${encodeURIComponent(path)}`);
}

export async function requireGate(pageId: string): Promise<GateContext> {
  await clock.refresh();
  const env = getEnv();
  const { req, path } = await currentRequest();
  const client = clientIdHash(req);
  if (!hasAccess(req)) {
    await recordRefusal({ step: 'GATE', reason: 'ACCESS_CODE_REQUIRED', target: pageId, clientIdHash: client, sessionId: null, actor: null });
    redirect(`/access?next=${encodeURIComponent(path)}`);
  }
  const session = await resolveSession(req);
  return {
    req,
    path,
    locale: resolveLocale(readCookie(req, COOKIES.locale)),
    session,
    subject: session?.subject ?? { kind: 'anonymous' },
    clientIdHash: client,
    mode: env.mode,
    demoToolsEnabled: env.demoToolsEnabled,
  };
}

export async function requirePending(
  pageId: string,
  states: readonly SessionState[],
  options: { orAction?: ActionCode } = {},
): Promise<GateContext & { session: SessionContext }> {
  const context = await requireGate(pageId);
  const { session } = context;
  if (session && states.includes(session.session.state)) return { ...context, session };
  if (session?.subject && options.orAction) {
    const decision = authorize(session.subject, options.orAction, undefined, {
      mode: context.mode,
      demoToolsEnabled: context.demoToolsEnabled,
    });
    if (decision.allowed) return { ...context, session };
  }
  await recordRefusal({
    step: 'SESSION',
    reason: 'SESSION_REQUIRED',
    target: pageId,
    clientIdHash: context.clientIdHash,
    sessionId: session?.session.id ?? null,
    actor: session?.actor ?? null,
  });
  loginRedirect('/dashboard');
}

export async function requirePage(pageId: string, action: ActionCode, resource?: Resource): Promise<PageContext> {
  const context = await requireGate(pageId);
  const { session } = context;
  if (!session?.subject) {
    await recordRefusal({
      step: 'SESSION',
      reason: 'SESSION_REQUIRED',
      target: pageId,
      clientIdHash: context.clientIdHash,
      sessionId: session?.session.id ?? null,
      actor: session?.actor ?? null,
    });
    if (session?.session.state === 'PENDING_SECOND_FACTOR') redirect('/login/confirm');
    if (session?.session.state === 'PENDING_ROLE') redirect('/login/role');
    loginRedirect(context.path);
  }
  const decision = authorize(session.subject, action, resource, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
  });
  if (!decision.allowed) {
    await recordRefusal({
      step: 'AUTHZ',
      reason: decision.reason,
      target: pageId,
      clientIdHash: context.clientIdHash,
      sessionId: session.session.id,
      actor: session.actor,
    });
    notFound();
  }
  return { ...context, session, subject: session.subject };
}

export async function requireDemo(pageId: string, action: ActionCode): Promise<GateContext> {
  const context = await requireGate(pageId);
  const decision = authorize(context.subject, action, undefined, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
  });
  if (!decision.allowed) {
    await recordRefusal({
      step: 'MODE',
      reason: decision.reason,
      target: pageId,
      clientIdHash: context.clientIdHash,
      sessionId: context.session?.session.id ?? null,
      actor: context.session?.actor ?? null,
    });
    notFound();
  }
  return context;
}

/** For layouts and components below a guarded page: the locale only. */
export async function currentLocale(): Promise<Locale> {
  const incoming = await headers();
  return resolveLocale(parseCookieHeader(incoming.get('cookie')).get(COOKIES.locale) ?? null);
}
