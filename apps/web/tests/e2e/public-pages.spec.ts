// The two public pages (prompt «الأدوار والواجهات», memo row 23): «تتبع الملف»
// shows the status and next hearing of a seeded case, chosen by court, number,
// code and year, and no party name; «جدول الجلسات» lists the hearings of a day
// with their case numbers.
import { expect, test } from '@playwright/test';
import { DEMO_CASES, DEMO_COURTS, DEMO_USERS } from '../../src/cli/seed-data/accounts';
import { desktopOnly, passGateUi, useOwnAddress } from '../helpers/e2e';
import { FORMS, PAGE_TITLES, STATUS_LABELS } from '../helpers/labels';

const scheduled = DEMO_CASES.find((c) => c.hearingInDays !== null);

/** The calendar date in Morocco, YYYY-MM-DD, `days` from now. */
function moroccoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 24 * 3600_000),
  );
}

test.describe('public pages', () => {
  desktopOnly();

  test('«تتبع الملف»: a seeded case shows its status and its next hearing, without any name', async ({ page, context }) => {
    expect(scheduled, 'a seeded case with a next hearing').toBeDefined();
    if (!scheduled) return;
    await useOwnAddress(context);
    await passGateUi(page, '/track');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.track);
    await page.getByLabel(FORMS.track.court).selectOption({ label: DEMO_COURTS[scheduled.court].name });
    await page.getByLabel(FORMS.track.number).fill(String(scheduled.number));
    await page.getByLabel(FORMS.track.code, { exact: false }).fill(String(scheduled.code));
    await page.getByLabel(FORMS.track.year).fill(String(scheduled.year));
    await page.getByRole('button', { name: FORMS.track.submit }).click();
    await expect(page.getByText(STATUS_LABELS[scheduled.status] ?? scheduled.status).first()).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const user of DEMO_USERS) expect(text).not.toContain(user.fullName);
  });

  test('«تتبع الملف»: an unknown case is answered without revealing anything', async ({ page, context }) => {
    await useOwnAddress(context);
    await passGateUi(page, '/track');
    const court = DEMO_COURTS.firstInstance.name;
    await page.getByLabel(FORMS.track.court).selectOption({ label: court });
    await page.getByLabel(FORMS.track.number).fill('999999');
    await page.getByLabel(FORMS.track.code, { exact: false }).fill('9999');
    await page.getByLabel(FORMS.track.year).fill('2030');
    await page.getByRole('button', { name: FORMS.track.submit }).click();
    await expect(page.locator('[role="alert"], [role="status"], [aria-live]').filter({ hasText: /\S/ }).first()).toBeVisible();
    for (const label of Object.values(STATUS_LABELS)) await expect(page.locator('main').getByText(label, { exact: true })).toHaveCount(0);
  });

  test('«جدول الجلسات»: the hearings of a day list the numbers of their cases', async ({ page, context }) => {
    expect(scheduled, 'a seeded case with a next hearing').toBeDefined();
    if (!scheduled || scheduled.hearingInDays === null) return;
    await useOwnAddress(context);
    await passGateUi(page, '/hearings');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.hearings);
    await page.getByLabel(FORMS.hearings.court).selectOption({ label: DEMO_COURTS[scheduled.court].name });
    await page.getByLabel(FORMS.hearings.date).fill(moroccoDate(scheduled.hearingInDays));
    await page.getByRole('button', { name: FORMS.hearings.submit }).click();
    await expect(page.getByText(`${String(scheduled.number)}/${String(scheduled.code)}/${String(scheduled.year)}`).first()).toBeVisible();
    await expect(page.getByText(scheduled.room).first()).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const user of DEMO_USERS) expect(text).not.toContain(user.fullName);
  });
});
