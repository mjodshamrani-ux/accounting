import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

/**
 * UX-6: the reconciliation sheet of a downloaded workpaper says what the
 * screen says. Read here with ExcelJS, apart from the code that wrote it, and
 * compared with the strip and the table as the page draws them: each strip
 * cell's label, value and notes, and each row of the named table. Numbers on
 * the screen are compared as numbers, so grouping marks and the direction
 * marks that isolate them do not count.
 */
const NAMES = { ar: 'ورقة التسوية', en: 'Reconciliation sheet' };

/** A number as the screen writes it: digits, one point, a sign. */
const screenNumber = (text) => {
  const plain = text
    .replace(/[\u200e\u200f\u2066-\u2069\u061c]/gu, '')
    .replace(/\u2212/gu, '-')
    .replace(/,/gu, '')
    .trim();
  return /^-?\d+(\.\d+)?$/u.test(plain) ? Number(plain) : null;
};
const cellValue = (cell) => {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'richText' in v)
    return v.richText.map((r) => r.text).join('');
  return v;
};
const same = (screen, sheet, what) => {
  const n = screenNumber(screen);
  if (typeof sheet === 'number')
    assert.equal(
      n,
      sheet,
      `${what}: «${screen}» on the screen, ${sheet} in the sheet`,
    );
  else assert.equal(screen, sheet, what);
};

/** The first sheet of a download as rows of four cells, after its place,
 * its name and its direction are checked; `summary` is the evidence's first
 * sheet as that workbook names it. */
export async function readSheet(file, lang, summary = 'Summary') {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.worksheets[0];
  assert.equal(
    sheet.name,
    NAMES[lang],
    'the sheet is first, named in the interface language',
  );
  assert.equal(book.worksheets[1].name, summary, 'the evidence follows it');
  assert.equal(
    Boolean(sheet.views?.[0]?.rightToLeft),
    lang === 'ar',
    'an Arabic sheet reads right to left',
  );
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    rows[n - 1] = [1, 2, 3, 4].map((c) => cellValue(row.getCell(c)));
  });
  return Array.from(rows, (r) => r ?? [null, null, null, null]);
}

export async function sheetSaysScreen(page, { file, lang, result, table }) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  await tableSaysScreen(grid, table);
  return { rows: grid.length };
}

/** The strip: each cell's label, value and notes as the page draws them. */
export async function stripSaysScreen(grid, result) {
  const strip = result.locator('[data-alignment-strip]');
  for (const name of ['agreed', 'review', 'gap']) {
    const cell = strip.locator(`[data-strip-cell="${name}"]`);
    const label = (
      await cell.locator('.alignment-strip__label').innerText()
    ).trim();
    const value = (
      await cell.locator('.alignment-strip__value').innerText()
    ).trim();
    const notes = cell.locator('.alignment-strip__note');
    const note = (await notes.count()) ? (await notes.innerText()).trim() : '';
    const at = grid.findIndex((r) => r[0] === label);
    assert.ok(at >= 0, `${name}: the sheet has a row «${label}»`);
    const [, b, c, d] = grid[at];
    if (c !== null) {
      // «4 من 6»: a count, a word and a count, each in its own cell.
      assert.equal(value, `${b} ${c} ${d}`, `${name}: value`);
    } else same(value, b, `${name}: value`);
    const said = [];
    for (
      let i = at + 1;
      i < grid.length && grid[i][0] === null && grid[i][1] !== null;
      i++
    )
      said.push(
        grid[i][2] === null ? `${grid[i][1]}` : `${grid[i][1]}: ${grid[i][2]}`,
      );
    assert.equal(said.join(' · '), note, `${name}: notes`);
  }
}

/** A table the sheet repeats whole: its head, then each row as drawn. The
 * way to a row's evidence (UX-10) is the page's and not the sheet's: where
 * the page draws it first, each row must have it, and it is set aside. */
export async function tableSaysScreen(grid, table) {
  let head = (await table.locator('thead th').allInnerTexts()).map((h) =>
    h.trim(),
  );
  const ways = Object.values(THREAD_WAY),
    way = ways.includes(head[0]);
  if (way) head = head.slice(1);
  const top = grid.findIndex((r) => r[0] === head[0].trim());
  assert.ok(top >= 0, `the sheet has the table «${head[0]}»`);
  assert.deepEqual(
    grid[top].slice(0, head.length),
    head.map((h) => h.trim()),
    'the table head',
  );
  const body = table.locator('tbody tr');
  const count = await body.count();
  for (let i = 0; i < count; i++) {
    let cells = (await body.nth(i).locator('th, td').allInnerTexts()).map(
      (t) => t.trim(),
    );
    if (way) {
      assert.ok(
        ways.some((w) => cells[0].startsWith(w)),
        `table row ${i + 1}: the way to its evidence`,
      );
      cells = cells.slice(1);
    }
    cells.forEach((text, j) =>
      same(text, grid[top + 1 + i][j], `table row ${i + 1} cell ${j + 1}`),
    );
  }
}

/**
 * UX-6(b), clearing: the groups the page shows as waiting for review, in its
 * order, are the sheet's review table: members, reference, net and the reason
 * the page writes under the basis; and the sheet's decisions are those the
 * run recorded, each with the reviewer's reason. The words for each heading
 * come from the page's own table head. Each case opens with the way to its
 * source rows (UX-10), which the sheet has not: it is required, then set
 * aside.
 */
export async function clearingSheetSaysScreen(
  page,
  { file, lang, result, decisions },
) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  const table = result.locator('table').filter({
    has: page.locator('[data-testid="clearing-case"]'),
  });
  const drawn = (await table.locator('thead th').allInnerTexts()).map((h) =>
    h.trim(),
  );
  assert.equal(drawn[0], THREAD_WAY[lang], 'the way to the source rows');
  const head = drawn.slice(1);
  const waiting = table
    .locator('[data-testid="clearing-case"]')
    .filter({ has: page.locator('[data-status="review"]') });
  const count = await waiting.count();
  const top = grid.findIndex((r) => r[0] === head[0]);
  if (!count) {
    assert.equal(top, -1, 'no group waits, so no review table');
  } else {
    assert.ok(top >= 0, `the sheet has the table «${head[0]}»`);
    assert.deepEqual(
      grid[top],
      [head[0], head[1], head[2], head[4]],
      'the review table head: members, reference, net, the basis column',
    );
    for (let i = 0; i < count; i++) {
      const cells = waiting.nth(i).locator('th, td');
      const [way, members, reference, net] = (await cells.allInnerTexts()).map(
        (t) => t.trim(),
      );
      assert.ok(way.startsWith(THREAD_WAY[lang]), `review row ${i + 1}: ${way}`);
      const reason = (await cells.nth(5).locator('.muted').innerText()).trim();
      const row = grid[top + 1 + i];
      assert.equal(row[0], members, `review row ${i + 1}: members`);
      assert.equal(row[1], reference, `review row ${i + 1}: reference`);
      same(net, row[2], `review row ${i + 1}: net`);
      assert.equal(row[3], reason, `review row ${i + 1}: reason`);
    }
    assert.ok(
      grid[top + 1 + count].every((c) => c === null),
      'the review table holds the waiting groups and no more',
    );
  }
  const at = grid.findIndex((r) => r[0] === decisions.head);
  if (!decisions.rows.length) assert.equal(at, -1, 'no decision, no table');
  else {
    assert.ok(at >= 0, `the sheet has the decisions «${decisions.head}»`);
    decisions.rows.forEach((d, i) =>
      assert.deepEqual(
        grid[at + 1 + i].slice(0, 3),
        d,
        `decision ${i + 1}: what it did, its members, the reason given`,
      ),
    );
    assert.ok(
      grid[at + 1 + decisions.rows.length].every((c) => c === null),
      'the recorded decisions and no more',
    );
  }
  return { rows: grid.length, waiting: count };
}

/** Section headings the receivables sheet writes, in the words the page
 * gives the same things (the badge's status word for what waits). */
const AR_HEADINGS = {
  ar: { alignment: 'التراصف', review: 'للمراجعة' },
  en: { alignment: 'Alignment', review: 'Needs review' },
};

/**
 * UX-6(b), receivables: the strip and each record's own total at its ends,
 * as the page draws them; each document the page shows as waiting for
 * review, in its order, with its type, number and reason, then each of its
 * movements with its record, amount and date; and the decisions the run
 * recorded, each with the reviewer's reason.
 */
