import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  SECURITY_POLICY,
  authorize,
  type ActionCode,
  type LimitRule,
  type Resource,
  type Subject,
} from '@mahkama/core';
import type { z } from 'zod';
import { getEnv } from '../config/env';
import { clock } from '../clock';
import { hasAccess } from '../auth/access-gate';
import { HashingBusyError } from '../auth/passwords';
import { clientIdHash as computeClientIdHash } from '../auth/client-id';
import { bindingIdFromRequest, csrfTokenValid } from '../auth/csrf';
import { recentlyReauthenticated, resolveSession, type SessionContext, type SessionState } from '../auth/sessions';
import { log, errorFields } from '../log';
import { recordRefusal, type RefusalStep } from '../security/refusals';
import { consume } from '../security/rate-limit';
import { fail, type ErrorCode } from './responses';

// Every API route is built with defineEndpoint (contract §6). The wrapper applies
// the checks in a fixed order, each failing closed, and writes every refusal to
// the event log (through the refusal throttle):
//   1 body size and method  2 visitor gate  3 mode (demo endpoints)  4 CSRF
//   5 session  6 rate limit  7 path/query parameters  8 authorization
//   9 recent re-authentication  10 body  11 handler
// A body beyond the default limit (an upload, the pasted application) is not
// read before step 10: whoever may not act never makes the server buffer it.

const HASHING_RETRY_AFTER_SECONDS = 5;

export type EndpointAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'pre-gate' }
  | { readonly kind: 'gate' }
  | { readonly kind: 'session' }
  | {
      readonly kind: 'pending-session';
      readonly states: readonly SessionState[];
      /** also allowed to an active session holding this action */
      readonly orAction?: ActionCode;
    }
  | { readonly kind: 'action'; readonly action: ActionCode }
  /** an action named by the request itself (a case file's action route): unknown names answer 404 */
  | { readonly kind: 'named-action'; readonly prefix: 'case.' }
  | { readonly kind: 'demo'; readonly action: ActionCode };

export interface EndpointContext<P, B> {
  readonly req: Request;
  readonly params: P;
  readonly body: B;
  readonly session: SessionContext | null;
  readonly subject: Subject;
  readonly clientIdHash: string;
  /** the resource the action was authorized on, when the endpoint loads one */
  readonly resource: Resource | undefined;
  /** the action authorized, for named-action endpoints */
  readonly action: string | null;
  /** the raw bytes of an upload (binary endpoints), read after authorization within their limit */
  readonly bytes: Uint8Array | null;
}

export interface EndpointDefinition<P, B> {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly access: EndpointAccess;
  readonly recentAuthMinutes?: number;
  readonly params?: z.ZodType<P>;
  readonly body?: z.ZodType<B>;
  readonly rateLimit?: (clientIdHash: string, session: SessionContext | null) => { key: string; rule: LimitRule };
  /**
   * Loads the resource the action applies to; null means "not found". It sees the
   * raw body, not yet validated (step 10 validates it), and must read it defensively.
   */
  readonly resource?: (params: P, context: { session: SessionContext | null; rawBody: unknown }) => Promise<Resource | null>;
  readonly handler: (context: EndpointContext<P, B>) => Promise<Response>;
  /**
   * The answer to give, instead of 403, when the core refuses for a condition of
   * a resource the subject may otherwise hold (its own payment that lapsed, say):
   * the refusal is recorded as any other. Null keeps the 403.
   */
  readonly conditionAnswer?: (resource: Resource) => { readonly status: number; readonly code: ErrorCode } | null;
  /** named-action endpoints: the action named by the parameters */
  readonly actionFrom?: (params: P) => string;
  /** false for /healthz, which must answer 503 by itself when the database is down */
  readonly platformClock?: boolean;
  /** a JSON body above the default limit, read after authorization (Phase 2) */
  readonly bodyLimitBytes?: number;
  /**
   * Raw bytes (application/octet-stream), read after authorization and cut at
   * the limit of their place; the parameters carry the metadata (Phase 2 uploads).
   */
  readonly binary?: { readonly absoluteMaxBytes: number; readonly maxBytes: (params: P, resource: Resource | undefined) => number };
  /**
   * A GET with effects beyond the record of the read itself (it asks an
   * outside register, spends a budget of the session): it passes the CSRF step
   * as a state-changing request does, so that a navigation from another site
   * cannot run it in the user's name (decision 80). A download is a plain read.
   */
  readonly sideEffects?: true;
}

