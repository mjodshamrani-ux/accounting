import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const scope: Scope = {
  supplier: 'Supplier',
  entity: 'Entity',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: true,
};
const headers = [
  'Date',
  'Document No',
  'Reference',
  'Amount',
  'Type',
  'Bank Reference',
  'Receipt No',
  'Voucher No',
  'PO',
  'Currency',
];
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  amount: 3,
  description: -1,
  currencyColumn: 9,
};
type Row = {
  doc?: string;
  chosen?: string;
  amount?: string;
  date?: string;
  type?: string;
  bank?: string;
  receipt?: string;
  voucher?: string;
  po?: string;
  currency?: string;
};
const row = (r: Row = {}) => [
  r.date ?? '2026-07-15',
  r.doc ?? 'INV-100',
  r.chosen ?? r.doc ?? 'INV-100',
  r.amount ?? '100.00',
  r.type ?? 'Invoice',
  r.bank ?? '',
  r.receipt ?? '',
  r.voucher ?? '',
  r.po ?? '',
  r.currency ?? 'SAR',
];
const file = (side: 'supplier' | 'ledger', rows: string[][]): SourceFile => ({
  name: `${side}.csv`,
  sha256: (side === 'supplier' ? 'a' : 'b').repeat(64),
  sheets: [
    { name: 'Data', rows: [headers, ...rows], formulaRows: [], hiddenRows: [] },
  ],
});
function input(a: Row[], b: Row[]) {
  return { a: file('supplier', a.map(row)), b: file('ledger', b.map(row)) };
}
function sources(files: ReturnType<typeof input>, m = mapping) {
  return [
    normalizeSource(files.a, m, scope, 'supplier'),
    normalizeSource(files.b, m, scope, 'ledger'),
  ] as const;
}
const auto = (r: ReturnType<typeof compare>) =>
  r.matches.filter((m) => m.kind === 'auto');
const conserve = (
  r: ReturnType<typeof compare>,
  files: ReturnType<typeof input>,
) => {
  for (const [s, f] of [
    [r.supplier, files.a],
    [r.ledger, files.b],
  ] as const) {
    assert.equal(
      s.transactions.length +
        s.excluded.length +
        s.errors.filter((e) => e.row > 0).length,
      f.sheets[0].rows.length,
    );
    assert.equal(
      new Set(
        [
          ...s.transactions,
          ...s.excluded,
          ...s.errors.filter((e) => e.row > 0),
        ].map((t) => t.row),
      ).size,
      f.sheets[0].rows.length,
    );
    assert.ok(
      s.transactions.every(
        (t) =>
          Number.isSafeInteger(t.amount) && /^2026-\d\d-\d\d$/.test(t.date),
      ),
    );
  }
  assert.deepEqual(
    r.cases.flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId)).sort(),
    [...r.supplier.transactions, ...r.ledger.transactions]
      .map((t) => t.id)
      .sort(),
  );
  assert.equal(r.balanceComparable, false);
  assert.equal(r.bridge, null);
};

test('safe unrelated bad amounts and dates preserve proven pairs and every erroneous source row', () => {
  for (const side of ['a', 'b'] as const)
    for (const defect of ['amount', 'date'] as const) {
      const files = input([{}], [{}]);
      files[side].sheets[0].rows.push(
        row({
          doc: 'INV-900',
          [defect]: defect === 'amount' ? 'bad' : '2026-02-30',
        }),
      );
      files[side].sheets[0].rowPages = { '3': 70 };
      const r = compare(...sources(files), scope);
      const failed = (side === 'a' ? r.supplier : r.ledger).errors;
      assert.equal(failed.length, 1);
      assert.equal(failed[0].sourcePage, 70);
      assert.equal(failed[0].isolation?.rule, 'SAFE_REFERENCE_ENVELOPE_V1');
      assert.ok(failed[0].isolation?.keys.includes('identity:INV900'));
      assert.equal(auto(r).length, 1);
      assert.equal(r.supplier.transactions[0].amount, 10000);
      conserve(r, files);
    }
});

test('an unread same-reference or normalized-collision row blocks that bucket without blocking a disjoint pair', () => {
  for (const doc of ['INV-100', 'inv/100']) {
    const files = input(
      [{}, { doc: 'INV-200' }, { doc, amount: 'bad' }],
      [{}, { doc: 'INV-200' }],
    );
    const r = compare(...sources(files), scope);
    assert.deepEqual(
      auto(r).map((m) => m.supplierId),
      ['supplier:0:3'],
    );
    conserve(r, files);
  }
});

