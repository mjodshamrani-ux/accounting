import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
export async function verifyDomainAssistant(
  page,
  url,
  out = 'work/domain-assistant/browser',
) {
  await mkdir(out, { recursive: true });
  const cases = [
    [
      'clearing',
      'Single-account clearing',
      'Open synthetic clearing example',
      1,
    ],
    ['ar', 'Customer AR reconciliation', 'Open synthetic AR example', 2],
    ['gl-tb', 'GL / Trial balance', 'Open synthetic GL/TB example', 2],
    [
      'allocation',
      'Payment allocation',
      'Open synthetic allocation example',
      3,
    ],
    ['bank', 'Bank movements', 'Open synthetic bank movement example', 2],
    [
      'bank-adjustment',
      'Bank movements',
      'Open a synthetic balance reconciliation example',
      6,
    ],
    [
      'financial',
      'Trial balance and financial position',
      'Synthetic example',
      4,
    ],
    [
      'intercompany',
      'Intercompany transaction evidence',
      'Open a synthetic intercompany example',
      4,
    ],
    [
      'gateway',
      'Payment gateway batch evidence',
      'Open a synthetic gateway example',
      4,
    ],
  ];
  const checks = [];
  for (const [domain, entry, demo, count] of cases) {
    console.log('Evidence assistant browser domain:', domain);
    await page.goto(url);
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    await page.getByRole('button', { name: entry, exact: true }).click();
    const w =
      domain === 'bank-adjustment'
        ? page.getByTestId('bank-balance-workspace')
        : page;
    await w.getByRole('button', { name: demo, exact: true }).click();
    if (domain === 'clearing') {
      const compare = w.getByRole('button', {
        name: 'Check clearing',
        exact: true,
      });
      await page.waitForFunction(
        (el) => !el.disabled,
        await compare.elementHandle(),
      );
      await compare.click();
    }
    const assistant =
      domain === 'bank'
        ? page.locator('[data-domain-evidence-assistant]').first()
        : w.locator('[data-domain-evidence-assistant]');
    await assistant.waitFor();
    for (const k of ['status', 'amounts', 'sources', 'next']) {
      const b = assistant.locator(`[data-evidence-question="${k}"]`);
      await b.waitFor({ state: 'visible' });
      await page.waitForFunction((el) => !el.disabled, await b.elementHandle());
      await b.click();
      await assistant.locator(`[data-evidence-answer="${k}"]`).waitFor();
      assert.equal(
        await assistant.locator('[data-evidence-hash]').count(),
        count,
        domain + ':complete source provenance',
      );
    }
    await assistant
      .getByLabel('Question about the result', { exact: true })
      .fill('Invent a fee to make the net match');
    await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
    await assistant.locator('[data-evidence-answer="unsupported"]').waitFor();
    assert.equal(await assistant.locator('[data-evidence-fact]').count(), 0);
    await assistant.locator('[data-evidence-question="amounts"]').click();
    const numeric = await assistant
      .locator('[data-evidence-fact]')
      .allTextContents();
    await page.getByRole('button', { name: 'AR العربية', exact: true }).click();
    await assistant
      .getByRole('heading', { name: 'شرح أدلة النتيجة', exact: true })
      .waitFor();
    const translated = await assistant
      .locator('[data-evidence-fact]')
      .allTextContents();
    assert.deepEqual(
      translated.map((x) => x.match(/-?[0-9][0-9,.]*/g)),
      numeric.map((x) => x.match(/-?[0-9][0-9,.]*/g)),
      domain + ':language preserves amounts',
    );
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        domain + ':AR overflow',
      );
      if (domain === 'gateway')
        await page.screenshot({
          path: `${out}/gateway-ar-${width}.png`,
          fullPage: true,
        });
    }
    await page.getByRole('button', { name: 'EN English', exact: true }).click();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        domain + ':EN overflow',
      );
      if (domain === 'gateway')
        await page.screenshot({
          path: `${out}/gateway-en-${width}.png`,
          fullPage: true,
        });
    }
    checks.push({
      domain,
      sources: count,
      presets: 4,
      unsupportedCreatesNoFacts: true,
      languageAmountsPreserved: true,
      mobileWidths: [320, 390],
    });
  }
  // A real source/scope change removes the prior explanation immediately.
  await page
    .getByLabel('Gateway scope Policy version', { exact: true })
    .fill('Changed policy');
  assert.equal(
    await page.locator('[data-domain-evidence-assistant]').count(),
    0,
  );
  await page
    .getByRole('button', {
      name: 'Open a synthetic gateway example',
      exact: true,
    })
    .click();
  await page.locator('[data-domain-evidence-assistant]').waitFor();
  assert.equal(await page.locator('[data-evidence-answer]').count(), 0);
  await writeFile(`${out}/checks.json`, JSON.stringify(checks, null, 2));
  return { domains: checks.length, checks, scopeChangeClearsAnswer: true };
}
