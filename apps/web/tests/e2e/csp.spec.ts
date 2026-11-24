// Contract §6 and §13 item 7: no CSP violation and no console error on any
// page of Phase 0 — as a visitor, in the login steps, with a session, as the
// administrator — with the account menu and a confirmation dialog open, and
// on an unknown URL. Violations are caught by a securitypolicyviolation
// listener added before any page script runs.
import { expect, test } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../../src/cli/seed-data/accounts';
import { desktopOnly, expectNoViolation, loginUi, monitor, passGateUi, reauthUi, useOwnAddress } from '../helpers/e2e';
import { FORMS, ROLE_LABELS, TOP_BAR } from '../helpers/labels';

const VISITOR_PAGES = ['/', '/track', '/hearings', '/environment', '/login', '/activate', '/demo/outbox'];
const SESSION_PAGES = ['/dashboard', '/notifications', '/account', '/reauth', '/admin/accounts', '/admin/accounts/new'];

test.describe('content security policy (contract §13.7)', () => {
  desktopOnly();

  test('no violation and no console error on any page, with the account menu and a confirmation open, and on an unknown URL', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const admin = DEMO_ACCOUNTS.find((a) => a.role === 'SYSTEM_ADMIN');
    expect(admin).toBeDefined();
    if (!admin) return;
    const mon = await monitor(context, page);
    await useOwnAddress(context);

    await page.goto('/access');
    await expectNoViolation(page, mon, '/access');
    await passGateUi(page, '/');
    for (const path of VISITOR_PAGES) {
      await page.goto(path);
      await page.waitForLoadState('load');
      await expectNoViolation(page, mon, path);
    }
    const unknown = await page.goto('/no-such-page');
    expect(unknown?.status()).toBe(404);
    await expectNoViolation(page, mon, 'an unknown URL');

    await loginUi(page, admin);
    for (const path of SESSION_PAGES) {
      await page.goto(path);
      await page.waitForLoadState('load');
      await expectNoViolation(page, mon, path);
    }

    await page.goto('/dashboard');
    await page.getByRole('button', { name: TOP_BAR.account }).first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectNoViolation(page, mon, 'the account menu');
    await page.keyboard.press('Escape');

    await reauthUi(page);
    await page.goto('/admin/accounts/new');
    await page.getByLabel(FORMS.account.fullName).first().fill('الأستاذ زاي');
    await page.getByLabel(FORMS.account.email).fill('csp.check@itest.mahkama.example');
    await page.getByLabel(FORMS.account.phone).fill('+212611112222');
    await page.getByLabel(FORMS.account.role).selectOption({ label: ROLE_LABELS.LAWYER ?? 'المحامي' });
    await page.getByLabel(FORMS.account.requestReference).fill('REQ-CSP-0001');
    await page.getByRole('button', { name: FORMS.account.submit }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
    await expect(dialog).toBeVisible();
    await expectNoViolation(page, mon, 'the confirmation dialog');
    await dialog.getByRole('button', { name: FORMS.account.cancel }).click();
    await expect(dialog).toBeHidden();

    const unknownWithSession = await page.goto('/no-such-page');
    expect(unknownWithSession?.status()).toBe(404);
    await expectNoViolation(page, mon, 'an unknown URL with a session');
  });
});
