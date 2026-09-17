import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  parseCSV,
  readFile,
  exportWorkbook,
  checkZip,
} from '../lib/reconciliation/io.ts';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
const buf = (s: string) => new TextEncoder().encode(s).buffer;
test('CSV quoted comma/newline, escaped quote, semicolon and BOM', () => {
  assert.deepEqual(
    parseCSV('\uFEFFdate;reference;amount\r\n2026-01-01;"INV;1";"1,25"'),
    [
      ['date', 'reference', 'amount'],
      ['2026-01-01', 'INV;1', '1,25'],
    ],
  );
  assert.deepEqual(parseCSV('a,b\n"line\nnext","quote""here"'), [
    ['a', 'b'],
    ['line\nnext', 'quote"here'],
  ]);
});
test('broken CSV, invalid encoding, wrong extension rejected', async () => {
  assert.throws(() => parseCSV('a,b\n"broken,2'));
  await assert.rejects(() => readFile('x.pdf', buf('a,b')));
  await assert.rejects(() =>
    readFile('x.csv', new Uint8Array([0xff, 0xfe]).buffer),
  );
});
test('non-ZIP input is rejected by the preliminary archive check', () => {
  assert.throws(() => checkZip(buf('not zip')));
});
test('XLSX preserves formatted reference zeros and flags formula rows', async () => {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Data');
  s.addRow(['date', 'reference', 'amount']);
  s.addRow([new Date('2026-08-01T00:00:00Z'), 104, 100]);
  s.getCell('B2').numFmt = '000000';
  s.addRow(['2026-08-02', 'INV-2', { formula: '1+1', result: 2 }]);
  s.getRow(2).hidden = true;
  const b = await wb.xlsx.writeBuffer();
  const r = await readFile('synthetic.xlsx', new Uint8Array(b).buffer);
  assert.equal(r.sheets[0].rows[1][1], '000104');
  assert.equal(r.sheets[0].rows[1][0], '2026-08-01');
  assert.deepEqual(r.sheets[0].formulaRows, [3]);
  assert.deepEqual(r.sheets[0].formulaCells, { '3:3': { formula: '1+1' } });
  assert.deepEqual(r.sheets[0].hiddenRows, [2]);
});
test('Excel export roundtrip retains controls/source and never turns input into formula', async () => {
  const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
  const files = structuredClone(demoFiles);
  files[0].sheets[0].rows[1][2] = '=HYPERLINK("https://example.invalid","x")';
  const r = compare(
    normalizeSource(files[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(files[1], demoMappings[1], scope, 'ledger'),
    scope,
  );
  const b = await exportWorkbook(r, files, {
    checked: false,
    name: '',
    notes: '=1+1',
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(b);
  assert.equal(wb.creator, 'Tarasuf Local');
  assert.equal(wb.getWorksheet('Matches')!.rowCount, 3);
  assert.equal(wb.getWorksheet('Parsed Supplier Source')!.rowCount, 10);
  let formulas = 0;
  wb.eachSheet((s) =>
    s.eachRow((row) =>
      row.eachCell((c) => {
        if (c.type === ExcelJS.ValueType.Formula) {
          formulas++;
          assert.ok(['Summary', 'Reconciliation Bridge'].includes(s.name));
          assert.doesNotMatch(c.formula, /HYPERLINK|https?:\/\//i);
        }
      }),
    ),
  );
  assert.ok(formulas > 0, 'only engine-generated totals are native formulas');
  assert.equal(
    wb.getWorksheet('Supplier transactions')!.getCell('G2').value,
    files[0].sheets[0].rows[1][2],
  );
  assert.ok(wb.getWorksheet('Summary')!.getColumn(2).values.includes(42000));
  const signoff = wb.getWorksheet('Review Sign-off')!;
  assert.equal(signoff.getCell('B7').value, '=1+1');
  assert.equal(signoff.getCell('B7').type, ExcelJS.ValueType.String);
  assert.match(String(signoff.getCell('B8').value), /TARASUF/);
  assert.doesNotMatch(String(signoff.getCell('B8').value), /Mizan/);
  assert.ok(
    wb
      .getWorksheet('Needs Review')!
      .getColumn(10)
      .values.some(
        (value) =>
          typeof value === 'string' && value.includes('decision in TARASUF'),
      ),
  );
});
