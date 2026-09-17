import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import { inferMapping, normalizeSource } from '../lib/reconciliation/core.ts';
import { extractStatementMetadata } from '../lib/reconciliation/statement-metadata.ts';
import { demoScope } from '../lib/reconciliation/demo.ts';

const scope = { ...demoScope, confirmed: true, cutoff: '2026-08-31' };
async function workbook(
  rows: unknown[][],
  configure?: (sheet: ExcelJS.Worksheet) => void,
) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Data');
  rows.forEach((row) => sheet.addRow(row));
  configure?.(sheet);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
const basic = () =>
  workbook([
    ['Date', 'Reference', 'Amount'],
    ['2026-08-01', '000012345678901234567', 100],
    ['2026-08-02', 'CR-002', -20],
  ]);
async function mutate(xmlEdit: (xml: string) => string, bytes?: ArrayBuffer) {
  const archive = await JSZip.loadAsync(bytes ?? (await basic()));
  const path = 'xl/worksheets/sheet1.xml';
  archive.file(path, xmlEdit(await archive.file(path)!.async('string')));
  return archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

test('R045 XML second sheetData cannot replace earlier financial rows', async () => {
  const bytes = await mutate((xml) =>
    xml.replace(
      '</sheetData>',
      '</sheetData><sheetData><row r="4"><c r="A4" t="str"><v>2026-08-03</v></c><c r="B4" t="str"><v>003</v></c><c r="C4"><v>300</v></c></row></sheetData>',
    ),
  );
  await assert.rejects(
    readFile('statement.xlsx', bytes),
    /sheetData|جدول|بنية/,
  );
});

test('R045 mixed cell payloads cannot concatenate into a different amount', async () => {
  for (const payload of [
    '<v>100</v><is><t>999</t></is>',
    '<is><t>999</t></is><v>100</v>',
    '<v>100</v><is><r><t>999</t></r></is>',
  ]) {
    const bytes = await mutate((xml) =>
      xml.replace('<c r="C2"><v>100</v></c>', `<c r="C2">${payload}</c>`),
    );
    await assert.rejects(readFile('statement.xlsx', bytes), /خلية|بنية/);
  }
});

test('R045 invalid row coordinates cannot silently discard a movement', async () => {
  for (const row of ['0', '-1', '2tail', '2.5']) {
    const bytes = await mutate((xml) =>
      xml
        .replace('<row r="2"', `<row r="${row}"`)
        .replace(/r="([A-C])2"/g, (_, column) => `r="${column}${row}"`),
    );
    await assert.rejects(readFile('statement.xlsx', bytes), /صف|موضع|إحداثيات/);
  }
});

test('R045 valid reordered columns, inline text and long references remain exact', async () => {
  const bytes = await workbook([
    ['Amount', 'Description', 'Reference', 'Date'],
    [
      100,
      { richText: [{ text: 'فاتورة ' }, { text: 'supplier' }] },
      '000012345678901234567',
      '2026-08-01',
    ],
    [-20, 'credit', 'CR-002', '2026-08-02'],
  ]);
  const file = await readFile('statement.xlsx', bytes);
  const result = normalizeSource(file, inferMapping(file), scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((t) => [t.reference, t.amount]),
    [
      ['000012345678901234567', 10000],
      ['CR-002', -2000],
    ],
  );
  assert.equal(result.transactions[0].description, 'فاتورة supplier');
  assert.equal(result.total, 8000);
});

test('R045 closing balance currency is evidence, not disposable footer text', async () => {
  for (const currency of ['USD', 'EUR']) {
    const bytes = await workbook([
      ['Date', 'Reference', 'Amount', 'Currency'],
      ['2026-08-01', 'INV-1', 100, 'SAR'],
      ['Closing balance', '', 100, currency],
    ]);
    const file = await readFile('statement.xlsx', bytes);
    const metadata = extractStatementMetadata(file, inferMapping(file), {
      ...scope,
      currency: 'SAR',
    });
    assert.equal(metadata.closingBalance, null);
    assert.ok(
      metadata.warnings.some((w) => /BALANCE_CURRENCY_MISMATCH/.test(w)),
    );
  }
});

test('R045 native formula cache validation does not reinterpret decimal point as grouping', async () => {
  const bytes = await workbook([
    ['Date', 'Reference', 'Amount'],
    ['2026-08-01', 'INV-1', 1.234],
    ['Closing balance', '', { formula: 'C2', result: 1.234 }],
  ]);
  const file = await readFile('statement.xlsx', bytes);
  const mapping = { ...inferMapping(file), numberFormat: 'comma' as const };
  const metadata = extractStatementMetadata(file, mapping, {
    ...scope,
    decimals: 3,
  });
  assert.equal(metadata.closingBalance, 1234);
  assert.equal(
    metadata.balanceRowReference.closing?.method,
    'formula-evaluated',
  );
});

test('R045 duplicate workbook containers and worksheet IDs cannot discard a complete sheet', async () => {
  const book = new ExcelJS.Workbook();
  for (const name of ['First', 'Second']) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(['Date', 'Reference', 'Amount']);
    sheet.addRow(['2026-08-01', name, 100]);
  }
  const original = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
  for (const edit of [
    (xml: string) =>
      xml.replace(/<sheets>([\s\S]+?)<\/sheets>/, (_, items: string) => {
        const nodes = items.match(/<sheet[^>]*\/>/g)!;
        return `<sheets>${nodes[0]}</sheets><sheets>${nodes[1]}</sheets>`;
      }),
    (xml: string) => xml.replace('sheetId="2"', 'sheetId="1"'),
  ]) {
    const archive = await JSZip.loadAsync(original);
    archive.file(
      'xl/workbook.xml',
      edit(await archive.file('xl/workbook.xml')!.async('string')),
    );
    await assert.rejects(
      readFile(
        'statement.xlsx',
        await archive.generateAsync({ type: 'arraybuffer' }),
      ),
      /مكرر|ورقة|بنية/,
    );
  }
});

