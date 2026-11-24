// Contract §7 and §13 item 7: axe-core on every page of Phase 0 — zero serious
// or critical violation — each page in the state that shows it: visitor,
// pending second factor, pending role selection and the 404 page here; the
// session and administration pages in csp.spec.ts (one administrator login for
// both checks). One <h1> per page, lang and dir set.
import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../../src/cli/seed-data/accounts';
import {
  desktopOnly,
  expectAccessible,
  newOutboxCode,
  outboxCodes,
  passGateUi,
  secrets,
  useOwnAddress,
} from '../helpers/e2e';
import { FORMS, PAGE_TITLES } from '../helpers/labels';

async function check(page: Page, path: string | null, where: string): Promise<void> {
  if (path) await page.goto(path);
  await page.waitForLoadState('load');
  await expect(page.locator('h1'), `one <h1> on ${where}`).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('lang', /^(ar|fr|zgh)(-[A-Za-z]{2,4})?$/);
  await expect(page.locator('html')).toHaveAttribute('dir', /^(rtl|ltr)$/);
  await expectAccessible(page, where);
}

test.describe('accessibility (axe-core, zero serious or critical violation)', () => {
  desktopOnly();

  test('visitor pages', async ({ page, context }) => {
    await useOwnAddress(context);
    await check(page, '/access', '/access');
    await passGateUi(page, '/');
    for (const path of ['/', '/track', '/hearings', '/environment', '/login', '/activate', '/demo/outbox']) await check(page, path, path);
    const res = await page.goto('/no-such-page');
    expect(res?.status()).toBe(404);
    await check(page, null, 'the 404 page');
  });

  test('the login steps: «وسيلة التأكيد الثانية» and «اختيار الصفة»', async ({ page, context }) => {
    const twoRoles = DEMO_ACCOUNTS.find((a) => a.roleAssignmentCount > 1);
    expect(twoRoles, 'a seeded account with two roles').toBeDefined();
    if (!twoRoles) return;
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    const outbox = await context.newPage();
    const before = await outboxCodes(outbox);
    await page.getByLabel(FORMS.login.email).fill(twoRoles.email);
    await page.getByLabel(FORMS.login.password).fill(secrets().seedPassword);
    await page.getByRole('button', { name: FORMS.login.submit }).click();
    await page.waitForURL(/\/login\/confirm/);
    await check(page, null, '/login/confirm');
    const code = await newOutboxCode(outbox, before);
    await outbox.close();
    await page.getByLabel(FORMS.confirm.code).fill(code);
    await page.getByRole('button', { name: FORMS.confirm.submit }).click();
    await page.waitForURL(/\/login\/role/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.loginRole);
    await check(page, null, '/login/role');
  });
});
