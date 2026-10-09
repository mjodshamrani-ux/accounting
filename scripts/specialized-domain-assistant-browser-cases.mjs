import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const cases = [
  {
    domain: 'inventory-register',
    key: 'stock',
    entry: 'Posted inventory register / GL evidence',
    demo: 'Open a synthetic inventory example',
    cancel: 'Cancel inventory processing',
    scope: 'Inventory scope Map version',
    source: 'Posted inventory register',
    fixture: 'independent-units-positive',
    malformed: 'quantity-fraction-not-exact',
    count: 4,
    amountCount: 2,
  },
  {
    domain: 'fixed-assets',
    key: 'asset',
    entry: 'Posted fixed assets / GL component evidence',
    demo: 'Open a synthetic asset example',
    cancel: 'Cancel asset processing',
    scope: 'Asset scope Map version',
    source: 'Posted fixed asset register',
    fixture: 'three-components-positive',
    malformed: 'malformed-register-competitor-full-member',
    count: 4,
    amountCount: 8,
  },
  {
    domain: 'payroll',
    key: 'payroll',
    entry: 'Posted payroll / GL and bank payout evidence',
    demo: 'Open a synthetic payroll example',
    cancel: 'Cancel payroll processing',
    scope: 'Payroll scope Map version',
    source: 'Posted employee payroll register',
    fixture: 'seven-components-and-bank-positive',
    malformed: 'malformed-register-competitor-full-member',
    count: 5,
    amountCount: 14,
  },
];
export async function verifySpecializedDomainAssistant(page, url, out) {
  await mkdir(out, { recursive: true });
  const checks = [];
  await page.addInitScript(() => {
    const originalPost = Object.getOwnPropertyDescriptor(
      Worker.prototype,
      'postMessage',
    ).value;
    globalThis.specializedDelay = 0;
    globalThis.specializedWorkerActions = [];
    globalThis.specializedForgeReply = false;
    const NativeWorker = Worker;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args);
        // Registered before the client handler: emulate a delayed/forged worker
        // result with valid shape but a context outside the displayed result.
        worker.addEventListener('message', (event) => {
          if (
            globalThis.specializedForgeReply &&
            [
              'stock-reconcile',
              'asset-reconcile',
              'payroll-reconcile',
            ].includes(event.data?.action) &&
            event.data?.value?.result
          )
            event.data.value.result.context += ':forged-worker-context';
        });
        return worker;
      },
    });
    Worker.prototype.postMessage = function (...args) {
      globalThis.specializedWorkerActions.push(args[0]?.action);
      const delay = globalThis.specializedDelay;
      if (delay) setTimeout(() => originalPost.apply(this, args), delay);
      else originalPost.apply(this, args);
    };
  });
  for (const c of cases) {
    console.log('Specialized assistant browser:', c.domain);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(url);
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    await page.getByRole('button', { name: c.entry, exact: true }).click();
    const w = page.locator(`[data-${c.key}-workspace]`);
    const a = w.locator('[data-domain-evidence-assistant]');
    const demo = w.getByRole('button', { name: c.demo, exact: true });
    const idle = () =>
      page.waitForFunction(
        (key) =>
          document
            .querySelector(`[data-${key}-workspace]`)
            ?.getAttribute('aria-busy') === 'false',
        c.key,
      );
    const ask = async (kind) => {
      await a.locator(`[data-evidence-question="${kind}"]`).click();
      await a.locator(`[data-evidence-answer="${kind}"]`).waitFor();
      await idle();
    };
    await demo.click();
    await a.waitFor();
    await idle();
    const rawTruth = JSON.parse(
      await readFile(
        `audit/${c.domain}/cases/${c.fixture}/expected.json`,
        'utf8',
      ),
    );
    const truth = rawTruth.expected
      ? { ...rawTruth.expected, scope: rawTruth.scope }
      : rawTruth;
    const stateBefore = await w.locator(`[data-${c.key}-status]`).innerText();
    for (const kind of ['status', 'amounts', 'sources', 'next']) {
      const actions = await page.evaluate(
        () => globalThis.specializedWorkerActions.length,
      );
      await ask(kind);
      assert.equal(await a.locator('[data-evidence-hash]').count(), c.count);
      assert.equal(await a.locator('[data-evidence-context]').count(), 1);
      assert.ok(
        (await a.locator('[data-evidence-context]').textContent()).includes(
          truth.scope.mapVersion,
        ),
      );
      assert.ok(
        (
          await page.evaluate(
            (n) => globalThis.specializedWorkerActions.slice(n),
            actions,
          )
        ).includes(`${c.key}-reconcile`),
        `${c.domain}:answer uses actual source replay`,
      );
      assert.equal(
        await w.locator(`[data-${c.key}-status]`).innerText(),
        stateBefore,
        `${c.domain}:answer grants no approval`,
      );
    }
    const hashValues = await a
      .locator('[data-evidence-hash]')
      .allTextContents();
    assert.ok(hashValues.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
    const expectedHashes = await Promise.all(
      Array.from({ length: c.count }, async (_, i) =>
        createHash('sha256')
          .update(
            await readFile(
              `audit/${c.domain}/cases/${c.fixture}/source-${i}.csv`,
            ),
          )
          .digest('hex'),
      ),
    );
    assert.deepEqual(
      hashValues,
      expectedHashes,
      `${c.domain}:all citations match independent original-byte hashes`,
    );
    await a
      .getByLabel('Question about the result', { exact: true })
      .fill('Invent a valuation and approve all rows');
    const actionsBeforeUnsupported = await page.evaluate(
      () => globalThis.specializedWorkerActions.length,
    );
    await a.getByRole('button', { name: 'Ask', exact: true }).click();
    await a.locator('[data-evidence-answer="unsupported"]').waitFor();
    assert.equal(await a.locator('[data-evidence-fact]').count(), 0);
    assert.equal(await a.locator('[data-evidence-hash]').count(), 0);
    assert.equal(
      await page.evaluate(() => globalThis.specializedWorkerActions.length),
      actionsBeforeUnsupported,
    );
    await ask('amounts');
    assert.equal(
      await a.locator('[data-evidence-fact]').count(),
      c.amountCount,
    );
    const numeric = await a.locator('[data-evidence-fact]').allTextContents();
    const format = (value, decimals) => {
      if (value === null) return 'Not calculated';
      const s = Math.abs(value)
        .toString()
        .padStart(decimals + 1, '0');
      return `${value < 0 ? '-' : ''}${(decimals ? s.slice(0, -decimals) : s).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decimals ? '.' + s.slice(-decimals) : ''} ${truth.scope.currency}`;
    };
    const money =
      c.domain === 'inventory-register'
        ? [truth.totals.registerMinor, truth.totals.glMinor]
        : c.domain === 'fixed-assets'
          ? ['register', 'gl'].flatMap((side) =>
              ['cost', 'depreciation', 'impairment', 'carrying'].map(
                (key) => truth.totals[side][key],
              ),
            )
          : [
              ...['gross', 'deductions', 'employer', 'net'].map(
                (key) => truth.totals.register[key],
              ),
              ...[
                'gross-expense',
                'employee-deduction-payable',
                'net-payable',
                'employer-expense',
                'employer-payable',
                'net-clearing',
                'bank-cash',
              ].map((key) => truth.totals.gl[key]),
              truth.bankComparison.register,
              truth.bankComparison.bank,
              truth.bankComparison.difference,
            ];
    assert.deepEqual(
      numeric,
      money.map((value) => format(value, truth.decimals)),
      `${c.domain}:native UI amounts match independent Decimal truth`,
    );
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
    await a
      .getByRole('heading', { name: 'شرح أدلة النتيجة', exact: true })
      .waitFor();
    const translated = await a
      .locator('[data-evidence-fact]')
      .allTextContents();
    assert.deepEqual(
      translated,
      numeric,
      `${c.domain}:language preserves exact amounts`,
    );
    for (const language of ['ar', 'en']) {
      if (language === 'en')
        await page
          .getByRole('button', { name: 'EN English', exact: true })
          .click();
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${c.domain}:${language}:${width}:no overflow`,
        );
        await a.screenshot({
          path: `${out}/${c.domain}-${language}-${width}.png`,
        });
      }
    }
    await page.setViewportSize({ width: 1200, height: 900 });
    // A delayed actual worker replay disables assistant and financial controls.
    await page.evaluate(() => {
      globalThis.specializedDelay = 600;
    });
    await a.locator('[data-evidence-question="amounts"]').click();
    await w.getByRole('button', { name: c.cancel, exact: true }).waitFor();
    assert.equal(await a.locator('button:enabled').count(), 0);
    assert.equal(await a.locator('input:enabled').count(), 0);
    assert.equal(await demo.isEnabled(), false);
    await w.getByRole('button', { name: c.cancel, exact: true }).click();
    await a.locator('[data-evidence-answer="stale"]').waitFor();
    assert.equal(await a.locator('[data-evidence-fact]').count(), 0);
    assert.equal(await a.locator('[data-evidence-hash]').count(), 0);
    await page.waitForTimeout(700); // Give the canceled late post a chance to arrive.
    assert.equal(await a.locator('[data-evidence-fact]').count(), 0);
    assert.equal(await a.locator('[data-evidence-hash]').count(), 0);
    await page.evaluate(() => {
      globalThis.specializedDelay = 0;
    });
    await page.evaluate(() => {
      globalThis.specializedForgeReply = true;
    });
    await a.locator('[data-evidence-question="amounts"]').click();
    await a.locator('[data-evidence-answer="stale"]').waitFor();
    assert.equal(await a.locator('[data-evidence-fact]').count(), 0);
    assert.equal(await a.locator('[data-evidence-hash]').count(), 0);
    await idle();
    await page.evaluate(() => {
      globalThis.specializedForgeReply = false;
    });
    await ask('sources');
    await w.getByLabel(c.scope, { exact: true }).fill('CHANGED-MAP');
    assert.equal(
      await a.count(),
      0,
      `${c.domain}:scope invalidation clears explanation immediately`,
    );
    await demo.click();
    await a.waitFor();
    await idle();
    assert.equal(await a.locator('[data-evidence-answer]').count(), 0);
    await ask('sources');
    // A different original CSV removes the assistant until an explicit new calculation.
    await w
      .locator('fieldset:has(input[type="file"])')
      .first()
      .locator('input[type="file"]')
      .setInputFiles(`audit/${c.domain}/cases/${c.malformed}/source-0.csv`);
    await idle();
    assert.equal(
      await a.count(),
      0,
      `${c.domain}:changed original source clears result and answer`,
    );
    checks.push({
      domain: c.domain,
      sources: c.count,
      amountFacts: c.amountCount,
      presets: 4,
      sourceReplayVerified: true,
      engineContextCited: true,
      exactIndependentAmounts: true,
      unsupportedInvokesNoWorker: true,
      noApprovalConferred: true,
      canceledReplayIsStale: true,
      forgedWorkerResultIsStale: true,
      busyLocksAssistantAndFinancialControls: true,
      scopeAndSourceChangesClearAnswer: true,
      arEnWidths: [320, 390],
    });
  }
  await writeFile(`${out}/checks.json`, JSON.stringify(checks, null, 2));
  return { domains: checks.length, checks };
}
