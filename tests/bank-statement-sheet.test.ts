import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookBalance,
  reconciliationSheet,
  sheetFingerprint,
  type ReconciliationSheet,
  type SheetOutcome,
} from '../lib/reconciliation/bank-statement-sheet.ts';
import type { BankStatementResult } from '../lib/reconciliation/bank-statement-lifecycle.ts';

// A settled period with only what the sheet reads: the reading's closing
// line, the period, the movements and entries, the cases, the outstanding
// items and, for a period that carries, the roll.
const PERIOD = { start: '2026-11-01', end: '2026-11-30' };
const OCT = { start: '2026-10-01', end: '2026-10-31' };
type Item = [id: string, direction: 'in' | 'out', amount: number];
function period({
  closing = 1_000_00,
  statement = [] as Item[],
  cashbook = [] as Item[],
  cases = [] as Partial<BankStatementResult['cases'][number]>[],
  outstanding = [] as BankStatementResult['outstanding'],
  roll = undefined as unknown,
  status = 'reviewed',
  format = 'pdf',
} = {}) {
  return {
    status,
    sources: [
      { role: 'statement', name: 's.pdf', sha256: 'a'.repeat(64), format },
      { role: 'cashbook', name: 'c.csv', sha256: 'b'.repeat(64), format: 'csv' },
    ],
    reading: {
      format,
      currency: 'SAR',
      decimals: 2,
      closing,
      lines: [
        { kind: 'opening', page: 1, items: [] },
        { kind: 'closing', page: 2, items: [] },
      ],
    },
    match: {
      statement: { period: PERIOD },
      movements: statement.map(([id, direction, amount], i) => ({
        id, page: 1, items: [], date: '2026-11-10', valueDate: '2026-11-10', description: '', reference: `R-${id}`, direction, amount, balance: i,
      })),
      cashbook: cashbook.map(([id, direction, amount], i) => ({
        id, row: i + 2, date: '2026-11-09', description: '', reference: `R-${id}`, direction, amount,
      })),
    },
    cases: cases.map((c, i) => ({ id: `C${i + 1}`, kind: 'review', reference: '', statement: [], cashbook: [], decision: null, ...c })),
    outstanding,
    roll,
  } as unknown as BankStatementResult;
}
const sheetOf = (outcome: SheetOutcome): ReconciliationSheet => {
  assert.equal(outcome.refusal, null);
  return (outcome as { sheet: ReconciliationSheet }).sheet;
};
const book = (balance: number, note = 'General ledger') => ({ balance, note });
const listed = (s: ReconciliationSheet) =>
  Object.entries(s.sections).flatMap(([name, x]) =>
    x.items.map((i) => `${name}:${i.id}:${i.origin}${i.reason ? `:${i.reason}` : ''}${i.age === null ? '' : `:${i.age}`}`),
  );

void test('a balanced sheet lists each item in its section and adds up', () => {
  const s = sheetOf(
    reconciliationSheet(
      period({
        closing: 10_000_00,
        statement: [['S1', 'out', 20_00], ['S2', 'in', 5_00]],
        cashbook: [['PV-1', 'out', 300_00], ['RV-1', 'in', 120_00]],
        outstanding: [
          { side: 'statement', id: 'S1', origin: 'unmatched' },
          { side: 'statement', id: 'S2', origin: 'unmatched' },
          { side: 'cashbook', id: 'PV-1', origin: 'unmatched' },
          { side: 'cashbook', id: 'RV-1', origin: 'unmatched' },
        ],
      }),
      // bank 10,000.00 + 120.00 - 300.00 = 9,820.00 = book + 5.00 - 20.00
      book(9_835_00),
    ),
  );
  assert.equal(s.status, 'reconciled');
  assert.deepEqual(listed(s), [
    'bookReceiptsNotOnStatement:RV-1:unmatched',
    'bookPaymentsNotOnStatement:PV-1:unmatched',
    'statementDepositsNotInBook:S2:unmatched',
    'statementWithdrawalsNotInBook:S1:unmatched',
  ]);
  assert.deepEqual([s.adjustedBank, s.adjustedBook, s.difference], [9_820_00, 9_820_00, 0]);
  assert.deepEqual(s.bank, { balance: 10_000_00, page: 2 });
  assert.deepEqual(
    Object.values(s.sections).map((x) => x.total),
    [120_00, 300_00, 5_00, 20_00],
  );
});

