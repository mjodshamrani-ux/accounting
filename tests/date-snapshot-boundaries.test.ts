import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  IC_HEADERS,
  IC_ROLES,
  IC_VERSION,
  reconcileIntercompany,
  type IntercompanyInput,
  type IntercompanyResult,
} from '../lib/reconciliation/intercompany.ts';
import { readIntercompanyFile } from '../lib/reconciliation/intercompany-source.ts';
import {
  replayIntercompany,
  saveIntercompany,
  restoreIntercompany,
} from '../lib/reconciliation/intercompany-io.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileClearing,
  type ClearingInput,
  type ClearingResult,
} from '../lib/reconciliation/clearing.ts';
import {
  replayClearing,
  saveClearing,
  restoreClearing,
  exportClearing,
} from '../lib/reconciliation/clearing-io.ts';

// All fixtures are small, local synthetic tables. Financial expectations were
// specified independently: 12.34 + 5.67 = 18.01 SAR, or 1801 minor units.
const encode = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((row) => row.join(',')).join('\n')).buffer;

async function intercompanyInput(
  posting = '2024-02-29',
  edit?: { source: number; field: string; value: string },
): Promise<IntercompanyInput> {
  const year = posting.slice(0, 4);
  const scope: IntercompanyInput['scope'] = {
    entityA: 'Synthetic A',
    entityB: 'Synthetic B',
    ledgerA: 'Ledger A',
    ledgerB: 'Ledger B',
    accountA: '00100',
    accountB: '00200',
    dimensionsA: 'Dept A',
    dimensionsB: 'Dept B',
    currency: 'SAR',
    currencyBasis: 'functional',
    fxPolicy: 'same-currency-no-conversion',
    postingStatus: 'posted',
    postingLayer: 'actual',
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    asOf: `${year}-12-31`,
    policyVersion: 'synthetic-1',
    confirmed: true,
  };
  const shared: Record<string, string> = {
    'Entity A': scope.entityA,
    'Entity B': scope.entityB,
    'Ledger A': scope.ledgerA,
    'Ledger B': scope.ledgerB,
    'Account A': scope.accountA,
    'Account B': scope.accountB,
    'Dimensions A': scope.dimensionsA,
    'Dimensions B': scope.dimensionsB,
    Currency: scope.currency,
    'Currency basis': scope.currencyBasis,
    'FX policy': scope.fxPolicy,
    'Posting status': scope.postingStatus,
    'Posting layer': scope.postingLayer,
    'Period start': scope.start,
    'Period end': scope.end,
    'As of': scope.asOf,
    'Policy version': scope.policyVersion,
  };
  const tables: string[][][] = IC_HEADERS.map((header) => [[...header]]);
  for (const [index, money] of ['12.34', '5.67'].entries()) {
    for (let source = 0; source < 2; source++) {
      const left = source === 0;
      const record = {
        ...shared,
        Entity: left ? scope.entityA : scope.entityB,
        Counterparty: left ? scope.entityB : scope.entityA,
        Ledger: left ? scope.ledgerA : scope.ledgerB,
        'Account ID': left ? scope.accountA : scope.accountB,
        'Complete dimensions': left ? scope.dimensionsA : scope.dimensionsB,
        'Transaction ID': `${left ? 'A' : 'B'}-${index + 1}`,
        'Counterparty transaction ID': `${left ? 'B' : 'A'}-${index + 1}`,
        'Posting date': posting,
        Debit: left ? money : '0.00',
        Credit: left ? '0.00' : money,
      };
      tables[source].push(
        IC_HEADERS[source].map(
          (header) => record[header as keyof typeof record],
        ),
      );
    }
    const relation = {
      ...shared,
      'Relation ID': `R-${index + 1}`,
      'Left transaction ID': `A-${index + 1}`,
      'Right transaction ID': `B-${index + 1}`,
      'Left account': scope.accountA,
      'Left dimensions': scope.dimensionsA,
      'Right account': scope.accountB,
      'Right dimensions': scope.dimensionsB,
      'Left posting date': posting,
      'Right posting date': posting,
      'Valid from': scope.start,
      'Valid to': scope.end,
      'Relationship reference': `Synthetic relationship ${index + 1}`,
    };
    tables[2].push(
      IC_HEADERS[2].map((header) => relation[header as keyof typeof relation]),
    );
  }
  if (edit) {
    if (edit.source === 3) {
      const timing = {
        ...shared,
        'Evidence ID': 'Synthetic timing',
        Side: 'left',
        'Transaction ID': 'A-late',
        'Counterparty transaction ID': 'B-late',
        'Counterparty posting date': '2025-01-01',
        'Expected counterparty amount': '12.34',
        'Timing reference': 'Synthetic timing reference',
      };
      tables[3].push(
        IC_HEADERS[3].map((header) => timing[header as keyof typeof timing]),
      );
    }
    const column = tables[edit.source][0].indexOf(edit.field);
    assert.notEqual(column, -1);
    tables[edit.source][1][column] = edit.value;
  }
  const files = await Promise.all(
    tables.map((rows, source) =>
      readIntercompanyFile(`synthetic-${IC_ROLES[source]}.csv`, encode(rows)),
    ),
  );
  return {
    files: files as IntercompanyInput['files'],
    readings: IC_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: IC_VERSION,
      confirmed: true,
    })) as IntercompanyInput['readings'],
    scope,
    completeness: {
      confirmed: true,
      reference: 'Synthetic inventory declaration',
      note: 'Explicit local synthetic inputs only',
    },
    events: [],
  };
}

