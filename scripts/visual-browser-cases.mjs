import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// This PDF contains only the actual RGB pixels generated below. There is no
// text layer for the application (or this test) to mistake for OCR output.
function rasterPdf(width, height, rgb) {
  assert.equal(rgb.length, width * height * 3);
  const pageWidth = (width * 72) / 200;
  const pageHeight = (height * 72) / 200;
  const compressed = deflateSync(rgb);
  const content = Buffer.from(
    `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Scan Do\nQ`,
  );
  const stream = (data, attributes = '') =>
    Buffer.concat([
      Buffer.from(`<< ${attributes} /Length ${data.length} >>\nstream\n`),
      data,
      Buffer.from('\nendstream'),
    ]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>`,
    ),
    stream(content),
    stream(
      compressed,
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`,
    ),
  ];
  const parts = [Buffer.from('%PDF-1.7\n')];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

export async function verifyVisualReader(page, baseUrl) {
  const app = new URL(baseUrl);
  await page.goto(app.href);
  await page.getByRole('button', { name: 'تجربة مثال', exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.body.innerText.includes('تحميل المحرك إلى جهازك'),
  );
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  assert.ok(csp?.includes("connect-src 'none'"));
  assert.ok(csp?.includes('worker-src blob:'));
  const panel = page.locator('#visual-reader');
  await panel.locator('summary').first().click();
  const fileInput = page.getByLabel('ملف للقراءة البصرية', { exact: true });
  const confirm = page.getByRole('button', {
    name: 'تأكيد البيانات',
    exact: true,
  });
  assert.equal(await confirm.isDisabled(), true);
  let nativeSources = await page.locator('.dropzone').allTextContents();
  const emptyNativeSources = [...nativeSources];
  assert.equal(nativeSources.length, 2);

  // Browser evaluation is confined to drawing independent synthetic fixtures.
  // No app state, native parser, OCR return value or worker result is injected.
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.textBaseline = 'alphabetic';
    context.font = 'bold 52px Arial';
    context.fillText('SUPPLIER STATEMENT', 60, 90);
    context.font = '48px Arial';
    context.fillText('Reference', 60, 180);
    context.fillText('Amount', 760, 180);
    context.fillText('INV-700', 60, 280);
    context.fillText('1,250.00', 760, 280);
    context.fillText('PAY-700', 60, 380);
    context.fillText('-250.00', 760, 380);
    context.fillText('Total', 60, 500);
    context.fillText('1,000.00', 760, 500);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      rgb[target++] = rgba[source];
      rgb[target++] = rgba[source + 1];
      rgb[target++] = rgba[source + 2];
    }
    let binary = '';
    for (let offset = 0; offset < rgb.length; offset += 16384)
      binary += String.fromCharCode(...rgb.subarray(offset, offset + 16384));
    const arabic = document.createElement('canvas');
    arabic.width = 1400;
    arabic.height = 640;
    const arabicContext = arabic.getContext('2d');
    arabicContext.fillStyle = '#fff';
    arabicContext.fillRect(0, 0, arabic.width, arabic.height);
    arabicContext.fillStyle = '#000';
    arabicContext.textBaseline = 'alphabetic';
    arabicContext.direction = 'rtl';
    arabicContext.textAlign = 'right';
    arabicContext.font = '64px Arial';
    arabicContext.fillText('كشف حساب المورد', 1340, 110);
    arabicContext.fillText('فاتورة', 1340, 270);
    arabicContext.fillText('دفعة', 1340, 380);
    arabicContext.fillText('الإجمالي', 1340, 500);
    // The browser shapes the Arabic heading. Explicit LTR amount drawing
    // preserves the fixture's leading minus without reversing its digits.
    arabicContext.direction = 'ltr';
    arabicContext.textAlign = 'left';
    arabicContext.fillText('١٬٢٥٠٫٠٠', 160, 270);
    arabicContext.fillText('-٢٥٠٫٠٠', 160, 380);
    arabicContext.fillText('١٬٠٠٠٫٠٠', 160, 500);
    return {
      width: canvas.width,
      height: canvas.height,
      pngBase64: canvas.toDataURL('image/png').split(',')[1],
      rgbBase64: btoa(binary),
      arabicPngBase64: arabic.toDataURL('image/png').split(',')[1],
    };
  });
  const png = Buffer.from(fixture.pngBase64, 'base64');
  const arabicPng = Buffer.from(fixture.arabicPngBase64, 'base64');
  const pdf = rasterPdf(
    fixture.width,
    fixture.height,
    Buffer.from(fixture.rgbBase64, 'base64'),
  );
  const deadline = Date.now() + 170_000;
  const violations = [];
  const requests = [];
  const context = page.context();
  const onRequest = (request) => {
    const url = new URL(request.url());
    const entry = `${request.method()} ${request.url()}`;
    requests.push(entry);
    if (request.method() !== 'GET') {
      violations.push(entry);
      return;
    }
    // These are in-memory objects, not network destinations. HTTP(S) requests
    // after upload may only load static code from this deployment's own path.
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    const appPath = app.pathname.endsWith('/')
      ? app.pathname
      : app.pathname.slice(0, app.pathname.lastIndexOf('/') + 1);
    const relative = url.pathname.startsWith(appPath)
      ? url.pathname.slice(appPath.length)
      : '';
    if (
      url.origin !== app.origin ||
      !/^(?:assets|ocr)\/[A-Za-z0-9_./-]+\.js$/.test(relative) ||
      url.search ||
      url.hash
    )
      violations.push(entry);
  };
  context.on('request', onRequest);
  const draftStatus = panel.getByRole('status').filter({
    hasText: 'مسودة بصرية غير متحققة',
  });
  const assertIsolated = async (phase) => {
    assert.equal(
      await confirm.isDisabled(),
      true,
      `${phase}: OCR cannot unlock reconciliation`,
    );
    assert.deepEqual(
      await page.locator('.dropzone').allTextContents(),
      nativeSources,
      `${phase}: OCR cannot replace either accounting source`,
    );
    assert.deepEqual(violations, [], `${phase}: unexpected file-time requests`);
  };
  const waitForDraft = async (
    name,
    source,
    requiredWords = ['INV-700', '1,250.00', '-250.00', '1,000.00'],
  ) => {
    const timeout = Math.min(120_000, deadline - Date.now());
    assert.ok(timeout > 0, 'visual browser checks exceeded their total budget');
    const result = draftStatus.or(panel.getByRole('alert'));
    await result.first().waitFor({ state: 'visible', timeout });
    if (await panel.getByRole('alert').isVisible())
      assert.fail(`${name}: ${await panel.getByRole('alert').innerText()}`);
    assert.ok(
      (await draftStatus.innerText()).includes(name),
      `${name}: source identity is current`,
    );
    assert.ok((await draftStatus.innerText()).includes('لم تُضف إلى التسوية'));
    const words = await panel.locator('.visual-word').allTextContents();
    for (const expected of requiredWords)
      assert.ok(
        words.includes(expected),
        `${name}: real OCR must preserve ${expected}; observed ${JSON.stringify(words)}`,
      );
    assert.ok(
      (await panel.locator('details').textContent()).includes(
        createHash('sha256').update(source).digest('hex'),
      ),
      `${name}: draft hash must identify these exact source bytes`,
    );
    await assertIsolated(name);
    return words;
  };
  const clear = async () => {
    await panel
      .getByRole('button', { name: 'مسح المسودة البصرية', exact: true })
      .click();
    await draftStatus.waitFor({ state: 'hidden' });
    assert.equal(await panel.locator('.visual-word').count(), 0);
    assert.equal(await panel.getByRole('img').count(), 0);
    await assertIsolated('clear');
  };
  try {
    await fileInput.setInputFiles({
      name: 'visual-real-ocr.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await waitForDraft('visual-real-ocr.png', png);
    const word = panel.getByRole('button', { name: 'INV-700', exact: true });
    await word.click();
    assert.equal(await word.getAttribute('aria-pressed'), 'true');
    const highlight = panel.locator(
      '.visual-draft-grid span[aria-hidden="true"]',
    );
    await highlight.waitFor({ state: 'visible' });
    const style = await highlight.getAttribute('style');
    const geometry = Object.fromEntries(
      ['left', 'top', 'width', 'height'].map((key) => {
        const match = style?.match(
          new RegExp(`(?:^|;)\\s*${key}:\\s*([0-9.]+)%`),
        );
        assert.ok(match, `word highlight has a percentage ${key}`);
        return [key, Number(match[1])];
      }),
    );
    assert.ok(geometry.width > 0 && geometry.height > 0);
    assert.ok(geometry.left >= 0 && geometry.top >= 0);
    assert.ok(
      geometry.left + geometry.width <= 100.01 &&
        geometry.top + geometry.height <= 100.01,
    );
    // A native-source change unmounts the completed visual draft. It must not
    // leave words, pixels or an OCR approval attached to the new source.
    const nativeCsvName = 'visual-lifecycle-native.csv';
    await page.getByLabel('كشف المورد', { exact: true }).setInputFiles({
      name: nativeCsvName,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'date,reference,amount\n2026-07-01,LIFECYCLE-1,100.00',
      ),
    });
    await page
      .locator('.dropzone')
      .getByText(nativeCsvName, { exact: true })
      .waitFor();
    await draftStatus.waitFor({ state: 'hidden' });
    assert.equal(
      await panel.locator('.visual-word').count(),
      0,
      'native upload clears previous OCR words',
    );
    assert.equal(
      await panel.getByRole('img').count(),
      0,
      'native upload clears previous OCR pixels',
    );
    nativeSources = await page.locator('.dropzone').allTextContents();
    assert.notDeepEqual(nativeSources, emptyNativeSources);
    await assertIsolated('native source replacement');
    assert.equal(
      await panel.getAttribute('open'),
      null,
      'new visual-reader instance starts closed',
    );
    await panel.locator('summary').first().click();

    await fileInput.setInputFiles({
      name: 'visual-arabic-observation.png',
      mimeType: 'image/png',
      buffer: arabicPng,
    });
    const observed = await waitForDraft(
      'visual-arabic-observation.png',
      arabicPng,
      [],
    );
    const stripBidiMarks = (value) =>
      value.replace(/[\u061c\u200e\u200f]/gu, '');
    const comparable = observed.map(stripBidiMarks);
    const expectedAmounts = ['١٬٢٥٠٫٠٠', '-٢٥٠٫٠٠', '١٬٠٠٠٫٠٠'];
    const exactAmountCount = expectedAmounts.filter((amount) =>
      comparable.includes(amount),
    ).length;
    const observation = {
      check: 'arabic-visual-ocr-observation',
      status: 'unverified',
      financialAccuracy: 'not-established',
      expected: {
        headingWords: ['كشف', 'حساب', 'المورد'],
        amounts: expectedAmounts,
      },
      observed,
      exactAmountCount,
      expectedAmountCount: expectedAmounts.length,
      numericCoverageGap: exactAmountCount !== expectedAmounts.length,
      comparisonRule:
        'exact Unicode words; ordinary bidi marks only are ignored; no digit, sign or separator substitution',
    };
    await mkdir('work/qa', { recursive: true });
    await writeFile(
      'work/qa/visual-arabic-ocr-observation.json',
      JSON.stringify(observation, null, 2) + '\n',
    );
    console.log(JSON.stringify(observation));
    if (observation.numericCoverageGap)
      console.warn(
        `ARABIC OCR NUMERIC COVERAGE GAP: ${exactAmountCount}/${expectedAmounts.length} exact amounts. This is an unverified observation, not financial success.`,
      );
    for (const headingWord of observation.expected.headingWords)
      assert.ok(
        comparable.includes(headingWord),
        `Arabic heading word ${headingWord} must be recognized; observed ${JSON.stringify(observed)}`,
      );
    await assertIsolated('Arabic unverified observation');

    // A fresh session must also remove a completed image draft even though
    // that draft was never part of the accounting files or comparison result.
    await page
      .getByRole('button', { name: 'عملية جديدة', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'حذف الجلسة والبدء', exact: true })
      .click();
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    await draftStatus.waitFor({ state: 'hidden' });
    assert.equal(
      await panel.locator('.visual-word').count(),
      0,
      'new session clears completed OCR words',
    );
    assert.equal(
      await panel.getByRole('img').count(),
      0,
      'new session clears completed OCR pixels',
    );
    assert.deepEqual(
      await page.locator('.dropzone').allTextContents(),
      emptyNativeSources,
    );
    nativeSources = [...emptyNativeSources];
    await assertIsolated('new session');
    assert.equal(await panel.getAttribute('open'), null);
    await panel.locator('summary').first().click();

    await fileInput.setInputFiles({
      name: 'visual-cancel.png',
      mimeType: 'image/png',
      buffer: png,
    });
    const cancelButton = panel.getByRole('button', {
      name: 'إلغاء القراءة البصرية',
      exact: true,
    });
    await cancelButton.click({ timeout: 10_000 });
    await cancelButton.waitFor({ state: 'hidden' });
    assert.equal(await draftStatus.count(), 0);
    assert.equal(await panel.locator('.visual-word').count(), 0);
    assert.equal(await fileInput.isEnabled(), true);
    await assertIsolated('cancel');

    await fileInput.setInputFiles({
      name: 'visual-real-raster.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await waitForDraft('visual-real-raster.pdf', pdf);
    const preview = panel.getByRole('img', {
      name: 'أصل الصفحة 1 من المسودة البصرية',
      exact: true,
    });
    await preview.waitFor({ state: 'visible' });
    assert.ok(
      (await preview.getAttribute('src')).startsWith('data:image/png;base64,'),
    );
    await clear();
    assert.ok(
      requests.some((entry) => entry.includes('/ocr/')),
      'The actual local OCR assets were requested; no static OCR fixture was substituted',
    );
    assert.ok(
      Date.now() <= deadline,
      'visual browser checks stay under three minutes',
    );
  } finally {
    context.off('request', onRequest);
  }
}
