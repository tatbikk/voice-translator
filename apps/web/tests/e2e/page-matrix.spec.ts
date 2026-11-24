// Memo row 2 and contract §13 item 5 for the pages, through Playwright's
// request contexts (cookies of their own): every page without the access
// cookie redirects to /access?next=<page>; past the gate without a session the
// gate-level pages answer 200 and the session pages redirect to /login; the
// administration pages answer 404 to every other role (login-roles.spec.ts).
// A request asking Next.js to skip the proxy is still refused by the page
// guard itself: the proxy is a convenience, never the guard.
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { baseUrl, desktopOnly, nextAddress, passGateRequest } from '../helpers/e2e';
import { DASHBOARD, PAGE_TITLES } from '../helpers/labels';
import { EXPECTED_PAGES } from '../helpers/pages';

const REDIRECT = [302, 303, 307, 308];

function redirectTarget(res: APIResponse): URL {
  return new URL(res.headers().location ?? '', baseUrl());
}

async function get(request: APIRequestContext, path: string, headers: Record<string, string> = {}): Promise<APIResponse> {
  return request.get(path, { maxRedirects: 0, headers: { 'X-Real-IP': nextAddress(), ...headers } });
}

test.describe('page refusal matrix (memo row 2)', () => {
  desktopOnly();

  test('without the access cookie, every page but «كلمة عبور الزوار» redirects to /access with the page as next', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      for (const page of EXPECTED_PAGES) {
        const res = await get(request, page.path);
        if (page.path === '/access') {
          expect(res.status(), page.path).toBe(200);
          continue;
        }
        expect(REDIRECT, `${page.path} answers ${String(res.status())}`).toContain(res.status());
        const target = redirectTarget(res);
        expect(target.origin, page.path).toBe(new URL(baseUrl()).origin);
        expect(target.pathname, page.path).toBe('/access');
        expect(target.searchParams.get('next'), page.path).toBe(page.path);
      }
    } finally {
      await request.dispose();
    }
  });

  test('past the gate without a session, gate-level pages answer 200 and session pages redirect to /login', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      await passGateRequest(request, { 'X-Real-IP': nextAddress() });
      for (const page of EXPECTED_PAGES.filter((p) => p.path !== '/access')) {
        const res = await get(request, page.path);
        if (page.session === 'none') {
          expect(res.status(), page.path).toBe(200);
          expect(await res.text(), page.path).toContain(page.title);
        } else {
          expect(REDIRECT, `${page.path} answers ${String(res.status())}`).toContain(res.status());
          expect(redirectTarget(res).pathname, page.path).toBe('/login');
        }
      }
    } finally {
      await request.dispose();
    }
  });

  test('past the gate an unknown page answers 404 (demo paths included); without the access cookie it leads to the passphrase', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: baseUrl() });
    const visitor = await playwright.request.newContext({ baseURL: baseUrl() });
    try {
      await passGateRequest(visitor, { 'X-Real-IP': nextAddress() });
      const unknown = await get(visitor, '/no-such-page');
      expect(unknown.status()).toBe(404);
      const demoUnknown = await get(visitor, '/demo/no-such-tool');
      expect(demoUnknown.status()).toBe(404);
      const before = await get(anonymous, '/no-such-page');
      expect(REDIRECT, `an unknown page without the access cookie answers ${String(before.status())}`).toContain(before.status());
      expect(redirectTarget(before).pathname).toBe('/access');
    } finally {
      await anonymous.dispose();
      await visitor.dispose();
    }
  });

  test('a request asking Next.js to skip the proxy is still refused by the page guard (memo row 2)', async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl() });
    const bypasses: Record<string, string>[] = [
      { 'x-middleware-subrequest': 'middleware:middleware:middleware:middleware:middleware' },
      { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy' },
      { 'x-middleware-subrequest': 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy' },
      { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' },
      { RSC: '1' },
      { 'Next-Router-Prefetch': '1', RSC: '1' },
    ];
    try {
      for (const headers of bypasses) {
        for (const path of ['/dashboard', '/admin/accounts', '/track']) {
          const res = await get(request, path, headers);
          const body = await res.text();
          const label = `${path} with ${JSON.stringify(headers)}`;
          if (res.status() === 200) {
            for (const text of [PAGE_TITLES.dashboard, PAGE_TITLES.adminAccounts, PAGE_TITLES.track, ...DASHBOARD.boxes]) {
              expect(body, `${label} shows no protected content`).not.toContain(text);
            }
          } else {
            expect([401, 403, 404, ...REDIRECT], label).toContain(res.status());
          }
        }
      }
    } finally {
      await request.dispose();
    }
  });
});
