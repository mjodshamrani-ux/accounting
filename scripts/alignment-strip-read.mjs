// What the alignment strip says, for browser checks that read a figure the
// older figure grids of the supplier, receivables and clearing results used
// to repeat (UX-4): the count in one of its cells, each record's total as it
// is drawn, and the gap's amount as it is drawn. `scope` is a Playwright
// locator (or page) that holds exactly one strip. The drawn strip is hidden
// from assistive technology, not from the page, so a locator reaches it.
export const alignmentStrip = (scope) =>
  scope.locator('[data-alignment-strip]');

/** The count the engine gave a cell: "agreed" or "review". */
export const stripCount = (scope, cell) =>
  alignmentStrip(scope)
    .locator(`[data-strip-cell="${cell}"]`)
    .getAttribute('data-count');

/** Each record's total as the strip draws it, in the order of its ends. */
export const stripTotals = (scope) =>
  alignmentStrip(scope).locator('[data-strip-total]').allTextContents();

/** The gap's amount as drawn, or the kind of gap where none is drawn. */
export const stripGap = (scope) =>
  alignmentStrip(scope)
    .locator('[data-strip-cell="gap"]')
    .evaluate(
      (cell) =>
        cell.querySelector('[data-amount-minor]')?.textContent ??
        cell.dataset.kind,
    );
