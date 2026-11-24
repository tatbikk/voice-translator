// Helpers of the end-to-end suite (Playwright). The suite runs against the
// server started by scripts/e2e-server.mjs (configuration apps/web/.env.e2e,
// a freshly seeded demo database), or against E2E_BASE_URL. The secrets it
// needs as a visitor would (ACCESS_CODE, SEED_DEMO_PASSWORD) come from the
// environment, else from apps/web/.env.e2e for a local run.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DASHBOARD, FORMS, PAGE_TITLES, ROLE_LABELS } from './labels';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

export function secrets(): { accessCode: string; seedPassword: string } {
  if ((!process.env.ACCESS_CODE || !process.env.SEED_DEMO_PASSWORD) && !process.env.E2E_BASE_URL) {
    const file = join(WEB_ROOT, '.env.e2e');
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const accessCode = process.env.ACCESS_CODE;
  const seedPassword = process.env.SEED_DEMO_PASSWORD;
  if (!accessCode || !seedPassword) throw new Error('ACCESS_CODE and SEED_DEMO_PASSWORD are required (environment or apps/web/.env.e2e)');
  return { accessCode, seedPassword };
}

export function baseUrl(): string {
  return (process.env.E2E_BASE_URL ?? 'http://localhost:3100').replace(/\/$/, '');
}

export function origin(): string {
  return new URL(baseUrl()).origin;
}

/** Only on the desktop project (the phone project runs the login and dashboard spec). */
export function desktopOnly(): void {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'desktop project only');
  });
}

// ---------------------------------------------------------------------------
// Client addresses: the platform counts attempts per X-Real-IP. Locally each
// test uses its own address, so that 26 logins do not hit the per-client
// login limit; behind the hosting edge the edge sets the address itself.

let counter = 0;
const salt = 20 + Math.floor(Math.random() * 200);

export function nextAddress(): string {
  counter += 1;
  return `198.18.${String(salt)}.${String(1 + (counter % 250))}`;
}

export async function useOwnAddress(context: BrowserContext): Promise<string> {
  const ip = nextAddress();
  await context.setExtraHTTPHeaders({ 'X-Real-IP': ip });
  return ip;
}

// ---------------------------------------------------------------------------
// CSP violations and console errors

export interface Monitor {
  readonly errors: string[];
  violations(page: Page): Promise<unknown[]>;
}

/** Records securitypolicyviolation events (init script) and console errors of every page of the context. */
export async function monitor(context: BrowserContext, page: Page): Promise<Monitor> {
  await context.addInitScript(() => {
    const w = window as unknown as { __cspViolations: unknown[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber });
    });
  });
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The 404 status of a page asked on purpose is reported by the browser itself.
    if (/Failed to load resource: the server responded with a status of 404/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return {
    errors,
    violations: (p: Page) => p.evaluate(() => (window as unknown as { __cspViolations?: unknown[] }).__cspViolations ?? []),
  };
}

export async function expectNoViolation(page: Page, mon: Monitor, where: string): Promise<void> {
  expect(await mon.violations(page), `CSP violations on ${where}`).toEqual([]);
  expect(mon.errors, `console errors on ${where}`).toEqual([]);
}

