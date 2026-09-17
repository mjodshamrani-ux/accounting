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
  supplier: 'Vendor',
  entity: 'Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-08-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: true,
};
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  opening: '0',
  closing: '100',
  periodStart: '2026-08-01',
};
function file(
  headers: string[] = ['Date', 'Invoice No', 'Amount'],
  rows: string[][] = [['2026-08-20', 'INV-500', '100']],
  metadata: string[][] = [],
): SourceFile {
  return {
    name: 'synthetic-accounting.csv',
    sheets: [
      {
        name: 'Data',
        rows: [...metadata, headers, ...rows],
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
}
function source(
  f: SourceFile,
  side: 'supplier' | 'ledger',
  patch: Partial<Mapping> = {},
) {
  return normalizeSource(f, { ...mapping, ...patch }, scope, side);
}
function noApproval(
  a: ReturnType<typeof source>,
  b: ReturnType<typeof source>,
) {
  const result = compare(a, b, scope);
  assert.equal(result.matches.length, 0);
  assert.equal(result.bridge, null);
  assert.equal(result.balanceComparable, false);
  return result;
}

test('045 original document value cannot be compared as open-item outstanding even when numbers coincide', () => {
  for (const header of [
    'Original Amount',
    'Invoice Amount',
    'أصل مبلغ المستند',
    'مبلغ الفاتورة',
  ]) {
    const a = source(file(['Date', 'Invoice No', header]), 'supplier', {
      reportType: 'open-items',
    });
    const b = source(file(['Date', 'Invoice No', 'Outstanding']), 'ledger', {
      reportType: 'open-items',
    });
    assert.ok(
      a.errors.some((e) => e.row === 0),
      header,
    );
    noApproval(a, b);
  }
});
test('045 running balance, paid amount and aging buckets cannot masquerade as movement values', () => {
  for (const header of [
    'Running Balance',
    'الرصيد الجاري',
    'Paid Amount',
    'المبلغ المدفوع',
    '0-30 days',
    '31–60',
  ]) {
    const a = source(file(['Date', 'Invoice No', header]), 'supplier');
    assert.ok(
      a.errors.some((e) => e.row === 0),
      header,
    );
    noApproval(a, source(file(), 'ledger'));
  }
});
test('045 explicit remaining values require an open-items report and never become period movements', () => {
  for (const header of [
    'Outstanding',
    'Remaining Amount',
    'Balance Due',
    'المتبقي',
  ]) {
    const a = source(file(['Date', 'Invoice No', header]), 'supplier');
    assert.ok(a.errors.length, header);
    noApproval(a, source(file(), 'ledger'));
  }
});
test('045 supported original transaction values and remaining open items continue to auto-match', () => {
  for (const [header, reportType] of [
    ['Invoice Amount', 'transactions'],
    ['Outstanding', 'open-items'],
    ['Amount', 'open-items'],
  ] as const) {
    const a = source(file(['Date', 'Invoice No', header]), 'supplier', {
      reportType,
    });
    const b = source(file(['Date', 'Invoice No', header]), 'ledger', {
      reportType,
    });
    assert.deepEqual(a.errors, []);
    assert.equal(compare(a, b, scope).matches.length, 1);
  }
});
test('045 supplier and legal entity conflicts in explicit same-role metadata block automatic and manual comparison', () => {
  for (const role of ['Supplier', 'Legal Entity']) {
    const a = source(
      file(undefined, undefined, [[role, 'Organization A']]),
      'supplier',
      { header: 1 },
    );
    const b = source(
      file(undefined, undefined, [[role, 'Organization B']]),
      'ledger',
      { header: 1 },
    );
    for (const decisions of [
      [],
      [
        {
          supplierId: a.transactions[0].id,
          ledgerId: b.transactions[0].id,
          note: 'manual',
        },
      ],
    ])
      assert.throws(
        () => compare(a, b, scope, decisions),
        /نطاق|هوية|المورد|الجهة/,
      );
  }
});
test('045 different account roles are not falsely equated across supplier and AP systems', () => {
  const a = source(
    file(undefined, undefined, [['Customer Account', 'C-407']]),
    'supplier',
    { header: 1 },
  );
  const b = source(
    file(undefined, undefined, [['Supplier Code', 'V-928']]),
    'ledger',
    { header: 1 },
  );
  assert.equal(compare(a, b, scope).matches.length, 1);
});
test('045 mixed supplier, entity or account columns stop the affected comparison without dropping either row', () => {
  for (const heading of [
    'Supplier',
    'Legal Entity',
    'Supplier Code',
    'Customer Account',
  ]) {
    const rows = [
      ['2026-08-20', 'INV-500', '40', 'A'],
      ['2026-08-21', 'INV-501', '60', 'B'],
    ];
    const a = source(
      file(['Date', 'Invoice No', 'Amount', heading], rows),
      'supplier',
    );
    const b = source(
      file(['Date', 'Invoice No', 'Amount', heading], rows),
      'ledger',
    );
    assert.equal(a.transactions.length, 2);
    assert.ok(
      a.errors.some((e) => e.row === 0),
      heading,
    );
    noApproval(a, b);
  }
});
test('045 explicit single-role row identity must agree between the two sources', () => {
  const a = source(
    file(
      ['Date', 'Invoice No', 'Amount', 'Supplier'],
      [['2026-08-20', 'INV-500', '100', 'Vendor A']],
    ),
    'supplier',
  );
  const b = source(
    file(
      ['Date', 'Invoice No', 'Amount', 'Supplier'],
      [['2026-08-20', 'INV-500', '100', 'Vendor B']],
    ),
    'ledger',
  );
  assert.throws(() => compare(a, b, scope), /نطاق|هوية|المورد/);
});
test('045 explicit currency column cannot be ignored by leaving it unmapped', () => {
  const a = source(
    file(
      ['Date', 'Invoice No', 'Amount', 'Currency'],
      [['2026-08-20', 'INV-500', '100', 'USD']],
    ),
    'supplier',
  );
  assert.ok(a.errors.length);
  noApproval(a, source(file(), 'ledger'));
});
test('045 open-item snapshots dated after the requested cutoff cannot reconstruct historical outstanding', () => {
  const a = source(
    file(['Date', 'Invoice No', 'Outstanding'], undefined, [
      ['Period', '2026-09-01 to 2026-09-30'],
    ]),
    'supplier',
    { header: 1, reportType: 'open-items' },
  );
  const b = source(file(['Date', 'Invoice No', 'Outstanding']), 'ledger', {
    reportType: 'open-items',
  });
  assert.ok(a.errors.some((e) => e.row === 0));
  noApproval(a, b);
});
test('045 a malformed or contradictory declared period cannot certify the arithmetic bridge', () => {
  for (const metadata of [
    [['Period', '2026-08-99 to 2026-08-31']],
    [
      ['Period', '2026-08-01 to 2026-08-31'],
      ['Period', '2026-07-01 to 2026-07-31'],
    ],
  ]) {
    const a = source(file(undefined, undefined, metadata), 'supplier', {
      header: metadata.length,
    });
    const b = source(file(), 'ledger');
    const result = compare(a, b, scope);
    assert.equal(result.balanceComparable, false);
    assert.equal(result.bridge, null);
  }
});
test('045 a clean declared snapshot at cutoff remains supported', () => {
  const f = file(['Date', 'Invoice No', 'Outstanding'], undefined, [
    ['Period', '2026-08-01 to 2026-08-31'],
  ]);
  const a = source(f, 'supplier', { header: 1, reportType: 'open-items' });
  const b = source(f, 'ledger', { header: 1, reportType: 'open-items' });
  const result = compare(a, b, scope);
  assert.equal(result.matches.length, 1);
  assert.equal(result.bridge?.residual, 0);
});
test('045 a systemic parsing/semantic failure cannot be bypassed by a manual match', () => {
  const a = source(file(['Date', 'Invoice No', 'Running Balance']), 'supplier');
  const b = source(file(), 'ledger');
  assert.throws(() =>
    compare(a, b, scope, [
      {
        supplierId: a.transactions[0].id,
        ledgerId: b.transactions[0].id,
        note: 'accept',
      },
    ]),
  );
});
test('045 declared transaction period constrains inclusion before the balance equation is checked', () => {
  const f = file(
    undefined,
    [
      ['2026-07-20', 'INV-490', '40'],
      ['2026-08-20', 'INV-500', '60'],
    ],
    [['Period', '2026-08-01 to 2026-08-31']],
  );
  const a = source(f, 'supplier', { header: 1, periodStart: '' });
  assert.equal(a.total, 6000);
  assert.ok(
    a.excluded.some((row) => row.row === 3 && /قبل بداية/.test(row.reason)),
  );
  assert.equal(a.balanceArithmeticStatus, 'BALANCE_ARITHMETIC_FAILED');
  const b = source(f, 'ledger', { header: 1, periodStart: '' });
  assert.equal(compare(a, b, scope).bridge, null);
});
test('045 an opening balance from a different declared period cannot be certified by coincidental equality', () => {
  const f = file(undefined, undefined, [
    ['Period', '2026-07-01 to 2026-08-31'],
  ]);
  const a = source(f, 'supplier', { header: 1 });
  const b = source(f, 'ledger', { header: 1 });
  assert.equal(compare(a, b, scope).bridge, null);
});
test('045 numeric original invoice and credit-note IDs may match only with explicit identity evidence on both sides', () => {
  for (const type of ['Invoice', 'Credit Note'])
    for (const ref of ['000012340567', '٠٠٠١٢٣٤٥٦٧']) {
      const f = file(
        ['Date', 'Invoice No', 'Amount', 'Document Type'],
        [['2026-08-20', ref, type === 'Invoice' ? '100' : '-100', type]],
      );
      const a = source(f, 'supplier');
      const b = source(f, 'ledger');
      const result = compare(a, b, scope);
      assert.equal(result.matches.length, 1);
      assert.equal(result.matches[0].evidence?.reference, ref);
      assert.equal(result.supplier.transactions[0].reference, ref);
    }
});
test('045 numeric general references, unknown types, payments, shortened IDs and numeric groups stay unapproved', () => {
  const make = (
    ref: string,
    header = 'Invoice No',
    type = 'Invoice',
    amount = '100',
  ) =>
    file(
      ['Date', header, 'Amount', 'Document Type'],
      [['2026-08-20', ref, amount, type]],
    );
  for (const b of [
    make('00001234', 'Reference'),
    make('00001234', 'Invoice No', 'Unknown'),
    make('00001234', 'Invoice No', 'Payment'),
    make('1234'),
  ]) {
    assert.equal(
      compare(source(make('00001234'), 'supplier'), source(b, 'ledger'), scope)
        .matches.length,
      0,
    );
  }
  const group = file(
    ['Date', 'Invoice No', 'Amount', 'Document Type', 'PO', 'AP Voucher'],
    [
      ['2026-08-20', '00001234', '40', 'Invoice', 'PO-1', 'AP-1'],
      ['2026-08-20', '00001234', '60', 'Invoice', 'PO-1', 'AP-1'],
    ],
  );
  assert.equal(
    compare(
      source(make('00001234'), 'supplier'),
      source(group, 'ledger'),
      scope,
    ).matches.length,
    0,
  );
});
test('045 an explicit as-of snapshot is checked against cutoff without treating a preparation date as snapshot evidence', () => {
  for (const label of ['As of', 'Statement as of', 'تاريخ القطع']) {
    const a = source(
      file(['Date', 'Invoice No', 'Outstanding'], undefined, [
        [label, '2026-09-30'],
      ]),
      'supplier',
      { header: 1, reportType: 'open-items' },
    );
    noApproval(a, source(file(), 'ledger', { reportType: 'open-items' }));
  }
  const prepared = source(
    file(['Date', 'Invoice No', 'Outstanding'], undefined, [
      ['Prepared date', '2026-09-30'],
    ]),
    'supplier',
    { header: 1, reportType: 'open-items' },
  );
  assert.equal(
    compare(
      prepared,
      source(file(), 'ledger', { reportType: 'open-items' }),
      scope,
    ).matches.length,
    1,
  );
});
test('045 manually entering a closing balance cannot hide a conflicting balance currency', () => {
  const a = source(
    file(
      ['Date', 'Invoice No', 'Amount', 'Currency'],
      [
        ['2026-08-20', 'INV-500', '100', 'SAR'],
        ['Closing balance', '', '100', 'USD'],
      ],
    ),
    'supplier',
  );
  noApproval(a, source(file(), 'ledger'));
});
test('045 bounded whole-reference groups retain all source rows for review beyond the automatic limit', () => {
  for (const size of [99, 100, 101]) {
    const headers = [
      'Date',
      'Invoice No',
      'Amount',
      'Document Type',
      'PO',
      'AP Voucher',
    ];
    const total = (size * (size + 1)) / 2;
    const a = source(
      file(headers, [
        ['2026-08-20', 'INV-GROUP-500', String(total), 'Invoice', 'PO-451', ''],
      ]),
      'supplier',
    );
    const b = source(
      file(
        headers,
        Array.from({ length: size }, (_, i) => [
          '2026-08-20',
          'INV-GROUP-500',
          String(i + 1),
          'Invoice',
          'PO-451',
          'AP-540',
        ]),
      ),
      'ledger',
    );
    const r = compare(a, b, scope);
    assert.equal(r.matches.length, size <= 100 ? 1 : 0);
    assert.equal(r.cases.flatMap((c) => c.sourceTrace).length, size + 1);
    assert.equal(
      new Set(r.cases.flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId)))
        .size,
      size + 1,
    );
    if (size > 100) {
      assert.equal(r.cases[0].status, 'Needs Review');
      assert.match(r.cases[0].evidence.join(' '), /حد الاعتماد الآلي/);
    }
  }
});
test('045 explicit conflicting document labels in descriptions veto a match but never certify one', () => {
  for (const descriptions of [
    ['Credit Note returned goods', 'Payment bank transfer'],
    ['إشعار دائن: بضاعة مرتجعة', 'دفعة تحويل بنكي'],
    ['Invoice issued', 'Credit Note returned goods'],
  ]) {
    const headers = ['Date', 'Reference', 'Amount', 'Description'];
    const a = source(
      file(headers, [['2026-08-20', 'ADJ-31', '-90', descriptions[0]]]),
      'supplier',
      { description: 3 },
    );
    const b = source(
      file(headers, [['2026-08-20', 'ADJ-31', '-90', descriptions[1]]]),
      'ledger',
      { description: 3 },
    );
    const result = compare(a, b, scope);
    assert.equal(result.matches.length, 0);
    assert.equal(result.cases[0].status, 'Needs Review');
    assert.equal(a.transactions[0].documentType, 'Unknown');
  }
  const numeric = file(
    ['Date', 'Invoice No', 'Amount', 'Description'],
    [['2026-08-20', '00012345', '100', 'Invoice goods supplied']],
  );
  assert.equal(
    compare(
      source(numeric, 'supplier', { description: 3 }),
      source(numeric, 'ledger', { description: 3 }),
      scope,
    ).matches.length,
    0,
  );
  const ordinary = file(
    ['Date', 'Reference', 'Amount', 'Description'],
    [
      [
        '2026-08-20',
        'INV-12345',
        '100',
        'Goods supplied; invoice payment terms apply',
      ],
    ],
  );
  assert.equal(
    compare(
      source(ordinary, 'supplier', { description: 3 }),
      source(ordinary, 'ledger', { description: 3 }),
      scope,
    ).matches.length,
    1,
  );
});
