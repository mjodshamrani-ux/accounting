import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error: plain ES module without type declarations
import { hardManifest, buildHardCase } from '../audit/hard-cases/scenarios.mjs';
// @ts-expect-error: plain ES module without type declarations
import {
  evaluateHardCase,
  loadHardEngine,
} from '../audit/hard-cases/evaluate.mjs';

// The hard-case evaluator is itself under test: each case below feeds it a
// real engine result with one deliberate fault and requires the verdict that
// fault deserves. A measurement that cannot fail these proves nothing.
const engine = await loadHardEngine(new URL('..', import.meta.url).pathname);
const manifests: Record<string, unknown[]> = {
  validation: hardManifest('validation', 4000),
  development: hardManifest('development', 1200),
};
const spec = (template: string, variant: string, split = 'validation') =>
  buildHardCase(
    (manifests[split] as { template: string; variant: string }[]).find(
      (d: { template: string; variant: string }) =>
        d.template === template && d.variant === variant,
    ),
  );
type Result = {
  supplier: { transactions: Tx[] };
  ledger: { transactions: Tx[] };
  cases: {
    status: string;
    evidence: string[];
    supplierMembers: Tx[];
    ledgerMembers: Tx[];
  }[];
};
type Tx = Record<string, unknown> & {
  amount: number;
  reference: string;
  retainedEvidence?: { field: string; header: string; value: string }[];
  referenceEvidenceIssues?: string[];
};
/** The engine with its result changed after the real comparison. */
const tampered = (change: (result: Result) => void) => ({
  ...engine,
  reconcileSupplierStatement: (input: unknown) => {
    const out = engine.reconcileSupplierStatement(input);
    change(out.result);
    return out;
  },
});
/** The engine failing inside the comparison. */
const throwing = (error: unknown) => ({
  ...engine,
  reconcileSupplierStatement: () => {
    throw error;
  },
});
const verdict = async (s: unknown, e = engine) =>
  (await evaluateHardCase(s, e, 'logical')).verdict;
const rows = (r: Result) => [
  ...r.supplier.transactions,
  ...r.ledger.transactions,
];

test('evaluator: the untouched engine passes the cases used below', async () => {
  for (const [t, v] of [
    ['R02-batch-kept', 'batch'],
    ['R01-voucher-and-reference', 'voucher-differs'],
    ['F09-missing-amount', 'no-amount-column'],
    ['T06-type-conflict', 'payment-labelled-invoice'],
    ['R04-leading-zeros', 'zeros'],
    ['G06-missing-part', 'identity'],
    ['G01-payment-1n', 'identity'],
  ])
    assert.equal(await verdict(spec(t, v)), 'pass', `${t} ${v}`);
});

test('evaluator: losing a required piece of evidence fails the case', async () => {
  const s = spec('R02-batch-kept', 'batch');
  const lost = tampered((r) => {
    for (const t of rows(r)) delete t.retainedEvidence;
  });
  const record = await evaluateHardCase(s, lost, 'logical');
  assert.equal(record.verdict, 'fail-evidence-lost');
  assert.ok(record.findings.some((f: string) => /batch/.test(f)));
});

test('evaluator: the value in a field of another role does not count as kept', async () => {
  // The voucher number moved into the order field: the value is still on
  // the row, but not as a voucher.
  const moved = tampered((r) => {
    for (const t of rows(r))
      if (t.voucherReference) {
        t.poReference = t.voucherReference;
        delete t.voucherReference;
      }
  });
  assert.equal(
    await verdict(spec('R01-voucher-and-reference', 'voucher-differs'), moved),
    'fail-evidence-lost',
  );
  // The batch kept under another role, or under the wrong header.
  for (const change of [
    (e: { field: string }) => (e.field = 'mappedReference'),
    (e: { header: string }) => (e.header = 'Reference'),
  ]) {
    const relabelled = tampered((r) => {
      for (const t of rows(r))
        for (const e of t.retainedEvidence ?? [])
          if (e.field === 'batch') change(e);
    });
    assert.equal(
      await verdict(spec('R02-batch-kept', 'batch'), relabelled),
      'fail-evidence-lost',
    );
  }
});

