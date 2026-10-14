import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  readStockFile, replayStock, saveStock, restoreStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import { STOCK_VERSION, STOCK_MATRIX_FAMILY, type StockInput } from '../lib/reconciliation/inventory-register.ts';

// Source-typing/display probes for the approved matrix family. These do not
// establish additional financial stories or replace the independent oracle.
const labels = ['Entity', 'Inventory ledger', 'GL ledger', 'Currency', 'Currency basis',
  'Posting status', 'Posting layer', 'As of', 'Chart version', 'Map version',
  'Valuation policy version', 'Inventory account set version'];
const makeScope = (currency = 'SAR'): StockInput['scope'] => ({
  entity: 'Synthetic matrix native guard', inventoryLedger: 'STOCK', glLedger: 'GL',
  currency, currencyBasis: 'functional', postingStatus: 'posted', postingLayer: 'Current',
  asOf: '2026-09-30', chartVersion: 'CHART', mapVersion: 'MAP',
  valuationPolicyVersion: 'POSTED-1', inventoryAccountSetVersion: 'INVSET-1', confirmed: true,
});
type Options = { currency?: string; amount?: string; separator?: boolean };
async function native(
  edit: (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void = () => {},
  options: Options = {},
  patch?: (zip: JSZip) => Promise<void> | void,
): Promise<StockInput> {
  const scope = makeScope(options.currency), values = Object.values(scope).slice(0, 12) as string[];
  const amount = options.amount ?? '400.00';
  const facts = [
    ['0007', 'warehouse=W1;batch=B01', '10', 'EA', '0', '600.00', 'VAL-1'],
    ['0007', 'warehouse=W1;batch=B02', '20', 'EA', '0', amount, 'VAL-2'],
    ['0008', 'warehouse=W1;batch=B00', '0', 'EA', '0', '0.00', 'VAL-0'],
  ];
  const roles = ['Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference'];
  // C contains literal Scope values above the band. Only D is an entirely
  // blank physical separator column, not merely blank inside the matrix.
  const columns = options.separator ? [2, 3, 5] : [2, 3, 4];
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Native stock matrix');
  for (let column = 1; column <= Math.max(...columns); column++) sheet.getColumn(column).width = 45;
  sheet.getCell('A1').value = 'Format'; sheet.getCell('B1').value = 'INV1A-MATRIX-1';
  labels.forEach((label, index) => {
    sheet.getCell(index + 2, 1).value = 'Scope';
    sheet.getCell(index + 2, 2).value = label;
    sheet.getCell(index + 2, 3).value = values[index];
  });
  sheet.getCell('A14').value = 'Field';
  facts.forEach((_fact, index) => { sheet.getCell(14, columns[index]).value = `Column-${index}`; });
  roles.forEach((role, index) => {
    const row = index + 15; sheet.getCell(row, 1).value = role;
    facts.forEach((fact, record) => {
      sheet.getCell(row, columns[record]).value = ['Quantity', 'Quantity precision', 'Posted value'].includes(role)
        ? Number(fact[index]) : fact[index];
    });
  });
  sheet.getCell('A22').value = 'End report';
  edit(sheet, book);
  let original = Uint8Array.from(new Uint8Array(await book.xlsx.writeBuffer())).buffer;
  if (patch) {
    const zip = await JSZip.loadAsync(original); await patch(zip);
    original = await zip.generateAsync({ type: 'arraybuffer' });
  }
  const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row
    .map((text) => '"' + text.replaceAll('"', '""') + '"').join(',')).join('\n') + '\n').buffer;
  const companions: string[][][] = [
    [['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID', ...labels],
      ...facts.map((fact, index) => [`MAP-${index}`, fact[0], fact[1], 'INV-1', 'branch=01', `POL-${index}`, ...values])],
    [['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference',
      'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference', ...labels],
      ...facts.map((fact, index) => [`POL-${index}`, fact[0], fact[1], fact[3], fact[4], fact[6], 'INV-1', 'branch=01',
        'inventory', 'debit-positive', 'provided-posted-carrying-value', '2026-01-01', '2026-12-31', `SYN-${index}`, ...values])],
    [['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit', ...labels],
      ['INV-1', 'branch=01', 'inventory', options.currency === 'KWD' ? '601.234' : '1000.00', '0', ...values]],
  ];
  const files = [await readStockFile('register.xlsx', original)];
  for (const [index, rows] of companions.entries()) files.push(await readStockFile(`source-${index + 1}.csv`, csv(rows)));
  assert.equal(files[0].sha256, createHash('sha256').update(new Uint8Array(original)).digest('hex'));
  assert.deepEqual(files[0].original, original);
  return {
    files: [files[0], files[1], files[2], files[3]], scope,
    readings: ['register', 'mapping', 'policy-evidence', 'gl'].map((role, source) => ({
      role, sheet: 0, family: source === 0 ? STOCK_MATRIX_FAMILY : STOCK_VERSION, confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' }, events: [],
  };
}
async function ready(state: StockInput, minor = 100000) {
  const checked = await replayStock(state);
  assert.equal(checked.result.financial, 'ready', JSON.stringify(checked.result.issues));
  assert.deepEqual(checked.result.issues, []);
  assert.deepEqual(checked.result.totals, { registerMinor: minor, glMinor: minor });
  assert.deepEqual(checked.result.records[0].map((record) => record.values.slice(0, 5)), [
    ['0007', 'warehouse=W1;batch=B01', 10, 'EA', 0],
    ['0007', 'warehouse=W1;batch=B02', 20, 'EA', 0],
    ['0008', 'warehouse=W1;batch=B00', 0, 'EA', 0],
  ]);
  assert.equal(new Set(checked.result.records[0].map((record) => record.id)).size, 3);
  assert.deepEqual(checked.result.records[0].map((record) => JSON.parse(record.id).slice(4)),
    state.files[0].sheets[0].rows[13][3] === '' ? [[15, 2], [15, 3], [15, 5]] : [[15, 2], [15, 3], [15, 4]]);
  assert.equal(checked.result.memberIds.length, 28);
  assert.deepEqual((await restoreStock(await saveStock(checked.state))).result, checked.result);
  return checked;
}
async function blocked(state: StockInput, code: string, detail?: string) {
  const checked = await replayStock(state), source = checked.state.files[0];
  assert.equal(checked.result.financial, 'source-error', JSON.stringify(checked.result.issues));
  assert.equal(checked.result.totals, null);
  assert.equal(checked.result.review, 'needs-review');
  assert.ok(checked.result.issues.some((issue) => issue.source === 0 && issue.code === code), JSON.stringify(checked.result.issues));
  if (detail) assert.ok(Object.values(source.sheets[0].rowIssues ?? {}).flat().some((issue) => issue.includes(detail)), JSON.stringify(source.sheets[0].rowIssues));
  assert.ok(checked.result.comparisons.every((comparison) => Object.entries(comparison)
    .filter(([key]) => key.endsWith('Minor')).every(([, value]) => value === null)));
  assert.deepEqual(source.original, state.files[0].original);
  assert.ok(checked.result.memberIds.some((id) => { const tuple = JSON.parse(id); return tuple[1] === 0 && tuple[4] === 20; }));
  return checked;
}

void test('INV-1C native literal matrix identities with numeric quantities and money preserve exact source columns', async () => {
  await ready(await native((sheet) => {
    sheet.getCell('C20').numFmt = '0.00 "SAR"';
    sheet.getCell('A14').font = { bold: true, size: 12, color: { argb: 'FF0A1B2E' } };
  }));
});

void test('INV-1C native Quantity and precision currency display are guarded in later record columns including zero', async () => {
  for (const cell of ['C17', 'D19']) await blocked(await native((sheet) => {
    sheet.getCell(cell).numFmt = '0.00 "SAR"';
  }), 'SOURCE_DISPLAY', 'NATIVE_CURRENCY_ROLE');
  // A cash style on money is distinct from a cash style on quantities.
  await ready(await native((sheet) => { sheet.getCell('C20').numFmt = '0.00 "SAR"'; }));
});

void test('INV-1C native later-column date and numeric identity coercion cannot certify matrix facts', async () => {
  for (const cell of ['C17', 'C20', 'D15']) await blocked(await native((sheet) => {
    if (cell === 'D15') sheet.getCell(cell).value = 8;
    sheet.getCell(cell).numFmt = 'yyyy-mm-dd';
  }), 'SOURCE_DISPLAY', 'NATIVE_NUMERIC_FORMAT');
  await blocked(await native((sheet) => { sheet.getCell('C15').value = 7; sheet.getCell('C15').numFmt = '0000'; }), 'NUMERIC_IDENTITY');
  await blocked(await native((sheet) => { sheet.getCell('C14').value = 2; }), 'NUMERIC_IDENTITY');
});

void test('INV-1C native contradictory later-column cash display and hidden KWD rounding leave null totals', async () => {
  await blocked(await native((sheet) => { sheet.getCell('C20').numFmt = '0.00 "USD"'; }), 'SOURCE_DISPLAY', 'NATIVE_CURRENCY_CONFLICT');
  await ready(await native((sheet) => { sheet.getCell('C20').numFmt = '0.00;0.00 "USD"'; }));
  await blocked(await native((sheet) => { sheet.getCell('C20').numFmt = '0.00'; }, { currency: 'KWD', amount: '1.234' }), 'SOURCE_DISPLAY', 'NATIVE_NUMBER_ROUNDING');
  await ready(await native(() => {}, { currency: 'KWD', amount: '1.234' }), 601234);
});

void test('INV-1C native fully blank separators/decorations are harmless while hidden populated zero remains evidence', async () => {
  await ready(await native((sheet) => {
    sheet.getColumn(4).hidden = true; sheet.getColumn(4).width = 0;
    sheet.getRow(25).hidden = true; sheet.getRow(25).height = 0;
  }, { separator: true }));
  await blocked(await native((sheet) => { sheet.getColumn(4).hidden = true; }), 'SOURCE_DISPLAY', 'NATIVE_DIMENSION');
});

void test('INV-1C native merged authority and blank-result formulas never create literal matrix record members', async () => {
  await blocked(await native((sheet) => { sheet.mergeCells('C16:D16'); }), 'SOURCE_DISPLAY');
  // The first matrix contract blocks every merge. Read rows cannot prove that
  // a blank merged master did not overwrite a nonblank original slave.
  await blocked(await native((sheet) => { sheet.mergeCells('B26:C26'); }), 'SOURCE_DISPLAY');
  const formula = await native((sheet) => { sheet.getCell('E26').value = { formula: '""' }; });
  const checked = await blocked(formula, 'FORMULA_SOURCE');
  assert.ok(checked.result.memberIds.some((id) => { const tuple = JSON.parse(id); return tuple[1] === 0 && tuple[4] === 26; }));
  assert.equal(checked.state.files[0].sheets[0].formulaCells?.['26:5']?.formula, '""');
});

void test('INV-1C native unknown or another-family Format stays readable but cannot be guessed into matrix authority', async () => {
  for (const marker of ['UNKNOWN-MATRIX', 'INV1A-SECTIONS-1']) {
    const state = await native((sheet) => { sheet.getCell('B1').value = marker; });
    const checked = await blocked(state, 'FORMAT');
    assert.equal(checked.state.files[0].sheets[0].rows[0][1], marker);
    assert.deepEqual(checked.state.files[0].original, state.files[0].original);
    assert.equal(checked.result.readings[0].family, STOCK_MATRIX_FAMILY);
  }
});
