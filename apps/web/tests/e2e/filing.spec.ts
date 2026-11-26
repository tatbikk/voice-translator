// Phase 2 acceptance, in the browser (docs/phases/phase-2.md):
//   1. the plaintiff's lawyer files the model case from the first screen of
//      «دعوى جديدة» to «وصل الإيداع», through the simulated payment page;
//   2. the file is registered, and its timeline records that the referrals
//      were reviewed and none was due;
//   3. the registry clerk finds it among «الملفات الواردة» with three buttons
//      and no button to reject the application, stamps it, and files a paper
//      application; the cashier sees the payment; the prosecution sees its
//      referrals by ground.
// The full path runs on the desktop project; the phone project walks the
// same path for the lawyer (the study wants every interface usable on a phone).
import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCOUNTS, demoEmail } from '../../src/cli/seed-data/accounts';
import { MODEL_CASE, MODEL_CASE_APPLICATION_TEXT } from '../acceptance/model-case-filing.fixture';
import { expectAccessible, loginUi, monitor, expectNoViolation, passGateUi, secrets, useOwnAddress } from '../helpers/e2e';
import { FILING, FORMS, OFFICES, PAGE_TITLES } from '../helpers/labels';

const account = (key: string) => {
  const found = DEMO_ACCOUNTS.find((a) => a.email === demoEmail(key));
  if (!found) throw new Error(`no seeded account ${key}`);
  return found;
};

