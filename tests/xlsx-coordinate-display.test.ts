import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import { prepareXlsxForExcelJs } from '../lib/reconciliation/xlsx-namespaces.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { defaultMapping, type Scope } from '../lib/reconciliation/types.ts';

// C-0: identical accounting facts, different OOXML coordinate serialization.
// The missing address must not detach the original cell's display constraints.
const scope: Scope = {
  supplier: 'Synthetic Coordinate Supplier',
  entity: 'Synthetic Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2 };
const review = { checked: false, name: '', notes: '' };
const sheetPath = 'xl/worksheets/sheet1.xml';
type Edit = (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void;
async function workbook(edit?: Edit) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Synthetic');
  sheet.addRows([
    ['Date', 'Reference', 'Amount'],
    ['2026-07-01', 'I-001', 100],
    ['2026-07-02', 'I-002', 25],
  ]);
  edit?.(sheet, book);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
async function mutate(bytes: ArrayBuffer, edit: (xml: string) => string) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file(sheetPath)!.async('string');
  const changed = edit(xml);
  assert.notEqual(changed, xml, 'the structural variant must alter real XML');
  zip.file(sheetPath, changed);
  return zip.generateAsync({ type: 'arraybuffer' });
}
const ledger = () =>
  readFile(
    'ledger.csv',
    new TextEncoder().encode(
      'Date,Reference,Amount,Description\n2026-07-01,I-001,100,Ledger invoice one\n2026-07-02,I-002,25,Ledger invoice two\n',
    ).buffer,
  );
const normalized = (file: Awaited<ReturnType<typeof readFile>>) =>
  normalizeSource(file, mapping, scope, 'supplier');

for (const defect of ['white-amount', 'hidden-amount', 'hidden-reference']) {
  void test(`implicit and zero-padded coordinates cannot bypass ${defect}`, async () => {
    const address = defect === 'hidden-reference' ? 'B2' : 'C2';
    const original = await workbook((sheet) => {
      if (defect === 'white-amount')
        sheet.getCell(address).font = { color: { argb: 'FFFFFFFF' } };
      else sheet.getCell(address).numFmt = ';;;';
    });
    const baseline = await readFile('source.xlsx', original);
    assert.equal(normalized(baseline).errors.length, 1);
    const other = await ledger();
    const expected = reconcileSupplierStatement({
      files: [baseline, other],
      mappings: [mapping, mapping],
      scope,
    });
    for (const replacement of [
      '',
      'r=""',
      `r="${address.replace('2', '02')}"`,
    ]) {
      const bytes = await mutate(original, (xml) =>
        xml.replace(`r="${address}"`, replacement),
      );
      const file = await readFile('source.xlsx', bytes);
      assert.deepEqual(
        file.sheets[0].cellIssues,
        baseline.sheets[0].cellIssues,
      );
      assert.deepEqual(normalized(file).errors, normalized(baseline).errors);
      assert.deepEqual(
        normalized(file).transactions.map((t) => [
          t.row,
          t.reference,
          t.amount,
        ]),
        [[3, 'I-002', 2500]],
      );
      const actual = reconcileSupplierStatement({
        files: [file, other],
        mappings: [mapping, mapping],
        scope,
      });
      const memberships = (value: typeof actual) =>
        value.result.cases.map((c) => [
          c.status,
          c.supplierMembers.map((m) => m.row),
          c.ledgerMembers.map((m) => m.row),
        ]);
      assert.deepEqual(memberships(actual), memberships(expected));
      assert.ok(
        !actual.result.cases.some(
          (c) =>
            c.status === 'Matched' &&
            c.supplierMembers.some((m) => m.row === 2),
        ),
      );
      assert.deepEqual(
        file.original,
        bytes,
        'compatibility bytes never replace the original',
      );
      assert.equal(
        file.sha256,
        createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
      );
    }
  });
}

void test('visible implicit cells retain exact values, styles and financial membership', async () => {
  const original = await workbook((sheet) => {
    sheet.getCell('C2').numFmt = '#,##0.00;[Red](#,##0.00)';
    sheet.getCell('C3').numFmt = '#,##0.00;[Red](#,##0.00)';
  });
  const bytes = await mutate(original, (xml) =>
    xml.replace(/r="[BC][23]"/g, ''),
  );
  const file = await readFile('source.xlsx', bytes);
  assert.deepEqual(normalized(file).errors, []);
  assert.deepEqual(
    normalized(file).transactions.map((t) => [t.row, t.reference, t.amount]),
    [
      [2, 'I-001', 10000],
      [3, 'I-002', 2500],
    ],
  );
  const result = reconcileSupplierStatement({
    files: [file, await ledger()],
    mappings: [mapping, mapping],
    scope,
  });
  assert.deepEqual(
    result.result.cases.map((c) => [
      c.status,
      c.supplierMembers.map((m) => m.row),
      c.ledgerMembers.map((m) => m.row),
    ]),
    [
      ['Matched', [2], [2]],
      ['Matched', [3], [3]],
    ],
  );
});

void test('sparse jumps, blank cells and sheet boundaries keep style addresses attached', async () => {
  const original = await workbook((sheet, book) => {
    sheet.getCell('Z2').value = 'anchor';
    sheet.getCell('AA2').value = 'blank placeholder';
    sheet.getCell('AB2').value = 7;
    sheet.getCell('AB2').numFmt = ';;;';
    sheet.getCell('AA3').value = 8;
    sheet.getCell('AA3').font = { color: { argb: 'FFFFFFFF' } };
    book.addWorksheet('Visible second').addRows([['Amount'], [9]]);
  });
  const bytes = await mutate(original, (xml) =>
    xml
      .replace(/<c r="AA2"[^>]*>.*?<\/c>/, '<c/>')
      .replace('r="AB2"', '')
      .replace('r="AA3"', 'r="AA03"'),
  );
  const file = await readFile('source.xlsx', bytes);
  assert.equal(file.sheets[0].rows[1][26], '');
  assert.equal(file.sheets[0].rows[1][27], '7');
  assert.ok(file.sheets[0].cellIssues?.['2:28']?.length);
  assert.ok(file.sheets[0].cellIssues?.['3:27']?.length);
  assert.deepEqual(file.sheets[1].cellIssues, {});
  assert.equal(file.sheets[1].rows[1][0], '9');
});

void test('explicit visible cell overrides inherited hidden style even with an implicit address', async () => {
  const original = await workbook((sheet) => {
    sheet.getColumn(3).font = { color: { argb: 'FFFFFFFF' } };
    sheet.getCell('C2').font = { color: { argb: 'FF000000' } };
  });
  const baseline = await readFile('source.xlsx', original);
  const bytes = await mutate(original, (xml) => xml.replace('r="C2"', ''));
  const file = await readFile('source.xlsx', bytes);
  assert.deepEqual(file.sheets[0].cellIssues, baseline.sheets[0].cellIssues);
  assert.deepEqual(
    normalized(file).transactions.map((t) => t.row),
    [2],
  );
});

void test('coordinate compatibility is idempotent and composes with namespace conversion', async () => {
  const original = await workbook((sheet) => {
    sheet.getCell('C2').numFmt = ';;;';
  });
  assert.equal(
    await prepareXlsxForExcelJs(original),
    original,
    'ordinary bytes are not repacked',
  );
  const bytes = await mutate(original, (xml) =>
    xml
      .replace('r="C2"', '')
      .replace(/(<\/?)([A-Za-z][\w]*)(?=[\s/>])/g, '$1s:$2')
      .replace(
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        'xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      ),
  );
  const compatible = await prepareXlsxForExcelJs(bytes);
  assert.equal(await prepareXlsxForExcelJs(compatible), compatible);
  const xml = await (
    await JSZip.loadAsync(compatible)
  )
    .file(sheetPath)!
    .async('string');
  assert.match(xml, /<c[^>]*r="C2"/);
  const file = await readFile('source.xlsx', bytes);
  assert.ok(file.sheets[0].cellIssues?.['2:3']?.length);
  assert.deepEqual(file.original, bytes);
});

void test('coordinate rewriting preserves literal inline reference characters, including XML CR entities', async () => {
  const bytes = await mutate(await workbook(), (xml) =>
    xml.replace(
      /<c r="B2"[^>]*>.*?<\/c>/,
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">REF&#13;001 &amp; &lt; &gt;</t></is></c>',
    ),
  );
  const implicit = await mutate(bytes, (xml) => xml.replace('r="C2"', ''));
  for (const source of [bytes, implicit]) {
    const file = await readFile('source.xlsx', source);
    assert.equal(file.sheets[0].rows[1][1], 'REF\r001 & < >');
    assert.deepEqual(file.original, source);
  }
});

void test('coordinate fix preserves existing rejection of collisions, overflow and unsupported origins', async () => {
  const original = await workbook();
  const edits = [
    (xml: string) => xml.replace('r="B2"', '').replace('r="C2"', 'r="B2"'),
    (xml: string) => xml.replace('r="B2"', '').replace('r="C2"', 'r="C3"'),
    (xml: string) => xml.replace('r="B2"', 'r="CV2"').replace('r="C2"', ''),
    (xml: string) => xml.replace('r="A2"', ''),
    (xml: string) => xml.replace('<row r="2"', '<row'),
  ];
  for (const edit of edits)
    await assert.rejects(
      readFile('source.xlsx', await mutate(original, edit)),
      /مكررة|لا يطابق|حد الأعمدة|غير محدد|إحداثيات صف/,
    );
});

void test('original-based save, restore and export retain the implicit-cell defect and unaffected row', async () => {
  const bytes = await mutate(
    await workbook((sheet) => {
      sheet.getCell('C2').font = { color: { argb: 'FFFFFFFF' } };
    }),
    (xml) => xml.replace('r="C2"', ''),
  );
  const file = await readFile('source.xlsx', bytes);
  const other = await ledger();
  const restored = await restoreSession(
    await saveSession({
      files: [file, other],
      mappings: [mapping, mapping],
      scope,
      decisions: [],
      rejected: [],
      events: [],
      review,
    }),
  );
  assert.deepEqual(restored.files[0].original, bytes);
  assert.equal(restored.files[0].sha256, file.sha256);
  assert.equal(
    restored.result.cases.filter((c) => c.status === 'Matched').length,
    1,
  );
  assert.deepEqual(
    restored.result.cases
      .find((c) => c.status === 'Matched')!
      .supplierMembers.map((m) => m.row),
    [3],
  );
  assert.ok(normalized(restored.files[0]).errors.some((e) => e.row === 2));
  const output = new ExcelJS.Workbook();
  await output.xlsx.load(
    await exportWorkbook(restored.result, restored.files, review),
  );
  const parsed = output.getWorksheet('Parsed Supplier Source')!;
  assert.ok(parsed);
  assert.equal(
    parsed.getCell('D3').value,
    '100',
    'rejected amount stays in the source copy',
  );
});
