import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export async function verifyVisualRegions(page, baseUrl) {
  const original = await readFile('audit/visual-numeric/fixtures/amounts.png');
  const contract = JSON.parse(
    await readFile('audit/visual-numeric/fixtures/contract.json', 'utf8'),
  );
  const target = contract.cells.find((c) => c.id === 'arabic-minus');
  const violations = [];
  const errors = [];
  const app = new URL(baseUrl);
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      (!['data:', 'blob:'].includes(url.protocol) && url.origin !== app.origin)
    )
      violations.push(request.url());
  };
  const onError = (error) => errors.push(error.message);
  page.context().on('request', onRequest);
  page.on('pageerror', onError);
  try {
    await page.goto(baseUrl);
    await page
      .getByRole('button', { name: 'جرّب المثال', exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.body.innerText.includes('جارٍ تجهيز أداة المقارنة'),
    );
    const sourceBefore = await page.locator('.dropzone').allTextContents();
    const panel = page.locator('#visual-reader');
    await panel.locator('summary').first().click();
    await page
      .getByLabel('صورة أو PDF للقراءة التجريبية', { exact: true })
      .setInputFiles({
        name: 'amounts.png',
        mimeType: 'image/png',
        buffer: original,
      });
    await panel
      .getByRole('button', { name: 'حدد قيمة من الصورة', exact: true })
      .waitFor({ timeout: 120000 });
    const save = panel.getByRole('button', {
      name: 'حفظ سجل المراجعة',
      exact: true,
    });
    const regionEditor = panel.getByRole('region', {
      name: 'مراجعة قيمة محددة من الصورة',
      exact: true,
    });
    const role = regionEditor.getByLabel('نوع القيمة', { exact: true });
    const literal = regionEditor.getByLabel('القيمة كما تظهر في الأصل', {
      exact: true,
    });
    const confirm = regionEditor.getByRole('button', {
      name: 'تأكيد مراجعة هذه القيمة',
      exact: true,
    });
    async function bytes(button = save) {
      const waiting = page.waitForEvent('download');
      await button.click();
      const download = await waiting;
      return readFile(await download.path());
    }
    async function saved() {
      return JSON.parse((await bytes()).toString('utf8'));
    }
    async function draw() {
      const surface = panel.getByRole('button', {
        name: 'تحديد قصاصة من الصورة الأصلية',
        exact: true,
      });
      await surface.scrollIntoViewIfNeeded();
      const r = await surface.boundingBox(),
        c = target.rectangle;
      await page.mouse.move(
        r.x + (c.left / contract.source.width) * r.width,
        r.y + (c.top / contract.source.height) * r.height,
      );
      await page.mouse.down();
      await page.mouse.move(
        r.x + ((c.left + c.width) / contract.source.width) * r.width,
        r.y + ((c.top + c.height) / contract.source.height) * r.height,
        { steps: 4 },
      );
      await page.mouse.up();
    }
    await panel
      .getByRole('button', { name: 'حدد قيمة من الصورة', exact: true })
      .click();
    await draw();
    await panel
      .getByRole('button', { name: 'استخدم هذه القصاصة', exact: true })
      .click();
    assert.equal(
      await literal.inputValue(),
      '',
      'manual selection must not invent or copy a numeric guess',
    );
    assert.ok(await confirm.isDisabled());
    await role.selectOption('amount');
    await literal.fill(target.expected);
    assert.ok(!(await confirm.isDisabled()));
    await confirm.click();
    await regionEditor
      .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
      .waitFor();
    const initial = await saved();
    assert.equal(initial.version, 2);
    assert.equal(initial.cells.length, 0);
    assert.equal(initial.regions.length, 1);
    const cell = initial.regions[0];
    assert.equal(cell.origin, 'manual-crop');
    assert.equal(cell.value, target.expected);
    assert.ok(cell.review);
    const crop = regionEditor.locator('clipPath rect');
    for (const [attr, expected] of Object.entries({
      x: cell.region.x0,
      y: cell.region.y0,
      width: cell.region.x1 - cell.region.x0,
      height: cell.region.y1 - cell.region.y0,
    }))
      assert.equal(Number(await crop.getAttribute(attr)), expected);
    await literal.fill('٢٥٠٫٠٠');
    const changed = await saved();
    assert.equal(changed.regions[0].review, null);
    await literal.fill('');
    assert.ok(await confirm.isDisabled());
    assert.ok(
      await save.isDisabled(),
      'empty manual literal must leave no hidden reviewed value',
    );
    await literal.fill(target.expected);
    await confirm.click();
    await regionEditor
      .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
      .waitFor();
    const stable = await saved();
    await panel
      .getByRole('button', { name: 'غيّر القصاصة المحددة', exact: true })
      .click();
    const surface = panel.getByRole('button', {
      name: 'تحديد قصاصة من الصورة الأصلية',
      exact: true,
    });
    await surface.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    assert.deepEqual(
      await saved(),
      stable,
      'cancelled selection must not rewrite a reviewed receipt',
    );
    await panel
      .getByRole('button', { name: 'غيّر القصاصة المحددة', exact: true })
      .click();
    await surface.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(
      (await saved()).regions[0].review,
      null,
      'keyboard crop resize revokes prior review',
    );
    await role.selectOption('reference');
    await role.selectOption('amount');
    await confirm.click();
    await regionEditor
      .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
      .waitFor();
    const proofBytes = await bytes(),
      proof = JSON.parse(proofBytes.toString('utf8'));
    const id = proof.regions[0].id;
    await mkdir('work/qa', { recursive: true });
    await writeFile('work/qa/p6-region-reviewed.json', proofBytes);
    await writeFile('work/qa/p6-region-source.png', original);
    await regionEditor.screenshot({ path: 'work/qa/p6-region-ar.png' });
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await regionEditor.scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await regionEditor.screenshot({ path: 'work/qa/p6-region-ar-mobile.png' });
    await panel
      .getByRole('button', { name: 'مسح مسودة الصور', exact: true })
      .click();
    await panel
      .getByLabel('ملف سجل مراجعة الصور', { exact: true })
      .setInputFiles({
        name: 'review.json',
        mimeType: 'application/json',
        buffer: proofBytes,
      });
    const button = panel
      .getByRole('button')
      .filter({ hasText: target.expected })
      .filter({ hasText: 'قيمة محددة' });
    await button.click();
    await regionEditor
      .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
      .waitFor();
    assert.deepEqual(await saved(), proof);
    await page.getByRole('button', { name: /^EN\b/ }).click();
    const enRegion = panel.getByRole('region', {
      name: 'Review a selected image value',
      exact: true,
    });
    await enRegion.screenshot({ path: 'work/qa/p6-region-en-mobile.png' });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(
      JSON.parse(
        (
          await bytes(
            panel.getByRole('button', {
              name: 'Save review record',
              exact: true,
            }),
          )
        ).toString('utf8'),
      ),
      proof,
    );
    await enRegion
      .getByRole('button', { name: 'Remove this value', exact: true })
      .click();
    assert.ok(
      await panel
        .getByRole('button', { name: 'Save review record', exact: true })
        .isDisabled(),
    );
    const tampered = structuredClone(proof);
    tampered.regions[0].value = '٢٥٠٫٠٠';
    await panel
      .getByLabel('Image review record in JSON format', { exact: true })
      .setInputFiles({
        name: 'tampered.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(tampered)),
      });
    await panel.getByRole('alert').waitFor();
    assert.equal(await panel.locator('.visual-review-record').count(), 0);
    await page.getByRole('button', { name: /^AR\b/ }).click();
    await page.setViewportSize(viewport);
    assert.deepEqual(
      await page.locator('.dropzone').allTextContents(),
      sourceBefore,
    );
    assert.ok(
      await page
        .getByRole('button', { name: 'تأكيد البيانات', exact: true })
        .isDisabled(),
    );
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    const report = {
      passed: true,
      sourceSha256: contract.source.sha256,
      regionId: id,
      value: target.expected,
      financialPromotion: false,
      languages: ['ar', 'en'],
      pointerAndKeyboard: true,
      networkViolations: violations,
      pageErrors: errors,
    };
    await writeFile(
      'work/qa/p6-region-report.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      '[browser] visual regions: real Arabic OCR, manual crop, review invalidation, cancel, save/restore, AR/EN/mobile and financial isolation passed',
    );
    return report;
  } finally {
    page.context().off('request', onRequest);
    page.off('pageerror', onError);
  }
}
