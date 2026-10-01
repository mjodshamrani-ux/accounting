import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export async function verifyVisualReview(
  page,
  panel,
  original,
  assertIsolated,
) {
  const record = panel.locator('.visual-review-record');
  await record.waitFor({ state: 'visible' });
  const cell = panel.getByRole('region', {
    name: 'مراجعة قيمة من الصورة',
    exact: true,
  });
  const value = panel.getByLabel('القيمة كما تظهر في الأصل', { exact: true });
  const role = panel.getByLabel('نوع القيمة', { exact: true });
  const confirm = panel.getByRole('button', {
    name: 'تأكيد مراجعة هذه القيمة',
    exact: true,
  });
  const save = panel.getByRole('button', {
    name: 'حفظ سجل المراجعة',
    exact: true,
  });
  async function saveBytes(button = save) {
    const downloadWait = page.waitForEvent('download');
    await button.click();
    const download = await downloadWait;
    assert.match(
      download.suggestedFilename(),
      /^tarasuf-visual-review-[a-f0-9]{8}\.json$/,
    );
    const bytes = await readFile(await download.path());
    await button.waitFor({ state: 'visible' });
    return bytes;
  }
  await role.selectOption('reference');
  assert.equal(await value.inputValue(), 'INV-700');
  await confirm.click();
  await cell
    .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
    .waitFor();
  assert.equal(
    await cell
      .getByRole('img', { name: 'قصاصة القيمة من الصورة الأصلية', exact: true })
      .count(),
    1,
  );
  await panel.getByRole('button', { name: '-250.00', exact: true }).click();
  await role.selectOption('amount');
  await confirm.click();
  await cell
    .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
    .waitFor();
  const initial = JSON.parse((await saveBytes()).toString('utf8'));
  assert.equal(initial.cells.length, 2);
  assert.ok(initial.cells.every((c) => c.review));
  const amountCell = initial.cells.find((c) => c.role === 'amount');
  const cropRect = cell.locator('clipPath rect');
  for (const [attribute, expected] of Object.entries({
    x: amountCell.region.x0,
    y: amountCell.region.y0,
    width: amountCell.region.x1 - amountCell.region.x0,
    height: amountCell.region.y1 - amountCell.region.y0,
  }))
    assert.equal(
      Number(await cropRect.getAttribute(attribute)),
      expected,
      'displayed crop must clip to the exact recorded region',
    );
  assert.equal(
    await cell.locator('image').getAttribute('clip-path'),
    `url(#${await cell.locator('clipPath').getAttribute('id')})`,
  );
  assert.deepEqual(
    Buffer.from(initial.source.originalPng.split(',')[1], 'base64'),
    original,
  );
  await value.fill('250.00');
  await cell.getByText('هذه القيمة لم تُراجع بعد', { exact: true }).waitFor();
  const edited = JSON.parse((await saveBytes()).toString('utf8'));
  assert.equal(edited.cells.find((c) => c.observed === '-250.00').review, null);
  assert.equal(
    edited.cells.find((c) => c.observed === '-250.00').value,
    '250.00',
  );
  assert.deepEqual(
    edited.cells.find((c) => c.observed === 'INV-700'),
    initial.cells.find((c) => c.observed === 'INV-700'),
  );
  // Clearing the input cannot leave the old reviewed value in a saved record.
  await value.fill('');
  assert.equal(await confirm.isDisabled(), true);
  const cleared = JSON.parse((await saveBytes()).toString('utf8'));
  assert.equal(
    cleared.cells.some((c) => c.observed === '-250.00'),
    false,
  );
  await value.fill('-250.00');
  await confirm.click();
  await cell
    .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
    .waitFor();
  await role.selectOption('reference');
  await cell.getByText('هذه القيمة لم تُراجع بعد', { exact: true }).waitFor();
  await role.selectOption('amount');
  await confirm.click();
  await cell
    .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
    .waitFor();
  const reviewedBytes = await saveBytes();
  await mkdir('work/qa', { recursive: true });
  await writeFile('work/qa/p6-source.png', original);
  await writeFile('work/qa/p6-reviewed.json', reviewedBytes);
  await cell.screenshot({ path: 'work/qa/p6-review-ar.png' });
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await cell.scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    'value review must fit a narrow screen',
  );
  await cell.screenshot({ path: 'work/qa/p6-review-ar-mobile.png' });
  await page.setViewportSize(originalViewport);
  await page
    .getByRole('group', { name: 'لغة الواجهة' })
    .getByRole('button', { name: /^EN\b/ })
    .click();
  await panel
    .getByRole('region', { name: 'Review an image value', exact: true })
    .getByText('This value was checked against the crop', { exact: true })
    .waitFor();
  const englishBytes = await saveBytes(
    panel.getByRole('button', { name: 'Save review record', exact: true }),
  );
  const englishCell = panel.getByRole('region', {
    name: 'Review an image value',
    exact: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await englishCell.scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    'English value review must fit a narrow screen',
  );
  await englishCell.screenshot({ path: 'work/qa/p6-review-en-mobile.png' });
  await page.setViewportSize(originalViewport);
  assert.deepEqual(
    JSON.parse(englishBytes.toString('utf8')),
    JSON.parse(reviewedBytes.toString('utf8')),
  );
  await page
    .getByRole('group', { name: 'Interface language' })
    .getByRole('button', { name: /^AR\b/ })
    .click();
  await assertIsolated('reviewed cells and language switch');
  await panel
    .getByRole('button', { name: 'مسح مسودة الصور', exact: true })
    .click();
  await record.waitFor({ state: 'hidden' });
  const restore = panel.getByLabel('ملف سجل مراجعة الصور', {
    exact: true,
  });
  await restore.setInputFiles({
    name: 'p6-reviewed.json',
    mimeType: 'application/json',
    buffer: reviewedBytes,
  });
  await record.waitFor({ state: 'visible' });
  await panel.getByRole('button', { name: '-250.00', exact: true }).click();
  await cell
    .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
    .waitFor();
  assert.equal(await value.inputValue(), '-250.00');
  assert.deepEqual(
    JSON.parse((await saveBytes()).toString('utf8')),
    JSON.parse(reviewedBytes.toString('utf8')),
  );
  const tampered = JSON.parse(reviewedBytes.toString('utf8'));
  tampered.cells.find((c) => c.role === 'amount').value = '250.00';
  await restore.setInputFiles({
    name: 'p6-tampered.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tampered)),
  });
  await panel
    .getByRole('alert')
    .filter({ hasText: 'تغيرت الصورة أو إحدى القيم بعد المراجعة' })
    .waitFor();
  assert.equal(await record.count(), 0);
  assert.equal(await panel.locator('.visual-word').count(), 0);
  await assertIsolated('tampered receipt rejected');
  await restore.setInputFiles({
    name: 'p6-reviewed.json',
    mimeType: 'application/json',
    buffer: reviewedBytes,
  });
  await record.waitFor({ state: 'visible' });
  await assertIsolated('restored receipt');
  console.log(
    '[browser] P6 actual OCR: cell correction, invalidation, bilingual save, restore and tamper rejection passed; financial promotion remains disabled',
  );
}
