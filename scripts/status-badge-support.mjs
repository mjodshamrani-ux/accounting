// The status badge in the review sections (UX-3): every status row of a
// section shows one badge; the badge carries the row's own engine status,
// as the row's data hook writes it; and it takes the agreed tone only for a
// status on the list each section's check writes itself, not taken from the
// product. The word is drawn, the icon is hidden from assistive technology,
// and the tone keeps a contrast of at least 4.5:1. Each table is counted, so
// a row selector that matches nothing fails at the end instead of passing.
import assert from 'node:assert/strict';

const TONES = [
  'agreed',
  'suggestion',
  'review',
  'difference',
  'held',
  'neutral',
];
const seen = new Map();

/** Reads the shown status rows of `tables` inside `root` (a locator) and
 * asserts on their badges. Each table is { name, rows, attr, at, column,
 * agreed }: the row selector, the data attribute holding the row's engine
 * status (or a JSON array holding it at index `at`), the column the check
 * expects the status in, counted from 0, and the statuses that are
 * agreed. */
export async function assertStatusBadges(root, tables, label) {
  const read = await root.evaluate(
    (element, specs) => {
      const rgb = (colour) => colour.match(/[\d.]+/gu).map(Number);
      const light = (colour) => {
        const [r, g, b] = rgb(colour)
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return specs.map(({ rows, attr, at }) =>
        [...element.querySelectorAll(rows)]
          .filter((row) => row.checkVisibility())
          .map((row) => {
            const hook = row.getAttribute(attr);
            const own = at === undefined ? hook : JSON.parse(hook)[at];
            const found = row.querySelectorAll('.status-badge');
            const badge = found[0];
            if (!badge) return { own, count: 0 };
            const style = getComputedStyle(badge),
              icon = badge.querySelector(':scope > svg'),
              back =
                rgb(style.backgroundColor)[3] === 0
                  ? 1
                  : light(style.backgroundColor),
              fore = light(style.color);
            return {
              own,
              count: found.length,
              tone: badge.dataset.tone ?? '',
              status: badge.dataset.status ?? '',
              cell: badge.closest('td, th')?.cellIndex,
              // The word as drawn: a word hidden inside a shown badge reads
              // empty.
              word: badge.innerText.trim(),
              icon:
                icon?.getAttribute('aria-hidden') === 'true' &&
                !icon.textContent,
              contrast:
                (Math.max(back, fore) + 0.05) / (Math.min(back, fore) + 0.05),
            };
          }),
      );
    },
    tables.map(({ rows, attr, at }) => ({ rows, attr, at })),
  );
  read.forEach((rows, k) => {
    const table = tables[k];
    const key = `${label}/${table.name}`;
    seen.set(key, (seen.get(key) ?? 0) + rows.length);
    for (const row of rows) {
      const at = `${key}: ${row.word || row.own}`;
      assert.equal(row.count, 1, `${at}: every status row shows one badge`);
      assert.ok(TONES.includes(row.tone), `${at}: a badge tone (${row.tone})`);
      assert.ok(row.word, `${at}: the word is shown`);
      assert.ok(
        row.icon,
        `${at}: the icon is hidden from assistive technology`,
      );
      assert.ok(
        row.contrast >= 4.5,
        `${at}: contrast ${row.contrast.toFixed(2)} of at least 4.5:1`,
      );
      assert.equal(
        row.status,
        row.own,
        `${at}: the badge carries the row's status`,
      );
      assert.equal(
        row.cell,
        table.column,
        `${at}: the badge is in the status column`,
      );
      assert.equal(
        row.tone === 'agreed',
        table.agreed.includes(row.own),
        `${at}: only an agreed status (not ${row.own}) takes the agreed tone`,
      );
    }
  });
}

/** Asserts that every table of `label` had status rows read, and returns
 * how many were read. */
export function statusBadgesRead(label, names) {
  let total = 0;
  for (const name of names) {
    const n = seen.get(`${label}/${name}`) ?? 0;
    assert.ok(n > 0, `${label}/${name}: status badges read`);
    total += n;
  }
  return total;
}
