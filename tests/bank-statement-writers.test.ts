import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import {
  BankStatementReadError,
  readBankStatementPdf,
} from '../lib/reconciliation/bank-statement-native.ts';
import { readNativePdfWordSource } from '../lib/reconciliation/pdf.ts';
import type { NativePdfWordSource } from '../lib/reconciliation/pdf-native-source.ts';

// Layouts other PDF writers produce for the same statement (BNK-PDF-1 G6),
// made here from the foundation's Chromium statements so that no holdout
// file is used: amount headers aligned with their column's end, as amounts
// are; a heading date printed as separate runs; a heading line printed as
// one run with no proved word parts. Each must read exactly as the original,
// and each must still refuse what does not prove one column or one period.

const sources = new Map<string, NativePdfWordSource>();
async function source(id: string) {
  if (!sources.has(id))
    sources.set(
      id,
      await readNativePdfWordSource(
        Uint8Array.from(
          await fsRead(
            new URL(
              `../audit/bank-statement-foundation/frozen/${id}-statement.pdf`,
              import.meta.url,
            ),
          ),
        ).buffer,
      ),
    );
  return structuredClone(sources.get(id)!);
}
/** A reading that must succeed: a refusal fails the test as an assertion. */
function read(s: NativePdfWordSource) {
  let out: ReturnType<typeof readBankStatementPdf> | undefined;
  assert.doesNotThrow(() => {
    out = readBankStatementPdf(s);
  });
  return out!;
}
const refused = (s: NativePdfWordSource, code: string) =>
  assert.throws(
    () => readBankStatementPdf(s),
    (e: unknown) => e instanceof BankStatementReadError && e.code === code,
  );
const AMOUNT = /^[\d,]+\.\d\d( DR)?$/u;
type Token = NativePdfWordSource['pages'][number]['tokens'][number];

/** Every page's Withdrawal, Deposit and Balance headers moved to end where
 * their column's amounts end. Returns, per page, the header tokens and the
 * amounts under each. */
function endAlignHeaders(s: NativePdfWordSource) {
  const out: { header: Token; amounts: Token[] }[][] = [];
  for (const page of s.pages) {
    const names = ['Withdrawal', 'Deposit', 'Balance'];
    const headers = names.map(
      (n) => page.tokens.find((t) => t.text === n && t.y > 700)!,
    );
    const columns = headers.map((h, k) => {
      const next = headers[k + 1];
      const amounts = page.tokens.filter(
        (t) =>
          AMOUNT.test(t.text) &&
          t.x >= h.x - 2.5 &&
          (next === undefined || t.x + t.width <= next.x - 1),
      );
      return { header: h, amounts };
    });
    for (const { header, amounts } of columns) {
      const end = Math.max(...amounts.map((t) => t.x + t.width));
      header.x = end - header.width;
    }
    out.push(columns);
  }
  return out;
}

void test('amount headers aligned with their column end read as the original', async () => {
  const original = read(await source('BS01'));
  const shifted = await source('BS01');
  const columns = endAlignHeaders(shifted);
  // The start edges no longer place every amount: some start before their
  // header, so only the end-aligned rule can read them.
  assert.ok(
    columns.some((page) =>
      page.some(({ header, amounts }) =>
        amounts.some((t) => t.x < header.x - 2.5),
      ),
    ),
  );
  const shiftedRead = read(shifted);
  assert.deepEqual(shiftedRead.lines, original.lines);
  assert.equal(shiftedRead.status, original.status);
  // The long statement with page totals too.
  const long = read(await source('BS14'));
  const longShifted = await source('BS14');
  endAlignHeaders(longShifted);
  assert.deepEqual(read(longShifted).lines, long.lines);
});

void test('under an end-aligned header a value must end with it and stay clear of the others', async () => {
  const wide = (move: (t: Token, header: Token, previous: Token) => void) => {
    return source('BS01').then((s) => {
      const [page] = endAlignHeaders(s);
      const deposit = page[1];
      const amount = deposit.amounts.find(
        (t) => t.x < deposit.header.x - 2.5,
      )!;
      move(amount, deposit.header, page[0].header);
      return s;
    });
  };
  // Four points short of the header's end.
  refused(
    await wide((t) => {
      t.x -= 4;
    }),
    'COLUMN',
  );
  // Ending with the header but reaching under the Withdrawal header.
  refused(
    await wide((t, _h, previous) => {
      const end = t.x + t.width;
      t.x = previous.x + previous.width - 6;
      t.width = end - t.x;
    }),
    'COLUMN',
  );
  // Ending with the header and touching the Withdrawal header's end.
  refused(
    await wide((t, _h, previous) => {
      const end = t.x + t.width;
      t.x = previous.x + previous.width;
      t.width = end - t.x;
    }),
    'COLUMN',
  );
});

