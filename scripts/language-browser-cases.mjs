import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { demoFiles, demoScope } from '../lib/reconciliation/demo.ts';

const ARABIC = /[؀-ۿ]/;
// Arabic that stays Arabic in English mode: the sample documents' own text
// (user data), the brand wordmark, the Arabic language option and one digit
// example.
const allowedArabic = [
  ...demoFiles.flatMap((file) =>
    file.sheets.flatMap((sheet) => [sheet.name, ...sheet.rows.flat()]),
  ),
  demoScope.supplier,
  demoScope.entity,
  demoScope.account,
  'تَـراصُـف',
  'العربية',
  // An example of the Arabic-Indic digits the image reader is weak on.
  '١٢٣',
]
  .filter((text) => ARABIC.test(text))
  .sort((a, b) => b.length - a.length);
// Latin words the Arabic interface uses as they are: formats, units, codes.
const allowedLatin = new Set(
  'PDF Excel CSV XLSX PNG JPEG MB SAR KWD Diagnostics AR EN English TARASUF'.split(
    ' ',
  ),
);

async function visibleText(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || element.closest('script, style, [hidden]')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (node.textContent.trim()) out.push(node.textContent.trim());
    }
    for (const element of document.querySelectorAll(
      '[aria-label], [placeholder], [alt], [title]',
    ))
      for (const name of ['aria-label', 'placeholder', 'alt', 'title']) {
        const value = element.getAttribute(name);
        if (value?.trim()) out.push(value.trim());
      }
    return out;
  });
}

async function assertNoArabic(page, where) {
  const left = (await visibleText(page))
    .map((text) =>
      allowedArabic.reduce((value, data) => value.split(data).join(''), text),
    )
    .filter((text) => ARABIC.test(text));
  assert.deepEqual(left, [], `untranslated Arabic in English mode (${where})`);
}

async function assertNoStrayEnglish(page, where) {
  const words = (await visibleText(page))
    // Source row IDs (supplier:0:2) and the sample's own Latin data are data,
    // not interface copy.
    .map((text) => text.replace(/\b(?:supplier|ledger):\d+:\d+\b/g, ''))
    .flatMap((text) => text.match(/[A-Za-z]{2,}/g) ?? [])
    .filter((word) => !allowedLatin.has(word));
  const sampleLatin = new Set(
    demoFiles.flatMap((file) =>
      file.sheets.flatMap((sheet) =>
        [sheet.name, ...sheet.rows.flat()].flatMap(
          (text) => text.match(/[A-Za-z]{2,}/g) ?? [],
        ),
      ),
    ),
  );
  assert.deepEqual(
    [...new Set(words.filter((word) => !sampleLatin.has(word)))],
    [],
    `English words in Arabic mode (${where})`,
  );
}

async function documentLanguage(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    stored: localStorage.getItem('tarasuf.lang'),
    title: document.title,
  }));
}

async function metrics(page) {
  return page.locator('.metric strong').allInnerTexts();
}

async function switchTo(page, code) {
  await page
    .getByRole('group', { name: code === 'en' ? 'لغة الواجهة' : 'Interface language' })
    .getByRole('button', { name: new RegExp(`^${code.toUpperCase()}\\b`) })
    .click();
  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    code,
  );
}

