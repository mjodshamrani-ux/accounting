import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { inferStatementDirection } from '../lib/reconciliation/statement-direction.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  Comparison,
} from '../lib/reconciliation/types.ts';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Buyer',
  account: 'Synthetic AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: true,
};
const review = {
  checked: true,
  name: 'Synthetic reviewer',
  notes: 'Synthetic regression only',
};

async function statement(side: 'supplier' | 'ledger'): Promise<SourceFile> {
  const ap = side === 'ledger';
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(ap ? 'AP Ledger' : 'Statement');
  const headers = ap
    ? [
        'Posting Date',
        'Invoice Date',
        'AP Voucher',
        'Supplier Ref',
        'Type',
        'Description',
        'Debit (SAR)',
        'Credit (SAR)',
        'Running AP Balance',
        'Currency',
      ]
    : [
        'Date',
        'Type',
        'Document No.',
        'Due Date',
        'Description',
        'Debit (SAR)',
        'Credit (SAR)',
        'Running Balance',
        'Currency',
      ];
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell('A1').value = ap
    ? 'Synthetic buyer AP ledger'
    : 'Synthetic supplier statement';
  sheet.getRow(2).values = ['Supplier', 'Synthetic Supplier'];
  sheet.getRow(3).values = ['Period', '01-Jul-2026 — 31-Jul-2026'];
  sheet.getRow(8).values = headers;
  sheet.getRow(9).values = ap
    ? [
        '01-Jul-2026',
        '01-Jul-2026',
        'AP-OPENING',
        'B/F',
        'Opening Balance',
        'Synthetic opening',
        0,
        1000,
        1000,
        'SAR',
      ]
    : [
        '01-Jul-2026',
        'Opening Balance',
        'B/F',
        '01-Jul-2026',
        'Synthetic opening',
        1000,
        0,
        1000,
        'SAR',
      ];
  const entries = ap
    ? [
        [
          '03-Jul-2026',
          '02-Jul-2026',
          'AP-LOCAL-A',
          'SYN-INV-101',
          'Invoice',
          'Synthetic goods',
          0,
          100.25,
          1100.25,
          'SAR',
        ],
        [
          '04-Jul-2026',
          '03-Jul-2026',
          'AP-LOCAL-B',
          'SYN-PAY-202',
          'Payment',
          'Synthetic payment',
          30.1,
          0,
          1070.15,
          'SAR',
        ],
        [
          '06-Jul-2026',
          '05-Jul-2026',
          'AP-LOCAL-D',
          'SYN-AP-404',
          'Invoice',
          'Synthetic ledger-only item',
          0,
          3,
          1073.15,
          'SAR',
        ],
      ]
    : [
        [
          '02-Jul-2026',
          'Invoice',
          'SYN-INV-101',
          '16-Jul-2026',
          'Synthetic goods',
          100.25,
          0,
          1100.25,
          'SAR',
        ],
        [
          '03-Jul-2026',
          'Payment',
          'SYN-PAY-202',
          '17-Jul-2026',
          'Synthetic payment',
          0,
          30.1,
          1070.15,
          'SAR',
        ],
        [
          '05-Jul-2026',
          'Invoice',
          'SYN-SUPPLIER-303',
          '19-Jul-2026',
          'Synthetic supplier-only item',
          7.85,
          0,
          1078,
          'SAR',
        ],
      ];
  entries.forEach((row, i) => {
    sheet.getRow(i + 10).values = row;
  });
  const balanceColumn = ap ? 9 : 8;
  for (const col of [balanceColumn - 2, balanceColumn - 1, balanceColumn])
    sheet.getColumn(col).numFmt = '#,##0.00;[Red](#,##0.00)';
  sheet.mergeCells(13, 1, 13, balanceColumn - 1);
  sheet.getCell('A13').value = ap ? 'Closing AP Balance' : 'Closing Balance';
  sheet.getCell(13, balanceColumn).value = ap ? 1073.15 : 1078;
  sheet.getCell(13, balanceColumn + 1).value = 'SAR';
  sheet.mergeCells(15, 1, 15, headers.length);
  sheet.getCell('A15').value =
    'This statement contains synthetic accounting information for integration testing only.';
  const archive = await JSZip.loadAsync(
    await book.xlsx.writeBuffer({ useSharedStrings: true }),
  );
  // Reproduce valid SDK-style prefixed SpreadsheetML without any original data.
  for (const [path, entry] of Object.entries(archive.files)) {
    if (entry.dir || !path.endsWith('.xml')) continue;
    let xml = await entry.async('string');
    if (!xml.includes(`xmlns="${MAIN}"`)) continue;
    xml = xml
      .replace(`xmlns="${MAIN}"`, `xmlns:x="${MAIN}"`)
      .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, '<$1x:$2');
    archive.file(path, xml);
  }
  return readFile(
    `synthetic-${side}.xlsx`,
    await archive.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
    }),
  );
}

async function pair() {
  const files = (await Promise.all([
    statement('supplier'),
    statement('ledger'),
  ])) as [SourceFile, SourceFile];
  const mappings = files.map((file, side) => {
    const selected = selectImportMapping(
      file,
      side === 0 ? 'supplier' : 'ledger',
    );
    assert.equal(selected.kind, 'unique-table');
    assert.equal(selected.mapping.header, 7);
    const formats = suggestFormats(file, selected.mapping, scope.decimals);
    assert.equal(formats.dateFormat.status, 'proven');
    assert.equal(formats.numberFormat.status, 'proven');
    let mapping = { ...selected.mapping, ...formats.patch };
    const proof = inferStatementDirection(file, mapping, scope.decimals);
    assert.ok(proof);
    assert.equal(proof.multiplier, side === 0 ? 1 : -1);
    assert.equal(proof.checkedRows, 3);
    mapping = {
      ...mapping,
      multiplier: proof.multiplier,
      directionEvidence: proof,
      opening: '1000.00',
      closing: side === 0 ? '1078.00' : '1073.15',
      periodStart: '2026-07-01',
    };
    return mapping;
  }) as [Mapping, Mapping];
  const a = normalizeSource(files[0], mappings[0], scope, 'supplier');
  const b = normalizeSource(files[1], mappings[1], scope, 'ledger');
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  return { files, mappings, result: compare(a, b, scope) };
}

