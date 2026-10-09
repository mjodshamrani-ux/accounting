import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { compare } from '../lib/reconciliation/core.ts';
import { DOCUMENT_PAIR_RULE } from '../lib/reconciliation/document-pairs.ts';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import { localizeEngineText } from '../lib/i18n/engine.ts';
import { verifyHypothesis } from '../lib/reconciliation/assistant.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  Comparison,
} from '../lib/reconciliation/types.ts';
import { separateBytes } from './helpers/separate-export.ts';

const scope: Scope = {
  supplier: 'Supplier',
  entity: 'Company',
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
const row = (reference: string, amount = '100.00', document = 'INV-8170') => [
  '2026-07-09',
  document,
  reference,
  'Invoice',
  'Goods',
  amount,
];
const data = () => [row('LINE-0011'), row('LINE-0012')];
const bytes = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;
async function input(a = data(), b = data(), h = headers, selected = 2) {
  const files: [SourceFile, SourceFile] = [
    await readFile('supplier.csv', bytes([h, ...a])),
    await readFile('ledger.csv', separateBytes(bytes([h, ...b]))),
  ];
  const mappings = files.map((f, i) => ({
    ...selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
    reference: selected,
    ...(selected === 4 ? { description: -1 } : {}),
  })) as [Mapping, Mapping];
  return { files, mappings, scope };
}
const run = (p: Awaited<ReturnType<typeof input>>) =>
  reconcileSupplierStatement(p).result;
const auto = (r: Comparison) => r.matches.filter((m) => m.kind === 'auto');
const verifyPartition = (r: Comparison) => {
  const expected = [...r.supplier.transactions, ...r.ledger.transactions]
    .map((t) => t.id)
    .sort();
  const actual = r.cases
    .flatMap((c) => [...c.supplierMembers, ...c.ledgerMembers])
    .map((t) => t.id)
    .sort();
  assert.deepEqual(actual, expected, 'every source row has exactly one case');
};

void test('P1 proves repeated-document pairs with explicit selected reference provenance and honest evidence', async () => {
  for (const header of ['Reference', 'Ref.', 'المرجع']) {
    const h = [...headers];
    h[2] = header;
    const r = run(await input(data(), data().reverse(), h));
    assert.equal(auto(r).length, 2);
    for (const m of auto(r)) {
      assert.equal(m.evidence?.rule, DOCUMENT_PAIR_RULE);
      assert.equal(m.evidence?.discriminator?.supplierHeader, header);
      assert.equal(m.evidence?.discriminator?.supplierColumn, 3);
      assert.match(m.reason, /INV-8170/);
      assert.match(m.reason, /LINE-001[12]/);
      assert.match(localizeEngineText(m.reason, 'en'), /chosen reference/);
      const c = r.cases.find((c) => c.caseId === m.caseId)!;
      assert.equal(
        c.supplierMembers[0].chosenReference,
        c.ledgerMembers[0].chosenReference,
      );
      assert.equal(c.variance, 0);
    }
    assert.equal(
      r.balanceComparable,
      false,
      'pair evidence does not prove full balance coverage',
    );
    verifyPartition(r);
  }
});

void test('P1 preserves leading zeros, punctuation and case instead of matching normalized lookalikes', async () => {
  for (const refs of [
    ['PART-01', 'PART-1'],
    ['PART-01', 'PART01'],
    ['PART-01', 'part-01'],
  ]) {
    const a = [row(refs[0]), row('SAFE-099')];
    const b = [row(refs[1]), row('SAFE-099')];
    const r = run(await input(a, b));
    assert.equal(auto(r).length, 1);
    assert.equal(auto(r)[0].evidence?.discriminator?.value, 'SAFE-099');
    verifyPartition(r);
  }
});

void test('P1 requires literal document identity even when normalization collides', async () => {
  for (const doc of ['INV8170', 'inv-8170', 'INV-08170', 'INV-8171']) {
    const r = run(
      await input(
        data(),
        data().map((r) => {
          r[1] = doc;
          return r;
        }),
      ),
    );
    assert.equal(auto(r).length, 0, doc);
    verifyPartition(r);
  }
});

void test('P1 does not use unselected references or selected local voucher/order columns as positive identity', async () => {
  for (const selected of [-1, 1, 4])
    assert.equal(
      auto(run(await input(data(), data(), headers, selected))).length,
      0,
    );
  for (const label of ['Voucher No', 'PO', 'Batch', 'Description code']) {
    const h = [...headers];
    h[2] = label;
    const r = run(await input(data(), data(), h));
    assert.equal(auto(r).length, 0, label);
    assert.ok(r.supplier.transactions.every((t) => !t.chosenReferenceEvidence));
  }
  // A selected local field does not gain a role from another column containing
  // exactly the same value; column provenance, not value equality, is decisive.
  const a = data().map((r) => [...r, r[2]]);
  const r = run(await input(a, a, [...headers, 'Voucher No'], 6));
  assert.equal(auto(r).length, 0);
});

void test('P1 counts all discriminator occurrences before amount, date or consumption filtering', async () => {
  for (const change of ['amount', 'date'] as const) {
    const competitor = row('LINE-0011');
    if (change === 'amount') competitor[5] = '999.00';
    else competitor[0] = '2026-07-20';
    const p = await input([...data(), competitor], data());
    const r = run(p);
    assert.equal(auto(r).length, 1, change);
    assert.equal(auto(r)[0].evidence?.discriminator?.value, 'LINE-0012');
    verifyPartition(r);
  }
  const p = await input(
    [row('LINE-0011'), row('LINE-0011'), row('LINE-0012')],
    [row('LINE-0011'), row('LINE-0011'), row('LINE-0012')],
  );
  const r = run(p);
  const s = r.supplier.transactions,
    l = r.ledger.transactions;
  const manual = compare(r.supplier, r.ledger, scope, [
    {
      supplierId: s[0].id,
      ledgerId: l[0].id,
      note: 'Accountant verified source document',
    },
  ]);
  assert.equal(
    auto(manual).length,
    1,
    'manual use does not make the other duplicate unique',
  );
  const rejected = compare(
    r.supplier,
    r.ledger,
    scope,
    [],
    [`${s[0].id}|${l[0].id}`],
  );
  assert.equal(
    auto(rejected).length,
    1,
    'rejection does not remove a competitor',
  );
  verifyPartition(manual);
  verifyPartition(rejected);
});

void test('P1 missing, placeholder and unsafe discriminators leave the entire document bucket unresolved', async () => {
  for (const value of [
    '',
    '0',
    '000.00',
    '٠٠',
    'N/A',
    'TOTAL',
    'Page Total',
    'Total:',
    'الإجمالي：',
    'Carried forward',
    'Brought forward',
    'الإجمالي',
    'مجموع الصفحة',
    'المرحل',
    'Opening balance',
    'غير متوفر',
    'Invoice',
    'دفعة',
    'Credit',
    '—',
  ]) {
    const a = data();
    a[1][2] = value;
    assert.equal(auto(run(await input(a, data()))).length, 0, value);
  }
  for (const key of ['1:3', '3:3']) {
    const p = await input();
    p.files[0].sheets[0].referenceIssues = {
      [key]: ['Unreliable discriminator'],
    };
    assert.equal(auto(run(p)).length, 0, key);
  }
  const p = await input(
    data().map((r) => [...r, r[2]]),
    data().map((r) => [...r, r[2]]),
    [...headers, 'Ref'],
  );
  assert.equal(auto(run(p)).length, 0, 'duplicate generic reference headers');
});

void test('P1 contextual discriminator accepts literal numeric and alphabetic references in either language', async () => {
  for (const refs of [
    ['000084', '0084', '84'],
    ['KEY-X', 'KEY-Y'],
    ['مرجع-أ', 'مرجع-ب'],
    ['1', '2'],
    ['أ', 'ب'],
    ['١٢', '12'],
  ]) {
    const rows = refs.map((reference) => row(reference));
    const r = run(await input(rows, rows.toReversed()));
    assert.equal(auto(r).length, refs.length, refs.join(' / '));
    for (const c of r.cases)
      assert.equal(
        c.supplierMembers[0].chosenReference,
        c.ledgerMembers[0].chosenReference,
      );
    verifyPartition(r);
  }
});

void test('P1 contextual references are unique within a document, not across unrelated documents', async () => {
  const a = [row('KEY-X'), row('KEY-Y'), row('KEY-X', '100.00', 'INV-8171')];
  const r = run(await input(a, a.toReversed()));
  assert.equal(auto(r).length, 3);
  for (const c of r.cases) {
    assert.equal(c.supplierMembers[0].reference, c.ledgerMembers[0].reference);
    assert.equal(
      c.supplierMembers[0].chosenReference,
      c.ledgerMembers[0].chosenReference,
    );
  }
  verifyPartition(r);
});

void test('P1 formula-like and error references remain literal, visible and unapproved in every automatic path', async () => {
  for (const value of [
    '=1+1',
    '=SUM(A1)',
    '#REF!',
    '#DIV/0!',
    '#N/A',
    '#SPILL!',
    '+42',
    '-42',
    '−42',
    '@SUM(A1)',
    '＝1＋1',
  ]) {
    for (const rows of [[row(value)], [row(value), row('SAFE-002')]]) {
      const r = run(await input(rows, rows));
      assert.equal(auto(r).length, 0, value);
      assert.equal(r.supplier.transactions[0].chosenReference, value);
      assert.ok(r.supplier.transactions[0].referenceEvidenceIssues?.length);
      verifyPartition(r);
    }
  }
  // Mapped fallback columns and an unselected unsafe Reference cannot bypass
  // the source check just because a safe Document No supplies primary identity.
  for (const [header, selected] of [
    ['Other ID', 2],
    ['Reference', 1],
  ] as const) {
    const h = [...headers];
    h[2] = header;
    assert.equal(
      auto(run(await input([row('=A1')], [row('=A1')], h, selected))).length,
      0,
    );
  }
});

void test('P1 direct-source comparisons cannot omit issue flags to bypass unsafe-reference checks', async () => {
  for (const field of [
    'chosenReference',
    'documentReference',
    'reference',
    'voucherReference',
    'poReference',
  ] as const) {
    const r = run(await input());
    for (const source of [r.supplier, r.ledger]) {
      source.transactions[0][field] = '=DOC1';
      source.transactions[0].referenceEvidenceIssues = [];
    }
    assert.equal(auto(compare(r.supplier, r.ledger, scope)).length, 0, field);
  }
  const r = run(await input([row('SAFE-001')], [row('SAFE-001')]));
  r.supplier.transactions[0].chosenReference =
    r.ledger.transactions[0].chosenReference = '#REF!';
  assert.equal(
    auto(compare(r.supplier, r.ledger, scope)).length,
    0,
    'unique primary',
  );
  const a = [[...row('LINE-A', '300.00'), 'PO-9001']];
  const b = [
    [...row('LINE-A', '100.00'), 'PO-9001'],
    [...row('LINE-A', '200.00'), 'PO-9001'],
  ];
  const group = run(await input(a, b, [...headers, 'PO']));
  assert.equal(group.caseCounts.autoMatchedCases, 1);
  group.ledger.transactions[0].voucherReference = '#REF!';
  assert.equal(
    auto(compare(group.supplier, group.ledger, scope)).length,
    0,
    'whole group',
  );
});

void test('P1 assistant proposal verification rejects a case copy with altered discriminator evidence', async () => {
  for (const value of [
    { chosenReference: 'ALTERED-1' },
    { chosenReferenceEvidence: undefined },
    { statedReference: 'ALTERED-1' },
    { retainedEvidence: [] },
  ]) {
    const r = run(await input());
    const c = r.cases[0];
    c.supplierMembers[0] = { ...c.supplierMembers[0], ...value };
    const check = verifyHypothesis(r, {
      supplierIds: [c.supplierMembers[0].id],
      ledgerIds: [c.ledgerMembers[0].id],
    });
    assert.equal(check.status, 'rejected');
    assert.match(check.reason, /لا تطابق المصدر الحالي/);
  }
});

void test('P1 keeps amount, sign, date, type, PO conflict and source-reading guards', async () => {
  for (const [column, value] of [
    [5, '100.01'],
    [5, '-100.00'],
    [0, '2026-07-20'],
    [3, 'Payment'],
    [3, 'RV'],
  ] as const) {
    const b = data();
    b[0][column] = value;
    const r = run(await input(data(), b));
    assert.ok(
      !auto(r).some((m) => m.evidence?.discriminator?.value === 'LINE-0011'),
      value,
    );
    verifyPartition(r);
  }
  const a = data().map((r) => [...r, 'PO-0011']);
  const b = data().map((r) => [...r, 'PO-0012']);
  assert.equal(auto(run(await input(a, b, [...headers, 'PO']))).length, 0);
  const invalid = [...data(), row('LINE-0999', 'broken')];
  const invalidInput = await input(invalid, data());
  const partial = run(invalidInput);
  assert.equal(partial.supplier.errors.length, 1);
  assert.equal(partial.supplier.errors[0].row, 4);
  assert.equal(partial.supplier.transactions.length, 2);
  assert.equal(
    auto(partial).length,
    0,
    'an unread member still taints INV-8170',
  );
  assert.equal(partial.bridge, null);
  assert.equal(partial.balanceComparable, false);
  verifyPartition(partial);
  const r = run(await input());
  r.supplier.errors.push({ row: 99, message: 'Unread source row' });
  assert.equal(auto(compare(r.supplier, r.ledger, scope)).length, 0);
});

void test('P1 excluded same-document evidence blocks uniqueness while an unrelated total does not', async () => {
  const r = run(await input());
  for (const value of ['INV-8170', 'LINE-0011']) {
    const s = structuredClone(r.supplier);
    s.excluded.push({
      row: 99,
      reason: 'Excluded source row',
      values: [value, '100.00'],
    });
    assert.equal(auto(compare(s, r.ledger, scope)).length, 0, value);
  }
  const s = structuredClone(r.supplier);
  s.excluded.push({ row: 99, reason: 'Total', values: ['Total', '200.00'] });
  assert.equal(auto(compare(s, r.ledger, scope)).length, 2);
});

void test('P1 rejects an invalid source date even when compare is called directly', async () => {
  for (const side of ['supplier', 'ledger'] as const) {
    const r = run(await input());
    r[side].transactions[0].date = 'invalid-date';
    const c = compare(r.supplier, r.ledger, scope);
    assert.equal(auto(c).length, 1);
    assert.equal(auto(c)[0].evidence?.discriminator?.value, 'LINE-0012');
    verifyPartition(c);
  }
});

void test('P1 honors rejection, manual decisions and self-comparison without losing rows', async () => {
  const p = await input();
  const r = run(p);
  const s = r.supplier.transactions,
    l = r.ledger.transactions;
  const rejected = compare(
    r.supplier,
    r.ledger,
    scope,
    [],
    [`${s[0].id}|${l[0].id}`],
  );
  assert.equal(auto(rejected).length, 1);
  verifyPartition(rejected);
  const manual = compare(r.supplier, r.ledger, scope, [
    {
      supplierId: s[0].id,
      ledgerId: l[0].id,
      note: 'Confirmed against invoice',
    },
  ]);
  assert.equal(auto(manual).length, 1);
  assert.equal(manual.matches.filter((m) => m.kind === 'manual').length, 1);
  verifyPartition(manual);
  p.files[1] = p.files[0];
  const self = run(p);
  assert.equal(auto(self).length, 0);
  assert.ok(self.cases.every((c) => c.status === 'Needs Review'));
  verifyPartition(self);
});

void test('P1 case identity follows the discriminator when identical-amount/date rows are reordered', async () => {
  const identity = (r: Comparison) =>
    Object.fromEntries(
      r.cases.map((c) => [c.supplierMembers[0].chosenReference, c.caseId]),
    );
  const r = run(await input());
  assert.equal(auto(r).length, 2);
  assert.equal(new Set(r.cases.map((c) => c.caseId)).size, 2);
  assert.deepEqual(
    identity(run(await input(data().reverse(), data()))),
    identity(r),
  );
  assert.deepEqual(
    identity(run(await input(data(), data().reverse()))),
    identity(r),
  );
});

void test('P1 preserves genuine whole-document groups instead of splitting duplicate discriminators', async () => {
  const a = [[...row('LINE-0099', '300.00'), 'PO-9001']];
  const b = [
    [...row('LINE-0099', '100.00'), 'PO-9001'],
    [...row('LINE-0099', '200.00'), 'PO-9001'],
  ];
  const r = run(await input(a, b, [...headers, 'PO']));
  assert.equal(r.caseCounts.autoMatchedCases, 1);
  assert.equal(r.cases[0].ledgerMembers.length, 2);
  assert.notEqual(r.cases[0].matchingRule, DOCUMENT_PAIR_RULE);
  verifyPartition(r);
});

void test('P1 missing Type is allowed but numeric document roles must be explicit on both sources', async () => {
  const a = data().map((r) => {
    r[3] = '';
    return r;
  });
  assert.equal(auto(run(await input(a, a))).length, 2);
  const n = data().map((r) => {
    r[1] = '008170';
    return r;
  });
  assert.equal(auto(run(await input(n, n))).length, 2);
  const b = n.map((r) => {
    const c = [...r];
    c[3] = '';
    return c;
  });
  assert.equal(auto(run(await input(n, b))).length, 0);
});

void test('P1 restore and verified Excel export preserve pairs and reject altered provenance', async () => {
  const p = await input();
  const r = run(p);
  const review = { name: 'Reviewer', notes: '', checked: true };
  const saved = await saveSession({
    ...p,
    decisions: [],
    rejected: [],
    events: [],
    review,
  });
  assert.deepEqual((await restoreSession(saved)).result, r);
  {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportWorkbook(r, p.files, review));
    const evidence = JSON.stringify(
      wb.getWorksheet('Match Evidence')!.getSheetValues(),
    );
    assert.match(evidence, /EXACT_DOCUMENT_CHOSEN_REFERENCE_UNIQUE_V1/);
    assert.match(evidence, /LINE-0011/);
    assert.match(evidence, /LINE-0012/);
    assert.match(evidence, /mappedReference \(Reference\)/);
    assert.equal(wb.getWorksheet('Match Evidence')!.rowCount, 5);
  }
  for (const alter of ['role', 'column', 'value'] as const) {
    const tampered = structuredClone(r);
    const t = tampered.supplier.transactions[0];
    if (alter === 'role') delete t.chosenReferenceEvidence;
    if (alter === 'column') t.chosenReferenceEvidence!.column = 99;
    if (alter === 'value') t.chosenReference = 'ALTERED-01';
    await assert.rejects(
      exportWorkbook(tampered, p.files, review),
      /إعادة الحساب/,
    );
  }
});