test('evaluator: an unexpected internal error is not a successful refusal', async () => {
  const invalid = spec('F09-missing-amount', 'no-amount-column');
  for (const error of [
    new Error('unexpected failure inside the engine'),
    new TypeError("Cannot read properties of undefined (reading 'x')"),
  ]) {
    const record = await evaluateHardCase(invalid, throwing(error), 'logical');
    assert.equal(record.verdict, 'fail-crash', error.message);
  }
  // A known product refusal where none is expected is an unnecessary stop.
  assert.equal(
    await verdict(
      spec('G01-payment-1n', 'identity'),
      throwing(new Error('حدد أعمدة التاريخ والمبلغ أو المدين والدائن')),
    ),
    'fail-unnecessary-stop',
  );
});

test('evaluator: every invalid case names its own rejection, and another reason fails', async () => {
  for (const sp of ['development', 'validation', 'final', 'final-b'])
    for (const d of hardManifest(sp, 400)) {
      const s = buildHardCase(d);
      if (['invalid', 'external'].includes(s.oracle.contract.kind))
        assert.ok(s.oracle.contract.rejection, `${d.id} has no reason`);
    }
  const wrong = throwing(new Error('ملف XLSX غير صالح أو مشفر'));
  assert.equal(
    await verdict(spec('F09-missing-amount', 'no-amount-column'), wrong),
    'fail-wrong-reason',
  );
});

test('evaluator: Needs Review passes as Unmatched only where the contract allows both', async () => {
  const conflict = spec('T06-type-conflict', 'payment-labelled-invoice');
  assert.deepEqual(conflict.oracle.contract.outcomes, ['review']);
  const demoted = tampered((r) => {
    for (const c of r.cases)
      if (c.status === 'Needs Review') c.status = 'Unmatched';
  });
  assert.equal(await verdict(conflict, demoted), 'fail-outcome');
  // A contract that allows both, written before any run, accepts either.
  const zeros = spec('R04-leading-zeros', 'zeros');
  assert.deepEqual(zeros.oracle.contract.outcomes, ['unmatched', 'review']);
  assert.ok(zeros.oracle.contract.note);
  assert.equal(await verdict(zeros), 'pass');
});

test('evaluator: a required diagnostic is part of the verdict', async () => {
  const silent = tampered((r) => {
    for (const c of r.cases)
      c.evidence = c.evidence.filter((e) => !/مجموع الطرفين مختلف/.test(e));
  });
  assert.equal(
    await verdict(spec('G06-missing-part', 'identity'), silent),
    'fail-signal-missing',
  );
});

test('evaluator: a reference warning does not hide a wrong amount or date', async () => {
  for (const change of [
    (t: Tx) => (t.amount += 1),
    (t: Tx) => (t.date = '2026-07-28'),
  ]) {
    const misread = tampered((r) => {
      const t = r.supplier.transactions[0];
      change(t);
      t.referenceEvidenceIssues = ['دليل غير مقروء بثقة: reference، صف 7'];
    });
    const record = await evaluateHardCase(
      spec('R02-batch-kept', 'batch'),
      misread,
      'logical',
    );
    assert.equal(record.verdict, 'fail-unsafe');
    assert.ok(record.counts.silentMisreads > 0);
    assert.ok(record.findings.some((f: string) => /does not excuse/.test(f)));
  }
});

test('evaluator: unaided and declared runs record assistance separately', async () => {
  // English development layout: the product leaves the reference column
  // open when a Reference and a Voucher No column both exist.
  const s = spec('R01-voucher-and-reference', 'voucher-differs', 'development');
  const unaided = await evaluateHardCase(s, engine, 'logical', {
    assist: 'none',
  });
  const declared = await evaluateHardCase(s, engine, 'logical', {
    assist: 'declared',
  });
  assert.deepEqual(unaided.assistance, []);
  assert.ok(
    declared.assistance.some(
      (a: { kind: string; fields: string[] }) =>
        a.kind === 'columns' && a.fields.includes('reference'),
    ),
  );
  assert.deepEqual(unaided.productReading[0].wrongColumns, ['reference']);
});
