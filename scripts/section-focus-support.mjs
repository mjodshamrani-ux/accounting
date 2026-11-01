// The result is present in a review section (UX-3, as UX-2 for a workspace):
// after the section's own run, the focus is on the heading of its result, a
// result or a refusal, in view below the top bar, and the heading names the
// section. A run that ends in a failure shows no result and is not read. Each
// check is counted, so a section whose runs never show the heading fails at
// the end instead of passing unread.
import assert from 'node:assert/strict';

const seen = new Map();

/** After a run of the section inside `root` (a locator), asserts where the
 * focus is when the section shows a result heading. */
export async function assertSectionFocus(page, root, label) {
  const section = await root.elementHandle();
  await page
    .waitForFunction(
      (el) => {
        const heading = el.querySelector('[data-result-heading="section"]');
        return !heading || document.activeElement === heading;
      },
      section,
      { timeout: 30000 },
    )
    .catch(() => undefined);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const where = await section.evaluate((el) => {
    const heading = el.querySelector('[data-result-heading="section"]');
    const active = document.activeElement;
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    const box = heading?.getBoundingClientRect();
    return {
      heading: !!heading,
      onHeading: !!heading && active === heading,
      active: active
        ? `${active.tagName} ${(active.textContent ?? '').trim().slice(0, 40)}`
        : null,
      inView: !!(
        box &&
        box.top >= (bar ? bar.bottom : 0) - 1 &&
        box.bottom <= innerHeight + 1
      ),
      text: (heading?.textContent ?? '').trim(),
      // The section's own title, not one of a disclosure inside it: the
      // summary of its own disclosure, the name of its region, its own
      // heading, or the summary of the disclosure that holds it.
      title: (
        (el.matches('details')
          ? el.querySelector(':scope > summary')?.textContent
          : null) ??
        el.getAttribute('aria-label') ??
        el.querySelector(':scope > h2')?.textContent ??
        el.closest('details')?.querySelector(':scope > summary')?.textContent ??
        ''
      ).trim(),
    };
  });
  if (!where.heading) return;
  assert.ok(
    where.onHeading,
    `${label}: after the section's run the focus is on its result heading (${where.active})`,
  );
  assert.ok(where.inView, `${label}: the result heading is in view`);
  assert.ok(
    where.title && where.text.includes(where.title),
    `${label}: the result heading names the section (${where.text})`,
  );
  seen.set(label, (seen.get(label) ?? 0) + 1);
}

/** Asserts that the section's result heading took the focus at least once,
 * and returns how many times. */
export function sectionFocusRead(label) {
  const n = seen.get(label) ?? 0;
  assert.ok(n > 0, `${label}: the result heading took the focus`);
  return n;
}
