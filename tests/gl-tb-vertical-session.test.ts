import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_SHEETS,
} from '../lib/reconciliation/types.ts';
import {
  GL_TB_VERSION,
  GL_TB_VERTICAL_FAMILY,
  BALANCE_FIELDS,
  reconcileGlTb,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import {
  replayGlTb,
  saveGlTb,
  restoreGlTb,
  exportGlTb,
} from '../lib/reconciliation/gl-tb-io.ts';

// Test originals are independently authored, with all six gross values supplied.
const scope = {
  entity: 'Entity A',
  ledger: 'Actual',
  account: '001100',
  dimensions: 'region=SA;cost=001',
  currency: 'SAR',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'actual',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
const scopeHeaders = [
  'Entity',
  'Ledger',
  'Account',
  'Complete dimensions',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
];
const fields = Object.values(scope).slice(0, 10) as string[];
const snapshot = ' \uFEFFSnapshot α\u00A0 ';
const originalOpening = ' \u200f١٠٠٠٫٠٠ ';
const glRows = [
  [
    'Record ID',
    'Record kind',
    'Posting date',
    ...scopeHeaders,
    'Debit',
    'Credit',
  ],
  ['GL-open', 'opening', scope.start, ...fields, '1000', '100'],
  ['GL-move', 'movement', '2026-09-15', ...fields, '300', '100'],
  ['GL-close', 'closing', scope.end, ...fields, '1200', '100'],
];
const tbRows = [
  ['Snapshot ID', 'Balance role', ...scopeHeaders, 'Debit', 'Credit'],
  [snapshot, ' opening ', ...fields, originalOpening, '100.00'],
  Array(14).fill('') as string[],
  [snapshot, 'period', ...fields, '300', '100'],
  [snapshot, 'closing', ...fields, '1200', '100'],
];
const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows
      .map((row) =>
        row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','),
      )
      .join('\r\n'),
  ).buffer;
