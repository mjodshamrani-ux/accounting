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
