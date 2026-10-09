import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareVerifiedSources } from '../lib/reconciliation/source-preparation.ts';
import { invoiceGroupSourcesFromVerifiedReading } from '../lib/reconciliation/invoice-group-search.ts';
import {
  searchInvoiceOverlaps,
  INVOICE_OVERLAP_HARD_REASONS,
} from '../lib/reconciliation/invoice-overlap-search.ts';
import type {
  InvoiceOverlapSearchInput,
  InvoiceOverlapSearchResult,
} from '../lib/reconciliation/invoice-overlap-search.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
} from '../lib/reconciliation/types.ts';
const scope: Scope = {
  supplier: 'Vendor',
  entity: 'Entity',
  account: 'AP',
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
type EconomicRow = {
  id: string;
  invoice: string;
  selected: string;
  minor: number;
  voucher: string;
};
const raw = readFileSync(
  new URL('../audit/invoice-overlap-v1/frozen-truths.json', import.meta.url),
);
const oracle = JSON.parse(raw.toString()) as {
  cases: {
    id: string;
    supplier: EconomicRow[];
    ledger: EconomicRow[];
    blocked: boolean;
    truthCandidates: {
      invoice: string;
      selected: string;
      supplierIds: string[];
      ledgerIds: string[];
      totalMinor: number;
    }[];
  }[];
};
function fixture(supplier: EconomicRow[], ledger: EconomicRow[]) {
  const economic = [supplier, ledger];
  const mappings = economic.map((rows) => ({
    ...mapping,
    reference: rows.some((row) => row.selected) ? 1 : 0,
  })) as [Mapping, Mapping];
  const files = economic.map((rows, i) => {
    const cells = [
      [
        'Invoice No',
        'Reference',
        'Amount',
        'Date',
        'Document Type',
        'Voucher No',
      ],
      ...rows.map((row) => [
        row.invoice,
        row.selected,
        String(row.minor),
        '2026-09-01',
        'Invoice',
        row.voucher,
      ]),
    ];
    return {
      name: `side-${i}.csv`,
      sha256: createHash('sha256')
        .update(JSON.stringify([i, cells]))
        .digest('hex'),
      sheets: [
        { name: 'Native', rows: cells, formulaRows: [], hiddenRows: [] },
      ],
    };
  }) as unknown as [SourceFile, SourceFile];
  const fresh = prepareVerifiedSources(files, mappings, scope, [
    'supplier',
    'ledger',
  ]);
  const readings = fresh.sources as [SourceResult, SourceResult];
  const sources = invoiceGroupSourcesFromVerifiedReading(
    files,
    fresh.mappings as [Mapping, Mapping],
    readings,
    scope,
  );
  // Economic IDs are separate oracle IDs; map them to native generated IDs only
  // by original row position. No expected matching relationship enters the engine.
  const nativeToEconomic = new Map<string, string>();
  for (let side = 0; side < 2; side++)
    for (const t of sources[side].transactions)
      nativeToEconomic.set(`${t.side}:${t.id}`, economic[side][t.row - 2].id);
  const input: InvoiceOverlapSearchInput = {
    sources,
    scope: { ...scope },
    revision: 'native-reading-v1',
  };
  return { files, mappings, readings, input, nativeToEconomic };
}
const normalize = (r: InvoiceOverlapSearchResult, map: Map<string, string>) =>
  r.candidates
    .map((c) => ({
      invoice: c.invoice,
      selected: c.selectedReference,
      supplierIds: c.supplierIds.map((id) => map.get(`supplier:${id}`)!).sort(),
      ledgerIds: c.ledgerIds.map((id) => map.get(`ledger:${id}`)!).sort(),
      totalMinor: c.totalMinor,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
void test('pre-engine independent synthetic oracle hash remains unchanged', () =>
  assert.equal(
    createHash('sha256').update(raw).digest('hex'),
    'd1c505c28cd29a620dae82fbfb20ed4b1bede85456e98affc5b35dc1d586b0ac',
  ));
for (const c of oracle.cases)
  void test(`all independent subset truths: ${c.id}`, async () => {
    const { input, nativeToEconomic } = fixture(c.supplier, c.ledger);
    const result = await searchInvoiceOverlaps(input);
    assert.equal(result.searchComplete, true, JSON.stringify(result.reasons));
    assert.deepEqual(
      normalize(result, nativeToEconomic),
      c.truthCandidates.toSorted((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    );
    assert.deepEqual(result.matches, []);
    assert.equal(
      result.rows.filter((row) => row.disposition === 'movement').length,
      c.supplier.length + c.ledger.length,
    );
    if (c.blocked)
      assert.ok(
        result.candidates.every(
          (candidate) =>
            candidate.status === 'needs-review' &&
            candidate.reasons.includes('invalid-invoice-member'),
        ),
      );
    if (c.id.startsWith('proper-')) {
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].status, 'candidate');
      assert.ok(result.components[0].residualRowKeys.length);
      assert.ok(result.unmatchedRows.length);
    }
    if (c.id === 'overlapping-alternatives' || c.id === 'shared-either-side') {
      assert.equal(result.components.length, 1);
      assert.ok(
        result.candidates.every(
          (candidate) =>
            candidate.competingCandidateIds.length &&
            candidate.reasons.includes('overlapping-candidates'),
        ),
      );
    }
    if (c.id === 'distinct-selected-parts')
      assert.equal(result.components.length, 2);
  });
const caseInput = (id = 'proper-1N') => {
  const c = oracle.cases.find((c) => c.id === id)!;
  return fixture(c.supplier, c.ledger);
};
void test('all physical rows remain: amount-only residual is never forced into the group', async () => {
  const { input } = caseInput();
  const r = await searchInvoiceOverlaps(input);
  const component = r.components[0];
  assert.equal(component.candidateRowKeys.length, 3);
  assert.equal(component.rowKeys.length, 4);
  assert.equal(component.residualRowKeys.length, 1);
  assert.ok(
    r.candidates[0].evidence.residualRowKeys.includes(
      component.residualRowKeys[0],
    ),
  );
});
void test('last unread shared invoice blocks affected subset without losing physical row', async () => {
  const { files, mappings } = caseInput();
  files[1].sheets[0].rows.push([
    'A',
    '',
    'broken',
    '2026-09-01',
    'Invoice',
    'TAIL',
  ]);
  const fresh = prepareVerifiedSources(files, mappings, scope, [
    'supplier',
    'ledger',
  ]);
  const input = {
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      fresh.sources as [SourceResult, SourceResult],
      scope,
    ),
    scope,
    revision: 'malformed-tail',
  };
  const r = await searchInvoiceOverlaps(input);
  assert.ok(r.components[0].reasons.includes('unread-competitor'));
  assert.ok(r.rows.some((row) => row.disposition === 'error'));
  assert.equal(r.candidates[0].status, 'needs-review');
});
void test('missing safe identity on a late unread row blocks source, not just known candidates', async () => {
  const { files, mappings } = caseInput();
  files[1].sheets[0].rows.push(['', '', 'broken', '2026-09-01', 'Invoice', '']);
  const fresh = prepareVerifiedSources(files, mappings, scope, [
    'supplier',
    'ledger',
  ]);
  const r = await searchInvoiceOverlaps({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      fresh.sources as [SourceResult, SourceResult],
      scope,
    ),
    scope,
    revision: 'unknown-tail',
  });
  assert.ok(r.reasons.includes('unknown-membership'));
  assert.ok(r.candidates.every((c) => c.status === 'needs-review'));
});
void test('same-side repeated voucher cannot manufacture distinct invoice parts', async () => {
  const { input } = caseInput();
  input.sources[1].transactions[1].voucherReference =
    input.sources[1].transactions[0].voucherReference;
  input.sources[1].physicalRows[2].identities =
    input.sources[1].physicalRows[2].identities.map((i) =>
      i.role === 'voucher'
        ? { ...i, value: input.sources[1].transactions[0].voucherReference! }
        : i,
    );
  const r = await searchInvoiceOverlaps(input);
  assert.ok(r.candidates[0].reasons.includes('duplicate-invoice-members'));
});
void test('role/currency/sign/date/source errors are hard, and no source-ID flag alone approves', async () => {
  for (const mutate of [
    (i: InvoiceOverlapSearchInput) => {
      i.sources[0].readingBindingValid = undefined;
    },
    (i: InvoiceOverlapSearchInput) => {
      i.sources[1].transactions[0].currency = 'USD';
    },
    (i: InvoiceOverlapSearchInput) => {
      i.sources[1].transactions[0].date = '2026-10-01';
    },
    (i: InvoiceOverlapSearchInput) => {
      i.sources[0].sourceHash = i.sources[1].sourceHash;
    },
    (i: InvoiceOverlapSearchInput) => {
      i.scope.coverageConfirmed = false;
    },
    (i: InvoiceOverlapSearchInput) => {
      i.revision = '';
    },
  ]) {
    const { input } = caseInput();
    mutate(input);
    const r = await searchInvoiceOverlaps(input);
    assert.ok(
      r.candidates.every(
        (c) =>
          c.status === 'needs-review' &&
          c.reasons.some((reason) =>
            INVOICE_OVERLAP_HARD_REASONS.includes(reason),
          ),
      ),
    );
    assert.deepEqual(r.matches, []);
  }
});
void test('row omissions and role identity conflicts never become clean proper subsets', async () => {
  const { input } = caseInput();
  input.sources[1].physicalRows.pop();
  const r = await searchInvoiceOverlaps(input);
  assert.ok(r.candidates[0].reasons.includes('physical-membership-incomplete'));
});
void test('every cap can only decrease and truncation never announces uniqueness', async () => {
  for (const limits of [
    { physicalRows: 2 },
    { expansions: 5 },
    { componentRows: 3 },
    { candidates: 1 },
  ]) {
    const { input } = caseInput('overlapping-alternatives');
    input.limits = limits;
    const r = await searchInvoiceOverlaps(input);
    assert.equal(r.searchComplete, false);
    assert.ok(r.reasons.includes('resource-limit'));
    assert.ok(r.candidates.every((c) => c.status === 'needs-review'));
    assert.ok(r.components.every((c) => !c.complete));
  }
});
void test('sixteen applies to BOTH sides combined; a seventeenth row cannot escape', async () => {
  const c = oracle.cases.find((c) => c.id === 'proper-1N')!;
  const supplier = Array.from({ length: 8 }, (_, i) => ({
    ...c.supplier[0],
    id: String(i),
    minor: 2 ** i,
    voucher: `S${i}`,
  }));
  const ledger = Array.from({ length: 9 }, (_, i) => ({
    ...c.ledger[0],
    id: String(i),
    minor: 3 ** i,
    voucher: `L${i}`,
  }));
  const r = await searchInvoiceOverlaps(fixture(supplier, ledger).input);
  assert.equal(r.searchComplete, false);
  assert.ok(r.reasons.includes('resource-limit'));
});
void test('native AbortController event cancels active subset work after progress yield', async () => {
  const c = oracle.cases[0];
  const supplier = Array.from({ length: 7 }, (_, i) => ({
    ...c.supplier[0],
    id: String(i),
    minor: 2 ** i,
    voucher: `S${i}`,
  }));
  const ledger = Array.from({ length: 7 }, (_, i) => ({
    ...c.ledger[0],
    id: String(i),
    minor: 3 ** i,
    voucher: `L${i}`,
  }));
  const { input } = fixture(supplier, ledger);
  const controller = new AbortController();
  input.signal = controller.signal;
  let progressed = false;
  input.onProgress = (p) => {
    if (p.phase === 'subsets' && !progressed) {
      progressed = true;
      setTimeout(() => controller.abort(), 0);
    }
  };
  const r = await searchInvoiceOverlaps(input);
  assert.equal(progressed, true);
  assert.equal(r.searchComplete, false);
  assert.ok(r.reasons.includes('cancelled'));
  assert.ok(r.candidates.every((c) => c.status === 'needs-review'));
  assert.deepEqual(r.matches, []);
});
void test('input is owned before await and later caller edits cannot change snapshot or candidate totals', async () => {
  const { input } = caseInput();
  const original = structuredClone(input);
  const promise = searchInvoiceOverlaps(input);
  input.sources[0].transactions[0].amountMinor = 9;
  input.sources[0].transactions[0].amount = 9;
  input.revision = 'later';
  const r = await promise;
  const expected = await searchInvoiceOverlaps(original);
  assert.deepEqual(r, expected);
  assert.equal(r.candidates[0].totalMinor, 1000);
});
void test('canonical snapshots and candidate IDs ignore incidental input ordering but bind every residual', async () => {
  const { input } = caseInput();
  const original = await searchInvoiceOverlaps(input);
  const reversed = structuredClone(input);
  for (const source of reversed.sources) {
    source.transactions.reverse();
    source.physicalRows.reverse();
    for (const row of source.physicalRows) row.identities.reverse();
  }
  const reordered = await searchInvoiceOverlaps(reversed);
  assert.equal(original.snapshotKey, reordered.snapshotKey);
  assert.deepEqual(original.candidates, reordered.candidates);
  reversed.sources[1].transactions[2].amountMinor = 701;
  reversed.sources[1].transactions[2].amount = 701;
  assert.notEqual(
    (await searchInvoiceOverlaps(reversed)).snapshotKey,
    original.snapshotKey,
  );
});

void test('valid differently typed physical identity competitor is retained for review', async () => {
  const { files, mappings } = caseInput();
  for (const file of files) {
    file.sheets[0].rows[0].push('Bank Reference');
    for (const row of file.sheets[0].rows.slice(1)) row.push('');
  }
  files[1].sheets[0].rows.push([
    'A',
    '',
    '-900',
    '2026-09-01',
    'Payment',
    'TAIL',
    'BANK-TAIL',
  ]);
  const fresh = prepareVerifiedSources(files, mappings, scope, [
    'supplier',
    'ledger',
  ]);
  const r = await searchInvoiceOverlaps({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      fresh.sources as [SourceResult, SourceResult],
      scope,
    ),
    scope,
    revision: 'valid-role-tail',
  });
  assert.equal(r.candidates[0].status, 'needs-review');
  assert.ok(r.candidates[0].reasons.includes('identity-competition'));
  assert.ok(r.components[0].competingRows.length);
  assert.ok(r.rows.some((row) => row.amountMinor === -900));
});
void test('native AbortController event cancels component construction as well as subsets', async () => {
  const c = oracle.cases[0];
  const { input } = fixture(
    Array.from({ length: 3 }, (_, i) => ({
      ...c.supplier[0],
      id: String(i),
      minor: i + 1,
      voucher: `S${i}`,
    })),
    Array.from({ length: 3 }, (_, i) => ({
      ...c.ledger[0],
      id: String(i),
      minor: i + 1,
      voucher: `L${i}`,
    })),
  );
  const aborter = new AbortController();
  input.signal = aborter.signal;
  let progressed = false;
  input.onProgress = (p) => {
    if (p.phase === 'components' && !progressed) {
      progressed = true;
      setTimeout(() => aborter.abort(), 0);
    }
  };
  const result = await searchInvoiceOverlaps(input);
  assert.equal(progressed, true);
  assert.equal(result.searchComplete, false);
  assert.ok(result.reasons.includes('cancelled'));
  assert.ok(
    result.candidates.every((candidate) => candidate.status === 'needs-review'),
  );
});
void test('an initial native abort leaves every physical row visible and grants no candidate receipt', async () => {
  const { input } = caseInput();
  const controller = new AbortController();
  controller.abort();
  input.signal = controller.signal;
  const r = await searchInvoiceOverlaps(input);
  assert.equal(r.searchComplete, false);
  assert.ok(r.reasons.includes('cancelled'));
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.matches, []);
});

