import assert from 'node:assert/strict';
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
 * its name and its direction are checked. */
export async function readSheet(file, lang) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.worksheets[0];
  assert.equal(
    sheet.name,
    NAMES[lang],
    'the sheet is first, named in the interface language',
  );
  assert.equal(book.worksheets[1].name, 'Summary', 'the evidence follows it');
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

/** A table the sheet repeats whole: its head, then each row as drawn. */
export async function tableSaysScreen(grid, table) {
  const head = await table.locator('thead th').allInnerTexts();
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
    const cells = (await body.nth(i).locator('th, td').allInnerTexts()).map(
      (t) => t.trim(),
    );
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
 * come from the page's own table head.
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
  const head = (await table.locator('thead th').allInnerTexts()).map((h) =>
    h.trim(),
  );
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
      const [members, reference, net] = (await cells.allInnerTexts()).map((t) =>
        t.trim(),
      );
      const reason = (await cells.nth(4).locator('.muted').innerText()).trim();
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
  const section = (name) =>
    page.locator(`[data-bank-movement-table="${name}"]`);
  const cells = async (row) =>
    (await row.locator('th, td').allTextContents()).map((t) => t.trim());
  // Each movement's amount, by its side and own reference.
  const amounts = new Map();
  for (const row of await section('movements').locator('tbody tr').all()) {
    const c = await cells(row);
    amounts.set(`${c[0]}|${c[2]}`, c[10]);
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
      const cell = row.locator('td');
      out.push({
        side: (await cell.nth(0).innerText()).split('·')[0].trim(),
        date: (await cell.nth(1).innerText()).trim(),
        reference: (await cell.nth(2).locator('bdi').innerText()).trim(),
        amount: (await cell.nth(3).innerText()).split('\n')[0].trim(),
        members: (await cell.nth(3).locator('.muted').innerText())
          .match(/(\d+):(\d+)/u)
          .slice(1, 3)
          .reduce((a, b) => a + Number(b), 0),
        state: (await cell.nth(4).innerText()).trim(),
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
