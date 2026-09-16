import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import { prepareXlsxForExcelJs } from '../lib/reconciliation/xlsx-namespaces.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
import { demoScope } from '../lib/reconciliation/demo.ts';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const scope = { ...demoScope, confirmed: true, cutoff: '2026-08-31' };

async function synthetic() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic');
  sheet.addRow(['Date', 'Reference', 'Amount', 'Description']);
  sheet.addRow([
    '2026-08-01',
    '000017',
    1234.56,
    'فاتورة & <x:row> — synthetic',
  ]);
  sheet.addRow(['2026-08-02', 'CR-018', -34.56, 'Synthetic credit']);
  sheet.getColumn(3).numFmt = '#,##0.00;[Red](#,##0.00)';
  const raw = new Uint8Array(
    await workbook.xlsx.writeBuffer({ useSharedStrings: true }),
  );
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}

// Only synthetic XML generated above is edited by this fixture builder.
// Production normalization uses a namespace-aware XML parser, never this regex.
async function prefixed(original: ArrayBuffer, relationshipPrefix = 'rel') {
  const zip = await JSZip.loadAsync(original);
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || (!path.endsWith('.xml') && !path.endsWith('.rels')))
      continue;
    let xml = await entry.async('string');
    const namespace = xml.includes(`xmlns="${MAIN}"`)
      ? MAIN
      : xml.includes(`xmlns="${RELS}"`)
        ? RELS
        : undefined;
    if (!namespace) continue;
    const prefix = namespace === MAIN ? 'x' : 'pkg';
    xml = xml
      .replace(`xmlns="${namespace}"`, `xmlns:${prefix}="${namespace}"`)
      .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, `<$1${prefix}:$2`)
      .replace(/xmlns:r=/g, `xmlns:${relationshipPrefix}=`)
      .replace(/\sr:id=/g, ` ${relationshipPrefix}:id=`);
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

test('prefixed SpreadsheetML workbook, styles, shared strings, worksheets and relationship parts are accepted without changing values', async () => {
  const original = await synthetic();
  const namespaced = await prefixed(original);
  // Reproduces the ExcelJS error that previously rejected the supplied originals.
  await assert.rejects(
    new ExcelJS.Workbook().xlsx.load(namespaced),
    /sheets|Unexpected xml node/,
  );
  const plain = await readFile('synthetic.xlsx', original);
  const source = await readFile('synthetic.xlsx', namespaced);
  validateWorkerValue('read', source, {
    name: 'synthetic.xlsx',
    buffer: namespaced,
  });
  assert.deepEqual(source.sheets, plain.sheets);
  assert.deepEqual(
    new Uint8Array(source.original!),
    new Uint8Array(namespaced),
  );
  assert.notEqual(source.sha256, plain.sha256);
  const mapping = selectImportMapping(source, 'supplier').mapping;
  const normalized = normalizeSource(source, mapping, scope, 'supplier');
  assert.deepEqual(normalized.errors, []);
  assert.deepEqual(
    normalized.transactions.map((row) => row.amount),
    [123456, -3456],
  );
  assert.deepEqual(
    normalized.transactions.map((row) => row.reference),
    ['000017', 'CR-018'],
  );
  assert.equal(normalized.total, 120000);
  assert.equal(
    normalized.transactions[0].description,
    'فاتورة & <x:row> — synthetic',
  );
});

test('ordinary canonical workbook is passed through without repacking', async () => {
  const original = await synthetic();
  assert.ok((await prepareXlsxForExcelJs(original)) === original);
});

test('namespace conversion retains formulas and dangerous sign formats as review blockers', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic');
  sheet.addRow(['Date', 'Reference', 'Amount']);
  sheet.addRow(['2026-08-01', 'SYNTHETIC-1', -25]);
  sheet.getCell('C2').numFmt = '0.00;0.00';
  sheet.addRow(['2026-08-02', 'SYNTHETIC-2', { formula: '10+20', result: 30 }]);
  const plainBytes = new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
  const original = await readFile('synthetic.xlsx', plainBytes);
  const source = await readFile('synthetic.xlsx', await prefixed(plainBytes));
  assert.deepEqual(source.sheets, original.sheets);
  const mapping = selectImportMapping(source, 'supplier').mapping;
  const result = normalizeSource(source, mapping, scope, 'supplier');
  assert.deepEqual(
    result.errors.map((error) => error.row),
    [2, 3],
  );
  assert.equal(result.transactions.length, 0);
});

test('foreign namespace lookalikes are rejected instead of stripped into accounting fields', async () => {
  for (const root of [true, false]) {
    const zip = await JSZip.loadAsync(await prefixed(await synthetic()));
    const path = root ? 'xl/workbook.xml' : 'xl/worksheets/sheet1.xml';
    let xml = await zip.file(path)!.async('string');
    xml = root
      ? xml.replace(MAIN, 'https://example.invalid/not-spreadsheetml')
      : xml.replace(
          '<x:sheetData>',
          '<x:sheetData xmlns:x="https://example.invalid/not-spreadsheetml">',
        );
    zip.file(path, xml);
    await assert.rejects(
      readFile(
        'synthetic.xlsx',
        await zip.generateAsync({ type: 'arraybuffer' }),
      ),
      /مساحة أسماء/,
    );
  }
});

test('undeclared XML prefixes and DTDs fail explicitly without accepting incomplete worksheets', async () => {
  for (const mode of ['undeclared', 'doctype']) {
    const zip = await JSZip.loadAsync(await prefixed(await synthetic()));
    let xml = await zip.file('xl/workbook.xml')!.async('string');
    xml =
      mode === 'undeclared'
        ? xml.replace(`xmlns:x="${MAIN}"`, '')
        : xml.replace(
            '?>',
            '?><!DOCTYPE x:workbook [<!ENTITY injected "999999">]>',
          );
    zip.file('xl/workbook.xml', xml);
    await assert.rejects(
      readFile(
        'synthetic.xlsx',
        await zip.generateAsync({ type: 'arraybuffer' }),
      ),
      /XML|DTD/,
    );
  }
});

test('namespaced and canonical Excel reads are independent in either order and after an invalid file', async () => {
  const original = await synthetic();
  const namespaced = await prefixed(original, 'relationships');
  for (const input of [namespaced, original, namespaced]) {
    const source = await readFile('synthetic.xlsx', input);
    assert.equal(source.sheets[0].rows.length, 3);
  }
  await assert.rejects(readFile('synthetic.xlsx', new ArrayBuffer(22)));
  const [a, b] = await Promise.all([
    readFile('synthetic.xlsx', namespaced),
    readFile('synthetic.xlsx', original),
  ]);
  assert.deepEqual(a.sheets, b.sheets);
});