export async function arSheetSaysScreen(
  page,
  { file, lang, result, decisions },
) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  // Each record's total, right under the alignment heading, in side order.
  const strip = grid.findIndex((r) => r[0] === AR_HEADINGS[lang].alignment);
  assert.ok(strip >= 0, 'the alignment section');
  for (const side of [0, 1]) {
    const paper = result.locator(
      `[data-alignment-strip] [data-strip-side="${side}"]`,
    );
    const name = (
      await paper.locator('.alignment-strip__role').innerText()
    ).trim();
    const total = (
      await paper.locator('[data-strip-total]').innerText()
    ).trim();
    const row = grid[strip + 1 + side];
    assert.equal(row[0], name, `side ${side}: the record's name`);
    same(total, row[1], `side ${side}: its total`);
  }
  // Each document the page shows waiting, as the sheet lists it.
  const waiting = page
    .getByTestId('ar-case')
    .filter({ has: page.locator('[data-status="review"]') });
  const count = await waiting.count();
  const section = grid.findIndex((r) => r[0] === AR_HEADINGS[lang].review);
  if (!count) assert.equal(section, -1, 'nothing waits, so no review section');
  else assert.ok(section >= 0, 'the review section');
  let at = section + 1;
  for (let i = 0; i < count; i++) {
    const c = waiting.nth(i);
    const [kind, document] = (await c.locator('h3').innerText())
      .trim()
      .split(/:\s+/u);
    const badge = (
      await c.locator('[data-status="review"]').innerText()
    ).trim();
    const reason = badge.split(' · ').slice(1).join(' · ').trim();
    assert.deepEqual(
      grid[at++].slice(0, 3),
      [kind, document, reason],
      `document ${i + 1}: its type, number and reason`,
    );
    for (const li of await c.locator('.ar-case-members > li').all()) {
      const row = grid[at++];
      const side = (
        await li.locator('.ar-member-heading span').first().innerText()
      ).trim();
      const amount = (await li.locator('.ar-member-amount').innerText()).trim();
      const date = (
        await li.locator('dl.ar-member-meta bdi').first().innerText()
      ).trim();
      assert.equal(row[0], null, `${document}: a movement under its document`);
      assert.equal(row[1], side, `${document}: the movement's record`);
      same(amount, row[2], `${document}: the movement's amount`);
      assert.equal(row[3], date, `${document}: the movement's date`);
    }
  }
  if (count)
    assert.ok(
      grid[at].every((c) => c === null),
      'the documents waiting and no more',
    );
  const head = grid.findIndex((r) => r[0] === decisions.head);
  if (!decisions.rows.length) assert.equal(head, -1, 'no decision, no table');
  else {
    assert.ok(head >= 0, `the sheet has the decisions «${decisions.head}»`);
    decisions.rows.forEach((d, i) =>
      assert.deepEqual(
        grid[head + 1 + i],
        d,
        `decision ${i + 1}: what it did, its document, the reason given`,
      ),
    );
    assert.ok(
      grid[head + 1 + decisions.rows.length].every((c) => c === null),
      'the recorded decisions and no more',
    );
  }
  return { rows: grid.length, waiting: count };
}

/** The words the bank sheet gives a decision: the words the page gives the
 * reason it leaves, by the decision type the page's table shows. */
const BANK_DECISIONS = {
  ar: { اعتماد: 'مراجعة بشرية موثقة', إلغاء: 'ألغيت؛ تحتاج مراجعة' },
  en: { Accept: 'Documented human review', Undo: 'Undone; requires review' },
};
/** The strip's word for the result's state, the alignment's last row. */
const RESULT_STATE = { ar: 'حالة النتيجة', en: 'Result status' };

/** The result's state under the strip, as the page's heading writes it,
 * and nothing after it in the alignment. */
async function stateSaysHeading(grid, heading, lang) {
  const said = (await heading.innerText()).trim();
  const at = grid.findIndex((r) => r[0] === RESULT_STATE[lang]);
  assert.ok(at >= 0, "the result's state");
  assert.deepEqual(
    grid[at].slice(0, 2),
    [RESULT_STATE[lang], said],
    "the result's state as the page's heading writes it",
  );
  assert.ok(
    (grid[at + 1] ?? [null]).every((c) => c === null),
    'the alignment and no more',
  );
}

/** The review section's heading: the status word the page writes. */
const BANK_HEADINGS = {
  ar: { review: 'تحتاج مراجعة', decision: 'القرار' },
  en: { review: 'Needs review', decision: 'Decision' },
};

/**
 * UX-6(b), bank movements: the strip as the page draws it; each case the
 * page shows waiting (needs review, or held by a source error), in its
 * order, with its kind, its settlement identity where it has one, its
 * reason and the bank minus cashbook difference, then each complete member
 * with its side, amount and own reference as the page's tables give them;
 * and each dated decision the page lists, with its members, its evidence
 * reference and the reviewer's reason. Tables are read by their text, so a
 * folded section reads as an open one.
 */
export async function bankSheetSaysScreen(page, { file, lang, result }) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  await stateSaysHeading(
    grid,
    page.locator('[data-testid="bank-result"]'),
    lang,
  );
  const section = (name) =>
    page.locator(`[data-bank-movement-table="${name}"]`);
  const cells = async (row) =>
    (await row.locator('th, td').allTextContents()).map((t) => t.trim());
  // Each movement's amount, by its side and own reference. The way to its
  // evidence opens the row (UX-10).
  const amounts = new Map();
  for (const row of await section('movements').locator('tbody tr').all()) {
    const c = await cells(row);
    amounts.set(`${c[1]}|${c[3]}`, c[11]);
  }
  const waiting = section('cases')
    .locator('tbody tr')
    .filter({
      has: page.locator(
        '[data-status="needs-review"], [data-status="source-error"]',
      ),
    });
  const count = await waiting.count();
  const top = grid.findIndex((r) => r[0] === BANK_HEADINGS[lang].review);
  if (!count) assert.equal(top, -1, 'nothing waits, so no review section');
  else assert.ok(top >= 0, 'the review section');
  let at = top + 1;
  for (let i = 0; i < count; i++) {
    const [identity, kind, , , , difference, members, , reason] = await cells(
      waiting.nth(i),
    );
    assert.deepEqual(
      grid[at++].slice(0, 3),
      [kind, identity === kind ? null : identity, reason],
      `case ${i + 1}: its kind, identity and reason`,
    );
    const gap = grid[at++];
    assert.equal(gap[0], null, `case ${i + 1}: its difference under it`);
    same(difference, gap[2], `case ${i + 1}: bank minus cashbook`);
    // «Bank statement: B1 · B2; Cashbook: L1», each side's members.
    const listed = members.split('; ').flatMap((part) => {
      const cut = part.indexOf(':');
      const side = part.slice(0, cut).trim();
      return part
        .slice(cut + 1)
        .split(' · ')
        .map((ref) => ref.trim())
        .filter(Boolean)
        .map((ref) => [side, ref]);
    });
    for (const [side, ref] of listed) {
      const row = grid[at++];
      assert.equal(row[0], null, `${ref}: a member under its case`);
      assert.equal(row[1], side, `${ref}: its side`);
      assert.equal(row[3], ref, `${ref}: its own reference`);
      const amount = amounts.get(`${side}|${ref}`);
      assert.ok(amount, `${ref}: the page lists the movement`);
      same(amount, row[2], `${ref}: its amount`);
    }
  }
  if (count)
    assert.ok(
      grid[at].every((c) => c === null),
      'the cases waiting and no more',
    );
  const events = await section('events').locator('tbody tr').all();
  const head = grid.findIndex((r) => r[0] === BANK_HEADINGS[lang].decision);
  if (!events.length) assert.equal(head, -1, 'no decision, no table');
  else {
    assert.ok(head >= 0, 'the recorded decisions');
    for (const [i, row] of events.entries()) {
      const [, type, , reference, note, members] = await cells(row);
      assert.deepEqual(
        grid[head + 1 + i],
        [BANK_DECISIONS[lang][type], members, reference, note],
        `decision ${i + 1}: what it did, its members, reference and reason`,
      );
    }
    assert.ok(
      grid[head + 1 + events.length].every((c) => c === null),
      'the recorded decisions and no more',
    );
  }
  return { rows: grid.length, waiting: count, decisions: events.length };
}

/** The sheet's words the allocation page does not write: the heading over
 * the recorded decisions, and an undo as the page names it. */
const ALLOCATION_WORDS = {
  ar: { decisions: 'القرارات المسجلة', undo: 'إلغاء' },
  en: { decisions: 'Recorded decisions', undo: 'undo' },
};

/**
 * UX-6(b), payment allocation: the strip as the page draws it; the value
 * ledger the page lists, each side under its name, every item by its own
 * reference with what is available, allocated and remaining; each active
 * allocation the page lists, with its basis, reference and reason, then the
 * payment and the invoice it joins with the amount; and each dated decision
 * the page lists, with its number, time and reason, an undo with the
 * decision it undoes. Each section holds what the page shows and no more.
 */