export interface EndpointHandler {
  (req: Request): Promise<Response>;
  readonly endpointId: string;
  readonly endpointMethod: 'GET' | 'POST';
  /** the definition itself, which the registry must match (review A-17) */
  readonly endpointPath: string;
  readonly endpointAccess: EndpointAccess;
  /** a GET that passes the CSRF step (decision 80) */
  readonly endpointSideEffects: boolean;
}

/** Path parameters are taken from the URL by position against the declared path. */
function pathParams(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = pathname.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (const [i, segment] of a.entries()) {
    const value = b[i];
    if (value === undefined) return null;
    if (segment.startsWith(':')) {
      try {
        out[segment.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (segment !== value) {
      return null;
    }
  }
  return out;
}

/** The request body as bytes, cut at `max`: a body beyond it is never read to its end. */
async function readBytes(req: Request, max: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: 'PAYLOAD_TOO_LARGE' | 'INVALID_INPUT' }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
  if (!req.body) return { ok: true, bytes: new Uint8Array() };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      // The client went away before its body was sent: a refused request, not a fault of the platform.
      return { ok: false, code: 'INVALID_INPUT' };
    }
    const { done, value } = chunk;
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: new Uint8Array(Buffer.concat(chunks)) };
}

async function readBody(req: Request, max: number = SECURITY_POLICY.body.maxBytes): Promise<{ ok: true; value: unknown } | { ok: false; code: 'PAYLOAD_TOO_LARGE' | 'INVALID_INPUT' }> {
  const read = await readBytes(req, max);
  if (!read.ok) return read;
  const size = read.bytes.byteLength;
  const chunks = [read.bytes];
  if (size === 0) return { ok: true, value: {} };
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const name = issue.path.map(String).join('.') || 'form';
    fields[name] ??= issue.code === 'too_big' ? 'errors.field.tooLong' : issue.code === 'too_small' ? 'errors.field.tooShort' : 'errors.field.invalid';
  }
  return fields;
}

