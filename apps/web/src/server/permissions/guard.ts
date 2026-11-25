import 'server-only';
import { cache } from 'react';
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
import { PAGES } from '../http/page-registry';
import { recordRefusal, type RefusalStep } from '../security/refusals';

// Page guards (contract §7). Every page and every layout of the (gate) and
// (app) groups calls exactly one of them as its first statement. The request
// interceptor (proxy.ts) is never relied upon as a guard: every check is made
// again here, on the server, for every page.
//
// A layout and its page render in the same request, in parallel, and both call
// a guard. The request is therefore resolved once (session included), and a
// refusal is recorded once: a layout records it under the id of the page the
// path designates, so that the page's identical record is deduplicated.

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

interface RequestState {
  readonly req: Request;
  readonly path: string;
  readonly client: string;
  readonly access: boolean;
  readonly session: SessionContext | null;
}

/** The request, resolved once per server request (React cache). */
const requestState = cache(async (): Promise<RequestState> => {
  await clock.refresh();
  const { req, path } = await currentRequest();
  const access = hasAccess(req);
  return { req, path, client: clientIdHash(req), access, session: access ? await resolveSession(req) : null };
});

/** A refusal, written once per request for the same step, reason and target. */
const refuseOnce = cache(async (step: RefusalStep, reason: string, target: string): Promise<void> => {
  const state = await requestState();
  await recordRefusal({
    step,
    reason,
    target,
    clientIdHash: state.client,
    sessionId: state.session?.session.id ?? null,
    actor: state.session?.actor ?? null,
  });
});

/** Layout guards record a refusal under the id of the page the path designates. */
function refusalTarget(pageId: string, path: string): string {
  if (!pageId.startsWith('layout.')) return pageId;
  const pathname = path.split('?')[0] ?? path;
  return PAGES.find((page) => page.path === pathname)?.id ?? pageId;
}

export async function requireGate(pageId: string): Promise<GateContext> {
  const env = getEnv();
  const state = await requestState();
  if (!state.access) {
    await refuseOnce('GATE', 'ACCESS_CODE_REQUIRED', refusalTarget(pageId, state.path));
    redirect(`/access?next=${encodeURIComponent(state.path)}`);
  }
  return {
    req: state.req,
    path: state.path,
    locale: resolveLocale(readCookie(state.req, COOKIES.locale)),
    session: state.session,
    subject: state.session?.subject ?? { kind: 'anonymous' },
    clientIdHash: state.client,
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
  await refuseOnce('SESSION', 'SESSION_REQUIRED', refusalTarget(pageId, context.path));
  loginRedirect('/dashboard');
}

/**
 * The page guard. The resource may be given as a loader, run only once the
 * session is established: a file that does not exist is then answered exactly
 * like a file the subject may not see.
 */
export async function requirePage(
  pageId: string,
  action: ActionCode,
  resource?: Resource | (() => Promise<Resource | null>),
): Promise<PageContext & { resource: Resource | undefined }> {
  const context = await requireGate(pageId);
  const { session } = context;
  if (!session?.subject) {
    await refuseOnce('SESSION', 'SESSION_REQUIRED', refusalTarget(pageId, context.path));
    if (session?.session.state === 'PENDING_SECOND_FACTOR') redirect('/login/confirm');
    if (session?.session.state === 'PENDING_ROLE') redirect('/login/role');
    loginRedirect(context.path);
  }
  const loaded = typeof resource === 'function' ? await resource() : resource;
  if (loaded === null) {
    await refuseOnce('AUTHZ', 'NOT_FOUND', refusalTarget(pageId, context.path));
    notFound();
  }
  const decision = authorize(session.subject, action, loaded, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
    now: clock.now(),
  });
  if (!decision.allowed) {
    await refuseOnce('AUTHZ', decision.reason, refusalTarget(pageId, context.path));
    notFound();
  }
  return { ...context, session, subject: session.subject, resource: loaded };
}

export async function requireDemo(pageId: string, action: ActionCode): Promise<GateContext> {
  const context = await requireGate(pageId);
  const decision = authorize(context.subject, action, undefined, {
    mode: context.mode,
    demoToolsEnabled: context.demoToolsEnabled,
  });
  if (!decision.allowed) {
    await refuseOnce('MODE', decision.reason, refusalTarget(pageId, context.path));
    notFound();
  }
  return context;
}

/**
 * For a page's metadata: the subject of the request as resolved, or anonymous.
 * It refuses nothing and redirects nowhere; the page's own guard does that.
 */
export async function currentSubject(): Promise<Subject> {
  const state = await requestState();
  return state.session?.subject ?? { kind: 'anonymous' };
}

/** For layouts and components below a guarded page: the locale only. */
export async function currentLocale(): Promise<Locale> {
  const incoming = await headers();
  return resolveLocale(parseCookieHeader(incoming.get('cookie')).get(COOKIES.locale) ?? null);
}
