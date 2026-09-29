import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { ar } from '../lib/i18n/locales/ar.ts';

/** The actual frozen XLSX crosses the browser/worker boundary. No injected
 * mapping or constructed parsed rows can stand in for successful file reading. */
export async function verifyLayeredHeaders(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
  );
  const captures = [];
  for (const name of [
    'supplier-layered-proven.xlsx',
    'supplier-layered-conflict.xlsx',
  ]) {
    if (captures.length) {
      await page.goto(url);
      await page.waitForFunction(
        () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
      );
    }
    for (const [label, file] of [
      [ar.app.sides[0], name],
      [ar.app.sides[1], 'ledger-plain.csv'],
    ]) {
      await page
        .getByLabel(label, { exact: true })
        .setInputFiles({
          name: file,
          mimeType: file.endsWith('.csv')
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: await readFile('audit/layered-statement/frozen/' + file),
        });
      await page.waitForFunction(
        () => !document.querySelector('.notice.loading'),
      );
    }
    await page
      .getByRole('button', { name: ar.app.upload.next, exact: true })
      .click();
    for (const label of [
      ar.app.source.sheetField,
      ar.app.source.dateColumn,
      ar.app.source.amountColumn,
    ])
      assert.equal(
        await page
          .getByLabel(label, { exact: true })
          .isVisible()
          .catch(() => false),
        false,
        'no manual sheet/header/column question',
      );
    // The external scope is deliberately distinct from automatic header reading.
    const edit = page.getByRole('button', {
      name: ar.app.scope.edit,
      exact: true,
    });
    // Missing currency opens this panel in an effect; wait for its result to
    // avoid closing it with a racing toggle click.
    await page
      .getByLabel(ar.app.scope.currencyLabel, { exact: true })
      .waitFor({ state: 'visible' });
    assert.equal(await edit.getAttribute('aria-expanded'), 'true');
    // Identity inputs live in the optional balance panel. Reveal them only to
    // record this fixture's explicitly external scope, then turn balance mode
    // off again. The two originals do not prove full reconciliation.
    const balanceMode = page.getByRole('checkbox', {
      name: ar.app.scope.balanceMode,
      exact: true,
    });
    await balanceMode.check();
    for (const [label, value] of [
      [ar.app.scope.supplierLabel, 'Synthetic supplier'],
      [ar.app.scope.entityLabel, 'Synthetic buyer'],
      [ar.app.scope.accountLabel, 'AP-714'],
      [ar.app.scope.currencyLabel, 'SAR'],
      [ar.app.scope.cutoffLabel, '2026-07-31'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page
      .getByLabel(ar.app.scope.dateWindowField, { exact: true })
      .click();
    await page
      .getByRole('option', { name: ar.app.scope.days(3), exact: true })
      .click();
    await balanceMode.uncheck();
    await page
      .getByRole('button', { name: ar.app.compare.run, exact: true })
      .click();
    await page
      .getByRole('heading', { name: ar.app.results.workspace, exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.metric').nth(0).locator('strong').innerText(),
      '1',
    );
    const save = page.waitForEvent('download');
    await page
      .getByRole('button', { name: ar.app.results.saveSession, exact: true })
      .click();
    const sessionPath = await (await save).path();
    async function exportCase(suffix) {
      await page
        .getByRole('button', {
          name: ar.app.results.prepareWorkpaper,
          exact: true,
        })
        .click();
      const download = page.waitForEvent('download');
      await page
        .getByRole('button', { name: ar.app.finish.downloadDraft, exact: true })
        .click();
      const book = new ExcelJS.Workbook();
      await book.xlsx.readFile(await (await download).path());
      const proof = book.getWorksheet('XLSX Header Provenance');
      assert.equal(proof.rowCount, 8);
      assert.equal(proof.getCell('J3').value, 'B3:B4');
      assert.equal(proof.getCell('P3').value, 'Automatic source rule');
      assert.equal(book.getWorksheet('Parsed Supplier Source').rowCount, 11);
      assert.deepEqual(
        [2, 3, 4, 5].map(
          (r) =>
            book.getWorksheet('Supplier transactions').getCell(`H${r}`).value,
        ),
        [780, 220, -350, -50],
      );
      const target = `work/qa/layered-${captures.length}-${suffix}.xlsx`;
      await writeFile(target, await readFile(await (await download).path()));
      return target;
    }
    const direct = await exportCase('direct');
    await page.goto(url);
    await page.waitForFunction(
      () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
    );
    await page
      .getByLabel(ar.app.upload.resumeLabel, { exact: true })
      .setInputFiles(sessionPath);
    await page
      .getByRole('heading', { name: ar.app.results.workspace, exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.metric').nth(0).locator('strong').innerText(),
      '1',
    );
    const restored = await exportCase('restored');
    captures.push({
      source: name,
      direct,
      restored,
      autoMatches: 1,
      manualHeaderQuestions: 0,
    });
  }
  await mkdir('work/qa', { recursive: true });
  await writeFile(
    'work/qa/layered-browser.json',
    JSON.stringify(
      { schema: 'tarasuf-f02-browser-1', cases: captures },
      null,
      2,
    ),
  );
}
