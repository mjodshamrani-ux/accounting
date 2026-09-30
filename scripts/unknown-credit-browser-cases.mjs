import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { ar } from '../lib/i18n/locales/ar.ts';

// Real native uploads -> production workers -> saved session -> actual downloads.
// The PDF boundaries and external scope below are explicit test-user actions.
export async function verifyUnknownCreditRoles(page, url) {
  await mkdir('work/qa', { recursive: true });
  const captures = [];
  for (const [id, ext, expected] of [
    ['different-untyped-credit', 'xlsx', 0],
    ['blank-credit-ordinary-invoice', 'xlsx', 1],
  ]) {
    await page.goto(url);
    await page.waitForFunction(
      () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
    );
    for (const [label, suffix] of [
      [ar.app.sides[0], 'supplier.' + ext],
      [ar.app.sides[1], 'ledger.csv'],
    ]) {
      const name = id + '-' + suffix;
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name,
        mimeType: suffix.endsWith('pdf')
          ? 'application/pdf'
          : suffix.endsWith('csv')
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await readFile(
          'audit/related-invoice/unknown-role/frozen/' + name,
        ),
      });
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
    }
    await page
      .getByRole('button', { name: ar.app.upload.next, exact: true })
      .click();
    await page
      .getByLabel(ar.app.scope.currencyLabel, { exact: true })
      .waitFor({ state: 'visible' });
    await page
      .getByLabel(ar.app.scope.currencyLabel, { exact: true })
      .fill('SAR');
    await page
      .getByLabel(ar.app.scope.cutoffLabel, { exact: true })
      .fill('2026-07-31');
    if (ext === 'pdf') {
      await page
        .getByRole('button', { name: ar.pdfReview.editCuts, exact: true })
        .click();
      await page
        .getByLabel(ar.pdfReview.cutsLabel, { exact: true })
        .fill('20, 41, 62, 79');
      await page
        .getByRole('button', { name: ar.pdfReview.applyCuts, exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
      await page
        .getByRole('checkbox', { name: ar.pdfReview.reviewed, exact: true })
        .check();
    }
    await page
      .getByRole('button', { name: ar.app.compare.run, exact: true })
      .click();
    await page
      .getByRole('heading', { name: ar.app.results.workspace, exact: true })
      .waitFor();
    const count = () =>
      page.locator('.metric').nth(0).locator('strong').innerText();
    assert.equal(await count(), String(expected));
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', { name: ar.app.results.saveSession, exact: true })
      .click();
    const saved = await (await pending).path();
    assert.equal(
      JSON.parse(await readFile(saved, 'utf8')).engine,
      '0.3.25-experimental',
    );
    async function exportCase(suffix) {
      await page
        .getByRole('button', {
          name: ar.app.results.prepareWorkpaper,
          exact: true,
        })
        .click();
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', { name: ar.app.finish.downloadDraft, exact: true })
        .click();
      const downloaded = await (await pending).path();
      const book = new ExcelJS.Workbook();
      await book.xlsx.readFile(downloaded);
      const evidence = book.getWorksheet('Match Evidence');
      assert.equal(evidence.getCell('L2').value, 'INV-401');
      if (expected === 0) {
        const retained = evidence.getCell('W2').value;
        assert.equal(typeof retained, 'string');
        assert.match(retained, /unverifiedCreditNoteNumber.*CN-701/);
        assert.equal(evidence.getCell('AA2').value, 'Unknown');
      }
      const target = `work/qa/unknown-${id}-${suffix}.xlsx`;
      await writeFile(target, await readFile(downloaded));
      return target;
    }
    const direct = await exportCase('direct');
    await page.goto(url);
    await page.waitForFunction(
      () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
    );
    await page
      .getByLabel(ar.app.upload.resumeLabel, { exact: true })
      .setInputFiles(saved);
    await page
      .getByRole('heading', { name: ar.app.results.workspace, exact: true })
      .waitFor();
    assert.equal(await count(), String(expected));
    const restored = await exportCase('restored');
    captures.push({
      id,
      sourceFormat: ext,
      approved: expected,
      direct,
      restored,
      manualColumnMapping: false,
      externalScopeInputs: ['currency', 'cutoff'],
      pdfReviewed: ext === 'pdf',
      pdfManualCuts: ext === 'pdf' ? [20, 41, 62, 79] : [],
    });
  }
  await writeFile(
    'work/qa/unknown-browser.json',
    JSON.stringify(
      { schema: 'tarasuf-unknown-credit-browser-1', cases: captures },
      null,
      2,
    ) + '\n',
  );
}
