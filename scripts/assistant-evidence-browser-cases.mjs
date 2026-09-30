import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ar } from '../lib/i18n/locales/ar.ts';
import { en } from '../lib/i18n/locales/en.ts';

// Native files only: actual production workers, typed questions, session replay
// and workbook downloads. No injected results and no mock model in this path.
export async function verifyAssistantEvidence(page, url) {
  await mkdir('work/qa', { recursive: true });
  const captures = [];
  async function clickVisible(control) {
    await control.evaluate((el) =>
      el.scrollIntoView({ behavior: 'instant', block: 'center' }),
    );
    await control.click();
  }
  async function download(button) {
    await button.evaluate((el) =>
      el.scrollIntoView({ behavior: 'instant', block: 'center' }),
    );
    const [result] = await Promise.all([
      page.waitForEvent('download'),
      button.click(),
    ]);
    return result.path();
  }
  async function start() {
    await page.goto(url);
    await page.evaluate(() => localStorage.removeItem('tarasuf.lang'));
    await page.reload();
    await page.waitForFunction(
      () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
    );
  }
  async function english() {
    await page
      .getByRole('group', { name: 'لغة الواجهة' })
      .getByRole('button', { name: /^EN\b/ })
      .click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
  }
  async function ask(t, q, id) {
    const region = page.getByLabel(t.assistant.region, { exact: true });
    if (!(await region.isVisible()))
      await page
        .getByRole('button', { name: t.assistant.trigger, exact: true })
        .click();
    const n = await region.locator('article').count();
    await page.getByLabel(t.assistant.inputLabel, { exact: true }).fill(q);
    await region
      .getByRole('button', { name: t.assistant.ask, exact: true })
      .click();
    await region.locator('article').nth(n).waitFor();
    const article = region.locator('article').nth(n);
    const text = await article.locator('p').first().innerText();
    if (id === 'untyped-credit') {
      assert.match(text, /CN-701/);
      assert.match(text, /Credit Note No/);
      assert.match(text, t === ar ? /للمراجعة|Needs Review/ : /Needs Review/);
    } else assert.match(text, t === ar ? /^نتيجة جزئية:/ : /^Partial result:/);
    if (t === en) assert.doesNotMatch(text, /\p{Script=Arabic}/u);
    await article.locator('summary').click();
    const ids = await article.locator('details p').innerText();
    assert.equal(ids, 'supplier:0:2 · ledger:0:2');
    return { question: q, text, sourceIds: ids.split(' · ') };
  }
  for (const [id, expected] of [
    ['untyped-credit', 0],
    ['partial-source', 1],
  ]) {
    await start();
    for (const [i, side] of ['supplier', 'ledger'].entries()) {
      const name = id + '-' + side + '.csv';
      await page.getByLabel(ar.app.sides[i], { exact: true }).setInputFiles({
        name,
        mimeType: 'text/csv',
        buffer: await readFile('audit/assistant-evidence/frozen/' + name),
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
      .fill('SAR');
    await page
      .getByLabel(ar.app.scope.cutoffLabel, { exact: true })
      .fill('2026-07-31');
    await page
      .getByRole('button', { name: ar.app.compare.run, exact: true })
      .click();
    await page
      .getByRole('heading', { name: ar.app.results.workspace, exact: true })
      .waitFor();
    const count = () =>
      page.locator('.metric').nth(0).locator('strong').innerText();
    assert.equal(await count(), String(expected));
    const qAr = id === 'untyped-credit' ? 'لماذا CN-701؟' : 'اشرح INV-P5-740';
    const qEn =
      id === 'untyped-credit' ? 'Explain CN-701' : 'Explain INV-P5-740';
    const directAnswer = await ask(ar, qAr, id);
    await english();
    const translated = await page
      .getByLabel(en.assistant.region, { exact: true })
      .locator('article p')
      .first()
      .innerText();
    assert.doesNotMatch(translated, /\p{Script=Arabic}/u);
    const englishAnswer = await ask(en, qEn, id);
    const saved = await download(
      page.getByRole('button', {
        name: en.app.results.saveSession,
        exact: true,
      }),
    );
    assert.equal(
      JSON.parse(await readFile(saved, 'utf8')).engine,
      '0.3.26-experimental',
    );
    async function exportCase(t, suffix) {
      await clickVisible(
        page.getByRole('button', {
          name: t.app.results.prepareWorkpaper,
          exact: true,
        }),
      );
      const downloaded = await download(
        page.getByRole('button', {
          name:
            id === 'partial-source'
              ? t.app.finish.downloadPartial
              : t.app.finish.downloadDraft,
          exact: true,
        }),
      );
      const file = `work/qa/p5-${id}-${suffix}.xlsx`;
      await writeFile(file, await readFile(downloaded));
      return file;
    }
    // Export Arabic field names so the independent source oracle stays stable.
    await page
      .getByRole('group', { name: 'Interface language' })
      .getByRole('button', { name: /^AR\b/ })
      .click();
    await page.waitForFunction(() => document.documentElement.lang === 'ar');
    const direct = await exportCase(ar, 'direct');
    await start();
    await page
      .getByLabel(ar.app.upload.resumeLabel, { exact: true })
      .setInputFiles(saved);
    await page
      .getByRole('heading', { name: ar.app.results.workspace, exact: true })
      .waitFor();
    assert.equal(await count(), String(expected));
    const restoredAnswer = await ask(ar, qAr, id);
    assert.deepEqual(restoredAnswer, directAnswer);
    const restored = await exportCase(ar, 'restored');
    captures.push({
      id,
      approved: expected,
      direct,
      restored,
      directAnswer,
      englishAnswer,
      translated,
      restoredAnswer,
      manualColumnMapping: false,
      externalScopeInputs: ['currency', 'cutoff'],
      modelUsed: false,
    });
  }
  await writeFile(
    'work/qa/p5-browser.json',
    JSON.stringify(
      {
        schema: 'tarasuf-assistant-evidence-browser-1',
        engine: '0.3.26-experimental',
        cases: captures,
      },
      null,
      2,
    ) + '\n',
  );
}
