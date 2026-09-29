// Bilingual acceptance round. One reconciliation is driven through upload,
// column mapping, scope, format ambiguity, comparison, review decisions,
// session save and restore, and export, with every label taken from the
// language catalogue that is active at that moment. The same scenario runs
// entirely in Arabic, entirely in English, and switching language at each
// stage; the exported workpapers, the saved sessions and the figures on
// screen must be identical across all runs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import {
  supplierXlsx,
  ledgerCsv,
  userData,
} from '../tests/helpers/bilingual-fixture.mjs';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';

const catalogs = { ar, en };
const ARABIC = /[؀-ۿ]/;
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : 'work/acceptance-bilingual.json';
const STAGES = [
  'upload',
  'between-files',
  'confirm',
  'mapped',
  'choices',
  'review',
  'decisions',
  'export',
  'restore',
];
const plans = {
  arabic: Object.fromEntries(STAGES.map((stage) => [stage, 'ar'])),
  english: Object.fromEntries(STAGES.map((stage) => [stage, 'en'])),
  'switch-ar-first': Object.fromEntries(
    STAGES.map((stage, i) => [stage, i % 2 ? 'en' : 'ar']),
  ),
  'switch-en-first': Object.fromEntries(
    STAGES.map((stage, i) => [stage, i % 2 ? 'ar' : 'en']),
  ),
};
// Arabic that may appear in English mode: the files' own content, the
// wordmark, the Arabic language option and one digit example.
// What the accountant types is user data too.
const typed = {
  unlink: 'مراجعة المصدر — source check',
  review: 'Reviewed with the supplier — تمت المراجعة',
  reviewer: 'مراجع اختبار — Test Reviewer',
  notes: 'ملاحظة اصطناعية — synthetic note',
};
const allowedArabic = [
  ...userData,
  ...Object.values(typed),
  'تَـراصُـف',
  'العربية',
  '١٢٣',
].sort(
  (a, b) => b.length - a.length,
);

