// Memo row 30 and contract §6: the security headers on a page, an API answer,
// a 404 and /healthz, served by the running application (next.config.ts
// headers() and the per-request CSP of src/proxy.ts); robots.txt disallows
// everything.
import { expect, test, type APIResponse } from '@playwright/test';
import { baseUrl, desktopOnly, nextAddress } from '../helpers/e2e';

const STATIC_HEADERS: Record<string, RegExp> = {
  'strict-transport-security': /^max-age=63072000; includeSubDomains$/,
  'x-content-type-options': /^nosniff$/,
  'referrer-policy': /^no-referrer$/,
  'permissions-policy': /^camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)$/,
  'x-frame-options': /^DENY$/,
  'cross-origin-opener-policy': /^same-origin$/,
  'cross-origin-resource-policy': /^same-origin$/,
  'x-robots-tag': /noindex, nofollow/,
};

function expectStaticHeaders(res: APIResponse, where: string): void {
  const headers = res.headers();
  for (const [name, pattern] of Object.entries(STATIC_HEADERS)) expect(headers[name] ?? '', `${name} on ${where}`).toMatch(pattern);
  expect(headers['x-powered-by'], `no X-Powered-By on ${where}`).toBeUndefined();
}

function expectCsp(res: APIResponse, where: string): string {
  const csp = res.headers()['content-security-policy'] ?? '';
  const directives = new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(/\s+/)[0] ?? '', d.split(/\s+/).slice(1)] as const),
  );
  expect(directives.get('default-src'), where).toEqual(["'self'"]);
  const script = directives.get('script-src') ?? [];
  expect(script, `script-src on ${where}`).toContain("'self'");
  expect(script, `script-src on ${where}`).toContain("'strict-dynamic'");
  expect(script.some((s) => /^'nonce-[A-Za-z0-9+/=_-]{16,}'$/.test(s)), `script-src nonce on ${where}`).toBe(true);
  const style = directives.get('style-src') ?? [];
  expect(style.some((s) => /^'nonce-/.test(s)), `style-src nonce on ${where}`).toBe(true);
  for (const [directive, value] of [
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ] as const) {
    expect(directives.get(directive), `${directive} on ${where}`).toEqual(value);
  }
  expect(directives.has('upgrade-insecure-requests'), where).toBe(true);
  expect(csp, where).not.toMatch(/unsafe-inline|unsafe-hashes|unsafe-eval/);
  return script.find((s) => s.startsWith("'nonce-")) ?? '';
}

test.describe('security headers (memo row 30)', () => {
  desktopOnly();

  test('a page carries the security headers, a per-request CSP nonce and no-store', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      const first = await request.get('/access', { headers: { 'X-Real-IP': nextAddress() } });
      expect(first.status()).toBe(200);
      expectStaticHeaders(first, 'a page');
      const nonce = expectCsp(first, 'a page');
      expect(first.headers()['cache-control'] ?? '', 'a dynamic page').toMatch(/no-store/);
      const second = await request.get('/access', { headers: { 'X-Real-IP': nextAddress() } });
      expect(expectCsp(second, 'a page'), 'a new nonce for every request').not.toBe(nonce);
      expect(await first.text(), 'the nonce of the header is the one of the inline scripts').toContain(nonce.replace(/^'nonce-|'$/g, ''));
    } finally {
      await request.dispose();
    }
  });

  test('a 404 carries the security headers and the CSP', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      const res = await request.get('/no-such-page', { headers: { 'X-Real-IP': nextAddress() }, maxRedirects: 0 });
      expect([404, 302, 303, 307, 308]).toContain(res.status());
      expectStaticHeaders(res, 'a 404');
      expectCsp(res, 'a 404');
    } finally {
      await request.dispose();
    }
  });

  test('an API answer and /healthz carry the security headers; the API answer is not cached', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      const api = await request.get('/api/v1/csrf', { headers: { 'X-Real-IP': nextAddress() } });
      expect(api.status()).toBe(200);
      expectStaticHeaders(api, 'an API answer');
      expect(api.headers()['cache-control'] ?? '').toMatch(/no-store/);
      const refused = await request.get('/api/v1/notifications', { headers: { 'X-Real-IP': nextAddress() } });
      expect(refused.status()).toBe(401);
      expectStaticHeaders(refused, 'an API refusal');
      const health = await request.get('/healthz', { headers: { 'X-Real-IP': nextAddress() } });
      expect(health.status()).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });
      expectStaticHeaders(health, '/healthz');
    } finally {
      await request.dispose();
    }
  });

  test('robots.txt forbids indexing everything', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      const res = await request.get('/robots.txt', { headers: { 'X-Real-IP': nextAddress() } });
      expect(res.status()).toBe(200);
      const text = await res.text();
      expect(text).toMatch(/User-agent:\s*\*/i);
      expect(text).toMatch(/Disallow:\s*\/\s*$/im);
    } finally {
      await request.dispose();
    }
  });
});
