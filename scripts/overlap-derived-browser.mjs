// Native Chrome proof using actual local CSV/PDF uploads and download readers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { invoiceOverlapReviewCopy } from '../lib/i18n/invoice-overlap-review.ts';
import { sectionDerivedReviewCopy } from '../lib/i18n/section-derived-review.ts';
const proofRoot = process.env.MIZAN_PROOF_DIR ?? '/tmp/overlap-derived-ui';
await mkdir(proofRoot, { recursive: true });
const root = path.resolve('dist');
const server = createServer(async (req, res) => {
  try {
    let rel = new URL(req.url, 'http://local').pathname.replace(
      /^\/mizan-test\//,
      '/',
    );
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) throw new Error('path');
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
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MIZAN_CHROMIUM
    ? { executablePath: process.env.MIZAN_CHROMIUM }
    : {}),
});
const cases = [];
/** @type {import('playwright').Page | null} */
let activePage = null;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function start(lang) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
  await page.waitForFunction(() => !document.querySelector('.notice.loading'));
  if (lang === 'en')
    await page
      .locator('.language-switch button[lang="en"]:visible')
      .first()
      .click();
  return { context, page, errors };
}
async function upload(page, lang, files) {
  const labels =
    lang === 'en'
      ? ['Supplier statement', 'Accounts payable report']
      : ['كشف المورد', 'تقرير الحسابات الدائنة'];
  for (let i = 0; i < 2; i++) {
    await page.getByLabel(labels[i], { exact: true }).setInputFiles(files[i]);
    await page
      .locator('.source-card__description')
      .getByText(files[i].name, { exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
  }
  await page
    .getByRole('button', {
      name: lang === 'en' ? 'Confirm data' : 'تأكيد البيانات',
      exact: true,
    })
    .click();
}
async function responsive(page, lang, feature, state) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
    const measured = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    console.log(
      JSON.stringify({
        responsive: { lang, feature, state, width, ...measured },
      }),
    );
    assert.ok(
      measured.document <= width + 1 && measured.body <= width + 1,
      `${feature}/${lang}/${state}/${width}: ${JSON.stringify(measured)}`,
    );
  }
  if (state === 'ready')
    await page.screenshot({
      path: path.join(proofRoot, `${feature}-${lang}-390.png`),
      fullPage: true,
    });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function download(page, button, name) {
  const pending = page.waitForEvent('download');
  await button.click();
  const result = await pending;
  const file = path.join(proofRoot, name);
  await result.saveAs(file);
  return { file, bytes: await readFile(file) };
}
async function fillOverlapScope(panel) {
  for (const [field, value] of Object.entries({
    supplier: 'SUPPLIER',
    entity: 'ENTITY',
    account: 'AP',
    currency: 'SAR',
    cutoff: '2026-09-30',
  }))
    await panel.locator(`[data-overlap-scope="${field}"]`).fill(value);
  await panel.locator('[data-overlap-scope-ack]').check();
}
async function inspectOverlap(panel, t) {
  await panel.getByRole('button', { name: t.inspect, exact: true }).click();
  await panel
    .getByText(t.searching, { exact: true })
    .waitFor({ state: 'detached' });
  await panel.locator('[data-overlap-component]').first().waitFor();
  assert.equal(await panel.locator('[data-overlap-component]').count(), 1);
  assert.equal(await panel.locator('[data-overlap-candidate]').count(), 2);
}
async function decideAll(panel, component, mode, t) {
  await panel.locator('[data-overlap-reviewer]').fill('Synthetic Accountant A');
  await panel
    .locator('[data-overlap-rationale]')
    .fill(
      'Reviewed the original dated invoice and all alternative ledger members; unused rows remain unmatched.',
    );
  for (const candidate of await component
    .locator('[data-overlap-candidate]')
    .all()) {
    const ledgerMembers = Number(
      await candidate.getAttribute('data-overlap-ledger-members'),
    );
    await candidate
      .locator('[data-overlap-decision]')
      .selectOption(
        mode === 'both' || ledgerMembers === 2 ? 'accepted' : 'rejected',
      );
    await candidate
      .locator('[data-overlap-decision-rationale]')
      .fill(
        ledgerMembers === 2
          ? 'Two dated source ledger lines jointly represent this invoice; no allocation to individual lines.'
          : 'Alternative single ledger row remains separate and unmatched after reviewing all competitors.',
      );
  }
  await component.locator('[data-overlap-rows-ack]').check();
  await component.locator('[data-overlap-decisions-ack]').check();
  assert.equal(
    await component
      .getByRole('button', { name: t.commit, exact: true })
      .isEnabled(),
    true,
  );
}
/** @param {import('playwright').Page} page */
async function captureFailure(page) {
  await page.screenshot({
    path: path.join(proofRoot, 'failure.png'),
    fullPage: true,
  });
  console.error(
    JSON.stringify(
      {
        overflowElements: await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .map((element) => ({
              tag: element.tagName,
              type: element.getAttribute('type'),
              className: element.className,
              text: element.textContent?.slice(0, 120),
              rect: element.getBoundingClientRect(),
            }))
            .filter(
              (item) =>
                item.rect.width > 0 &&
                (item.rect.right > innerWidth + 1 || item.rect.left < -1),
            )
            .map((item) => ({
              ...item,
              rect: {
                left: item.rect.left,
                right: item.rect.right,
                width: item.rect.width,
              },
            }))
            .slice(0, 80),
        ),
      },
      null,
      2,
    ),
  );
  console.error(await page.locator('body').innerText());
}
try {
  for (const lang of ['ar', 'en']) {
    const { context, page, errors } = await start(lang);
    const t = invoiceOverlapReviewCopy(lang);
    const header = 'Invoice No,Reference,Amount,Date,Document Type\n';
    const csvs = [
      header + 'INV-X,,100.00,2026-09-01,Invoice\n',
      header +
        'INV-X,,40.00,2026-09-01,Invoice\nINV-X,,60.00,2026-09-02,Invoice\nINV-X,,100.00,2026-09-03,Invoice\n',
    ];
    await upload(
      page,
      lang,
      csvs.map((csv, i) => ({
        name: `overlap-${i}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      })),
    );
    const disclosure = page.getByTestId('invoice-overlap-disclosure');
    assert.equal(await disclosure.locator('input').count(), 0);
    assert.equal(await page.getByTestId('invoice-overlap-review').count(), 0);
    await responsive(page, lang, 'overlap', 'closed');
    await disclosure.getByRole('button', { name: t.open, exact: true }).click();
    const panel = page.getByTestId('invoice-overlap-review');
    await responsive(page, lang, 'overlap', 'open');
    await fillOverlapScope(panel);
    await inspectOverlap(panel, t);
    const component = panel.locator('[data-overlap-component]').first();
    assert.equal(
      await component
        .locator('[data-overlap-decision]')
        .filter({ hasText: t.undecided })
        .count(),
      2,
    );
    assert.equal(
      await component
        .getByRole('button', { name: t.commit, exact: true })
        .isEnabled(),
      false,
    );
    await decideAll(panel, component, 'both', t);
    await component
      .getByRole('button', { name: t.commit, exact: true })
      .click();
    await panel.getByRole('alert').first().waitFor();
    assert.equal(
      await panel.locator('[data-overlap-active-receipt]').count(),
      0,
      'overlapping accepted choices are refused atomically',
    );
    assert.match(
      await panel.locator('[data-overlap-accepted-groups]').innerText(),
      /0$/,
    );
    await decideAll(panel, component, 'split', t);
    await panel.evaluate((element, commitLabel) => {
      const commit = [...element.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === commitLabel,
      );
      commit.click();
      const input = element.querySelector('[data-overlap-reviewer]');
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(input, 'Reviewer changed during pending commit');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, t.commit);
    assert.equal(
      await component.locator('[data-overlap-decisions-ack]').isChecked(),
      false,
    );
    await page.waitForTimeout(100);
    await inspectOverlap(panel, t);
    assert.equal(
      await panel.locator('[data-overlap-active-receipt]').count(),
      0,
      'pending reviewer edit cannot commit or resurrect an aggregate',
    );
    assert.match(
      await panel.locator('[data-overlap-accepted-groups]').innerText(),
      /0$/,
    );
    await decideAll(panel, component, 'split', t);

    await component
      .getByRole('button', { name: t.commit, exact: true })
      .click();
    await panel.locator('[data-overlap-active-receipt]').waitFor();
    assert.match(
      await panel.locator('[data-overlap-accepted-groups]').innerText(),
      /1$/,
    );
    assert.equal(await page.locator('.metric').count(), 0);
    await responsive(page, lang, 'overlap', 'ready');
    const workbook = await download(
      page,
      panel.getByRole('button', { name: t.exportWorkbook, exact: true }),
      `overlap-${lang}-accepted.xlsx`,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(workbook.bytes);
    assert.equal(book.getWorksheet('Accepted aggregates').rowCount, 2);
    assert.equal(
      book.getWorksheet('Accepted aggregates').getRow(2).getCell(6).value,
      10000,
    );
    assert.equal(
      book.getWorksheet('Accepted aggregates').getRow(2).getCell(8).value,
      false,
    );
    const originals = book.getWorksheet('Original movements');
    assert.equal(originals.rowCount, 5);
    assert.equal(
      originals
        .getRows(2, 4)
        .filter((row) => row.getCell(8).value === 'accepted-aggregate-member')
        .length,
      3,
    );
    assert.equal(
      originals
        .getRows(2, 4)
        .filter((row) => row.getCell(8).value === 'unmatched').length,
      1,
    );
    const saved = await download(
      page,
      panel.getByRole('button', { name: t.exportSession, exact: true }),
      `overlap-${lang}-session.json`,
    );
    const session = JSON.parse(saved.bytes);
    assert.equal(session.state.activeReceiptIds.length, 1);
    await component
      .locator('[data-overlap-undo-rationale]')
      .fill(
        'Reverse the whole reviewed component; return every member to unmatched for a fresh review.',
      );
    await component.locator('[data-overlap-undo-ack]').check();
    await component.getByRole('button', { name: t.undo, exact: true }).click();
    await panel
      .locator('[data-overlap-active-receipt]')
      .waitFor({ state: 'detached' });
    assert.match(
      await panel.locator('[data-overlap-accepted-groups]').innerText(),
      /0$/,
    );
    assert.equal(
      await component.locator('[data-overlap-rows-ack]').isChecked(),
      false,
    );
    assert.equal(
      await component.locator('[data-overlap-decisions-ack]').isChecked(),
      false,
    );
    const undone = await download(
      page,
      panel.getByRole('button', { name: t.exportWorkbook, exact: true }),
      `overlap-${lang}-undone.xlsx`,
    );
    const undoneBook = new ExcelJS.Workbook();
    await undoneBook.xlsx.load(undone.bytes);
    assert.equal(undoneBook.getWorksheet('Accepted aggregates').rowCount, 1);
    assert.ok(
      undoneBook
        .getWorksheet('Original movements')
        .getRows(2, 4)
        .every((row) => row.getCell(8).value === 'unmatched'),
    );
    await disclosure
      .getByRole('button', { name: t.close, exact: true })
      .click();
    assert.equal(await disclosure.locator('input').count(), 0);
    await disclosure.getByRole('button', { name: t.open, exact: true }).click();
    assert.equal(await panel.locator('[data-overlap-component]').count(), 0);
    await fillOverlapScope(panel);
    await inspectOverlap(panel, t);
    await panel
      .locator('[data-overlap-session-import]')
      .setInputFiles(saved.file);
    await panel.locator('summary').filter({ hasText: t.archived }).click();
    await panel.getByText(t.archiveNote, { exact: true }).waitFor();
    assert.match(
      await panel.locator('[data-overlap-accepted-groups]').innerText(),
      /0$/,
      'saved journal remains archive only',
    );
    assert.equal(
      await panel.locator('[data-overlap-active-receipt]').count(),
      0,
    );
    const reverse = page
      .getByRole('button', {
        name: lang === 'en' ? 'Reverse amount direction' : 'عكس اتجاه المبالغ',
        exact: true,
      })
      .first();
    await reverse.click();
    assert.equal(
      await panel.locator('[data-overlap-component]').count(),
      0,
      'mapping edit hides the current source-bound review',
    );
    assert.equal(
      await panel.locator('[data-overlap-scope-ack]').isChecked(),
      false,
    );
    await reverse.click();
    await fillOverlapScope(panel);
    await inspectOverlap(panel, t);
    await panel.locator('[data-overlap-scope="account"]').fill('CHANGED');
    assert.equal(await panel.locator('[data-overlap-component]').count(), 0);
    assert.equal(
      await panel.locator('[data-overlap-scope-ack]').isChecked(),
      false,
    );
    assert.deepEqual(errors, []);
    cases.push({
      lang,
      feature: 'overlap',
      closedDefault: true,
      atomicConflictRefusal: true,
      pendingReviewerCancellation: true,
      acceptedAggregate: 1,
      originalRows: 4,
      undo: true,
      archiveOnly: true,
      sourceScopeInvalidation: true,
      readingInvalidation: true,
      financialAppUnchanged: true,
      workbookSha256: sha(workbook.bytes),
    });
    console.log(JSON.stringify({ completed: cases.at(-1) }));
    await context.close();
  }
  for (const lang of ['ar', 'en']) {
    const { context, page, errors } = await start(lang);
    const t = sectionDerivedReviewCopy(lang);
    const pdf = await readFile(
      'audit/section-derived-v1/frozen/cross-page.pdf',
    );
    const golden = JSON.parse(
      await readFile(
        'audit/section-derived-v1/frozen/cross-page.expected.json',
        'utf8',
      ),
    );
    await upload(
      page,
      lang,
      [0, 1].map((i) => ({
        name: `derived-${i}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      })),
    );
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole('button', {
          name: lang === 'en' ? 'Edit column boundaries' : 'تعديل حدود الأعمدة',
          exact: true,
        })
        .nth(i)
        .click();
      await page
        .getByLabel(
          lang === 'en' ? 'PDF column boundaries' : 'حدود أعمدة PDF',
          { exact: true },
        )
        .last()
        .fill('25,45,69');
      const apply = page
        .getByRole('button', {
          name:
            lang === 'en'
              ? 'Apply boundaries and re-read'
              : 'تطبيق الحدود وإعادة القراءة',
          exact: true,
        })
        .last();
      if (await apply.isEnabled()) await apply.click();
      else
        await page
          .getByRole('button', {
            name:
              lang === 'en' ? 'Hide column boundaries' : 'إخفاء حدود الأعمدة',
            exact: true,
          })
          .click();
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
    }
    const disclosure = page.getByTestId('section-derived-disclosure');
    assert.equal(await disclosure.locator('input').count(), 0);
    await responsive(page, lang, 'derived', 'closed');
    await disclosure.getByRole('button', { name: t.open, exact: true }).click();
    assert.equal(
      await page.getByTestId('section-derived-review').count(),
      0,
      'source choice is explicit',
    );
    await disclosure.locator('[data-derived-source]').selectOption('supplier');
    const panel = page.getByTestId('section-derived-review');
    await responsive(page, lang, 'derived', 'open');
    await panel.getByRole('button', { name: t.inspect, exact: true }).click();
    await panel.locator('[data-derived-proposal]').first().waitFor();
    assert.equal(await panel.locator('[data-derived-proposal]').count(), 2);
    assert.ok(await panel.locator('[data-derived-cell="1:2:5:3"]').count());
    for (const checkbox of await panel
      .locator('[data-derived-proposal-select]')
      .all()) {
      assert.equal(await checkbox.isChecked(), false);
      await checkbox.check();
    }
    await panel
      .locator('[data-derived-reviewer]')
      .fill('Synthetic Accountant A');
    await panel
      .locator('[data-derived-rationale]')
      .fill(
        'The explicit invoice parent, exact carried header and continuation marker justify both missing references; signed source amounts stay unchanged.',
      );
    for (const checkbox of await panel.locator('[data-derived-ack]').all()) {
      assert.equal(await checkbox.isChecked(), false);
      await checkbox.check();
    }
    await panel.getByRole('button', { name: t.accept, exact: true }).click();
    await panel.getByRole('button', { name: t.apply, exact: true }).waitFor();
    await panel
      .locator('[data-derived-rationale]')
      .fill(
        'Rechecked every original row and both parent/continuation links against the PDF; keep -12.50 and +2.50 unchanged.',
      );
    assert.equal(
      await panel.getByRole('button', { name: t.apply, exact: true }).count(),
      0,
      'reviewer edit invalidates receipt',
    );
    for (const checkbox of await panel.locator('[data-derived-ack]').all()) {
      assert.equal(await checkbox.isChecked(), false);
      await checkbox.check();
    }
    await panel.getByRole('button', { name: t.accept, exact: true }).click();
    await panel.getByRole('button', { name: t.apply, exact: true }).click();
    await panel.locator('[data-derived-artifact]').waitFor();
    await responsive(page, lang, 'derived', 'ready');
    assert.equal(await page.locator('.metric').count(), 0);
    const csv = await download(
      page,
      panel.getByRole('button', { name: t.downloadCsv, exact: true }),
      `derived-${lang}.csv`,
    );
    assert.equal(sha(csv.bytes), golden.csvSha256);
    const provenanceFile = await download(
      page,
      panel.getByRole('button', { name: t.downloadProvenance, exact: true }),
      `derived-${lang}-provenance.json`,
    );
    const provenance = JSON.parse(provenanceFile.bytes);
    assert.equal(provenance.financialApproval, false);
    assert.equal(provenance.inventory.length, 6);
    assert.deepEqual(
      provenance.inventory.map((row) => ({
        row: row.originalRow,
        page: row.page,
        values: row.values,
      })),
      golden.inventory,
    );
    assert.deepEqual(
      provenance.links.map((link) => link.originalRow),
      [3, 6],
    );
    assert.deepEqual(
      provenance.links.map((link) => link.amountEvidence.literal),
      ['-12.50', '+2.50'],
    );
    assert.equal(provenance.selectedProposalIds.length, 2);
    const original = await download(
      page,
      panel.getByRole('button', { name: t.downloadOriginal, exact: true }),
      `derived-${lang}-original.pdf`,
    );
    assert.equal(sha(original.bytes), golden.originalSha256);
    assert.deepEqual(original.bytes, pdf);
    await page
      .getByRole('button', {
        name: lang === 'en' ? 'Edit column boundaries' : 'تعديل حدود الأعمدة',
        exact: true,
      })
      .first()
      .click();
    await page
      .getByLabel(lang === 'en' ? 'PDF column boundaries' : 'حدود أعمدة PDF', {
        exact: true,
      })
      .last()
      .fill('25,45,69.1');
    await page
      .getByRole('button', {
        name:
          lang === 'en'
            ? 'Apply boundaries and re-read'
            : 'تطبيق الحدود وإعادة القراءة',
        exact: true,
      })
      .last()
      .click();
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
    assert.equal(
      await page.getByTestId('section-derived-review').count(),
      0,
      'fresh source extraction hides the old derivative',
    );
    assert.equal(
      await disclosure.locator('[data-derived-source]').inputValue(),
      '',
    );

    await disclosure
      .getByRole('button', { name: t.close, exact: true })
      .click();
    assert.equal(await disclosure.locator('input').count(), 0);
    await disclosure.getByRole('button', { name: t.open, exact: true }).click();
    assert.equal(await page.getByTestId('section-derived-review').count(), 0);
    assert.equal(
      await disclosure.locator('[data-derived-source]').inputValue(),
      '',
    );
    assert.deepEqual(errors, []);
    cases.push({
      lang,
      feature: 'derived',
      closedDefault: true,
      explicitSource: true,
      proposalCount: 2,
      reviewerReceiptInvalidation: true,
      sourceExtractionInvalidation: true,
      originalInventory: 6,
      signedAmountsPreserved: true,
      csvSha256: sha(csv.bytes),
      originalPdfSha256: sha(original.bytes),
      financialApproval: false,
      financialAppUnchanged: true,
    });
    console.log(JSON.stringify({ completed: cases.at(-1) }));
    await context.close();
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) await captureFailure(activePage);
  throw error;
} finally {
  await browser.close();
  server.close();
}
console.log(
  JSON.stringify({ passed: true, synthetic: true, proofRoot, cases }, null, 2),
);
