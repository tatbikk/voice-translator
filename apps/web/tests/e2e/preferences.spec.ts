// Contract §7: the language switcher changes the top bar (fr, zgh translate the
// top bar and the main navigation) and shows a one-line notice that the
// translation is partial; <html lang dir> follows. The reading-ease control
// changes the text size of the page, kept in __Host-mr-reading.
import { expect, test, type Page } from '@playwright/test';
import { desktopOnly, passGateUi, useOwnAddress } from '../helpers/e2e';
import { LANGUAGE_CONTROL, LANGUAGES, PARTIAL_TRANSLATION_NOTICE, TOP_BAR } from '../helpers/labels';

/** Opens a control of the top bar (a select, or a button opening a menu) and picks an item. */
async function choose(page: Page, control: RegExp, item: RegExp): Promise<void> {
  const select = page.getByRole('combobox', { name: control });
  if ((await select.count()) > 0) {
    const option = select.first().locator('option').filter({ hasText: item }).first();
    await select.first().selectOption((await option.getAttribute('value')) ?? { label: await option.innerText() });
    return;
  }
  await page.getByRole('button', { name: control }).first().click();
  await page
    .getByRole('menuitemradio', { name: item })
    .or(page.getByRole('menuitem', { name: item }))
    .or(page.getByRole('option', { name: item }))
    .or(page.getByRole('radio', { name: item }))
    .or(page.getByRole('link', { name: item }))
    .or(page.getByRole('button', { name: item }))
    .first()
    .click();
}

async function htmlAttributes(page: Page): Promise<Record<string, string>> {
  return page.locator('html').evaluate((el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])));
}

test.describe('language and reading ease', () => {
  desktopOnly();

  test('the language switch translates the top bar, says the translation is partial, and sets lang and dir', async ({ page, context }) => {
    await useOwnAddress(context);
    await passGateUi(page, '/');
    const banner = page.getByRole('banner');
    await expect(page.locator('html')).toHaveAttribute('lang', /^ar(-MA)?$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const arabic = await banner.innerText();

    await choose(page, TOP_BAR.language, LANGUAGES.fr);
    await expect(page.locator('html')).toHaveAttribute('lang', /^fr(-MA)?$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    const french = await banner.innerText();
    expect(french).not.toBe(arabic);
    expect(french).toMatch(/[A-Za-zÀ-ÿ]{4,}/);
    await expect(page.getByText(PARTIAL_TRANSLATION_NOTICE.fr).first()).toBeVisible();

    await choose(page, LANGUAGE_CONTROL, LANGUAGES.zgh);
    await expect(page.locator('html')).toHaveAttribute('lang', /^zgh(-Tfng)?$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await banner.innerText()).toMatch(/\p{Script=Tifinagh}/u);

    await choose(page, LANGUAGE_CONTROL, LANGUAGES.ar);
    await expect(page.locator('html')).toHaveAttribute('lang', /^ar(-MA)?$/);
    expect(await banner.innerText()).toBe(arabic);
  });

  test('the reading-ease control changes the text size of the page, and keeps it', async ({ page, context }) => {
    await useOwnAddress(context);
    await passGateUi(page, '/');
    const before = await htmlAttributes(page);
    await choose(page, TOP_BAR.readingEase, TOP_BAR.readingLarger);
    await expect
      .poll(async () => {
        const after = await htmlAttributes(page);
        return Object.keys({ ...before, ...after }).filter((k) => /size|text|font|reading/i.test(k) && before[k] !== after[k]);
      })
      .not.toEqual([]);
    const changed = await htmlAttributes(page);
    // The page applies the choice before the request that saves it returns: wait for the cookie.
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === '__Host-mr-reading')).toBe(true);
    await page.reload();
    expect(await htmlAttributes(page)).toEqual(changed);
  });
});