export async function verifyLanguages(page, url) {
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('tarasuf.lang'));
  await page.reload();
  await page.getByRole('button', { name: 'جرّب المثال', exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
  );
  // Arabic is the default, right to left, with the switcher in the header.
  assert.deepEqual(
    { ...(await documentLanguage(page)), title: undefined },
    { lang: 'ar', dir: 'rtl', stored: null, title: undefined },
  );
  const group = page.getByRole('group', { name: 'لغة الواجهة' });
  assert.equal(
    await group.getByRole('button', { pressed: true }).getAttribute('lang'),
    'ar',
  );
  await assertNoStrayEnglish(page, 'Arabic landing');

  // Reach the review workspace in Arabic, with an assistant answer on screen.
  await page.getByRole('button', { name: 'جرّب المثال', exact: true }).click();
  await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
  await page.getByRole('heading', { name: 'مساحة المراجعة' }).waitFor();
  await page.getByRole('button', { name: 'مساعد فهم النتيجة', exact: true }).click();
  await page
    .getByRole('button', { name: 'لماذا يوجد فرق في الأرصدة؟', exact: true })
    .click();
  await page.getByText('فرق الأرصدة الفعلي', { exact: false }).waitFor();
  await page.getByRole('tab', { name: 'يحتاج مراجعة (2)', exact: true }).click();
  const arabicMetrics = await metrics(page);
  const arabicRows = await page.locator('tbody tr').count();
  await assertNoStrayEnglish(page, 'Arabic review');

  // Switching keeps the session exactly where it was.
  await switchTo(page, 'en');
  const english = await documentLanguage(page);
  assert.deepEqual(
    { lang: english.lang, dir: english.dir, stored: english.stored },
    { lang: 'en', dir: 'ltr', stored: 'en' },
  );
  assert.equal(english.title, 'Tarasuf — Supplier Account Reconciliation');
  await page.getByRole('heading', { name: 'Review workspace' }).waitFor();
  assert.deepEqual(await metrics(page), arabicMetrics, 'same result in English');
  assert.equal(await page.locator('tbody tr').count(), arabicRows);
  assert.equal(
    await page.getByRole('tab', { name: 'Needs Review (2)', exact: true }).getAttribute('aria-selected'),
    'true',
    'the selected tab survives the switch',
  );
  const answer = await page.locator('[aria-live="polite"]').innerText();
  assert.ok(answer.includes('Why is there a difference in the balances?'), answer);
  assert.ok(answer.includes('Actual balance difference'), answer);
  assert.ok(answer.includes('3,500.00'), answer);
  await assertNoArabic(page, 'review');
  await page.screenshot({ path: 'work/qa/english-review.png', fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      ),
      false,
      `English review overflows at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1050 });

  // Case details and the workpaper flow work in English.
  await page.getByRole('button', { name: 'Case details', exact: true }).first().click();
  await page.getByRole('region', { name: 'Transaction review' }).waitFor();
  await assertNoArabic(page, 'case details');
  await page.getByRole('button', { name: 'Prepare the workpaper' }).click();
  await page
    .getByRole('textbox', { name: 'Review notes', exact: true })
    .fill('Synthetic test — English');
  await assertNoArabic(page, 'workpaper');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel draft' }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await (await downloadEvent).path());
  // The workpaper is the same audit record in either language.
  assert.equal(workbook.worksheets[0].name, 'Summary');
  assert.equal(workbook.getWorksheet('Matches').rowCount, 3);
  await page.getByRole('status').filter({ hasText: 'The workpaper is ready' }).waitFor();

  // Right to left again, with the notes and step intact.
  await switchTo(page, 'ar');
  assert.equal((await documentLanguage(page)).dir, 'rtl');
  assert.equal(
    await page.getByRole('textbox', { name: 'ملاحظات المراجعة', exact: true }).inputValue(),
    'Synthetic test — English',
  );
  await page.getByRole('status').filter({ hasText: 'ورقة العمل جاهزة' }).waitFor();

  // The choice is remembered, and the landing reads fully in English.
  await switchTo(page, 'en');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Try the sample', exact: true }).waitFor();
  assert.deepEqual(
    { ...(await documentLanguage(page)), title: undefined },
    { lang: 'en', dir: 'ltr', stored: 'en', title: undefined },
  );
  await assertNoArabic(page, 'landing');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      ),
      false,
      `English layout overflows at ${width}px`,
    );
    await page.screenshot({
      path: `work/qa/english-landing-${width}.png`,
      fullPage: width === 390,
    });
  }
  await page.evaluate(() => localStorage.removeItem('tarasuf.lang'));
}