test('a displaced reference in a financial cell blocks its original competitor and preserves a disjoint pair', () => {
  for (const field of ['date', 'amount'] as const) {
    const files = input(
      [{}, { doc: 'INV-200' }, { doc: '1234', [field]: 'INV-100' }],
      [{}, { doc: 'INV-200' }],
    );
    const r = compare(...sources(files), scope);
    assert.equal(r.supplier.errors.length, 1);
    assert.equal(r.supplier.errors[0].row, 4);
    assert.ok(r.supplier.errors[0].isolation?.keys.includes('identity:INV100'));
    assert.deepEqual(
      auto(r).map((m) => m.supplierId),
      ['supplier:0:3'],
    );
    assert.equal(
      files.a.sheets[0].rows[3][field === 'date' ? 0 : 3],
      'INV-100',
    );
    conserve(r, files);
  }
});

test('a mixed alphanumeric bad amount is isolated by source evidence and blocks only when its literal token is a competing identity', () => {
  for (const competing of [false, true]) {
    const good = [{}, { doc: competing ? '12x.34' : 'INV-200' }];
    assert.equal(auto(compare(...sources(input(good, good)), scope)).length, 2);
    const files = input([...good, { doc: 'INV-900', amount: '12x.34' }], good);
    const r = compare(...sources(files), scope);
    assert.equal(r.supplier.errors.length, 1);
    assert.equal(r.supplier.errors[0].row, 4);
    assert.ok(r.supplier.errors[0].isolation?.keys.includes('identity:12X.34'));
    assert.deepEqual(
      auto(r).map((m) => m.supplierId),
      competing ? ['supplier:0:2'] : ['supplier:0:2', 'supplier:0:3'],
    );
    assert.equal(files.a.sheets[0].rows[3][3], '12x.34');
    assert.deepEqual(
      r.supplier.transactions.map((t) => t.amount),
      [10000, 10000],
    );
    conserve(r, files);
  }
});

test('unparsed literal cells are negative competitor evidence for alphabetic payment references, never repaired transaction facts', () => {
  const payment = (amount: string) => ({
    doc: 'PAY-101',
    type: 'Payment',
    bank: 'Z',
    amount,
  });
  const a = [payment('-40.00'), payment('-60.00'), {}];
  const b = [payment('-25.00'), payment('-75.00'), {}];
  assert.equal(auto(compare(...sources(input(a, b)), scope)).length, 2);
  const files = input([...a, { doc: 'INV-900', amount: 'Z' }], b);
  const r = compare(...sources(files), scope);
  const failed = r.supplier.errors[0];
  assert.equal(failed.isolation?.rule, 'SAFE_REFERENCE_ENVELOPE_V1');
  assert.ok(failed.isolation?.keys.includes('identity:Z'));
  assert.deepEqual(
    auto(r).map((m) => m.supplierId),
    ['supplier:0:4'],
  );
  assert.deepEqual(
    r.supplier.transactions.map((t) => t.amount),
    [-4000, -6000, 10000],
  );
  assert.equal(files.a.sheets[0].rows[4][3], 'Z');
  conserve(r, files);
});

test('every supported secondary reference is blocking evidence even when the bad row has a different primary document', () => {
  for (const field of ['chosen', 'bank', 'receipt', 'voucher', 'po'] as const) {
    const shared = { [field]: 'LINK-501' };
    const files = input(
      [{ ...shared }, { doc: 'INV-900', amount: 'bad', ...shared }],
      [{ ...shared }],
    );
    const r = compare(...sources(files), scope);
    assert.equal(
      r.supplier.errors[0].isolation?.rule,
      'SAFE_REFERENCE_ENVELOPE_V1',
      field,
    );
    assert.equal(auto(r).length, 0, field);
    conserve(r, files);
  }
});

test('unselected stated references and selected helper values both propagate taint without acquiring positive authority', () => {
  const files = input(
    [
      { chosen: 'STATED-44' },
      { doc: 'INV-900', chosen: 'STATED-44', amount: 'bad' },
    ],
    [{ chosen: 'STATED-44' }],
  );
  for (const f of [files.a, files.b]) {
    f.sheets[0].rows[0] = [...headers, 'Chosen ID'];
    f.sheets[0].rows.slice(1).forEach((r, i) => r.push(`LOCAL-${i + 1}`));
  }
  const r = compare(...sources(files, { ...mapping, reference: 10 }), scope);
  assert.equal(
    r.supplier.errors[0].isolation?.rule,
    'SAFE_REFERENCE_ENVELOPE_V1',
  );
  assert.equal(auto(r).length, 0);
  conserve(r, files);
});

