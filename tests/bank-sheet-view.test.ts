import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  replaySheetStatement,
  replayBankStatement,
} from '../lib/reconciliation/bank-statement-lifecycle.ts';
import {
  snapshotSheetInputs,
  type SheetInputs,
} from '../lib/reconciliation/bank-statement-request.ts';
import {
  sheetInputs,
  sheetSignoff,
  sheetStatementState,
  statementError,
  statementState,
} from '../lib/reconciliation/bank-statement-view.ts';

// What the bank workspace sends for a closing sheet (REPORT-1 R3). The
// lifecycle is the authority: every input the screen applies is one it
// admits, and a sign-off is offered only on a sheet it fingerprinted.

const frozen = (name: string) =>
  readFile(
    new URL(`../audit/bank-sheet-foundation/frozen/${name}`, import.meta.url),
  );
const source = async (name: string) => {
  const bytes = await frozen(name);
  return {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    original: Uint8Array.from(bytes).buffer,
  };
};
const NONE = { currency: null, period: null, confirmedClosing: null };
const period = async (id: string) =>
  [
    await source(`${id}-statement.pdf`),
    await source(`${id}-cashbook.csv`),
  ] as const;
const EMPTY: SheetInputs = {
  book: null,
  language: 'en',
  prepared: null,
  reviewed: null,
};

void test('a sheet state is the printed statement path, with or without a previous file', async () => {
  const [statement, cashbook] = await period('T02-NOV');
  const alone = sheetStatementState(statement, cashbook, [], null, EMPTY);
  assert.deepEqual(
    [alone.version, alone.scope, alone.previous, alone.files.length],
    ['bank-reconciliation-sheet-1', NONE, null, 2],
  );
  const { result } = await replaySheetStatement(alone);
  assert.equal(result.sheet?.outcome.refusal, 'SHEET_NO_BOOK_BALANCE');
  const [december, cashbookDecember] = await period('T23-DEC');
  const chained = sheetStatementState(
    december,
    cashbookDecember,
    [],
    await source('T23-previous-session.json'),
    EMPTY,
  );
  const carried = (await replaySheetStatement(chained)).result;
  assert.equal(carried.roll?.previous.status, 'accepted');
});

void test('the sheet inputs are read as typed, never rounded, and the lifecycle admits every one applied', () => {
  const signed = {
    name: 'Prepared by A. Accountant',
    date: '2026-12-02',
    fingerprint: 'a'.repeat(64),
  };
  const current: SheetInputs = { ...EMPTY, prepared: signed };
  const cases: [string, string, number, SheetInputs | 'book' | 'note'][] = [
    ['', '', 2, { ...current, book: null }],
    [
      ' 1,234.50 ',
      ' General ledger ',
      2,
      { ...current, book: { balance: 123450, note: 'General ledger' } },
    ],
    ['-49582.50', '', 2, { ...current, book: { balance: -4958250, note: '' } }],
    [
      '١٢٣٫٤٥',
      'دفتر الأستاذ',
      2,
      { ...current, book: { balance: 12345, note: 'دفتر الأستاذ' } },
    ],
    ['1250', '', 0, { ...current, book: { balance: 1250, note: '' } }],
    ['1,234.5', '', 2, 'book'],
    ['1234', '', 2, 'book'],
    ['1,234.500', '', 3, { ...current, book: { balance: 1234500, note: '' } }],
    ['+12.00', '', 2, 'book'],
    ['twelve', '', 2, 'book'],
    ['', 'General ledger', 2, 'note'],
    ['12.00', 'x'.repeat(201), 2, 'note'],
    [
      '12.00',
      'x'.repeat(200),
      2,
      { ...current, book: { balance: 1200, note: 'x'.repeat(200) } },
    ],
    ['12.00', 'ledger \u202e', 2, 'note'],
    ['12.00', 'line\nbreak', 2, 'note'],
  ];
  for (const [balance, note, decimals, want] of cases) {
    const got = sheetInputs(current, balance, note, 'en', decimals);
    assert.deepEqual(got, want, `${balance} | ${note}`);
    if (typeof got !== 'string')
      assert.deepEqual(snapshotSheetInputs(got), got, `${balance} admitted`);
  }
  assert.equal(
    (sheetInputs(null, '', '', 'ar', 2) as SheetInputs).language,
    'ar',
  );
});

void test('a sign-off is offered only on a fingerprinted sheet, with a name and a day the session admits', async () => {
  const [statement, cashbook] = await period('T02-NOV');
  const plain = (
    await replayBankStatement(statementState(statement, cashbook, NONE, []))
  ).result;
  assert.equal(sheetSignoff(plain, 'A. Accountant', '2026-12-02'), null);
  const refused = (
    await replaySheetStatement(
      sheetStatementState(statement, cashbook, [], null, EMPTY),
    )
  ).result;
  assert.equal(refused.sheet?.fingerprint, null);
  assert.equal(sheetSignoff(refused, 'A. Accountant', '2026-12-02'), null);
  const inputs: SheetInputs = {
    ...EMPTY,
    book: { balance: 65754546, note: 'General ledger' },
  };
  const state = sheetStatementState(statement, cashbook, [], null, inputs);
  const { result } = await replaySheetStatement(state);
  assert.match(result.sheet?.fingerprint ?? '', /^[a-f0-9]{64}$/u);
  for (const [name, date] of [
    ['', '2026-12-02'],
    ['   ', '2026-12-02'],
    ['x'.repeat(121), '2026-12-02'],
    ['A. Accountant', ''],
    ['A. Accountant', '2026-02-30'],
    ['A. Accountant', '02/12/2026'],
    ['A.\u200fAccountant', '2026-12-02'],
  ])
    assert.equal(sheetSignoff(result, name, date), null, `${name} ${date}`);
  const signoff = sheetSignoff(result, '  A. Accountant ', '2026-12-02');
  assert.deepEqual(signoff, {
    name: 'A. Accountant',
    date: '2026-12-02',
    fingerprint: result.sheet!.fingerprint,
  });
  const signed = await replaySheetStatement({
    ...state,
    sheet: { ...inputs, prepared: signoff },
  });
  assert.equal(signed.result.sheet?.prepared?.valid, true);
  assert.equal(
    sheetSignoff(result, 'x'.repeat(120), '2026-12-02')?.name.length,
    120,
  );
});

void test('sheet refusals are named as such', () => {
  for (const message of [
    'BANK_STATEMENT_SHEET',
    'BANK_SHEET_BOOK',
    'BANK_SHEET_FORMAT',
  ])
    assert.equal(statementError(message), 'sheet', message);
  assert.equal(statementError('BANK_SHEETS'), 'other');
});
