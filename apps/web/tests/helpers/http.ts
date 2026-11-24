// HTTP harness of the integration suite. A Client plays one browser: it keeps
// a cookie jar, sends its client address in X-Real-IP (the only header the
// platform reads it from), sends Origin on every non-GET request, and fetches
// a CSRF token from GET /api/v1/csrf whenever its binding changed (no token
// yet, or a new __Host-mr-session / __Host-mr-csrf cookie).
//
// Requests are dispatched to the route handlers named by ENDPOINTS[i].module
// (src/server/http/registry.ts), with Next.js routing precedence (static
// segments before dynamic ones before catch-all ones). Handlers receive a
// standard Request and return a standard Response.
import { appOrigin, appUrl } from './env';
import { trackSensitive } from './sensitive';

export const COOKIE = {
  access: '__Host-mr-access',
  session: '__Host-mr-session',
  csrf: '__Host-mr-csrf',
  device: '__Host-mr-device',
  locale: '__Host-mr-locale',
  reading: '__Host-mr-reading',
} as const;

const HTTP_ONLY_COOKIES: readonly string[] = [COOKIE.access, COOKIE.session, COOKIE.csrf, COOKIE.device];

export type Method = 'GET' | 'POST';

export interface ApiError {
  readonly code: string;
  readonly messageKey: string;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;
}

export type Envelope<T = unknown> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

export interface ApiResponse<T = unknown> {
  readonly method: Method;
  readonly path: string;
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  /** the parsed body when it is JSON, otherwise undefined */
  readonly json: unknown;
  /** the body when it has the shape of the platform envelope */
  readonly envelope: Envelope<T> | null;
  readonly data: T | undefined;
  readonly error: ApiError | null;
  /** error.code, or null for a success or a non-envelope body */
  readonly code: string | null;
  readonly setCookies: readonly string[];
}

// ---------------------------------------------------------------------------
// Registry and routing

export interface EndpointEntry {
  readonly id: string;
  readonly method: Method;
  readonly path: string;
  readonly access: { readonly kind: string; readonly action?: string; readonly states?: readonly string[] };
  readonly module: string;
  readonly demoBuildOnly?: boolean;
}

export async function loadEndpoints(): Promise<readonly EndpointEntry[]> {
  const mod = (await import('@/server/http/registry')) as unknown as { ENDPOINTS?: readonly EndpointEntry[] };
  const endpoints = mod.ENDPOINTS;
  if (!endpoints) throw new Error('@/server/http/registry does not export ENDPOINTS');
  return endpoints;
}

type SegmentKind = 0 | 1 | 2 | 3; // static, dynamic, catch-all, optional catch-all
interface Segment {
  readonly kind: SegmentKind;
  readonly name: string;
}

/** Route segments of a module path such as '@/app/api/v1/notifications/[id]/read/route'. */
export function routeSegments(modulePath: string): Segment[] {
  const relative = modulePath
    .replace(/^@\/app\//, '')
    .replace(/(^|\/)route(\.demo)?(\.ts)?$/, '')
    .replace(/(^|\/)page(\.demo)?(\.tsx)?$/, '');
  return relative
    .split('/')
    .filter((s) => s.length > 0 && !/^\(.*\)$/.test(s))
    .map((s): Segment => {
      let m = /^\[\[\.\.\.(.+)\]\]$/.exec(s);
      if (m) return { kind: 3, name: m[1]! };
      m = /^\[\.\.\.(.+)\]$/.exec(s);
      if (m) return { kind: 2, name: m[1]! };
      m = /^\[(.+)\]$/.exec(s);
      if (m) return { kind: 1, name: m[1]! };
      return { kind: 0, name: s };
    });
}

/** The ENDPOINTS-style pattern of a module ('/api/v1/notifications/:id/read', '/api/*'). */
export function routePattern(modulePath: string): string {
  const parts = routeSegments(modulePath).map((s) => (s.kind === 0 ? s.name : s.kind === 1 ? `:${s.name}` : '*'));
  return `/${parts.join('/')}`;
}

function matchSegments(segments: readonly Segment[], parts: readonly string[]): Record<string, string | string[]> | null {
  const params: Record<string, string | string[]> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.kind === 2 || segment.kind === 3) {
      const rest = parts.slice(i);
      if (segment.kind === 2 && rest.length === 0) return null;
      params[segment.name] = rest.map((p) => decodeURIComponent(p));
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (segment.kind === 0 && segment.name !== part) return null;
    if (segment.kind === 1) params[segment.name] = decodeURIComponent(part);
  }
  return segments.length === parts.length ? params : null;
}

export interface ResolvedRoute {
  readonly endpoint: EndpointEntry;
  readonly params: Record<string, string | string[]>;
}

