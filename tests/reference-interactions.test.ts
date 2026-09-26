import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';
import { separateBytes } from './helpers/separate-export.ts';

// Counter-cases around the V1 reference and document-type changes (T01, R01,
// R02): each pairs rows whose reference, amount and date agree, so that only
// the interaction under test decides. None of them may be approved; where the
// rows are a real candidate, the reason must be visible for review.
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
const csv = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;
const CONTROL = ['2026-07-03', 'INV-9001', 'Invoice', 'Goods', '300.00'];

/** Both files through the production path; `referenceHeader` is the column
 * the accountant chooses as the reference, or none (-1) as proposed. */
async function reconcile(
  headers: string[],
  supplier: string[][],
  ledger: string[][],
  referenceHeader?: string,
) {
  const a = await readFile('supplier.csv', csv([headers, ...supplier]));
  const b = await readFile(
    'ledger.csv',
    separateBytes(csv([headers, ...ledger])),
  );
  const reading = (file: SourceFile, side: 'supplier' | 'ledger') => {
    const { mapping } = selectImportMapping(file, side);
    return (
      referenceHeader === undefined
        ? mapping
        : { ...mapping, reference: headers.indexOf(referenceHeader) }
    ) as Mapping;
  };
  return reconcileSupplierStatement({
    files: [a, b],
    mappings: [reading(a, 'supplier'), reading(b, 'ledger')],
    scope,
  }).result;
}
type Result = Awaited<ReturnType<typeof reconcile>>;
const approved = (r: Result) =>
  r.cases
    .filter((c) => c.status === 'Matched')
    .map((c) => c.supplierMembers.map((t) => t.row).join('+'));
/** The case holding the first supplier row, and all it says. */
const firstCase = (r: Result) => {
  const c = r.cases.find((x) => x.supplierMembers.some((t) => t.row === 2))!;
  return {
    status: c.status,
    text: [
      ...c.evidence,
      ...[...c.supplierMembers, ...c.ledgerMembers].flatMap(
        (t) => t.referenceEvidenceIssues ?? [],
      ),
    ].join('\n'),
  };
};

test('an explicit document number cannot outvote the references the accountant chose', async () => {
  const H = [
    'Date',
    'Document No',
    'Reference',
    'Type',
    'Description',
    'Amount',
  ];
  const r = await reconcile(
    H,
    [
      ['2026-07-09', 'INV-4401', 'X-9001', 'Invoice', 'Goods', '100.00'],
      ['2026-07-03', 'INV-9001', 'INV-9001', 'Invoice', 'Goods', '300.00'],
    ],
    [
      ['2026-07-09', 'INV-4401', 'X-7001', 'Invoice', 'Goods', '100.00'],
      ['2026-07-03', 'INV-9001', 'INV-9001', 'Invoice', 'Goods', '300.00'],
    ],
    'Reference',
  );
  const c = firstCase(r);
  assert.equal(c.status, 'Needs Review');
  assert.match(c.text, /المرجعان المختاران مختلفان/);
  assert.deepEqual(approved(r), ['3']);
  // The same rows with agreeing chosen references still match.
  const agreeing = await reconcile(
    H,
    [['2026-07-09', 'INV-4401', 'X-9001', 'Invoice', 'Goods', '100.00']],
    [['2026-07-09', 'INV-4401', 'X-9001', 'Invoice', 'Goods', '100.00']],
    'Reference',
  );
  assert.deepEqual(approved(agreeing), ['2']);
});

test('a batch, an account or an order chosen as the reference does not prove a document', async () => {
  for (const [header, value] of [
    ['Batch', 'B-7701'],
    ['Account', 'AP-2001'],
    ['PO', 'PO-5521'],
  ]) {
    const H = ['Date', header, 'Type', 'Description', 'Amount'];
    const row = ['2026-07-09', value, 'Invoice', 'Goods', '100.00'];
    const r = await reconcile(H, [row], [row], header);
    assert.deepEqual(approved(r), [], header);
  }
});

