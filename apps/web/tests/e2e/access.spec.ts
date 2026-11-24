// The visitor passphrase page «كلمة عبور الزوار» (prompt: a passphrase before
// any page; memo rows 2, 7) and the landing page «صفحة الاستقبال» (contract §7).
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { desktopOnly, passGateUi, secrets, useOwnAddress } from '../helpers/e2e';
import { DEMO_BAR, FORMS, PAGE_TITLES, TOP_BAR, WORDMARK } from '../helpers/labels';

const errorRegion = (page: import('@playwright/test').Page) =>
  page.locator('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').filter({ hasText: /\S/ });

test.describe('visitor passphrase', () => {
  desktopOnly();

  test('an unknown visitor asking for a page is sent to «كلمة عبور الزوار», which keeps the page asked for', async ({ page, context }) => {
    await useOwnAddress(context);
    await page.goto('/track');
    await expect(page).toHaveURL(/\/access\?next=(%2F|\/)track/);
    await expect(page).toHaveTitle(new RegExp(PAGE_TITLES.access));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.access);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('a wrong passphrase is refused with a message; the right one opens the page asked for', async ({ page, context }) => {
    await useOwnAddress(context);
    await page.goto('/track');
    await page.getByLabel(FORMS.access.passphrase).fill(`not-the-passphrase-${randomBytes(4).toString('hex')}`);
    await page.getByRole('button', { name: FORMS.access.submit }).click();
    await expect(errorRegion(page).first()).toBeVisible();
    await expect(page).toHaveURL(/\/access/);
    await page.getByLabel(FORMS.access.passphrase).fill(secrets().accessCode);
    await page.getByRole('button', { name: FORMS.access.submit }).click();
    await expect(page).toHaveURL(/\/track(\?|$)/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.track);
  });

  test('the passphrase page shows no demo tool, and the pages past the gate show the demo bar', async ({ page, context }) => {
    await useOwnAddress(context);
    await page.goto('/access');
    await expect(page.getByRole('region', { name: DEMO_BAR })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: DEMO_BAR })).toHaveCount(0);
    await passGateUi(page, '/');
    await expect(page.getByRole('region', { name: DEMO_BAR }).or(page.getByRole('navigation', { name: DEMO_BAR })).first()).toBeVisible();
  });

  test('the landing page presents the platform and leads to «تتبع الملف», «جدول الجلسات» and «الدخول»', async ({ page, context }) => {
    await useOwnAddress(context);
    await passGateUi(page, '/');
    await expect(page).toHaveTitle(new RegExp(PAGE_TITLES.home));
    await expect(page.getByText(WORDMARK).first()).toBeVisible();
    await expect(page.getByText(TOP_BAR.logoSlot).first()).toBeVisible();
    await expect(page.getByRole('link', { name: TOP_BAR.demoIndicator }).first()).toBeVisible();
    for (const name of [PAGE_TITLES.track, PAGE_TITLES.hearings, PAGE_TITLES.login]) {
      await expect(page.getByRole('link', { name }).first()).toBeVisible();
    }
    await page.getByRole('link', { name: TOP_BAR.demoIndicator }).first().click();
    await expect(page).toHaveURL(/\/environment(\?|$)/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.environment);
  });
});
