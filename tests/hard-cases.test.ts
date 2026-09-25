import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import { restoreSession, saveSession } from '../lib/reconciliation/session.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import { ENGINE_VERSION } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

// Fixed cases from the hard-case campaign (audit/hard-cases). Each engine
// change is held by a case that failed before it and by reverse cases that
// must still stop. The expectations are written by hand in the source's own
// terms; nothing here is derived from the engine's parsing.
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
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\n')).buffer;

/** Runs a supplier statement and a ledger through the production path:
 * read, select the columns, then the shared recompute. Where the selection
 * leaves the reference column open, `referenceHeader` is the column the
 * accountant chooses. */
async function reconcile(
  supplier: string[][],
  ledger: string[][],
  referenceHeader?: string,
) {
  const a = await readFile('supplier.csv', csv(supplier), undefined, true);
  const b = await readFile('ledger.csv', csv(ledger), undefined, true);
  const select = (file: typeof a, side: 'supplier' | 'ledger') => {
    const { mapping } = selectImportMapping(file, side);
    return referenceHeader
      ? {
          ...mapping,
          reference:
            file.sheets[0].rows[mapping.header].indexOf(referenceHeader),
        }
      : mapping;
  };
  return reconcileSupplierStatement({
    files: [a, b],
    mappings: [select(a, 'supplier'), select(b, 'ledger')],
    scope,
  }).result;
}
/** The status of the case holding a given supplier reference. */
const statusOf = (
  result: Awaited<ReturnType<typeof reconcile>>,
  reference: string,
) =>
  result.cases.find((c) =>
    c.supplierMembers.some((t) => t.reference === reference),
  )?.status;

const TYPED = ['Date', 'Reference', 'Type', 'Description', 'Amount'];
/** One invoice on each side plus a control invoice that must always match. */
const typed = (supplierType: string, ledgerType = supplierType) =>
  reconcile(
    [
      TYPED,
      ['2026-07-09', 'INV-34001', supplierType, 'Goods supplied', '1250.00'],
      ['2026-07-10', 'INV-34900', 'Invoice', 'Goods supplied', '300.00'],
    ],
    [
      TYPED,
      ['2026-07-09', 'INV-34001', ledgerType, 'Goods supplied', '1250.00'],
      ['2026-07-10', 'INV-34900', 'Invoice', 'Goods supplied', '300.00'],
    ],
  );

test('T01: documented invoice labels are read as invoices and match', async () => {
  for (const label of [
    'Tax Invoice',
    'tax  invoice',
    'Vendor Invoice',
    'Supplier Invoice',
    'Purchase Invoice',
    'AP Tax Invoice',
    'فاتورة ضريبية',
    'فاتوره ضريبيه',
    'فاتورة مشتريات',
    'فاتورة شراء',
    'فاتورة مورد',
  ]) {
    const result = await typed(label);
    assert.equal(statusOf(result, 'INV-34001'), 'Matched', label);
    const row = result.supplier.transactions.find(
      (t) => t.reference === 'INV-34001',
    );
    assert.equal(row?.documentType, 'Invoice', label);
    assert.equal(statusOf(result, 'INV-34900'), 'Matched', label);
  }
  // Credit notes and payments keep their own role under the same qualifiers.
  for (const [label, role] of [
    ['Tax Credit Note', 'Credit Note'],
    ['Vendor Credit Memo', 'Credit Note'],
    ['Vendor Payment', 'Payment'],
  ] as const) {
    const result = await typed(label);
    const row = result.supplier.transactions.find(
      (t) => t.reference === 'INV-34001',
    );
    assert.equal(row?.documentType, role, label);
  }
});

test('T01 reverse: labels that name another role or no role are not guessed', async () => {
  // A pro-forma or a reversal is not the invoice itself, and a bare code has
  // no documented meaning; each stays unknown and blocks automatic matching.
  for (const label of [
    'Proforma Invoice',
    'Invoice Reversal',
    'Tax Invoice Draft',
    'فاتورة مبدئية',
    'فاتورة ضريبية ملغاة',
    'TX-07',
    'INV',
  ]) {
    const result = await typed(label);
    const row = result.supplier.transactions.find(
      (t) => t.reference === 'INV-34001',
    );
    assert.equal(row?.documentType, 'Unknown', label);
    assert.notEqual(statusOf(result, 'INV-34001'), 'Matched', label);
    assert.equal(statusOf(result, 'INV-34900'), 'Matched', label);
  }
});