test('one value in two fields of different roles does not prove the invoice', async () => {
  const H = ['Date', 'Document No', 'PO', 'Type', 'Description', 'Amount'];
  const row = [
    '2026-07-09',
    'PO-5521',
    'PO-5521',
    'Invoice',
    'Goods',
    '100.00',
  ];
  const r = await reconcile(H, [row], [row]);
  assert.deepEqual(approved(r), []);
  const c = firstCase(r);
  assert.equal(c.status, 'Needs Review');
  assert.match(c.text, /أمر الشراء/);
});

test('matching amount and reference with conflicting document types stay for review', async () => {
  const H = ['Date', 'Reference', 'Type', 'Description', 'Amount'];
  for (const [a, b] of [
    ['Tax Invoice', 'Vendor Payment'],
    ['فاتورة ضريبية', 'دفعة'],
    ['Invoice', 'Tax Credit Note'],
  ]) {
    const r = await reconcile(
      H,
      [['2026-07-09', 'DOC-4410', a, 'Goods', '100.00'], CONTROL],
      [['2026-07-09', 'DOC-4410', b, 'Goods', '100.00'], CONTROL],
    );
    assert.deepEqual(approved(r), ['3'], `${a}/${b}`);
    assert.equal(firstCase(r).status, 'Needs Review', `${a}/${b}`);
  }
});

test('Type = Invoice with a description opening with another documented role is a conflict', async () => {
  const H = ['Date', 'Reference', 'Type', 'Description', 'Amount'];
  for (const description of [
    'Credit Note 55',
    'Tax Credit Note 55',
    'Vendor Payment July',
    'Supplier Credit Memo 7',
    'إشعار دائن 12',
  ]) {
    const r = await reconcile(
      H,
      [['2026-07-09', 'DOC-4420', 'Invoice', description, '100.00'], CONTROL],
      [['2026-07-09', 'DOC-4420', 'Invoice', 'Goods', '100.00'], CONTROL],
    );
    assert.deepEqual(approved(r), ['3'], description);
    assert.match(firstCase(r).text, /متعارضة/, description);
  }
  // A description is never positive evidence: free text naming the same role
  // neither helps nor blocks, and text that only mentions a role later on is
  // not a label.
  for (const description of ['Tax Invoice 55', 'Goods per tax invoice 55']) {
    const r = await reconcile(
      H,
      [['2026-07-09', 'DOC-4430', 'Invoice', description, '100.00']],
      [['2026-07-09', 'DOC-4430', 'Invoice', 'Goods', '100.00']],
    );
    assert.deepEqual(approved(r), ['2'], description);
  }
});

test('an unknown or party-specific code stays unknown, is not guessed, and the pair is shown for review', async () => {
  const H = ['Date', 'Reference', 'Type', 'Description', 'Amount'];
  for (const code of ['RV', 'KR', 'TX-07', 'ZINV', 'INV', 'فاتورة X']) {
    const row = ['2026-07-09', 'DOC-4440', code, 'Goods', '100.00'];
    const r = await reconcile(H, [row, CONTROL], [row, CONTROL]);
    const t = r.supplier.transactions.find((x) => x.reference === 'DOC-4440')!;
    assert.equal(t.documentType, 'Unknown', code);
    assert.deepEqual(approved(r), ['3'], code);
    const c = firstCase(r);
    assert.equal(c.status, 'Needs Review', code);
    assert.match(c.text, /نوع مستند غير متحقق/, code);
  }
});

