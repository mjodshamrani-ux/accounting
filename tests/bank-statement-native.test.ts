import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import {
  BankStatementReadError,
  readBankStatementPdf,
  readBankStatementTable,
  statementAmount,
  statementDate,
} from '../lib/reconciliation/bank-statement-native.ts';
import { readNativePdfWordSource } from '../lib/reconciliation/pdf.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import type { NativePdfWordSource } from '../lib/reconciliation/pdf-native-source.ts';

// bank-statement-native-1 reading on the frozen BNK-PDF-1 statements. The
// full line-by-line proof of all sixteen is scripts/bank-statement-g1-proof;
// here each rule is held by a case that breaks it.

const frozen = (name: string) =>
  fsRead(
    new URL(
      `../audit/bank-statement-foundation/frozen/${name}`,
      import.meta.url,
    ),
  );
const sources = new Map<string, NativePdfWordSource>();
async function source(id: string) {
  if (!sources.has(id))
    sources.set(
      id,
      await readNativePdfWordSource(
        Uint8Array.from(await frozen(`${id}-statement.pdf`)).buffer,
      ),
    );
  return structuredClone(sources.get(id)!);
}
const token = (s: NativePdfWordSource, page: number, text: string) => {
  const found = s.pages[page - 1].tokens.filter((t) => t.text === text);
  assert.equal(found.length, 1, `one ${text} on page ${page}`);
  return found[0];
};
const refused = (s: NativePdfWordSource, code: string) =>
  assert.throws(
    () => readBankStatementPdf(s),
    (e: unknown) => e instanceof BankStatementReadError && e.code === code,
  );

void test('BS08: wrapped descriptions, a continuation and a merged header page', async () => {
  const r = readBankStatementPdf(await source('BS08'));
  assert.equal(r.status, 'verified');
  const movements = r.lines.filter((l) => l.kind === 'movement');
  assert.equal(
    movements[0].description,
    'Incoming transfer S0800000\nRef. beneficiary account ending 4417',
  );
  const continuation = r.lines.find((l) => l.kind === 'continuation')!;
  assert.equal(continuation.page, 2);
  assert.equal(
    continuation.text,
    'Cheque paid S0800008 (continued) Ref. beneficiary account ending 4417',
  );
  // The movement it continues keeps its own printed description.
  assert.equal(movements[8].description, 'Cheque paid S0800008');
  // Page 2's dates arrived merged in one item and were read from its parts.
  const page2 = movements.filter((l) => l.page === 2);
  assert.ok(page2.every((l) => l.date === l.valueDate));
  assert.equal(page2[0].date, '2026-07-20');
});

void test('BS11 and BS16: right-to-left tables, Arabic-Indic and Latin digits', async () => {
  const ar = readBankStatementPdf(await source('BS11'));
  assert.equal(ar.layout, 'ar');
  assert.equal(ar.status, 'verified');
  const first = ar.lines.find((l) => l.kind === 'movement')!;
  assert.deepEqual(
    [
      first.date,
      first.valueDate,
      first.reference,
      first.withdrawal,
      first.balance,
    ],
    ['2026-07-02', '2026-07-02', 'CHQ-S1100000', 8654482, -2540282],
  );
  // The heading's Latin dates follow Arabic text, so they print reversed.
  const latin = readBankStatementPdf(await source('BS16'));
  assert.deepEqual(latin.period, { start: '2026-07-01', end: '2026-07-31' });
  assert.equal(latin.status, 'verified');
});

void test('held statements: a printed balance off by 10.00, a missing page', async () => {
  const broken = readBankStatementPdf(await source('BS09'));
  assert.equal(broken.status, 'balance-broken');
  assert.match(broken.reason!, /printed balance 3711179 != 3710179/);
  const missing = readBankStatementPdf(await source('BS10'));
  assert.equal(missing.status, 'incomplete-pages');
  assert.equal(missing.reason, 'pages 1,3 of 3');
});

