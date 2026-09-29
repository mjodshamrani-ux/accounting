import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { restoreSession, saveSession } from '../lib/reconciliation/session.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';
import { separateBytes } from './helpers/separate-export.ts';

const scope: Scope = {
  supplier: 'S',
  entity: 'E',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const headers = [
  'Date',
  'Document No',
  'Reference',
  'Type',
  'Description',
  'Amount',
];
const row = (reference: string, document = 'INV-4011') => [
  '2026-07-09',
  document,
  reference,
  'Invoice',
  'Goods',
  '100.00',
];
const bytes = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;
async function input(a: string[][], b: string[][], h = headers) {
  const files: [SourceFile, SourceFile] = [
    await readFile('supplier.csv', bytes([h, ...a])),
    await readFile('ledger.csv', separateBytes(bytes([h, ...b]))),
  ];
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  return { files, mappings, scope };
}
const reconcile = (p: Awaited<ReturnType<typeof input>>) =>
  reconcileSupplierStatement(p).result;

test('unmapped reference conflicts veto a document match while agreeing and absent references still match', async () => {
  for (const label of ['Reference', 'Ref.', 'المرجع']) {
    const h = [...headers];
    h[2] = label;
    const p = await input([row('SR-8001')], [row('LR-8001')], h);
    assert.equal(p.mappings[0].reference, -1, 'the reading remains ambiguous');
    const r = reconcile(p);
    assert.equal(r.caseCounts.autoMatchedCases, 0, label);
    assert.equal(r.cases[0].status, 'Needs Review');
    assert.match(r.cases[0].evidence.join('\n'), /قيم عمود المرجع مختلفة/);
    assert.match(
      localizeEngineText(r.cases[0].evidence.join('\n'), 'en'),
      /reference columns differ/,
    );
    for (const value of ['SR-8001', '']) {
      const agreeing = reconcile(await input([row(value)], [row(value)], h));
      assert.equal(
        agreeing.caseCounts.autoMatchedCases,
        1,
        label + ': ' + value,
      );
    }
  }
});

test('choosing Document No does not discard a conflicting explicit Reference column', async () => {
  const p = await input([row('SR-8001')], [row('LR-8001')]);
  p.mappings = p.mappings.map((m) => ({ ...m, reference: 1 })) as [
    Mapping,
    Mapping,
  ];
  assert.equal(reconcile(p).caseCounts.autoMatchedCases, 0);
});

test('a secondary reference is retained with its source header and never supplies positive matching evidence', async () => {
  const p = await input(
    [row('SHARED-8001', 'INV-4011')],
    [row('SHARED-8001', 'INV-4012')],
  );
  const r = reconcile(p);
  assert.equal(r.caseCounts.autoMatchedCases, 0);
  for (const source of [r.supplier, r.ledger]) {
    assert.equal(source.transactions[0].statedReference, 'SHARED-8001');
    assert.ok(
      source.transactions[0].retainedEvidence?.some(
        (e) =>
          e.field === 'statedReference' &&
          e.header === 'Reference' &&
          e.value === 'SHARED-8001',
      ),
    );
  }
});

test('ambiguous or unsafe unselected reference evidence cannot be silently ignored', async () => {
  const duplicate = await input(
    [[...row('SR-8001'), 'X-1001']],
    [[...row('LR-8001'), 'X-1001']],
    [...headers, 'Ref'],
  );
  assert.equal(reconcile(duplicate).caseCounts.autoMatchedCases, 0);
  for (const key of ['1:3', '2:3']) {
    const p = await input([row('SR-8001')], [row('LR-8001')]);
    p.files[0].sheets[0].referenceIssues = {
      [key]: ['Unreliable reference cell'],
    };
    assert.equal(reconcile(p).caseCounts.autoMatchedCases, 0, key);
  }
});

test('reference conflicts in one invoice-group member veto the whole group', async () => {
  const one = [...row('SR-8001'), 'PO-4011'];
  one[5] = '300.00';
  const part1 = [...row('SR-8001'), 'PO-4011'];
  const part2 = [...row('LR-8001'), 'PO-4011'];
  part2[5] = '200.00';
  const h = [...headers, 'PO'];
  const conflict = reconcile(await input([one], [part1, part2], h));
  assert.equal(conflict.caseCounts.autoMatchedCases, 0);
  assert.match(
    conflict.cases.flatMap((c) => c.evidence).join('\n'),
    /قيم عمود المرجع مختلفة/,
  );
  part2[2] = 'SR-8001';
  assert.equal(
    reconcile(await input([one], [part1, part2], h)).caseCounts
      .autoMatchedCases,
    1,
  );
});

test('payment and journal identities remain independent of per-book reference columns', async () => {
  for (const [identity, type, value] of [
    ['Bank Ref', 'Payment', 'BANK-8001'],
    ['Voucher No', 'Journal', 'JV-8001'],
  ]) {
    const h = [...headers];
    h[1] = identity;
    const a = row('SR-8001', value);
    a[3] = type;
    const b = row('LR-8001', value);
    b[3] = type;
    const p = await input([a], [b], h);
    // Journals already require a chosen column when their only explicit
    // identity is a per-book voucher; keep that existing prerequisite.
    if (type === 'Journal')
      p.mappings = p.mappings.map((m) => ({ ...m, reference: 1 })) as [
        Mapping,
        Mapping,
      ];
    assert.equal(reconcile(p).caseCounts.autoMatchedCases, 1, type);
  }
});

test('reference evidence survives restore and verified export, and permits an explicit accountant decision', async () => {
  const p = await input([row('SR-8001')], [row('LR-8001')]);
  const r = reconcile(p);
  const review = { name: 'Reviewer', notes: '', checked: true };
  const saved = await saveSession({
    ...p,
    decisions: [],
    rejected: [],
    events: [],
    review,
  });
  const restored = await restoreSession(saved);
  assert.deepEqual(restored.result, r);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportWorkbook(r, p.files, review));
  const evidence = JSON.stringify(
    wb.getWorksheet('Match Evidence')!.getSheetValues(),
  );
  assert.match(evidence, /statedReference \(Reference\): SR-8001/);
  assert.match(evidence, /statedReference \(Reference\): LR-8001/);
  const tampered = structuredClone(r);
  tampered.supplier.transactions[0].statedReference = 'REPLACED-1';
  await assert.rejects(
    exportWorkbook(tampered, p.files, review),
    /إعادة الحساب/,
  );
  const confirmed = reconcileSupplierStatement({
    ...p,
    decisions: [
      {
        supplierId: r.supplier.transactions[0].id,
        ledgerId: r.ledger.transactions[0].id,
        note: 'Verified against original invoice',
      },
    ],
  }).result;
  assert.equal(confirmed.matches[0]?.kind, 'manual');
});
