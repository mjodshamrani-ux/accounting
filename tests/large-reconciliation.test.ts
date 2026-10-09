import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, safeSum } from '../lib/reconciliation/core.ts';
import {
  sourcePair,
  oversizedRows,
  mixedRows,
  scope,
} from '../audit/large-statements/performance-engine.mjs';
import type { Comparison } from '../lib/reconciliation/types.ts';

const conserve = (r: Comparison) => {
  const source = [...r.supplier.transactions, ...r.ledger.transactions];
  const ids = r.cases.flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId));
  assert.deepEqual([...ids].sort(), source.map((t) => t.id).sort());
  assert.equal(new Set(ids).size, source.length);
  assert.equal(
    safeSum(r.cases.map((c) => c.supplierTotal)),
    safeSum(r.supplier.transactions.map((t) => t.amount)),
  );
  assert.equal(
    safeSum(r.cases.map((c) => c.ledgerTotal)),
    safeSum(r.ledger.transactions.map((t) => t.amount)),
  );
};

void test('group rejection preserves late edges and literal row IDs containing separators', () => {
  const a = [
    { amount: '-100', bank: 'BANK-A-1' },
    { amount: '-100', bank: 'BANK-B-2' },
  ];
  const b = [
    { amount: '-40', bank: 'BANK-A-1' },
    { amount: '-60', bank: 'BANK-A-1' },
    { amount: '-30', bank: 'BANK-B-2' },
    { amount: '-70', bank: 'BANK-B-2' },
  ];
  const [supplier, ledger] = sourcePair(a, b);
  assert.equal(compare(supplier, ledger, scope).caseCounts.autoMatchedCases, 2);
  const late = `${supplier.transactions[1].id}|${ledger.transactions[3].id}`;
  const rejected = compare(
    supplier,
    ledger,
    scope,
    [],
    [late, 'unknown|row', late],
  );
  assert.equal(rejected.caseCounts.autoMatchedCases, 1);
  assert.deepEqual(rejected.matches[0].supplierIds, [
    supplier.transactions[0].id,
  ]);
  conserve(rejected);
  supplier.transactions[0].id = 'S|1';
  supplier.transactions[1].id = 'S';
  ledger.transactions[0].id = 'L';
  ledger.transactions[2].id = '1|L';
  const aliased = compare(supplier, ledger, scope, [], ['S|1|L']);
  assert.equal(
    aliased.caseCounts.autoMatchedCases,
    0,
    'both valid literal splits retain the old edge semantics',
  );
  conserve(aliased);
});

void test('20,000 by 20,000 oversized payment group retains every row and the last rejected edge', () => {
  const rows = oversizedRows(20000);
  const [a, b] = sourcePair(rows, rows);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
  const plain = compare(a, b, scope);
  assert.equal(plain.caseCounts.autoMatchedCases, 0);
  assert.equal(plain.cases.length, 1);
  assert.match(plain.cases[0].evidence.join(' '), /حد الاعتماد الآلي/);
  const edge = `${a.transactions.at(-1)!.id}|${b.transactions.at(-1)!.id}`;
  const rejected = compare(a, b, scope, [], [edge]);
  assert.equal(rejected.cases.length, 1);
  assert.equal(rejected.caseCounts.autoMatchedCases, 0);
  assert.equal(rejected.cases[0].caseId, plain.cases[0].caseId);
  assert.deepEqual(
    rejected.cases[0].evidence.slice(0, -1),
    plain.cases[0].evidence,
  );
  assert.match(rejected.cases[0].evidence.at(-1)!, /رفض المراجع رابطًا/);
  assert.equal(rejected.cases[0].supplierTotal, (-100 * 20000 * 20001) / 2);
  assert.equal(rejected.cases[0].ledgerTotal, rejected.cases[0].supplierTotal);
  conserve(plain);
  conserve(rejected);
});

void test('20,000 interleaved approved, review and unmatched rows preserve ordered ambiguity and ledger diagnostics', () => {
  const [a, b] = sourcePair(...mixedRows(20000));
  const r = compare(a, b, scope);
  assert.equal(r.caseCounts.autoMatchedCases, 5000);
  assert.equal(r.caseCounts.needsReviewCases, 5000);
  assert.equal(r.supplierOnly.length, 10000);
  assert.equal(r.ledgerOnly.length, 10000);
  assert.deepEqual(
    r.ambiguousIds,
    [
      ...a.transactions.filter((_, i) => i % 4 !== 0),
      ...b.transactions.filter((_, i) => i % 4 !== 0),
    ].map((t) => t.id),
  );
  assert.equal(r.ambiguousIds.length, 30000);
  const duplicateIds = new Set(
    r.diagnostics
      .filter((d) => d.code === 'DUPLICATE_REFERENCE')
      .flatMap((d) => d.transactionIds),
  );
  for (const t of r.ledgerOnly) assert.ok(duplicateIds.has(t.id));
  assert.deepEqual(
    r.matches.map((m) => m.supplierId),
    a.transactions.filter((_, i) => i % 4 === 0).map((t) => t.id),
  );
  conserve(r);
});
