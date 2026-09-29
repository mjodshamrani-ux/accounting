import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as bytes, mkdir, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  readFile,
  exportWorkbook,
  replayNativeHeaderSource,
} from '../lib/reconciliation/io.ts';
import { inferMapping, normalizeSource } from '../lib/reconciliation/core.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import {
  headerLabels,
  layeredHeaderView,
  validHeaderGeometry,
} from '../lib/reconciliation/header-view.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
import type { SourceFile, Scope } from '../lib/reconciliation/types.ts';

const folder = 'audit/layered-statement/frozen/';
const scope: Scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP-714',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 3,
  confirmed: true,
  coverageConfirmed: false,
};
const native = async (name = 'supplier-layered-proven.xlsx') =>
  readFile(name, new Uint8Array(await bytes(folder + name)).buffer);
async function variant(
  change: (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void,
): Promise<SourceFile> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    new Uint8Array(await bytes(folder + 'supplier-layered-proven.xlsx')).buffer,
  );
  change(book.worksheets[1], book);
  return readFile(
    'variant.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
}
async function reconcile(file: SourceFile) {
  const ledger = await native('ledger-plain.csv');
  return reconcileSupplierStatement({
    files: [file, ledger],
    mappings: [
      selectImportMapping(file, 'supplier').mapping,
      selectImportMapping(ledger, 'ledger').mapping,
    ],
    scope,
  });
}
function assertRowFates(
  file: SourceFile,
  result: ReturnType<typeof normalizeSource>,
) {
  const fates = [...result.transactions, ...result.excluded, ...result.errors]
    .map((t) => t.row)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  assert.deepEqual(
    fates,
    Array.from({ length: file.sheets[1].rows.length }, (_, i) => i + 1),
  );
}
test('F02-R01/R15: frozen bytes auto-read; preserve every row, signs and conservative matching', async () => {
  const file = await native();
  const raw = structuredClone(file.sheets[1]);
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.kind, 'unique-table');
  for (const [k, v] of Object.entries({
    sheet: 1,
    header: 3,
    date: 0,
    reference: 1,
    amount: -1,
    debit: 2,
    credit: 3,
    mode: 'split',
  }))
    assert.equal(selection.mapping[k as keyof typeof selection.mapping], v);
  const { a, b, result } = await reconcile(file);
  assert.deepEqual(
    a.transactions.map((t) => [t.row, t.amountMinor]),
    [
      [6, 78000],
      [7, 22000],
      [8, -35000],
      [9, -5000],
    ],
  );
  assert.deepEqual(
    [a.total, b.total, a.opening, a.closing],
    [60000, 60000, 100000, 160000],
  );
  assertRowFates(file, a);
  assert.equal(result.balanceComparable, false);
  assert.deepEqual(
    result.cases
      .filter((c) => c.status === 'Matched')
      .map((c) => c.supplierMembers.map((t) => t.row)),
    [[8]],
  );
  assert.ok(
    result.cases.some(
      (c) =>
        c.status === 'Needs Review' &&
        c.supplierMembers.map((t) => t.row).join(',') === '6,7',
    ),
  );
  assert.ok(
    result.cases.some(
      (c) => c.status === 'Unmatched' && c.supplierMembers[0]?.row === 9,
    ),
  );
  assert.ok(
    a.transactions.every(
      (t) =>
        !t.referenceEvidenceIssues?.length &&
        t.documentType === 'Unknown' &&
        !t.bankReference &&
        !t.poReference,
    ),
  );
  assert.deepEqual(
    file.sheets[1],
    raw,
    'source and all cell issues remain unchanged',
  );
  const view = layeredHeaderView(file.sheets[1], 3)!;
  assert.deepEqual(view.band, [3, 4]);
  assert.deepEqual(view.origins[1], {
    row: 3,
    column: 2,
    label: 'Document No',
    range: 'B3:B4',
  });
});
test('F02-R02: permute all columns and rename sheets without coordinate/name assumptions', async () => {
  const file = await variant((s, book) => {
    const original = Array.from({ length: 10 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => s.getCell(r + 1, c + 1).value),
    );
    for (const merge of [...s.model.merges]) s.unMergeCells(merge);
    for (let r = 1; r <= 10; r++)
      for (let c = 1; c <= 7; c++)
        s.getCell(r, c).value = original[r - 1][7 - c];
    for (const merge of [
      'A1:G1',
      'A2:G2',
      'A3:A4',
      'B3:B4',
      'C3:C4',
      'D3:E3',
      'F3:F4',
      'G3:G4',
    ])
      s.mergeCells(merge);
    s.name = 'مورد غير مألوف';
    book.worksheets[0].name = 'تعريف';
  });
  const m = selectImportMapping(file, 'supplier').mapping;
  assert.deepEqual(
    [m.sheet, m.header, m.date, m.reference, m.debit, m.credit],
    [1, 3, 6, 5, 4, 3],
  );
  assert.deepEqual(
    normalizeSource(file, m, scope, 'supplier').transactions.map(
      (t) => t.amountMinor,
    ),
    [78000, 22000, -35000, -5000],
  );
});
test('F02-R03: explicit bilingual labels and consistent parent currency', async () => {
  const file = await variant((s) => {
    s.getCell('A3').value = 'Date / التاريخ';
    s.getCell('B3').value = 'Document No / رقم المستند';
    s.getCell('C3').value = 'Movement (SAR) / الحركة (SAR)';
    s.getCell('C4').value = 'Debit / مدين';
    s.getCell('D4').value = 'Credit / دائن';
  });
  assert.equal(selectImportMapping(file, 'supplier').kind, 'unique-table');
  assert.equal(headerLabels(file.sheets[1], 3)[2], 'Debit (SAR) / مدين (SAR)');
  assert.equal((await reconcile(file)).a.transactions.length, 4);
});
test('F02-R09: NFKC currency tags cannot hide a parent/child conflict', async () => {
  const file = await variant((s) => {
    s.getCell('C3').value = 'Movement (ＵＳＤ)';
    s.getCell('C4').value = 'Debit (SAR)';
  });
  assert.equal(layeredHeaderView(file.sheets[1], 3), undefined);
  assert.notEqual(selectImportMapping(file, 'supplier').kind, 'unique-table');
  assert.equal(file.sheets[1].rows[2][2], 'Movement (ＵＳＤ)');
});
test('F02-R03/R14: NFKC parent currency is inherited and checked against scope', async () => {
  const compatible = await variant((s) => {
    s.getCell('C3').value = 'Movement (ＳＡＲ)';
  });
  const view = layeredHeaderView(compatible.sheets[1], 3)!;
  assert.deepEqual(view.labels.slice(2, 4), ['Debit (SAR)', 'Credit (SAR)']);
  assert.equal(view.origins[2].parent!.label, 'Movement (ＳＡＲ)');
  assert.equal(
    selectImportMapping(compatible, 'supplier').kind,
    'unique-table',
  );
  assert.equal((await reconcile(compatible)).a.transactions.length, 4);
  const incompatible = await variant((s) => {
    s.getCell('C3').value = 'Movement (ＵＳＤ)';
  });
  assert.deepEqual(headerLabels(incompatible.sheets[1], 3).slice(2, 4), [
    'Debit (USD)',
    'Credit (USD)',
  ]);
  await assert.rejects(() => reconcile(incompatible), /عملة عنوان المبلغ/);
});
test('F02-R14: explicit NFKC child currencies remain visible to scope checks', async () => {
  const file = await variant((s) => {
    s.getCell('C3').value = 'Movement (ＵＳＤ)';
    s.getCell('C4').value = 'Debit (ＵＳＤ)';
    s.getCell('D4').value = 'Credit (ＵＳＤ)';
  });
  const view = layeredHeaderView(file.sheets[1], 3)!;
  assert.deepEqual(view.labels.slice(2, 4), ['Debit (USD)', 'Credit (USD)']);
  assert.equal(view.origins[2].label, 'Debit (ＵＳＤ)');
  assert.equal(file.sheets[1].rows[3][2], 'Debit (ＵＳＤ)');
  await assert.rejects(() => reconcile(file), /عملة عنوان المبلغ/);
});
const refused: [string, (s: ExcelJS.Worksheet) => void][] = [
  [
    'R04 extends into opening/data',
    (s) => {
      s.unMergeCells('A3:A4');
      s.mergeCells('A3:A5');
    },
  ],
  [
    'R04 extends into first movement',
    (s) => {
      s.unMergeCells('A3:A4');
      s.mergeCells('A3:A6');
    },
  ],
  [
    'R05 horizontal Date/Ref',
    (s) => {
      s.unMergeCells('A3:A4');
      s.unMergeCells('B3:B4');
      s.mergeCells('A3:B3');
    },
  ],
  ['R06 missing native vertical geometry', (s) => s.unMergeCells('B3:B4')],
  [
    'R07 hidden first row',
    (s) => {
      s.getRow(3).hidden = true;
    },
  ],
  [
    'R07 hidden second row',
    (s) => {
      s.getRow(4).hidden = true;
    },
  ],
  [
    'R07 hidden reference column',
    (s) => {
      s.getColumn(2).hidden = true;
    },
  ],
  [
    'R08 formula anchor',
    (s) => {
      s.getCell('B3').value = {
        formula: '"Document No"',
        result: 'Document No',
      };
    },
  ],
  [
    'R08 error anchor',
    (s) => {
      s.getCell('B3').value = { error: '#VALUE!' };
    },
  ],
  [
    'R08 invisible anchor format',
    (s) => {
      s.getCell('B3').numFmt = ';;;';
    },
  ],
  [
    'R09 unrelated parent',
    (s) => {
      s.getCell('C3').value = 'Quantity';
    },
  ],
  [
    'R09 conflicting currencies',
    (s) => {
      s.getCell('C3').value = 'Movement (SAR)';
      s.getCell('C4').value = 'Debit (USD)';
    },
  ],
  [
    'R10 duplicate debit children',
    (s) => {
      s.getCell('D4').value = 'Debit';
    },
  ],
  [
    'R10 missing credit child',
    (s) => {
      s.getCell('D4').value = '';
    },
  ],
  [
    'R10 competing amount role',
    (s) => {
      s.getCell('F3').value = 'Amount';
    },
  ],
];
for (const [id, change] of refused)
  test(`F02-${id}: keep file and refuse layered inference`, async () => {
    const file = await variant(change);
    assert.equal(file.sheets[1].rows.length, 10);
    assert.equal(layeredHeaderView(file.sheets[1], 3), undefined);
    assert.notEqual(selectImportMapping(file, 'supplier').kind, 'unique-table');
  });
