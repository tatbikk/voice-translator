// Prompt rule 1 and contract §7: the «إنشاء حساب» submit opens a confirmation
// of three lines — what follows from the action, who is notified, and its legal
// basis (article 625 for a lawyer's account). Memo row 27: a name carrying
// markup is shown as text, runs nothing, and breaks no CSP rule.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../../src/cli/seed-data/accounts';
import { desktopOnly, expectNoViolation, loginUi, monitor, passGateUi, reauthUi, useOwnAddress } from '../helpers/e2e';
import { FORMS, PAGE_TITLES, ROLE_LABELS } from '../helpers/labels';

const dialogOf = (page: Page) => page.getByRole('alertdialog').or(page.getByRole('dialog')).first();

test.describe('account creation from the interface', () => {
  desktopOnly();

  test('«إنشاء حساب» asks for a confirmation of three lines, and a name with markup is shown as text (memo row 27)', async ({ page, context }) => {
    const admin = DEMO_ACCOUNTS.find((a) => a.role === 'SYSTEM_ADMIN');
    expect(admin, 'a seeded SYSTEM_ADMIN').toBeDefined();
    if (!admin) return;
    const mon = await monitor(context, page);
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, admin);
    await reauthUi(page);

    const tag = randomBytes(4).toString('hex');
    const name = `<img src=x onerror="window.__xss=1">الأستاذة هاء ${tag}`;
    await page.goto('/admin/accounts/new');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.adminAccountsNew);
    await page.getByLabel(FORMS.account.fullName).first().fill(name);
    await page.getByLabel(FORMS.account.email).fill(`e2e.${tag}@itest.mahkama.example`);
    await page.getByLabel(FORMS.account.phone).fill(`+2126${String(10_000_000 + Number.parseInt(tag, 16) % 80_000_000)}`);
    await page.getByLabel(FORMS.account.role).selectOption({ label: ROLE_LABELS.LAWYER ?? 'المحامي' });
    await page.getByLabel(FORMS.account.requestReference).fill(`REQ-E2E-${tag}`);
    await page.getByRole('button', { name: FORMS.account.submit }).click();

    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    const lines = (await dialog.locator('p, li, dd').allInnerTexts()).map((l) => l.trim()).filter((l) => l.length > 0);
    expect(lines.length, `three lines in the confirmation: ${lines.join(' | ')}`).toBeGreaterThanOrEqual(3);
    expect(lines.some((l) => /625/.test(l)), 'the legal basis line names article 625').toBe(true);
    await expectNoViolation(page, mon, 'the confirmation dialog');

    await dialog.getByRole('button', { name: FORMS.account.confirm }).click();
    await expect(dialog).toBeHidden();
    await page.goto('/admin/accounts');
    await expect(page.getByText(name).first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    await expectNoViolation(page, mon, '/admin/accounts after creating the account');
  });
});