void test('a heading line printed as one run states its currency and period', async () => {
  const original = read(await source('BS01'));
  const s = await source('BS01');
  for (const page of s.pages) {
    const line = page.tokens.find((t) => t.text.startsWith('Account:'))!;
    delete line.parts;
  }
  const oneRun = read(s);
  assert.deepEqual(oneRun.period, original.period);
  assert.equal(oneRun.currency, 'SAR');
  assert.deepEqual(oneRun.lines, original.lines);
});

void test('a heading date printed as separate runs is one date', async () => {
  const original = read(await source('BS16'));
  const s = await source('BS16');
  let item = 100000;
  for (const page of s.pages)
    for (const visual of ['31-07-2026', '01-07-2026']) {
      const at = page.tokens.findIndex((t) => t.text === visual);
      const t = page.tokens[at];
      const each = t.width / visual.length;
      let x = t.x;
      const runs = visual.split(/(-)/u).map((text) => {
        const run = { ...t, text, x, width: each * text.length, item: item++ };
        delete run.parts;
        delete run.extractionText;
        x += run.width;
        return run;
      });
      page.tokens.splice(at, 1, ...runs);
    }
  const runs = read(s);
  assert.deepEqual(runs.period, original.period);
  assert.deepEqual(runs.period, { start: '2026-07-01', end: '2026-07-31' });
  assert.deepEqual(runs.lines, original.lines);
});

void test('a heading must still state exactly one currency and two dates', async () => {
  const third = await source('BS01');
  for (const page of third.pages) {
    const line = page.tokens.find((t) => t.text.startsWith('Account:'))!;
    line.text = `${line.text} · Printed: 2026-08-02`;
    delete line.parts;
  }
  refused(third, 'SCOPE');
  const twice = await source('BS01');
  for (const page of twice.pages) {
    const line = page.tokens.find((t) => t.text.startsWith('Account:'))!;
    line.text = line.text.replace('SAR', 'SAR USD');
    delete line.parts;
  }
  refused(twice, 'SCOPE');
});

// G7: in a right-to-left table a writer may print a balance with its DR
// suffix as two runs, the suffix on the left («DR 78,720.47» for
// «78,720.47 DR»). Made here from the foundation's Arabic statements.

/** A balance token split into the two runs such a writer prints: DR on the
 * left, the amount on the right, within the token's own width. */
function splitDebit(page: NativePdfWordSource['pages'][number], t: Token, item: number) {
  const amount = t.text.replace(/ DR$/u, '');
  const unit = t.width / t.text.length;
  const mark = { ...t, text: 'DR', x: t.x, width: unit * 2, item };
  delete mark.parts;
  delete mark.extractionText;
  const value = { ...t, text: amount, x: t.x + unit * 3, width: unit * amount.length };
  delete value.parts;
  delete value.extractionText;
  page.tokens.splice(page.tokens.indexOf(t), 1, mark, value);
}
const withoutItems = (lines: { items: number[] }[]) =>
  lines.map((l) => ({ ...l, items: [] }));

void test('an overdrawn balance printed as DR and amount runs reads as the original (BS11)', async () => {
  const original = read(await source('BS11'));
  const s = await source('BS11');
  let item = 200000,
    split = 0;
  for (const page of s.pages)
    for (const t of page.tokens.filter((t) => t.text.endsWith(' DR'))) {
      splitDebit(page, t, item++);
      split++;
    }
  assert.ok(split > 10, `${split} overdrawn balances split`);
  const runs = read(s);
  assert.equal(runs.status, original.status);
  assert.deepEqual(withoutItems(runs.lines), withoutItems(original.lines));
});