export function defineEndpoint<P = Record<string, never>, B = Record<string, never>>(
  definition: EndpointDefinition<P, B>,
): EndpointHandler {
  const handler = async (req: Request): Promise<Response> => {
    let session: SessionContext | null = null;
    // Set inside the try below; a refusal before it counts under the shared bucket.
    let clientIdHash = 'unknown';

    const refuse = async (step: RefusalStep, status: number, code: ErrorCode, extra: Parameters<typeof fail>[2] = {}) => {
      const logged = await recordRefusal({
        step,
        reason: code,
        target: definition.id,
        clientIdHash,
        sessionId: session?.session.id ?? null,
        actor: session?.actor ?? null,
      });
      return logged ? fail(status, code, extra) : fail(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: 60 });
    };

    try {
      // Inside the error envelope: a database outage answers 500 with a
      // correlation id, never with the error's text (review A-14).
      const env = getEnv();
      if (definition.platformClock !== false) await clock.refresh();
      clientIdHash = computeClientIdHash(req);

      // 1. Method and body size. A large body is only measured here: its
      // declared length against the endpoint's ceiling; it is read at step 10.
      if (req.method !== definition.method) return await refuse('METHOD', 405, 'METHOD_NOT_ALLOWED');
      let rawBody: unknown = {};
      const deferred = definition.binary !== undefined || definition.bodyLimitBytes !== undefined;
      if (definition.method === 'POST' && !deferred) {
        const body = await readBody(req);
        if (!body.ok) return await refuse('BODY', body.code === 'PAYLOAD_TOO_LARGE' ? 413 : 422, body.code);
        rawBody = body.value;
      }
      if (deferred) {
        const ceiling = definition.binary?.absoluteMaxBytes ?? definition.bodyLimitBytes ?? SECURITY_POLICY.body.maxBytes;
        const declared = Number(req.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > ceiling) return await refuse('BODY', 413, 'PAYLOAD_TOO_LARGE');
        const type = (req.headers.get('content-type') ?? '').toLowerCase();
        if (definition.binary && !type.startsWith('application/octet-stream')) return await refuse('BODY', 415, 'UNSUPPORTED_MEDIA_TYPE');
      }

      const access = definition.access;

      // 2. Visitor gate.
      if (access.kind !== 'public' && access.kind !== 'pre-gate' && !hasAccess(req)) {
        return await refuse('GATE', 401, 'ACCESS_CODE_REQUIRED');
      }

      // 3. Mode: demo endpoints do not exist outside the demo environment.
      if (access.kind === 'demo' && !env.demoToolsEnabled) return await refuse('MODE', 404, 'NOT_FOUND');

      // The session is read now because the CSRF binding depends on it.
      if (access.kind !== 'public') session = await resolveSession(req);

      // 4. CSRF for every state-changing request, and every GET with effects (decision 80).
      // Public endpoints change no state.
      if ((definition.method !== 'GET' || definition.sideEffects === true) && access.kind !== 'public') {
        const origin = req.headers.get('origin');
        const fetchSite = req.headers.get('sec-fetch-site');
        const binding = session?.session.id ?? bindingIdFromRequest(req);
        // A browser sends no Origin with a same-origin GET: the token and Sec-Fetch-Site decide it.
        const originOk = origin === env.appOrigin || (definition.method === 'GET' && origin === null);
        const sameOrigin = originOk && (fetchSite === null || fetchSite === 'same-origin');
        if (!sameOrigin || !csrfTokenValid(req.headers.get('x-csrf-token'), binding)) {
          return await refuse('CSRF', 403, 'CSRF_REJECTED');
        }
      }

      // 5. Session.
      if (access.kind === 'session' && !session) return await refuse('SESSION', 401, 'SESSION_REQUIRED');
      if (access.kind === 'pending-session') {
        const pendingOk = session !== null && access.states.includes(session.session.state);
        const activeOk = access.orAction !== undefined && session?.subject != null;
        if (!pendingOk && !activeOk) return await refuse('SESSION', 401, 'SESSION_REQUIRED');
      }
      if ((access.kind === 'action' || access.kind === 'named-action') && !session?.subject) {
        return await refuse('SESSION', 401, 'SESSION_REQUIRED');
      }

      // 6. Rate limit.
      if (definition.rateLimit) {
        const { key, rule } = definition.rateLimit(clientIdHash, session);
        const limit = await consume(key, rule);
        if (limit.limited) return await refuse('RATE', 429, 'TOO_MANY_REQUESTS', { retryAfterSeconds: limit.retryAfterSeconds });
      }

      // 7. Path and query parameters.
      let params = {} as P;
      if (definition.params) {
        const url = new URL(req.url);
        const fromPath = pathParams(definition.path, url.pathname) ?? {};
        const parsed = definition.params.safeParse({ ...Object.fromEntries(url.searchParams), ...fromPath });
        if (!parsed.success) {
          // A malformed identifier names no resource: the same 404 as an unknown one,
          // whether it sits in the path or in the query (the demo switch target).
          const resourceRoute = definition.path.includes(':') || definition.resource !== undefined;
          return resourceRoute
            ? await refuse('PARAMS', 404, 'NOT_FOUND')
            : await refuse('PARAMS', 422, 'INVALID_INPUT', { fields: fieldErrors(parsed.error) });
        }
        params = parsed.data;
      }

      // 8. Authorization, through the single core function.
      const subject: Subject = session?.subject ?? { kind: 'anonymous' };
      const named = access.kind === 'named-action' ? (definition.actionFrom?.(params) ?? '') : null;
      const action: string | null =
        access.kind === 'action' || access.kind === 'demo'
          ? access.action
          : access.kind === 'named-action'
            ? named !== null && named.startsWith(access.prefix)
              ? named
              : 'unknown'
            : access.kind === 'pending-session' && access.orAction && session?.subject
              ? access.orAction
              : null;
      let resource: Resource | undefined;
      if (action) {
        const authContext = { mode: env.mode, demoToolsEnabled: env.demoToolsEnabled, now: clock.now() };
        const refuseDecision = async (reason: string) => {
          // An unknown action is an unknown resource: the same 404, the same record.
          const notFound = reason === 'NOT_FOUND' || reason === 'MODE_NOT_PERMITTED' || reason === 'UNKNOWN_ACTION';
          return await refuse('AUTHZ', notFound ? 404 : 403, notFound ? 'NOT_FOUND' : 'FORBIDDEN');
        };
        if (definition.resource) {
          // Whoever may not hold the action at all is refused before the resource
          // is looked up: the answer is then the same for an existing and an
          // unknown identifier, and reveals nothing about either.
          const holder = authorize(subject, action, undefined, authContext);
          if (!holder.allowed && holder.reason !== 'NOT_FOUND') return await refuseDecision(holder.reason);
          const loaded = await definition.resource(params, { session, rawBody });
          if (!loaded) return await refuse('AUTHZ', 404, 'NOT_FOUND');
          resource = loaded;
        }
        const decision = authorize(subject, action, resource, authContext);
        if (!decision.allowed) {
          const answer = decision.reason === 'CONDITION_NOT_MET' && resource && definition.conditionAnswer ? definition.conditionAnswer(resource) : null;
          if (answer) return await refuse('AUTHZ', answer.status, answer.code);
          return await refuseDecision(decision.reason);
        }
      }

      // 9. Recent re-authentication. A session created by the demo switcher never carries one.
      if (definition.recentAuthMinutes !== undefined) {
        if (!session || !recentlyReauthenticated(session.session, definition.recentAuthMinutes)) {
          return await refuse('REAUTH', 403, 'REAUTH_REQUIRED');
        }
      }

      // 10. Body: a deferred body is read now, within its limit.
      let bytes: Uint8Array | null = null;
      if (definition.binary) {
        const read = await readBytes(req, definition.binary.maxBytes(params, resource));
        if (!read.ok) return await refuse('BODY', read.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, read.code);
        bytes = read.bytes;
      } else if (definition.bodyLimitBytes !== undefined) {
        const read = await readBody(req, definition.bodyLimitBytes);
        if (!read.ok) return await refuse('BODY', read.code === 'PAYLOAD_TOO_LARGE' ? 413 : 422, read.code);
        rawBody = read.value;
      }
      let body = {} as B;
      if (definition.body) {
        const parsed = definition.body.safeParse(rawBody);
        if (!parsed.success) {
          return await refuse('BODY', 422, 'INVALID_INPUT', { fields: fieldErrors(parsed.error) });
        }
        body = parsed.data;
      }

      // 11. Handler.
      return await definition.handler({ req, params, body, session, subject, clientIdHash, resource, action, bytes });
    } catch (error) {
      if (error instanceof HashingBusyError) {
        // Too many password checks waiting (review S-03): a temporary refusal, not a fault.
        log.warn('endpoint busy', { endpoint: definition.id, cause: 'HASHING_QUEUE_FULL' });
        return fail(503, 'UNAVAILABLE', { retryAfterSeconds: HASHING_RETRY_AFTER_SECONDS });
      }
      const correlationId = randomUUID();
      log.error('endpoint failed', { endpoint: definition.id, correlationId, ...errorFields(error) });
      return fail(500, 'INTERNAL', { correlationId });
    }
  };
  return Object.assign(handler, {
    endpointId: definition.id,
    endpointMethod: definition.method,
    endpointPath: definition.path,
    endpointAccess: definition.access,
    endpointSideEffects: definition.sideEffects === true,
  });
}
