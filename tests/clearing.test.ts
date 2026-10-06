import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileClearing,
  type ClearingInput,
  type ClearingEvent,
} from '../lib/reconciliation/clearing.ts';
import {
  replayClearing,
  saveClearing,
  restoreClearing,
  exportClearing,
} from '../lib/reconciliation/clearing-io.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../lib/reconciliation/clearing-demo.ts';
async function fixture(text?: string): Promise<ClearingInput> {
  const bytes =
    text === undefined
      ? await fsRead(
          new URL('../audit/clearing/frozen/source.csv', import.meta.url),
        )
      : new TextEncoder().encode(text);
  const file = await readFile('clearing.csv', new Uint8Array(bytes).buffer);
  return {
    file,
    reading: { ...clearingDemoReading },
    scope: { ...clearingDemoScope },
    events: [],
  };
}
const event = (
  input: ClearingInput,
  action: ClearingEvent['action'],
  rows: number[],
  note = 'Independent synthetic advice confirms membership',
): ClearingEvent => ({
  context: reconcileClearing(input).context,
  action,
  ids: reconcileClearing(input)
    .rows.filter((row) => rows.includes(row.row))
    .map((row) => row.id),
  note,
});

void test('frozen positive 1:N and reversal groups clear; equal amounts without evidence and residuals remain visible', async () => {
  const input = await fixture(),
    result = reconcileClearing(input);
  const expected = JSON.parse(
    await fsRead(
      new URL('../audit/clearing/frozen/expected.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(result.rows.length, expected.validRows);
  assert.equal(result.total, expected.totalMinor);
  assert.deepEqual(
    result.rows.map((row) => row.amount),
    expected.amountsMinor,
  );
  assert.deepEqual(
    result.cases
      .filter((c) => c.status === 'cleared')
      .map((c) => c.ids.map((id) => result.rows.find((r) => r.id === id)!.row)),
    expected.automaticGroups,
  );
  assert.equal(result.cases.find((c) => c.reference === 'C003')!.net, 1000);
  assert.equal(result.cases.filter((c) => !c.reference).length, 2);
  assert.equal(new Set(result.cases.flatMap((c) => c.ids)).size, 9);
  assert.equal(result.inventory.length, 10);
});
void test('human decision, reopen and re-clear preserve single ownership and human basis', async () => {
  const input = await fixture();
  input.events.push(event(input, 'clear', [7, 8]));
  let result = reconcileClearing(input);
  assert.equal(result.cases.filter((c) => c.status === 'cleared').length, 3);
  assert.equal(result.cases.find((c) => c.basis === 'human-decision')!.net, 0);
  input.events.push(event(input, 'reopen', [7, 8]));
  result = reconcileClearing(input);
  assert.equal(result.cases.filter((c) => c.status === 'cleared').length, 2);
  assert.equal(
    result.cases.find((c) => c.reason === 'reopened')!.ids.length,
    2,
  );
  input.events.push(event(input, 'clear', [7, 8]));
  assert.equal(
    reconcileClearing(input).cases.filter((c) => c.status === 'cleared').length,
    3,
  );
  assert.throws(
    () =>
      reconcileClearing({
        ...input,
        events: [...input.events, event(input, 'clear', [7, 8])],
      }),
    /DECISION/,
  );
});
void test('reopening an automatic group remains reopened after recomputation and session restore', async () => {
  const input = await fixture();
  input.events = [event(input, 'reopen', [2, 3, 4])];
  assert.equal(
    reconcileClearing(input).cases.filter((c) => c.status === 'cleared').length,
    1,
  );
  const restored = await restoreClearing(await saveClearing(input));
  assert.equal(
    restored.result.cases.find((c) => c.reference === 'C001')!.reason,
    'reopened',
  );
});
void test('decisions reject partial explicit groups, empty reasons, nonzero groups, overlap and forged contexts', async () => {
  const input = await fixture();
  for (const e of [
    event(input, 'clear', [2, 3]),
    event(input, 'clear', [7, 8], ''),
    event(input, 'clear', [9, 10]),
    { ...event(input, 'clear', [7, 8]), context: 'old-source' },
    {
      ...event(input, 'clear', [7, 8]),
      ids: [
        event(input, 'clear', [7, 8]).ids[0],
        event(input, 'clear', [7, 8]).ids[0],
      ],
    },
  ])
    assert.throws(() => reconcileClearing({ ...input, events: [e] }));
  // A balanced subset in a bigger explicit bucket is not a complete group.
  const row = input.file.sheets[0].rows;
  row[3][3] = '-1000';
  row[2][3] = '1000';
  assert.throws(
    () =>
      reconcileClearing({ ...input, events: [event(input, 'clear', [3, 4])] }),
    /PARTIAL_GROUP/,
  );
});
void test('an unread competing row blocks every automatic group and any human clearing, with original values retained', async () => {
  const input = await fixture();
  input.file.sheets[0].rows.push([
    'P010',
    'C001',
    '2026-09-08',
    'unread',
    '2150',
    'SAR',
    'Competing row',
  ]);
  const result = reconcileClearing(input);
  assert.equal(result.cases.filter((c) => c.status === 'cleared').length, 0);
  assert.equal(result.inventory.at(-1)!.kind, 'error');
  assert.equal(result.inventory.at(-1)!.values[3], 'unread');
  assert.throws(
    () =>
      reconcileClearing({ ...input, events: [event(input, 'clear', [7, 8])] }),
    /DECISION/,
  );
});
void test('duplicate posting IDs, foreign scope, period errors and invalid dates cannot disappear', async () => {
  for (const [column, value] of [
    [0, 'P001'],
    [4, '2160'],
    [5, 'USD'],
    [2, '2026-10-01'],
    [2, '2026-02-30'],
  ] as const) {
    const input = await fixture();
    input.file.sheets[0].rows[2][column] = value;
    const result = reconcileClearing(input);
    assert.ok(result.inventory.some((r) => r.kind === 'error'));
    assert.equal(result.cases.filter((c) => c.status === 'cleared').length, 0);
    assert.equal(result.inventory.length, 10);
  }
});
void test('mapping cannot hide a movement as prefix/header or overlap a semantic column', async () => {
  const input = await fixture();
  assert.throws(
    () =>
      reconcileClearing({ ...input, reading: { ...input.reading, header: 2 } }),
    /READING/,
  );
  assert.throws(
    () =>
      reconcileClearing({
        ...input,
        reading: { ...input.reading, reference: 0 },
      }),
    /COLUMNS/,
  );
  input.file.sheets[0].rows[0][1] = 'Batch';
  assert.equal(
    reconcileClearing(input).cases.filter((c) => c.status === 'cleared').length,
    0,
    'generic batch is not established clearing identity',
  );
  input.file.sheets[0].hiddenRows = [1];
  assert.throws(() => reconcileClearing(input), /COLUMNS/);
});
void test('split amounts require explicit zero, reject both nonzero, and do not net negative entries silently', async () => {
  const input = await fixture();
  input.file.sheets[0].rows.forEach((r, i) => {
    r.push(i === 0 ? 'Credit' : Number(r[3]) < 0 ? String(-Number(r[3])) : '0');
    if (i) r[3] = Number(r[3]) > 0 ? r[3] : '0';
  });
  input.reading = {
    ...input.reading,
    mode: 'split',
    amount: -1,
    debit: 3,
    credit: 7,
  };
  assert.equal(
    reconcileClearing(input).cases.filter((c) => c.status === 'cleared').length,
    2,
  );
  for (const bad of ['', '-100', '1']) {
    input.file.sheets[0].rows[1][7] = bad;
    assert.equal(reconcileClearing(input).inventory[1].kind, 'error');
  }
});
void test('safe exact amounts support 0/2/3 precision and reject overflow, separators, blanks and rounded values', async () => {
  for (const v of [
    '',
    '1,000',
    '1.001',
    '10000000000000000',
    '(1000)',
    '1e3',
  ]) {
    const input = await fixture();
    input.file.sheets[0].rows[1][3] = v;
    assert.equal(reconcileClearing(input).inventory[1].kind, 'error');
  }
  for (const [currency, debit, credit, expected] of [
    ['JPY', '10', '-10', 10],
    ['KWD', '1.001', '-1.001', 1001],
  ] as const) {
    const input = await fixture(
      `Posting ID,Clearing Reference,Date,Amount,Account,Currency,Description\nA,C,2026-09-01,${debit},2150,${currency},a\nB,C,2026-09-01,${credit},2150,${currency},b`,
    );
    input.scope.currency = currency;
    assert.equal(reconcileClearing(input).rows[0].amount, expected);
    assert.equal(reconcileClearing(input).cases[0].status, 'cleared');
  }
});
void test('groups above 100 members stay whole and unapproved; account total zero is not clearing evidence', async () => {
  const input = await fixture();
  const sheet = input.file.sheets[0];
  sheet.rows = [
    sheet.rows[0],
    ...Array.from({ length: 102 }, (_, i) => [
      `P${i}`,
      'BIG',
      '2026-09-01',
      i % 2 ? '1' : '-1',
      '2150',
      'SAR',
      'entry',
    ]),
  ];
  const result = reconcileClearing(input);
  assert.equal(result.total, 0);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].status, 'review');
  assert.equal(result.cases[0].ids.length, 102);
});
void test('native byte replay discards forged parsed values and refuses source changes and stale workpaper results', async () => {
  const input = await fixture();
  const baseline = reconcileClearing(input);
  input.file.sheets[0].rows[1][3] = '1';
  assert.equal((await replayClearing(input)).result.rows[0].amount, 100000);
  await assert.rejects(
    () => exportClearing(input, reconcileClearing(input)),
    /STALE_RESULT/,
  );
  await exportClearing(input, baseline);
  input.file.sha256 = '0'.repeat(64);
  await assert.rejects(() => replayClearing(input), /SOURCE_HASH/);
});
void test('changing scope or reading invalidates decisions; sessions reject injected cached results and forged hashes', async () => {
  const input = await fixture();
  input.events = [event(input, 'clear', [7, 8])];
  assert.throws(
    () =>
      reconcileClearing({
        ...input,
        scope: { ...input.scope, ledger: 'Other ledger' },
      }),
    /DECISION/,
  );
  const bytes = await saveClearing(input);
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  parsed.result = { fake: true };
  await assert.rejects(
    () =>
      restoreClearing(new TextEncoder().encode(JSON.stringify(parsed)).buffer),
    /SESSION/,
  );
  delete parsed.result;
  parsed.file.sha256 = '0'.repeat(64);
  await assert.rejects(
    () =>
      restoreClearing(new TextEncoder().encode(JSON.stringify(parsed)).buffer),
    /SOURCE_HASH/,
  );
});
void test('XLSX selected-cell formulas/hidden rows fail visibly while ordinary numeric and text dates roundtrip', async () => {
  const csv = await fixture();
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Clearing');
  sheet.addRows(csv.file.sheets[0].rows);
  sheet.getCell('D2').value = 1000;
  const bytes = await book.xlsx.writeBuffer();
  const file = await readFile(
    'clearing.xlsx',
    new Uint8Array(bytes as unknown as Uint8Array).buffer,
  );
  const input = { ...csv, file };
  assert.equal(
    (await replayClearing(input)).result.cases.filter(
      (c) => c.status === 'cleared',
    ).length,
    2,
  );
  sheet.getCell('D2').value = { formula: '1000', result: 1000 };
  sheet.getRow(3).hidden = true;
  const corrupt = await book.xlsx.writeBuffer();
  input.file = await readFile(
    'clearing.xlsx',
    new Uint8Array(corrupt as unknown as Uint8Array).buffer,
  );
  assert.equal(
    reconcileClearing(input).inventory.filter((r) => r.kind === 'error').length,
    2,
  );
  assert.equal(
    reconcileClearing(input).cases.filter((c) => c.status === 'cleared').length,
    0,
  );
});
void test('original text including formula-looking description is exported as text, with every row and member preserved', async () => {
  const input = await fixture(); // change native bytes, not the parsed cache
  const raw = new TextDecoder()
    .decode(input.file.original)
    .replace('Invoice', '=1+1');
  input.file = await readFile(
    'clearing.csv',
    new TextEncoder().encode(raw).buffer,
  );
  const result = reconcileClearing(input),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportClearing(input, result));
  assert.equal(book.getWorksheet('Movements')!.rowCount, 10);
  assert.equal(book.getWorksheet('Source inventory')!.rowCount, 11);
  assert.equal(book.getWorksheet('Membership')!.rowCount, 10);
  assert.equal(
    typeof book.getWorksheet('Movements')!.getCell('G2').value,
    'string',
  );
  assert.equal(
    book.getWorksheet('Movements')!.getCell('G2').formula,
    undefined,
  );
});