const state = (
  files: [SourceFile, SourceFile],
  mappings: [Mapping, Mapping],
) => ({
  files,
  mappings,
  scope,
  decisions: [],
  rejected: [],
  events: [],
  review,
});
const settingsMapping = (book: ExcelJS.Workbook, label: string): Mapping => {
  const sheet = book.getWorksheet('Run Settings')!;
  for (let row = 2; row <= sheet.rowCount; row++)
    if (sheet.getCell(row, 1).value === label)
      return JSON.parse(String(sheet.getCell(row, 2).value));
  throw new Error('Missing exported mapping');
};

test('namespaced original-shaped Excel pair reaches exact comparison, audit workbook and restorable session', async () => {
  const { files, mappings, result } = await pair();
  assert.equal(mappings[1].date, 0, 'Posting Date has the explicit AP role');
  assert.equal(
    mappings[1].reference,
    3,
    'Supplier Ref must not be replaced by the local AP Voucher',
  );
  assert.deepEqual(
    result.supplier.transactions.map((t) => t.amount),
    [10025, -3010, 785],
  );
  assert.deepEqual(
    result.ledger.transactions.map((t) => t.amount),
    [10025, -3010, 300],
  );
  assert.deepEqual(
    result.ledger.transactions.map((t) => t.date),
    ['2026-07-03', '2026-07-04', '2026-07-06'],
  );
  assert.equal(result.supplier.total, 7800);
  assert.equal(result.ledger.total, 7315);
  assert.equal(result.matches.length, 2);
  assert.equal(result.supplierOnly.length, 1);
  assert.equal(result.ledgerOnly.length, 1);
  assert.equal(result.supplier.balanceValid, true);
  assert.equal(result.ledger.balanceValid, true);
  assert.ok(result.bridge);
  for (const source of [result.supplier, result.ledger]) {
    assert.equal(
      source.transactions.length +
        source.excluded.length +
        source.errors.length,
      15,
    );
    for (const row of [9, 13, 15])
      assert.ok(source.excluded.some((item) => item.row === row));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportWorkbook(result, files, review));
  assert.equal(workbook.getWorksheet('Matches')!.rowCount, 3);
  for (const name of ['Supplier transactions', 'Ledger transactions']) {
    const sheet = workbook.getWorksheet(name)!;
    assert.equal(sheet.rowCount, 4);
    assert.equal(sheet.getCell('H2').value, 100.25);
    assert.equal(sheet.getCell('H3').value, -30.1);
    assert.equal(sheet.getCell('E2').value, 'SYN-INV-101');
  }
  assert.deepEqual(
    settingsMapping(workbook, 'Ledger mapping').directionEvidence,
    mappings[1].directionEvidence,
  );
  const bytes = await saveSession(state(files, mappings));
  const restored = await restoreSession(bytes);
  assert.deepEqual(restored.result, result);
  assert.deepEqual(restored.mappings, mappings);
  files.forEach((file, side) =>
    assert.deepEqual(
      new Uint8Array(restored.files[side].original!),
      new Uint8Array(file.original!),
    ),
  );
});

test('export and session restore reject stale claimed direction proof even when arithmetic result was otherwise unchanged', async () => {
  const { files, mappings, result } = await pair();
  const bytes = await saveSession(state(files, mappings));
  for (const change of [
    (m: Mapping) => {
      m.directionEvidence!.checkedRows++;
    },
    (m: Mapping) => {
      m.directionEvidence!.balanceColumn = 0;
    },
    (m: Mapping) => {
      m.directionEvidence!.multiplier = 1;
    },
    (m: Mapping) => {
      m.multiplier = 1;
    },
  ]) {
    const altered: Comparison = structuredClone(result);
    change(altered.ledger.mapping);
    await assert.rejects(exportWorkbook(altered, files, review), /دليل اتجاه/);
    const session = JSON.parse(new TextDecoder().decode(bytes));
    change(session.mappings[1]);
    await assert.rejects(
      restoreSession(new TextEncoder().encode(JSON.stringify(session)).buffer),
      /دليل اتجاه/,
    );
  }
});

test('export and saved sessions replace arbitrary direction explanation text with freshly computed evidence', async () => {
  const { files, mappings, result } = await pair();
  const canonical = mappings[1].directionEvidence!.reason;
  const altered = structuredClone(result);
  altered.ledger.mapping.directionEvidence!.reason =
    'UNTRUSTED CLAIM: verified everything';
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportWorkbook(altered, files, review));
  assert.equal(
    settingsMapping(workbook, 'Ledger mapping').directionEvidence!.reason,
    canonical,
  );
  assert.equal(
    altered.ledger.mapping.directionEvidence!.reason,
    'UNTRUSTED CLAIM: verified everything',
    'caller state is not mutated',
  );
  const changedMappings = structuredClone(mappings);
  changedMappings[1].directionEvidence!.reason = 'UNTRUSTED CLAIM';
  const saved = await saveSession(state(files, changedMappings));
  assert.equal(
    JSON.parse(new TextDecoder().decode(saved)).mappings[1].directionEvidence
      .reason,
    canonical,
  );
  const restored = await restoreSession(saved);
  assert.equal(restored.mappings[1].directionEvidence!.reason, canonical);
});