void test('sparse sixteen-row identity completes with every alternative and seven visible residuals', async () => {
  const c = oracle.cases[0];
  const supplier = Array.from({ length: 8 }, (_, i) => ({
    ...c.supplier[0],
    id: String(i),
    minor: 2 ** i,
    voucher: `S${i}`,
  }));
  const ledger = Array.from({ length: 8 }, (_, i) => ({
    ...c.ledger[0],
    id: String(i),
    minor: i === 0 ? 255 : 1000 * 2 ** (i - 1),
    voucher: `L${i}`,
  }));
  const r = await searchInvoiceOverlaps(fixture(supplier, ledger).input);
  assert.equal(r.searchComplete, true);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].totalMinor, 255);
  assert.equal(r.candidates[0].supplierIds.length, 8);
  assert.equal(r.candidates[0].ledgerIds.length, 1);
  assert.equal(r.components[0].rowKeys.length, 16);
  assert.equal(r.components[0].residualRowKeys.length, 7);
  assert.ok(r.counters.expansions < 50000);
});

void test('a physically parsed unknown-role tail cannot be resolved as mere reviewable competition', async () => {
  const { files, mappings } = caseInput();
  files[1].sheets[0].rows.push([
    'A',
    '',
    '900',
    '2026-09-01',
    'Unfamiliar role',
    'TAIL',
  ]);
  const fresh = prepareVerifiedSources(files, mappings, scope, [
    'supplier',
    'ledger',
  ]);
  const r = await searchInvoiceOverlaps({
    sources: invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      fresh.sources as [SourceResult, SourceResult],
      scope,
    ),
    scope,
    revision: 'unknown-role-tail',
  });
  assert.ok(r.candidates[0].reasons.includes('unread-competitor'));
  assert.ok(r.components[0].competingRows.length);
  assert.equal(r.candidates[0].status, 'needs-review');
});
void test('known competitor original sign, currency and cutoff failures are hard blockers', async () => {
  for (const change of ['sign', 'currency', 'date']) {
    const { files, mappings } = caseInput();
    for (const file of files) {
      file.sheets[0].rows[0].push('Bank Reference');
      for (const row of file.sheets[0].rows.slice(1)) row.push('');
    }
    files[1].sheets[0].rows.push([
      'A',
      '',
      '-900',
      '2026-09-01',
      'Payment',
      'TAIL',
      'BANK-TAIL',
    ]);
    const fresh = prepareVerifiedSources(files, mappings, scope, [
      'supplier',
      'ledger',
    ]);
    const sources = invoiceGroupSourcesFromVerifiedReading(
      files,
      mappings,
      fresh.sources as [SourceResult, SourceResult],
      scope,
    );
    const tail = sources[1].transactions.find(
      (t) => t.documentType === 'Payment',
    )!;
    if (change === 'sign') {
      tail.amountMinor = 900;
      tail.amount = 900;
    }
    if (change === 'currency') tail.currency = 'USD';
    if (change === 'date') tail.date = '2026-10-01';
    const r = await searchInvoiceOverlaps({
      sources,
      scope,
      revision: `competitor-${change}`,
    });
    assert.ok(
      r.candidates[0].reasons.some((reason) =>
        INVOICE_OVERLAP_HARD_REASONS.includes(reason),
      ),
    );
    assert.equal(r.candidates[0].status, 'needs-review');
  }
});