void test('a DR run makes a balance negative only beside it in the balance column', async () => {
  const at = (s: NativePdfWordSource, text: string) =>
    s.pages[0].tokens.find((t) => t.text === text)!;
  const mark = (t: Token, x: number) => ({
    ...t,
    text: 'DR',
    x,
    width: 11.7,
    item: 300000,
    parts: undefined,
    extractionText: undefined,
  });
  // Beside the amount, on its left: the movement's balance is negative.
  const beside = await source('BS16');
  const balance = at(beside, '228,597.08');
  balance.x = 55.7;
  beside.pages[0].tokens.push(mark(balance, 41.5));
  const read16 = read(beside);
  const line = read16.lines.find((l) => l.kind === 'movement')!;
  assert.equal(line.balance, -22859708);
  assert.equal(read16.status, 'balance-broken');
  // The opening balance as well.
  const opening = await source('BS16');
  const first = at(opening, '279,499.00');
  first.x = 49.2;
  opening.pages[0].tokens.push(mark(first, 35));
  assert.equal(read(opening).lines[0].balance, -27949900);
  // On the right of the amount: not a suffix.
  const right = await source('BS16');
  right.pages[0].tokens.push(mark(at(right, '228,597.08'), 89.8));
  refused(right, 'FIELD');
  // Far from the amount.
  const far = await source('BS16');
  far.pages[0].tokens.push(mark(at(far, '228,597.08'), 15));
  refused(far, 'FIELD');
  // In the deposit column.
  const deposit = await source('BS16');
  deposit.pages[0].tokens.push(mark(at(deposit, '228,597.08'), 145.3));
  assert.throws(() => readBankStatementPdf(deposit), BankStatementReadError);
  // In a left-to-right table the suffix follows the amount on its right
  // (G8); on its left it is not a suffix.
  const ltr = await source('BS01');
  const [, , , first01] = ltr.pages[0].tokens
    .filter((t) => AMOUNT.test(t.text) && t.x > 500)
    .sort((a, b) => b.y - a.y);
  first01.x += 14;
  ltr.pages[0].tokens.push(mark(first01, first01.x - 14));
  refused(ltr, 'FIELD');
  const after = await source('BS01');
  const [, , , last01] = after.pages[0].tokens
    .filter((t) => AMOUNT.test(t.text) && t.x > 500)
    .sort((a, b) => b.y - a.y);
  last01.x -= 14;
  after.pages[0].tokens.push(mark(last01, last01.x + last01.width + 2.5));
  const read01 = read(after);
  assert.ok(read01.lines.some((l) => l.balance !== undefined && l.balance < 0));
  assert.equal(read01.status, 'balance-broken');
  // Right of it but far off.
  const farRight = await source('BS01');
  const [, , , away] = farRight.pages[0].tokens
    .filter((t) => AMOUNT.test(t.text) && t.x > 500)
    .sort((a, b) => b.y - a.y);
  away.x -= 30;
  farRight.pages[0].tokens.push(mark(away, away.x + away.width + 20));
  refused(farRight, 'FIELD');
});

/** A balance token split the way PDF.js splits a monospaced run at its
 * space: the amount, then DR on its right. */
function splitDebitRight(page: NativePdfWordSource['pages'][number], t: Token, item: number) {
  const amount = t.text.replace(/ DR$/u, '');
  const unit = t.width / t.text.length;
  const value = { ...t, text: amount, width: unit * amount.length };
  delete value.parts;
  delete value.extractionText;
  const mark = { ...t, text: 'DR', x: t.x + unit * (amount.length + 1), width: unit * 2, item };
  delete mark.parts;
  delete mark.extractionText;
  page.tokens.splice(page.tokens.indexOf(t), 1, value, mark);
}

void test('a left-to-right overdrawn balance printed as amount and DR runs reads as the original (BS15)', async () => {
  const original = read(await source('BS15'));
  const s = await source('BS15');
  let item = 400000,
    split = 0;
  for (const page of s.pages)
    for (const t of page.tokens.filter((t) => t.text.endsWith(' DR'))) {
      splitDebitRight(page, t, item++);
      split++;
    }
  assert.ok(split > 100, `${split} overdrawn balances split`);
  const runs = read(s);
  assert.equal(runs.status, original.status);
  assert.deepEqual(withoutItems(runs.lines), withoutItems(original.lines));
});

