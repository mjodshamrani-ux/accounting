// What the decision platform checks share (UX-3): whether every closed
// button the reader sees says what opens it, and where the focus settles
// after a decision.
import assert from 'node:assert/strict';

// Two frames and a moment, so a focus moved after a render has landed.
export const pause = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 150)),
        ),
      ),
  );

// Every closed button the reader sees in the region says what opens it: a
// sentence it is described by, shown and not empty. Returns how many closed
// buttons were seen.
export async function closedSay(region, at) {
  const closed = await region.evaluate((root) => {
    const shown = (el) => {
      const box = el?.getBoundingClientRect();
      return !!box && box.width > 0 && box.height > 0;
    };
    return [...root.querySelectorAll('button')]
      .filter((b) => b.disabled && shown(b))
      .map((b) => ({
        name: b.textContent.trim(),
        said: (b.getAttribute('aria-describedby') ?? '')
          .split(/\s+/u)
          .map((id) => id && document.getElementById(id))
          .some((el) => el && shown(el) && el.textContent.trim()),
      }));
  });
  for (const b of closed)
    assert.ok(b.said, `${at}: the closed «${b.name}» says what opens it`);
  return closed.length;
}

// Where the focus is, whether it is on what a decision changed (a state
// line or an item), and whether it is in view.
export const focused = (page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    const box = active.getBoundingClientRect();
    return {
      id: active.id,
      tag: active.tagName,
      item:
        active.hasAttribute('data-decision-item') ||
        active.hasAttribute('data-decision-state'),
      text: active.textContent.trim(),
      inView: box.bottom > 0 && box.top < innerHeight,
    };
  });

// After a decision, the focus settles on the element the test names, which
// states what changed, and that element comes into view: without reduced
// motion the page scrolls to it smoothly, so it is awaited a while.
export async function settledOn(page, element, at) {
  await pause(page);
  // Awaited a little, then asserted, so a build without it fails by
  // assertion, not by a long wait.
  await element
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => {});
  assert.equal(
    await element.count(),
    1,
    `${at}: what the decision changed is shown`,
  );
  const want = await element.evaluate((el) => el.id);
  assert.ok(want, `${at}: what the decision changed has an id`);
  let now = await focused(page);
  for (
    const end = Date.now() + 5000;
    now.id === want && !now.inView && Date.now() < end;
    now = await focused(page)
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(now.id, want, `${at}: the focus is on what changed`);
  assert.ok(now.item, `${at}: and it states the change`);
  assert.ok(now.inView, `${at}: and it is in view`);
}

// A reason shown in the region for a closed button, matching the pattern:
// read at once, so a reason that is not shown fails by assertion, not by a
// wait.
export async function shownReason(region, pattern, at) {
  const texts = await region
    .locator('[data-closed-reason]:not([hidden])')
    .allInnerTexts();
  assert.ok(
    texts.some((text) => pattern.test(text)),
    `${at}: a shown reason says ${pattern} (${texts.join(' | ')})`,
  );
}