const archive = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).buffer;
const sha = (value: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(value)).digest('hex');
async function fixture(rows = tbRows): Promise<GlTbInput> {
  return {
    files: [
      await readFile('gl.csv', csv(glRows)),
      await readFile('tb.csv', csv(rows)),
    ],
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERTICAL_FAMILY,
        confirmed: true,
      },
    ],
    scope: { ...scope },
  };
}
async function native(input: GlTbInput, numeric = false) {
  for (const side of [0, 1] as const) {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet(side ? 'Vertical TB' : 'GL');
    sheet.addRows(input.files[side].sheets[0].rows);
    if (numeric)
      for (let row = 2; row <= sheet.rowCount; row++) {
        if (!sheet.getRow(row).getCell(1).value) continue;
        for (const column of side ? [13, 14] : [14, 15]) {
          const cell = sheet.getCell(row, column);
          // The author supplies the legal native number; the parser does no inference.
          cell.value =
            side && row === 2 && column === 13 ? 1000 : Number(cell.value);
          cell.numFmt = '0.00';
        }
        for (const column of side ? [11, 12] : [3, 12, 13]) {
          const cell = sheet.getCell(row, column);
          const originalDate = cell.value;
          if (typeof originalDate !== 'string')
            throw new Error('Test original date must be text');
          cell.value = new Date(originalDate + 'T00:00:00.000Z');
          cell.numFmt = 'yyyy-mm-dd';
        }
      }
    input.files[side] = await readFile(
      side ? 'tb.xlsx' : 'gl.xlsx',
      new Uint8Array(await book.xlsx.writeBuffer()).buffer,
    );
  }
  return input;
}
function table(book: ExcelJS.Workbook, name: string) {
  const sheet = book.getWorksheet(name)!;
  const headers = sheet.getRow(1).values as string[];
  return Array.from({ length: sheet.rowCount - 1 }, (_, i) => {
    const values = sheet.getRow(i + 2).values as (string | number)[];
    return Object.fromEntries(
      headers.slice(1).map((header, j) => [header, values[j + 1] ?? '']),
    );
  });
}
async function proveExport(input: GlTbInput) {
  const { state, result } = await replayGlTb(input),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportGlTb(state, result));
  const members = table(book, 'Component members').filter(
    (row) => row.Side === 1,
  );
  assert.equal(members.length, 6);
  assert.equal(new Set(members.map((row) => row['Source row'])).size, 3);
  const source = state.files[1],
    sheet = source.sheets[state.readings[1].sheet];
  for (const [i, component] of BALANCE_FIELDS.entries()) {
    const member = members.find((row) => row.Component === component)!;
    const role = ['opening', 'period', 'closing'][Math.floor(i / 2)];
    assert.equal(String(member['Balance role']).trim(), role);
    assert.equal(member['Snapshot ID'], snapshot);
    assert.equal(member['Original identity'], snapshot);
    assert.equal(member.Family, GL_TB_VERTICAL_FAMILY);
    assert.equal(member['Source SHA-256'], source.sha256);
    assert.equal(member.Sheet, sheet.name);
    assert.equal(
      member['Original text'],
      sheet.rows[Number(member['Source row']) - 1][
        Number(member['Source column']) - 1
      ],
    );
    assert.equal(
      member['Record ID'],
      result.rows.find((row) => row.side === 1 && row.kind === role)!.id,
    );
  }
  const records = table(book, 'Records').filter((row) => row.Side === 1);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((row) => String(row['Balance role']).trim()),
    ['opening', 'period', 'closing'],
  );
  assert.ok(records.every((row) => row['Snapshot ID'] === snapshot));
  const inventory = table(book, 'TB inventory');
  assert.equal(inventory.length, sheet.rows.length);
  for (const [i, values] of sheet.rows.entries())
    for (const [j, value] of values.entries()) {
      assert.equal(inventory[i][`Original column ${j + 1}`], value);
      assert.equal(
        book.getWorksheet('TB inventory')!.getCell(i + 2, j + 4).type,
        ExcelJS.ValueType.String,
      );
    }
  for (const side of [0, 1]) {
    const sources = table(book, 'Sources').filter((row) => row.Side === side);
    assert.ok(
      sources.every((row) => row.Family === state.readings[side].family),
    );
    const bytes = Uint8Array.from(
      Buffer.from(
        sources.map((row) => row['Original bytes base64']).join(''),
        'base64',
      ),
    ).buffer;
    assert.deepEqual(bytes, state.files[side].original);
    assert.equal(sha(bytes), state.files[side].sha256);
  }
  for (const worksheet of book.worksheets)
    worksheet.eachRow((row) =>
      row.eachCell((cell) =>
        assert.notEqual(cell.type, ExcelJS.ValueType.Formula),
      ),
    );
  return result;
}

