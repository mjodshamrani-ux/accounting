// UI contract: enter each existing domain by keyboard, announce its heading,
// return to its entry, and retain draft input. No financial truth is invented.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const baseline = process.argv.includes('--baseline');
assert.ok(process.argv.slice(2).every((arg) => arg === '--baseline'));
const proofRoot = process.env.MIZAN_PROOF_DIR ?? path.join(root, 'work/qa-domain-navigation');
await mkdir(proofRoot, { recursive: true });
const out = await mkdtemp(path.join(proofRoot, baseline ? 'baseline-' : 'verification-'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const domains = ['clearing', 'ar', 'gl-tb', 'allocation', 'bank', 'tb-financial', 'intercompany', 'gateway', 'stock', 'assets', 'payroll'];
const binding = {
  synthetic: true,
  fieldAcceptance: false,
  appSha256: sha(await readFile(path.join(root, 'app/page.tsx'))),
  indexSha256: sha(await readFile(path.join(dist, 'index.html'))),
  scriptSha256: sha(await readFile(import.meta.filename)),
};
const server = createServer(async (req, res) => {
  try {
    const rel = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(dist + path.sep)) throw Error('path');
    res.setHeader('Content-Type', {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    }[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.MIZAN_CHROMIUM });
const cases = [];
const external = [];
const errors = [];
let failure;
try {
  for (const width of baseline ? [1440] : [1440, 320]) {
    for (const language of baseline ? ['ar'] : ['ar', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(base + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
        external.push(url);
        return route.abort();
      });
      let page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      if (await page.evaluate(() => document.documentElement.lang) !== language)
        await page.locator(`.language-switch button[lang="${language}"]:visible`).first().click();
      const entries = page.locator('[data-domain-navigation] button');
      assert.equal(await entries.count(), domains.length + 1);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-domain-navigation] button')].every((button) => !button.disabled));
      for (const domain of domains) {
        const entry = page.locator(`[data-domain-entry="${domain}"]`);
        const label = await entry.innerText();
        await entry.focus();
        await page.keyboard.press('Enter');
        const panel = page.locator(`[data-domain-panel="${domain}"]:visible`);
        await panel.waitFor();
        assert.equal(await page.locator('[data-domain-panel]:visible').count(), 1, 'exactly the requested domain is visible');
        const heading = panel.locator('h1, h2').first();
        await heading.waitFor();
        const evidence = { domain, language, width, label, heading: await heading.innerText() };
        cases.push(evidence);
        evidence.entryFocus = await heading.evaluate((element) => document.activeElement === element);
        evidence.headingBounds = await heading.boundingBox();
        if (!evidence.entryFocus) {
          evidence.actualFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 120) }));
          await page.screenshot({ path: path.join(out, `${language}-${width}-${domain}-focus.png`) });
        }
        assert.equal(evidence.entryFocus, true, `${domain}/${language}/${width}: domain heading receives focus`);
        assert.ok(evidence.headingBounds.y >= 0 && evidence.headingBounds.y + evidence.headingBounds.height <= 900, 'heading is in viewport');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => {
          const element = document.activeElement;
          return element instanceof HTMLElement && !element.closest('[hidden]') && element.getClientRects().length > 0;
        }), true, 'next keyboard control is visible');
        const draft = page.locator('input[type="text"]:visible:not([disabled])').first();
        const hasDraft = await draft.count() > 0;
        const note = `navigation-${domain}-${language}-${width}`;
        if (hasDraft) await draft.fill(note);
        const back = page.getByRole('button', { name: /^(?:Back$|Back to|Supplier reconciliation$|تسوية المورد|العودة$|العودة إلى|عد إلى)/i }).first();
        await back.focus();
        await page.keyboard.press('Enter');
        await entry.waitFor();
        assert.equal(await entry.evaluate((element) => document.activeElement === element), true, 'return restores the originating entry focus');
        await page.keyboard.press('Enter');
        await heading.waitFor();
        assert.equal(await heading.evaluate((element) => document.activeElement === element), true);
        if (hasDraft) assert.equal(await draft.inputValue(), note, 'draft survives departure and return');
        evidence.draftRetained = hasDraft;
        const other = language === 'ar' ? 'en' : 'ar';
        await page.locator(`.language-switch button[lang="${other}"]:visible`).first().click();
        assert.equal(await page.evaluate(() => document.documentElement.lang), other);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('lang')), other, 'language switch keeps its focus');
        if (hasDraft) assert.equal(await draft.inputValue(), note);
        await page.locator(`.language-switch button[lang="${language}"]:visible`).first().click();
        assert.equal(await page.evaluate(() => document.documentElement.dir), language === 'ar' ? 'rtl' : 'ltr');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'no horizontal document overflow');
        await back.click();
        assert.equal(await entry.evaluate((element) => document.activeElement === element), true);
        if (domain === 'payroll') await page.screenshot({ path: path.join(out, `${language}-${width}-returned.png`), fullPage: true });
      }
      await page.getByRole('button', { name: language === 'ar' ? 'جرّب المثال' : 'Try the sample', exact: true }).click();
      await page.locator('.in-session h1[tabindex="-1"]:visible').first().waitFor();
      let handoffButton = page.locator('button[data-testid="allocation-workflow-handoff"]:visible');
      assert.equal(await handoffButton.isDisabled(), true, 'in-memory demo cannot claim original file provenance');
      await page.locator('#allocation-handoff-source-required').waitFor();
      await handoffButton.evaluate((element) => element.click());
      assert.equal(await page.locator('[data-domain-panel]:visible').count(), 0, 'disabled demo handoff retains supplier workflow');
      cases.push({ domain: 'unhashed-demo-handoff', language, width, status: 'PASS' });
      await page.close();
      page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-domain-navigation] button')].every((button) => !button.disabled));
      const originalSources = [];
      const fixtureDir = path.join(root, 'audit/p2-main-integration-v1/frozen/native-ui-files');
      const fixtureManifest = JSON.parse(await readFile(path.join(fixtureDir, 'fixture-manifest.json'), 'utf8'));
      for (const [side, name] of ['native-main-A-supplier.csv', 'native-main-A-ledger.csv'].entries()) {
        const sha256 = sha(await readFile(path.join(fixtureDir, name)));
        assert.equal(sha256, fixtureManifest.files[name], 'fixture retains its original independent hash');
        originalSources.push({ name, sha256 });
        const upload = page.locator('.source-card input[type="file"]').nth(side);
        await upload.setInputFiles(path.join(fixtureDir, name));
        await page.locator('.source-card__description').getByText(name, { exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector('.loading'));
      }
      await page.getByRole('button', { name: language === 'ar' ? 'تأكيد البيانات' : 'Confirm data', exact: true }).click();
      const supplierHeading = page.locator('.in-session h1[tabindex="-1"]:visible').first();
      await supplierHeading.waitFor();
      handoffButton = page.locator('button[data-testid="allocation-workflow-handoff"]:visible');
      await page.waitForFunction(() => !document.querySelector('button[data-testid="allocation-workflow-handoff"]:not([hidden])')?.disabled);
      const supplierSnapshot = await page.locator('.in-session:visible').innerText();
      for (let attempt = 1; attempt <= 2; attempt++) {
        await handoffButton.click();
        const allocation = page.locator('[data-domain-panel="allocation"]:visible');
        await allocation.waitFor();
        assert.equal(await allocation.locator('h1').first().evaluate((element) => document.activeElement === element), true, 'fresh handoff focuses allocation heading');
        const contextPanel = allocation.locator('section[data-testid="allocation-workflow-handoff"]');
        await contextPanel.waitFor();
        assert.deepEqual(await contextPanel.locator('li').evaluateAll((rows) => rows.map((row) => ({ name: row.querySelector('bdi')?.textContent, sha256: row.querySelector('code')?.textContent }))), originalSources, 'context retains exact original source names and hashes');
        assert.equal(await allocation.getByTestId('allocation-result').count(), 0, 'context handoff does not transfer a financial result');
        assert.equal(await allocation.getByTestId('allocation-event').count(), 0, 'context does not transfer an approval');
        for (const side of [0, 1, 2]) assert.equal(await allocation.getByTestId(`allocation-source-${side}`).locator('h3').count(), 0, 'allocation source roles remain empty');
        if (attempt === 2) await page.screenshot({ path: path.join(out, `${language}-${width}-handoff.png`), fullPage: true });
        await allocation.getByRole('button', { name: language === 'ar' ? 'العودة إلى الموردين' : 'Back to suppliers', exact: true }).click();
        await supplierHeading.waitFor();
        assert.equal(await supplierHeading.evaluate((element) => document.activeElement === element), true, 'non-navigation origin returns to supplier workflow heading');
        assert.equal(await page.locator('.in-session:visible').innerText(), supplierSnapshot, 'supplier source and workflow state survive fresh allocation');
        cases.push({ domain: 'fresh-allocation-handoff', language, width, attempt, originalSources, status: 'PASS' });
      }
      await context.close();
    }
  }
  assert.deepEqual(external, [], 'all requests remain local');
  assert.deepEqual(errors, [], 'no browser page errors');
} catch (error) {
  failure = error;
} finally {
  await writeFile(path.join(out, 'REPORT.json'), JSON.stringify({ ...binding, mode: baseline ? 'baseline' : 'verification', status: failure ? 'FAIL' : 'PASS', cases, external, errors, failure: failure?.message }, null, 2) + '\n');
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(`Domain navigation proof: ${out} (${cases.length} cases)`);
}
if (failure) throw failure;