void test('changed facts hold the statement', async () => {
  const halala = await source('BS01');
  token(halala, 1, '149,657.19').text = '149,657.20';
  assert.equal(readBankStatementPdf(halala).status, 'balance-broken');

  const count = await source('BS01');
  token(count, 2, 'Page 2 of 2').text = 'Page 2 of 3';
  assert.equal(readBankStatementPdf(count).status, 'incomplete-pages');

  const order = await source('BS01');
  order.pages.reverse();
  order.pages.forEach((p, i) => (p.page = i + 1));
  assert.equal(readBankStatementPdf(order).status, 'incomplete-pages');

  const totals = await source('BS01');
  const line = totals.pages[1].tokens;
  const label = line.find((t) => t.text === 'Total withdrawals / deposits')!;
  const sums = line.filter((t) => Math.abs(t.y - label.y) < 1 && t !== label);
  assert.equal(sums.length, 2);
  sums[1].text = sums[1].text.replace(/\d$/, (d) =>
    String((Number(d) + 1) % 10),
  );
  assert.equal(readBankStatementPdf(totals).status, 'balance-broken');

  // A deposit moved under Withdrawal is read as a withdrawal, and the
  // printed balances then refuse it.
  const moved = await source('BS01');
  const deposit = token(moved, 1, '53,823.35');
  const withdrawal = token(moved, 1, '81,289.81');
  deposit.x = withdrawal.x + withdrawal.width - deposit.width;
  assert.equal(readBankStatementPdf(moved).status, 'balance-broken');
});

void test('layouts outside the declared form are refused with page and line', async () => {
  const heading = await source('BS01');
  token(heading, 2, 'Sample Commercial Bank').text =
    'Sample Commercial Bank Ltd';
  refused(heading, 'HEADING');

  const label = await source('BS01');
  const closing = token(label, 2, 'Closing balance');
  closing.text = 'Closing Balance';
  delete closing.parts;
  refused(label, 'COLUMN');

  const straddle = await source('BS01');
  const amount = token(straddle, 1, '81,289.81');
  amount.x -= 25;
  refused(straddle, 'COLUMN');

  const date = await source('BS01');
  date.pages[0].tokens.find((t) => t.text === '2026-07-02')!.text =
    '2026-07-32';
  refused(date, 'DATE');

  const orphan = await source('BS01');
  const opening = token(orphan, 1, 'Opening balance');
  orphan.pages[0].tokens.push({
    ...token(orphan, 1, 'Cheque paid S0100000'),
    item: 9999,
    y: opening.y - 6,
  });
  refused(orphan, 'LINE');

  const currencies = await source('BS01');
  const line = currencies.pages[0].tokens.find((t) =>
    t.text.startsWith('Account:'),
  )!;
  line.parts!.push({ text: 'USD', x: line.x + line.width + 4, width: 15 });
  refused(currencies, 'SCOPE');

  const issues = await source('BS01');
  issues.readingIssues.push({ page: 1, line: 3, reasons: ['overlap'] });
  refused(issues, 'READING');
});

void test('page totals must equal their own page (70-page BS14)', async () => {
  const long = await source('BS14');
  const page = long.pages[39].tokens;
  const label = page.find(
    (t) => t.text === 'Page total withdrawals / deposits',
  )!;
  const amount = page.find(
    (t) => Math.abs(t.y - label.y) < 1 && t !== label && /\d$/.test(t.text),
  )!;
  amount.text = amount.text.replace(/\d$/, (d) => String((Number(d) + 1) % 10));
  const r = readBankStatementPdf(long);
  assert.equal(r.status, 'balance-broken');
  assert.match(r.reason!, /page 40: page totals/);
});

