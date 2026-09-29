import test from 'node:test';
import assert from 'node:assert/strict';
import * as scenarios from '../audit/hard-cases/scenarios.mjs';
import * as evaluator from '../audit/hard-cases/evaluate.mjs';

// The harness modules are plain JavaScript; give the calls used here types.
type Verdict = {
  verdict: string;
  findings: string[];
  counts: Record<string, number>;
  assistance: { kind: string; fields?: string[] }[];
  productReading: { wrongColumns: string[] }[];
};
const { hardManifest, buildHardCase } = scenarios as unknown as {
  hardManifest: (split: string, count: number) => unknown[];
  buildHardCase: (d: unknown) => {
    oracle: {
      contract: {
        kind: string;
        outcomes: string[];
        note?: string;
        rejection?: unknown;
      };
    };
  };
};
const { evaluateHardCase, loadHardEngine } = evaluator as unknown as {
  evaluateHardCase: (
    spec: unknown,
    engine: unknown,
    mode: string,
    options?: { assist: string },
  ) => Promise<Verdict>;
  loadHardEngine: (root: string) => Promise<{
    reconcileSupplierStatement: (input: unknown) => { result: Result };
  }>;
};

// The hard-case evaluator is itself under test: each case below feeds it a
// real engine result with one deliberate fault and requires the verdict that
// fault deserves. A measurement that cannot fail these proves nothing.
const engine = await loadHardEngine(new URL('..', import.meta.url).pathname);
const manifests: Record<string, unknown[]> = {
  validation: hardManifest('validation', 4000),
  development: hardManifest('development', 1200),
  holdout: hardManifest('holdout', 800),
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

// Fixed facts written independently of engine fields: each document number
// agrees across the sources, but the written generic references conflict.
// Every value must be retained; no pair may be approved. Two rows per source
// let the negative controls distinguish both the source and the source row.
const statedReferenceCase = () => ({
  id: 'evaluator-stated-reference-retention',
  template: 'evaluator-stated-reference-retention',
  family: 'reference',
  variant: 'conflicting-generic-references',
  split: 'evaluator-control',
  seed: 0,
  sources: ['supplier', 'ledger'].map((side, i) => ({
    side,
    name: `${side}-retention.csv`,
    format: 'csv',
    layout: {
      format: 'csv',
      language: i ? 'en' : 'ar',
      style: 'dot',
      fields: [
        'date',
        'reference',
        'documentReference',
        'kind',
        'description',
        'amount',
        'currency',
        'account',
      ],
    },
    metadata: {
      supplier: 'Retention Supplier',
      entity: 'Retention Buyer',
      account: 'AP-482',
      currency: 'SAR',
      decimals: 2,
      cutoff: '2026-07-31',
      periodStart: '2026-07-01',
      reportType: 'transactions',
      dateFormat: 'ymd',
      numberFormat: 'dot',
      opening: 0,
      closing: 30000,
      signEvidence: 'Positive amount increases the payable to the supplier',
    },
    rows: [1, 2].map((n) => ({
      key: `${i ? 'b' : 'a'}:${n}`,
      reference: `${i ? 'LR' : 'SR'}-100${n}`,
      documentReference: `INV-900${n}`,
      date: `2026-07-${12 + n}`,
      minor: n * 10000,
      kind: 'Invoice',
      description: 'Goods supplied',
      currency: 'SAR',
      account: 'AP-482',
    })),
  })),
  oracle: {
    expect: 'review',
    approved: [],
    targetKeys: ['a:1', 'a:2', 'b:1', 'b:2'],
    contract: { kind: 'refuse', outcomes: ['review'], signals: [] },
    requiredEvidence: ['reference'],
  },
});

test('evaluator: exact generic reference text and header count as retained under either supported representation', async () => {
  for (const assist of ['none', 'declared']) {
    const observed = tampered((r) => {
      for (const t of rows(r))
        assert.equal(
          t.retainedEvidence?.[0].field,
          assist === 'none' ? 'statedReference' : 'mappedReference',
        );
    });
    const record = await evaluateHardCase(
      statedReferenceCase(), observed, 'logical', { assist },
    );
    assert.equal(record.verdict, 'pass', assist);
    assert.equal(record.counts.evidenceRequired, 4);
    assert.equal(record.counts.evidenceLost, 0);
    assert.equal(record.counts.falseApprovals, 0);
  }
});

test('evaluator: an unselected reference needs its exact retained role, header and value', async () => {
  for (const [label, change] of [
    ['missing tuple', (t: Tx) => { delete t.retainedEvidence; }],
    ['wrong role', (t: Tx) => { t.retainedEvidence![0].field = 'batch'; }],
    ['wrong header', (t: Tx) => {
      t.retainedEvidence![0].header = 'Document No';
    }],
    ['changed text', (t: Tx) => { t.retainedEvidence![0].value += '0'; }],
  ] as const) {
    const record = await evaluateHardCase(
      statedReferenceCase(),
      tampered((r) => change(r.supplier.transactions[0])),
      'logical',
      { assist: 'none' },
    );
    assert.equal(record.verdict, 'fail-evidence-lost', label);
    assert.equal(record.counts.evidenceLost, 1, label);
    assert.ok(record.findings.includes('evidence lost: a:1 reference'), label);
  }
});

test('evaluator: retained reference evidence from another source or row does not count', async () => {
  for (const origin of ['other source', 'other row']) {
    const record = await evaluateHardCase(
      statedReferenceCase(),
      tampered((r) => {
        const target = r.supplier.transactions[0];
        const donor =
          origin === 'other source'
            ? r.ledger.transactions[0]
            : r.supplier.transactions[1];
        // Keep the target's header and role valid, so only the source-specific
        // value is wrong. Even the bare property is replaced to agree with it.
        target.retainedEvidence![0].value = donor.retainedEvidence![0].value;
        target.statedReference = donor.statedReference;
      }),
      'logical',
      { assist: 'none' },
    );
    assert.equal(record.verdict, 'fail-evidence-lost', origin);
    assert.equal(record.counts.evidenceLost, 1, origin);
    assert.ok(record.findings.includes('evidence lost: a:1 reference'), origin);
  }
});

test('evaluator: preserving unselected references never licenses an automatic match', async () => {
  const record = await evaluateHardCase(
    statedReferenceCase(),
    tampered((r) => {
      for (const c of r.cases) c.status = 'Matched';
    }),
    'logical',
    { assist: 'none' },
  );
  assert.equal(record.counts.evidenceLost, 0);
  assert.ok(record.counts.falseApprovals > 0);
  assert.equal(record.verdict, 'fail-unsafe');
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
        assert.ok(
          s.oracle.contract.rejection,
          `${(d as { id: string }).id} has no reason`,
        );
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

test('evaluator: a row read under its own document number is not a misread, any other value is', async () => {
  const s = spec('H03-document-no-vs-chosen-reference', 'agree', 'holdout');
  assert.equal(await verdict(s), 'pass');
  const record = await evaluateHardCase(
    s,
    tampered((r) => {
      const t = r.supplier.transactions[0];
      t.reference = `${t.reference}7`;
    }),
    'logical',
  );
  assert.equal(record.verdict, 'fail-unsafe');
  assert.ok(record.counts.silentMisreads > 0);
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
      (a) => a.kind === 'columns' && !!a.fields?.includes('reference'),
    ),
  );
  assert.deepEqual(unaided.productReading[0].wrongColumns, ['reference']);
});
