export async function revealDomainEntry(page, domain) {
  const entry = page.locator(`[data-domain-entry="${domain}"]`);
  if (!(await entry.isVisible()))
    await page.locator('.directory-switch:visible').click();
  await entry.waitFor({ state: 'visible' });
}
