// Memo rows 3 and 4 through the interface: five wrong passwords lock the
// account; then even the right password is refused, with a different message,
// and no code reaches «صندوق الرسائل الصادرة». The account used is one the
// per-role login spec does not use (the second account of a role held twice).
import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../../src/cli/seed-data/accounts';
import { desktopOnly, outboxCodes, passGateUi, secrets, useOwnAddress } from '../helpers/e2e';
import { FORMS } from '../helpers/labels';

function lockTarget(): string | null {
  const firstByRole = new Map<string, string>();
  for (const account of DEMO_ACCOUNTS) if (!firstByRole.has(account.role)) firstByRole.set(account.role, account.email);
  const used = new Set(firstByRole.values());
  return DEMO_ACCOUNTS.find((a) => !used.has(a.email))?.email ?? null;
}

const errorRegion = (page: Page) =>
  page.locator('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').filter({ hasText: /\S/ }).first();

async function submitLogin(page: Page, email: string, password: string): Promise<string> {
  await page.getByLabel(FORMS.login.email).fill(email);
  await page.getByLabel(FORMS.login.password).fill(password);
  await page.getByRole('button', { name: FORMS.login.submit }).click();
  await expect(errorRegion(page)).toBeVisible();
  await expect(page).toHaveURL(/\/login(\?|$)/);
  return errorRegion(page).innerText();
}

test.describe('account lock (memo rows 3 and 4)', () => {
  desktopOnly();

  test('five wrong passwords lock the account; the right password is then refused too, and no code is sent', async ({ page, context }) => {
    const email = lockTarget();
    expect(email, 'a seeded account outside the per-role logins').not.toBeNull();
    if (!email) return;
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    let wrongMessage = '';
    for (let i = 0; i < 5; i += 1) wrongMessage = await submitLogin(page, email, `Wrong-password-${String(i)}-e2e`);

    const outbox = await context.newPage();
    const before = await outboxCodes(outbox);
    await page.goto('/login');
    const lockedMessage = await submitLogin(page, email, secrets().seedPassword);
    expect(lockedMessage, 'the lock is told apart from a wrong password').not.toBe(wrongMessage);
    const after = await outboxCodes(outbox);
    expect([...after].filter((c) => !before.has(c)), 'no code during the lock').toEqual([]);
  });
});
