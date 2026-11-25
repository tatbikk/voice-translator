'use client';

// Browser side of the API envelope. Every state-changing request carries the
// CSRF token of the current binding, fetched just before the request: the
// binding changes when a session starts or changes, so a cached token would go
// stale.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; messageKey: string; fields?: Record<string, string>; retryAfterSeconds?: number } };

const NETWORK_ERROR = { code: 'NETWORK', messageKey: 'errors.network' };

async function csrfToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/csrf', { credentials: 'same-origin', cache: 'no-store' });
    const json = (await res.json()) as ApiResult<{ token: string }>;
    return json.ok ? json.data.token : null;
  } catch {
    return null;
  }
}

export async function apiPost<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<ApiResult<T>> {
  const token = await csrfToken();
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token ?? '' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/** An upload: the bytes as the body, what describes them in the query (read after authorization). */
export async function apiPostBytes<T = Record<string, unknown>>(
  path: string,
  query: Readonly<Record<string, string | number | undefined>>,
  bytes: Blob,
): Promise<ApiResult<T>> {
  const token = await csrfToken();
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(name, String(value));
  try {
    const res = await fetch(`${path}?${params.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': token ?? '' },
      body: bytes,
    });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function apiGet<T = Record<string, unknown>>(path: string, options: { background?: boolean } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.background ? { 'X-Background-Refresh': '1' } : {},
    });
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/** Full navigation, so that server components render again with the new cookies. */
export function navigate(path: string): void {
  window.location.assign(path);
}
