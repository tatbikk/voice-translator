// Contract §13 item 2 (desktop and phone): logging in with each of the 26
// roles — the code read in «صندوق الرسائل الصادرة» as a visitor would read it —
// shows the dashboard with its three boxes «ينتظر إجراء مني» «آجال تقترب»
// «جديد منذ آخر دخول» and the empty-state sentence. For each role, the pages
// of its session open, and the administration pages answer 404 to every role
// but SYSTEM_ADMIN, without showing any of their content (memo rows 2 and 8).
import { expect, test } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../../src/cli/seed-data/accounts';
import { expectDashboard, loginUi, passGateUi, roleLoopAccount, useOwnAddress } from '../helpers/e2e';
import { ADMIN_ONLY_TEXT, PAGE_TITLES, ROLE_CODES_E2E, ROLE_LABELS } from '../helpers/labels';

const SESSION_PAGES = ['/dashboard', '/notifications', '/account', '/reauth'];
const ADMIN_PAGES = ['/admin/accounts', '/admin/accounts/new'];

test.describe('login with each role (contract §13.2)', () => {
  test('every role of the platform has a seeded demo account', () => {
    const seeded = new Set(DEMO_ACCOUNTS.map((a) => a.role));
    expect(ROLE_CODES_E2E.filter((role) => !seeded.has(role))).toEqual([]);
  });

  for (const role of ROLE_CODES_E2E) {
    test(`${role} (${ROLE_LABELS[role] ?? role}): login, dashboard with its three boxes, and the pages of the role`, async ({ page, context }) => {
      const account = roleLoopAccount(DEMO_ACCOUNTS, role);
      expect(account, `a seeded account holds ${role}`).toBeDefined();
      if (!account) return;
      await useOwnAddress(context);
      await passGateUi(page, '/login');
      await loginUi(page, account);
      await expectDashboard(page);

      for (const path of SESSION_PAGES) {
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(200);
      }
      for (const path of ADMIN_PAGES) {
        const res = await page.goto(path);
        if (role === 'SYSTEM_ADMIN') {
          expect(res?.status(), path).toBe(200);
          await expect(page.getByRole('heading', { level: 1 })).toContainText(path.endsWith('/new') ? PAGE_TITLES.adminAccountsNew : PAGE_TITLES.adminAccounts);
        } else {
          expect(res?.status(), `${path} for ${role}`).toBe(404);
          // The page content: the demo tools bar («مبدل الحسابات») lies outside it.
          const visible = await page.locator('main').innerText();
          for (const text of ADMIN_ONLY_TEXT) expect(visible, `${path} shows nothing of the administration`).not.toContain(text);
        }
      }
    });
  }

  test('a user holding two roles chooses the role at login («اختيار الصفة»)', async ({ page, context }) => {
    const account = DEMO_ACCOUNTS.find((a) => a.roleAssignmentCount > 1);
    expect(account, 'a seeded account holds two roles').toBeDefined();
    if (!account) return;
    const roles = DEMO_ACCOUNTS.filter((a) => a.email === account.email).map((a) => a.role);
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, { ...account, role: roles[1] ?? account.role });
    await expectDashboard(page);
    const res = await page.goto('/login/role');
    expect(res?.status(), 'an active user with two roles may switch').toBe(200);
    for (const role of roles) await expect(page.getByText(ROLE_LABELS[role] ?? role).first()).toBeVisible();
  });
});