test('taint follows transitive original memberships even after a bridge row is manually used or rejected', () => {
  const files = input(
    [
      { doc: 'INV-100', receipt: 'R-SECOND' },
      { doc: 'INV-200', bank: 'B-FIRST', receipt: 'R-SECOND' },
      { doc: 'INV-900', bank: 'B-FIRST', amount: 'bad' },
      { doc: 'INV-300' },
    ],
    [
      { doc: 'INV-100', receipt: 'R-SECOND' },
      { doc: 'INV-200', bank: 'B-FIRST', receipt: 'R-SECOND' },
      { doc: 'INV-300' },
    ],
  );
  for (const manual of [false, true]) {
    const r = compare(
      ...sources(files),
      scope,
      manual
        ? [
            {
              supplierId: 'supplier:0:3',
              ledgerId: 'ledger:0:3',
              note: 'Reviewed this pair',
            },
          ]
        : [],
      manual ? [] : ['supplier:0:3|ledger:0:3'],
    );
    assert.deepEqual(
      auto(r).map((m) => m.supplierId),
      ['supplier:0:5'],
    );
    conserve(r, files);
  }
});

test('unknown, structurally damaged, hidden or unsafe reference envelopes remain wildcard blockers', () => {
  const damage = [
    (f: SourceFile) => {
      f.sheets[0].rowIssues = { '3': ['Uncertain row alignment'] };
    },
    (f: SourceFile) => {
      f.sheets[0].hiddenRows = [3];
    },
    (f: SourceFile) => {
      f.sheets[0].referenceIssues = { '3:2': ['Reference display mismatch'] };
    },
    (f: SourceFile) => {
      f.sheets[0].cellIssues = { '1:2': ['Unsafe document header'] };
    },
    (f: SourceFile) => {
      f.sheets[0].rows[2][4] = 'Unknown issuer role';
    },
    (f: SourceFile) => {
      f.sheets[0].rows[2][1] = '';
      f.sheets[0].rows[2][2] = '';
    },
    (f: SourceFile) => {
      f.sheets[0].rows[2][2] = '=1+1';
    },
    (f: SourceFile) => {
      f.sheets[0].rows[2].push('extra cell');
    },
    (f: SourceFile) => {
      f.sheets[0].formulaRows = [3];
    },
  ];
  for (const apply of damage) {
    const files = input([{}, { doc: 'INV-900', amount: 'bad' }], [{}]);
    apply(files.a);
    const r = compare(...sources(files), scope);
    assert.equal(r.supplier.errors[0].isolation, undefined);
    assert.equal(auto(r).length, 0);
    conserve(r, files);
  }
});

test('a selected generic helper alone cannot isolate a failed row, while a precise amount-cell issue can', () => {
  const files = input([{}, { doc: 'INV-900' }], [{}]);
  files.a.sheets[0].cellIssues = {
    '3:4': ['Formula amount is not a trusted value'],
  };
  const r = compare(...sources(files), scope);
  assert.equal(
    r.supplier.errors[0].isolation?.rule,
    'SAFE_REFERENCE_ENVELOPE_V1',
  );
  assert.equal(auto(r).length, 1);
  conserve(r, files);
  const helper = input(
    [{}, { doc: '', chosen: 'ROW-900', amount: 'bad' }],
    [{}],
  );
  helper.a.sheets[0].rows[0] = [...headers];
  helper.a.sheets[0].rows[0][2] = 'Helper';
  assert.equal(sources(helper)[0].errors[0].isolation, undefined);
  assert.equal(auto(compare(...sources(helper), scope)).length, 0);
});

test('bad-money rows cannot hide a second supplier, entity, currency or generic account', () => {
  for (const label of ['Supplier Code', 'Entity', 'Account', 'Currency']) {
    const files = input([{}, { doc: 'INV-900', amount: 'bad' }], [{}]);
    if (label === 'Currency') files.a.sheets[0].rows[2][9] = 'USD';
    else
      for (const f of [files.a, files.b]) {
        f.sheets[0].rows[0] = [...headers, label];
        f.sheets[0].rows
          .slice(1)
          .forEach((r, i) =>
            r.push(i === 1 ? 'OTHER' : label === 'Account' ? 'AP' : 'SAME'),
          );
      }
    const normalized = sources(files);
    assert.ok(
      normalized[0].errors.some((e) => e.row === 0),
      label,
    );
    const r = compare(...normalized, scope);
    assert.equal(auto(r).length, 0, label);
    conserve(r, files);
  }
});