function assertDateInventory(
  result: IntercompanyResult,
  input: IntercompanyInput,
  source: number,
  field: string,
  value: string,
) {
  assert.equal(result.status, 'source-error');
  assert.equal(result.totals, null);
  assert.ok(result.pairs.every((pair) => pair.residual === null));
  assert.ok(result.pairs.every((pair) => pair.review !== 'accepted'));
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DATE' && issue.source === source && issue.row === 2,
    ),
  );
  const row = result.inventory.find(
    (item) => item.source === source && item.row === 2,
  )!;
  assert.equal(row.kind, 'error');
  assert.ok(row.errors.includes('DATE'));
  assert.deepEqual(row.values, input.files[source].sheets[0].rows[1]);
  const column = input.files[source].sheets[0].rows[0].indexOf(field) + 1;
  assert.ok(
    result.cells.some(
      (cell) =>
        cell.source === source &&
        cell.row === 2 &&
        cell.column === column &&
        cell.field === field &&
        cell.text === value,
    ),
  );
  for (let index = 0; index < 4; index++) {
    assert.deepEqual(
      result.inventory
        .filter((item) => item.source === index)
        .map((item) => item.values),
      input.files[index].sheets[0].rows,
    );
  }
  assert.equal(result.inventory.length, source === 3 ? 11 : 10);
  assert.equal(result.sources[source].name, input.files[source].name);
  assert.equal(result.sources[source].hash, input.files[source].sha256);
}

void test('intercompany impossible dates and year zero retain source, row and all cells in engine and replay', async () => {
  const fields = [
    [0, 'Posting date'],
    [1, 'Posting date'],
    [2, 'Left posting date'],
    [2, 'Right posting date'],
    [2, 'Valid from'],
    [2, 'Valid to'],
    [3, 'Counterparty posting date'],
  ] as const;
  for (const value of ['2026-02-30', '0000-09-12']) {
    for (const [source, field] of fields) {
      const input = await intercompanyInput('2024-02-29', {
        source,
        field,
        value,
      });
      assertDateInventory(
        reconcileIntercompany(input),
        input,
        source,
        field,
        value,
      );
      const { result } = await replayIntercompany(input);
      assertDateInventory(result, input, source, field, value);
    }
  }
});

void test('intercompany leap days and supported year bounds preserve independently specified money', async () => {
  for (const date of ['1900-01-01', '2000-02-29', '2024-02-29', '2100-12-31']) {
    const input = await intercompanyInput(date);
    const { result } = await replayIntercompany(input);
    assert.equal(result.status, 'needs-review', date);
    assert.equal(result.inventory.length, 10, date);
    assert.equal(result.issues.length, 0, date);
    assert.deepEqual(
      result.totals,
      [
        { debit: 1801, credit: 0, net: 1801 },
        { debit: 0, credit: 1801, net: -1801 },
      ],
      date,
    );
    assert.deepEqual(
      result.left.map((row) => [row.transactionId, row.date, row.net]),
      [
        ['A-1', date, 1234],
        ['A-2', date, 567],
      ],
    );
    assert.deepEqual(
      result.right.map((row) => [row.transactionId, row.date, row.net]),
      [
        ['B-1', date, -1234],
        ['B-2', date, -567],
      ],
    );
  }
  for (const value of [
    '2023-02-29',
    '1900-02-29',
    '1899-12-31',
    '2101-01-01',
    '2024-02-29T00:00:00.000Z',
  ]) {
    const input = await intercompanyInput('2024-02-29', {
      source: 0,
      field: 'Posting date',
      value,
    });
    assertDateInventory(
      (await replayIntercompany(input)).result,
      input,
      0,
      'Posting date',
      value,
    );
  }
  const input = await intercompanyInput();
  input.scope.start = '0000-01-01';
  assert.throws(() => reconcileIntercompany(input), /IC_DATE/);
});