test('T01 reverse: a recognised synonym still conflicts with another role', async () => {
  for (const [a, b] of [
    ['Tax Invoice', 'Payment'],
    ['فاتورة ضريبية', 'إشعار دائن'],
    ['Vendor Invoice', 'Vendor Payment'],
  ]) {
    const result = await typed(a, b);
    assert.notEqual(statusOf(result, 'INV-34001'), 'Matched', `${a}/${b}`);
    assert.equal(statusOf(result, 'INV-34900'), 'Matched', `${a}/${b}`);
  }
});

const PAID = ['Date', 'Reference', 'Type', 'Bank Ref', 'Description', 'Amount'];
type Part = [date: string, bank: string, amount: string, reference?: string];
/** One payment on the supplier statement against its parts in the ledger,
 * with a control invoice on both sides. */
const split = (single: Part, parts: Part[], window = 2) => {
  const row = ([date, bank, amount, reference]: Part) => [
    date,
    reference ?? 'PAY-4410',
    'Payment',
    bank,
    'Transfer',
    amount,
  ];
  const control = ['2026-07-10', 'INV-34900', 'Invoice', '', 'Goods', '300.00'];
  return reconcileWindow(
    [PAID, row(single), control],
    [PAID, ...parts.map(row), control],
    window,
  );
};
async function reconcileWindow(
  supplier: string[][],
  ledger: string[][],
  dateWindow: number,
) {
  const a = await readFile('supplier.csv', csv(supplier), undefined, true);
  const b = await readFile('ledger.csv', csv(ledger), undefined, true);
  return reconcileSupplierStatement({
    files: [a, b],
    mappings: [
      selectImportMapping(a, 'supplier').mapping,
      selectImportMapping(b, 'ledger').mapping,
    ],
    scope: { ...scope, dateWindow },
  }).result;
}
const paymentCase = (result: Awaited<ReturnType<typeof reconcile>>) =>
  result.cases.find((c) =>
    c.supplierMembers.some((t) => t.documentType === 'Payment'),
  );
const controlMatched = (result: Awaited<ReturnType<typeof reconcile>>) =>
  statusOf(result, 'INV-34900') === 'Matched';

test('G08: parts of one payment on neighbouring days match through an explicit bank identity', async () => {
  const bank = 'TRF-88120';
  for (const [single, parts] of [
    [
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-400.00'],
        ['2026-07-14', bank, '-350.00'],
        ['2026-07-15', bank, '-250.00'],
      ],
    ],
    [
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-13', bank, '-600.00'],
        ['2026-07-15', bank, '-400.00'],
      ],
    ],
  ] as [Part, Part[]][]) {
    const result = await split(single, parts);
    const c = paymentCase(result);
    assert.equal(c?.status, 'Matched');
    assert.equal(
      c?.matchingRule,
      'EXPLICIT_PAYMENT_IDENTITY_GROUP_DATE_SPAN_V1',
    );
    assert.equal(c?.ledgerMembers.length, parts.length);
    assert.ok(controlMatched(result));
  }
  // The same group on one date keeps its existing rule and wording.
  const sameDay = paymentCase(
    await split(
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-600.00'],
        ['2026-07-14', bank, '-400.00'],
      ],
    ),
  );
  assert.equal(
    sameDay?.matchingRule,
    'EXPLICIT_PAYMENT_IDENTITY_GROUP_TOTAL_V1',
  );
});

