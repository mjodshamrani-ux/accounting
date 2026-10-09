import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeSource } from '../lib/reconciliation/core.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
} from '../lib/reconciliation/types.ts';
import {
  invoiceGroupSourcesFromVerifiedReading,
  searchInvoiceGroups,
} from '../lib/reconciliation/invoice-group-search.ts';
import type { InvoiceGroupSearchInput } from '../lib/reconciliation/invoice-group-search.ts';

const scope: Scope = {
  entity: 'ENTITY',
  account: 'AP',
  supplier: 'SUPPLIER',
  currency: 'SAR',
  decimals: 0,
  cutoff: '2026-09-30',
  dateWindow: 7,
  confirmed: true,
  coverageConfirmed: true,
};
const mapping: Mapping = {
  sheet: 0,
  header: 0,
  date: 3,
  reference: 0,
  description: -1,
  amount: 2,
  debit: -1,
  credit: -1,
  currencyColumn: -1,
  mode: 'signed',
  multiplier: 1,
  numberFormat: 'dot',
  dateFormat: 'ymd',
  reportType: 'transactions',
  opening: '',
  closing: '',
  periodStart: '',
  excluded: {},
};
type EconomicRow = string[];
const fixture = (
  supplier: EconomicRow[],
  ledger: EconomicRow[],
  selected = false,
) => {
  const mappings: [Mapping, Mapping] = [
    { ...mapping, reference: selected ? 1 : 0 },
    { ...mapping, reference: selected ? 1 : 0 },
  ];
  const files = [supplier, ledger].map((rows, i) => {
    const data = [
      ['Invoice No', 'Reference', 'Amount', 'Date', 'Document Type'],
      ...rows.map((r) => [
        r[0],
        r[2] ?? '',
        r[1],
        '2026-09-01',
        r[3] ?? 'Invoice',
      ]),
    ];
    return {
      name: `synthetic-${i}.csv`,
      sha256: createHash('sha256')
        .update(JSON.stringify([i, data]))
        .digest('hex'),
      sheets: [{ name: 'Sheet1', rows: data, formulaRows: [], hiddenRows: [] }],
    };
  }) as unknown as [SourceFile, SourceFile];
  const readings: [SourceResult, SourceResult] = [
    normalizeSource(files[0], mappings[0], scope, 'supplier'),
    normalizeSource(files[1], mappings[1], scope, 'ledger'),
  ];
  const input: InvoiceGroupSearchInput = {
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      readings,
      scope,
    ),
    scope: { ...scope },
  };
  return { files, mappings, readings, input };
};
const frozen = readFileSync(
  new URL(
    '../audit/invoice-group-search-v1/frozen-synthetic-truths.json',
    import.meta.url,
  ),
);
const oracle = JSON.parse(frozen.toString()) as {
  cases: {
    id: string;
    supplier: string[][];
    ledger: string[][];
    truth: {
      invoice: string;
      selected?: string;
      supplierRows: number[];
      ledgerRows: number[];
      sumMinor?: number;
      status: string;
      reason?: string;
    }[];
  }[];
};
void test('synthetic economic oracle remains byte-for-byte frozen before implementation', () => {
  assert.equal(
    createHash('sha256').update(frozen).digest('hex'),
    '3e037c50924bc90d23b0ed09f891f8509b938b4d2b7ff84186c385d6535da134',
  );
});
for (const c of oracle.cases)
  void test(`frozen economic contract: ${c.id}`, () => {
    const { input } = fixture(c.supplier, c.ledger, c.id === 'SELECTED_PARTS');
    const result = searchInvoiceGroups(input);
    assert.deepEqual(result.matches, []);
    for (const expected of c.truth) {
      const candidate = result.candidates.find(
        (g) =>
          g.invoice === expected.invoice &&
          g.selectedReference === (expected.selected ?? ''),
      );
      assert.ok(candidate, JSON.stringify(result));
      assert.equal(
        candidate.status,
        expected.status,
        JSON.stringify(candidate),
      );
      assert.deepEqual(
        candidate.evidence.members
          .filter((t) => t.side === 'supplier')
          .map((t) => t.row)
          .sort((a, b) => a - b),
        expected.supplierRows,
      );
      assert.deepEqual(
        candidate.evidence.members
          .filter((t) => t.side === 'ledger')
          .map((t) => t.row)
          .sort((a, b) => a - b),
        expected.ledgerRows,
      );
      if (expected.reason)
        assert.ok(candidate.reasons.includes(expected.reason as never));
      if (expected.sumMinor !== undefined) {
        assert.equal(candidate.supplierTotalMinor, expected.sumMinor);
        assert.equal(candidate.ledgerTotalMinor, expected.sumMinor);
      }
      assert.equal(candidate.evidence.pairwiseAllocation, false);
    }
  });