test('invalid entered balances block arithmetic but preserve independent automatic and documented manual pairs', () => {
  const files = input([{}], [{}]);
  const normalized = sources(files, {
    ...mapping,
    opening: 'bad',
    periodStart: '2026-07-01',
  });
  assert.ok(
    normalized.every(
      (s) => s.errors.length === 1 && s.errors[0].scope === 'balance',
    ),
  );
  assert.equal(auto(compare(...normalized, scope)).length, 1);
  const manual = compare(...normalized, scope, [
    {
      supplierId: 'supplier:0:2',
      ledgerId: 'ledger:0:2',
      note: 'Reviewed pair',
    },
  ]);
  assert.equal(manual.matches[0].kind, 'manual');
  conserve(manual, files);
  normalized[0].errors.push({
    row: 0,
    message: 'Unknown source amount semantics',
  });
  assert.equal(auto(compare(...normalized, scope)).length, 0);
  assert.throws(() =>
    compare(...normalized, scope, [
      {
        supplierId: 'supplier:0:2',
        ledgerId: 'ledger:0:2',
        note: 'Cannot bypass',
      },
    ]),
  );
});

test('disjoint invoice groups and repeated-document pairs remain provable, but a failed bucket member blocks its whole proof', () => {
  const group = input(
    [
      { doc: 'INV-GROUP1', po: 'PO-7' },
      { doc: 'INV-900', amount: 'bad' },
    ],
    [
      { doc: 'INV-GROUP1', po: 'PO-7', amount: '40' },
      { doc: 'INV-GROUP1', po: 'PO-7', amount: '60' },
    ],
  );
  const g = compare(...sources(group), scope);
  assert.equal(
    g.cases.filter(
      (c) => c.status === 'Matched' && c.classification === 'EXACT_1_TO_MANY',
    ).length,
    1,
  );
  conserve(g, group);
  const pair = input(
    [
      { doc: 'INV-REPEAT1', chosen: 'LINE-1' },
      { doc: 'INV-REPEAT1', chosen: 'LINE-2' },
      { doc: 'INV-900', amount: 'bad' },
    ],
    [
      { doc: 'INV-REPEAT1', chosen: 'LINE-2' },
      { doc: 'INV-REPEAT1', chosen: 'LINE-1' },
    ],
  );
  const p = compare(...sources(pair), scope);
  assert.equal(auto(p).length, 2);
  conserve(p, pair);
  pair.a.sheets[0].rows[3][1] = 'INV-REPEAT1';
  assert.equal(auto(compare(...sources(pair), scope)).length, 0);
});

test('whole payment groups remain complete only outside failed-row bank/receipt memberships', () => {
  const payment = (bank: string, amount: string): Row => ({
    type: 'Payment',
    doc: `PAY-${bank}`,
    bank,
    amount,
  });
  const files = input(
    [
      payment('B-100', '-40'),
      payment('B-100', '-60'),
      payment('B-200', '-25'),
      payment('B-200', '-75'),
      { doc: 'INV-900', amount: 'bad' },
    ],
    [
      payment('B-100', '-30'),
      payment('B-100', '-70'),
      payment('B-200', '-35'),
      payment('B-200', '-65'),
    ],
  );
  const r = compare(...sources(files), scope);
  assert.equal(
    r.cases.filter(
      (c) =>
        c.status === 'Matched' && c.classification === 'EXACT_MANY_TO_MANY',
    ).length,
    2,
  );
  conserve(r, files);
  files.a.sheets[0].rows[5][5] = 'B-100';
  const tainted = compare(...sources(files), scope);
  const matched = tainted.cases.filter((c) => c.status === 'Matched');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].supplierMembers[0].bankReference, 'B-200');
  conserve(tainted, files);
});

test('legacy direct-source errors without a valid envelope remain conservative', () => {
  const files = input([{}], [{}]);
  for (const isolation of [
    undefined,
    { rule: 'SAFE_REFERENCE_ENVELOPE_V1', keys: [] } as const,
  ]) {
    const normalized = sources(files);
    normalized[0].errors.push({
      row: 99,
      message: 'Unread original row',
      ...(isolation ? { isolation: { ...isolation, keys: [] } } : {}),
    });
    assert.equal(auto(compare(...normalized, scope)).length, 0);
  }
});

test('duplicate direct-source IDs are refused even when their identity components have different taint', () => {
  const files = input(
    [{}, { doc: 'INV-200' }, { doc: 'INV-900', amount: 'bad' }],
    [{}, { doc: 'INV-200' }],
  );
  const normalized = sources(files);
  normalized[0].transactions[1].id = normalized[0].transactions[0].id;
  assert.throws(() => compare(...normalized, scope), /معرف صف المصدر مكرر/);
});