const PDF = (note: string) => Buffer.from(`%PDF-1.4\n% ${note}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');

/** The confirmation window of an act (an alert dialog, as in the other specs). */
const dialogOf = (page: Page) => page.getByRole('alertdialog').or(page.getByRole('dialog')).first();

async function next(page: Page, step: number): Promise<void> {
  await page.getByRole('button', { name: FILING.next }).click();
  await expect(page.getByRole('heading', { level: 2, name: FILING.steps[step] ?? '' })).toBeVisible();
}

/** The six screens of «دعوى جديدة» for the model case; returns the receipt page's text. */
async function fileModelCase(page: Page): Promise<string> {
  await page.goto('/filings');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.filings);
  await page.getByRole('button', { name: FILING.newCase }).click();
  await expect(page).toHaveURL(/\/filings\/[0-9a-f-]{36}/);
  await expect(page.getByText(FILING.demoNotice)).toBeVisible();

  // 1. Case type and the suggested court.
  await expect(page.getByRole('heading', { level: 2, name: FILING.steps[0] })).toBeVisible();
  await page.getByLabel(FILING.caseType).selectOption('8201');
  await page.getByLabel(FILING.defendantLocality).selectOption('casablanca');
  await page.getByRole('button', { name: FILING.save }).click();
  const suggested = page.getByRole('region', { name: FILING.suggestedCourt });
  await expect(suggested).toContainText('المحكمة الابتدائية التجارية النموذجية');
  await expect(suggested).toContainText(/66/);
  await expect(page.getByLabel(FILING.court)).toHaveValue(/[0-9a-f-]{36}/);
  await next(page, 1);

  // 2. The application, pasted; the platform prepares its fixed copy.
  await page.getByRole('radio', { name: FILING.pasteText }).check();
  await page.getByLabel(FILING.applicationText).fill(MODEL_CASE_APPLICATION_TEXT);
  await page.getByRole('button', { name: FILING.save }).click();
  await expect(page.getByText(FILING.fixedCopyReady)).toBeVisible({ timeout: 60_000 });
  await next(page, 2);

  // 3. The case card: the two companies from the simulated register, the guarantor by hand, the claims.
  for (const [index, party] of MODEL_CASE.parties.entries()) {
    if (index > 0) await page.getByRole('button', { name: FILING.addParty }).click();
    const block = page.getByRole('group', { name: new RegExp(`الطرف ${String(index + 1)}`) });
    await block.getByLabel('مركز الطرف في الدعوى').selectOption(party.side);
    await block.getByLabel('نوع الشخص').selectOption(party.personKind);
    if (party.idNumber?.startsWith('RC-')) {
      await block.getByLabel(FILING.registerNumber).fill(party.idNumber);
      await block.getByRole('button', { name: FILING.lookupRegister }).click();
      await expect(block.getByText(FILING.simulatedSource, { exact: true })).toBeVisible();
      await expect(block.getByLabel('الاسم')).toHaveValue(party.name);
    } else {
      await block.getByLabel('الاسم').fill(party.name);
      // «الموطن» or «محل الإقامة» (art. 77, G012), the address, and its locality from the list of the
      // first screen (independent review IR-08): the guarantor of the model case is domiciled in Casablanca.
      const kind = block.getByRole('group', { name: 'الموطن أو محل الإقامة' });
      await expect(kind.getByRole('radio', { name: 'الموطن', exact: true })).toBeChecked();
      await expect(kind.getByRole('radio', { name: 'محل الإقامة', exact: true })).not.toBeChecked();
      await block.getByLabel('العنوان', { exact: true }).fill(party.domicile?.value ?? '');
      await block.getByLabel('المدينة', { exact: true }).selectOption(party.domicile?.locality ?? '');
      // «البلد», required once «خارج تراب المملكة» is chosen (review of IR-08), is not asked of an address in the Kingdom.
      await expect(block.getByLabel(/^البلد/)).toHaveCount(0);
    }
    if (party.quality) await block.getByLabel('صفة الطرف').fill(party.quality);
    if (party.email) await block.getByLabel('البريد الإلكتروني').fill(party.email);
    // A new plaintiff of an electronic filing starts with the filing lawyer as its counsel (decision 67):
    // the box is found ticked, nothing is clicked; no other side is offered it.
    const counsel = block.getByLabel('ينوب المحامي المودع عن هذا الطرف');
    if (party.side === 'PLAINTIFF') await expect(counsel).toBeChecked({ checked: party.representedByFiler === true });
    else await expect(counsel).toHaveCount(0);
  }
  await page.getByLabel('موجز الموضوع والوقائع والأسباب').fill(MODEL_CASE.summary);
  for (const [index, claim] of MODEL_CASE.claims.entries()) {
    if (index > 0) await page.getByRole('button', { name: FILING.addClaim }).click();
    const block = page.getByRole('group', { name: new RegExp(`الطلب ${String(index + 1)}`) });
    await block.getByLabel('طبيعة الطلب').selectOption(claim.nature);
    if (claim.amountCents !== null) await block.getByLabel('المبلغ بالدرهم').fill(String(claim.amountCents / 100));
  }
  for (const box of await page.getByRole('checkbox', { name: FILING.conforms }).all()) await box.check();
  await page.getByRole('button', { name: FILING.save }).click();
  await next(page, 3);

  // 4. The exhibits, each with its declared nature (art. 631).
  for (const [title, nature] of [
    ['عقد التوريد', 'ORIGINAL'],
    ['الفواتير الست', 'CERTIFIED_COPY'],
  ] as const) {
    await page.getByLabel(FILING.addExhibit).setInputFiles({ name: `${title}.pdf`, mimeType: 'application/pdf', buffer: PDF(title) });
    const row = page.getByRole('group', { name: new RegExp(title) });
    await expect(row).toBeVisible();
    await row.getByLabel('نوعية الوثيقة').selectOption(nature);
  }
  await page.getByRole('button', { name: FILING.save }).click();
  await next(page, 4);

  // 5. The court fee, detailed with its basis, then the simulated payment page.
  const fee = page.getByRole('region', { name: FILING.steps[4] });
  await expect(fee).toContainText(/5[.\u202F\u00A0 ]?570/);
  await expect(fee).toContainText(FILING.uncertain);
  await page.getByRole('button', { name: FILING.pay }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.payment);
  // The amount rests on rates not checked on the official text: the mark goes with it (independent review IR-26).
  await expect(page.locator('main')).toContainText(/5[.\u202F\u00A0 ]?570/);
  await expect(page.locator('main')).toContainText(FILING.uncertain);
  await expect(page.getByRole('button', { name: FILING.fail })).toBeVisible();
  await expect(page.getByRole('button', { name: FILING.cancel })).toBeVisible();
  await page.getByRole('button', { name: FILING.succeed }).click();
  await expect(page.getByRole('heading', { name: FILING.paymentReceipt })).toBeVisible();
  await expect(page.getByRole('region', { name: FILING.paymentReceipt })).toContainText(FILING.uncertain);
  await page.getByRole('link', { name: FILING.backToDraft }).click();

  // 6. The check before signature warns about the defendant's e-mail, then signature and filing.
  await expect(page.getByRole('heading', { level: 2, name: FILING.steps[5] })).toBeVisible();
  const checks = page.getByRole('region', { name: FILING.checks });
  await expect(checks).toContainText('البريد الإلكتروني');
  await page.getByLabel(FILING.bailiff).selectOption({ index: 1 });
  await page.getByLabel(FILING.signingSecret).fill(secrets().seedPassword);
  await page.getByRole('button', { name: FILING.signAndFile }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toContainText(/76/);
  await dialog.getByRole('button', { name: FORMS.account.confirm }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.receipt);
  const receipt = page.locator('main');
  await expect(receipt).toContainText(/\d+\/8201\/\d{4}/);
  await expect(receipt).toContainText(/[0-9a-f]{64}/);
  await expect(receipt).toContainText(FILING.natures.ORIGINAL);
  await expect(receipt).toContainText(FILING.natures.CERTIFIED_COPY);
  // «وصل الإيداع» shows the fee paid with its mark (independent review IR-26).
  await expect(receipt).toContainText(/5[.\u202F\u00A0 ]?570/);
  await expect(receipt).toContainText(FILING.uncertain);
  return (await receipt.textContent()) ?? '';
}

test.describe('the filing and the registration (Phase 2)', () => {
  test('the plaintiff’s lawyer files the model case from the first screen to the receipt', async ({ page, context }, info) => {
    await useOwnAddress(context);
    const mon = await monitor(context, page);
    await passGateUi(page, '/login');
    await loginUi(page, account('lawyer.plaintiff'));
    const receipt = await fileModelCase(page);
    const number = /(\d+)\/8201\/(\d{4})/.exec(receipt);
    expect(number).not.toBeNull();
    await page.screenshot({ path: info.outputPath('receipt.png'), fullPage: true });
    await expectAccessible(page, 'filing receipt');
    await expectNoViolation(page, mon, 'filing path');

    // The file is registered at once, and its timeline records the review of referrals.
    await page.getByRole('link', { name: /صفحة الملف/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.caseFile);
    await expect(page.locator('main')).toContainText('مقيد');
    // The model case calls for no referral, and the file says so (study, «ولم يجد موجبا للإحالة»).
    await expect(page.locator('main')).toContainText('مراجعة الإحالات الواجبة: لم يوجد موجب للإحالة');
  });

  test('the registry finds three buttons and none to reject, stamps the file, and files a paper application', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'one registry run per suite (code issuance cap)');
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, account('clerk.registration'));
    await page.goto('/registry');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.registry);
    const incoming = page.getByRole('region', { name: OFFICES.incoming });
    const first = incoming.getByRole('article').first();
    await expect(first).toBeVisible();
    await expect(first.getByText(OFFICES.caseCard)).toBeVisible();
    // The fee paid rests on rates not checked on the official text: the card says so (independent review IR-26).
    await expect(first).toContainText(FILING.uncertain);
    await expect(first.getByRole('button', { name: OFFICES.stamp })).toBeVisible();
    await expect(first.getByRole('button', { name: OFFICES.reclassify })).toBeVisible();
    await expect(first.getByRole('button', { name: OFFICES.noteToJudge })).toBeVisible();
    await expect(first.getByRole('button')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /رد المقال|رفض المقال|رد|رفض/ })).toHaveCount(0);

    await first.getByRole('button', { name: OFFICES.stamp }).click();
    await dialogOf(page).getByRole('button', { name: FORMS.account.confirm }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    // «إيداع ورقي»: the scan, its page count and the place of its paper original.
    await page.getByRole('button', { name: OFFICES.paperFiling }).click();
    await expect(page).toHaveURL(/\/filings\/[0-9a-f-]{36}/);
    await expect(page.getByText(FILING.demoNotice)).toBeVisible();
    await page.getByLabel(FILING.caseType).selectOption('8201');
    await page.getByRole('button', { name: FILING.save }).click();
    await next(page, 1);
    await page.getByLabel(FILING.uploadFile).setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: PDF('paper application scan') });
    await page.getByLabel(FILING.pages).fill('3');
    await page.getByLabel(FILING.originalLocation).fill('خزانة مكتب التقييد، الرف 2');
    await page.getByRole('button', { name: FILING.save }).click();
    await expect(page.getByRole('heading', { level: 2, name: FILING.steps[1] })).toBeVisible();
    await next(page, 2);

    // 3. The card the clerk authenticates with the depositor: typed by hand.
    const plaintiff = page.getByRole('group', { name: /الطرف 1/ });
    await plaintiff.getByLabel('مركز الطرف في الدعوى').selectOption('PLAINTIFF');
    await plaintiff.getByLabel('نوع الشخص').selectOption('NATURAL');
    await plaintiff.getByLabel('الاسم').fill('السيد عين');
    await page.getByRole('button', { name: FILING.addParty }).click();
    const defendant = page.getByRole('group', { name: /الطرف 2/ });
    await defendant.getByLabel('مركز الطرف في الدعوى').selectOption('DEFENDANT');
    await defendant.getByLabel('الاسم').fill('شركة غين للخدمات');
    await page.getByLabel('موجز الموضوع والوقائع والأسباب').fill('يطالب المدعي بثمن خدمات أداها للمدعى عليها ولم تؤده.');
    const claim = page.getByRole('group', { name: /الطلب 1/ });
    await claim.getByLabel('طبيعة الطلب').selectOption('DEBT');
    await claim.getByLabel('المبلغ بالدرهم').fill('20000');
    for (const box of await page.getByRole('checkbox', { name: FILING.conforms }).all()) await box.check();
    await page.getByRole('button', { name: FILING.save }).click();
    await next(page, 3);
    await next(page, 4);

    // 5. The depositor first, then the fee at the court's counter (decision 60).
    await page.getByLabel('اسم المودع').fill('السيد فاء');
    await page.getByRole('button', { name: FILING.save }).click();
    await expect(page.getByRole('button', { name: FILING.pay })).toBeEnabled();
    await page.getByRole('button', { name: FILING.pay }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.payment);
    await page.getByRole('button', { name: FILING.succeed }).click();
    await expect(page.getByRole('heading', { name: FILING.paymentReceipt })).toBeVisible();
    await page.getByRole('link', { name: FILING.backToDraft }).click();

    // 6. The clerk authenticates the card and hands over the receipt: no electronic signature (decision 59).
    await expect(page.getByRole('heading', { level: 2, name: FILING.steps[5] })).toBeVisible();
    await page.getByRole('button', { name: FILING.paperFile }).click();
    await dialogOf(page).getByRole('button', { name: FORMS.account.confirm }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.receipt);
    await expect(page.locator('main')).toContainText(/\d+\/8201\/\d{4}/);

    // The clerk lists the paper drafts, and is offered no button he does not hold.
    await page.goto('/filings');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.filings);
    await expect(page.getByRole('button', { name: FILING.newCase })).toHaveCount(0);
  });

  test('the cashier sees the incoming payment and its match with the claims', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'one cashier run per suite (code issuance cap)');
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, account('clerk.cashier'));
    await page.goto('/cashier');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.cashier);
    const payments = page.getByRole('region', { name: OFFICES.incomingPayments });
    await expect(payments).toContainText(/5[.\u202F\u00A0 ]?570/);
    // And the mark of an amount that rests on an unsettled rule (independent review IR-26).
    await expect(payments).toContainText(FILING.uncertain);
    await expect(page.getByRole('region', { name: OFFICES.deposits })).toBeVisible();
  });

  test('the prosecution finds its referrals by ground, with its two buttons', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop', 'one prosecution run per suite (code issuance cap)');
    await useOwnAddress(context);
    await passGateUi(page, '/login');
    await loginUi(page, account('prosecution'));
    const referrals = page.getByRole('region', { name: OFFICES.referrals });
    await expect(referrals).toBeVisible();
    await expect(referrals.getByRole('heading', { name: OFFICES.communication })).toBeVisible();
    await expect(referrals.getByRole('link', { name: OFFICES.viewCase }).first()).toBeVisible();
    const link = referrals.getByRole('link').first();
    await link.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PAGE_TITLES.caseFile);
    await expect(page.getByRole('button', { name: OFFICES.conclusions })).toBeVisible();
  });
});