test('with no reference column chosen, nothing is approved, as the interface says', async () => {
  // The generated R01 layout: a Reference and a Voucher No column, so the
  // product leaves the reference column for the accountant to choose. Until
  // then no match is approved, even where both books share a voucher number
  // (V1 approved this pair on the voucher alone).
  const file = (reference: string, control: string) =>
    [
      'Synthetic Supplier - Transaction statement',
      'Entity: Synthetic Buyer,Account: AP-482,Currency: SAR',
      'Period: 2026-07-01 to 2026-07-31',
      'Positive amount increases the payable to the supplier',
      'Date,Reference,Document Type,Description,Voucher No,Amount,Currency,Account',
      ',,,Opening balance,,0.00,,',
      `2026-07-09,${reference},Invoice,Goods supplied,JV-20-594,6680.21,SAR,AP-482`,
      control,
    ].join('\n');
  const a = await readFile(
    'supplier.csv',
    new TextEncoder().encode(
      file(
        'INV-30020',
        '2026-07-03,INV-7060,Invoice,Goods supplied,,456.43,SAR,AP-482',
      ),
    ).buffer as ArrayBuffer,
  );
  const b = await readFile(
    'ledger.csv',
    new TextEncoder().encode(
      file(
        'INV-30520',
        '2026-07-03,INV-7060,Invoice,Goods supplied,,456.43,SAR,AP-482',
      ),
    ).buffer as ArrayBuffer,
  );
  const proposed: [Mapping, Mapping] = [
    selectImportMapping(a, 'supplier').mapping,
    selectImportMapping(b, 'ledger').mapping,
  ];
  assert.deepEqual(
    proposed.map((m) => m.reference),
    [-1, -1],
  );
  const run = (mappings: [Mapping, Mapping]) =>
    reconcileSupplierStatement({
      files: [a, b],
      mappings,
      scope: { ...scope, account: 'AP-482' },
    }).result;
  assert.deepEqual(approved(run(proposed)), []);
  // Once the accountant chooses the Reference column, the control invoice
  // matches and the two different invoices do not.
  const chosen = proposed.map((m) => ({ ...m, reference: 1 })) as [
    Mapping,
    Mapping,
  ];
  assert.deepEqual(approved(run(chosen)), ['8']);
});

test('the accountant can still confirm by hand rows whose chosen references differ', async () => {
  const H = [
    'Date',
    'Document No',
    'Reference',
    'Type',
    'Description',
    'Amount',
  ];
  const a = await readFile(
    'supplier.csv',
    csv([
      H,
      ['2026-07-09', 'INV-4401', 'X-9001', 'Invoice', 'Goods', '100.00'],
    ]),
  );
  const b = await readFile(
    'ledger.csv',
    csv([
      H,
      ['2026-07-09', 'INV-4402', 'X-7001', 'Invoice', 'Goods', '100.00'],
    ]),
  );
  const mappings = [a, b].map((f, i) => ({
    ...selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
    reference: 2,
  })) as [Mapping, Mapping];
  const auto = reconcileSupplierStatement({
    files: [a, b],
    mappings,
    scope,
  }).result;
  assert.deepEqual(approved(auto), []);
  const [s, l] = [auto.supplier.transactions[0], auto.ledger.transactions[0]];
  const confirmed = reconcileSupplierStatement({
    files: [a, b],
    mappings,
    scope,
    decisions: [{ supplierId: s.id, ledgerId: l.id, note: 'Same delivery' }],
  }).result;
  assert.equal(
    confirmed.cases.filter(
      (c) => c.status === 'Matched' && c.matchingRule === 'MANUAL_REVIEW',
    ).length,
    1,
  );
});

test('invoice lines naming different purchase orders are shown for review with that reason', async () => {
  const H = ['Date', 'Reference', 'Type', 'PO', 'Description', 'Amount'];
  const r = await reconcile(
    H,
    [['2026-07-12', 'INV-90017', 'Invoice', 'PO-7781', 'Goods', '900.00']],
    [
      ['2026-07-12', 'INV-90017', 'Invoice', 'PO-7781', 'Goods', '500.00'],
      ['2026-07-12', 'INV-90017', 'Invoice', 'PO-7799', 'Goods', '400.00'],
    ],
    'Reference',
  );
  assert.deepEqual(approved(r), []);
  const c = firstCase(r);
  assert.equal(c.status, 'Needs Review');
  assert.match(c.text, /أوامر شراء مختلفة/);
});
