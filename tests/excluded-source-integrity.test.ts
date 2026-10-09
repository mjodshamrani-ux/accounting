import { compareDefaultSort } from './helpers/lint-value-text.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { verifyHypothesis } from '../lib/reconciliation/assistant.ts';
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
    {
      name: 'Data',
      rows: [[...headers], ...rows],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
function input(a: Row[], b: Row[]) {
  return { a: file('supplier', a.map(row)), b: file('ledger', b.map(row)) };
}
type Exclusions = { a?: Record<string, string>; b?: Record<string, string> };
function sources(
  files: ReturnType<typeof input>,
  excluded: Exclusions = {},
  overrides: Partial<Mapping> = {},
) {
  return [
    normalizeSource(
      files.a,
      { ...mapping, ...overrides, excluded: excluded.a ?? {} },
      scope,
      'supplier',
    ),
    normalizeSource(
      files.b,
      { ...mapping, ...overrides, excluded: excluded.b ?? {} },
      scope,
      'ledger',
    ),
  ] as const;
}
const auto = (result: ReturnType<typeof compare>) =>
  result.matches.filter((match) => match.kind === 'auto');
function conserve(
  result: ReturnType<typeof compare>,
  files: ReturnType<typeof input>,
) {
  for (const [source, original] of [
    [result.supplier, files.a],
    [result.ledger, files.b],
  ] as const) {
    const rows = [
      ...source.transactions,
      ...source.excluded,
      ...source.errors.filter((error) => error.row > 0),
    ];
    assert.equal(rows.length, original.sheets[0].rows.length);
    assert.equal(new Set(rows.map((item) => item.row)).size, rows.length);
    assert.ok(
      source.transactions.every((item) => Number.isSafeInteger(item.amount)),
    );
  }
  assert.deepEqual(
    result.cases
      .flatMap((item) => item.sourceTrace.map((trace) => trace.sourceRowId))
      .sort(),
    [...result.supplier.transactions, ...result.ledger.transactions]
      .map((item) => item.id)
      .sort(),
  );
}

void test('manual exclusions retain a safe literal envelope before bad amount or date parsing on either side', () => {
  for (const side of ['a', 'b'] as const)
    for (const defect of ['amount', 'date'] as const) {
      const files = input([{}], [{}]);
      const original = row({
        doc: 'INV-900',
        [defect]: defect === 'amount' ? 'bad' : '2026-02-30',
      });
      files[side].sheets[0].rows.push(original);
      const result = compare(
        ...sources(files, { [side]: { '3': 'Reviewed source exclusion' } }),
        scope,
      );
      const source = side === 'a' ? result.supplier : result.ledger;
      const excluded = source.excluded.find((item) => item.row === 3)!;
      assert.deepEqual(source.errors, []);
      assert.equal(excluded.kind, 'manual');
      assert.equal(excluded.reason, 'Reviewed source exclusion');
      assert.deepEqual(excluded.values, original);
      assert.equal(excluded.isolation?.rule, 'SAFE_REFERENCE_ENVELOPE_V1');
      assert.ok(excluded.isolation?.keys.includes('identity:INV900'));
      assert.ok(
        excluded.isolation?.keys.includes(
          defect === 'amount' ? 'identity:BAD' : 'identity:20260230',
        ),
      );
      assert.equal(source.total, 10000);
      assert.equal(auto(result).length, 1);
      conserve(result, files);
    }
});

void test('literal and normalized manual exclusion collisions block only the affected pair on both sides', () => {
  for (const side of ['a', 'b'] as const)
    for (const doc of ['INV-100', 'inv/100']) {
      const good = [{}, { doc: 'INV-200' }];
      const files = input(good, good);
      assert.equal(auto(compare(...sources(files), scope)).length, 2);
      files[side].sheets[0].rows.push(row({ doc, amount: 'bad' }));
      const result = compare(
        ...sources(files, { [side]: { '4': 'Duplicate omitted by reviewer' } }),
        scope,
      );
      assert.deepEqual(
        auto(result).map((match) => match.supplierId),
        ['supplier:0:3'],
      );
      assert.equal(
        result.cases.filter((item) => item.status === 'Matched').length,
        1,
      );
      conserve(result, files);
    }
});

void test('every excluded secondary identity blocks matching across reference roles without supplying positive authority', () => {
  for (const side of ['a', 'b'] as const)
    for (const field of [
      'chosen',
      'bank',
      'receipt',
      'voucher',
      'po',
    ] as const) {
      const good = [{ bank: 'LINK-501' }, { doc: 'INV-200' }];
      const files = input(good, good);
      assert.equal(auto(compare(...sources(files), scope)).length, 2);
      files[side].sheets[0].rows.push(
        row({ doc: 'INV-900', amount: 'bad', [field]: 'link/501' }),
      );
      const result = compare(
        ...sources(files, { [side]: { '4': 'Review exclusion' } }),
        scope,
      );
      const source = side === 'a' ? result.supplier : result.ledger;
      assert.ok(
        source.excluded
          .find((item) => item.row === 4)
          ?.isolation?.keys.includes('identity:LINK501'),
        field,
      );
      assert.deepEqual(
        auto(result).map((match) => match.supplierId),
        ['supplier:0:3'],
        field,
      );
      conserve(result, files);
    }
});

void test('a displaced identity in the manually excluded date or amount remains negative evidence on either side', () => {
  for (const side of ['a', 'b'] as const)
    for (const field of ['date', 'amount'] as const) {
      const files = input([{}, { doc: 'INV-200' }], [{}, { doc: 'INV-200' }]);
      files[side].sheets[0].rows.push(row({ doc: '1234', [field]: 'INV-100' }));
      const result = compare(
        ...sources(files, { [side]: { '4': 'Corrupt movement omitted' } }),
        scope,
      );
      const source = side === 'a' ? result.supplier : result.ledger;
      assert.ok(
        source.excluded
          .find((item) => item.row === 4)
          ?.isolation?.keys.includes('identity:INV100'),
      );
      assert.deepEqual(
        auto(result).map((match) => match.supplierId),
        ['supplier:0:3'],
      );
      assert.equal(
        files[side].sheets[0].rows[3][field === 'date' ? 0 : 3],
        'INV-100',
      );
      assert.deepEqual(
        source.transactions.map((item) => item.amount),
        [10000, 10000],
      );
      conserve(result, files);
    }
});

void test('an excluded unknown or unsafe reference envelope is a wildcard even when the visible document is disjoint', () => {
  const damage = [
    (source: SourceFile) => {
      source.sheets[0].rowIssues = { '3': ['Uncertain row alignment'] };
    },
    (source: SourceFile) => {
      source.sheets[0].hiddenRows = [3];
    },
    (source: SourceFile) => {
      source.sheets[0].referenceIssues = {
        '3:2': ['Reference display mismatch'],
      };
    },
    (source: SourceFile) => {
      source.sheets[0].cellIssues = { '1:2': ['Unsafe document header'] };
    },
    (source: SourceFile) => {
      source.sheets[0].rows[2][4] = 'Unknown issuer role';
    },
    (source: SourceFile) => {
      source.sheets[0].rows[2][1] = '';
      source.sheets[0].rows[2][2] = '';
    },
    (source: SourceFile) => {
      source.sheets[0].rows[2][2] = '=1+1';
    },
    (source: SourceFile) => {
      source.sheets[0].rows[2].push('extra cell');
    },
    (source: SourceFile) => {
      source.sheets[0].formulaRows = [3];
    },
  ];
  for (const side of ['a', 'b'] as const)
    for (const apply of damage) {
      const files = input([{}], [{}]);
      files[side].sheets[0].rows.push(row({ doc: 'INV-900', amount: 'bad' }));
      apply(files[side]);
      const result = compare(
        ...sources(files, { [side]: { '3': 'Excluded pending review' } }),
        scope,
      );
      const source = side === 'a' ? result.supplier : result.ledger;
      const excluded = source.excluded.find((item) => item.row === 3)!;
      assert.equal(excluded.kind, 'manual');
      assert.equal(excluded.isolation, undefined);
      assert.equal(auto(result).length, 0);
      conserve(result, files);
    }
});

void test('parsed manual exclusions with a missing or empty isolation envelope cannot recover automatic matches', () => {
  for (const side of [0, 1] as const)
    for (const missing of [false, true]) {
      const files = input([{}], [{}]);
      files[side === 0 ? 'a' : 'b'].sheets[0].rows.push(
        row({ doc: 'INV-900' }),
      );
      const normalized = sources(
        files,
        side === 0
          ? { a: { '3': 'Review exclusion' } }
          : { b: { '3': 'Review exclusion' } },
      );
      const excluded = normalized[side].excluded.find(
        (item) => item.row === 3,
      )!;
      assert.equal(excluded.kind, 'manual');
      if (missing) delete excluded.isolation;
      else
        excluded.isolation = { rule: 'SAFE_REFERENCE_ENVELOPE_V1', keys: [] };
      assert.equal(auto(compare(...normalized, scope)).length, 0);
    }
});

void test('unsafe blank manual exclusions remain wildcard blockers and cannot establish complete balance coverage', () => {
  const damage = [
    (source: SourceFile) => {
      source.sheets[0].hiddenRows = [3];
    },
    (source: SourceFile) => {
      source.sheets[0].rowIssues = { '3': ['Missing movement fields'] };
    },
    (source: SourceFile) => {
      source.sheets[0].formulaRows = [3];
    },
  ];
  for (const side of ['a', 'b'] as const)
    for (const apply of damage) {
      const files = input([{}], [{}]);
      files[side].sheets[0].rows.push(headers.map(() => ''));
      apply(files[side]);
      const result = compare(
        ...sources(
          files,
          { [side]: { '3': 'Unread possible movement' } },
          { opening: '0', closing: '100', periodStart: '2026-07-01' },
        ),
        scope,
      );
      const source = side === 'a' ? result.supplier : result.ledger;
      const excluded = source.excluded.find((item) => item.row === 3)!;
      assert.equal(excluded.kind, 'manual');
      assert.equal(excluded.isolation, undefined);
      assert.ok(excluded.values.every((value) => value === ''));
      assert.equal(source.opening! + source.total, source.closing);
      assert.equal(auto(result).length, 0);
      assert.equal(result.balanceComparable, false);
      assert.equal(result.bridge, null);
      conserve(result, files);
    }
});

void test('excluded cross-role normalized taint follows original transitive memberships after manual acceptance or rejection', () => {
  const good = [
    { doc: 'INV-100', receipt: 'R-SECOND' },
    { doc: 'INV-200', bank: 'B-FIRST', receipt: 'R-SECOND' },
    { doc: 'INV-300' },
  ];
  for (const side of ['a', 'b'] as const)
    for (const manual of [false, true]) {
      const files = input(good, good);
      assert.equal(auto(compare(...sources(files), scope)).length, 3);
      files[side].sheets[0].rows.push(
        row({ doc: 'INV-900', po: 'b/first', amount: 'bad' }),
      );
      const result = compare(
        ...sources(files, { [side]: { '5': 'Review exclusion' } }),
        scope,
        manual
          ? [
              {
                supplierId: 'supplier:0:3',
                ledgerId: 'ledger:0:3',
                note: 'Reviewed bridge pair',
              },
            ]
          : [],
        manual ? [] : ['supplier:0:3|ledger:0:3'],
      );
      assert.deepEqual(
        auto(result).map((match) => match.supplierId),
        ['supplier:0:4'],
      );
      assert.equal(
        result.matches.filter((match) => match.kind === 'manual').length,
        manual ? 1 : 0,
      );
      assert.ok(
        !auto(result).some((match) => match.supplierId === 'supplier:0:2'),
      );
      conserve(result, files);
    }
});

void test('outside-period literal or normalized collisions cannot manufacture uniqueness through date filtering', () => {
  for (const side of ['a', 'b'] as const)
    for (const date of ['2026-06-01', '2026-08-01'])
      for (const doc of ['INV-100', 'inv/100']) {
        const files = input([{}, { doc: 'INV-200' }], [{}, { doc: 'INV-200' }]);
        files[side].sheets[0].rows.push(row({ doc, date, amount: 'bad' }));
        const result = compare(
          ...sources(files, {}, { periodStart: '2026-07-01' }),
          scope,
        );
        const source = side === 'a' ? result.supplier : result.ledger;
        const excluded = source.excluded.find((item) => item.row === 4)!;
        assert.equal(excluded.kind, 'outside-period');
        assert.equal(excluded.isolation?.rule, 'SAFE_REFERENCE_ENVELOPE_V1');
        assert.ok(excluded.isolation?.keys.includes('identity:INV100'));
        assert.deepEqual(source.errors, []);
        assert.deepEqual(
          auto(result).map((match) => match.supplierId),
          ['supplier:0:3'],
        );
        conserve(result, files);
      }
});

void test('a safely disjoint outside-period movement leaves the in-period pair automatic', () => {
  for (const side of ['a', 'b'] as const) {
    const files = input([{}], [{}]);
    files[side].sheets[0].rows.push(
      row({ doc: 'INV-900', date: '2026-08-01', amount: 'bad' }),
    );
    const result = compare(...sources(files), scope);
    const source = side === 'a' ? result.supplier : result.ledger;
    assert.equal(
      source.excluded.find((item) => item.row === 3)?.kind,
      'outside-period',
    );
    assert.equal(auto(result).length, 1);
    assert.equal(source.total, 10000);
    conserve(result, files);
  }
});

void test('confirmed headers, blank rows, summaries, repeated headers and independent footers are non-movements', () => {
  const files = input([{}], [{}]);
  for (const source of [files.a, files.b])
    source.sheets[0].rows.push(
      headers.map(() => ''),
      ['Total', '', '', '100.00', '', '', '', '', '', 'SAR'],
      [...headers],
      ['Page 1 of 1', '', '', '', '', '', '', '', '', ''],
    );
  const result = compare(
    ...sources(
      files,
      {},
      { opening: '0', closing: '100', periodStart: '2026-07-01' },
    ),
    scope,
  );
  for (const source of [result.supplier, result.ledger]) {
    assert.deepEqual(source.errors, []);
    assert.deepEqual(
      source.excluded.map((item) => item.row),
      [1, 3, 4, 5, 6],
    );
    assert.ok(source.excluded.every((item) => item.kind === 'non-movement'));
  }
  assert.equal(auto(result).length, 1);
  assert.equal(result.balanceComparable, true);
  assert.equal(result.bridge?.residual, 0);
  conserve(result, files);
});

void test('legacy exclusions use all nonempty raw cells as negative keys regardless of their reason text', () => {
  for (const side of [0, 1] as const)
    for (const reason of [
      'صف فارغ',
      'بعد تاريخ المقارنة',
      'صف العناوين المؤكد',
      'Reviewed exclusion',
    ]) {
      const files = input([{}, { doc: 'INV-200' }], [{}, { doc: 'INV-200' }]);
      const normalized = sources(files);
      normalized[side].excluded.push({
        row: 99,
        reason,
        values: row({ doc: 'INV-900', amount: 'inv/100' }),
      });
      const result = compare(...normalized, scope);
      assert.deepEqual(
        auto(result).map((match) => match.supplierId),
        ['supplier:0:3'],
        reason,
      );
    }
});

void test('legacy exclusions with disjoint raw identities preserve independent automatic pairs', () => {
  for (const side of [0, 1] as const) {
    const files = input([{}], [{}]);
    const normalized = sources(files);
    normalized[side].excluded.push({
      row: 99,
      reason: 'Legacy source review',
      values: row({ doc: 'INV-900' }),
    });
    assert.equal(auto(compare(...normalized, scope)).length, 1);
  }
});

void test('a legacy isolation certificate cannot omit a competing identity still present in a raw cell', () => {
  for (const side of [0, 1] as const) {
    const files = input([{}, { doc: 'INV-200' }], [{}, { doc: 'INV-200' }]);
    const normalized = sources(files);
    normalized[side].excluded.push({
      row: 99,
      reason: 'Imported legacy exclusion',
      values: row({ doc: 'INV-900', amount: 'inv/100' }),
      isolation: {
        rule: 'SAFE_REFERENCE_ENVELOPE_V1',
        keys: ['identity:INV900'],
      },
    });
    const result = compare(...normalized, scope);
    assert.deepEqual(
      auto(result).map((match) => match.supplierId),
      ['supplier:0:3'],
    );
    assert.deepEqual(
      normalized[side].transactions.map((item) => item.amount),
      [10000, 10000],
    );
  }
});

void test('explicit manual acceptance remains manual when an excluded possible competitor blocks automatic authority', () => {
  const files = input(
    [{}, { doc: 'INV-200' }, { amount: 'bad' }],
    [{}, { doc: 'INV-200' }],
  );
  const normalized = sources(files, { a: { '4': 'Duplicate pending review' } });
  assert.deepEqual(
    auto(compare(...normalized, scope)).map((match) => match.supplierId),
    ['supplier:0:3'],
  );
  const result = compare(...normalized, scope, [
    {
      supplierId: 'supplier:0:2',
      ledgerId: 'ledger:0:2',
      note: 'Reviewed original records',
    },
  ]);
  assert.deepEqual(
    result.matches.map((match) => [match.supplierId, match.kind]).sort(compareDefaultSort),
    [
      ['supplier:0:2', 'manual'],
      ['supplier:0:3', 'auto'],
    ],
  );
  conserve(result, files);
});

void test('AI hypotheses reject excluded identity memberships without mutation and leave disjoint proposals for review', () => {
  for (const side of ['a', 'b'] as const) {
    const files = input(
      [{ doc: 'INV-100' }, { doc: 'INV-200' }],
      [{ doc: 'INV-150' }, { doc: 'INV-250' }],
    );
    files[side].sheets[0].rows.push(
      row({ doc: 'INV-900', bank: 'inv/100', amount: 'bad' }),
    );
    const result = compare(
      ...sources(files, { [side]: { '4': 'Possible competitor omitted' } }),
      scope,
    );
    assert.equal(result.matches.length, 0);
    const before = JSON.stringify(result);
    const affected = verifyHypothesis(result, {
      supplierIds: ['supplier:0:2'],
      ledgerIds: ['ledger:0:2'],
    });
    assert.equal(affected.status, 'rejected');
    assert.equal(affected.difference, null);
    assert.deepEqual(affected.sourceIds, []);
    assert.equal(JSON.stringify(result), before);
    const disjoint = verifyHypothesis(result, {
      supplierIds: ['supplier:0:3'],
      ledgerIds: ['ledger:0:3'],
    });
    assert.equal(disjoint.status, 'needs-review');
    assert.equal(disjoint.difference, 0);
    assert.deepEqual(disjoint.sourceIds, ['supplier:0:3', 'ledger:0:3']);
    assert.equal(JSON.stringify(result), before);
    assert.equal(result.matches.length, 0);
    conserve(result, files);
  }
});

void test('offsetting manually excluded movements prevent complete balance reconciliation despite exact arithmetic', () => {
  for (const side of ['a', 'b'] as const) {
    const files = input([{}], [{}]);
    files[side].sheets[0].rows.push(
      row({ doc: 'INV-900', amount: '25.00' }),
      row({ doc: 'CN-901', type: 'Credit Note', amount: '-25.00' }),
    );
    const balances = {
      opening: '0',
      closing: '100',
      periodStart: '2026-07-01',
    };
    const complete = compare(...sources(files, {}, balances), scope);
    assert.equal(complete.balanceComparable, true);
    assert.equal(complete.bridge?.residual, 0);
    const result = compare(
      ...sources(
        files,
        { [side]: { '3': 'Omitted debit', '4': 'Omitted credit' } },
        balances,
      ),
      scope,
    );
    const source = side === 'a' ? result.supplier : result.ledger;
    assert.deepEqual(source.errors, []);
    assert.equal(source.total, 10000);
    assert.equal(source.opening! + source.total, source.closing);
    assert.equal(
      source.excluded.filter((item) => item.kind === 'manual').length,
      2,
    );
    assert.equal(auto(result).length, 1);
    assert.equal(result.balanceComparable, false);
    assert.equal(result.bridge, null);
    assert.deepEqual(
      files[side].sheets[0].rows.slice(2).map((item) => item[3]),
      ['25.00', '-25.00'],
    );
    conserve(result, files);
  }
});

void test('manual excluded competitors block complete invoice and payment group proofs while disjoint groups survive', () => {
  const invoices = input(
    [
      { doc: 'INV-GROUP1', po: 'PO-7' },
      { doc: 'INV-900', po: 'po/7', amount: 'bad' },
    ],
    [
      { doc: 'INV-GROUP1', po: 'PO-7', amount: '40' },
      { doc: 'INV-GROUP1', po: 'PO-7', amount: '60' },
    ],
  );
  const invoiceResult = compare(
    ...sources(invoices, { a: { '3': 'Unparsed component omitted' } }),
    scope,
  );
  assert.equal(
    invoiceResult.cases.filter((item) => item.status === 'Matched').length,
    0,
  );
  conserve(invoiceResult, invoices);
  const payment = (bank: string, amount: string): Row => ({
    type: 'Payment',
    doc: `PAY-${bank}`,
    bank,
    amount,
  });
  const payments = input(
    [
      payment('B-100', '-40'),
      payment('B-100', '-60'),
      payment('B-200', '-25'),
      payment('B-200', '-75'),
      { doc: 'INV-900', receipt: 'b/100', amount: 'bad' },
    ],
    [
      payment('B-100', '-30'),
      payment('B-100', '-70'),
      payment('B-200', '-35'),
      payment('B-200', '-65'),
    ],
  );
  const paymentResult = compare(
    ...sources(payments, { a: { '6': 'Unparsed payment competitor omitted' } }),
    scope,
  );
  const matched = paymentResult.cases.filter(
    (item) => item.status === 'Matched',
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].classification, 'EXACT_MANY_TO_MANY');
  assert.equal(matched[0].supplierMembers[0].bankReference, 'B-200');
  conserve(paymentResult, payments);
});

void test('malformed exclusion state rejects an AI proposal without throwing or mutating', () => {
  const files = input([{ doc: 'INV-100' }], [{ doc: 'INV-200' }]);
  const result = compare(...sources(files), scope);
  // Unknown runtime data must fail inside the assistant validation boundary.
  (result.supplier as unknown as { excluded: null }).excluded = null;
  const before = JSON.stringify(result);
  const response = verifyHypothesis(result, {
    supplierIds: ['supplier:0:2'],
    ledgerIds: ['ledger:0:2'],
  });
  assert.equal(response.status, 'rejected');
  assert.equal(response.difference, null);
  assert.deepEqual(response.sourceIds, []);
  assert.equal(JSON.stringify(result), before);
});
