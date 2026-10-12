/** Expose legacy fixture controls through the same disclosures users operate. */
export function workspaceSource(panel, label) {
  return panel.locator('.workspace-source').filter({
    has: panel.page().getByLabel(label, { exact: true }),
  });
}

export async function openWorkspaceDisclosures(
  panel,
  { advanced = true, requiredSources = true } = {},
) {
  const selector = [
    advanced && 'details[data-workspace-advanced]',
    requiredSources && 'details[data-workspace-required-sources]',
  ]
    .filter(Boolean)
    .join(', ');
  if (!selector) return;
  // Opening an outer disclosure can expose a nested fixture control. Only
  // real visible summaries are clicked; hidden scopes remain product-owned.
  for (let pass = 0; pass < 3; pass++) {
    let opened = false;
    for (const disclosure of await panel.locator(selector).all()) {
      if (
        (await disclosure.getAttribute('data-workspace-advanced')) !== null &&
        !(await disclosure.locator('input, select, textarea, button').count())
      )
        continue;
      if (
        (await disclosure.isVisible()) &&
        (await disclosure.getAttribute('open')) === null
      ) {
        await disclosure.locator(':scope > summary').click();
        opened = true;
      }
    }
    if (!opened) break;
  }
}

export async function openDomainWorkspace(
  page,
  domain,
  { advanced = true, requiredSources = true, balanceFlow = false } = {},
) {
  const selector = page.locator(
    'select[data-reconciliation-type-select]:visible',
  );
  await selector.waitFor({ state: 'visible' });
  await page.waitForFunction(
    (element) => !element.disabled,
    await selector.elementHandle(),
  );
  await selector.selectOption(domain);
  const panel = page.locator(`[data-domain-panel="${domain}"]:visible`);
  await panel.waitFor({ state: 'visible' });
  await panel.locator('h1, h2').first().waitFor({ state: 'visible' });
  if (balanceFlow) {
    const flow = panel.locator('details[data-bank-balance-flow]');
    await flow.waitFor({ state: 'visible' });
    if ((await flow.getAttribute('open')) === null)
      await flow.locator(':scope > summary').click();
  }
  await openWorkspaceDisclosures(panel, { advanced, requiredSources });
  return panel;
}