test('G08 reverse: a spread group without full, unique, in-window identity stays for review', async () => {
  const bank = 'TRF-88120';
  const cases: [string, Part, Part[], number?][] = [
    [
      'no bank identity',
      ['2026-07-14', '', '-1000.00'],
      [
        ['2026-07-14', '', '-600.00'],
        ['2026-07-15', '', '-400.00'],
      ],
    ],
    [
      'identity on only some parts',
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-600.00'],
        ['2026-07-15', '', '-400.00'],
      ],
    ],
    [
      'span beyond the window',
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-600.00'],
        ['2026-07-19', bank, '-400.00'],
      ],
    ],
    [
      'each part in window of the payment but the parts span more',
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-12', bank, '-600.00'],
        ['2026-07-16', bank, '-400.00'],
      ],
    ],
    [
      'window of zero days',
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-600.00'],
        ['2026-07-15', bank, '-400.00'],
      ],
      0,
    ],
    [
      'conflicting bank identity',
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-600.00'],
        ['2026-07-15', 'TRF-88121', '-400.00'],
      ],
    ],
    [
      'the totals differ',
      ['2026-07-14', bank, '-1000.00'],
      [
        ['2026-07-14', bank, '-600.00'],
        ['2026-07-15', bank, '-390.00'],
      ],
    ],
  ];
  for (const [name, single, parts, window] of cases) {
    const result = await split(single, parts, window);
    assert.notEqual(paymentCase(result)?.status, 'Matched', name);
    assert.ok(controlMatched(result), name);
  }
  // A further ledger row carries the same bank identity. A payment's bank
  // identity is its reference, so the row joins the whole identity group and
  // the engine does not look for the subset that would balance.
  const competing = await reconcileWindow(
    [
      PAID,
      ['2026-07-14', 'PAY-4410', 'Payment', bank, 'Transfer', '-1000.00'],
      ['2026-07-10', 'INV-34900', 'Invoice', '', 'Goods', '300.00'],
    ],
    [
      PAID,
      ['2026-07-14', 'PAY-4410', 'Payment', bank, 'Transfer', '-600.00'],
      ['2026-07-15', 'PAY-4410', 'Payment', bank, 'Transfer', '-400.00'],
      ['2026-07-15', 'PAY-4499', 'Payment', bank, 'Transfer', '-75.00'],
      ['2026-07-10', 'INV-34900', 'Invoice', '', 'Goods', '300.00'],
    ],
    2,
  );
  assert.ok(
    competing.cases
      .filter((c) => c.status === 'Matched')
      .every((c) =>
        c.supplierMembers.every((t) => t.documentType !== 'Payment'),
      ),
  );
  assert.ok(controlMatched(competing));
});

test('G08 reverse: invoice groups still need one date', async () => {
  const head = ['Date', 'Reference', 'Type', 'PO', 'Description', 'Amount'];
  const result = await reconcile(
    [
      head,
      ['2026-07-12', 'INV-90017', 'Invoice', 'PO-7781', 'Goods', '900.00'],
      ['2026-07-10', 'INV-34900', 'Invoice', '', 'Goods', '300.00'],
    ],
    [
      head,
      ['2026-07-12', 'INV-90017', 'Invoice', 'PO-7781', 'Goods', '500.00'],
      ['2026-07-13', 'INV-90017', 'Invoice', 'PO-7781', 'Goods', '400.00'],
      ['2026-07-10', 'INV-34900', 'Invoice', '', 'Goods', '300.00'],
    ],
  );
  assert.notEqual(statusOf(result, 'INV-90017'), 'Matched');
  assert.equal(statusOf(result, 'INV-34900'), 'Matched');
});

const VOUCHERED = [
  'Date',
  'Reference',
  'Type',
  'Voucher No',
  'Batch',
  'Description',
  'Amount',
];
const rowOf = (result: Awaited<ReturnType<typeof reconcile>>, ref: string) =>
  [...result.supplier.transactions, ...result.ledger.transactions].filter(
    (t) =>
      t.reference === ref || t.retainedEvidence?.some((e) => e.value === ref),
  );