// G8: a writer that sets each bidirectional run apart prints an Arabic-Indic
// date in a right-to-left table as five touching runs, in visual order from
// the left: day, '-', month, '-', year.
const DATE_AR = /^[٠-٩]{2}-[٠-٩]{2}-[٠-٩]{4}$|^[٠-٩]{4}-[٠-٩]{2}-[٠-٩]{2}$/u;
function splitDate(page: NativePdfWordSource['pages'][number], t: Token, item: number, gap = 0) {
  const reading = t.extractionText ?? t.text;
  const [year, month, day] = /^[٠-٩]{4}/u.test(reading)
    ? reading.split('-')
    : reading.split('-').reverse();
  const runs = [day, '-', month, '-', year];
  const unit = t.width / 10;
  // A gap after the month moves the first runs left, inside the cell.
  let x = t.x - gap;
  const out = runs.map((text, k) => {
    const run = { ...t, text, x, width: unit * text.length, item: item + k, direction: text === '-' ? 'ltr' : 'rtl' };
    delete run.parts;
    delete run.extractionText;
    delete run.glyphText;
    x += unit * text.length + (k === 1 ? gap : 0);
    return run as Token;
  });
  page.tokens.splice(page.tokens.indexOf(t), 1, ...out);
}

void test('Arabic-Indic dates printed as touching runs read as the original (BS11)', async () => {
  const original = read(await source('BS11'));
  const s = await source('BS11');
  let item = 500000,
    split = 0;
  for (const page of s.pages)
    for (const t of page.tokens.filter((t) => DATE_AR.test(t.text))) {
      splitDate(page, t, item);
      item += 5;
      split++;
    }
  assert.ok(split > 20, `${split} dates split`);
  const runs = read(s);
  assert.equal(runs.status, original.status);
  assert.deepEqual(withoutItems(runs.lines), withoutItems(original.lines));
  // Runs set apart do not join: one date cell, two values.
  const apart = await source('BS11');
  // A movement's date: the rightmost column of the right-to-left table.
  const tableDate = (s: NativePdfWordSource) =>
    s.pages[0].tokens.filter((t) => DATE_AR.test(t.text)).sort((a, b) => b.x - a.x)[0];
  const first = tableDate(apart);
  splitDate(apart.pages[0], first, 600000, 4);
  refused(apart, 'FIELD');
  // Touching runs that make no date are not one.
  const wrong = await source('BS11');
  const one = tableDate(wrong);
  splitDate(wrong.pages[0], one, 700000);
  const runsOf = wrong.pages[0].tokens.filter((t) => t.item >= 700000 && t.item < 700005);
  runsOf[2].text = '١٣';
  refused(wrong, 'DATE');
});

void test('K09, fpdf2 Courier: a DR split from its balance holds the statement as balance-broken', async () => {
  // A G8 holdout statement, regression since G8 was fixed on it.
  const s = await readNativePdfWordSource(
    Uint8Array.from(
      await fsRead(new URL('../audit/bank-statement-holdout-g8/frozen/K09-statement.pdf', import.meta.url)),
    ).buffer,
  );
  assert.ok(s.pages[0].tokens.some((t) => t.text === 'DR'), 'DR arrives as its own run');
  const r = read(s);
  assert.equal(r.status, 'balance-broken');
  assert.ok(r.lines.some((l) => l.kind === 'movement' && l.balance! < 0));
});

void test('K05, Typst Arabic-Indic: dates as touching runs read in reading order', async () => {
  const s = await readNativePdfWordSource(
    Uint8Array.from(
      await fsRead(new URL('../audit/bank-statement-holdout-g8/frozen/K05-statement.pdf', import.meta.url)),
    ).buffer,
  );
  assert.ok(s.pages[0].tokens.some((t) => t.text === '-'), 'a date arrives as runs');
  const r = read(s);
  assert.equal(r.status, 'verified');
  assert.equal(r.lines[1].date, '2026-05-02');
});

void test('H04, LibreOffice Arabic: the lam-alef glyph read by glyph, PDF.js reading beside it', async () => {
  // A G6 holdout statement, regression since G7 was fixed on it.
  const s = await readNativePdfWordSource(
    Uint8Array.from(
      await fsRead(
        new URL(
          '../audit/bank-statement-holdout-g6/frozen/H04-statement.pdf',
          import.meta.url,
        ),
      ),
    ).buffer,
  );
  const label = s.pages[0].tokens.find((t) => t.text === 'الرصيد الافتتاحي')!;
  assert.ok(label, 'the opening label reads in its own letter order');
  assert.equal(label.extractionText, 'الرصيد االفتتاحي');
  const r = read(s);
  assert.equal(r.status, 'verified');
  assert.equal(r.lines[0].kind, 'opening');
  assert.ok(r.lines.some((l) => l.kind === 'movement' && l.balance! < 0));
});
