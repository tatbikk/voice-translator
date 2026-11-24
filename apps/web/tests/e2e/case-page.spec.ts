// Phase 1 acceptance, in the browser (desktop and phone): the dashboard lists
// what the core says awaits the user and the time limits that approach; the
// case page shows its header, its eight tabs and «الإجراءات المتاحة»; a
// document of the file downloads as a PDF; and a user the core does not relate
// to the file meets the same 404 as for a file that does not exist.
import { expect, test } from '@playwright/test';
import { DEMO_ACCOUNTS, demoEmail } from '../../src/cli/seed-data/accounts';
import { expectAccessible, expectDashboard, expectEmptyDashboard, loginUi, passGateUi, useOwnAddress } from '../helpers/e2e';
import { CASE_PAGE, DASHBOARD, PAGE_TITLES } from '../helpers/labels';

const account = (key: string) => {
  const found = DEMO_ACCOUNTS.find((a) => a.email === demoEmail(key));
  if (!found) throw new Error(`no seeded account ${key}`);
  return found;
};

test.describe('the case page and the dashboard boxes (Phase 1)', () => {
  test('the notification clerk finds «تنفيذ» awaiting him, opens the file, and an unrelated user meets a 404', async ({ page, context, browser }) => {
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, account('clerk.notification'));
    await expectDashboard(page);

    const awaiting = page.locator('section[aria-labelledby="awaiting-title"]');
    const link = awaiting.getByRole('link', { name: CASE_PAGE.dispatch }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    const caseUrl = page.url();

    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.caseFile);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(CASE_PAGE.tabs.length);
    for (const [index, name] of CASE_PAGE.tabs.entries()) await expect(tabs.nth(index)).toHaveText(name);
    await expect(page.getByRole('heading', { name: CASE_PAGE.actionsTitle })).toBeVisible();
    await expect(page.getByText(CASE_PAGE.dispatch, { exact: true }).first()).toBeVisible();
    await expectAccessible(page, 'case page');
    await page.screenshot({ path: test.info().outputPath('case-page.png'), fullPage: true });

    // Someone the core relates to no file: the same answer as an unknown file.
    const other = await browser.newContext();
    try {
      await useOwnAddress(other);
      const otherPage = await other.newPage();
      await passGateUi(otherPage, '/login');
      await loginUi(otherPage, account('bank'));
      await expectEmptyDashboard(otherPage);
      const res = await otherPage.goto(caseUrl);
      expect(res?.status()).toBe(404);
      await expect(otherPage.locator('main')).not.toContainText(CASE_PAGE.actionsTitle);
      const unknown = await otherPage.goto('/cases/00000000-0000-4000-8000-000000000000');
      expect(unknown?.status()).toBe(404);
    } finally {
      await other.close();
    }
  });

  test('the defendants’ counsel sees an approaching time limit, and downloads a document of the file', async ({ page, context }) => {
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, account('lawyer.defendants'));
    await expectDashboard(page);

    const deadlines = page.locator('section[aria-labelledby="deadlines-title"]');
    const link = deadlines.getByRole('link', { name: CASE_PAGE.challengeDeadline }).first();
    await expect(link).toBeVisible();
    await expect(deadlines.getByText(DASHBOARD.emptyAwaiting)).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);

    await page.getByRole('tab', { name: CASE_PAGE.tabs[1] }).click();
    const download = page.getByRole('link', { name: CASE_PAGE.download }).first();
    await expect(download).toBeVisible();
    const href = await download.getAttribute('href');
    expect(href).toMatch(/^\/api\/v1\/cases\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\/file$/);
    const res = await page.request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect((await res.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await page.getByRole('tab', { name: CASE_PAGE.tabs[5] }).click();
    await expect(page.getByRole('tabpanel')).toContainText(CASE_PAGE.challengeDeadline);
    await page.screenshot({ path: test.info().outputPath('case-deadlines.png'), fullPage: true });
  });
});