void test('intercompany invalid-date session restore retains source-error and remaining rows', async () => {
  const input = await intercompanyInput('2024-02-29', {
    source: 0,
    field: 'Posting date',
    value: '2026-02-30',
  });
  const { state, result } = await restoreIntercompany(
    await saveIntercompany(input),
  );
  assertDateInventory(result, state, 0, 'Posting date', '2026-02-30');
});

async function clearingInput(): Promise<ClearingInput> {
  const file = await readFile(
    'synthetic-clearing.csv',
    encode([
      [
        'Posting ID',
        'Clearing reference',
        'Date',
        'Amount',
        'Account',
        'Currency',
        'Description',
      ],
      [
        'P-01',
        'C-01',
        '2024-02-29',
        '12.34',
        '00100',
        'SAR',
        'Synthetic debit',
      ],
      [
        'P-02',
        'C-01',
        '2024-02-29',
        '-12.34',
        '00100',
        'SAR',
        'Synthetic credit',
      ],
      ['P-03', '', '2024-02-29', '5.67', '00100', 'SAR', 'Synthetic residual'],
    ]),
  );
  const input: ClearingInput = {
    file,
    reading: {
      sheet: 0,
      header: 0,
      posting: 0,
      reference: 1,
      date: 2,
      amount: 3,
      debit: -1,
      credit: -1,
      account: 4,
      currency: 5,
      description: 6,
      mode: 'signed',
    },
    scope: {
      entity: 'Synthetic entity',
      ledger: 'Synthetic ledger',
      account: '00100',
      currency: 'SAR',
      start: '2024-01-01',
      end: '2024-12-31',
      confirmed: true,
    },
    events: [],
  };
  // Result IDs/context are protocol tokens, not an oracle for financial values.
  const baseline = reconcileClearing(input);
  input.events.push({
    context: baseline.context,
    action: 'reopen',
    ids: baseline.rows.slice(0, 2).map((row) => row.id),
    note: 'Synthetic complete pair reopened for review',
  });
  return input;
}

function assertClearingFacts(result: ClearingResult) {
  assert.equal(result.total, 567);
  assert.equal(result.decimals, 2);
  assert.deepEqual(
    result.rows.map((row) => row.amount),
    [1234, -1234, 567],
  );
  assert.deepEqual(
    result.rows.map((row) => row.posting),
    ['P-01', 'P-02', 'P-03'],
  );
  assert.equal(result.inventory.length, 4);
  assert.ok(result.inventory.every((row) => row.kind !== 'error'));
  const pair = result.cases.find((item) => item.reference === 'C-01')!;
  assert.equal(pair.net, 0);
  assert.equal(pair.status, 'review');
  assert.equal(pair.reason, 'reopened');
  assert.equal(pair.ids.length, 2);
  assert.equal(pair.note, 'Synthetic complete pair reopened for review');
  assert.equal(result.scope.entity, 'Synthetic entity');
  assert.equal(result.scope.account, '00100');
  assert.equal(result.reading.date, 2);
  assert.equal(result.reading.amount, 3);
}

function mutateClearingCaller(input: ClearingInput) {
  input.file.name = 'changed.xlsx';
  input.file.sha256 = 'f'.repeat(64);
  new Uint8Array(input.file.original!).fill(0);
  input.file.sheets[0].rows[1][3] = '999.99';
  input.scope.entity = 'Changed entity';
  input.reading.date = 3;
  input.reading.amount = 2;
  input.events[0].note = 'Changed decision note';
  input.events[0].ids.pop();
  input.events.push({
    context: 'Changed context',
    action: 'clear',
    ids: [],
    note: 'Changed event',
  });
}