void test('equal and opposite items are both listed, never netted', () => {
  const s = sheetOf(
    reconciliationSheet(
      period({
        cashbook: [['RV-1', 'in', 500_00], ['PV-1', 'out', 500_00]],
        outstanding: [
          { side: 'cashbook', id: 'RV-1', origin: 'unmatched' },
          { side: 'cashbook', id: 'PV-1', origin: 'unmatched' },
        ],
      }),
      book(1_000_00),
    ),
  );
  assert.equal(s.status, 'reconciled');
  assert.equal(s.sections.bookReceiptsNotOnStatement.total, 500_00);
  assert.equal(s.sections.bookPaymentsNotOnStatement.total, 500_00);
});

void test('a difference stays a difference: one minor unit, or the amount of a listed item', () => {
  const one = sheetOf(reconciliationSheet(period(), book(1_000_00 - 1)));
  assert.deepEqual([one.status, one.difference], ['difference', 1]);
  const cheque = sheetOf(
    reconciliationSheet(
      period({ cashbook: [['PV-1', 'out', 230_00]], outstanding: [{ side: 'cashbook', id: 'PV-1', origin: 'unmatched' }] }),
      book(1_000_00),
    ),
  );
  assert.deepEqual([cheque.status, cheque.difference], ['difference', -230_00]);
});

void test('a case awaiting a decision makes a draft; its members are pending even when listed unmatched', () => {
  const s = sheetOf(
    reconciliationSheet(
      period({
        statement: [['S1', 'in', 64_50]],
        cashbook: [['RV-1', 'in', 64_50]],
        cases: [{ reason: 'amount-date-suggestion', status: 'needs-review', statement: ['S1'], cashbook: ['RV-1'] }],
        outstanding: [{ side: 'statement', id: 'S1', origin: 'unmatched' }],
      }),
      book(1_000_00),
    ),
  );
  assert.equal(s.difference, 0);
  assert.equal(s.status, 'draft');
  assert.deepEqual(listed(s), [
    'bookReceiptsNotOnStatement:RV-1:pending:amount-date-suggestion',
    'statementDepositsNotInBook:S1:pending:amount-date-suggestion',
  ]);
});

void test('a rejected case leaves its members listed with the case; accepted and automatic ones clear', () => {
  const s = sheetOf(
    reconciliationSheet(
      period({
        statement: [['S1', 'out', 1_250_00], ['S2', 'in', 9_00], ['S3', 'out', 7_00]],
        cashbook: [['PV-1', 'out', 1_205_00], ['RV-2', 'in', 9_00], ['PV-3', 'out', 7_00]],
        cases: [
          { kind: 'automatic', reason: 'reference', status: 'matched-automatic', statement: ['S3'], cashbook: ['PV-3'] },
          { reason: 'amount-difference', status: 'rejected', statement: ['S1'], cashbook: ['PV-1'], decision: 'D1' },
          { reason: 'amount-date-suggestion', status: 'matched-accepted', statement: ['S2'], cashbook: ['RV-2'], decision: 'D2' },
        ],
        outstanding: [
          { side: 'statement', id: 'S1', origin: 'C2' },
          { side: 'cashbook', id: 'PV-1', origin: 'C2' },
        ],
      }),
      book(1_000_00 - 1_250_00 + 1_205_00 + 1_250_00 - 1_205_00),
    ),
  );
  assert.deepEqual(listed(s), [
    'bookPaymentsNotOnStatement:PV-1:rejected:amount-difference',
    'statementWithdrawalsNotInBook:S1:rejected:amount-difference',
  ]);
  assert.equal(s.sections.bookPaymentsNotOnStatement.items[0].case, 'C2');
});

void test('carried items: outstanding with their age, rejected with their case, pending a year older', () => {
  const carried = (id: string, age: number, row: number) => ({
    key: `C:${id}@2026-10-31`, side: 'cashbook', id, page: null, row, period: OCT, date: '2026-10-30',
    direction: 'out', amount: 100_00, reference: `R-${id}`, origin: 'unmatched', age, source: 'c'.repeat(64), session: 'd'.repeat(64),
  });
  const roll = {
    previous: { name: 'p.json', sha256: 'e'.repeat(64), status: 'accepted' },
    carried: [carried('PV-7', 1, 7), carried('PV-5', 1, 5), carried('PV-6', 2, 6)],
    withheld: { statement: [], cashbook: [] },
    outstanding: [
      { ...carried('PV-7', 2, 7) },
      { ...carried('PV-5', 2, 5) },
    ],
  };
  const s = sheetOf(
    reconciliationSheet(
      period({
        statement: [['S1', 'out', 100_00], ['S2', 'out', 99_00]],
        cases: [
          { kind: 'carried', reason: 'carried-amount-difference', status: 'rejected', statement: ['S2'], carried: ['C:PV-7@2026-10-31'], decision: 'D1' },
          { kind: 'carried', reason: 'carried-reference', status: 'needs-review', statement: ['S1'], carried: ['C:PV-6@2026-10-31'] },
        ],
        outstanding: [{ side: 'statement', id: 'S2', origin: 'C1' }],
        roll,
      }),
      book(0),
    ),
  );
  assert.deepEqual(listed(s), [
    'bookPaymentsNotOnStatement:PV-5:carried:2',
    'bookPaymentsNotOnStatement:PV-6:pending:carried-reference:3',
    'bookPaymentsNotOnStatement:PV-7:rejected:carried-amount-difference:2',
    'statementWithdrawalsNotInBook:S1:pending:carried-reference',
    'statementWithdrawalsNotInBook:S2:rejected:carried-amount-difference',
  ]);
  assert.equal(s.status, 'draft');
  assert.deepEqual(s.sections.bookPaymentsNotOnStatement.items[0].period, OCT);
});

