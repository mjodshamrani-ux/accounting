import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';
import {
  restoreReviewEffort,
  summarizeReviewEffort,
} from '../lib/review-effort.ts';

/** Known development case only. Accelerated clock tests are not human timings. */
export async function verifyReviewEffort(page, baseUrl) {
  const messages = { ar, en },
    violations = [],
    errors = [];
  const origin = new URL(baseUrl).origin;
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
    )
      violations.push(request.url());
  };
  const onError = (e) => errors.push(e.message);
  page.context().on('request', onRequest);
  page.on('pageerror', onError);
  await mkdir('work/qa', { recursive: true });
  try {
    for (const lang of ['ar', 'en']) {
      await page.setViewportSize(
        lang === 'ar'
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
      );
      await page.goto(baseUrl);
      await page
        .getByRole('button', { name: new RegExp(`^${lang.toUpperCase()}\\b`) })
        .first()
        .click();
      const t = messages[lang],
        v = t.reviewEffort;
      const panel = page.locator('#visual-reader');
      await panel.locator('summary').first().click();
      await panel
        .getByLabel(t.visualReview.restoreLabel, { exact: true })
        .setInputFiles({
          name: 'known-development.json',
          mimeType: 'application/json',
          buffer: await readFile('audit/visual-split/baseline/en.json'),
        });
      await panel
        .getByRole('heading', { name: t.visualReview.title, exact: true })
        .waitFor();
      const meter = panel.locator('[data-review-effort-controls]');
      await meter.locator('summary').click();
      assert.equal(
        await meter
          .getByRole('button', { name: v.start, exact: true })
          .isDisabled(),
        true,
      );
      await meter
        .getByLabel(v.sample, { exact: true })
        .selectOption('development');
      await page.clock.install();
      await meter.getByRole('button', { name: v.start, exact: true }).click();
      assert.equal(
        await meter.getByRole('button', { name: v.start, exact: true }).count(),
        0,
      );
      assert.equal(
        await meter
          .getByRole('button', { name: v.export, exact: true })
          .isDisabled(),
        true,
      );
      await panel.locator('.visual-word').first().click();
      await meter.getByText(v.actions(1, 0, 0), { exact: true }).waitFor();
      await page.clock.fastForward(5000);
      await meter.getByRole('button', { name: v.pause, exact: true }).click();
      await page.clock.fastForward(5000);
      await meter.getByRole('button', { name: v.resume, exact: true }).click();
      await meter.getByLabel(v.stage, { exact: true }).selectOption('table');
      await meter.getByLabel(v.rework, { exact: true }).check();
      await page.clock.fastForward(2000);
      // A real click and change within the review, excluding measurement controls.
      const table = panel.locator('.visual-table-review');
      await table.locator('summary').first().click();
      await table.locator('summary').first().click();
      const tableDownload = page.waitForEvent('download');
      await table
        .getByRole('button', { name: t.visualTable.save, exact: true })
        .click();
      await tableDownload;
      await meter.getByText(v.paused.processing, { exact: true }).waitFor();
      await page.clock.fastForward(2000);
      await meter.getByRole('button', { name: v.resume, exact: true }).click();
      const row = table.getByRole('region', {
        name: t.visualTable.row(1),
        exact: true,
      });
      await row
        .getByLabel(t.visualTable.disposition, { exact: true })
        .selectOption('unclassified');
      await page.clock.fastForward(35000);
      await meter.getByText(v.paused.idle, { exact: true }).waitFor();
      // Clicking the source review does not resume an idle measurement.
      await table.locator('summary').first().click();
      await meter.getByText(v.paused.idle, { exact: true }).waitFor();
      await meter.getByRole('button', { name: v.resume, exact: true }).click();
      // CI verifies the blur handler only. Native-focus validation is separate.
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.clock.fastForward(10000);
      await meter.getByText(v.paused.hidden, { exact: true }).waitFor();
      await meter.getByRole('button', { name: v.resume, exact: true }).click();
      await meter.getByLabel(v.rework, { exact: true }).uncheck();
      await meter.getByLabel(v.stage, { exact: true }).selectOption('context');
      await page.clock.fastForward(1000);
      await meter.getByRole('button', { name: v.finish, exact: true }).click();
      assert.equal(
        await meter
          .getByRole('button', { name: v.finish, exact: true })
          .isDisabled(),
        true,
      );
      const downloading = page.waitForEvent('download');
      await meter.getByRole('button', { name: v.export, exact: true }).click();
      const download = await downloading;
      await download.saveAs(`work/qa/review-effort-${lang}.json`);
      const record = restoreReviewEffort(
        await readFile(await download.path(), 'utf8'),
      );
      const s = summarizeReviewEffort(record);
      assert.equal(record.sample, 'development');
      assert.ok(s.firstMs.values >= 5000 && s.firstMs.context >= 1000);
      assert.ok(s.reworkMs.table >= 32000);
      assert.ok(
        s.pausedMs.manual >= 5000 &&
          s.pausedMs.idle >= 5000 &&
          s.pausedMs.hidden >= 10000,
      );
      assert.equal(s.resumes, 4);
      assert.ok(s.pausedMs.processing >= 2000);
      assert.ok(s.actions.click >= 1 && s.actions.change >= 1);
      assert.equal(
        s.atMs,
        s.activeMs + Object.values(s.pausedMs).reduce((a, b) => a + b, 0),
      );
      assert.ok(
        !/originalPng|supplier|value"|name"/.test(JSON.stringify(record)),
      );
      // Language changes preserve the finished measurement; reset requires a new case choice.
      assert.equal(
        await meter.evaluate((el) => el.scrollWidth > el.clientWidth),
        false,
      );
      assert.equal(
        await meter.evaluate((el) =>
          Array.from(el.querySelectorAll('button, select')).some(
            (child) =>
              child.getBoundingClientRect().right >
                el.getBoundingClientRect().right ||
              child.getBoundingClientRect().left <
                el.getBoundingClientRect().left,
          ),
        ),
        false,
      );
      await meter.screenshot({
        path: `work/qa/review-effort-finished-${lang}.png`,
      });
      const otherLang = lang === 'ar' ? 'en' : 'ar';
      await page
        .getByRole('button', {
          name: new RegExp(`^${otherLang.toUpperCase()}\\b`),
        })
        .first()
        .click();
      await meter
        .getByText(messages[otherLang].reviewEffort.finished, { exact: true })
        .waitFor();
      await meter
        .getByRole('button', {
          name: messages[otherLang].reviewEffort.newMeasurement,
          exact: true,
        })
        .click();
      assert.equal(
        await meter
          .getByRole('button', {
            name: messages[otherLang].reviewEffort.start,
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.equal(
        await meter
          .getByLabel(messages[otherLang].reviewEffort.sample, { exact: true })
          .inputValue(),
        '',
      );
      const next = messages[otherLang].reviewEffort;
      await meter
        .getByLabel(next.sample, { exact: true })
        .selectOption('development');
      await meter
        .getByRole('button', { name: next.start, exact: true })
        .click();
      await panel
        .getByRole('button', {
          name: new RegExp(
            '^' + messages[otherLang].visualReview.regionItem(1),
          ),
        })
        .first()
        .click();
      const cropReview = panel.getByRole('region', {
        name: messages[otherLang].visualReview.regionLabel,
        exact: true,
      });
      await cropReview
        .getByLabel(messages[otherLang].visualReview.value, { exact: true })
        .fill('development review value');
      assert.equal(
        await meter.getByLabel(next.sample, { exact: true }).inputValue(),
        'development',
      );
      await cropReview
        .getByRole('button', {
          name: messages[otherLang].visualReview.confirm,
          exact: true,
        })
        .click();
      await meter.getByText(next.paused.processing, { exact: true }).waitFor();
      assert.equal(
        await meter.getByLabel(next.sample, { exact: true }).inputValue(),
        'development',
      );
      // Restoring the same source resets the meter, not just a different hash.
      await panel
        .getByLabel(messages[otherLang].visualReview.restoreLabel, {
          exact: true,
        })
        .setInputFiles({
          name: 'same-development-source.json',
          mimeType: 'application/json',
          buffer: await readFile('audit/visual-split/baseline/en.json'),
        });
      await meter.locator('summary').click();
      assert.equal(
        await meter.getByLabel(next.sample, { exact: true }).inputValue(),
        '',
      );
      assert.equal(
        await meter
          .getByRole('button', { name: next.start, exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: `work/qa/review-effort-${lang}.png`,
        fullPage: true,
      });
      // Changing the reconciliation domain hides the source review, so it must
      // pause immediately and require an explicit resume when returning.
      await meter
        .getByLabel(next.sample, { exact: true })
        .selectOption('development');
      await meter
        .getByRole('button', { name: next.start, exact: true })
        .click();
      await page
        .getByRole('button', {
          name: messages[otherLang].clearing.entry,
          exact: true,
        })
        .click();
      await page.clock.runFor(10000);
      await page
        .getByRole('button', {
          name: messages[otherLang].clearing.back,
          exact: true,
        })
        .click();
      await meter.getByText(next.paused.hidden, { exact: true }).waitFor();
      await meter
        .getByRole('button', { name: next.finish, exact: true })
        .click();
      const domainExport = page.waitForEvent('download');
      await meter
        .getByRole('button', { name: next.export, exact: true })
        .click();
      const domainPath = await (await domainExport).path();
      const domainRecord = restoreReviewEffort(await readFile(domainPath, 'utf8'));
      const domainSummary = summarizeReviewEffort(domainRecord);
      assert.ok(domainSummary.pausedMs.hidden >= 10000);
      assert.ok(
        domainSummary.activeMs < 1000,
        'clearing work must not count toward image review',
      );
      console.log(
        `[browser] effort ${lang}: timing, pauses, idle, processing, rework, export, restart and layout passed (accelerated synthetic test; background=simulated blur handler)`,
      );
    }
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
  } finally {
    page.context().off('request', onRequest);
    page.off('pageerror', onError);
  }
}