void test('actual malformed native last row blocks affected group while isolated group survives', () => {
  const { files, mappings } = fixture(
    [
      ['A', '1000'],
      ['B', '50'],
    ],
    [
      ['A', '400'],
      ['A', '600'],
      ['B', '50'],
      ['A', 'broken'],
    ],
  );
  const readings: [SourceResult, SourceResult] = [
    normalizeSource(files[0], mappings[0], scope, 'supplier'),
    normalizeSource(files[1], mappings[1], scope, 'ledger'),
  ];
  assert.equal(readings[1].errors.length, 1);
  const result = searchInvoiceGroups({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      readings,
      scope,
    ),
    scope,
  });
  assert.equal(
    result.candidates.find((c) => c.invoice === 'A')?.status,
    'needs-review',
  );
  assert.equal(
    result.candidates.find((c) => c.invoice === 'B')?.status,
    'candidate',
  );
  assert.equal(
    result.candidates.find((c) => c.invoice === 'A')?.competingRows[0]?.row,
    5,
  );
});
void test('unknown malformed row without safe identity blocks entire scope', () => {
  const { files, mappings } = fixture(
    [['A', '1000']],
    [
      ['A', '1000'],
      ['', 'broken'],
    ],
  );
  const readings: [SourceResult, SourceResult] = [
    normalizeSource(files[0], mappings[0], scope, 'supplier'),
    normalizeSource(files[1], mappings[1], scope, 'ledger'),
  ];
  const result = searchInvoiceGroups({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      readings,
      scope,
    ),
    scope,
  });
  assert.ok(result.reasons.includes('unknown-membership'));
  assert.equal(result.candidates[0].status, 'needs-review');
});
void test('physical member omission, duplicate coordinate, forged movement linkage cannot claim closure', () => {
  for (const alter of [
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].physicalRows.pop();
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].physicalRows.push(i.sources[1].physicalRows[1]);
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].physicalRows[1].transactionId = 'missing';
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].physicalRows[1].identities = [];
    },
  ]) {
    const { input } = fixture([['A', '1000']], [['A', '1000']]);
    alter(input);
    const r = searchInvoiceGroups(input);
    assert.ok(r.reasons.includes('physical-membership-incomplete'));
    assert.ok(r.candidates.every((c) => c.status === 'needs-review'));
  }
});
void test('original source dates, roles, amount signs, and currency remain required', () => {
  for (const alter of [
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].transactions[0].date = '2026-10-01';
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].transactions[0].date = '2026-02-30';
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].transactions[0].currency = 'USD';
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].transactions[0].amountMinor = -1000;
    },
    (i: InvoiceGroupSearchInput) => {
      i.scope.confirmed = false;
    },
    (i: InvoiceGroupSearchInput) => {
      i.scope.coverageConfirmed = false;
    },
    (i: InvoiceGroupSearchInput) => {
      i.sources[1].sourceHash = i.sources[0].sourceHash;
    },
  ]) {
    const { input } = fixture([['A', '1000']], [['A', '1000']]);
    alter(input);
    const r = searchInvoiceGroups(input);
    assert.equal(r.candidates[0].status, 'needs-review');
    assert.deepEqual(r.matches, []);
  }
});
void test('a selected related invoice or purchase order never isolates a partial group', () => {
  for (const role of ['related-invoice', 'purchase-order']) {
    const { input } = fixture(
      [['P', '1000', 'A']],
      [
        ['P', '400', 'A'],
        ['P', '600', 'A'],
        ['P', '900', 'B'],
      ],
      true,
    );
    for (const source of input.sources)
      for (const t of source.transactions)
        if (t.chosenReferenceEvidence)
          t.chosenReferenceEvidence.role = role as never;
    const r = searchInvoiceGroups(input);
    assert.ok(r.candidates.every((c) => c.status === 'needs-review'));
    assert.ok(r.candidates.some((c) => c.reasons.includes('amount-mismatch')));
  }
});
void test('shared selected identity under another invoice forms competition on both groups', () => {
  const { input } = fixture(
    [
      ['P', '1000', 'X'],
      ['Q', '50', 'X'],
    ],
    [
      ['P', '400', 'X'],
      ['P', '600', 'X'],
      ['Q', '50', 'X'],
    ],
    true,
  );
  const r = searchInvoiceGroups(input);
  assert.ok(
    r.candidates.every(
      (c) =>
        c.status === 'needs-review' &&
        c.reasons.includes('identity-competition'),
    ),
  );
});
void test('limits fail closed deterministically; late candidates are never declared unique', () => {
  for (const limits of [
    { physicalRows: 2 },
    { expansions: 4 },
    { members: 2 },
    { candidates: 1 },
  ]) {
    const { input } = fixture(
      [
        ['A', '1000'],
        ['B', '50'],
      ],
      [
        ['A', '400'],
        ['A', '600'],
        ['B', '50'],
      ],
    );
    input.limits = limits;
    const r = searchInvoiceGroups(input);
    assert.equal(r.searchComplete, false);
    assert.ok(r.reasons.includes('resource-limit'));
    assert.ok(r.candidates.every((c) => c.status === 'needs-review'));
    assert.deepEqual(r, searchInvoiceGroups(input));
  }
});
void test('row-order permutation retains invoice membership and arithmetic, with no arbitrary subset', () => {
  const a = searchInvoiceGroups(
    fixture(
      [
        ['A', '1000'],
        ['B', '500'],
      ],
      [
        ['A', '400'],
        ['A', '600'],
        ['B', '500'],
      ],
    ).input,
  );
  const b = searchInvoiceGroups(
    fixture(
      [
        ['B', '500'],
        ['A', '1000'],
      ],
      [
        ['B', '500'],
        ['A', '600'],
        ['A', '400'],
      ],
    ).input,
  );
  assert.deepEqual(
    a.candidates.map((c) => [
      c.invoice,
      c.status,
      c.supplierTotalMinor,
      c.ledgerTotalMinor,
    ]),
    b.candidates.map((c) => [
      c.invoice,
      c.status,
      c.supplierTotalMinor,
      c.ledgerTotalMinor,
    ]),
  );
});