void test('items come earlier periods first, then statement order and row order', () => {
  const ids = Array.from({ length: 11 }, (_, i) => `S${11 - i}`);
  const s = sheetOf(
    reconciliationSheet(
      period({
        statement: ids.map((id) => [id, 'out', 1_00] as Item),
        outstanding: ids.map((id) => ({ side: 'statement' as const, id, origin: 'unmatched' })),
      }),
      book(1_011_00),
    ),
  );
  assert.deepEqual(
    s.sections.statementWithdrawalsNotInBook.items.map((i) => i.id),
    ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11'],
  );
});

void test('an overdrawn account keeps its signs', () => {
  const s = sheetOf(
    reconciliationSheet(
      period({ closing: -48_249_50, cashbook: [['PV-1', 'out', 1_333_00]], outstanding: [{ side: 'cashbook', id: 'PV-1', origin: 'unmatched' }] }),
      book(-49_582_50),
    ),
  );
  assert.deepEqual([s.status, s.adjustedBank, s.difference], ['reconciled', -49_582_50, 0]);
});

void test('refusals in the contract order', () => {
  const refused = { name: 'p.json', sha256: 'e'.repeat(64), status: 'refused', code: 'ROLL_CURRENCY', detail: '' };
  const roll = { previous: refused, carried: [], withheld: { statement: [], cashbook: [] }, outstanding: [] };
  assert.deepEqual(reconciliationSheet(period({ status: 'held', roll }), null), { refusal: 'SHEET_STATEMENT_HELD' });
  assert.deepEqual(reconciliationSheet(period({ closing: null as unknown as number }), book(0)), { refusal: 'SHEET_STATEMENT_HELD' });
  assert.deepEqual(reconciliationSheet(period({ roll }), null), { refusal: 'SHEET_PREVIOUS_REFUSED' });
  assert.deepEqual(reconciliationSheet(period(), null), { refusal: 'SHEET_NO_BOOK_BALANCE' });
  assert.throws(() => reconciliationSheet(period({ format: 'csv' }), book(0)), /BANK_SHEET_FORMAT/u);
});

void test('a declared book balance is an integer of minor units with a plain note', () => {
  assert.deepEqual(bookBalance({ balance: -5, note: '' }), { balance: -5, note: '' });
  for (const bad of [
    { balance: 1.5, note: '' },
    { balance: 2 ** 53, note: '' },
    { balance: '100', note: '' },
    { balance: 1, note: 'x'.repeat(201) },
    { balance: 1, note: 'a\u202eb' },
    { balance: 1, note: '', extra: 1 },
    { balance: 1 },
    null,
  ])
    assert.throws(() => bookBalance(bad), /BANK_SHEET_BOOK/u, JSON.stringify(bad));
  assert.throws(() => reconciliationSheet(period(), { balance: 1.5, note: '' }), /BANK_SHEET_BOOK/u);
});

void test('the fingerprint covers every field and ignores key order', async () => {
  const s = sheetOf(reconciliationSheet(period({ cashbook: [['PV-1', 'out', 5_00]], outstanding: [{ side: 'cashbook', id: 'PV-1', origin: 'unmatched' }] }), book(995_00)));
  const f = await sheetFingerprint(s);
  assert.match(f, /^[0-9a-f]{64}$/u);
  const reversed = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reversed)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed((v as Record<string, unknown>)[k])]))
        : v;
  assert.notEqual(JSON.stringify(reversed(s)), JSON.stringify(s));
  assert.equal(await sheetFingerprint(reversed(s) as ReconciliationSheet), f);
  assert.equal(await sheetFingerprint(structuredClone(s)), f);
  const note = structuredClone(s);
  note.book.note = 'Trial balance';
  assert.notEqual(await sheetFingerprint(note), f);
  const item = structuredClone(s);
  item.sections.bookPaymentsNotOnStatement.items[0].reference = 'R-other';
  assert.notEqual(await sheetFingerprint(item), f);
});
