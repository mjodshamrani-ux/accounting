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