const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(
      /^\/mizan-test\//,
      '/',
    );
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const type =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/mizan-test/`;

async function language(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  }));
}
async function setLanguage(page, lang) {
  const current = (await language(page)).lang;
  if (current !== lang)
    await page.locator(`.language-switch button[lang="${lang}"]`).click();
  assert.deepEqual(await language(page), {
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
  });
  return catalogs[lang];
}
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
}
async function choose(page, label, option) {
  const trigger = page.getByRole('combobox', { name: label, exact: true });
  await trigger.click();
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('[role="combobox"]')].some(
        (element) =>
          element.getAttribute('aria-label') === name &&
          element.getAttribute('aria-expanded') === 'true',
      ),
    label,
  );
  // Lists that were closed can stay in the page; use the one this control
  // owns.
  const list = await trigger.getAttribute('aria-controls');
  await page
    .locator(`[id="${list}"]`)
    .getByRole('option', { name: option, exact: true })
    .click();
  await page.waitForFunction(
    () => ![...document.querySelectorAll('[role="combobox"]')].some(
      (element) => element.getAttribute('aria-expanded') === 'true',
    ),
  );
}
async function metrics(page) {
  return page.locator('.metric strong').allInnerTexts();
}
async function strayArabic(page) {
  const texts = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || element.closest('script, style')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (node.textContent.trim()) found.push(node.textContent.trim());
    }
    for (const element of document.querySelectorAll(
      '[aria-label], [placeholder], [alt], [title]',
    ))
      for (const name of ['aria-label', 'placeholder', 'alt', 'title']) {
        const value = element.getAttribute(name);
        if (value?.trim()) found.push(value.trim());
      }
    return found;
  });
  return texts
    .map((text) =>
      allowedArabic.reduce((value, data) => value.split(data).join(''), text),
    )
    .filter((text) => ARABIC.test(text));
}
async function workbookCells(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const cells = {};
  for (const sheet of workbook.worksheets)
    sheet.eachRow({ includeEmpty: false }, (row, r) =>
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        cells[`${sheet.name}!${r}:${c}`] =
          cell.value instanceof Date
            ? cell.value.toISOString()
            : JSON.stringify(cell.value);
      }),
    );
  return { sheets: workbook.worksheets.map((s) => `${s.name}:${s.state}`), cells };
}
// Timestamps are the only values allowed to differ between runs.
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const untimed = (text) => text.replace(ISO_TIME, '<time>');

async function scenario(context, name, plan) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const stray = {};
  const check = async (stage) => {
    if (plan[stage] !== 'en') return;
    const left = await strayArabic(page);
    if (left.length) stray[stage] = left;
  };
  await page.goto(url);
  await page.evaluate(() => localStorage.removeItem('tarasuf.lang'));
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('.notice.loading') && !!document.querySelector('.language-switch'),
  );

  // Upload, one file at a time.
  let m = await setLanguage(page, plan.upload);
  await page.getByRole('button', { name: m.app.upload.demoButton, exact: true }).waitFor();
  await page
    .getByLabel(m.app.sides[0], { exact: true })
    .setInputFiles({
      name: 'supplier-april.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await supplierXlsx(),
    });
  await idle(page);
  await check('upload');
  m = await setLanguage(page, plan['between-files']);
  await page
    .getByLabel(m.app.sides[1], { exact: true })
    .setInputFiles({ name: 'ledger-april.csv', mimeType: 'text/csv', buffer: ledgerCsv });
  await idle(page);
  await check('between-files');
  await page.getByRole('button', { name: m.app.upload.next, exact: true }).click();

  // Scope: cut-off date and date tolerance.
  m = await setLanguage(page, plan.confirm);
  const scopeToggle = page.getByRole('button', { name: m.app.scope.edit, exact: true });
  if ((await scopeToggle.getAttribute('aria-expanded')) !== 'true')
    await scopeToggle.click();
  await page.getByLabel(m.app.scope.cutoffLabel, { exact: true }).fill('2026-04-30');
  await choose(page, m.app.scope.dateWindowField, m.app.scope.days(3));
  assert.equal(
    await page.getByLabel(m.app.scope.currencyLabel, { exact: true }).inputValue(),
    'KWD',
  );
  await check('confirm');

  // Mapping: the ledger's date column from the missing-columns panel, its
  // reference and description from the advanced options.
  m = await setLanguage(page, plan.mapped);
  await choose(page, m.app.source.dateColumn, '1 · Posted');
  await page.getByRole('button', { name: m.app.source.edit(1), exact: true }).click();
  await choose(page, m.app.source.referenceColumn, '2 · Voucher key');
  await choose(page, m.app.source.descriptionColumn, '3 · Narrative');
  await page.getByRole('button', { name: m.app.source.edit(1), exact: true }).click();
  await check('mapped');
  const blockedBefore = await page
    .getByRole('button', { name: m.app.compare.run, exact: true })
    .isDisabled();

  // Ambiguity: each side needs an explicit date and amount reading.
  for (const side of [0, 1]) {
    await choose(page, m.app.source.dateFormatIn(side), m.app.dateFormats.dmy);
    await choose(page, m.app.source.numberFormatIn(side), '1,234.56');
  }
  m = await setLanguage(page, plan.choices);
  for (const side of [0, 1])
    assert.ok(
      (
        await page
          .getByRole('combobox', { name: m.app.source.dateFormatIn(side), exact: true })
          .innerText()
      ).includes(m.app.dateFormats.dmy),
      'the chosen date format survives a language switch',
    );
  await check('choices');
  await page.getByRole('button', { name: m.app.compare.run, exact: true }).click();

  // Review: one automatic match undone, one case reviewed without a match.
  await page.getByRole('heading', { name: m.app.results.workspace, exact: true }).waitFor();
  const firstMetrics = await metrics(page);
  m = await setLanguage(page, plan.review);
  await page.getByRole('heading', { name: m.app.results.workspace, exact: true }).waitFor();
  assert.deepEqual(await metrics(page), firstMetrics);
  await check('review');
  await page.getByRole('tab', { name: m.app.results.tabMatched, exact: true }).click();
  const matchedRows = await page.locator('tbody tr').allInnerTexts();
  await page.getByRole('button', { name: m.app.results.caseDetails, exact: true }).first().click();
  const explanationLang = plan.review;
  const explanation = await page.locator('.review-detail p').first().innerText();
  await page
    .getByRole('textbox', { name: m.transactionReview.noteLabel, exact: true })
    .fill(typed.unlink);
  await page.getByRole('button', { name: m.transactionReview.unlink, exact: true }).click();
  await page.waitForFunction(
    (before) => document.querySelector('.metric strong')?.textContent !== before,
    firstMetrics[0],
  );
  await idle(page);
  m = await setLanguage(page, plan.decisions);
  await page.getByRole('tab', { name: m.app.results.tabUnmatched, exact: true }).click();
  await page.getByRole('button', { name: m.app.results.caseDetails, exact: true }).first().click();
  await page
    .getByRole('textbox', { name: m.transactionReview.noteLabel, exact: true })
    .fill(typed.review);
  await page.getByRole('button', { name: m.transactionReview.reviewOnly, exact: true }).click();
  await page.getByRole('status').filter({ hasText: m.app.notices.reviewRecorded }).waitFor();
  await page.getByRole('button', { name: m.assistant.trigger, exact: true }).click();
  await page.getByRole('button', { name: m.assistant.presets.next, exact: true }).click();
  const answer = page.locator('[aria-live="polite"] article p').last();
  await answer.waitFor();
  const assistantAnswer = await answer.innerText();
  await check('decisions');
  const reviewMetrics = await metrics(page);
  const reviewTabs = await page.getByRole('tab').allInnerTexts();

  // The workpaper, then the session file with the same review notes.
  await page.getByRole('button', { name: m.app.results.prepareWorkpaper }).click();
  m = await setLanguage(page, plan.export);
  await page
    .getByRole('textbox', { name: m.app.finish.reviewerLabel, exact: true })
    .fill(typed.reviewer);
  await page
    .getByRole('textbox', { name: m.app.finish.notesLabel, exact: true })
    .fill(typed.notes);
  await check('export');
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: m.app.finish.downloadDraft }).click();
  const workbook = await workbookCells(await (await exportEvent).path());
  await page.getByRole('status').filter({ hasText: m.app.notices.workpaperReady }).waitFor();
  const sessionEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: m.app.results.saveSession, exact: true }).click();
  const sessionPath = await (await sessionEvent).path();
  const session = untimed(await readFile(sessionPath, 'utf8'));
  await page.getByRole('status').filter({ hasText: m.app.notices.sessionSaved }).waitFor();

  // Restore the saved session on a fresh page.
  const restorePage = await context.newPage();
  restorePage.on('pageerror', (error) => errors.push(error.message));
  await restorePage.goto(url);
  await restorePage.waitForFunction(() => !!document.querySelector('.language-switch'));
  const rm = await setLanguage(restorePage, plan.restore);
  await restorePage.waitForFunction(() => !document.querySelector('.notice.loading'));
  await restorePage
    .getByLabel(rm.app.upload.resumeLabel, { exact: true })
    .setInputFiles(sessionPath);
  await restorePage
    .getByRole('heading', { name: rm.app.results.workspace, exact: true })
    .waitFor();
  await restorePage.getByRole('status').filter({ hasText: rm.app.notices.sessionRestored }).waitFor();
  const restoredMetrics = await metrics(restorePage);
  if (plan.restore === 'en') {
    const left = await strayArabic(restorePage);
    if (left.length) stray.restore = left;
  }
  await restorePage.getByRole('button', { name: rm.app.results.prepareWorkpaper }).click();
  const restoredExportEvent = restorePage.waitForEvent('download');
  await restorePage.getByRole('button', { name: rm.app.finish.downloadDraft }).click();
  const restoredWorkbook = await workbookCells(
    await (await restoredExportEvent).path(),
  );
  await restorePage.close();
  await page.close();
  return {
    name,
    plan,
    errors,
    stray,
    blockedBeforeChoices: blockedBefore,
    firstMetrics,
    reviewMetrics,
    restoredMetrics,
    reviewTabsLanguage: plan.decisions,
    reviewTabs,
    matchedRows: matchedRows.length,
    explanationLang,
    explanation,
    assistantLang: plan.decisions,
    assistantAnswer,
    session,
    workbook,
    restoredWorkbook,
  };
}

// Latin words the Arabic interface shows as they are (the same list as
// tests/i18n.test.ts, plus the wordmark's Latin name).
const allowedLatin = new Set(
  'PDF Excel CSV XLSX PNG JPEG MB SAR KWD Diagnostics AR EN English UTF Unicode OCR URL TARASUF'.split(
    ' ',
  ),
);
const pdfRows = [
  ['Date', 'Doc. Ref', 'Narration', 'Value'],
  ['2026-04-03', 'INV-A101', 'Invoice', '1.250'],
  ['2026-04-07', 'PAY-A201', 'Payment', '-1.250'],
];
const statesData = [
  ...pdfRows.flat(),
  'statement.pdf',
  'image-only.pdf',
  'notes.txt',
  'ledger-april.csv',
  ...ledgerCsv.toString().split(/[\n,]/),
];
async function strayEnglish(page, extra) {
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => {
        const style = getComputedStyle(e);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .flatMap((e) => [
        ...[...e.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim()),
        ...['aria-label', 'placeholder', 'alt', 'title'].map(
          (name) => e.getAttribute(name) ?? '',
        ),
      ])
      .filter(Boolean),
  );
  const data = new Set(extra.flatMap((text) => text.match(/[A-Za-z]{2,}/g) ?? []));
  return [
    ...new Set(
      texts
        .map((text) => text.replace(/\b(?:supplier|ledger):\d+:\d+\b/g, ''))
        .flatMap((text) => text.match(/[A-Za-z]{2,}/g) ?? [])
        .filter((word) => !allowedLatin.has(word) && !data.has(word)),
    ),
  ];
}

// Screens the main scenario does not reach: privacy panel, reading errors,
// the image-only diagnosis with the image reader, PDF review, the reset
// dialog. Each is scanned for the other language and for overflow at phone
// and desktop widths.
async function states(context, lang) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const findings = {};
  const overflow = {};
  const scan = async (state) => {
    const left =
      lang === 'en'
        ? (await strayArabic(page)).filter(
            (text) => !statesData.some((data) => text.includes(data)),
          )
        : await strayEnglish(page, statesData);
    if (left.length) findings[state] = left;
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      );
      if (wide) (overflow[state] ??= []).push(width);
      await page.screenshot({ path: `work/qa/bilingual-${lang}-${state}-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
  };
  await page.goto(url);
  await page.waitForFunction(() => !!document.querySelector('.language-switch'));
  const m = await setLanguage(page, lang);
  await idle(page);
  await page.getByRole('button', { name: m.app.shell.localPill }).click();
  await page.locator('#privacy-detail-title').getByText(m.app.shell.privacyTitle).waitFor();
  await scan('privacy');
  await page.getByRole('button', { name: m.app.shell.privacyClose, exact: true }).click();
  await page
    .getByLabel(m.app.sides[0], { exact: true })
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await page.getByRole('alert').waitFor();
  const unsupported = await page.getByRole('alert').innerText();
  await scan('unsupported-file');
  await page.getByLabel(m.app.sides[0], { exact: true }).setInputFiles({
    name: 'image-only.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(
      syntheticPdf([[]], 10, 'q 30 0 0 30 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID\nX\nEI\nQ'),
    ),
  });
  await page.getByRole('alert').filter({ hasText: m.app.importStop.at(1, 1).trim() }).waitFor();
  const diagnosis = await page.getByRole('alert').innerText();
  await page.locator('#visual-reader summary').click();
  await page
    .getByRole('button', { name: m.visualReader.tryCandidate, exact: true })
    .waitFor();
  await scan('image-only-diagnosis');
  await page.getByLabel(m.app.sides[0], { exact: true }).setInputFiles({
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticPdf([pdfRows])),
  });
  await idle(page);
  await page
    .getByLabel(m.app.sides[1], { exact: true })
    .setInputFiles({ name: 'ledger-april.csv', mimeType: 'text/csv', buffer: ledgerCsv });
  await idle(page);
  await page.getByRole('button', { name: m.app.upload.next, exact: true }).click();
  await page.getByText(m.pdfReview.heading, { exact: true }).waitFor();
  await scan('pdf-review');
  await page.getByRole('button', { name: m.app.shell.newReconciliation }).click();
  await page.getByRole('alertdialog').waitFor();
  assert.equal(
    await page.getByRole('alertdialog').getAttribute('dir'),
    lang === 'ar' ? 'rtl' : 'ltr',
  );
  await scan('reset-dialog');
  await page.getByRole('button', { name: m.app.shell.resetCancel, exact: true }).click();
  await page.close();
  return { lang, errors, findings, overflow, unsupported, diagnosis };
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM ? { executablePath: process.env.MIZAN_CHROMIUM } : {}),
});
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(30000);
  const external = [];
  context.on('request', (request) => {
    const target = new URL(request.url());
    if (!['blob:', 'data:'].includes(target.protocol) && target.host !== new URL(url).host)
      external.push(request.url());
  });
  for (const [name, plan] of Object.entries(plans)) {
    console.log(`[bilingual] ${name}`);
    results.push(await scenario(context, name, plan));
  }
  const screens = [];
  for (const lang of ['ar', 'en']) {
    console.log(`[bilingual] states ${lang}`);
    screens.push(await states(context, lang));
  }
  const [reference] = results;
  const differing = (a, b) =>
    Object.keys({ ...a.cells, ...b.cells }).filter(
      (key) => untimed(a.cells[key] ?? '') !== untimed(b.cells[key] ?? ''),
    );
  const summary = {
    runs: results.map((r) => ({
      name: r.name,
      plan: r.plan,
      errors: r.errors,
      strayArabicInEnglish: r.stray,
      blockedBeforeChoices: r.blockedBeforeChoices,
      firstMetrics: r.firstMetrics,
      reviewMetrics: r.reviewMetrics,
      restoredMetrics: r.restoredMetrics,
      reviewTabs: r.reviewTabs,
      explanation: { lang: r.explanationLang, text: r.explanation },
      assistant: { lang: r.assistantLang, text: r.assistantAnswer },
      workbookCells: Object.keys(r.workbook.cells).length,
      restoredWorkbookDiffers: differing(r.workbook, r.restoredWorkbook),
      workbookDiffersFromArabic: differing(reference.workbook, r.workbook),
      sessionMatchesArabic: r.session === reference.session,
    })),
    screens,
    external,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(summary, null, 2));
  for (const run of summary.runs) {
    assert.deepEqual(run.errors, [], `${run.name}: page errors`);
    assert.deepEqual(run.strayArabicInEnglish, {}, `${run.name}: Arabic in English mode`);
    assert.equal(run.blockedBeforeChoices, true, `${run.name}: ambiguity must block`);
    assert.deepEqual(run.firstMetrics, reference.firstMetrics, `${run.name}: first result`);
    assert.deepEqual(run.reviewMetrics, reference.reviewMetrics, `${run.name}: after decisions`);
    assert.deepEqual(run.restoredMetrics, reference.reviewMetrics, `${run.name}: restored`);
    assert.deepEqual(run.restoredWorkbookDiffers, [], `${run.name}: restored workpaper`);
    assert.deepEqual(run.workbookDiffersFromArabic, [], `${run.name}: workpaper vs Arabic run`);
    assert.equal(run.sessionMatchesArabic, true, `${run.name}: session file vs Arabic run`);
    assert.ok(run.workbookCells > 50, `${run.name}: workpaper has content`);
    const englishAnswer = run.assistant.lang === 'en' ? run.assistant.text : '';
    assert.doesNotMatch(
      allowedArabic.reduce((v, d) => v.split(d).join(''), englishAnswer),
      ARABIC,
      `${run.name}: assistant answer in English`,
    );
  }
  for (const screen of screens) {
    assert.deepEqual(screen.errors, [], `${screen.lang}: page errors`);
    assert.deepEqual(screen.findings, {}, `${screen.lang}: text in the other language`);
    assert.deepEqual(screen.overflow, {}, `${screen.lang}: horizontal overflow`);
  }
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ passed: true, runs: summary.runs.map((r) => r.name), out }, null, 2));
} finally {
  await browser.close();
  server.close();
}
