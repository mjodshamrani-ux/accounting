import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export async function verifyBankAdjustments(
  page,
  url,
  out = 'work/bank-adjustment/browser',
) {
  await mkdir(out, { recursive: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'EN English', exact: true }).click();
  await page
    .getByRole('button', { name: 'Bank movements', exact: true })
    .click();
  const section = page.getByTestId('bank-balance-workspace');
  const status = page.getByTestId('bank-balance-result');
  const endpoints = page.getByTestId('bank-balance-endpoints');
  const table = (name) =>
    section
      .getByRole('heading', { name, exact: true })
      .locator('..')
      .locator('table');
  const wait = () =>
    section
      .locator('fieldset:has(input[type="file"])')
      .first()
      .waitFor()
      .then(() =>
        page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="bank-balance-workspace"]')
              ?.getAttribute('aria-busy') === 'false',
        ),
      );
  async function restore(file) {
    await section
      .getByLabel('Restore full bank reconciliation session', { exact: true })
      .setInputFiles(file);
    await wait();
  }
  async function download(button, file) {
    const pending = page.waitForEvent('download');
    await section.getByRole('button', { name: button, exact: true }).click();
    await (await pending).saveAs(`${out}/${file}`);
    await wait();
  }
  async function decision(action) {
    await section
      .getByRole('button', { name: new RegExp(`^${action} `) })
      .click();
    await wait();
  }
  await section
    .getByRole('button', {
      name: 'Open a synthetic balance reconciliation example',
      exact: true,
    })
    .click();
  await status.waitFor();
  await wait();
  assert.equal(
    await status.textContent(),
    'Complete lifecycle or movement review required',
  );
  assert.equal(
    await section
      .getByRole('button', { name: /^Approve lifecycle / })
      .isEnabled(),
    false,
  );
  await section
    .getByLabel('Adjustment decision evidence reference', { exact: true })
    .fill('Synthetic bank browser evidence');
  await section
    .getByLabel('Adjustment decision reason', { exact: true })
    .fill('Original whole lifecycle and source values reviewed locally');
  await decision('Approve lifecycle');
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  const closing = await endpoints
    .locator('tbody tr')
    .nth(1)
    .locator('td')
    .allTextContents();
  assert.deepEqual(closing, [
    'Closing',
    '2,000.00',
    '1,900.00',
    '-100.00',
    '0.00',
    '1,900.00',
    '1,900.00',
    '0.00',
  ]);
  await table('Original reconciliation evidence')
    .getByRole('button', { name: 'Review original cells', exact: true })
    .click();
  assert.equal(
    await table('Selected original cell evidence').locator('tbody tr').count(),
    15,
  );
  await download(
    'Download full bank reconciliation workpaper',
    'ui-closing-outflow.xlsx',
  );
  await download('Save full bank reconciliation session', 'ui-session.json');
  const saved = JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8'));
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].itemIds.length, 1);
  assert.equal('result' in saved, false);
  await decision('Undo lifecycle decision');
  assert.equal(
    await status.textContent(),
    'Complete lifecycle or movement review required',
  );
  await decision('Reject lifecycle');
  assert.equal(
    await table('Complete item lifecycles')
      .locator('tbody tr td')
      .nth(1)
      .textContent(),
    'Rejected',
  );
  await decision('Undo lifecycle decision');
  await decision('Approve lifecycle');
  assert.equal(
    await table('Dated reconciliation decisions').locator('tbody tr').count(),
    5,
  );
  await restore(`${out}/ui-session.json`);
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  assert.equal(
    await table('Dated reconciliation decisions').locator('tbody tr').count(),
    1,
  );
  await download(
    'Download full bank reconciliation workpaper',
    'ui-closing-outflow-restored.xlsx',
  );
  // Failed session replacement is atomic and retains the accepted prior state.
  await writeFile(
    `${out}/tampered.json`,
    JSON.stringify({
      ...JSON.parse(await readFile(`${out}/ui-session.json`, 'utf8')),
      injected: true,
    }),
  );
  await restore(`${out}/tampered.json`);
  await section.getByRole('alert').waitFor();
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  assert.equal(
    await table('Dated reconciliation decisions').locator('tbody tr').count(),
    1,
  );
  // Actual Worker restores the complete old opening/closing lifecycle atomically.
  await restore(`${out}/old-carried.json`);
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  assert.equal(
    await table('Original reconciliation items').locator('tbody tr').count(),
    2,
  );
  assert.equal(
    await table('Complete item lifecycles')
      .locator('tbody tr td')
      .nth(2)
      .textContent(),
    'I-open · I-close',
  );
  await download(
    'Download full bank reconciliation workpaper',
    'ui-old-carried.xlsx',
  );
  for (const [name, expected] of [
    ['isolated-own-bridge-gap', 'A bridge or adjusted difference remains'],
    [
      'settlement-cannot-hide-policy',
      'Complete lifecycle or movement review required',
    ],
    [
      'settlement-cannot-hide-undo',
      'Complete lifecycle or movement review required',
    ],
    ['malformed-competing-item', 'Source evidence is invalid'],
  ]) {
    await restore(`${out}/${name}.json`);
    assert.equal(await status.textContent(), expected, name);
    await download(
      'Download full bank reconciliation workpaper',
      `ui-${name}.xlsx`,
    );
  }
  await restore(`${out}/ui-session.json`);
  // Replacing a source clears existing approvals and requires renewed evidence review.
  await section
    .getByLabel('Reconciliation evidence source', { exact: true })
    .setInputFiles(
      'audit/bank-adjustment/regressions/native-black-background.xlsx',
    );
  await wait();
  assert.equal(await status.count(), 0);
  await section
    .getByLabel('Reconciliation evidence source I reviewed this table', {
      exact: true,
    })
    .check();
  await section
    .getByLabel(
      'I reviewed the supplied evidence inventory and both opening and closing reconciliation points.',
      { exact: true },
    )
    .check();
  await section
    .getByRole('button', { name: 'Reconcile balances and items', exact: true })
    .click();
  await wait();
  await section.getByRole('alert').waitFor();
  assert.equal(await status.count(), 0);
  await restore(`${out}/ui-session.json`);
  // Positive native source replacement passes through the actual read/reconcile worker.
  for (const kind of [
    'white-font',
    'black-fill',
    'tiny-row',
    'tiny-column',
    'low-zoom',
    'hex-column',
  ]) {
    await section
      .getByLabel('Reconciliation evidence source', { exact: true })
      .setInputFiles(
        `audit/bank-adjustment/regressions/native-visibility/native-${kind}.xlsx`,
      );
    await wait();
    await section
      .getByLabel('Reconciliation evidence source I reviewed this table', {
        exact: true,
      })
      .check();
    await section
      .getByLabel(
        'I reviewed the supplied evidence inventory and both opening and closing reconciliation points.',
        { exact: true },
      )
      .check();
    await section
      .getByRole('button', {
        name: 'Reconcile balances and items',
        exact: true,
      })
      .click();
    await wait();
    await section.getByRole('alert').waitFor();
    assert.equal(await status.count(), 0, kind);
    await restore(`${out}/ui-session.json`);
    assert.equal(
      await status.textContent(),
      'Reconciled within confirmed evidence',
      kind,
    );
  }
  for (const [index, label] of [
    [2, 'Reconciliation item source'],
    [3, 'Reconciliation evidence source'],
  ]) {
    await section
      .getByLabel(label, { exact: true })
      .setInputFiles(
        `work/bank-adjustment/exports/closing-outflow-source-${index - 2}.xlsx`,
      );
    await wait();
    await section
      .getByLabel(`${label} I reviewed this table`, { exact: true })
      .check();
  }
  await section
    .getByLabel(
      'I reviewed the supplied evidence inventory and both opening and closing reconciliation points.',
      { exact: true },
    )
    .check();
  await section
    .getByRole('button', { name: 'Reconcile balances and items', exact: true })
    .click();
  await wait();
  assert.equal(
    await status.textContent(),
    'Complete lifecycle or movement review required',
  );
  await decision('Approve lifecycle');
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  await download(
    'Download full bank reconciliation workpaper',
    'ui-closing-outflow-native.xlsx',
  );
  await download(
    'Save full bank reconciliation session',
    'ui-native-session.json',
  );
  await restore(`${out}/ui-native-session.json`);
  await download(
    'Download full bank reconciliation workpaper',
    'ui-closing-outflow-native-restored.xlsx',
  );
  await restore(`${out}/invalid-balance.json`);
  assert.equal(await status.textContent(), 'Source evidence is invalid');
  const inventory = page.getByTestId('bank-balance-inventory');
  const badRow = inventory
    .locator('tbody tr')
    .filter({ hasText: 'broken-original-balance' });
  assert.equal(await badRow.count(), 1);
  assert.match(await badRow.innerText(), /Invalid original balance amount/);
  assert.match(
    await page.getByTestId('bank-balance-missing').innerText(),
    /Bank.*Closing/s,
  );
  assert.equal(
    await section
      .getByRole('button', { name: /^Approve lifecycle / })
      .isEnabled(),
    false,
  );
  await restore(`${out}/ui-native-session.json`);
  // Fault injection withholds one native Worker request; cancellation must discard its late reply.
  await page.evaluate(() => {
    const original = Reflect.get(Worker.prototype, 'postMessage');
    window.__bankOriginalPost = original;
    window.__bankHeld = null;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (
        message.action === 'bank-adjustment-reconcile' &&
        !window.__bankHeld
      ) {
        window.__bankHeld = { message, handler: this.onmessage };
        this.onmessage?.({
          data: {
            channel: message.channel,
            id: message.id + 999,
            action: message.action,
            ok: true,
            value: {},
          },
        });
        return;
      }
      return original.call(this, message, ...rest);
    };
  });
  await section
    .getByRole('button', { name: 'Reconcile balances and items', exact: true })
    .click();
  await section
    .getByRole('button', { name: 'Cancel balance processing', exact: true })
    .waitFor();
  assert.equal(
    await section
      .getByRole('button', {
        name: 'Download full bank reconciliation workpaper',
        exact: true,
      })
      .isEnabled(),
    false,
  );
  await section
    .getByRole('button', { name: 'Cancel balance processing', exact: true })
    .click();
  await wait();
  await page.evaluate(() => {
    const h = window.__bankHeld;
    h.handler({
      data: {
        channel: h.message.channel,
        id: h.message.id,
        action: h.message.action,
        ok: true,
        value: { state: h.message.payload, result: { status: 'inconsistent' } },
      },
    });
    Worker.prototype.postMessage = window.__bankOriginalPost;
  });
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  await section
    .getByRole('button', { name: 'Reconcile balances and items', exact: true })
    .click();
  await wait();
  assert.equal(
    await status.textContent(),
    'Reconciled within confirmed evidence',
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await status.textContent(),
      'Reconciled within confirmed evidence',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    assert.equal(overflow, false, `width ${width}`);
    await page.screenshot({
      path: `${out}/bank-balance-en-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
  assert.equal(await status.textContent(), 'تسوية مثبتة ضمن الأصول المؤكدة');
  await page.screenshot({
    path: `${out}/bank-balance-ar-320.png`,
    fullPage: true,
  });
  console.log(
    'B2.2 actual worker UI decisions, full restoration, 9 exports, tamper, original background guard and ar/en 320/390 passed; synthetic only',
  );
}
