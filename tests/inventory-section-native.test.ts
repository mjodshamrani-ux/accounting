import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  readStockFile, replayStock, saveStock, restoreStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION, STOCK_SECTION_FAMILY, type StockInput,
} from '../lib/reconciliation/inventory-register.ts';

// One explicit section story. These are adversarial display/typing probes, not
// additional independent financial stories or supplier-template coverage.
const labels = ['Entity', 'Inventory ledger', 'GL ledger', 'Currency', 'Currency basis',
  'Posting status', 'Posting layer', 'As of', 'Chart version', 'Map version',
  'Valuation policy version', 'Inventory account set version'];
const scope = (currency = 'SAR'): StockInput['scope'] => ({
  entity: 'Synthetic native stock guard', inventoryLedger: 'STOCK', glLedger: 'GL',
  currency, currencyBasis: 'functional', postingStatus: 'posted', postingLayer: 'Current',
  asOf: '2026-09-30', chartVersion: 'CHART', mapVersion: 'MAP',
  valuationPolicyVersion: 'POSTED-1', inventoryAccountSetVersion: 'INVSET-1', confirmed: true,
});
type Options = { currency?: string; amount?: string; item?: string };
async function native(
  edit: (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void = () => {},
  options: Options = {},
  patch?: (zip: JSZip) => Promise<void> | void,
): Promise<StockInput> {
  const selected = scope(options.currency), values = Object.values(selected).slice(0, 12) as string[];
  const item = options.item ?? '0007', amount = options.amount ?? '600.00';
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Native stock sections');
  sheet.getColumn(1).width = 30; sheet.getColumn(2).width = 45; sheet.getColumn(3).width = 45;
  const rows: (string | number)[][] = [
    ['Format', 'INV1A-SECTIONS-1'], ...labels.map((label, i) => ['Scope', label, values[i]]),
    ['Section'], ['Item ID', item], ['Item dimensions', 'warehouse=W1;batch=B01'],
    ['Unit', 'EA'], ['Quantity precision', 0], ['Valuation reference', 'VAL-1'],
    ['Component', 'Value'], ['Quantity', 10], ['Posted value', Number(amount)],
    ['End section'], ['End report'],
  ];
  rows.forEach((row) => sheet.addRow(row));
  edit(sheet, book);
  let original = Uint8Array.from(new Uint8Array(await book.xlsx.writeBuffer())).buffer;
  if (patch) {
    const zip = await JSZip.loadAsync(original); await patch(zip);
    original = await zip.generateAsync({ type: 'arraybuffer' });
  }
  const csv = (records: string[][]) => new TextEncoder().encode(records
    .map((row) => row.map((text) => '"' + text.replaceAll('"', '""') + '"').join(','))
    .join('\n') + '\n').buffer;
  const companions = [
    [['Mapping ID', 'Item ID', 'Item dimensions', 'GL account', 'GL dimensions', 'Evidence ID', ...labels],
      ['MAP-1', item, 'warehouse=W1;batch=B01', 'INV-1', 'branch=01', 'POL-1', ...values]],
    [['Evidence ID', 'Item ID', 'Item dimensions', 'Unit', 'Quantity precision', 'Valuation reference',
      'GL account', 'GL dimensions', 'Account class', 'Sign', 'Value basis', 'Valid from', 'Valid to', 'Reference', ...labels],
      ['POL-1', item, 'warehouse=W1;batch=B01', 'EA', '0', 'VAL-1', 'INV-1', 'branch=01', 'inventory',
        'debit-positive', 'provided-posted-carrying-value', '2026-01-01', '2026-12-31', 'SYN-POL-1', ...values]],
    [['GL account', 'GL dimensions', 'Account class', 'Debit', 'Credit', ...labels],
      ['INV-1', 'branch=01', 'inventory', amount, '0', ...values]],
  ];
  const files = [await readStockFile('register.xlsx', original)];
  for (const [source, records] of companions.entries())
    files.push(await readStockFile(`source-${source + 1}.csv`, csv(records)));
  assert.equal(files[0].sha256, createHash('sha256').update(new Uint8Array(original)).digest('hex'));
  assert.deepEqual(files[0].original, original);
  return {
    files: [files[0], files[1], files[2], files[3]], scope: selected,
    readings: ['register', 'mapping', 'policy-evidence', 'gl'].map((role, source) => ({
      role, sheet: 0, family: source === 0 ? STOCK_SECTION_FAMILY : STOCK_VERSION, confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' }, events: [],
  };
}
async function ready(state: StockInput, minor = 60000) {
  const checked = await replayStock(state);
  assert.equal(checked.result.financial, 'ready', JSON.stringify(checked.result.issues));
  assert.deepEqual(checked.result.issues, []);
  assert.deepEqual(checked.result.totals, { registerMinor: minor, glMinor: minor });
  assert.deepEqual(checked.result.records[0].map((record) => record.values),
    [[state.files[0].sheets[0].rows[14][1], 'warehouse=W1;batch=B01', 10, 'EA', 0, minor, 'VAL-1']]);
  assert.deepEqual(checked.result.comparisons.map((row) => [row.account, row.dimensions, row.registerMinor, row.glMinor, row.differenceMinor]),
    [['INV-1', 'branch=01', minor, minor, 0]]);
  assert.equal(checked.result.memberIds.length, 26);
  assert.deepEqual((await restoreStock(await saveStock(checked.state))).result, checked.result);
  return checked;
}
async function blocked(state: StockInput, diagnostic: string, row = 22) {
  const checked = await replayStock(state), sheet = checked.state.files[0].sheets[0];
  assert.equal(checked.result.financial, 'source-error', diagnostic + ':' + JSON.stringify(sheet.rowIssues));
  assert.equal(checked.result.totals, null);
  assert.equal(checked.result.review, 'needs-review');
  assert.ok(checked.result.issues.some((issue) => issue.source === 0 && issue.code === 'SOURCE_DISPLAY'));
  assert.ok(Object.values(sheet.rowIssues ?? {}).flat().some((issue) => issue.includes(diagnostic)), JSON.stringify(sheet.rowIssues));
  assert.ok(checked.result.comparisons.every((comparison) =>
    Object.entries(comparison).filter(([key]) => key.endsWith('Minor')).every(([, value]) => value === null)));
  assert.ok(checked.result.memberIds.some((id) => {
    const member = JSON.parse(id); return member[1] === 0 && member[4] === row;
  }), 'The unsafe physical member remains visible');
  assert.equal(checked.result.inventory.filter((entry) => entry.source === 0).length, sheet.rows.length);
  assert.deepEqual(checked.state.files[0].original, state.files[0].original);
  assert.deepEqual((await restoreStock(await saveStock(checked.state))).result, checked.result);
  return checked;
}

void test('INV-1B native: genuine ExcelJS defaults and ordinary header styling preserve posted money and dimension mapping', async () => {
  await ready(await native((sheet) => {
    sheet.getCell('A1').font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FF0A1B2E' } };
    sheet.getCell('B22').numFmt = '0.00';
  }));
});

void test('INV-1B native: unused bad font/gradient/rotation and hidden tiny blank decoration do not require a perfect workbook', async () => {
  await ready(await native((sheet) => {
    const decoration = sheet.getCell('D30');
    decoration.font = { name: 'Arial', size: 1, strike: true };
    decoration.fill = { type: 'gradient', gradient: 'angle', degree: 45, stops: [
      { position: 0, color: { argb: 'FFFFFFFF' } }, { position: 1, color: { argb: 'FF7C3AED' } },
    ] };
    decoration.alignment = { textRotation: 90, shrinkToFit: true };
    sheet.getRow(30).height = 1; sheet.getRow(30).hidden = true;
    sheet.getColumn(4).width = 0; sheet.getColumn(4).hidden = true;
  }));
});

void test('INV-1B native: actual row and column dimensions override unusable defaults', async () => {
  await ready(await native((sheet) => {
    for (let row = 1; row <= 24; row++) sheet.getRow(row).height = 15;
  }, {}, async (zip) => {
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(xml, /<sheetFormatPr\b[^>]*\/>/);
    zip.file('xl/worksheets/sheet1.xml', xml.replace(/<sheetFormatPr\b[^>]*\/>/,
      '<sheetFormatPr defaultRowHeight="1" defaultColWidth="0" zeroHeight="1"/>'));
  }));
});

void test('INV-1B native: applied strike, tiny font, clipped dimensions, rotation, shrink and gradient remain source blockers', async () => {
  const faults: [string, (sheet: ExcelJS.Worksheet) => void][] = [
    ['NATIVE_FONT_EFFECT', (sheet) => { sheet.getCell('B22').font = { name: 'Arial', size: 12, strike: true }; }],
    ['NATIVE_FONT_SIZE', (sheet) => { sheet.getCell('B22').font = { name: 'Arial', size: 6 }; }],
    ['NATIVE_DIMENSION', (sheet) => { sheet.getRow(22).height = 1; }],
    ['NATIVE_DIMENSION', (sheet) => { sheet.getColumn(2).width = 1; }],
    ['NATIVE_TEXT_LAYOUT', (sheet) => { sheet.getCell('B22').alignment = { textRotation: 90 }; }],
    ['NATIVE_TEXT_LAYOUT', (sheet) => { sheet.getCell('B22').alignment = { shrinkToFit: true }; }],
    ['NATIVE_STYLE_FEATURE', (sheet) => { sheet.getCell('B22').fill = { type: 'gradient', gradient: 'angle', degree: 45,
      stops: [{ position: 0, color: { argb: 'FFFFFFFF' } }, { position: 1, color: { argb: 'FF7C3AED' } }] }; }],
  ];
  for (const [diagnostic, edit] of faults) await blocked(await native(edit), diagnostic);
});

void test('INV-1B native: date-formatted numeric quantities and posted amounts cannot gain financial authority after raw XML projection', async () => {
  for (const [address, raw, row] of [['B21', '10', 21], ['B22', '600', 22]] as const) {
    const current = await blocked(await native((sheet) => { sheet.getCell(address).numFmt = 'yyyy-mm-dd'; }), 'NATIVE_NUMERIC_FORMAT', row);
    const source = current.state.files[0].sheets[0];
    assert.equal(source.rows[row - 1][1], raw, 'Original numeric XML text remains available');
    assert.equal(source.numericCells?.[`${row}:2`].value, Number(raw), 'Typed numeric source marker prevents identity authority');
    assert.deepEqual(current.result.records[0][0].values.slice(2), [10, 'EA', 0, 60000, 'VAL-1']);
  }
});

void test('INV-1B native: numeric date identities and date-derived scope values remain unsafe source evidence', async () => {
  const item = await blocked(await native((sheet) => {
    sheet.getCell('B15').value = 7; sheet.getCell('B15').numFmt = 'yyyy-mm-dd';
  }, { item: '7' }), 'NATIVE_NUMERIC_FORMAT', 15);
  assert.equal(item.state.files[0].sheets[0].rows[14][1], '7');
  assert.ok(item.result.issues.some((issue) => issue.code === 'NUMERIC_IDENTITY'));
  const date = await blocked(await native((sheet) => {
    sheet.getCell('C9').value = new Date('2026-09-30T00:00:00.000Z');
    sheet.getCell('C9').numFmt = 'yyyy-mm-dd';
  }), 'NATIVE_NUMERIC_FORMAT', 9);
  assert.match(date.state.files[0].sheets[0].rows[8][2], /^\d+$/);
});

void test('INV-1B native: source monetary precision must remain visible and cannot be rounded by a display style', async () => {
  await ready(await native((sheet) => { sheet.getCell('B22').numFmt = '0.000'; }, { currency: 'KWD', amount: '1.234' }), 1234);
  const hidden = await blocked(await native((sheet) => { sheet.getCell('B22').numFmt = '0.00'; },
    { currency: 'KWD', amount: '1.234' }), 'NATIVE_NUMBER_ROUNDING');
  assert.equal(hidden.state.files[0].sheets[0].rows[21][1], '1.234');
  assert.equal(hidden.result.records[0][0].values[5], 1234);
});

void test('INV-1B native: currency formatting must agree with explicit source scope and never define quantity units', async () => {
  await ready(await native((sheet) => { sheet.getCell('B22').numFmt = '"SAR "0.00'; }));
  for (const format of ['"USD "0.00', '[$USD-409]0.00', '$0.00'])
    await blocked(await native((sheet) => { sheet.getCell('B22').numFmt = format; }), 'NATIVE_CURRENCY_CONFLICT');
  for (const [address, row] of [['B21', 21], ['B18', 18]] as const)
    await blocked(await native((sheet) => { sheet.getCell(address).numFmt = '"SAR "0.00'; }), 'NATIVE_CURRENCY_ROLE', row);
});

void test('INV-1B native: Arabic currency labels and other accepted currency symbols cannot contradict the source currency silently', async () => {
  await ready(await native((sheet) => { sheet.getCell('B22').numFmt = '"ر.س."0.00'; }));
  await ready(await native((sheet) => { sheet.getCell('B22').numFmt = '"د.ك."0.000'; },
    { currency: 'KWD', amount: '1.234' }), 1234);
  for (const format of ['"ر.س."0.000', '"د.إ."0.000', '₹0.000', '₩0.000'])
    await blocked(await native((sheet) => { sheet.getCell('B22').numFmt = format; },
      { currency: 'KWD', amount: '1.234' }), 'NATIVE_CURRENCY_CONFLICT');
});

void test('INV-1B native: unknown literal format labels stay unsupported display evidence rather than an invented currency', async () => {
  const state = await native((sheet) => { sheet.getCell('B22').numFmt = '"UNKNOWN LABEL"0.00'; });
  const current = await replayStock(state);
  assert.equal(current.result.financial, 'source-error');
  assert.equal(current.result.totals, null);
  assert.ok(current.state.files[0].sheets[0].cellIssues?.['22:2'].length);
  assert.ok(!Object.values(current.state.files[0].sheets[0].rowIssues ?? {}).flat()
    .some((issue) => issue.includes('NATIVE_CURRENCY_CONFLICT')));
  assert.ok(current.result.memberIds.some((id) => JSON.parse(id)[4] === 22));
});

void test('INV-1B native: inactive negative styles and numeric formatting on literal text cannot manufacture a currency conflict', async () => {
  await ready(await native((sheet) => { sheet.getCell('B22').numFmt = '"SAR "0.00;"USD "-0.00;"SAR "0.00;@'; }));
  await ready(await native((sheet) => {
    sheet.getCell('B22').value = '600.00'; sheet.getCell('B22').numFmt = '"USD "0.00';
  }));
});

void test('INV-1B native: unknown style extensions and worksheet drawing features remain visible source diagnostics', async () => {
  await blocked(await native(() => {}, {}, async (zip) => {
    const xml = await zip.file('xl/styles.xml')!.async('string');
    assert.match(xml, /<ext\b[^>]*\buri="[^"]*"/);
    zip.file('xl/styles.xml', xml.replace(/(<ext\b[^>]*\buri=")[^"]*"/, '$1SYNTHETIC-UNKNOWN-EXTENSION"'));
  }), 'NATIVE_STYLE_FEATURE');
  await blocked(await native((sheet, book) => {
    const image = book.addImage({
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2pVEAAAAASUVORK5CYII=',
      extension: 'png',
    });
    sheet.addImage(image, { tl: { col: 1, row: 21 }, ext: { width: 20, height: 20 } });
  }), 'NATIVE_WORKSHEET_FEATURE');
});

const plainFont: Partial<ExcelJS.Font> = { name: 'Arial', size: 12 };
const strikeFont: Partial<ExcelJS.Font> = { name: 'Arial', size: 12, strike: true };
const attribute = (xml: string, name: string, value: string) => {
  const pattern = new RegExp(`\\b${name}="[^"]*"`);
  return pattern.test(xml) ? xml.replace(pattern, `${name}="${value}"`)
    : xml.replace(/^<xf\b/, `<xf ${name}="${value}"`);
};
function xf(xml: string, family: 'cellXfs' | 'cellStyleXfs', index: number, edit: (value: string) => string) {
  const pattern = new RegExp(`(<${family}\\b[^>]*>)([\\s\\S]*?)(</${family}>)`);
  const match = pattern.exec(xml); assert.ok(match, family);
  const styles = match[2].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)!;
  assert.ok(styles && index < styles.length, 'Known style index');
  const updated = match[2].replace(styles[index], edit(styles[index]));
  return xml.replace(pattern, `${match[1]}${updated}${match[3]}`);
}

void test('INV-1B native: explicit populated cell styles and false applyFont preserve safe overrides of row/column/unused XF strikes', async () => {
  await ready(await native((sheet) => {
    sheet.getRow(22).font = strikeFont;
    sheet.getCell('A22').font = plainFont; sheet.getCell('B22').font = plainFont;
  }, {}, async (zip) => {
    const source = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(source, /<row\b(?=[^>]*\br="22")(?=[^>]*\bs="\d+")/);
    assert.match(source, /<c\b(?=[^>]*\br="B22")(?=[^>]*\bs="\d+")/);
  }));
  await ready(await native((sheet) => {
    sheet.getColumn(2).font = strikeFont;
    for (let row = 1; row <= 24; row++) sheet.getCell(row, 2).font = plainFont;
  }, {}, async (zip) => {
    const source = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(source, /<col\b(?=[^>]*\bmin="2")(?=[^>]*\bstyle="\d+")/);
    assert.match(source, /<c\b(?=[^>]*\br="B22")(?=[^>]*\bs="\d+")/);
  }));
  await ready(await native((sheet) => { sheet.getCell('B22').font = strikeFont; }, {}, async (zip) => {
    const source = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(source, /<c\b(?=[^>]*\br="B22")(?=[^>]*\bs="1")/);
    const styles = await zip.file('xl/styles.xml')!.async('string');
    zip.file('xl/styles.xml', xf(styles, 'cellXfs', 1, (tag) => attribute(tag, 'applyFont', '0')));
  }));
});

void test('INV-1B native: inherited row/column/base XF strikes cannot evade a source blocker by omitting a cell style', async () => {
  await blocked(await native((sheet) => {
    sheet.getRow(22).font = strikeFont; sheet.getCell('A22').font = plainFont;
  }, {}, async (zip) => {
    const source = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(source, /<row\b(?=[^>]*\br="22")(?=[^>]*\bs="\d+")/);
    zip.file('xl/worksheets/sheet1.xml', source.replace(/(<c\b[^>]*\br="B22"[^>]*)\bs="\d+"/, '$1'));
  }), 'NATIVE_FONT_EFFECT');
  await blocked(await native((sheet) => {
    sheet.getColumn(2).font = strikeFont;
    for (let row = 1; row <= 24; row++) if (row !== 22) sheet.getCell(row, 2).font = plainFont;
  }, {}, async (zip) => {
    const source = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(source, /<col\b(?=[^>]*\bmin="2")(?=[^>]*\bstyle="\d+")/);
    zip.file('xl/worksheets/sheet1.xml', source.replace(/(<c\b[^>]*\br="B22"[^>]*)\bs="\d+"/, '$1'));
  }), 'NATIVE_FONT_EFFECT');
  await blocked(await native((sheet) => { sheet.getCell('B22').font = strikeFont; }, {}, async (zip) => {
    const source = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.match(source, /<c\b(?=[^>]*\br="B22")(?=[^>]*\bs="1")/);
    let styles = await zip.file('xl/styles.xml')!.async('string');
    styles = xf(styles, 'cellXfs', 1, (tag) => attribute(attribute(tag, 'fontId', '0'), 'applyFont', '0'));
    styles = xf(styles, 'cellStyleXfs', 0, (tag) => attribute(tag, 'fontId', '1'));
    zip.file('xl/styles.xml', styles);
  }), 'NATIVE_FONT_EFFECT');
});