test('R01: each book numbers its own vouchers; the chosen reference still names the invoice', async () => {
  const result = await reconcile(
    [
      VOUCHERED,
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'SJ-17-402',
        '',
        'Goods',
        '812.40',
      ],
      ['2026-07-10', 'INV-34900', 'Invoice', '', '', 'Goods', '300.00'],
    ],
    [
      VOUCHERED,
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'JV-17-118',
        '',
        'Goods',
        '812.40',
      ],
      ['2026-07-10', 'INV-34900', 'Invoice', '', '', 'Goods', '300.00'],
    ],
    'Reference',
  );
  assert.equal(statusOf(result, 'INV-30017'), 'Matched');
  // Both vouchers are kept on their rows, with the chosen reference primary.
  const [s, l] = rowOf(result, 'INV-30017');
  assert.equal(s.voucherReference, 'SJ-17-402');
  assert.equal(l.voucherReference, 'JV-17-118');
  assert.equal(s.primaryReference, 'INV-30017');
});

test('R01 reverse: the chosen reference must itself prove the document', async () => {
  const cases: [string, string[], string[]][] = [
    [
      'chosen references differ even though vouchers agree',
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'JV-17-118',
        '',
        'Goods',
        '812.40',
      ],
      [
        '2026-07-09',
        'INV-30018',
        'Invoice',
        'JV-17-118',
        '',
        'Goods',
        '812.40',
      ],
    ],
    [
      'the chosen reference is repeated on the ledger',
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'SJ-17-402',
        '',
        'Goods',
        '812.40',
      ],
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'JV-17-118',
        '',
        'Goods',
        '812.40',
      ],
    ],
    [
      'amounts differ',
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'SJ-17-402',
        '',
        'Goods',
        '812.40',
      ],
      [
        '2026-07-09',
        'INV-30017',
        'Invoice',
        'JV-17-118',
        '',
        'Goods',
        '812.04',
      ],
    ],
  ];
  for (const [name, s, l] of cases) {
    const ledger = [VOUCHERED, l];
    if (name.includes('repeated'))
      ledger.push([
        '2026-07-11',
        'INV-30017',
        'Invoice',
        'JV-17-119',
        '',
        'Goods',
        '812.40',
      ]);
    const result = await reconcile(
      [
        VOUCHERED,
        s,
        ['2026-07-10', 'INV-34900', 'Invoice', '', '', 'Goods', '300.00'],
      ],
      [
        ...ledger,
        ['2026-07-10', 'INV-34900', 'Invoice', '', '', 'Goods', '300.00'],
      ],
      'Reference',
    );
    assert.ok(
      result.cases
        .filter((c) => c.status === 'Matched')
        .every((c) =>
          c.supplierMembers.every((t) => t.reference === 'INV-34900'),
        ),
      name,
    );
    assert.equal(statusOf(result, 'INV-34900'), 'Matched', name);
  }
  // A PO chosen as the reference is flagged as not proving the invoice, even
  // when a voucher is present.
  const head = ['Date', 'PO', 'Type', 'Voucher No', 'Description', 'Amount'];
  const po = await reconcile(
    [head, ['2026-07-09', 'PO-5521', 'Invoice', 'SJ-1', 'Goods', '812.40']],
    [head, ['2026-07-09', 'PO-5521', 'Invoice', 'JV-9', 'Goods', '812.40']],
    'PO',
  );
  const row = po.supplier.transactions[0];
  assert.ok(
    row.referenceEvidenceIssues?.includes(
      'أمر الشراء وحده لا يثبت هوية الفاتورة',
    ),
    JSON.stringify(row),
  );
  assert.equal(po.cases.filter((c) => c.status === 'Matched').length, 0);
});