test('R045 explicit as-of metadata is retained independently of prepared date', async () => {
  for (const label of [
    'As of',
    'Statement as of',
    'Cut-off date',
    'تاريخ القطع',
    'حتى تاريخ',
  ]) {
    const bytes = await workbook([
      [label, '2026-08-31'],
      ['Prepared date', '2026-09-05'],
      ['Date', 'Reference', 'Amount'],
      ['2026-08-01', 'INV-1', 100],
    ]);
    const file = await readFile('statement.xlsx', bytes);
    const metadata = extractStatementMetadata(file, inferMapping(file), scope);
    assert.equal(metadata.periodEnd, '2026-08-31', label);
    assert.ok(
      metadata.evidence.some((e) => e.field === 'periodEnd' && e.row === 1),
    );
  }
});

test('R045 duplicate date systems or style definitions cannot change dates or erase reference zeros', async () => {
  const bytes = await workbook(
    [
      ['Date', 'Reference', 'Amount'],
      [new Date('2026-08-01T00:00:00Z'), 12, 100],
    ],
    (sheet) => {
      sheet.getCell('B2').numFmt = '000000';
    },
  );
  for (const [path, edit] of [
    [
      'xl/workbook.xml',
      (xml: string) =>
        xml.replace('</workbook>', '<workbookPr date1904="1"/></workbook>'),
    ],
    [
      'xl/styles.xml',
      (xml: string) =>
        xml.replace(
          '</numFmts>',
          '<numFmt numFmtId="164" formatCode="General"/></numFmts>',
        ),
    ],
    [
      'xl/styles.xml',
      (xml: string) =>
        xml.replace(
          '</styleSheet>',
          '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
        ),
    ],
  ] as const) {
    const archive = await JSZip.loadAsync(bytes);
    archive.file(path, edit(await archive.file(path)!.async('string')));
    await assert.rejects(
      readFile(
        'statement.xlsx',
        await archive.generateAsync({ type: 'arraybuffer' }),
      ),
      /مكرر|متعارض|بنية/,
    );
  }
});

test('R045 missing or aliased worksheet parts cannot silently remove or relabel source data', async () => {
  const book = new ExcelJS.Workbook();
  for (const name of ['First', 'Second']) {
    const sheet = book.addWorksheet(name);
    sheet.addRow(['Date', 'Reference', 'Amount']);
    sheet.addRow(['2026-08-01', name, 100]);
  }
  const original = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
  for (const mode of [
    'missingPart',
    'missingRelationship',
    'duplicateRelationshipTarget',
  ]) {
    const archive = await JSZip.loadAsync(original);
    if (mode === 'missingPart') archive.remove('xl/worksheets/sheet1.xml');
    else {
      const path = 'xl/_rels/workbook.xml.rels';
      const xml = await archive.file(path)!.async('string');
      archive.file(
        path,
        mode === 'missingRelationship'
          ? xml.replace(
              /<Relationship[^>]+Target="worksheets\/sheet1.xml"[^>]*\/>/,
              '',
            )
          : xml.replace('worksheets/sheet2.xml', 'worksheets/sheet1.xml'),
      );
    }
    await assert.rejects(
      readFile(
        'statement.xlsx',
        await archive.generateAsync({ type: 'arraybuffer' }),
      ),
      /ورقة|مكرر|ناقص|رابط/,
    );
  }
});