export async function resolveRoute(method: Method, pathname: string): Promise<ResolvedRoute> {
  const parts = pathname.split('/').filter((p) => p.length > 0);
  const candidates: { endpoint: EndpointEntry; params: Record<string, string | string[]>; rank: SegmentKind[] }[] = [];
  for (const endpoint of await loadEndpoints()) {
    if (endpoint.method !== method) continue;
    const segments = routeSegments(endpoint.module);
    const params = matchSegments(segments, parts);
    if (params) candidates.push({ endpoint, params, rank: segments.map((s) => s.kind) });
  }
  candidates.sort((a, b) => {
    const length = Math.max(a.rank.length, b.rank.length);
    for (let i = 0; i < length; i += 1) {
      const diff = (a.rank[i] ?? 9) - (b.rank[i] ?? 9);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  const best = candidates[0];
  if (!best) throw new Error(`no route handler in ENDPOINTS for ${method} ${pathname}`);
  return { endpoint: best.endpoint, params: best.params };
}

type RouteHandler = (req: Request, context: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

const moduleCache = new Map<string, Promise<Record<string, unknown>>>();

export function importRouteModule(spec: string): Promise<Record<string, unknown>> {
  let pending = moduleCache.get(spec);
  if (!pending) {
    // The specifier is a module path of the endpoint registry, never input.
    // eslint-disable-next-line no-unsanitized/method
    pending = import(/* @vite-ignore */ spec) as Promise<Record<string, unknown>>;
    moduleCache.set(spec, pending);
  }
  return pending;
}

async function handlerFor(endpoint: EndpointEntry): Promise<RouteHandler> {
  const mod = await importRouteModule(endpoint.module);
  const handler = mod[endpoint.method];
  if (typeof handler !== 'function') throw new Error(`${endpoint.module} does not export ${endpoint.method}`);
  return handler as RouteHandler;
}

// ---------------------------------------------------------------------------
// Client addresses

let ipCounter = 0;
const ipSalt = 1 + Math.floor(Math.random() * 250);

/** A client address no other request of this test file used. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${String(ipSalt)}.${String((ipCounter >> 8) & 255)}.${String(ipCounter & 255)}`;
}

// ---------------------------------------------------------------------------
// Responses recorded for the leak checks (memo row 17)

export interface RecordedResponse {
  readonly method: Method;
  readonly path: string;
  readonly endpointId: string;
  readonly status: number;
  /** headers except Set-Cookie, which carries the cookie values by design */
  readonly headers: string;
  readonly text: string;
}

const recorded: RecordedResponse[] = [];

export function recordedResponses(): readonly RecordedResponse[] {
  return recorded;
}

// ---------------------------------------------------------------------------
// Cookies

interface StoredCookie {
  readonly value: string;
  readonly attributes: Readonly<Record<string, string | true>>;
}

export function parseSetCookie(header: string): { name: string; value: string; attributes: Record<string, string | true> } {
  const [pair = '', ...attrs] = header.split(';');
  const eq = pair.indexOf('=');
  const name = (eq >= 0 ? pair.slice(0, eq) : pair).trim();
  const value = eq >= 0 ? pair.slice(eq + 1).trim() : '';
  const attributes: Record<string, string | true> = {};
  for (const attr of attrs) {
    const i = attr.indexOf('=');
    const key = (i >= 0 ? attr.slice(0, i) : attr).trim().toLowerCase();
    if (key) attributes[key] = i >= 0 ? attr.slice(i + 1).trim() : true;
  }
  return { name, value, attributes };
}

function isExpiry(attributes: Readonly<Record<string, string | true>>): boolean {
  const maxAge = attributes['max-age'];
  if (typeof maxAge === 'string' && Number(maxAge) <= 0) return true;
  const expires = attributes.expires;
  if (typeof expires === 'string') {
    const at = Date.parse(expires);
    if (!Number.isNaN(at) && at <= Date.now()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The client

export interface RequestOptions {
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  /** serialized as JSON */
  readonly body?: unknown;
  /** sent as is (no Content-Type is added) */
  readonly rawBody?: BodyInit;
  /** extra headers; null removes a header the client would send by default */
  readonly headers?: Readonly<Record<string, string | null>>;
  /** 'auto' (default) fetches a token when needed; 'none' sends none; a string is sent as is */
  readonly csrf?: 'auto' | 'none' | (string & {});
  /** Origin of a non-GET request; default the APP_URL origin; null omits it */
  readonly origin?: string | null;
  /** X-Real-IP for this request only; null omits it */
  readonly ip?: string | null;
  /** cookie overrides for this request only; null removes a cookie */
  readonly cookies?: Readonly<Record<string, string | null>>;
  /** full request URL (scheme and host), for forged-Host tests */
  readonly baseUrl?: string;
}

export class Client {
  readonly jar = new Map<string, StoredCookie>();
  ip: string | null;
  private csrfToken: string | null = null;
  private csrfBinding: string | null = null;

  constructor(options: { ip?: string | null } = {}) {
    this.ip = options.ip === undefined ? nextIp() : options.ip;
  }

  /** A second browser tab: same cookies and address, independent from then on. */
  clone(options: { ip?: string | null } = {}): Client {
    const copy = new Client({ ip: options.ip === undefined ? this.ip : options.ip });
    for (const [name, cookie] of this.jar) copy.jar.set(name, cookie);
    return copy;
  }

  cookie(name: string): string | undefined {
    return this.jar.get(name)?.value;
  }

  cookieAttributes(name: string): Readonly<Record<string, string | true>> | undefined {
    return this.jar.get(name)?.attributes;
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, { value, attributes: {} });
  }

  deleteCookie(name: string): void {
    this.jar.delete(name);
  }

  get hasSession(): boolean {
    return this.jar.has(COOKIE.session);
  }

  private bindingKey(): string {
    return `${this.cookie(COOKIE.session) ?? ''}|${this.cookie(COOKIE.csrf) ?? ''}`;
  }

  /** Fetches a CSRF token for the current binding from GET /api/v1/csrf. */
  async refreshCsrf(): Promise<string | null> {
    const res = await this.get('/api/v1/csrf');
    const data = res.data as { token?: unknown } | undefined;
    const token = typeof data?.token === 'string' ? data.token : null;
    this.csrfToken = token;
    this.csrfBinding = token === null ? null : this.bindingKey();
    return token;
  }

  async csrf(): Promise<string | null> {
    if (this.csrfToken === null || this.csrfBinding !== this.bindingKey()) return this.refreshCsrf();
    return this.csrfToken;
  }

  get<T = unknown>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  post<T = unknown>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body === undefined ? options : { ...options, body });
  }

  async request<T = unknown>(method: Method, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const url = new URL(path, `${options.baseUrl ?? appUrl()}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const route = await resolveRoute(method, url.pathname);

    const headers = new Headers();
    const realIp = options.ip === undefined ? this.ip : options.ip;
    if (realIp !== null) headers.set('X-Real-IP', realIp);
    if (method !== 'GET') {
      const origin = options.origin === undefined ? appOrigin() : options.origin;
      if (origin !== null) headers.set('Origin', origin);
      headers.set('Sec-Fetch-Site', 'same-origin');
      const csrf = options.csrf ?? 'auto';
      if (csrf === 'auto') {
        if (route.endpoint.access.kind !== 'public') {
          const token = await this.csrf();
          if (token !== null) headers.set('X-CSRF-Token', token);
        }
      } else if (csrf !== 'none') {
        headers.set('X-CSRF-Token', csrf);
      }
    }
    let body: BodyInit | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set('Content-Type', 'application/json');
    } else if (method !== 'GET') {
      body = '';
    }

    const cookies = new Map<string, string>();
    for (const [name, cookie] of this.jar) cookies.set(name, cookie.value);
    for (const [name, value] of Object.entries(options.cookies ?? {})) {
      if (value === null) cookies.delete(name);
      else cookies.set(name, value);
    }
    if (cookies.size > 0) {
      headers.set(
        'Cookie',
        [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }

    const init: RequestInit & { duplex?: 'half' } = { method, headers };
    if (body !== undefined) init.body = body;
    if (body instanceof ReadableStream) init.duplex = 'half';
    const request = new Request(url, init);

    const handler = await handlerFor(route.endpoint);
    const response = await handler(request, { params: Promise.resolve(route.params) });
    return this.absorb<T>(method, url.pathname, route.endpoint.id, response);
  }

  private async absorb<T>(method: Method, path: string, endpointId: string, response: Response): Promise<ApiResponse<T>> {
    const text = await response.text();
    const setCookies = response.headers.getSetCookie();
    for (const header of setCookies) {
      const { name, value, attributes } = parseSetCookie(header);
      if (!name) continue;
      if (value === '' || isExpiry(attributes)) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, { value, attributes });
        if (HTTP_ONLY_COOKIES.includes(name)) trackSensitive('token', value);
      }
    }
    // Clear-Site-Data: "cookies" removes every cookie of the origin.
    if (/"cookies"|"\*"/.test(response.headers.get('Clear-Site-Data') ?? '')) this.jar.clear();

    let json: unknown;
    if (text.length > 0 && (response.headers.get('Content-Type') ?? '').includes('json')) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
    }
    const envelope = isEnvelope<T>(json) ? json : null;
    const headerLines = [...response.headers.entries()]
      .filter(([name]) => name.toLowerCase() !== 'set-cookie')
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n');
    recorded.push({ method, path, endpointId, status: response.status, headers: headerLines, text });
    return {
      method,
      path,
      status: response.status,
      headers: response.headers,
      text,
      json,
      envelope,
      data: envelope?.ok ? envelope.data : undefined,
      error: envelope && !envelope.ok ? envelope.error : null,
      code: envelope && !envelope.ok ? envelope.error.code : null,
      setCookies,
    };
  }
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { ok?: unknown; error?: unknown };
  if (v.ok === true) return true;
  return v.ok === false && typeof v.error === 'object' && v.error !== null && typeof (v.error as { code?: unknown }).code === 'string';
}

/** One-line description of a response, for assertion messages. */
export function describeResponse(res: ApiResponse): string {
  return `${res.method} ${res.path} -> ${String(res.status)} ${res.code ?? (res.envelope?.ok ? 'ok' : res.text.slice(0, 120))}`;
}