export async function allocationSheetSaysScreen(page, { file, lang, result }) {
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  const heading = (title, evidence) =>
    grid.findIndex((r) => r[0] === title && r[1] === null && r[3] === evidence);
  // The value ledger: the page's one table, its rows grouped by side.
  const ledger = result.getByTestId('allocation-ledger');
  const head = (await ledger.locator('thead th').allTextContents()).map((t) =>
    t.trim(),
  );
  const bySide = new Map();
  for (const row of await ledger.locator('tbody tr').all()) {
    const c = (await row.locator('th, td').allTextContents()).map((t) =>
      t.trim(),
    );
    if (!bySide.has(c[0])) bySide.set(c[0], []);
    bySide.get(c[0]).push(c);
  }
  if (!bySide.size)
    assert.equal(
      grid.findIndex((r) => r[3] === 'Value ledger'),
      -1,
      'no item, no value ledger',
    );
  for (const [side, items] of bySide) {
    const top = heading(side, 'Value ledger');
    assert.ok(top >= 0, `${side}: its value ledger`);
    assert.deepEqual(
      grid[top + 1],
      [head[1], head[3], head[4], head[5]],
      `${side}: the head`,
    );
    items.forEach((c, k) => {
      const row = grid[top + 2 + k];
      assert.equal(row[0], c[1], `${side} ${c[1]}: its own reference`);
      same(c[3], row[1], `${side} ${c[1]}: available`);
      same(c[4], row[2], `${side} ${c[1]}: allocated`);
      same(c[5], row[3], `${side} ${c[1]}: remaining`);
    });
    blankRow(top + 2 + items.length, `${side}: the items`);
  }
  // Active allocations: «P → I: amount · basis · reference · reason».
  const [title, lines] = await result
    .locator('[data-result-part="allocations"]')
    .evaluate((h) => {
      // The lines the page writes under the heading, up to its pager.
      const out = [];
      let line = h.nextElementSibling;
      while (line?.tagName === 'P') {
        out.push(line.textContent.trim());
        line = line.nextElementSibling;
      }
      return [h.textContent.trim(), out];
    });
  const links = heading(title, 'Active links');
  if (!lines.length) assert.equal(links, -1, 'nothing active, no table');
  else assert.ok(links >= 0, 'the active allocations');
  const sides = [...bySide.keys()];
  lines.forEach((text, k) => {
    const [first, basis, reference, reason] = text.split(' · ');
    const m = /^(.*) → (.*): (.*)$/u.exec(first);
    assert.ok(m, `allocation ${k + 1}: «${first}»`);
    const [, payment, invoice, amount] = m;
    const at = links + 1 + 3 * k;
    assert.deepEqual(
      grid[at].slice(0, 3),
      [basis, reference, reason],
      `allocation ${k + 1}: its basis, reference and reason`,
    );
    for (const [row, side, ref] of [
      [grid[at + 1], sides[0], payment],
      [grid[at + 2], sides[1], invoice],
    ]) {
      assert.equal(row[0], null, `${ref}: under its allocation`);
      assert.equal(row[1], side, `${ref}: its side`);
      assert.equal(row[3], ref, `${ref}: its own reference`);
      same(amount, row[2], `${ref}: the amount`);
    }
  });
  if (lines.length) blankRow(links + 1 + 3 * lines.length, 'the allocations');
  // Dated decisions: «id · type · time · reason», an undo «… → target».
  const events = await result
    .getByTestId('allocation-event')
    .locator('p')
    .allTextContents();
  const words = ALLOCATION_WORDS[lang];
  const taken = heading(words.decisions, 'Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else assert.ok(taken >= 0, 'the recorded decisions');
  events.forEach((text, k) => {
    const [id, type, at, ...rest] = text.trim().split(' · ');
    let note = rest.join(' · '),
      target = null;
    if (type === words.undo) {
      const m = /^(.*) → (\S+)$/u.exec(note);
      assert.ok(m, `decision ${id}: the decision it undoes`);
      [, note, target] = m;
    }
    const row = taken + 1 + 2 * k;
    assert.deepEqual(
      grid[row].slice(0, 3),
      [type, id, at],
      `decision ${id}: what it did, its number and time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, target === null ? null : `→ ${target}`, note],
      `decision ${id}: the reason given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return {
    rows: grid.length,
    items: [...bySide.values()].flat().length,
    links: lines.length,
    decisions: events.length,
  };
}

/** The supplier page's words the comparison steps by, and the sheet's
 * headings over what the page does not draw as a table of its own. */
const SUPPLIER_WORDS = {
  ar: {
    back: 'عُد إلى المراجعة',
    forward: 'أعدّ ورقة العمل',
    unmatched: 'دون مقابل',
    review: /^يحتاج مراجعة \(\d+\)$/u,
    reviewHeading: 'يحتاج مراجعة',
    decisions: 'القرارات المسجلة',
    decided: {
      link: 'تأكيد يدوي',
      unlink: 'اقتراح مرفوض',
      review: 'تمت مراجعته وما زال غير مطابق',
    },
  },
  en: {
    back: 'Back to review',
    forward: 'Prepare the workpaper',
    unmatched: 'Unmatched',
    review: /^Needs Review \(\d+\)$/u,
    reviewHeading: 'Needs Review',
    decisions: 'Recorded decisions',
    decided: {
      link: 'Manual confirmation',
      unlink: 'Rejected suggestion',
      review: 'Reviewed, still unmatched',
    },
  },
};

/**
 * UX-6(b), suppliers: on the workpaper step, the strip and every balance
 * line as the page draws them; back on the review step, each case the
 * review tab lists, in its order, with its state as the table writes it, its
 * first member's side and reference, and as many members as the row counts,
 * and each case the unmatched tab lists with its date, side, amount and
 * reference; then the decisions the run recorded, each in the word the
 * screen gives the state it leaves, with the reason the reviewer typed. The
 * page is left on the workpaper step, as it was. Each section holds what
 * the page shows and no more.
 */
export async function supplierSheetSaysScreen(
  page,
  { file, lang, result, decisions },
) {
  const w = SUPPLIER_WORDS[lang];
  const grid = await readSheet(file, lang);
  await stripSaysScreen(grid, result);
  const ends = (at, what) =>
    assert.ok(
      at >= grid.length || grid[at].every((c) => c === null),
      `${what} and no more`,
    );
  // The balances, where the workpaper step writes them.
  const lines = page.locator('.balance-lines > div');
  const heading = (
    await page
      .locator('.surface')
      .filter({ has: lines.first() })
      .locator('h2')
      .first()
      .innerText()
      .catch(() => '')
  ).trim();
  const balances = heading ? grid.findIndex((r) => r[0] === heading) : -1;
  if (!(await lines.count()))
    assert.ok(
      !heading || balances === -1,
      'no balances on the page, none in the sheet',
    );
  else {
    assert.ok(balances >= 0, 'the balances section');
    const count = await lines.count();
    for (let i = 0; i < count; i++) {
      const [label, said] = (
        await lines.nth(i).locator('span, bdi').allInnerTexts()
      ).map((t) => t.trim());
      assert.equal(grid[balances + 1 + i][0], label, `balance line ${i + 1}`);
      same(said, grid[balances + 1 + i][1], `balance ${label}`);
    }
    ends(balances + 1 + count, 'the balance lines');
  }
  // Back to the review step, where the tabs list the cases.
  await page.getByRole('button', { name: w.back, exact: true }).click();
  const rowsOf = async () => {
    const body = page.locator('.results-frame table tbody tr');
    await page.locator('.results-frame table').waitFor();
    const out = [];
    for (const row of await body.all()) {
      // The first cell is the way to the row's evidence (UX-10), which the
      // sheet does not have.
      const cell = row.locator('td');
      assert.ok(
        (await cell.nth(0).innerText()).startsWith(THREAD_WAY[lang]),
        'a case row opens with the way to its evidence',
      );
      out.push({
        side: (await cell.nth(1).innerText()).split('·')[0].trim(),
        date: (await cell.nth(2).innerText()).trim(),
        reference: (await cell.nth(3).locator('bdi').innerText()).trim(),
        amount: (await cell.nth(4).innerText()).split('\n')[0].trim(),
        members: (await cell.nth(4).locator('.muted').innerText())
          .match(/(\d+):(\d+)/u)
          .slice(1, 3)
          .reduce((a, b) => a + Number(b), 0),
        state: (await cell.nth(5).innerText()).trim(),
      });
    }
    return out;
  };
  await page.getByRole('tab', { name: w.review }).click();
  const waiting = await rowsOf();
  const top = grid.findIndex((r) => r[0] === w.reviewHeading && r[1] === null);
  if (!waiting.length) assert.equal(top, -1, 'nothing waits, no section');
  else assert.ok(top >= 0, 'the review section');
  let at = top + 1;
  for (const [i, c] of waiting.entries()) {
    assert.deepEqual(
      [grid[at][0], grid[at][1], grid[at][3]],
      [c.state, c.side, c.reference],
      `review case ${i + 1}: its state, first member's side and reference`,
    );
    at++;
    for (let k = 1; k < c.members; k++, at++)
      assert.ok(
        grid[at][0] === null && grid[at][1] !== null,
        `review case ${i + 1}: member ${k + 1} under it`,
      );
  }
  if (waiting.length) ends(at, 'the review cases');
  await page.getByRole('tab', { name: w.unmatched, exact: true }).click();
  const alone = await rowsOf();
  const first = grid.findIndex((r) => r[0] === w.unmatched && r[1] === null);
  if (!alone.length) assert.equal(first, -1, 'nothing unmatched, no section');
  else assert.ok(first >= 0, 'the unmatched section');
  for (const [i, c] of alone.entries()) {
    const row = grid[first + 1 + i];
    assert.deepEqual(
      [row[0], row[1], row[3]],
      [c.date, c.side, c.reference],
      `unmatched case ${i + 1}: its date, side and reference`,
    );
    same(c.amount, row[2], `unmatched case ${i + 1}: its amount`);
  }
  if (alone.length) ends(first + 1 + alone.length, 'the unmatched cases');
  // The decisions the run recorded, each with the reason typed.
  const head = grid.findIndex((r) => r[0] === w.decisions && r[1] === null);
  if (!decisions.length) assert.equal(head, -1, 'no decision, no table');
  else {
    assert.ok(head >= 0, 'the recorded decisions');
    decisions.forEach(([action, note], i) => {
      const row = grid[head + 2 + i];
      assert.equal(
        row[0],
        w.decided[action],
        `decision ${i + 1}: what it left`,
      );
      assert.ok(row[1], `decision ${i + 1}: its members`);
      assert.equal(row[2], note, `decision ${i + 1}: the reason typed`);
    });
    ends(head + 2 + decisions.length, 'the recorded decisions');
  }
  await page.getByRole('button', { name: w.forward }).click();
  return {
    rows: grid.length,
    waiting: waiting.length,
    unmatched: alone.length,
    decisions: decisions.length,
  };
}

/** The financial position page's words its decision buttons and the sheet's
 * decisions share, and the labels the page gives what it draws as figures
 * and fields rather than tables of their own. */
const FINANCIAL_WORDS = {
  ar: {
    decisions: 'القرارات المسجلة',
    accept: 'اعتمد البند كاملًا',
    reject: 'ارفض البند كاملًا',
    undo: 'ألغ القرار',
    trialBalance: ['مدين الميزان', 'دائن الميزان', 'الفرق، المدين ناقص الدائن'],
    positionEquation: 'معادلة المركز',
    attestationReference: 'مرجع الإقرار',
    attestationReason: 'سبب الإقرار',
    completeness:
      'راجعت اكتمال الحسابات والأبعاد والربط والأدلة وجميع بنود القائمة المقدمة',
  },
  en: {
    decisions: 'Recorded decisions',
    accept: 'Accept whole line',
    reject: 'Reject whole line',
    undo: 'Undo decision',
    trialBalance: [
      'Trial balance debit',
      'Trial balance credit',
      'Residual, debit minus credit',
    ],
    positionEquation: 'Position equation',
    attestationReference: 'Attestation reference',
    attestationReason: 'Attestation reason',
    completeness:
      'I reviewed completeness of supplied accounts, dimensions, mappings, evidence and statement lines',
  },
};

/** The figures in an element, as the page writes them: «label amount»,
 * the amount «—» where there is none. */
const figuresIn = (locator) =>
  locator.locator('.tarasuf-figure').evaluateAll((items) =>
    items.map((f) => [
      f.firstChild.textContent.trim(),
      (f.querySelector('.tarasuf-amount') ?? f.lastChild).textContent.trim(),
    ]),
  );

/**
 * UX-6(c), trial balance and financial position: the strip as the page
 * draws it; the attestation as the page holds it, once given; the trial
 * balance's three figures; the position by basis, the page's table turned;
 * every statement line the page lists, by its number, with its class, its
 * state and the difference; and every decision in the page's history, with
 * the line, its time, the evidence reference and the reason. Each section
 * holds what the page shows and no more.
 */
export async function financialSheetSaysScreen(page, { file, lang }) {
  const grid = await readSheet(file, lang);
  const w = page.locator('[data-financial-workspace]');
  await stripSaysScreen(grid, w);
  await stateSaysHeading(grid, w.locator('[data-financial-status]'), lang);
  const words = FINANCIAL_WORDS[lang];
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  // A section by the evidence it stands in, after a given row.
  const section = (evidence, after = -1) =>
    grid.findIndex(
      (r, i) => i > after && r[0] !== null && r[1] === null && r[3] === evidence,
    );
  const scopeEnd = section('Sources');
  // The attestation, as the page holds it, once given: a Summary section
  // whose first row is the reference.
  const summaries = grid
    .map((r, i) => i)
    .filter(
      (i) => i > scopeEnd && grid[i][1] === null && grid[i][3] === 'Summary',
    );
  const attest = summaries.find(
    (i) => grid[i + 1]?.[0] === words.attestationReference,
  );
  if (await w.getByLabel(words.completeness, { exact: true }).isChecked()) {
    assert.ok(attest !== undefined, 'the attestation');
    for (const [k, label] of [
      [1, words.attestationReference],
      [2, words.attestationReason],
    ])
      assert.deepEqual(
        grid[attest + k].slice(0, 2),
        [label, await w.getByLabel(label, { exact: true }).inputValue()],
        label,
      );
    blankRow(attest + 3, 'the attestation');
  } else assert.equal(attest, undefined, 'no attestation, no section');
  // The trial balance's three figures, by the labels the page gives them.
  const all = await figuresIn(w.locator('.workspace-results'));
  const tbFigures = words.trialBalance.map((label) =>
    all.find(([l]) => l === label),
  );
  assert.ok(tbFigures.every(Boolean), 'the page writes the trial balance');
  const tb = summaries.find(
    (i) => grid[i + 1]?.[0] === words.trialBalance[0],
  );
  if (tbFigures[0][1] === '—')
    assert.equal(tb, undefined, 'no trial balance, no section');
  else {
    assert.ok(tb !== undefined, 'the trial balance');
    tbFigures.forEach(([label, amount], k) => {
      assert.equal(grid[tb + 1 + k][0], label, `trial balance ${k + 1}`);
      same(amount, grid[tb + 1 + k][1], label);
    });
    blankRow(tb + 4, 'the trial balance');
  }
  // The position by basis: the page's rows are the bases, the sheet's the
  // figures, each figure's row named as the page's column is.
  let head = null,
    bases = [];
  for (const t of await w.locator('table').all()) {
    const h = (await t.locator('thead th').allTextContents()).map((x) =>
      x.trim(),
    );
    if (h.at(-1) === words.positionEquation) {
      head = h;
      bases = await t
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((r) =>
            Array.from(r.querySelectorAll('th,td')).map((c) =>
              c.textContent.trim(),
            ),
          ),
        );
    }
  }
  assert.ok(head, 'the page draws the position by basis');
  const position = section('Grand totals');
  if (!bases.length) assert.equal(position, -1, 'no position, no table');
  else {
    assert.ok(position >= 0, 'the position');
    assert.equal(grid[position + 1][0], head[0], 'the position head');
    head.slice(1).forEach((label, k) => {
      const row = grid[position + 2 + k];
      assert.equal(row[0], label, `position: ${label}`);
      bases.forEach((b, j) =>
        same(b[1 + k], row[1 + j], `position: ${label}, ${b[0]}`),
      );
    });
    blankRow(position + 2 + head.length - 1, 'the position');
  }
  // Every statement line: «number · label · class · state», then its three
  // figures, the difference last.
  const items = w.locator('section:has(> h3[data-decision-item])');
  const count = await items.count();
  const lines = section('Lines');
  if (!count) assert.equal(lines, -1, 'no line, no table');
  else {
    assert.ok(lines >= 0, 'the statement lines');
    for (let k = 0; k < count; k++) {
      const item = items.nth(k);
      const parts = (await item.locator('h3').textContent())
        .trim()
        .split(' · ');
      const [number, cls, state] = [parts[0], parts.at(-2), parts.at(-1)];
      const row = grid[lines + 2 + k];
      assert.deepEqual(
        row.slice(0, 3),
        [number, cls, state],
        `line ${number}: its number, class and state`,
      );
      const own = await figuresIn(item.locator(':scope > p'));
      assert.equal(own.length, 3, `line ${number}: three figures`);
      same(own[2][1], row[3], `line ${number}: the difference`);
    }
    blankRow(lines + 2 + count, 'the statement lines');
  }
  // Every decision in the page's history: what it did, the line and its
  // time, then the evidence reference and the reason.
  const events = await w
    .locator('[data-evidence-section="events"] tbody tr')
    .evaluateAll((rows) =>
      rows.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  const taken = section('Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else {
    assert.ok(taken >= 0, 'the recorded decisions');
    assert.equal(grid[taken][0], words.decisions, 'the decisions heading');
  }
  events.forEach(([type, line, , time, reference, reason], k) => {
    const row = taken + 1 + 2 * k;
    assert.deepEqual(
      grid[row].slice(0, 3),
      [words[type], line, time],
      `decision ${k + 1}: what it did, the line and its time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, reference, reason],
      `decision ${k + 1}: the reference and the reason given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return { rows: grid.length, lines: count, decisions: events.length };
}

const INTERCOMPANY_WORDS = {
  ar: {
    state: 'حالة النتيجة',
    decisions: 'القرارات المسجلة',
    complete: 'راجعت اكتمال المعاملات والعلاقات وأدلة التوقيت المورّدة.',
    completeReference: 'مرجع اكتمال معاملات المنشآت',
    completeNote: 'تفسير اكتمال معاملات المنشآت',
    totals: 'المدين والدائن والصافي لكل طرف',
  },
  en: {
    state: 'Result status',
    decisions: 'Recorded decisions',
    complete:
      'I reviewed the complete supplied transactions, relationships and timing evidence.',
    completeReference: 'Intercompany completeness reference',
    completeNote: 'Intercompany completeness explanation',
    totals: 'Debit, credit and net by side',
  },
};

/**
 * UX-6(c), intercompany: the strip as the page draws it, and under it the
 * result's state as the page's heading writes it; the attestation as the
 * page holds it, once given; debit, credit and net by side as the page's
 * table has them; every pair the page lists, by its heading's relation,
 * state and review, then its three figures; and every decision in the
 * page's history, with the relation, its time, the reference and the
 * explanation. Each section holds what the page shows and no more.
 */
export async function intercompanySheetSaysScreen(page, { file, lang }) {
  const grid = await readSheet(file, lang);
  const w = page.locator('[data-intercompany-workspace]');
  await stripSaysScreen(grid, w);
  const words = INTERCOMPANY_WORDS[lang];
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  // A section by the evidence it stands in, after a given row.
  const section = (evidence, after = -1) =>
    grid.findIndex(
      (r, i) => i > after && r[0] !== null && r[1] === null && r[3] === evidence,
    );
  // The result's state, the alignment's last row, as the heading says it.
  const heading = (
    await w.locator('[data-intercompany-status]').innerText()
  ).trim();
  const state = grid.findIndex((r) => r[0] === words.state);
  assert.ok(state >= 0, "the result's state");
  assert.deepEqual(
    grid[state].slice(0, 2),
    [words.state, heading],
    "the result's state as the page's heading writes it",
  );
  blankRow(state + 1, 'the alignment');
  // The attestation, as the page holds it, once given.
  const attest = grid.findIndex(
    (r, i) =>
      i > state &&
      r[1] === null &&
      r[3] === 'Summary' &&
      grid[i + 1]?.[0] === words.completeReference,
  );
  if (await w.getByLabel(words.complete, { exact: true }).isChecked()) {
    assert.ok(attest >= 0, 'the attestation');
    for (const [k, label] of [
      [1, words.completeReference],
      [2, words.completeNote],
    ])
      assert.deepEqual(
        grid[attest + k].slice(0, 2),
        [label, await w.getByLabel(label, { exact: true }).inputValue()],
        label,
      );
    blankRow(attest + 3, 'the attestation');
  } else assert.equal(attest, -1, 'no attestation, no section');
  // Debit, credit and net by side: the page's table, head and rows; none
  // where the page draws none.
  const sides = section('Totals');
  const totals = w.locator(`table[aria-label="${words.totals}"]`);
  if (!(await totals.count())) assert.equal(sides, -1, 'no totals, no table');
  else {
    assert.ok(sides >= 0, 'debit, credit and net by side');
    assert.equal(grid[sides][0], words.totals, 'the totals heading');
    const head = (await totals.locator('thead th').allTextContents()).map((x) =>
      x.trim(),
    );
    assert.deepEqual(grid[sides + 1], head, 'the totals head');
    const body = await totals
      .locator('tbody tr')
      .evaluateAll((rows) =>
        rows.map((r) =>
          Array.from(r.querySelectorAll('th,td')).map((c) =>
            c.textContent.trim(),
          ),
        ),
      );
    body.forEach((cells, k) =>
      cells.forEach((text, j) =>
        same(text, grid[sides + 2 + k][j], `totals row ${k + 1} cell ${j + 1}`),
      ),
    );
    blankRow(sides + 2 + body.length, 'the totals');
  }
  // Every pair: «relation · state · review», then its three figures.
  const items = w.locator('section[data-intercompany-pair]');
  const count = await items.count();
  const listed = Number(
    (await w.locator('h3', { hasText: /\(\d+\)$/u }).first().innerText())
      .trim()
      .match(/\((\d+)\)$/u)[1],
  );
  assert.equal(count, listed, 'the page lists every pair');
  const pairs = section('Pairs');
  if (!count) assert.equal(pairs, -1, 'no pair, no table');
  else assert.ok(pairs >= 0, 'the pairs');
  for (let k = 0; k < count; k++) {
    const item = items.nth(k);
    const parts = (await item.locator('h3').textContent()).trim().split(' · ');
    const at = pairs + 1 + 4 * k;
    assert.deepEqual(
      grid[at],
      [...parts, null],
      `pair ${parts[0]}: its relation, state and review`,
    );
    const own = await figuresIn(item.locator(':scope > p'));
    assert.equal(own.length, 3, `pair ${parts[0]}: three figures`);
    own.forEach(([label, amount], j) => {
      assert.equal(grid[at + 1 + j][0], null, `pair ${parts[0]}: ${label}`);
      assert.equal(grid[at + 1 + j][1], label, `pair ${parts[0]}: ${label}`);
      same(amount, grid[at + 1 + j][2], `pair ${parts[0]}: ${label}`);
    });
  }
  if (count) blankRow(pairs + 1 + 4 * count, 'the pairs');
  // Every decision in the page's history: what it did, the relation and
  // its time, then the reference and the explanation.
  const events = await w
    .locator('[data-evidence-section="events"] tbody tr')
    .evaluateAll((rows) =>
      rows.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  const taken = section('Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else {
    assert.ok(taken >= 0, 'the recorded decisions');
    assert.equal(grid[taken][0], words.decisions, 'the decisions heading');
  }
  events.forEach(([type, relation, time, reference, reason], k) => {
    const row = taken + 1 + 2 * k;
    assert.deepEqual(
      grid[row].slice(0, 3),
      [type, relation, time],
      `decision ${k + 1}: what it did, the pair and its time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, reference, reason],
      `decision ${k + 1}: the reference and the explanation given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return { rows: grid.length, pairs: count, decisions: events.length };
}

const GATEWAY_WORDS = {
  ar: {
    decisions: 'القرارات المسجلة',
    complete:
      'راجعت جميع المعاملات وتفاصيل الرسوم المستقلة والتسوية وحركة الإيداع المورّدة.',
    completeReference: 'مرجع اكتمال بوابة الدفع',
    completeNote: 'شرح اكتمال بوابة الدفع',
    totals: 'المجاميع المحسوبة',
    residuals: 'الفروق، المحسوب ناقص الملخص',
  },
  en: {
    decisions: 'Recorded decisions',
    complete:
      'I reviewed all supplied transactions, independent fee detail, settlement and bank credit.',
    completeReference: 'Gateway completeness reference',
    completeNote: 'Gateway completeness explanation',
    totals: 'Calculated totals',
    residuals: 'Residuals, calculated minus summary',
  },
};

/** A record table's head and body cells, as the page writes them. */
// A comparison row, a gateway batch's totals and residuals, and a supplier
// case row open with the way to their evidence (UX-10). The sheet has no
// such column: it is required where the page draws it, then set aside.
const THREAD_WAY = { en: 'Review source rows', ar: 'راجع صفوف المصدر' };
function withoutWay({ head, body }, lang, what) {
  if (!body.length) return { head, body };
  assert.equal(head[0], THREAD_WAY[lang], `${what}: the way to the evidence`);
  for (const row of body)
    assert.ok(row[0].startsWith(THREAD_WAY[lang]), `${what}: ${row[0]}`);
  return { head: head.slice(1), body: body.map((row) => row.slice(1)) };
}

async function tableCells(table) {
  const head = (await table.locator('thead th').allTextContents()).map((x) =>
    x.trim(),
  );
  const body = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  return { head, body };
}

/**
 * UX-6(c), payment gateways: the strip as the page draws it, and under it
 * the result's state as the page's heading writes it; the attestation as the
 * page holds it, once given; the calculated totals as the page's table has
 * them; the five residuals, each by its heading on the page with its
 * figure; and every decision in the page's history, with the batch, its
 * time, the reference and the explanation. Each section holds what the page
 * shows and no more.
 */
export async function gatewaySheetSaysScreen(page, { file, lang }) {
  const grid = await readSheet(file, lang);
  const w = page.locator('[data-gateway-workspace]');
  await stripSaysScreen(grid, w);
  await stateSaysHeading(grid, w.locator('[data-gateway-status]'), lang);
  const words = GATEWAY_WORDS[lang];
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  // A section by the evidence it stands in, after a given row.
  const section = (evidence, after = -1) =>
    grid.findIndex(
      (r, i) => i > after && r[0] !== null && r[1] === null && r[3] === evidence,
    );
  const state = grid.findIndex((r) => r[0] === RESULT_STATE[lang]);
  // The attestation, as the page holds it, once given.
  const attest = grid.findIndex(
    (r, i) =>
      i > state &&
      r[1] === null &&
      r[3] === 'Summary' &&
      grid[i + 1]?.[0] === words.completeReference,
  );
  if (await w.getByLabel(words.complete, { exact: true }).isChecked()) {
    assert.ok(attest >= 0, 'the attestation');
    for (const [k, label] of [
      [1, words.completeReference],
      [2, words.completeNote],
    ])
      assert.deepEqual(
        grid[attest + k].slice(0, 2),
        [label, await w.getByLabel(label, { exact: true }).inputValue()],
        label,
      );
    blankRow(attest + 3, 'the attestation');
  } else assert.equal(attest, -1, 'no attestation, no section');
  // The calculated totals: the page's table, head and row; none where the
  // page has no row.
  const totals = section('Totals');
  const shown = withoutWay(
    await tableCells(w.locator(`table[aria-label="${words.totals}"]`)),
    lang,
    'the totals',
  );
  if (!shown.body.length) assert.equal(totals, -1, 'no totals, no table');
  else {
    assert.ok(totals >= 0, 'the calculated totals');
    assert.equal(grid[totals][0], words.totals, 'the totals heading');
    assert.deepEqual(grid[totals + 1], shown.head, 'the totals head');
    assert.equal(shown.body.length, 1, 'one row of totals');
    shown.body[0].forEach((text, j) =>
      same(text, grid[totals + 2][j], `totals cell ${j + 1}`),
    );
    blankRow(totals + 3, 'the totals');
  }
  // The five residuals: each heading of the page's table with its figure,
  // a row each; none where the page has no row.
  const residuals = section('Residuals');
  const owed = withoutWay(
    await tableCells(w.locator(`table[aria-label="${words.residuals}"]`)),
    lang,
    'the residuals',
  );
  if (!owed.body.length) assert.equal(residuals, -1, 'no residuals, no list');
  else {
    assert.ok(residuals >= 0, 'the residuals');
    assert.equal(grid[residuals][0], words.residuals, 'the residuals heading');
    assert.equal(owed.head.length, 5, 'five residuals on the page');
    owed.head.forEach((label, k) => {
      assert.equal(grid[residuals + 1 + k][0], label, `residual ${k + 1}`);
      same(owed.body[0][k], grid[residuals + 1 + k][1], `residual ${label}`);
    });
    blankRow(residuals + 6, 'the residuals');
  }
  // Every decision in the page's history: what it did, the batch and its
  // time, then the reference and the explanation.
  const events = await w
    .locator('[data-evidence-section="events"] tbody tr')
    .evaluateAll((rows) =>
      rows.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  const taken = section('Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else {
    assert.ok(taken >= 0, 'the recorded decisions');
    assert.equal(grid[taken][0], words.decisions, 'the decisions heading');
  }
  events.forEach(([type, batch, time, reference, reason], k) => {
    const row = taken + 1 + 2 * k;
    assert.deepEqual(
      grid[row].slice(0, 3),
      [type, batch, time],
      `decision ${k + 1}: what it did, the batch and its time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, reference, reason],
      `decision ${k + 1}: the reference and the explanation given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return {
    rows: grid.length,
    totals: shown.body.length,
    residuals: owed.body.length ? 5 : 0,
    decisions: events.length,
  };
}

const INVENTORY_WORDS = {
  ar: {
    decisions: 'القرارات المسجلة',
    complete:
      'راجعت السجل المقدم وكل الخرائط وأدلة السياسة وكل حساب أستاذ مقدم بما فيه الحساب الصفري.',
    completeReference: 'مرجع اكتمال جرد المخزون',
    completeNote: 'توضيح اكتمال جرد المخزون',
    totals: 'قيمة السجل مقابل الأستاذ',
    comparisons: 'المقارنة حسب الحساب',
    // The history's word for each decision, and the word its button writes,
    // which the sheet writes.
    actions: {
      اعتماد: 'اعتمد كامل نطاق المخزون',
      رفض: 'ارفض كامل نطاق المخزون',
      إلغاء: 'ألغ قرار المخزون',
    },
  },
  en: {
    decisions: 'Recorded decisions',
    complete:
      'I reviewed the supplied register, all proposed mappings, policy evidence and every supplied GL account, including zero accounts.',
    completeReference: 'Inventory completeness reference',
    completeNote: 'Inventory completeness explanation',
    totals: 'Register value against the GL',
    comparisons: 'Comparison by account',
    actions: {
      Approve: 'Approve whole inventory scope',
      Reject: 'Reject whole inventory scope',
      Undo: 'Undo inventory decision',
    },
  },
};
// The Arabic printed-register workpaper names its evidence sheets in Arabic,
// by the frozen label list its own checker holds.
const INVENTORY_ARABIC_SHEETS = JSON.parse(
  readFileSync(
    new URL('../audit/inventory-pdf-workspace/labels.ar.json', import.meta.url),
    'utf8',
  ),
);

/**
 * UX-6(c), inventory: the strip as the page draws it, and under it the
 * result's state as the page's heading writes it; the attestation as the
 * page holds it, once given; the register value against the GL as the
 * page's table has it; each account, the page's row as a block, its five
 * figures each by the page's heading, a dash where the page shows one; and
 * every decision in the page's history, its button's word, its time, the
 * reference and the explanation. On the printed register's Arabic
 * workpaper, each section names its evidence sheet in Arabic. Each section
 * holds what the page shows and no more.
 */
export async function inventorySheetSaysScreen(page, { file, lang, printed }) {
  const arabic = printed && lang === 'ar';
  const named = (sheet) => (arabic ? INVENTORY_ARABIC_SHEETS[sheet] : sheet);
  const grid = await readSheet(file, lang, named('Summary'));
  const w = page.locator('[data-stock-workspace]');
  await stripSaysScreen(grid, w);
  await stateSaysHeading(grid, w.locator('[data-stock-status]'), lang);
  const words = INVENTORY_WORDS[lang];
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  // A section by the evidence it stands in, after a given row.
  const section = (evidence, after = -1) =>
    grid.findIndex(
      (r, i) =>
        i > after && r[0] !== null && r[1] === null && r[3] === named(evidence),
    );
  for (const evidence of ['Summary', 'Sources'])
    assert.ok(section(evidence) >= 0, `a section in ${named(evidence)}`);
  const state = grid.findIndex((r) => r[0] === RESULT_STATE[lang]);
  // The attestation, as the page holds it, once given.
  const attest = grid.findIndex(
    (r, i) =>
      i > state &&
      r[1] === null &&
      r[3] === named('Summary') &&
      grid[i + 1]?.[0] === words.completeReference,
  );
  if (await w.getByLabel(words.complete, { exact: true }).isChecked()) {
    assert.ok(attest >= 0, 'the attestation');
    for (const [k, label] of [
      [1, words.completeReference],
      [2, words.completeNote],
    ])
      assert.deepEqual(
        grid[attest + k].slice(0, 2),
        [label, await w.getByLabel(label, { exact: true }).inputValue()],
        label,
      );
    blankRow(attest + 3, 'the attestation');
  } else assert.equal(attest, -1, 'no attestation, no section');
  // The register value against the GL: the page's table, head and row;
  // none where the page has no row.
  const totals = grid.findIndex(
    (r) => r[0] === words.totals && r[3] === named('Summary'),
  );
  const shown = await tableCells(
    w.locator(`table[aria-label="${words.totals}"]`),
  );
  if (!shown.body.length) assert.equal(totals, -1, 'no totals, no table');
  else {
    assert.ok(totals >= 0, 'the register value against the GL');
    assert.deepEqual(grid[totals + 1].slice(0, 2), shown.head, 'the head');
    assert.equal(shown.body.length, 1, 'one row');
    shown.body[0].forEach((text, j) =>
      same(text, grid[totals + 2][j], `register against GL cell ${j + 1}`),
    );
    blankRow(totals + 3, 'the register value against the GL');
  }
  // Each account: the page's row as a block, the account and its complete
  // dimensions, then each figure by the page's heading.
  const accounts = section('Account comparisons');
  const compared = await tableCells(
    w.locator(`table[aria-label="${words.comparisons}"]`),
  );
  if (!compared.body.length)
    assert.equal(accounts, -1, 'no accounts, no table');
  else {
    assert.ok(accounts >= 0, 'the comparison by account');
    assert.equal(grid[accounts][0], words.comparisons, 'the accounts heading');
    assert.equal(compared.head.length, 7, 'seven headings on the page');
  }
  compared.body.forEach((cells, k) => {
    const at = accounts + 1 + 6 * k;
    assert.deepEqual(
      grid[at],
      [cells[0], cells[1] || '—', null, null],
      `account ${k + 1}: the account and its dimensions`,
    );
    for (let f = 2; f < 7; f++) {
      assert.equal(grid[at + f - 1][0], compared.head[f], `${cells[0]} ${f}`);
      same(cells[f], grid[at + f - 1][1], `${cells[0]} ${compared.head[f]}`);
    }
  });
  if (compared.body.length)
    blankRow(accounts + 1 + 6 * compared.body.length, 'the accounts');
  // Every decision in the page's history: its button's word and its time,
  // then the reference and the explanation.
  const events = await w
    .locator('[data-evidence-section="events"] tbody tr')
    .evaluateAll((rows) =>
      rows.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  const taken = section('Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else {
    assert.ok(taken >= 0, 'the recorded decisions');
    assert.equal(grid[taken][0], words.decisions, 'the decisions heading');
  }
  events.forEach(([, type, time, reference, reason], k) => {
    const row = taken + 1 + 2 * k;
    assert.ok(words.actions[type], `decision ${k + 1}: ${type} is a decision`);
    assert.deepEqual(
      grid[row].slice(0, 3),
      [words.actions[type], time, null],
      `decision ${k + 1}: its button's word and its time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, reference, reason],
      `decision ${k + 1}: the reference and the explanation given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return {
    rows: grid.length,
    totals: shown.body.length,
    accounts: compared.body.length,
    decisions: events.length,
  };
}

// The fixed-assets page's words, as this check holds them apart from the
// product's catalogue.
const ASSET_WORDS = {
  ar: {
    decisions: 'القرارات المسجلة',
    complete:
      'راجعت الأصول المقدمة وخرائط الكلفة والاستهلاك والانخفاض وأدلتها وكل حساب أستاذ محدد بما فيه المكونات والحسابات الصفرية.',
    completeReference: 'مرجع اكتمال الأصول',
    completeNote: 'توضيح اكتمال الأصول',
    totals: 'مجاميع المكونات',
    comparisons: 'المقارنة حسب الحساب والمكون',
    // The history's word for each decision, and the word its button writes,
    // which the sheet writes.
    actions: {
      اعتماد: 'اعتمد كامل نطاق الأصول',
      رفض: 'ارفض كامل نطاق الأصول',
      إلغاء: 'تراجع عن قرار الأصول',
    },
  },
  en: {
    decisions: 'Recorded decisions',
    complete:
      'I reviewed all supplied assets, the cost/depreciation/impairment mappings and evidence, and every selected GL account including zero components and accounts.',
    completeReference: 'Asset completeness reference',
    completeNote: 'Asset completeness explanation',
    totals: 'Component totals',
    comparisons: 'Comparison by account and component',
    actions: {
      Approve: 'Approve whole asset scope',
      Reject: 'Reject whole asset scope',
      Undo: 'Undo asset decision',
    },
  },
};

/**
 * UX-6(c), fixed assets: the strip as the page draws it, and under it the
 * result's state as the page's heading writes it; the attestation as the
 * page holds it, once given; the component totals as the page's table has
 * them, none where the page shows no figure in it; each comparison, the
 * page's row as a block: the account and its complete dimensions, its
 * component, then its three figures each by the page's heading, a dash where
 * the page shows one; and every decision in the page's history, its
 * button's word, its time, the reference and the explanation. Each section
 * holds what the page shows and no more.
 */
export async function fixedAssetsSheetSaysScreen(page, { file, lang }) {
  const grid = await readSheet(file, lang);
  const w = page.locator('[data-asset-workspace]');
  await stripSaysScreen(grid, w);
  await stateSaysHeading(grid, w.locator('[data-asset-status]'), lang);
  const words = ASSET_WORDS[lang];
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  // A section by the evidence it stands in, after a given row.
  const section = (evidence, after = -1) =>
    grid.findIndex(
      (r, i) => i > after && r[0] !== null && r[1] === null && r[3] === evidence,
    );
  for (const evidence of ['Summary', 'Sources'])
    assert.ok(section(evidence) >= 0, `a section in ${evidence}`);
  const state = grid.findIndex((r) => r[0] === RESULT_STATE[lang]);
  // The attestation, as the page holds it, once given.
  const attest = grid.findIndex(
    (r, i) =>
      i > state &&
      r[1] === null &&
      r[3] === 'Summary' &&
      grid[i + 1]?.[0] === words.completeReference,
  );
  if (await w.getByLabel(words.complete, { exact: true }).isChecked()) {
    assert.ok(attest >= 0, 'the attestation');
    for (const [k, label] of [
      [1, words.completeReference],
      [2, words.completeNote],
    ])
      assert.deepEqual(
        grid[attest + k].slice(0, 2),
        [label, await w.getByLabel(label, { exact: true }).inputValue()],
        label,
      );
    blankRow(attest + 3, 'the attestation');
  } else assert.equal(attest, -1, 'no attestation, no section');
  // The component totals: the page's table, its head and its four rows;
  // none where the page shows a dash for every total.
  const totals = grid.findIndex(
    (r) => r[0] === words.totals && r[3] === 'Summary',
  );
  const shown = await tableCells(
    w.locator(`table[aria-label="${words.totals}"]`),
  );
  assert.equal(shown.body.length, 4, 'four components on the page');
  if (shown.body.every((cells) => cells[1] === '—' && cells[2] === '—'))
    assert.equal(totals, -1, 'no totals, no table');
  else {
    assert.ok(totals >= 0, 'the component totals');
    assert.deepEqual(grid[totals + 1].slice(0, 3), shown.head, 'the head');
    shown.body.forEach((cells, i) =>
      cells.forEach((text, j) =>
        same(text, grid[totals + 2 + i][j], `total ${i + 1} cell ${j + 1}`),
      ),
    );
    blankRow(totals + 6, 'the component totals');
  }
  // Each comparison: the page's row as a block, the account and its
  // complete dimensions, its component, then each figure by the page's
  // heading.
  const compared = section('Component comparisons');
  const rows = withoutWay(
    await tableCells(w.locator(`table[aria-label="${words.comparisons}"]`)),
    lang,
    'the comparisons',
  );
  if (!rows.body.length) assert.equal(compared, -1, 'no comparison, no table');
  else {
    assert.ok(compared >= 0, 'the comparison by account and component');
    assert.equal(grid[compared][0], words.comparisons, 'the heading');
    assert.equal(rows.head.length, 6, 'six headings on the page');
  }
  rows.body.forEach((cells, k) => {
    const at = compared + 1 + 5 * k;
    assert.deepEqual(
      grid[at],
      [cells[0], cells[1] || '—', null, null],
      `comparison ${k + 1}: the account and its dimensions`,
    );
    assert.deepEqual(
      grid[at + 1],
      [rows.head[2], cells[2], null, null],
      `comparison ${k + 1}: its component`,
    );
    for (let f = 3; f < 6; f++) {
      assert.equal(grid[at + f - 1][0], rows.head[f], `${cells[0]} ${f}`);
      same(cells[f], grid[at + f - 1][1], `${cells[0]} ${rows.head[f]}`);
    }
  });
  if (rows.body.length)
    blankRow(compared + 1 + 5 * rows.body.length, 'the comparisons');
  // Every decision in the page's history: its button's word and its time,
  // then the reference and the explanation.
  const events = await w
    .locator('[data-evidence-section="events"] tbody tr')
    .evaluateAll((list) =>
      list.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  const taken = section('Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else {
    assert.ok(taken >= 0, 'the recorded decisions');
    assert.equal(grid[taken][0], words.decisions, 'the decisions heading');
  }
  events.forEach(([, type, time, reference, reason], k) => {
    const row = taken + 1 + 2 * k;
    assert.ok(words.actions[type], `decision ${k + 1}: ${type} is a decision`);
    assert.deepEqual(
      grid[row].slice(0, 3),
      [words.actions[type], time, null],
      `decision ${k + 1}: its button's word and its time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, reference, reason],
      `decision ${k + 1}: the reference and the explanation given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return {
    rows: grid.length,
    totals: totals >= 0 ? 4 : 0,
    comparisons: rows.body.length,
    decisions: events.length,
  };
}

// The payroll page's words, as this check holds them apart from the
// product's catalogue.
const PAYROLL_WORDS = {
  ar: {
    decisions: 'القرارات المسجلة',
    complete:
      'راجعت كل موظف مقدم وخرائط المكونات السبعة وأدلة سياساتها وكل قيد أستاذ بما فيه المكونات الصفرية والصرف البنكي المستقل.',
    completeReference: 'مرجع اكتمال الرواتب',
    completeNote: 'توضيح اكتمال الرواتب',
    totals: 'مجاميع المكونات',
    bank: 'صافي المسير مقابل الصرف البنكي',
    comparisons: 'المقارنة حسب الحساب والمكون',
    // The history's word for each decision, and the word its button writes,
    // which the sheet writes.
    actions: {
      اعتماد: 'اعتمد كامل نطاق الرواتب',
      رفض: 'ارفض كامل نطاق الرواتب',
      إلغاء: 'تراجع عن قرار الرواتب',
    },
  },
  en: {
    decisions: 'Recorded decisions',
    complete:
      'I reviewed every supplied employee, all seven component mappings and policy evidence, every GL entry including zero components, and the independent bank payout.',
    completeReference: 'Payroll completeness reference',
    completeNote: 'Payroll completeness explanation',
    totals: 'Component totals',
    bank: 'Register net against the bank outflow',
    comparisons: 'Comparison by account and component',
    actions: {
      Approve: 'Approve whole payroll scope',
      Reject: 'Reject whole payroll scope',
      Undo: 'Undo payroll decision',
    },
  },
};

/**
 * UX-6(c), payroll: the strip as the page draws it, and under it the
 * result's state as the page's heading writes it; the attestation as the
 * page holds it, once given; the component totals as the page's table has
 * them, none where the page shows no figure in it; the register net against
 * the bank outflow, the page's one row, a dash where the page shows one;
 * each comparison, the page's row as a block: the account and its complete
 * dimensions, its component, then its three figures each by the page's
 * heading; and every decision in the page's history, its button's word, its
 * time, the reference and the explanation. Each section holds what the page
 * shows and no more.
 */
export async function payrollSheetSaysScreen(page, { file, lang }) {
  const grid = await readSheet(file, lang);
  const w = page.locator('[data-payroll-workspace]');
  await stripSaysScreen(grid, w);
  await stateSaysHeading(grid, w.locator('[data-payroll-status]'), lang);
  const words = PAYROLL_WORDS[lang];
  const blankRow = (at, what) =>
    assert.ok(
      (grid[at] ?? [null]).every((c) => c === null),
      `${what} and no more`,
    );
  // A section by the evidence it stands in, after a given row.
  const section = (evidence, after = -1) =>
    grid.findIndex(
      (r, i) => i > after && r[0] !== null && r[1] === null && r[3] === evidence,
    );
  for (const evidence of ['Summary', 'Sources'])
    assert.ok(section(evidence) >= 0, `a section in ${evidence}`);
  const state = grid.findIndex((r) => r[0] === RESULT_STATE[lang]);
  // The attestation, as the page holds it, once given.
  const attest = grid.findIndex(
    (r, i) =>
      i > state &&
      r[1] === null &&
      r[3] === 'Summary' &&
      grid[i + 1]?.[0] === words.completeReference,
  );
  if (await w.getByLabel(words.complete, { exact: true }).isChecked()) {
    assert.ok(attest >= 0, 'the attestation');
    for (const [k, label] of [
      [1, words.completeReference],
      [2, words.completeNote],
    ])
      assert.deepEqual(
        grid[attest + k].slice(0, 2),
        [label, await w.getByLabel(label, { exact: true }).inputValue()],
        label,
      );
    blankRow(attest + 3, 'the attestation');
  } else assert.equal(attest, -1, 'no attestation, no section');
  // The component totals: the page's table, its head and its seven rows;
  // none where the page shows a dash for every total.
  const totals = grid.findIndex(
    (r) => r[0] === words.totals && r[3] === 'Summary',
  );
  const shown = await tableCells(
    w.locator(`table[aria-label="${words.totals}"]`),
  );
  assert.equal(shown.body.length, 7, 'seven components on the page');
  if (shown.body.every((cells) => cells[1] === '—' && cells[2] === '—'))
    assert.equal(totals, -1, 'no totals, no table');
  else {
    assert.ok(totals >= 0, 'the component totals');
    assert.deepEqual(grid[totals + 1].slice(0, 3), shown.head, 'the head');
    shown.body.forEach((cells, i) =>
      cells.forEach((text, j) =>
        same(text, grid[totals + 2 + i][j], `total ${i + 1} cell ${j + 1}`),
      ),
    );
    blankRow(totals + 9, 'the component totals');
  }
  // The register net against the bank outflow: the page's one row under its
  // three headings, a dash where the page shows one.
  const bank = section('Bank comparison');
  const banked = withoutWay(
    await tableCells(w.locator(`table[aria-label="${words.bank}"]`)),
    lang,
    'the bank comparison',
  );
  assert.equal(banked.body.length, 1, 'one bank row on the page');
  assert.ok(bank >= 0, 'the bank comparison');
  assert.equal(grid[bank][0], words.bank, 'the bank heading');
  assert.deepEqual(grid[bank + 1].slice(0, 3), banked.head, 'the bank head');
  banked.body[0].forEach((text, j) =>
    same(text, grid[bank + 2][j], `bank cell ${j + 1}`),
  );
  blankRow(bank + 3, 'the bank comparison');
  // Each comparison: the page's row as a block, the account and its
  // complete dimensions, its component, then each figure by the page's
  // heading.
  const compared = section('Component comparisons');
  const rows = withoutWay(
    await tableCells(w.locator(`table[aria-label="${words.comparisons}"]`)),
    lang,
    'the comparisons',
  );
  if (!rows.body.length) assert.equal(compared, -1, 'no comparison, no table');
  else {
    assert.ok(compared >= 0, 'the comparison by account and component');
    assert.equal(grid[compared][0], words.comparisons, 'the heading');
    assert.equal(rows.head.length, 6, 'six headings on the page');
  }
  rows.body.forEach((cells, k) => {
    const at = compared + 1 + 5 * k;
    assert.deepEqual(
      grid[at],
      [cells[0], cells[1] || '—', null, null],
      `comparison ${k + 1}: the account and its dimensions`,
    );
    assert.deepEqual(
      grid[at + 1],
      [rows.head[2], cells[2], null, null],
      `comparison ${k + 1}: its component`,
    );
    for (let f = 3; f < 6; f++) {
      assert.equal(grid[at + f - 1][0], rows.head[f], `${cells[0]} ${f}`);
      same(cells[f], grid[at + f - 1][1], `${cells[0]} ${rows.head[f]}`);
    }
  });
  if (rows.body.length)
    blankRow(compared + 1 + 5 * rows.body.length, 'the comparisons');
  // Every decision in the page's history: its button's word and its time,
  // then the reference and the explanation.
  const events = await w
    .locator('[data-evidence-section="events"] tbody tr')
    .evaluateAll((list) =>
      list.map((r) =>
        Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent.trim()),
      ),
    );
  const taken = section('Events');
  if (!events.length) assert.equal(taken, -1, 'no decision, no table');
  else {
    assert.ok(taken >= 0, 'the recorded decisions');
    assert.equal(grid[taken][0], words.decisions, 'the decisions heading');
  }
  events.forEach(([, type, time, reference, reason], k) => {
    const row = taken + 1 + 2 * k;
    assert.ok(words.actions[type], `decision ${k + 1}: ${type} is a decision`);
    assert.deepEqual(
      grid[row].slice(0, 3),
      [words.actions[type], time, null],
      `decision ${k + 1}: its button's word and its time`,
    );
    assert.deepEqual(
      grid[row + 1].slice(0, 3),
      [null, reference, reason],
      `decision ${k + 1}: the reference and the explanation given`,
    );
  });
  if (events.length) blankRow(taken + 1 + 2 * events.length, 'the decisions');
  return {
    rows: grid.length,
    totals: totals >= 0 ? 7 : 0,
    comparisons: rows.body.length,
    decisions: events.length,
  };
}