test('R045 balance metadata rejects a wrong formula cache and retains a matching currency', async () => {
  for (const result of [1.234, 9.999]) {
    const bytes = await workbook([
      ['Date', 'Reference', 'Amount', 'Currency'],
      ['2026-08-01', 'INV-1', 1.234, 'SAR'],
      ['Closing balance', '', { formula: 'C2', result }, 'SAR'],
    ]);
    const file = await readFile('statement.xlsx', bytes);
    const mapping = { ...inferMapping(file), numberFormat: 'comma' as const };
    const metadata = extractStatementMetadata(file, mapping, {
      ...scope,
      decimals: 3,
    });
    assert.equal(metadata.closingBalance, result === 1.234 ? 1234 : null);
    if (result !== 1.234)
      assert.ok(
        metadata.warnings.some((w) => w.includes('FORMULA_CACHE_MISMATCH')),
      );
  }
});

test('R045 conflicting or ambiguous snapshot metadata cannot produce a verified date', async () => {
  for (const preamble of [
    [['As of', '08/09/2026']],
    [
      ['As of', '2026-08-31'],
      ['Period', '2026-08-01 to 2026-09-30'],
    ],
    [['Prepared date', '2026-09-05']],
  ]) {
    const bytes = await workbook([
      ...preamble,
      ['Date', 'Reference', 'Amount'],
      ['2026-08-01', 'INV-1', 100],
    ]);
    const file = await readFile('statement.xlsx', bytes);
    const metadata = extractStatementMetadata(file, inferMapping(file), scope);
    assert.equal(metadata.periodEnd, '');
  }
});

test('R045 an uncached transaction formula remains an explicit issue rather than zero or a deleted row', async () => {
  const bytes = await workbook([
    ['Date', 'Reference', 'Amount'],
    ['2026-08-01', 'INV-1', { formula: '100+20' }],
    ['2026-08-02', 'INV-2', 10],
  ]);
  const file = await readFile('statement.xlsx', bytes);
  const result = normalizeSource(file, inferMapping(file), scope, 'supplier');
  assert.equal(file.sheets[0].rows.length, 3);
  assert.ok(result.errors.some((e) => e.row === 2 && /صيغة/.test(e.message)));
  assert.deepEqual(
    result.transactions.map((t) => [t.reference, t.amount]),
    [['INV-2', 1000]],
  );
  assert.equal(
    result.excluded.some((row) => row.row === 2),
    false,
  );
});

test('R045 standard 1904 dates, sparse rows and deterministic omitted subsequent cell coordinates remain supported', async () => {
  const book = new ExcelJS.Workbook();
  book.properties.date1904 = true;
  const sheet = book.addWorksheet('Data');
  sheet.addRow(['Date', 'Reference', 'Amount']);
  sheet.getRow(4).values = [new Date('2026-08-01T00:00:00Z'), '00012', 100];
  const bytes = await mutate(
    (xml) => xml.replace('<c r="B4"', '<c'),
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  const file = await readFile('statement.xlsx', bytes);
  const result = normalizeSource(file, inferMapping(file), scope, 'supplier');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.transactions.map((t) => [t.row, t.date, t.reference, t.amount]),
    [[4, '2026-08-01', '00012', 10000]],
  );
  assert.deepEqual(
    result.excluded.map((row) => row.row),
    [1, 2, 3],
  );
});

test('R045 running balance column currency cannot be borrowed from a different currency scope', async () => {
  const file = await readFile(
    'statement.xlsx',
    await workbook([
      ['Date', 'Reference', 'Amount (SAR)', 'Running balance (USD)'],
      ['Opening balance', '', '', 100],
      ['2026-08-01', 'INV-1', 20, 120],
      ['Closing balance', '', '', 120],
    ]),
  );
  const metadata = extractStatementMetadata(file, inferMapping(file), {
    ...scope,
    currency: 'SAR',
  });
  assert.equal(metadata.openingBalance, null);
  assert.equal(metadata.closingBalance, null);
  assert.ok(
    metadata.warnings.some((w) => w.startsWith('BALANCE_CURRENCY_MISMATCH')),
  );
});