test('R02: batch, chosen reference and type label are kept with their headers, never as proof', async () => {
  const head = [
    'Date',
    'Reference',
    'Type',
    'Bank Ref',
    'Batch',
    'Description',
    'Amount',
  ];
  const result = await reconcile(
    [
      head,
      [
        '2026-07-14',
        'PAY-4410',
        'Vendor Payment',
        'TRF-88120',
        'B-77',
        'Transfer',
        '-1000.00',
      ],
      ['2026-07-10', 'INV-34900', 'Tax Invoice', '', 'B-78', 'Goods', '300.00'],
    ],
    [
      head,
      [
        '2026-07-14',
        'PAY-4410',
        'Payment',
        'TRF-88120',
        'B-77',
        'Transfer',
        '-1000.00',
      ],
      ['2026-07-10', 'INV-34900', 'Invoice', '', 'B-78', 'Goods', '300.00'],
    ],
    'Reference',
  );
  const pay = result.supplier.transactions.find((t) => t.amount < 0)!;
  assert.equal(pay.primaryReference, 'TRF-88120');
  assert.deepEqual(pay.retainedEvidence, [
    { field: 'mappedReference', header: 'Reference', value: 'PAY-4410' },
    { field: 'batch', header: 'Batch', value: 'B-77' },
    { field: 'documentTypeLabel', header: 'Type', value: 'Vendor Payment' },
  ]);
  const inv = result.supplier.transactions.find((t) => t.amount > 0)!;
  assert.deepEqual(inv.retainedEvidence, [
    { field: 'batch', header: 'Batch', value: 'B-78' },
    { field: 'documentTypeLabel', header: 'Type', value: 'Tax Invoice' },
  ]);
  // A label already equal to the classified type adds nothing.
  const ledgerInvoice = result.ledger.transactions.find((t) => t.amount > 0)!;
  assert.deepEqual(ledgerInvoice.retainedEvidence, [
    { field: 'batch', header: 'Batch', value: 'B-78' },
  ]);

  // Shared batches never join rows: two invoices on one batch with different
  // references and the other book's total stay apart.
  const batchOnly = await reconcile(
    [
      VOUCHERED,
      ['2026-07-09', 'INV-51001', 'Invoice', '', 'B-9', 'Goods', '500.00'],
      ['2026-07-09', 'INV-51002', 'Invoice', '', 'B-9', 'Goods', '250.00'],
    ],
    [
      VOUCHERED,
      ['2026-07-09', 'INV-51000', 'Invoice', '', 'B-9', 'Goods', '750.00'],
    ],
    'Reference',
  );
  assert.equal(batchOnly.cases.filter((c) => c.status === 'Matched').length, 0);
});

test('R02: retained evidence survives session restore and is exported beside the row', async () => {
  const head = ['Date', 'Reference', 'Type', 'Bank Ref', 'Batch', 'Amount'];
  const rows = [
    head,
    ['2026-07-14', 'PAY-4410', 'Payment', 'TRF-88120', 'B-77', '-1000.00'],
    ['2026-07-10', 'INV-34900', 'Tax Invoice', '', 'B-78', '300.00'],
  ];
  const files = [
    await readFile('supplier.csv', csv(rows), undefined, true),
    await readFile('ledger.csv', csv(rows), undefined, true),
  ] as [SourceFile, SourceFile];
  const mappings = files.map((file, i) => {
    const { mapping } = selectImportMapping(file, i ? 'ledger' : 'supplier');
    return { ...mapping, reference: 1 };
  }) as [Mapping, Mapping];
  const { result } = reconcileSupplierStatement({ files, mappings, scope });
  assert.equal(result.caseCounts.autoMatchedCases, 2);
  const review = { checked: false, name: '', notes: '' };
  const restored = await restoreSession(
    await saveSession({
      files,
      mappings,
      scope,
      decisions: [],
      rejected: [],
      events: [],
      review,
    }),
  );
  assert.deepEqual(
    restored.result.supplier.transactions.map((t) => t.retainedEvidence),
    result.supplier.transactions.map((t) => t.retainedEvidence),
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportWorkbook(result, files, review));
  const sheet = book.getWorksheet('Match Evidence')!;
  const headers = sheet.getRow(1).values as string[];
  const column = headers.indexOf('Retained Evidence');
  assert.ok(column > 0);
  const cells = sheet
    .getColumn(column)
    .values.slice(2)
    .map((v) => String(v ?? ''));
  assert.ok(
    cells.includes(
      'mappedReference (Reference): PAY-4410 | batch (Batch): B-77',
    ),
    cells.join('\n'),
  );
  assert.ok(
    cells.includes(
      'batch (Batch): B-78 | documentTypeLabel (Type): Tax Invoice',
    ),
    cells.join('\n'),
  );
});