function assertOwnedClearing(
  state: ClearingInput,
  result: ClearingResult,
  original: ClearingInput,
) {
  assert.deepEqual(state, original);
  assertClearingFacts(result);
  assert.deepEqual(result.scope, original.scope);
  assert.deepEqual(result.reading, original.reading);
  assert.equal(result.sourceHash, original.file.sha256);
  assert.equal(state.events[0].ids.length, 2);
}

async function assertClearingWorkbook(
  bytes: ArrayBuffer,
  original: ClearingInput,
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const summary = workbook.getWorksheet('Summary')!;
  const properties = new Map<string, unknown>();
  summary.eachRow((row, index) => {
    if (index <= 1) return;
    const key = row.getCell(1).value;
    assert.equal(typeof key, 'string');
    if (typeof key === 'string') properties.set(key, row.getCell(2).value);
  });
  assert.equal(properties.get('Source name'), 'synthetic-clearing.csv');
  assert.equal(properties.get('Source SHA-256'), original.file.sha256);
  assert.equal(properties.get('Entity (user declared)'), 'Synthetic entity');
  assert.equal(properties.get('Account'), '00100');
  assert.equal(properties.get('Total minor units'), 567);
  assert.equal(properties.get('Error count'), 0);
  const movements = workbook.getWorksheet('Movements')!;
  assert.deepEqual(
    [2, 3, 4].map((row) => movements.getRow(row).getCell(6).value),
    [1234, -1234, 567],
  );
  const decisions = workbook.getWorksheet('Decisions')!;
  assert.equal(decisions.rowCount, 2);
  assert.equal(decisions.getRow(2).getCell(2).value, 'reopen');
  assert.equal(
    decisions.getRow(2).getCell(3).value,
    original.events[0].context,
  );
  assert.equal(
    decisions.getRow(2).getCell(4).value,
    original.events[0].ids.join('\n'),
  );
  assert.equal(decisions.getRow(2).getCell(5).value, original.events[0].note);
  const inventory = workbook.getWorksheet('Source inventory')!;
  assert.equal(inventory.rowCount, 5);
  assert.equal(inventory.getRow(3).getCell(7).value, '12.34');
  const reading = workbook.getWorksheet('Reading')!;
  const fields = new Map<string, unknown>();
  reading.eachRow((row, index) => {
    if (index <= 1) return;
    const key = row.getCell(1).value;
    assert.equal(typeof key, 'string');
    if (typeof key === 'string') fields.set(key, row.getCell(2).value);
  });
  assert.equal(fields.get('date'), 2);
  assert.equal(fields.get('amount'), 3);
}

void test('clearing stable replay/save/restore/export preserve independent financial and source facts', async () => {
  const input = await clearingInput();
  const original = structuredClone(input);
  const { state, result } = await replayClearing(input);
  assertOwnedClearing(state, result, original);
  const restored = await restoreClearing(await saveClearing(input));
  assertOwnedClearing(restored.state, restored.result, original);
  assert.deepEqual(restored.result, result);
  await assertClearingWorkbook(await exportClearing(input, result), original);
  await assert.rejects(
    () => exportClearing(input, { ...result, total: 0 }),
    /CLEARING_STALE_RESULT/,
  );
});

void test('clearing owns one start snapshot during first await and after returning, across replay/save/export', async () => {
  {
    const input = await clearingInput();
    const original = structuredClone(input);
    const pending = replayClearing(input);
    mutateClearingCaller(input);
    const { state, result } = await pending;
    assertOwnedClearing(state, result, original);
    input.scope.ledger = 'Changed again after replay returned';
    input.events[0].ids.length = 0;
    assertOwnedClearing(state, result, original);
  }
  {
    const input = await clearingInput();
    const original = structuredClone(input);
    const pending = saveClearing(input);
    mutateClearingCaller(input);
    const restored = await restoreClearing(await pending);
    assertOwnedClearing(restored.state, restored.result, original);
  }
  {
    const input = await clearingInput();
    const original = structuredClone(input);
    const expected = reconcileClearing(original);
    assertClearingFacts(expected);
    const pending = exportClearing(input, expected);
    mutateClearingCaller(input);
    await assertClearingWorkbook(await pending, original);
  }
  {
    const input = await clearingInput();
    const original = structuredClone(input);
    const replay = await replayClearing(input);
    mutateClearingCaller(input);
    assertOwnedClearing(replay.state, replay.result, original);
  }
});