void test('vertical CSV original-byte save/restore/export retains six cells on three supplied role rows', async () => {
  const input = await fixture(),
    result = await proveExport(input);
  assert.equal(result.status, 'consistent');
  assert.deepEqual(result.tb, {
    openingDebit: 100000,
    openingCredit: 10000,
    periodDebit: 30000,
    periodCredit: 10000,
    closingDebit: 120000,
    closingCredit: 10000,
  });
  assert.equal(result.glBridge, 0);
  assert.equal(result.tbBridge, 0);
  assert.equal(
    result.inventory.filter((row) => row.side === 1 && row.kind === 'blank')
      .length,
    1,
  );
  const saved = await saveGlTb(input),
    restored = await restoreGlTb(saved);
  assert.deepEqual(restored.result, result);
  assert.deepEqual(await proveExport(restored.state), result);
});
void test('vertical replay ignores forged parsed cells and snapshots context before asynchronous reads', async () => {
  const input = await fixture(),
    baseline = (await replayGlTb(input)).result;
  input.files[1].sheets[0].rows[1][12] = '9999';
  input.files[1].sheets[0].hiddenRows = [2];
  assert.equal(reconcileGlTb(input).status, 'source-error');
  assert.deepEqual((await replayGlTb(input)).result, baseline);
  assert.deepEqual((await restoreGlTb(await saveGlTb(input))).result, baseline);
  await assert.rejects(() => exportGlTb(input, reconcileGlTb(input)), /STALE/);
  const pending = replayGlTb(input);
  input.readings[1].family = GL_TB_VERSION;
  input.scope.account = 'changed';
  new Uint8Array(input.files[1].original!).fill(0);
  assert.deepEqual((await pending).result, baseline);
});
void test('vertical archives refuse cache/result authority, hash tampering and silent family changes', async () => {
  const input = await fixture(),
    saved = JSON.parse(new TextDecoder().decode(await saveGlTb(input)));
  for (const property of ['result', 'parsed', 'components']) {
    await assert.rejects(
      () => restoreGlTb(archive({ ...saved, [property]: {} })),
      /SESSION/,
    );
  }
  const badHash = structuredClone(saved);
  badHash.files[1].sha256 = '0'.repeat(64);
  await assert.rejects(() => restoreGlTb(archive(badHash)), /HASH/);
  const badBytes = structuredClone(saved);
  badBytes.files[1].data = Buffer.from('forged bytes').toString('base64');
  await assert.rejects(() => restoreGlTb(archive(badBytes)));
  const badFamily = structuredClone(saved);
  badFamily.readings[1].family = GL_TB_VERSION;
  await assert.rejects(() => restoreGlTb(archive(badFamily)), /COLUMNS/);
  const missing = structuredClone(saved),
    original = csv(tbRows.filter((_, i) => i !== 3));
  missing.files[1].data = Buffer.from(original).toString('base64');
  missing.files[1].sha256 = sha(original);
  const restored = await restoreGlTb(archive(missing));
  assert.equal(restored.result.status, 'missing');
  assert.deepEqual(restored.result.missing, ['tb-period']);
  assert.equal(restored.result.tb, null);
  assert.equal(restored.result.differences, null);
});
void test('vertical source/hash/sheet/family/role/scope replacement rejects old exports', async () => {
  const input = await fixture(),
    expected = (await replayGlTb(input)).result;
  const changed = await fixture(
    tbRows.map((row, i) =>
      i === 3 ? [...row.slice(0, 12), '350', '150'] : row,
    ),
  );
  await assert.rejects(() => exportGlTb(changed, expected), /STALE/);
  for (const patch of [
    { family: GL_TB_VERSION },
    { role: 'gl-detail' },
    { sheet: 1 },
  ]) {
    const changed = await fixture();
    Object.assign(changed.readings[1], patch);
    await assert.rejects(() => exportGlTb(changed, expected));
  }
  const scoped = await fixture();
  scoped.scope.postingLayer = 'different';
  await assert.rejects(() => exportGlTb(scoped, expected), /STALE/);
  const forged = await fixture();
  forged.files[1].sha256 = '0'.repeat(64);
  await assert.rejects(() => exportGlTb(forged, expected), /HASH/);
  const multi = await native(await fixture()),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(multi.files[1].original!);
  book.addWorksheet('Other TB').addRows(tbRows);
  multi.files[1] = await readFile(
    'tb.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  const first = (await replayGlTb(multi)).result;
  multi.readings[1].sheet = 1;
  await assert.rejects(() => exportGlTb(multi, first), /STALE/);
});
void test('native text and legal numeric/date XLSX vertical cycles preserve identities and exact source evidence', async () => {
  for (const numeric of [false, true]) {
    const input = await native(await fixture(), numeric),
      result = await proveExport(input);
    assert.equal(result.status, 'consistent');
    assert.equal(input.files[1].sheets[0].rows[1][4], '001100');
    const restored = await restoreGlTb(await saveGlTb(input));
    assert.deepEqual(restored.result, result);
    assert.deepEqual(await proveExport(restored.state), result);
  }
});
void test('native XLSX formulas, hidden required cells, merges and misleading displays cannot replace vertical components', async () => {
  const hazards: [string, (sheet: ExcelJS.Worksheet) => void][] = [
    [
      'cached formula',
      (s) => {
        s.getCell('M2').value = { formula: '1000', result: 1000 };
      },
    ],
    [
      'uncached formula',
      (s) => {
        s.getCell('M2').value = { formula: '1000' };
      },
    ],
    [
      'hidden row',
      (s) => {
        s.getRow(2).hidden = true;
      },
    ],
    [
      'zero-height row',
      (s) => {
        s.getRow(2).height = 0;
      },
    ],
    [
      'hidden column',
      (s) => {
        s.getColumn(13).hidden = true;
      },
    ],
    [
      'hidden sheet',
      (s) => {
        s.state = 'hidden';
      },
    ],
    [
      'merged money',
      (s) => {
        s.mergeCells('M2:N2');
      },
    ],
    [
      'suppressed display',
      (s) => {
        s.getCell('M2').value = 1000;
        s.getCell('M2').numFmt = ';;;';
      },
    ],
    [
      'rounded display',
      (s) => {
        s.getCell('M2').value = 1000.01;
        s.getCell('M2').numFmt = '0';
      },
    ],
    [
      'rounded conditional display',
      (s) => {
        s.getCell('M2').value = 1000.01;
        s.getCell('M2').numFmt = '0.00';
        s.addConditionalFormatting({
          ref: 'M2',
          rules: [
            {
              type: 'expression',
              priority: 1,
              formulae: ['TRUE'],
              style: { numFmt: '0' },
            },
          ],
        });
      },
    ],
    [
      'scaled display',
      (s) => {
        s.getCell('M2').value = 1000;
        s.getCell('M2').numFmt = '0%';
      },
    ],
    [
      'white font',
      (s) => {
        s.getCell('M2').font = { color: { argb: 'FFFFFFFF' } };
      },
    ],
    [
      'Excel error',
      (s) => {
        s.getCell('M2').value = { error: '#VALUE!' };
      },
    ],
    [
      'numeric identity format',
      (s) => {
        s.getCell('E2').value = 1100;
        s.getCell('E2').numFmt = '0.00';
      },
    ],
  ];
  for (const [label, mutate] of hazards) {
    const input = await fixture(),
      book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('TB');
    sheet.addRows(tbRows);
    mutate(sheet);
    let original = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
    if (label === 'zero-height row') {
      // ExcelJS omits zero heights on write: supply the actual native attribute.
      const zip = await JSZip.loadAsync(original);
      const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
      zip.file(
        'xl/worksheets/sheet1.xml',
        xml.replace('<row r="2"', '<row r="2" ht="0" customHeight="1"'),
      );
      original = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
        .buffer;
    }
    input.files[1] = await readFile('tb.xlsx', original);
    if (['hidden column', 'merged money'].includes(label)) {
      await assert.rejects(() => replayGlTb(input), /COLUMNS/, label);
      await assert.rejects(() => saveGlTb(input), /COLUMNS/, label);
      continue;
    }
    const result = (await replayGlTb(input)).result;
    assert.equal(result.status, 'source-error', label);
    assert.ok(
      result.inventory.some((row) => row.side === 1 && row.kind === 'error'),
      label,
    );
    assert.equal(
      (await restoreGlTb(await saveGlTb(input))).result.status,
      'source-error',
      label,
    );
  }
});
void test('native formula headers and external workbook links refuse the selected vertical source', async () => {
  const input = await fixture(),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('TB');
  sheet.addRows(tbRows);
  sheet.getCell('B1').value = {
    formula: '"Balance role"',
    result: 'Balance role',
  };
  input.files[1] = await readFile(
    'tb.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  await assert.rejects(() => replayGlTb(input), /COLUMNS/);
  const zip = await JSZip.loadAsync(input.files[1].original!);
  zip.file(
    'xl/externalLinks/externalLink1.xml',
    '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
  );
  await assert.rejects(
    async () =>
      readFile(
        'tb.xlsx',
        new Uint8Array(await zip.generateAsync({ type: 'uint8array' })).buffer,
      ),
    /الروابط الخارجية/,
  );
});
void test('vertical export keeps invalid literal identity evidence as text without formula execution', async () => {
  const raw = '=HYPERLINK("https://example.invalid","literal")',
    rows = tbRows.map((row, i) => (i && row[0] ? [raw, ...row.slice(1)] : row));
  const input = await fixture(rows),
    result = (await replayGlTb(input)).result,
    book = new ExcelJS.Workbook();
  assert.equal(result.status, 'source-error');
  await book.xlsx.load(await exportGlTb(input, result));
  const cell = book.getWorksheet('TB inventory')!.getCell('D3');
  assert.equal(cell.value, raw);
  assert.equal(cell.type, ExcelJS.ValueType.String);
});
void test('vertical preserves old canonical archives and refuses new schema under the old family', async () => {
  const input = await fixture(),
    horizontal = [
      [
        'Snapshot ID',
        ...scopeHeaders,
        'Opening debit',
        'Opening credit',
        'Period debit',
        'Period credit',
        'Closing debit',
        'Closing credit',
      ],
      ['Old snapshot', ...fields, '1000', '100', '300', '100', '1200', '100'],
    ];
  input.files[1] = await readFile('tb.csv', csv(horizontal));
  input.readings[1].family = GL_TB_VERSION;
  const saved = await saveGlTb(input),
    restored = await restoreGlTb(saved);
  assert.equal(restored.result.status, 'consistent');
  assert.equal(restored.result.readings[1].family, GL_TB_VERSION);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportGlTb(restored.state, restored.result));
  const legacyHeaders = {
    Records: [
      'ID',
      'Side',
      'Source row',
      'Record ID',
      'Kind',
      'Posting date',
      'Amounts minor units JSON',
    ],
    'Cell evidence': [
      'ID',
      'Side',
      'Source row',
      'Field',
      'Source column',
      'Original text',
      'Amount minor units',
    ],
    'Component members': ['Side', 'Component', 'Record ID', 'Source column'],
    Sources: [
      'Side',
      'Role',
      'Source name',
      'Source SHA-256',
      'Sheet',
      'Chunk',
      'Original bytes base64',
    ],
  };
  for (const [name, headers] of Object.entries(legacyHeaders))
    assert.deepEqual(
      (book.getWorksheet(name)!.getRow(1).values as string[]).slice(1),
      headers,
    );
  assert.equal(
    table(book, 'Sources').find((row) => row.Side === 1)!.Family,
    undefined,
  );
  assert.equal(
    table(book, 'Reading').find(
      (row) => row.Side === 1 && row.Field === 'family',
    )!.Value,
    GL_TB_VERSION,
  );
  input.readings[1].family = GL_TB_VERTICAL_FAMILY;
  await assert.rejects(() => saveGlTb(input), /COLUMNS/);
});
void test('vertical original-byte and session resource ceilings retain inclusive native reader boundaries', async () => {
  const input = await fixture();
  input.files[1].original = new ArrayBuffer(MAX_FILE_BYTES + 1);
  await assert.rejects(() => replayGlTb(input), /SOURCE/);
  const valid = new Uint8Array(await saveGlTb(await fixture()));
  const atSessionLimit = new Uint8Array(32 * 1024 * 1024).fill(32);
  atSessionLimit.set(valid, atSessionLimit.length - valid.length);
  assert.equal(
    (await restoreGlTb(atSessionLimit.buffer)).result.status,
    'consistent',
  );
  const line = 'x'.repeat(4090) + ',0\n',
    header = 'A,B\n';
  const count = Math.floor((MAX_FILE_BYTES - header.length) / line.length);
  const remainder = MAX_FILE_BYTES - header.length - line.length * count;
  const atFileLimit = new TextEncoder().encode(
    header + line.repeat(count) + 'x'.repeat(remainder),
  ).buffer;
  assert.equal(atFileLimit.byteLength, MAX_FILE_BYTES);
  await readFile('file.csv', atFileLimit);
  await assert.rejects(
    () => readFile('file.csv', new ArrayBuffer(MAX_FILE_BYTES + 1)),
    /8 MB/,
  );
  for (const length of [0, 32 * 1024 * 1024 + 1])
    await assert.rejects(() => restoreGlTb(new ArrayBuffer(length)), /SESSION/);
  await readFile(
    'cell.csv',
    csv([
      ['A', 'B'],
      ['x'.repeat(4096), '0'],
    ]),
  );
  await assert.rejects(() =>
    readFile(
      'cell.csv',
      csv([
        ['A', 'B'],
        ['x'.repeat(4097), '0'],
      ]),
    ),
  );
  await readFile(
    'rows.csv',
    csv([
      ['A', 'B'],
      ...Array.from({ length: MAX_ROWS + 29 }, () => ['x', '0']),
    ]),
  );
  await assert.rejects(() =>
    readFile(
      'rows.csv',
      csv([
        ['A', 'B'],
        ...Array.from({ length: MAX_ROWS + 30 }, () => ['x', '0']),
      ]),
    ),
  );
  await readFile(
    'columns.csv',
    csv([Array.from({ length: 100 }, (_, i) => `C${i}`), Array(100).fill('0')]),
  );
  await assert.rejects(() =>
    readFile(
      'columns.csv',
      csv([
        Array.from({ length: 101 }, (_, i) => `C${i}`),
        Array(101).fill('0'),
      ]),
    ),
  );
  const cellBook = new ExcelJS.Workbook(),
    cellSheet = cellBook.addWorksheet('Cell text');
  cellSheet.addRows([
    ['A', 'B'],
    ['x'.repeat(4096), '0'],
  ]);
  await readFile(
    'cell.xlsx',
    new Uint8Array(await cellBook.xlsx.writeBuffer()).buffer,
  );
  cellSheet.getCell('A2').value = 'x'.repeat(4097);
  await assert.rejects(async () =>
    readFile(
      'cell.xlsx',
      new Uint8Array(await cellBook.xlsx.writeBuffer()).buffer,
    ),
  );
  const rowBook = new ExcelJS.Workbook(),
    rowSheet = rowBook.addWorksheet('Rows');
  rowSheet.addRow(['A', 'B']);
  rowSheet.getCell(MAX_ROWS + 30, 2).value = '0';
  await readFile(
    'rows.xlsx',
    new Uint8Array(await rowBook.xlsx.writeBuffer()).buffer,
  );
  rowSheet.getCell(MAX_ROWS + 31, 2).value = '0';
  await assert.rejects(async () =>
    readFile(
      'rows.xlsx',
      new Uint8Array(await rowBook.xlsx.writeBuffer()).buffer,
    ),
  );
  const book = new ExcelJS.Workbook();
  for (let i = 0; i < MAX_SHEETS; i++)
    book.addWorksheet(`S${i}`).addRows([
      ['A', 'B'],
      ['x', '0'],
    ]);
  await readFile(
    'sheets.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  book.addWorksheet('Over').addRows([
    ['A', 'B'],
    ['x', '0'],
  ]);
  await assert.rejects(
    async () =>
      readFile(
        'sheets.xlsx',
        new Uint8Array(await book.xlsx.writeBuffer()).buffer,
      ),
    /ورقة/,
  );
});