const MISMATCH =
  'مصادر المقارنة وإعدادات قراءتها وأدوارها غير متطابقة في العدد أو غير صالحة.';

test('S01: sources, readings and roles that do not correspond are refused, never dropped', async () => {
  const rows = [
    ['Date', 'Reference', 'Amount'],
    ['2026-07-09', 'INV-1001', '1250.00'],
  ];
  const a = await readFile('supplier.csv', csv(rows), undefined, true);
  const b = await readFile('ledger.csv', csv(rows), undefined, true);
  const m = selectImportMapping(a, 'supplier').mapping;
  const loose = reconcileSupplierStatement as unknown as (
    input: unknown,
  ) => unknown;
  const loosePrepare = prepareVerifiedSources as unknown as (
    ...args: unknown[]
  ) => unknown;
  for (const [name, run] of [
    [
      'one file, two readings',
      () => loose({ files: [a], mappings: [m, m], scope }),
    ],
    [
      'three files',
      () => loose({ files: [a, b, a], mappings: [m, m, m], scope }),
    ],
    ['no files', () => loose({ files: [], mappings: [], scope })],
    [
      'a file that is not a reading',
      () => loose({ files: [a, {}], mappings: [m, m], scope }),
    ],
    [
      'fewer roles than sources',
      () => loosePrepare([a, b], [m, m], scope, ['supplier']),
    ],
    ['no roles', () => loosePrepare([a, b], [m, m], scope, [])],
    ['nothing at all', () => loosePrepare([], [], scope, [])],
    ['an unknown role', () => loosePrepare([a], [m], scope, ['bank'])],
  ] as [string, () => unknown][])
    assert.throws(run, (error: Error) => error.message === MISMATCH, name);
  // The shared boundary still takes one source with its own reading and role.
  assert.equal(
    (
      prepareVerifiedSources([a], [m], scope, ['ledger']) as {
        sources: unknown[];
      }
    ).sources.length,
    1,
  );
});

test('S06: formula-like and long references are exported as the text they are', async () => {
  const long = 'INV-' + '7'.repeat(180);
  const tricky = ['=HYPERLINK("x")', '+SUM(1)', '@INV-2001', '-INV-2002', long];
  const head = ['Date', 'Reference', 'Batch', 'Amount'];
  const rows = [
    head,
    ...tricky.map((ref, i) => [
      `2026-07-${String(10 + i).padStart(2, '0')}`,
      `"${ref.replaceAll('"', '""')}"`,
      `=B-${i}`,
      `${100 + i}.00`,
    ]),
  ];
  const files = [
    await readFile('supplier.csv', csv(rows), undefined, true),
    await readFile('ledger.csv', csv(rows), undefined, true),
  ] as [SourceFile, SourceFile];
  const mappings = files.map((file, i) => ({
    ...selectImportMapping(file, i ? 'ledger' : 'supplier').mapping,
    reference: 1,
  })) as [Mapping, Mapping];
  const { result } = reconcileSupplierStatement({ files, mappings, scope });
  const read = result.supplier.transactions.map((t) => t.reference);
  assert.deepEqual(read, tricky);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    await exportWorkbook(result, files, {
      checked: false,
      name: '',
      notes: '',
    }),
  );
  const sheet = book.getWorksheet('Match Evidence')!;
  const headers = sheet.getRow(1).values as string[];
  const refColumn = headers.indexOf('Primary Reference');
  const retained = headers.indexOf('Retained Evidence');
  const exported: string[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const cell = row.getCell(refColumn);
    // A stored text value, never a formula the spreadsheet would run.
    assert.equal(cell.type, ExcelJS.ValueType.String, String(cell.value));
    assert.equal(row.getCell(retained).type, ExcelJS.ValueType.String);
    exported.push(String(cell.value));
  });
  for (const ref of tricky)
    assert.equal(exported.filter((v) => v === ref).length, 2, ref);
});