void test('adapter independently re-prepares current native rows and rejects stale caller positives', () => {
  const { files, mappings, readings } = fixture(
    [['A', '1000']],
    [['A', '1000']],
  );
  files[1].sheets[0].rows[1][2] = '999';
  const r = searchInvoiceGroups({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      readings,
      scope,
    ),
    scope,
  });
  assert.equal(r.candidates[0].ledgerTotalMinor, 999);
  assert.ok(r.candidates[0].reasons.includes('physical-membership-incomplete'));
  assert.equal(r.candidates[0].status, 'needs-review');
});
void test('indistinguishable repeated invoice members are not distinct economic operations', () => {
  const r = searchInvoiceGroups(
    fixture(
      [['A', '1000']],
      [
        ['A', '500'],
        ['A', '500'],
      ],
    ).input,
  );
  assert.ok(r.candidates[0].reasons.includes('duplicate-invoice-members'));
  assert.equal(r.candidates[0].status, 'needs-review');
});

void test('another role sharing a selected identity defeats sibling isolation', () => {
  const { files, mappings } = fixture(
    [
      ['P', '1000', 'A'],
      ['P', '50', 'B'],
    ],
    [
      ['P', '400', 'A'],
      ['P', '600', 'A'],
      ['P', '50', 'B'],
    ],
    true,
  );
  for (const file of files) {
    file.sheets[0].rows[0].push('Bank Reference');
    for (const row of file.sheets[0].rows.slice(1))
      row.push(row[1] === 'B' ? 'A' : '');
  }
  const readings = [
    normalizeSource(files[0], mappings[0], scope, 'supplier'),
    normalizeSource(files[1], mappings[1], scope, 'ledger'),
  ] as [SourceResult, SourceResult];
  const r = searchInvoiceGroups({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      readings,
      scope,
    ),
    scope,
  });
  assert.equal(
    r.candidates.find((c) => c.selectedReference === 'A')?.status,
    'needs-review',
  );
  assert.ok(
    r.candidates
      .find((c) => c.selectedReference === 'A')
      ?.reasons.includes('identity-competition'),
  );
});
void test('existing arithmetic bound applies to candidate totals', () => {
  const { input } = fixture(
    [['A', '1000']],
    [
      ['A', '400'],
      ['A', '600'],
    ],
  );
  input.sources[0].transactions[0].amountMinor = 1e14;
  input.sources[0].transactions[0].amount = 1e14;
  input.sources[1].transactions[0].amountMinor = 1e14;
  input.sources[1].transactions[0].amount = 1e14;
  const r = searchInvoiceGroups(input);
  assert.equal(r.candidates[0].ledgerTotalMinor, null);
  assert.equal(r.candidates[0].status, 'needs-review');
});