void test('a continuation needs the last movement of the previous page', async () => {
  // Page 1 without its movements: its last line is no longer a movement,
  // so description text at the top of page 2 continues nothing.
  const s = await source('BS01');
  const keep = new Set(['Opening balance', 'Balance carried forward']);
  const first = s.pages[0].tokens;
  const table = first.find((t) => t.text === 'Opening balance')!.y;
  const footer = first.find((t) => t.text === 'Page 1 of 2')!.y;
  s.pages[0].tokens = first.filter(
    (t) =>
      t.y > table + 1 ||
      t.y < footer + 1 ||
      keep.has(t.text) ||
      first.some((k) => keep.has(k.text) && Math.abs(k.y - t.y) < 1),
  );
  const second = s.pages[1].tokens;
  const forward = second.find((t) => t.text === 'Balance brought forward')!;
  second.push({
    ...second.find(
      (t) => t.text.startsWith('Cheque paid') || t.text.startsWith('Incoming'),
    )!,
    item: 9999,
    y: forward.y - 6,
  });
  refused(s, 'LINE');
});

void test('a combined item is never divided without proved word parts', async () => {
  const header = await source('BS08');
  delete token(header, 2, 'Withdrawal Deposit').parts;
  refused(header, 'HEADER');
  const dates = await source('BS08');
  delete dates.pages[1].tokens.find(
    (t) => t.extractionText === '2026-07-20 2026-07-20',
  )!.parts;
  refused(dates, 'COLUMN');
});

void test('amount grammar: grouping, decimals, DR only for balances', () => {
  assert.equal(statementAmount('1,234.56', 2, false), 123456);
  assert.equal(statementAmount('1234.56', 2, false), 123456);
  assert.equal(statementAmount('٢٥٬٤٠٢٫٨٢ DR', 2, true), -2540282);
  assert.equal(statementAmount('45.00 DR', 2, true), -4500);
  for (const [text, debit] of [
    ['45.00 DR', false],
    ['1,234.5', false],
    ['1,234.567', false],
    ['12,34.56', false],
    ['-12.00', true],
    ['(12.00)', true],
    ['99999999999999999.00', false],
  ] as const)
    assert.equal(statementAmount(text, 2, debit), undefined, text);
  assert.equal(statementAmount('1,234.567', 3, false), 1234567);
});

void test('date readings: one ISO date, reversed segments only right to left', () => {
  assert.equal(statementDate(['2026-07-01'], 'en'), '2026-07-01');
  assert.equal(statementDate(['01-07-2026'], 'en'), undefined);
  assert.equal(statementDate(['01-07-2026'], 'ar'), '2026-07-01');
  assert.equal(statementDate(['٠٢-٠٧-٢٠٢٦', '٢٠٢٦-٠٧-٠٢'], 'ar'), '2026-07-02');
  assert.equal(statementDate(['2026-02-30'], 'en'), undefined);
  assert.equal(statementDate(['2026-07-01', '2026-01-07'], 'ar'), undefined);
});

void test('a statement exported as a table: completeness needs a closing balance', async () => {
  const csv = (await frozen('BS01-statement.csv')).toString('utf8');
  const table = async (text: string) =>
    readBankStatementTable(
      await readFile('statement.csv', new TextEncoder().encode(text).buffer),
      'SAR',
    );
  const plain = await table(csv);
  assert.equal(plain.status, 'completeness-unproven');
  const last = csv.trim().split('\r\n').at(-1)!.split(',').at(-1)!;
  assert.equal(
    (await table(`${csv},,Closing balance,,,,${last}\r\n`)).status,
    'verified',
  );
  assert.equal(
    (
      await table(
        `${csv},,Closing balance,,,,${(Number(last) + 0.01).toFixed(2)}\r\n`,
      )
    ).status,
    'balance-broken',
  );
  await assert.rejects(
    table(csv.replace('Value Date', 'Value date')),
    /HEADER/,
  );
  const rows = csv.split('\r\n');
  const deposit = rows.findIndex((r) => /,,\d+\.\d{2},/.test(r));
  rows[deposit] = rows[deposit].replace(/,,(\d+\.\d{2}),/, ',1.00,$1,');
  await assert.rejects(table(rows.join('\r\n')), /AMOUNT/);
  await assert.rejects(
    table(
      `${csv},,Closing balance,,,,${last}\r\n2026-07-31,2026-07-31,x,,1.00,,1.00\r\n`,
    ),
    /LINE/,
  );
});
