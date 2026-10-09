import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  BALANCE_FIELDS,
  GL_TB_VERSION,
  reconcileGlTb,
  readBalanceSource,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import {
  replayGlTb,
  saveGlTb,
  restoreGlTb,
  exportGlTb,
} from '../lib/reconciliation/gl-tb-io.ts';
const root = new URL('../audit/gl-tb/frozen/', import.meta.url);
const truth = JSON.parse(await fsRead(new URL('expected.json', root), 'utf8'));
export async function glFixture(name = 'positive'): Promise<GlTbInput> {
  const files = await Promise.all(
    ['gl', 'tb'].map(async (side) =>
      readFile(
        `${name}-${side}.csv`,
        new Uint8Array(await fsRead(new URL(`${name}-${side}.csv`, root)))
          .buffer,
      ),
    ),
  );
  return {
    files: files as GlTbInput['files'],
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERSION,
        confirmed: true,
      },
    ],
    scope: { ...truth.scope, confirmed: true },
  };
}
void test('GL/TB frozen independent balance source facts and gross turnover are preserved for all sixteen contracts', async () => {
  for (const contract of truth.cases) {
    const input = await glFixture(contract.name),
      { result } = await replayGlTb(input);
    assert.equal(result.status, contract.status, contract.name);
    for (const field of ['glBridge', 'tbBridge'] as const)
      if (contract[field] !== undefined)
        assert.equal(result[field], contract[field], contract.name);
    for (const [name, actual] of [
      ['glAmounts', result.gl],
      ['tbAmounts', result.tb],
      ['differences', result.differences],
    ] as const)
      if (contract[name])
        assert.deepEqual(
          BALANCE_FIELDS.map((f) => actual![f]),
          contract[name],
          contract.name,
        );
    assert.equal(
      result.inventory.length,
      input.files.reduce((n, f) => n + f.sheets[0].rows.length, 0),
    );
    assert.equal(
      new Set(result.rows.map((r) => r.id)).size,
      result.rows.length,
    );
    assert.equal(
      result.components
        .filter((c) => c.side === 0 && c.field === 'periodDebit')
        .flatMap((c) => c.cells).length,
      result.gl ? result.rows.filter((r) => r.kind === 'movement').length : 0,
    );
  }
});
void test('GL/TB neither borrows opening balance from TB nor invents a missing account or movement', async () => {
  const missing = reconcileGlTb(await glFixture('missing-gl-opening'));
  assert.equal(missing.gl, null);
  assert.equal(missing.glBridge, null);
  assert.equal(missing.differences, null);
  assert.deepEqual(missing.missing, ['gl-opening']);
  const empty = reconcileGlTb(await glFixture('zero-activity'));
  assert.equal(empty.status, 'consistent');
  assert.equal(
    empty.rows.some((r) => r.kind === 'movement'),
    false,
  );
  assert.equal(empty.gl!.openingDebit, 100000);
  assert.equal(
    empty.components.find((c) => c.side === 0 && c.field === 'periodDebit')!
      .cells.length,
    0,
  );
  const input = await glFixture();
  input.files[0].sheets[0].rows.splice(2, 2);
  const lost = reconcileGlTb(input);
  assert.equal(lost.status, 'inconsistent');
  assert.equal(lost.glBridge, 20000);
});
void test('balance-source reader is independent of movement normalization and retains six cell traces', async () => {
  const input = await glFixture(),
    source = readBalanceSource(input.files[1], input.readings[1], input.scope);
  assert.equal(source.rows.length, 1);
  assert.equal(source.rows[0].kind, 'balance');
  assert.equal(source.rows[0].date, '');
  assert.deepEqual(
    source.rows[0].amounts,
    [100000, 0, 30000, 10000, 120000, 0],
  );
  assert.deepEqual(
    source.rows[0].trace.map((t) => t.column),
    [12, 13, 14, 15, 16, 17],
  );
  assert.equal(Object.hasOwn(source.rows[0], 'amount'), false);
});
void test('GL/TB explicit policy, scope confirmation, version and native source roles precede comparison', async () => {
  const input = await glFixture();
  for (const patch of [
    { confirmed: false },
    { currencyBasis: 'transaction' },
    { postingStatus: 'unposted' },
    { currency: 'XYZ' },
    { start: '2026-02-30' },
    { end: '2026-08-31' },
    { dimensions: '' },
  ])
    assert.throws(() =>
      reconcileGlTb({ ...input, scope: { ...input.scope, ...patch } }),
    );
  for (const patch of [
    { confirmed: false },
    { role: 'supplier' },
    { family: 'anything' },
    { sheet: -1 },
  ])
    assert.throws(
      () =>
        reconcileGlTb({
          ...input,
          readings: [
            { ...input.readings[0], ...patch } as never,
            input.readings[1],
          ],
        }),
      /READING/,
    );
  assert.throws(() =>
    reconcileGlTb({ ...input, files: [input.files[0], input.files[0]] }),
  );
  assert.throws(
    () => reconcileGlTb({ ...input, events: [] } as never),
    /INPUT/,
  );
});
void test('GL/TB original native XLSX unreadable headers and blank formula rows cannot disappear', async () => {
  for (const header of [false, true]) {
    const input = await glFixture(),
      book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('GL');
    sheet.addRows(input.files[0].sheets[0].rows);
    if (header) {
      sheet.getCell('P1').value = { formula: '"Account"' };
      sheet.getCell('P2').value = '1200';
    } else sheet.getRow(6).getCell(1).value = { formula: '"G-OTHER"' };
    input.files[0] = await readFile(
      'gl.xlsx',
      new Uint8Array(await book.xlsx.writeBuffer()).buffer,
    );
    if (header) {
      await assert.rejects(() => replayGlTb(input), /COLUMNS/);
      await assert.rejects(() => saveGlTb(input), /COLUMNS/);
    } else {
      const result = (await replayGlTb(input)).result;
      assert.equal(result.status, 'source-error');
      assert.equal(
        result.inventory.find((i) => i.side === 0 && i.row === 6)!.kind,
        'error',
      );
      assert.equal(
        (await restoreGlTb(await saveGlTb(input))).result.status,
        'source-error',
      );
    }
  }
});
void test('GL/TB snapshots, duplicate IDs/roles and hidden rows preserve source error ownership', async () => {
  const input = await glFixture();
  input.files[0].sheets[0].rows[2][0] = 'G-OPEN';
  const result = reconcileGlTb(input);
  assert.equal(result.status, 'source-error');
  assert.equal(result.inventory.filter((i) => i.kind === 'error').length, 2);
  assert.equal(result.gl, null);
  input.files[0].sheets[0].rows[2][0] = 'G-D1';
  input.files[0].sheets[0].hiddenRows = [3];
  assert.equal(reconcileGlTb(input).status, 'source-error');
  const original = await glFixture(),
    snap = reconcileGlTb(original);
  original.scope.account = 'OTHER';
  original.files[0].sheets[0].rows[1][13] = '5';
  assert.equal(snap.scope.account, '1100');
  assert.equal(snap.inventory[1].values[13], '1000');
  assert.equal(snap.rows[0].trace[0].text, '1000');
});
void test('GL/TB keeps both debit and credit on one movement and never folds gross into net', async () => {
  const input = await glFixture();
  input.files[0].sheets[0].rows[2][14] = '100';
  input.files[0].sheets[0].rows.splice(3, 1);
  const result = reconcileGlTb(input);
  assert.equal(result.status, 'consistent');
  assert.deepEqual(
    result.rows.find((r) => r.kind === 'movement')!.amounts,
    [30000, 10000],
  );
  const difference = reconcileGlTb(
    await glFixture('same-net-different-turnover'),
  );
  assert.equal(difference.status, 'difference');
  assert.equal(difference.differences!.periodDebit, -5000);
  assert.equal(difference.differences!.periodCredit, -5000);
});
void test('GL/TB cannot round source fractions, parse scientific notation or treat a blank as zero', async () => {
  for (const raw of ['0.001', '1e2', '1,000', '-1', '', 'NaN', '=1+1']) {
    const input = await glFixture();
    input.files[0].sheets[0].rows[2][13] = raw;
    assert.equal(reconcileGlTb(input).status, 'source-error', raw);
  }
  const input = await glFixture();
  input.scope.currency = 'KWD';
  for (const f of input.files)
    for (const r of f.sheets[0].rows.slice(1))
      r[f === input.files[0] ? 7 : 5] = 'KWD';
  input.files[0].sheets[0].rows[2][13] = '300.001';
  const result = reconcileGlTb(input);
  assert.equal(result.decimals, 3);
  assert.equal(result.gl!.periodDebit, 300001);
  assert.equal(result.status, 'inconsistent');
});
void test('GL/TB native original replay rejects forged cache, hashes, saved results and stale workpapers', async () => {
  const input = await glFixture(),
    baseline = reconcileGlTb(input);
  input.files[0].sheets[0].rows[2][13] = '350';
  assert.equal((await replayGlTb(input)).result.status, 'consistent');
  await assert.rejects(() => exportGlTb(input, reconcileGlTb(input)), /STALE/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportGlTb(input, baseline));
  assert.equal(book.getWorksheet('Balances')!.getCell('B4').value, 30000);
  const saved = JSON.parse(new TextDecoder().decode(await saveGlTb(input)));
  assert.equal(Object.hasOwn(saved, 'result'), false);
  assert.deepEqual(
    (await restoreGlTb(new TextEncoder().encode(JSON.stringify(saved)).buffer))
      .result,
    baseline,
  );
  saved.result = baseline;
  await assert.rejects(
    () => restoreGlTb(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /SESSION/,
  );
  delete saved.result;
  saved.files[1].sha256 = '0'.repeat(64);
  await assert.rejects(
    () => restoreGlTb(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /HASH/,
  );
  input.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => saveGlTb(input), /HASH/);
});
void test('GL/TB canonical role headers can move but cannot duplicate or hide an unknown role', async () => {
  const input = await glFixture(),
    baseline = reconcileGlTb(input);
  for (const f of input.files)
    for (const row of f.sheets[0].rows) row.reverse();
  const moved = reconcileGlTb(input);
  assert.deepEqual(moved.gl, baseline.gl);
  assert.deepEqual(moved.tb, baseline.tb);
  assert.equal(moved.status, 'consistent');
  input.files[1].sheets[0].rows[0].push('Account');
  assert.throws(() => reconcileGlTb(input), /COLUMNS/);
});
void test('GL/TB native cached formula headers retain their role labels but cannot become trusted headers', async () => {
  const input = await glFixture(),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('GL');
  sheet.addRows(input.files[0].sheets[0].rows);
  sheet.getCell('B1').value = {
    formula: '"Record kind"',
    result: 'Record kind',
  };
  input.files[0] = await readFile(
    'gl.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  assert.equal(input.files[0].sheets[0].rows[0][1], 'Record kind');
  await assert.rejects(() => replayGlTb(input), /COLUMNS/);
});
void test('GL/TB full reader row capacity retains both gross sums with bounded cell ownership', async () => {
  const input = await glFixture(),
    sheet = input.files[0].sheets[0],
    movement = sheet.rows[2];
  sheet.rows = [
    sheet.rows[0],
    sheet.rows[1],
    ...Array.from({ length: 19997 }, (_, i) => {
      const row = [...movement];
      row[0] = `G-${i}`;
      row[13] = '1';
      row[14] = '1';
      return row;
    }),
    sheet.rows[4],
  ];
  sheet.rows.at(-1)![13] = '1000';
  input.files[1].sheets[0].rows[1].splice(13, 4, '19997', '19997', '1000', '0');
  const started = performance.now(),
    result = reconcileGlTb(input);
  assert.equal(result.status, 'consistent');
  assert.equal(result.gl!.periodDebit, 1999700);
  assert.equal(result.gl!.periodCredit, 1999700);
  assert.equal(result.rows.filter((r) => r.kind === 'movement').length, 19997);
  for (const field of ['periodDebit', 'periodCredit'])
    assert.equal(
      result.components.find((c) => c.side === 0 && c.field === field)!.cells
        .length,
      19997,
    );
  assert.ok(performance.now() - started < 6000);
});
void test('GL/TB aggregate overflow refuses a numeric result rather than losing precision', async () => {
  const input = await glFixture();
  input.files[0].sheets[0].rows[2][13] = '900000000000';
  input.files[0].sheets[0].rows[3][13] = '900000000000';
  assert.throws(() => reconcileGlTb(input), /الحد الآمن/);
});
void test('GL/TB native numeric money with 0.00 format and native dates survives comparison, session and export', async () => {
  const input = await glFixture();
  for (const side of [0, 1] as const) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Source');
    sheet.addRows(input.files[side].sheets[0].rows);
    for (const row of sheet.getRows(2, sheet.rowCount - 1)!) {
      for (
        let column = side === 0 ? 14 : 12;
        column <= sheet.columnCount;
        column++
      ) {
        const cell = row.getCell(column);
        cell.value = Number(cell.value);
        cell.numFmt = '0.00';
      }
      for (const column of side === 0 ? [3, 12, 13] : [10, 11]) {
        const cell = row.getCell(column);
        const text = cell.value;
        if (typeof text !== 'string')
          throw Error('Synthetic source date must be text');
        cell.value = new Date(text + 'T00:00:00.000Z');
        cell.numFmt = 'yyyy-mm-dd';
      }
    }
    input.files[side] = await readFile(
      `${side ? 'tb' : 'gl'}.xlsx`,
      new Uint8Array(await book.xlsx.writeBuffer()).buffer,
    );
  }
  assert.ok(input.files[0].sheets[0].referenceIssues?.['2:14']);
  const replay = await replayGlTb(input);
  assert.equal(replay.result.status, 'consistent');
  const restored = await restoreGlTb(await saveGlTb(input));
  assert.deepEqual(restored.result, replay.result);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportGlTb(restored.state, restored.result));
  assert.equal(book.getWorksheet('Balances')!.getCell('B4').value, 30000);
  const forged = structuredClone(input);
  forged.files[0].sheets[0].referenceIssues!['2:1'] = [
    'Synthetic unreadable record format',
  ];
  assert.equal(reconcileGlTb(forged).status, 'source-error');
  for (const [address, value] of [
    ['F2', 1100],
    ['N3', 0.001],
    ['N3', { formula: '300', result: 300 }],
  ] as const) {
    const sourceBook = new ExcelJS.Workbook();
    await sourceBook.xlsx.load(input.files[0].original!);
    const cell = sourceBook.worksheets[0].getCell(address);
    cell.value = value;
    cell.numFmt = '0.00';
    const file = await readFile(
      'gl.xlsx',
      new Uint8Array(await sourceBook.xlsx.writeBuffer()).buffer,
    );
    assert.equal(
      (await replayGlTb({ ...input, files: [file, input.files[1]] })).result
        .status,
      'source-error',
      address,
    );
  }
});
