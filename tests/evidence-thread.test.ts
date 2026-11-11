import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetThread,
  bankThread,
  allocationThread,
  payrollBankThread,
  payrollThread,
  type Thread,
  type ThreadLabel,
} from '../lib/evidence-thread.ts';
import {
  assetFrozenNames,
  assetLongNames,
  fixedAssetsCase,
} from '../audit/reconciliation-sheet/fixed-assets-cases.ts';
import {
  payrollCase,
  payrollFrozenNames,
} from '../audit/reconciliation-sheet/payroll-cases.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import type { BankResult } from '../lib/reconciliation/bank.ts';
import type { AllocationResult } from '../lib/reconciliation/allocation.ts';

// The thread is held to the source bytes themselves: each file is read here
// with its own small CSV reader, not the engine's, and every cell the thread
// shows must be the text at that row and column, under that header.
function csv(bytes: ArrayBuffer): string[][] {
  const text = new TextDecoder('utf-8', { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/u, '');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const labelsOf = (files: readonly SourceFile[]): ThreadLabel[] =>
  files.map((f) => ({ name: f.name, sheet: f.sheets[0]?.name ?? null }));

/** Every source and cell of a thread, against the files read here. */
function heldToSources(
  thread: Thread,
  files: readonly SourceFile[],
  roles: readonly string[],
  what: string,
) {
  for (const s of thread) {
    assert.equal(s.name, files[s.source].name, `${what}: source name`);
    assert.equal(s.role, roles[s.source], `${what}: source role`);
    assert.ok('row' in s.place, `${what}: a row`);
    const rows = csv(files[s.source].original!);
    const row = rows[s.place.row - 1];
    assert.ok(row, `${what}: row ${s.place.row} is in ${s.name}`);
    assert.ok(s.cells, `${what}: cells kept`);
    assert.deepEqual(
      s.cells.map((c) => c.column),
      row.map((_, i) => i + 1),
      `${what}: every cell of row ${s.place.row}, in order`,
    );
    for (const c of s.cells) {
      assert.equal(c.text, row[c.column - 1], `${what}: cell text`);
      assert.equal(c.field, rows[0][c.column - 1] ?? '', `${what}: header`);
    }
  }
}

const ASSET_ROLES = ['register', 'mapping', 'policy-evidence', 'gl'];
const PAYROLL_ROLES = [
  'register',
  'mapping',
  'policy-evidence',
  'gl',
  'bank-payout',
];

void test('a fixed-assets comparison opens its GL row and the register rows the engine assigned to it, with every cell as the file has it', async () => {
  let comparisons = 0;
  for (const name of [...assetFrozenNames, ...assetLongNames]) {
    const { state, result } = await fixedAssetsCase(name);
    const labels = labelsOf(state.files);
    result.comparisons.forEach((comparison, i) => {
      const thread = assetThread(result, labels, i);
      const what = `${name} comparison ${i}`;
      assert.deepEqual(
        thread.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
        [
          [3, comparison.glRow],
          ...comparison.registerRows.map((r) => [0, r]),
        ],
        `${what}: the rows the engine names, GL first`,
      );
      heldToSources(thread, state.files, ASSET_ROLES, what);
      // The GL row is the one of the account and dimensions compared.
      const gl = thread[0].cells!;
      assert.equal(
        gl.find((c) => c.field === 'GL account')?.text,
        comparison.account,
        `${what}: the GL row's account`,
      );
      comparisons++;
    });
    assert.deepEqual(assetThread(result, labels, result.comparisons.length), []);
  }
  assert.ok(comparisons > 20, `${comparisons} comparisons read`);
});

void test('a payroll comparison opens its GL row and register rows, and the register net its bank payout rows, as the files have them', async () => {
  let comparisons = 0,
    banks = 0;
  for (const name of payrollFrozenNames) {
    const { state, result } = await payrollCase(name);
    const labels = labelsOf(state.files);
    result.comparisons.forEach((comparison, i) => {
      const thread = payrollThread(result, labels, i);
      const what = `${name} comparison ${i}`;
      assert.deepEqual(
        thread.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
        [
          [3, comparison.glRow],
          ...comparison.registerRows.map((r) => [0, r]),
        ],
        `${what}: the rows the engine names, GL first`,
      );
      heldToSources(thread, state.files, PAYROLL_ROLES, what);
      comparisons++;
    });
    const bank = payrollBankThread(result, labels);
    assert.deepEqual(
      bank.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
      result.bankComparison.bankRows.map((r) => [4, r]),
      `${name}: the bank rows the engine names`,
    );
    heldToSources(bank, state.files, PAYROLL_ROLES, `${name} bank`);
    banks += bank.length;
    assert.deepEqual(payrollThread(result, labels, -1), []);
  }
  assert.ok(comparisons > 20 && banks > 5, `${comparisons}, ${banks} read`);
});

void test('a bank movement and an allocation item open the row they were read from with the cells the reader traced, and an unknown row opens nothing', () => {
  const bank = {
    sources: [
      { name: 'statement.csv', hash: 'a', sheet: 'CSV', role: 'bank' },
      { name: 'cashbook.csv', hash: 'b', sheet: 'Book', role: 'cashbook' },
    ],
    records: [
      {
        id: 'r1',
        side: 1,
        row: 7,
        traces: [
          { field: 'Amount', column: 4, text: '1,250.00' },
          { field: 'Reference', column: 2, text: 'INV-77' },
        ],
      },
    ],
  } as unknown as BankResult;
  assert.deepEqual(bankThread(bank, 'r1'), [
    {
      source: 1,
      role: 'cashbook',
      name: 'cashbook.csv',
      sheet: 'Book',
      place: { row: 7 },
      cells: [
        { column: 4, field: 'Amount', text: '1,250.00' },
        { column: 2, field: 'Reference', text: 'INV-77' },
      ],
    },
  ]);
  assert.deepEqual(bankThread(bank, 'r2'), []);
  const allocation = {
    sources: [
      { name: 'payments.csv', hash: 'a', sheet: 'CSV', role: 'payments' },
      { name: 'invoices.csv', hash: 'b', sheet: 'CSV', role: 'invoices' },
    ],
    items: [
      {
        id: 'i1',
        side: 0,
        row: 3,
        traces: [
          { field: 'Original amount', column: 5, text: '90', amount: 9000 },
        ],
      },
    ],
  } as unknown as AllocationResult;
  assert.deepEqual(allocationThread(allocation, 'i1'), [
    {
      source: 0,
      role: 'payments',
      name: 'payments.csv',
      sheet: 'CSV',
      place: { row: 3 },
      cells: [{ column: 5, field: 'Original amount', text: '90' }],
    },
  ]);
  assert.deepEqual(allocationThread(allocation, 'missing'), []);
});
