import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export async function verifyVisualTable(page, baseUrl) {
  const original = await readFile('audit/visual-table/fixtures/statement.png');
  const contract = JSON.parse(
    await readFile('audit/visual-table/fixtures/contract.json', 'utf8'),
  );
  const app = new URL(baseUrl),
    violations = [],
    errors = [];
  const onRequest = (request) => {
    const u = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      (!['data:', 'blob:'].includes(u.protocol) && u.origin !== app.origin)
    )
      violations.push(request.url());
  };
  const onError = (e) => errors.push(e.message);
  page.context().on('request', onRequest);
  page.on('pageerror', onError);
  try {
    await page.goto(baseUrl);
    await page
      .getByRole('button', { name: 'جرّب المثال', exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.dropzone')).every(el => !el.textContent.includes('نجهّز أداة القراءة')),
    );
    const native = await page.locator('.dropzone').allTextContents();
    const panel = page.locator('#visual-reader');
    await panel.locator('summary').first().click();
    await panel
      .getByLabel('صورة أو PDF للقراءة التجريبية', { exact: true })
      .setInputFiles({
        name: contract.source.name,
        mimeType: 'image/png',
        buffer: original,
      });
    await panel
      .getByRole('heading', { name: 'سجل مراجعة القيم', exact: true })
      .waitFor({ timeout: 120000 });
    const reviewed = panel.getByRole('region', {
      name: 'مراجعة قيمة محددة من الصورة',
      exact: true,
    });
    async function draw(picker, box) {
      await picker.scrollIntoViewIfNeeded();
      const r = await picker.boundingBox();
      // Interior fractions avoid selecting the neighboring band from cursor rounding.
      await page.mouse.move(
        r.x + ((box.x0 + 0.6) / 1200) * r.width,
        r.y + ((box.y0 + 0.6) / 760) * r.height,
      );
      await page.mouse.down();
      await page.mouse.move(
        r.x + ((box.x1 - 0.6) / 1200) * r.width,
        r.y + ((box.y1 - 0.6) / 760) * r.height,
        { steps: 4 },
      );
      await page.mouse.up();
    }
    for (const [i, cell] of contract.rows[0].crops.entries()) {
      await panel
        .getByRole('button', { name: 'حدد قيمة من الصورة', exact: true })
        .click();
      await draw(
        panel.getByRole('button', {
          name: 'تحديد قصاصة من الصورة الأصلية',
          exact: true,
        }),
        cell.region,
      );
      await panel
        .getByRole('button', { name: 'استخدم هذه القصاصة', exact: true })
        .click();
      await reviewed
        .getByLabel('نوع القيمة', { exact: true })
        .selectOption(cell.role);
      await reviewed
        .getByLabel('القيمة كما تظهر في الأصل', { exact: true })
        .fill(contract.rows[0].expected[i]);
      await reviewed
        .getByRole('button', { name: 'تأكيد مراجعة هذه القيمة', exact: true })
        .click();
      await reviewed
        .getByText('راجعت هذه القيمة مع القصاصة', { exact: true })
        .waitFor();
    }
    const table = panel.locator('.visual-table-review');
    await table.locator('summary').click();
    await table
      .getByRole('button', { name: 'حدد قيمة من الصورة', exact: true })
      .click();
    await draw(
      table.getByRole('button', {
        name: 'تحديد قصاصة من الصورة الأصلية',
        exact: true,
      }),
      contract.grid.region,
    );
    await table
      .getByRole('button', { name: 'استخدم هذه القصاصة', exact: true })
      .click();
    const area = (await table.locator('output[dir="ltr"]').innerText()).match(
      /x: (\d+)–(\d+) \/ y: (\d+)–(\d+)/,
    );
    assert.ok(area);
    const x0 = Number(area[1]),
      x1 = Number(area[2]),
      y0 = Number(area[3]),
      y1 = Number(area[4]);
    await table
      .getByLabel('حدود الصفوف الرأسية بالبكسل', { exact: true })
      .fill(`${y0},340,460,${y1}`);
    await table
      .getByLabel('حدود الأعمدة الأفقية بالبكسل', { exact: true })
      .fill(`${x0},350,620,850,${x1}`);
    for (const [i, role] of contract.grid.roles.entries())
      await table
        .getByLabel(`نوع كل عمود من اليسار إلى اليمين ${i + 1}`, {
          exact: true,
        })
        .selectOption(role);
    await table
      .getByRole('button', { name: 'إنشاء سجل الصفوف', exact: true })
      .click();
    const coverage = table.getByRole('button', {
      name: 'راجعت كامل الصفحة وحددت كامل الجدول وكل صف فيه',
      exact: true,
    });
    assert.ok(await coverage.isDisabled());
    const row1 = table.getByRole('region', { name: 'الصف 1', exact: true });
    await row1.getByLabel('نوع الصف', { exact: true }).selectOption('movement');
    for (const [role, label] of [
      ['reference', 'المرجع'],
      ['date', 'التاريخ'],
      ['amount', 'مبلغ الحركة'],
      ['balance', 'الرصيد'],
    ]) {
      const select = row1.getByLabel(label, { exact: true }),
        index = contract.grid.roles.indexOf(role);
      const options = await select.locator('option').allTextContents();
      assert.deepEqual(options.slice(1), [contract.rows[0].expected[index]]);
      await select.selectOption({ label: contract.rows[0].expected[index] });
    }
    const row2 = table.getByRole('region', { name: 'الصف 2', exact: true });
    await row2
      .getByLabel('نوع الصف', { exact: true })
      .selectOption('unreadable');
    await row2
      .getByLabel('سبب الاستبعاد أو مشكلة القراءة', { exact: true })
      .fill(contract.rows[1].note);
    const row3 = table.getByRole('region', { name: 'الصف 3', exact: true });
    await row3
      .getByLabel('نوع الصف', { exact: true })
      .selectOption('non-movement');
    await row3
      .getByLabel('سبب الاستبعاد أو مشكلة القراءة', { exact: true })
      .fill(contract.rows[2].note);
    assert.ok(await coverage.isDisabled());
    await row3
      .getByRole('button', {
        name: 'راجعت هذا الصف وهو لا يمثل حركة',
        exact: true,
      })
      .click();
    await row3.getByText('استبعاد مُراجع مع الأصل', { exact: true }).waitFor();
    await coverage.click();
    await table.getByText('مراجعة النطاق مسجلة', { exact: true }).waitFor();
    async function save(label = 'حفظ سجل الجدول') {
      const waiting = page.waitForEvent('download');
      await table.getByRole('button', { name: label, exact: true }).click();
      return readFile(await (await waiting).path());
    }
    const proofBytes = await save(),
      proof = JSON.parse(proofBytes.toString('utf8'));
    assert.equal(proof.kind, 'visual-table');
    assert.equal(proof.rows.length, 3);
    assert.equal(proof.rows[1].disposition, 'unreadable');
    assert.ok(proof.coverage);
    assert.deepEqual(proof.rows[0].cells, [
      'region:1',
      'region:2',
      'region:3',
      'region:4',
    ]);
    // No hidden old exclusion while a reason is being cleared.
    await row3
      .getByLabel('سبب الاستبعاد أو مشكلة القراءة', { exact: true })
      .fill('');
    const pending = JSON.parse((await save()).toString('utf8'));
    assert.equal(pending.coverage, null);
    assert.equal(pending.rows[2].review, null);
    assert.equal(pending.rows[2].disposition, 'unclassified');
    await panel
      .getByLabel('ملف سجل مراجعة الصور', { exact: true })
      .setInputFiles({
        name: 'table.json',
        mimeType: 'application/json',
        buffer: proofBytes,
      });
    await table.getByText('مراجعة النطاق مسجلة', { exact: true }).waitFor();
    assert.deepEqual(JSON.parse((await save()).toString('utf8')), proof);
    await mkdir('work/qa', { recursive: true });
    await writeFile('work/qa/p6-table-reviewed.json', proofBytes);
    await writeFile('work/qa/p6-table-source.png', original);
    await row1.screenshot({ path: 'work/qa/p6-table-ar.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await row1.scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await row1.screenshot({ path: 'work/qa/p6-table-ar-mobile.png' });
    await page.getByRole('button', { name: /^EN\b/ }).click();
    await table.getByText('Range review recorded', { exact: true }).waitFor();
    const en = table.getByRole('region', { name: 'Row 1', exact: true });
    await en.screenshot({ path: 'work/qa/p6-table-en-mobile.png' });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(
      JSON.parse((await save('Save table record')).toString('utf8')),
      proof,
    );
    // Source-cell edits must destroy the entire table inventory immediately.
    await panel
      .getByRole('button')
      .filter({ hasText: contract.rows[0].expected[2] })
      .filter({ hasText: 'Selected value' })
      .click();
    await panel
      .getByRole('region', {
        name: 'Review a selected image value',
        exact: true,
      })
      .getByLabel('Value as shown in the original', { exact: true })
      .fill('250.00');
    assert.equal(
      await table
        .getByRole('button', { name: 'Save table record', exact: true })
        .count(),
      0,
    );
    const tampered = structuredClone(proof);
    tampered.rows.splice(1, 1);
    await panel
      .getByLabel('Image review record in JSON format', { exact: true })
      .setInputFiles({
        name: 'missing-row.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(tampered)),
      });
    await panel.getByRole('alert').waitFor();
    assert.equal(await panel.locator('.visual-review-record').count(), 0);
    await page.getByRole('button', { name: /^AR\b/ }).click();
    assert.deepEqual(await page.locator('.dropzone').allTextContents(), native);
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
      rows: 3,
      manuallyReviewedValues: 4,
      unreadableRows: 1,
      reviewedExclusions: 1,
      financialPromotion: false,
      languages: ['ar', 'en'],
      fieldReviewInvalidatesTable: true,
      blankReasonInvalidatesExclusion: true,
      networkViolations: violations,
      pageErrors: errors,
    };
    await writeFile(
      'work/qa/p6-table-report.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      '[browser] table inventory: real OCR, four reviewed literals, unreadable row, reviewed total, replay, AR/EN/mobile, stale source and accounting isolation passed',
    );
    return report;
  } finally {
    page.context().off('request', onRequest);
    page.off('pageerror', onError);
  }
}
