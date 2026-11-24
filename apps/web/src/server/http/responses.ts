import 'server-only';

// The response envelope of every API route (contract §6):
//   { ok: true, data } | { ok: false, error: { code, messageKey, fields?, retryAfterSeconds? } }
// messageKey is an i18n key; the client renders the Arabic text.

export type ErrorCode =
  | 'ACCESS_CODE_REQUIRED'
  | 'ACCESS_CODE_INVALID'
  | 'NOT_FOUND'
  | 'CSRF_REJECTED'
  | 'SESSION_REQUIRED'
  | 'TOO_MANY_REQUESTS'
  | 'FORBIDDEN'
  | 'REAUTH_REQUIRED'
  | 'INVALID_INPUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'INVALID_CODE'
  | 'CODE_EXPIRED'
  | 'INVALID_TOKEN'
  | 'PASSWORD_POLICY'
  | 'CASE_NOT_FOUND'
  | 'ROLE_NOT_COMBINABLE'
  | 'EMAIL_TAKEN'
  | 'UNAVAILABLE';

export interface ResponseOptions {
  readonly cookies?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
}

function build(status: number, payload: unknown, options: ResponseOptions = {}): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...options.headers,
  });
  for (const cookie of options.cookies ?? []) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(payload), { status, headers });
}

export function ok(data: unknown = {}, options?: ResponseOptions): Response {
  return build(200, { ok: true, data }, options);
}

export function fail(
  status: number,
  code: ErrorCode,
  extra: { fields?: Record<string, string>; retryAfterSeconds?: number; correlationId?: string } = {},
  options: ResponseOptions = {},
): Response {
  const error: Record<string, unknown> = { code, messageKey: `errors.${code}` };
  if (extra.fields) error.fields = extra.fields;
  if (extra.retryAfterSeconds !== undefined) error.retryAfterSeconds = extra.retryAfterSeconds;
  if (extra.correlationId) error.correlationId = extra.correlationId;
  const headers: Record<string, string> = { ...options.headers };
  if (extra.retryAfterSeconds !== undefined) headers['Retry-After'] = String(extra.retryAfterSeconds);
  return build(status, { ok: false, error }, { cookies: options.cookies ?? [], headers });
}

export function notFound(options?: ResponseOptions): Response {
  return fail(404, 'NOT_FOUND', {}, options);
}
