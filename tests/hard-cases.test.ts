import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { reconcileSupplierStatement } from '../lib/reconciliation/supplier-reconciliation.ts';
import type { Scope } from '../lib/reconciliation/types.ts';

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
 * read, select the columns, then the shared recompute. */
async function reconcile(supplier: string[][], ledger: string[][]) {
  const a = await readFile('supplier.csv', csv(supplier), undefined, true);
  const b = await readFile('ledger.csv', csv(ledger), undefined, true);
  return reconcileSupplierStatement({
    files: [a, b],
    mappings: [
      selectImportMapping(a, 'supplier').mapping,
      selectImportMapping(b, 'ledger').mapping,
    ],
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