void test('vertical native numeric formats admit exact displayed precision and keep supplied fractional amounts', async () => {
  for (const [value, format] of [
    [1000, '0'],
    [1000.01, 'General'],
    [1000.01, '0.00'],
    [1000.01, '0.000'],
    [1000.01, '0.##'],
  ] as const) {
    const input = await fixture(),
      book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('TB');
    sheet.addRows(tbRows);
    sheet.getCell('M2').value = value;
    sheet.getCell('M2').numFmt = format;
    input.files[1] = await readFile(
      'tb.xlsx',
      new Uint8Array(await book.xlsx.writeBuffer()).buffer,
    );
    const result = (await replayGlTb(input)).result;
    assert.equal(
      result.status,
      value === 1000 ? 'consistent' : 'inconsistent',
      format,
    );
    assert.equal(
      result.tb!.openingDebit,
      value === 1000 ? 100000 : 100001,
      format,
    );
    assert.equal(
      (await restoreGlTb(await saveGlTb(input))).result.tb!.openingDebit,
      result.tb!.openingDebit,
    );
  }
});
void test('native workbook inclusive million-cell budget rejects the first dimension above it', async () => {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Sparse bounded original');
  sheet.addRow(['A', 'B']);
  sheet.getCell('CV10000').value = '0';
  const source = await readFile(
    'cells.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  assert.equal(source.sheets[0].rows.length, 10000);
  assert.equal(source.sheets[0].rows.at(-1)!.length, 100);
  sheet.getCell('CV10001').value = '0';
  await assert.rejects(
    async () =>
      readFile(
        'cells.xlsx',
        new Uint8Array(await book.xlsx.writeBuffer()).buffer,
      ),
    /مليون/,
  );
});
