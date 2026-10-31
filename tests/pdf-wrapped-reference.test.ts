// SUP-2 S2: a reference cell that wraps in a supplier PDF. The reader lays a
// PDF out as lines, so the rest of the cell becomes its own line, holding text
// in the reference column and nothing in the date or amount cells. The row
// beside it carries only part of its reference. Contract: the wrapped
// reference is read whole or flagged; never approved on a fragment
// (audit/hard-cases/pdf-composite.mjs SPLITREF, and the 046 note "the wrapped
// reference ... are review or refusal cases").
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { exportWorkbook, readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import { restoreSession, saveSession } from '../lib/reconciliation/session.ts';
import type { Mapping, Scope, SourceFile } from '../lib/reconciliation/types.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const WRAPPED = /قد يكون مرجع الصف \d+ ملتفًا/;
const X = [30, 172, 315, 452];
const CUTS = [24, 48, 71];
type Line = [string, string, string, string];
const text = (x: number, y: number, value: string) =>
  `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${value.replace(/[\\()]/g, (c) => '\\' + c)}) Tj ET`;
const HEADER: Line = ['Date', 'Invoice No', 'Amount', 'Description'];
/** One page: the header, then each line 12pt below the one before. */
const pdf = (lines: Line[], header = HEADER) =>
  syntheticPdf(
    [[]],
    10,
    [header, ...lines]
      .flatMap((line, i) =>
        line.flatMap((value, column) =>
          value ? [text(X[column], 760 - i * 12, value)] : [],
        ),
      )
      .join('\n'),
  );
const csv = (rows: string[][]) =>
  new TextEncoder().encode(rows.map((r) => r.join(',')).join('\r\n'))
    .buffer as ArrayBuffer;
const ledgerBytes = (rows: [string, string, string][]) =>
  csv([
    ['Date', 'Invoice No', 'Amount', 'Description'],
    ...rows.map(([date, ref, amount]) => [date, ref, amount, 'Posted']),
  ]);
async function run(lines: Line[], ledgerRows: [string, string, string][]) {
  const supplier = await readFile('supplier.pdf', pdf(lines), CUTS);
  const ledger = await readFile('ledger.csv', ledgerBytes(ledgerRows));
  const mappings = [
    { ...selectImportMapping(supplier, 'supplier').mapping, pdfReviewed: true },
    selectImportMapping(ledger, 'ledger').mapping,
  ] as [Mapping, Mapping];
  const a = normalizeSource(supplier, mappings[0], scope, 'supplier');
  const b = normalizeSource(ledger, mappings[1], scope, 'ledger');
  return {
    a,
    files: [supplier, ledger] as [SourceFile, SourceFile],
    mappings,
    result: compare(a, b, scope),
  };
}
const approved = (r: ReturnType<typeof compare>) =>
  r.cases
    .filter((c) => c.status === 'Matched')
    .map((c) => c.supplierMembers.map((t) => t.reference).join('+'))
    .sort();
const flagged = (r: ReturnType<typeof compare>, reference: string) =>
  r.cases.find(
    (c) =>
      c.supplierMembers.some((t) => t.reference === reference) &&
      c.status === 'Needs Review' &&
      c.evidence.some((e) => WRAPPED.test(e)),
  );

// INV-2026-80441 wraps after "INV-2026-8"; the rest, "0441", is a line of
// its own. INV-C1 is the next row, INV-C2 a row away from the wrap.
const wrappedBelow: Line[] = [
  ['2026-07-09', 'INV-2026-8', '1131.52', 'Goods'],
  ['', '0441', '', ''],
  ['2026-07-10', 'INV-C1', '200.00', 'Goods'],
  ['2026-07-11', 'INV-C2', '300.00', 'Goods'],
];
const ledgerHoldingTheFragment: [string, string, string][] = [
  ['2026-07-09', 'INV-2026-8', '1131.52'],
  ['2026-07-10', 'INV-C1', '200.00'],
  ['2026-07-11', 'INV-C2', '300.00'],
];

void test('S2 a row beside the rest of a wrapped reference is never approved on its fragment', async () => {
  const { a, result } = await run(wrappedBelow, ledgerHoldingTheFragment);
  assert.deepEqual(
    a.transactions.map((t) => t.reference),
    ['INV-2026-8', 'INV-C1', 'INV-C2'],
    'read as written; nothing joined',
  );
  // The rest of the cell stays a source row with its reason.
  assert.equal(a.errors.length, 1);
  assert.equal(a.errors[0].row, 3);
  // Either neighbour may own "0441": both are flagged, neither approved.
  assert.deepEqual(approved(result), ['INV-C2']);
  for (const reference of ['INV-2026-8', 'INV-C1']) {
    const c = flagged(result, reference);
    assert.ok(c, reference);
    assert.ok(c.evidence.some((e) => e.includes('«0441»')), reference);
  }
  assert.equal(result.caseCounts.autoMatchedCases, 1);
});

void test('S2 the fragment is not approved through a group of ledger rows either', async () => {
  const { result } = await run(wrappedBelow, [
    ['2026-07-09', 'INV-2026-8', '600.00'],
    ['2026-07-09', 'INV-2026-8', '531.52'],
    ['2026-07-10', 'INV-C1', '200.00'],
    ['2026-07-11', 'INV-C2', '300.00'],
  ]);
  assert.deepEqual(approved(result), ['INV-C2']);
  // The group's own reasons lead its case; the wrap stays on the member and
  // in the comparison's diagnostics.
  const c = result.cases.find((x) =>
    x.supplierMembers.some((t) => t.reference === 'INV-2026-8'),
  )!;
  assert.equal(c.status, 'Needs Review');
  assert.ok(
    c.supplierMembers[0].referenceEvidenceIssues?.some((e) => WRAPPED.test(e)),
  );
  assert.ok(
    result.diagnostics.some(
      (d) =>
        d.code === 'REFERENCE_EVIDENCE_UNVERIFIED' &&
        d.transactionIds.includes(c.supplierMembers[0].id) &&
        WRAPPED.test(d.message),
    ),
  );
});

void test('S2 the start of a cell wrapped above its row flags that row', async () => {
  // A cell centred on its row: its first line sits above the row's line.
  const { result } = await run(
    [
      ['', 'PART-', '', ''],
      ['2026-07-09', 'INV-77', '1131.52', 'Goods'],
      ['2026-07-11', 'INV-C2', '300.00', 'Goods'],
    ],
    [
      ['2026-07-09', 'INV-77', '1131.52'],
      ['2026-07-11', 'INV-C2', '300.00'],
    ],
  );
  assert.deepEqual(approved(result), ['INV-C2']);
  assert.ok(flagged(result, 'INV-77'));
});

void test('S2 near cases: a neighbouring line with a date or an amount is not the rest of a reference', async () => {
  const near: [string, Line, string[]][] = [
    ['a line with an amount and no date', ['', 'INV-D1', '50.00', 'Goods'], ['INV-2026-8', 'INV-C2']],
    ['a line with a date and no amount', ['2026-07-10', 'INV-D1', '', 'Goods'], ['INV-2026-8', 'INV-C2']],
    // A wrapped description already stops every automatic match (an error
    // row with no identity to isolate it); it is not a wrapped reference.
    ['a wrapped description', ['', '', '', 'continued'], []],
  ];
  for (const [why, line, expected] of near) {
    const { result } = await run(
      [['2026-07-09', 'INV-2026-8', '1131.52', 'Goods'], line, ['2026-07-11', 'INV-C2', '300.00', 'Goods']],
      [
        ['2026-07-09', 'INV-2026-8', '1131.52'],
        ['2026-07-11', 'INV-C2', '300.00'],
      ],
    );
    assert.deepEqual(approved(result), expected, why);
    assert.ok(!result.cases.some((c) => c.evidence.some((e) => WRAPPED.test(e))), why);
  }
});

void test('S2 debit and credit columns: an amount in either is not the rest of a reference', async () => {
  const header: Line = ['Date', 'Invoice No', 'Debit', 'Credit'];
  const flags = async (middle: Line) => {
    const file = await readFile(
      'split.pdf',
      pdf(
        [
          ['2026-07-09', 'INV-S1', '', '100.00'],
          middle,
          ['2026-07-11', 'INV-S3', '', '30.00'],
        ],
        header,
      ),
      CUTS,
    );
    const mapping = { ...selectImportMapping(file, 'supplier').mapping, pdfReviewed: true };
    assert.equal(mapping.mode, 'split');
    return normalizeSource(file, mapping, scope, 'supplier')
      .transactions.filter((t) => t.referenceEvidenceIssues?.some((e) => WRAPPED.test(e)))
      .map((t) => t.reference);
  };
  assert.deepEqual(await flags(['', '0441', '', '']), ['INV-S1', 'INV-S3']);
  assert.deepEqual(await flags(['', 'INV-S2', '50.00', '']), []);
  assert.deepEqual(await flags(['', 'INV-S2', '', '50.00']), []);
});

void test('S2 a rest of two lines stops every automatic match, as an unidentified row does', async () => {
  // Each rest line is beside another, so neither can be isolated by its own
  // text. Conservative: nothing in the file is approved automatically.
  const { result } = await run(
    [
      ['2026-07-09', 'INV-77', '1131.52', 'Goods'],
      ['', 'A1', '', ''],
      ['', 'B2', '', ''],
      ['2026-07-10', 'INV-C1', '200.00', 'Goods'],
      ['2026-07-11', 'INV-C2', '300.00', 'Goods'],
    ],
    [
      ['2026-07-09', 'INV-77', '1131.52'],
      ['2026-07-10', 'INV-C1', '200.00'],
      ['2026-07-11', 'INV-C2', '300.00'],
    ],
  );
  assert.deepEqual(approved(result), []);
  assert.ok(flagged(result, 'INV-77'));
  assert.ok(flagged(result, 'INV-C1'));
});

void test('S2 a CSV row is a row: the same cells in a CSV raise no wrap flag', async () => {
  const supplier = await readFile(
    'supplier.csv',
    csv([['Date', 'Invoice No', 'Amount', 'Description'], ...wrappedBelow]),
  );
  const ledger = await readFile('ledger.csv', ledgerBytes(ledgerHoldingTheFragment));
  const result = compare(
    normalizeSource(supplier, selectImportMapping(supplier, 'supplier').mapping, scope, 'supplier'),
    normalizeSource(ledger, selectImportMapping(ledger, 'ledger').mapping, scope, 'ledger'),
    scope,
  );
  assert.ok(!result.cases.some((c) => c.evidence.some((e) => WRAPPED.test(e))));
});

void test('S2 the flag survives save, restore and export from the original bytes', async () => {
  const { files, mappings } = await run(wrappedBelow, ledgerHoldingTheFragment);
  const session = await saveSession({
    files,
    mappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { checked: false, name: '', notes: '' },
  });
  const restored = (await restoreSession(session)).result;
  assert.deepEqual(approved(restored), ['INV-C2']);
  assert.ok(flagged(restored, 'INV-2026-8'));
  const book = await exportWorkbook(restored, files, {
    checked: false,
    name: '',
    notes: '',
  });
  assert.ok(book.byteLength > 0);
});

void test('S3 a balance line in the reference column is the statement\'s own line, not the rest of a reference', async () => {
  // A right-to-left statement's opening line can stand in this column (S3,
  // S07); a document number never ends in a balance label.
  const { result } = await run(
    [
      ['', 'Opening balance', '', ''],
      ['2026-07-09', 'INV-2026-8', '1131.52', 'Goods'],
      ['2026-07-11', 'INV-C2', '300.00', 'Goods'],
    ],
    [
      ['2026-07-09', 'INV-2026-8', '1131.52'],
      ['2026-07-11', 'INV-C2', '300.00'],
    ],
  );
  assert.deepEqual(approved(result), ['INV-2026-8', 'INV-C2']);
  assert.ok(!result.cases.some((c) => c.evidence.some((e) => WRAPPED.test(e))));
});
