// Real uploaded CSVs through the mounted UI. Serve a freshly built dist locally.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
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
async function assertResponsive(page, lang, state) {
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
      JSON.stringify({ responsive: { lang, state, width, ...measured } }),
    );
    assert.ok(
      measured.document <= width + 1 && measured.body <= width + 1,
      `${lang} ${state} at ${width}px must not overflow: ${JSON.stringify(measured)}`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

try {
  for (const lang of ['ar', 'en']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
    if (lang === 'en')
      await page
        .locator('.language-switch button[lang="en"]:visible')
        .first()
        .click();
    const uploads =
      lang === 'en'
        ? ['Supplier statement', 'Accounts payable report']
        : ['كشف المورد', 'تقرير الحسابات الدائنة'];
    const header = 'Invoice No,Reference,Amount,Date,Document Type\n';
    const csvs = [
      header + 'INV-412,,100.00,2026-09-01,Invoice\n',
      header +
        'INV-412,,40.00,2026-09-01,Invoice\nINV-412,,60.00,2026-09-01,Invoice\n',
    ];
    for (let i = 0; i < 2; i++) {
      await page.getByLabel(uploads[i], { exact: true }).setInputFiles({
        name: `source-${i}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csvs[i]),
      });
      await page.waitForFunction(
        () =>
          !/قراءة الملف على جهازك|Reading the file on your device/.test(
            document.body.innerText,
          ),
      );
    }
    await page
      .getByRole('button', {
        name: lang === 'en' ? 'Confirm data' : 'تأكيد البيانات',
        exact: true,
      })
      .click();
    const disclosure = page.getByTestId('source-structure-review-disclosure');
    assert.equal(
      await disclosure.locator('input').count(),
      0,
      'closed disclosure has no review inputs',
    );
    assert.equal(
      await page.getByTestId('source-structure-review').count(),
      0,
      'review starts closed',
    );
    await assertResponsive(page, lang, 'closed');
    await disclosure
      .getByRole('button', {
        name:
          lang === 'en'
            ? 'Open source structure review'
            : 'فتح مراجعة بنية المصادر',
        exact: true,
      })
      .click();
    const panel = page.getByTestId('source-structure-review');
    await panel.waitFor();
    await assertResponsive(page, lang, 'open');
    for (const [field, value] of Object.entries({
      supplier: 'SUPPLIER',
      entity: 'ENTITY',
      account: 'AP',
      currency: 'SAR',
      cutoff: '2026-09-30',
    }))
      await panel.locator(`[data-review-scope="${field}"]`).fill(value);
    await panel.locator('[data-review-scope-attestation]').check();
    const run = panel.getByRole('button', {
      name: lang === 'en' ? 'Inspect source structure' : 'فحص بنية المصادر',
      exact: true,
    });
    await run.click();
    await panel.locator('[data-candidate-status="candidate"]').waitFor();
    assert.equal(
      await panel.locator('[data-candidate-status="candidate"]').count(),
      1,
    );
    const text = await panel.innerText();
    assert.match(text, /100\.00 SAR/);
    assert.match(text, /INV-412/);
    assert.match(text, /Invoice No/);
    await assertResponsive(page, lang, 'ready');
    assert.match(
      await panel
        .locator('[data-candidate-status="candidate"] tbody tr')
        .first()
        .locator('td')
        .nth(4)
        .innerText(),
      /Invoice No\s*\[1\]/,
      'native invoice column is already one-based',
    );
    assert.equal(
      await page.locator('.metric').count(),
      0,
      'candidate inspection must not create a financial result',
    );
    assert.equal(
      await panel.getByRole('button').count(),
      2,
      'no apply/approve action exists',
    );
    await panel.locator('[data-review-scope="account"]').fill('CHANGED');
    assert.equal(
      await panel.getByTestId('invoice-group-candidates').count(),
      0,
      'scope edit hides old output immediately',
    );
    assert.equal(
      await panel.locator('[data-review-scope-attestation]').isChecked(),
      false,
    );
    await panel.locator('[data-review-scope-attestation]').check();
    await run.click();
    await panel.locator('[data-candidate-status="candidate"]').waitFor();
    await panel
      .getByRole('button', {
        name: lang === 'en' ? 'Clear structure review' : 'مسح مراجعة البنية',
        exact: true,
      })
      .click();
    assert.equal(
      await panel.getByTestId('invoice-group-candidates').count(),
      0,
    );
    await panel.locator('[data-review-scope-attestation]').check();
    await run.click();
    await panel.locator('[data-candidate-status="candidate"]').waitFor();
    await disclosure
      .getByRole('button', {
        name:
          lang === 'en'
            ? 'Close source structure review'
            : 'إغلاق مراجعة بنية المصادر',
        exact: true,
      })
      .click();
    assert.equal(await page.getByTestId('source-structure-review').count(), 0);
    assert.equal(await disclosure.locator('input').count(), 0);
    await disclosure
      .getByRole('button', {
        name:
          lang === 'en'
            ? 'Open source structure review'
            : 'فتح مراجعة بنية المصادر',
        exact: true,
      })
      .click();
    assert.equal(
      await page.getByTestId('invoice-group-candidates').count(),
      0,
      'reopen has no stale candidates',
    );
    assert.equal(
      await panel.locator('[data-review-scope-attestation]').isChecked(),
      false,
    );
    assert.deepEqual(errors, []);
    cases.push({
      lang,
      closedDefault: true,
      closeInvalidation: true,
      realUploads: true,
      candidateCount: 1,
      scopeInvalidation: true,
      clear: true,
      financialResult: false,
    });
    console.log(JSON.stringify({ completed: cases.at(-1) }));
    await context.close();
  }
  for (const lang of ['ar', 'en']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/mizan-test/`);
    await page.waitForFunction(
      () => !document.querySelector('.notice.loading'),
    );
    if (lang === 'en')
      await page
        .locator('.language-switch button[lang="en"]:visible')
        .first()
        .click();
    const pdf = await readFile(
      'audit/section-continuation-v1/frozen/explicit-continuation.pdf',
    );
    const uploads =
      lang === 'en'
        ? ['Supplier statement', 'Accounts payable report']
        : ['كشف المورد', 'تقرير الحسابات الدائنة'];
    for (let i = 0; i < 2; i++) {
      await page.getByLabel(uploads[i], { exact: true }).setInputFiles({
        name: `section-${i}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
      });
      await page
        .locator('.source-card__description')
        .getByText(`section-${i}.pdf`, { exact: true })
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
    const disclosure = page.getByTestId('source-structure-review-disclosure');
    assert.equal(
      await disclosure.locator('input').count(),
      0,
      'closed disclosure has no review inputs',
    );
    assert.equal(
      await page.getByTestId('source-structure-review').count(),
      0,
      'review starts closed',
    );
    await disclosure
      .getByRole('button', {
        name:
          lang === 'en'
            ? 'Open source structure review'
            : 'فتح مراجعة بنية المصادر',
        exact: true,
      })
      .click();
    const panel = page.getByTestId('source-structure-review');
    await panel
      .getByRole('button', {
        name: lang === 'en' ? 'Inspect source structure' : 'فحص بنية المصادر',
        exact: true,
      })
      .click();
    const supplier = panel.locator('[data-section-side="supplier"]');
    await supplier.locator('[data-section-proposal="INV-1"]').first().waitFor();
    assert.equal(
      await supplier.locator('[data-section-proposal="INV-1"]').count(),
      2,
    );
    assert.ok(
      await supplier.locator('[data-source-cell="1:2:5:3"]').count(),
      'physical continuation marker shown',
    );
    await supplier.locator('summary').click();
    assert.equal(await supplier.locator('[data-physical-row]').count(), 6);
    assert.match(await supplier.innerText(), /-12\.50/);
    assert.equal(await page.locator('.metric').count(), 0);
    assert.deepEqual(errors, []);
    cases.push({
      lang,
      nativePdf: true,
      sectionProposals: 2,
      physicalRows: 6,
      financialResult: false,
    });
    console.log(JSON.stringify({ completed: cases.at(-1) }));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ passed: true, cases }, null, 2));
