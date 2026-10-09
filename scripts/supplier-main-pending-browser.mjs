import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export function holdOriginalWorkerReplies() {
  const descriptor = Object.getOwnPropertyDescriptor(
    Worker.prototype,
    'onmessage',
  );
  if (!descriptor?.set)
    throw Error('Native Worker onmessage descriptor unavailable');
  const handlers = new WeakMap();
  globalThis.heldOriginalWorkerReplies = [];
  Object.defineProperty(Worker.prototype, 'onmessage', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return handlers.get(this) ?? null;
    },
    set(handler) {
      handlers.set(this, handler);
      descriptor.set.call(
        this,
        typeof handler === 'function'
          ? function (event) {
              if (
                event.data?.action === globalThis.holdOriginalWorkerAction &&
                Object.hasOwn(event.data, 'value')
              ) {
                globalThis.holdOriginalWorkerAction = null;
                globalThis.heldOriginalWorkerReplies.push(() =>
                  handler.call(this, event),
                );
              } else return handler.call(this, event);
            }
          : handler,
      );
    },
  });
  const original = Object.getOwnPropertyDescriptor(
    Blob.prototype,
    'arrayBuffer',
  ).value;
  globalThis.heldOriginalFileReads = [];
  File.prototype.arrayBuffer = async function () {
    const bytes = await original.call(this);
    if (this.name.startsWith('held'))
      await new Promise((resolve) =>
        globalThis.heldOriginalFileReads.push(resolve),
      );
    return bytes;
  };
}
export async function verifyActualAllocationPending(
  browser,
  url,
  fixtures,
  out,
  catalogs,
) {
  const manifest = JSON.parse(
    await readFile(path.join(fixtures, 'fixture-manifest.json'), 'utf8'),
  );
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (path.basename(name) !== name) throw Error('Unsafe native fixture path');
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(fixtures, name)))
        .digest('hex'),
      expected,
    );
  }
  const results = [];
  for (const lang of ['ar', 'en']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 1000 },
      acceptDownloads: true,
    });
    await context.addInitScript(holdOriginalWorkerReplies);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(url);
      await page
        .locator(`.language-switch button[lang="${lang}"]:visible`)
        .first()
        .click();
      const t = catalogs[lang].allocation;
      const button = (p, n) => p.getByRole('button', { name: n, exact: true });
      await button(page, t.entry).click();
      const workspace = () => page.locator('[data-allocation-workspace]');
      await workspace().waitFor();
      const idle = () =>
        page.waitForFunction(
          () =>
            document
              .querySelector('[data-allocation-workspace]')
              ?.getAttribute('aria-busy') === 'false',
        );
      // Real native File bytes are read first; only delivery is held. Leave retains this direct workspace mounted but inactive.
      await page
        .getByTestId('allocation-source-0')
        .getByLabel(t.sides[0], { exact: true })
        .setInputFiles(path.join(fixtures, 'held-payments.csv'));
      await page.waitForFunction(
        () => globalThis.heldOriginalFileReads.length === 1,
      );
      await button(workspace(), t.backToSuppliers).click();
      await page.evaluate(() =>
        globalThis.heldOriginalFileReads.splice(0).forEach((r) => r()),
      );
      await button(page, t.entry).click();
      await idle();
      assert.equal(
        await page.getByTestId('allocation-source-0').locator('h3').count(),
        0,
      );
      assert.equal(await page.getByTestId('allocation-result').count(), 0);
      for (let i = 0; i < 3; i++) {
        const source = page.getByTestId('allocation-source-' + i);
        await source
          .getByLabel(t.sides[i], { exact: true })
          .setInputFiles(path.join(fixtures, 'partial-' + i + '.csv'));
        await source
          .getByRole('heading', { name: 'partial-' + i + '.csv', exact: true })
          .waitFor();
        await idle();
        await source.getByRole('checkbox').check();
      }
      for (const [i, value] of [
        'Synthetic Buyer',
        'Primary Book',
        'Supplier S01',
        '2100',
        'SAR',
        '2026-09-30',
      ].entries())
        await workspace().getByLabel(t.fields[i], { exact: true }).fill(value);
      await workspace().getByLabel(t.scopeConfirm, { exact: true }).check();
      await button(workspace(), t.readValueLedger).click();
      await page.getByTestId('allocation-result').waitFor();
      await idle();
      const rows = () =>
        page
          .getByTestId('allocation-ledger')
          .locator('tbody tr')
          .evaluateAll((rs) =>
            rs.map((r) =>
              Array.from(r.querySelectorAll('td,th')).map((c) => c.textContent),
            ),
          );
      const baseline = await rows();
      assert.ok(
        baseline.every(
          (r) => r[3] === '10.00' && r[4] === '0.00' && r[5] === '10.00',
        ),
      );
      await workspace()
        .getByLabel(t.decisionOrUndoReason, { exact: true })
        .fill(
          'Reviewed original native available-capacity H5 rows before explicit independent partial allocation.',
        );
      await workspace()
        .getByLabel(t.humanEvidenceReference, { exact: true })
        .fill('Independent H5 synthetic source review');
      const draft = page.getByTestId('allocation-draft').first();
      await draft
        .getByLabel(t.sides[0], { exact: true })
        .selectOption({ label: 'P1' });
      await draft
        .getByLabel(t.sides[1], { exact: true })
        .selectOption({ label: 'I1' });
      await draft.getByLabel(t.allocationAmount, { exact: true }).fill('4.00');
      await page.evaluate(() => {
        globalThis.holdOriginalWorkerAction = 'allocation-reconcile';
      });
      await button(workspace(), t.approveHuman).click();
      await page.waitForFunction(
        () => globalThis.heldOriginalWorkerReplies.length === 1,
      );
      await button(workspace(), t.backToSuppliers).click();
      await page.evaluate(() =>
        globalThis.heldOriginalWorkerReplies.splice(0).forEach((r) => r()),
      );
      await button(page, t.entry).click();
      await idle();
      assert.equal(await page.getByTestId('allocation-event').count(), 0);
      assert.deepEqual(await rows(), baseline);
      const downloads = [];
      page.on('download', (d) => downloads.push(d.suggestedFilename()));
      await page.evaluate(() => {
        globalThis.holdOriginalWorkerAction = 'allocation-save';
      });
      await button(workspace(), t.saveAllocationSession).click();
      await page.waitForFunction(
        () => globalThis.heldOriginalWorkerReplies.length === 1,
      );
      await button(workspace(), t.backToSuppliers).click();
      await page.evaluate(() =>
        globalThis.heldOriginalWorkerReplies.splice(0).forEach((r) => r()),
      );
      await button(page, t.entry).click();
      await idle();
      assert.deepEqual(downloads, []);
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: path.join(out, 'actual-pending-' + lang + '.png'),
        fullPage: true,
      });
      results.push({
        lang,
        pendingNativeFileDeliveryLeaveCancelled: true,
        originalWorkerDecisionDeliveryLeaveCancelled: true,
        originalWorkerSaveDeliveryLeaveNoDownload: true,
        pageErrors: errors,
        timingBoundary:
          'native Worker transport before client protocol validation; untouched actual event and value',
      });
    } catch (error) {
      await writeFile(
        path.join(out, 'pending-' + lang + '-failure.txt'),
        String(error.stack),
      );
      await writeFile(
        path.join(out, 'pending-' + lang + '-body.txt'),
        await page.locator('body').innerText(),
      );
      await page.screenshot({
        path: path.join(out, 'pending-' + lang + '-failure.png'),
        fullPage: true,
      });
      throw error;
    } finally {
      await context.close();
    }
  }
  return results;
}
