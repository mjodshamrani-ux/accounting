// The decision platform (UX-3) in the reviews that have no browser check of
// their own: a transaction's review on the supplier page, the PDF review's
// page buttons, jump and boundaries, and the image reader's value, range,
// effort and transfer steps. Every closed button says what opens it; after
// a decision the focus is on what it changed, in view; closing a
// transaction's review returns the focus to the button that opened it.
// Synthetic sources only; no financial truth is asserted here.
//   node --experimental-strip-types scripts/review-platform-browser.mjs
// MIZAN_DIST_DIR points it at another build (the mutation gate's), and
// REVIEW_PLATFORM_ONLY at some of its reviews, by name, comma separated.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';
import { closedSay, focused, pause } from './decision-platform-support.mjs';
import { verifyVisualReader } from './visual-browser-cases.mjs';
import { verifyVisualRegions } from './visual-region-browser-cases.mjs';
import { verifyVisualTable } from './visual-table-browser-cases.mjs';
import { verifyVisualAccounting } from './visual-accounting-browser-cases.mjs';
import { verifyReviewEffort } from './review-effort-browser-cases.mjs';

const root = path.resolve(process.env.MIZAN_DIST_DIR ?? 'dist');
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(u.pathname).replace(/^\/mizan-test\//, '/');
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.wasm': 'application/wasm',
        }[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/mizan-test/`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const errors = [],
  external = [];
const steps = [];
const only = process.env.REVIEW_PLATFORM_ONLY?.split(',');
const want = (name) => !only || only.includes(name);
async function scenario(label) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
  });
  context.setDefaultTimeout(45000);
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== origin && u.protocol !== 'blob:' && u.protocol !== 'data:')
      external.push(r.url());
  });
  const page = await context.newPage();
  steps.push(label);
  return { context, page };
}
const ready = (page) =>
  page.waitForFunction(
    () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
  );
try {
  await mkdir('work/qa', { recursive: true });
  if (want('transaction')) {
    // A transaction's review: its decisions wait for the reason and say so;
    // unlinking moves the transaction out of the matches, so the focus goes
    // to the list's heading; closing a review returns to its opener.
    const { context, page } = await scenario('transaction');
    await page.goto(url);
    await ready(page);
    await page.getByRole('button', { name: 'جرّب المثال', exact: true }).click();
    await page.getByRole('button', { name: 'تحقق وقارن', exact: true }).click();
    await page
      .getByRole('heading', { name: 'مساحة المراجعة' })
      .waitFor({ timeout: 30000 });
    await page.getByRole('tab', { name: 'المطابقات', exact: true }).click();
    const details = page.getByRole('button', {
      name: 'تفاصيل الحالة',
      exact: true,
    });
    const before = await details.count();
    assert.ok(before >= 2, 'two matches to review');
    const opener = await details.first().getAttribute('id');
    await details.first().click();
    const review = page.getByRole('region', { name: 'مراجعة الحركة' });
    const hint = review.locator('[data-decision-hint]');
    assert.ok(
      await closedSay(review, 'transaction review'),
      'unlinking is closed before the reason',
    );
    assert.equal(await hint.getAttribute('data-decision-hint'), 'reason');
    // Closing the review returns the focus to the button that opened it.
    await review.getByRole('button', { name: 'إغلاق المراجعة' }).click();
    await pause(page);
    let focus = await focused(page);
    assert.ok(opener, 'the opener has an id');
    assert.equal(focus.id, opener, 'closing returns to the opener');
    assert.ok(focus.inView, 'and the opener is in view');
    await details.first().click();
    await page
      .getByRole('textbox', { name: 'سبب القرار', exact: true })
      .fill('إعادة مراجعة المصدر — اختبار اصطناعي');
    assert.equal(await hint.getAttribute('data-decision-hint'), 'unlink');
    await page
      .getByRole('button', { name: 'فك الربط وإعادته للمراجعة' })
      .click();
    await page.waitForFunction(
      () => document.querySelector('.metric strong')?.textContent === '1',
    );
    await pause(page);
    focus = await focused(page);
    assert.equal(focus.tag, 'H2', 'after unlinking, the results heading');
    assert.equal(focus.text, 'مساحة المراجعة');
    assert.ok(focus.inView, 'and it is in view');
    // An unmatched transaction: recording a review without a match keeps
    // it open and takes the focus to the line that says it was reviewed.
    await page.getByRole('tab', { name: 'دون مقابل', exact: true }).click();
    await details.first().click();
    assert.equal(await hint.getAttribute('data-decision-hint'), 'reason');
    await page
      .getByRole('textbox', { name: 'سبب القرار', exact: true })
      .fill('مراجعة اصطناعية دون مطابقة');
    assert.equal(await hint.getAttribute('data-decision-hint'), 'link');
    assert.ok(
      await closedSay(review, 'transaction review, no counterpart'),
      'the manual link waits for a counterpart',
    );
    await review
      .getByRole('button', { name: 'تسجيل مراجعة دون مطابقة' })
      .click();
    await pause(page);
    focus = await focused(page);
    assert.ok(focus.item, 'the review line states the review');
    assert.equal(focus.text, 'تمت مراجعته وما زال غير مطابق');
    assert.ok(focus.inView, 'and it is in view');
    await context.close();
  }
  if (want('pdf')) {
    // The PDF review of a two-page file: on each end of the file the page
    // button that leads nowhere is closed and named by the page line; the
    // jump waits for another page; applying boundaries waits for a change.
    const { context, page } = await scenario('pdf');
    await page.goto(url);
    await ready(page);
    const header = ['Date', 'Reference', 'Amount (SAR)'];
    const pdf = Buffer.from(
      syntheticPdf([
        [header, ['2026-07-02', 'PAIR-INV-100', '100.00']],
        [header, ['2026-07-03', 'PAIR-PAY-100', '-20.00']],
      ]),
    );
    for (const [side, label] of [
      'كشف المورد',
      'تقرير الحسابات الدائنة',
    ].entries()) {
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: `synthetic-review-${side}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      });
      await page
        .locator('.dropzone')
        .filter({ hasText: label })
        .getByText(`synthetic-review-${side}.pdf`, { exact: true })
        .waitFor();
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
    }
    await page
      .getByRole('button', { name: 'تأكيد البيانات', exact: true })
      .click();
    const card = page
      .locator('section')
      .filter({
        has: page.getByRole('heading', { name: 'كشف المورد', exact: true }),
      })
      .last();
    const next = card.getByRole('button', {
      name: 'صفحة PDF التالية',
      exact: true,
    });
    await next.waitFor();
    const said = async (name, pattern) => {
      const button = card.getByRole('button', { name, exact: true });
      assert.ok(await button.isDisabled(), `${name} is closed`);
      const text = await button.evaluate((b) =>
        (b.getAttribute('aria-describedby') ?? '')
          .split(/\s+/u)
          .map((id) => document.getElementById(id))
          .filter((el) => el && !el.hidden && el.textContent.trim())
          .map((el) => el.textContent.trim())
          .join(' | '),
      );
      assert.match(text, pattern, `${name} says why (${text})`);
    };
    await said('صفحة PDF السابقة', /صفحة PDF 1 من 2/u);
    await said('انتقال إلى الصفحة', /كتابة صفحة غير المعروضة/u);
    await closedSay(card, 'PDF review, first page');
    await card.getByLabel('رقم الصفحة', { exact: true }).fill('9');
    await said('انتقال إلى الصفحة', /كتابة رقم صفحة من 1 إلى 2/u);
    await card.getByLabel('رقم الصفحة', { exact: true }).fill('1');
    await next.click();
    await card
      .locator('.preview tbody')
      .getByText('PAIR-PAY-100', { exact: true })
      .waitFor();
    await said('صفحة PDF التالية', /صفحة PDF 2 من 2/u);
    await closedSay(card, 'PDF review, last page');
    await card
      .getByRole('button', { name: 'تعديل حدود الأعمدة', exact: true })
      .click();
    await said('تطبيق الحدود وإعادة القراءة', /تغيير الحدود عن المستعملة/u);
    await card.getByLabel('حدود أعمدة PDF', { exact: true }).fill('25, x');
    await said('تطبيق الحدود وإعادة القراءة', /اكتب أرقامًا/u);
    await closedSay(card, 'PDF review, boundaries');
    await context.close();
  }
  for (const [label, verify] of [
    ['values', verifyVisualReader],
    ['ranges', verifyVisualRegions],
    ['table', verifyVisualTable],
    ['transfer', verifyVisualAccounting],
    ['effort', verifyReviewEffort],
  ]) {
    if (!want(label)) continue;
    const { context, page } = await scenario(label);
    await verify(page, url);
    await context.close();
  }
  assert.ok(steps.length, 'a review was checked');
  assert.deepEqual(external, [], 'all requests remain local');
  assert.deepEqual(errors, [], 'no browser page errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  `Review platform: PASS, ${steps.length} reviews: ${steps.join(', ')}`,
);