export async function expectAccessible(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${String(v.impact)}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(serious, `axe serious/critical violations on ${where}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Visitor passphrase and login, as a visitor does them

export async function passGateUi(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/access(\?|$)/);
  await page.getByLabel(FORMS.access.passphrase).fill(secrets().accessCode);
  await page.getByRole('button', { name: FORMS.access.submit }).click();
  await expect(page).not.toHaveURL(/\/access(\?|$)/);
}

/** Passes the gate through the API of the browser context (cookies shared with its pages). */
export async function passGateApi(context: BrowserContext): Promise<void> {
  await passGateRequest(context.request);
}

export async function passGateRequest(request: APIRequestContext, headers: Record<string, string> = {}): Promise<void> {
  const csrf = await request.get('/api/v1/csrf', { headers });
  expect(csrf.status()).toBe(200);
  const token = ((await csrf.json()) as { data?: { token?: string } }).data?.token ?? '';
  const res = await request.post('/api/v1/access', {
    data: { code: secrets().accessCode },
    headers: { ...headers, Origin: origin(), 'X-CSRF-Token': token },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const CODE = /(?<!\d)\d{6}(?!\d)/g;

export async function outboxCodes(outbox: Page): Promise<Set<string>> {
  await outbox.goto('/demo/outbox');
  await expect(outbox.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.demoOutbox);
  const text = await outbox.locator('main').innerText();
  return new Set(text.match(CODE) ?? []);
}

export async function newOutboxCode(outbox: Page, before: ReadonlySet<string>): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const fresh = [...(await outboxCodes(outbox))].filter((c) => !before.has(c));
    if (fresh.length === 1) return fresh[0]!;
    if (fresh.length > 1) throw new Error(`several new codes in the outbox: ${String(fresh.length)}`);
    await outbox.waitForTimeout(250);
  }
  throw new Error('no new code appeared in «صندوق الرسائل الصادرة»');
}

export interface DemoAccount {
  readonly email: string;
  readonly role: string;
  readonly roleAssignmentCount: number;
}

export async function chooseRole(page: Page, role: string): Promise<void> {
  const label = ROLE_LABELS[role] ?? role;
  const radio = page.getByRole('radio', { name: label });
  if ((await radio.count()) > 0) {
    await radio.first().check();
    await page.getByRole('button', { name: FORMS.role.submit }).click();
  } else {
    await page.getByRole('button', { name: label }).or(page.getByRole('link', { name: label })).first().click();
  }
}

/** Login page, code read in «صندوق الرسائل الصادرة» in a second tab, confirmation, role selection. */
export async function loginUi(page: Page, account: DemoAccount, password = secrets().seedPassword): Promise<void> {
  const outbox = await page.context().newPage();
  const before = await outboxCodes(outbox);
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.login);
  await page.getByLabel(FORMS.login.email).fill(account.email);
  await page.getByLabel(FORMS.login.password).fill(password);
  await page.getByRole('button', { name: FORMS.login.submit }).click();
  await page.waitForURL(/\/login\/confirm/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.loginConfirm);
  const code = await newOutboxCode(outbox, before);
  await outbox.close();
  await page.getByLabel(FORMS.confirm.code).fill(code);
  await page.getByRole('button', { name: FORMS.confirm.submit }).click();
  await page.waitForURL(/\/(dashboard|login\/role)(\?|$)/);
  if (/\/login\/role/.test(page.url())) {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.loginRole);
    await chooseRole(page, account.role);
  }
  await page.waitForURL(/\/dashboard(\?|$)/);
}

export async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboard(\?|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.dashboard);
  for (const box of DASHBOARD.boxes) await expect(page.getByRole('heading', { name: box })).toBeVisible();
  await expect(page.getByText(DASHBOARD.emptyAwaiting)).toBeVisible();
}

export async function reauthUi(page: Page, password = secrets().seedPassword): Promise<void> {
  await page.goto('/reauth');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.reauth);
  await page.getByLabel(FORMS.reauth.password).fill(password);
  await page.getByRole('button', { name: FORMS.reauth.submit }).click();
  await expect(page).not.toHaveURL(/\/reauth(\?|$)/);
}

// ---------------------------------------------------------------------------
// Which seeded account each spec uses. Code issuance is capped at 5 per
// account and 15 minutes (contract §4.5): the specs spread their logins so
// that no account needs more than four codes in one run.

export function roleLoopAccount(accounts: readonly DemoAccount[], role: string): DemoAccount | undefined {
  return accounts.find((a) => a.role === role && a.roleAssignmentCount === 1) ?? accounts.find((a) => a.role === role);
}

/** An account no other spec logs in with (for the lock test). */
export function untouchedAccount(accounts: readonly DemoAccount[], roles: readonly string[]): DemoAccount | undefined {
  const used = new Set(roles.map((role) => roleLoopAccount(accounts, role)?.email));
  return accounts.find((a) => !used.has(a.email) && a.roleAssignmentCount === 1 && a.role !== 'SYSTEM_ADMIN');
}