test('S06: an export whose retained evidence was changed after comparing is refused', async () => {
  const head = ['Date', 'Reference', 'Batch', 'Amount'];
  const rows = [head, ['2026-07-10', 'INV-2001', 'B-1', '100.00']];
  const files = [
    await readFile('supplier.csv', csv(rows), undefined, true),
    await readFile('ledger.csv', csv(rows), undefined, true),
  ] as [SourceFile, SourceFile];
  const mappings = files.map((file, i) => ({
    ...selectImportMapping(file, i ? 'ledger' : 'supplier').mapping,
    reference: 1,
  })) as [Mapping, Mapping];
  const { result } = reconcileSupplierStatement({ files, mappings, scope });
  result.supplier.transactions[0].retainedEvidence![0].value = 'B-9';
  await assert.rejects(
    exportWorkbook(result, files, { checked: false, name: '', notes: '' }),
    /إعادة الحساب/,
  );
});

test('S08: the same file under another name, or overlapping exports, are not consumed twice', async () => {
  const head = ['Date', 'Reference', 'Type', 'Amount'];
  const one = ['2026-07-09', 'INV-8001', 'Invoice', '410.00'];
  const two = ['2026-07-10', 'INV-8002', 'Invoice', '220.00'];
  // Renaming the file changes nothing about what is read or matched.
  const bytes = csv([head, one, two]);
  const [x, y] = await Promise.all([
    readFile('july.csv', bytes, undefined, true),
    readFile('july (1).csv', bytes, undefined, true),
  ]);
  const shape = (r: Awaited<ReturnType<typeof reconcile>>) =>
    r.cases.map((c) => [c.status, c.matchingRule, c.supplierTotal]);
  const ledger = await readFile('ledger.csv', bytes, undefined, true);
  const run = (file: SourceFile) =>
    reconcileSupplierStatement({
      files: [file, ledger],
      mappings: [
        selectImportMapping(file, 'supplier').mapping,
        selectImportMapping(ledger, 'ledger').mapping,
      ],
      scope,
    }).result;
  assert.deepEqual(shape(run(x)), shape(run(y)));
  // Two overlapping exports pasted into one statement repeat INV-8001. The
  // repeated line is neither dropped as a duplicate nor matched twice.
  const overlapped = await reconcile([head, one, two, one], [head, one, two]);
  const repeated = overlapped.cases.filter((c) =>
    c.supplierMembers.some((t) => t.reference === 'INV-8001'),
  );
  assert.equal(
    repeated.flatMap((c) => c.supplierMembers).length,
    2,
    'both lines stay visible',
  );
  assert.ok(repeated.every((c) => c.status !== 'Matched'));
  assert.equal(statusOf(overlapped, 'INV-8002'), 'Matched');
});

test('compatibility: a session saved by the previous engine is refused, not silently re-decided', async () => {
  // T01, G08 and R01 change which rows match, so a 0.3.14 session restored
  // here would recompute different results under its saved decisions. The
  // session format is unchanged; only the engine version differs.
  assert.equal(ENGINE_VERSION, '0.3.15-experimental');
  const rows = [
    ['Date', 'Reference', 'Type', 'Amount'],
    ['2026-07-09', 'INV-34001', 'Tax Invoice', '1250.00'],
  ];
  const files = [
    await readFile('supplier.csv', csv(rows), undefined, true),
    await readFile('ledger.csv', csv(rows), undefined, true),
  ] as [SourceFile, SourceFile];
  const mappings = files.map(
    (file, i) => selectImportMapping(file, i ? 'ledger' : 'supplier').mapping,
  ) as [Mapping, Mapping];
  const bytes = await saveSession({
    files,
    mappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  });
  assert.equal(
    (await restoreSession(bytes)).result.caseCounts.autoMatchedCases,
    1,
  );
  const saved = JSON.parse(new TextDecoder().decode(bytes));
  saved.engine = '0.3.14-experimental';
  await assert.rejects(
    restoreSession(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /إصدار ملف الجلسة غير متوافق/,
  );
});