test('F02-R11: do not skip an earlier unresolved table or choose between two plausible sheets', async () => {
  const first = await variant((s, book) => {
    book.worksheets[0].addRows([
      ['Date', 'Reference', 'Strange amount'],
      ['2026-07-01', 'FIRST-1', 'unresolved'],
    ]);
    s.unMergeCells('A1:G1');
    s.getCell('A1').value = 'Date';
    s.getCell('B1').value = 'Reference';
  });
  assert.equal(inferMapping(first, 1).header, 0);
  assert.notEqual(selectImportMapping(first, 'supplier').kind, 'unique-table');
  const two = await variant((s, book) => {
    book.addWorksheet('Another').addRows([
      ['Date', 'Reference', 'Amount'],
      ['2026-07-15', 'OTHER-01', 42],
    ]);
  });
  assert.equal(selectImportMapping(two, 'supplier').kind, 'choose-sheet');
});
test('F02-R12: frozen different identity never approves the equal-sum invoice group', async () => {
  const file = await native('supplier-layered-conflict.xlsx');
  const { a, result } = await reconcile(file);
  assert.equal(selectImportMapping(file, 'supplier').kind, 'unique-table');
  assert.deepEqual(
    a.transactions.map((t) => t.reference),
    ['INV-932', 'INV-934', 'PAY-44', 'CN-3'],
  );
  assertRowFates(file, a);
  assert.deepEqual(
    result.cases
      .filter((c) => c.status === 'Matched')
      .map((c) => c.supplierMembers.map((t) => t.row)),
    [[8]],
  );
});
test('F02-R13: erroneous competing payment remains a completeness barrier', async () => {
  const file = await variant((s) => {
    s.addRow([
      '2026-07-16',
      'PAY-44',
      '',
      { formula: '1+349', result: 350 },
      1300,
      'LINE-5',
      'BANK-44',
    ]);
  });
  const { a, result } = await reconcile(file);
  assert.equal(
    a.errors.some((e) => e.row === 11),
    true,
  );
  assertRowFates(file, a);
  assert.equal(
    result.cases.some(
      (c) =>
        c.status === 'Matched' && c.supplierMembers.some((t) => t.row === 8),
    ),
    false,
  );
});
test('F02-R14: native header proof never repairs signs or a broken balance', async () => {
  const file = await variant((s) => {
    s.getCell('D8').value = -350;
    s.getCell('E10').value = 999;
  });
  assert.equal(selectImportMapping(file, 'supplier').kind, 'unique-table');
  const { a, result } = await reconcile(file);
  assert.equal(
    a.errors.some((e) => e.row === 8),
    true,
  );
  assert.equal(a.balanceValid, false);
  assert.equal(result.balanceComparable, false);
  assert.equal(file.sheets[1].rows[7][3], '-350');
  assertRowFates(file, a);
});
test('F02-R04: header exception never exempts merged transaction cells', async () => {
  const merged = await variant((s) => s.mergeCells('C6:D6'));
  assert.ok(layeredHeaderView(merged.sheets[1], 3));
  const { a } = await reconcile(merged);
  assert.ok(a.errors.some((e) => e.row === 6));
  assertRowFates(merged, a);
  assert.ok(
    merged.sheets[1].cellIssues?.['6:3']?.some((i) =>
      i.startsWith('خلية مدمجة'),
    ),
  );
});
test('F02-R13 excluded competitor: excluding a rival must not manufacture uniqueness', async () => {
  // Replay the exact original failing package, not a newly generated lookalike.
  const rival = await readFile(
    'r13-excluded-competitor.xlsx',
    new Uint8Array(await bytes('audit/sol-cycle4/r13-excluded-competitor.xlsx'))
      .buffer,
  );
  assert.equal(
    rival.sha256,
    'a085499d9e6ae2d165cd6716034f0945ecbb7151ad561bca70a4926a94250958',
  );
  const ledger = await native('ledger-plain.csv');
  const mapping = selectImportMapping(rival, 'supplier').mapping;
  mapping.excluded = {
    '11': 'External reviewer excluded competing source row',
  };
  const result = reconcileSupplierStatement({
    files: [rival, ledger],
    mappings: [mapping, selectImportMapping(ledger, 'ledger').mapping],
    scope,
  });
  await mkdir('work/layered-headers', { recursive: true });
  await writeFile(
    'work/layered-headers/r13-excluded-competitor.xlsx',
    new Uint8Array(rival.original!),
  );
  await writeFile(
    'work/layered-headers/r13-observation.json',
    JSON.stringify(
      {
        schema: 'tarasuf-f02-r13-blocker-1',
        sourceHash: rival.sha256,
        mapping,
        expectedAffectedAutomaticMatch: false,
        observedMatches: result.result.cases
          .filter((c) => c.status === 'Matched')
          .map((c) => ({
            rule: c.matchingRule,
            supplierRows: c.supplierMembers.map((t) => t.row),
            ledgerRows: c.ledgerMembers.map((t) => t.row),
          })),
        excluded: result.a.excluded.filter((e) => e.row === 11),
        note: 'Current-engine regression; original failing observation remains in audit/sol-cycle4',
      },
      null,
      2,
    ),
  );
  assert.equal(
    result.result.cases.some(
      (c) =>
        c.status === 'Matched' && c.supplierMembers.some((t) => t.row === 8),
    ),
    false,
  );
  assertRowFates(rival, result.a);
  const saved = await saveSession({
    files: [rival, ledger],
    mappings: result.mappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { name: '', notes: '', checked: false },
  });
  const restored = await restoreSession(saved);
  assert.equal(restored.result.matches.length, 0);
  assert.equal(restored.result.balanceComparable, false);
  assert.ok(
    restored.result.diagnostics.some(
      (d) => d.code === 'EXCLUDED_MOVEMENT_MEMBERSHIP',
    ),
  );
  const exported = await exportWorkbook(restored.result, restored.files, {
    name: '',
    notes: '',
    checked: false,
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported);
  assert.equal(book.getWorksheet('Matches')!.rowCount, 1);
  assert.ok(
    book
      .getWorksheet('Diagnostics')!
      .getColumn(1)
      .values.includes('EXCLUDED_MOVEMENT_MEMBERSHIP'),
  );
  await writeFile(
    'work/layered-headers/r13-fixed-workpaper.xlsx',
    new Uint8Array(exported),
  );
});
test('native layered-header reading preserves 5,004 movements without reparsing per row', async () => {
  const started = performance.now();
  const file = await variant((s) => {
    s.spliceRows(10, 1);
    for (let i = 0; i < 5000; i++)
      s.addRow([
        '2026-07-20',
        `LARGE-${String(i).padStart(6, '0')}`,
        100,
        '',
        1700 + i * 100,
        `L-${i}`,
        '',
      ]);
    s.addRow(['Closing balance', '', '', '', 501600]);
  });
  const readMs = performance.now() - started;
  const normalizationStarted = performance.now();
  const selection = selectImportMapping(file, 'supplier');
  assert.equal(selection.kind, 'unique-table');
  const source = normalizeSource(file, selection.mapping, scope, 'supplier');
  assert.equal(source.transactions.length, 5004);
  assert.equal(source.errors.length, 0);
  assert.equal(source.total, 50060000);
  assert.equal(source.closing, 50160000);
  assertRowFates(file, source);
  await mkdir('work/layered-headers', { recursive: true });
  await writeFile(
    'work/layered-headers/large-reading.json',
    JSON.stringify({
      movements: 5004,
      rows: file.sheets[1].rows.length,
      readAndFixtureMs: readMs,
      normalizeMs: performance.now() - normalizationStarted,
      scope:
        'local synthetic targeted reading; not universal speed or accuracy',
    }),
  );
});
test('F02-R16: cloned/forged provenance is not source authority; replay uses actual bytes', async () => {
  const file = await native();
  const clone = structuredClone(file);
  assert.equal(validHeaderGeometry(clone.sheets[1]), true);
  assert.equal(layeredHeaderView(clone.sheets[1], 3), undefined);
  clone.sheets[1].xlsxHeaders!.merges[2].right = 99;
  assert.equal(validHeaderGeometry(clone.sheets[1]), false);
  clone.sheets[1].rows[5][2] = '999999';
  const fresh = await replayNativeHeaderSource(clone);
  assert.ok(layeredHeaderView(fresh.sheets[1], 3));
  assert.equal(fresh.sheets[1].rows[5][2], '780');
  const readReply = structuredClone(file);
  validateWorkerValue('read', readReply, { name: file.name });
  assert.ok(layeredHeaderView(readReply.sheets[1], 3));
  readReply.sheets[1].rows[2][1] = 'Other label';
  assert.equal(layeredHeaderView(readReply.sheets[1], 3), undefined);
  const stale = structuredClone(file);
  stale.sha256 = '0'.repeat(64);
  await assert.rejects(() => replayNativeHeaderSource(stale), /بصمة/);
  const overlap = structuredClone(file.sheets[1]);
  overlap.xlsxHeaders!.merges.push({ ...overlap.xlsxHeaders!.merges[2] });
  assert.equal(validHeaderGeometry(overlap), false);
  const reordered = await native();
  reordered.sheets.reverse();
  assert.equal(layeredHeaderView(reordered.sheets[0], 3), undefined);
  const replayed = await replayNativeHeaderSource(reordered);
  assert.ok(layeredHeaderView(replayed.sheets[1], 3));
});
test('F02-R16/export: session replay and original-based export retain source provenance and row fates', async () => {
  const file = await native(),
    ledger = await native('ledger-plain.csv');
  const { mappings, result } = await reconcile(file);
  const session = await saveSession({
    files: [file, ledger],
    mappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  });
  const restored = await restoreSession(session);
  assert.deepEqual(restored.result, result);
  assert.ok(layeredHeaderView(restored.files[0].sheets[1], 3));
  const exported = await exportWorkbook(restored.result, restored.files, {
    checked: false,
    name: '',
    notes: '',
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported);
  const proof = book.getWorksheet('XLSX Header Provenance')!;
  assert.equal(proof.rowCount, 8);
  assert.deepEqual(
    (proof.getRow(3).values as ExcelJS.CellValue[]).slice(3, 11),
    ['Statement', 3, 4, 2, 3, 2, 'Document No', 'B3:B4'],
  );
  const source = book.getWorksheet('Parsed Supplier Source')!;
  assert.equal(source.rowCount, 11);
  assert.equal(source.getCell('D7').value, '780');
  const forged = structuredClone(file);
  forged.sheets[1].rows[5][2] = '999999';
  await exportWorkbook(result, [forged, ledger], {
    checked: false,
    name: '',
    notes: '',
  });
  const uploaded = await readFile('exported.xlsx', exported);
  assert.equal(
    layeredHeaderView(uploaded.sheets[1], 3),
    undefined,
    'exported certificate grants no native header authority',
  );
  await mkdir('work/layered-headers', { recursive: true });
  await writeFile(
    'work/layered-headers/f02-workpaper.xlsx',
    new Uint8Array(exported),
  );
});
