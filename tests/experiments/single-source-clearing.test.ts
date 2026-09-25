// EXPERIMENT ONLY — see ./single-source-clearing.ts. Run it directly:
//   node --experimental-strip-types --test tests/experiments/*.test.ts
// Every source is synthetic and small enough to check by hand. Amounts are in
// minor units (SAR, two places): 1,000.00 is 100000.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  verifyDirectionEvidence,
} from '../../lib/reconciliation/io.ts';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../../lib/reconciliation/core.ts';
import {
  buildReconciliationCases,
  identityConflicts,
} from '../../lib/reconciliation/cases.ts';
import {
  assertInputFormats,
  isInputReadinessRejection,
} from '../../lib/reconciliation/input-readiness.ts';
import { inferStatementDirection } from '../../lib/reconciliation/statement-direction.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import type {
  Decision,
  Mapping,
  Scope,
  SourceFile,
  SourceResult,
  Transaction,
} from '../../lib/reconciliation/types.ts';
import {
  answerNumberFormat,
  directionMapping,
  directionRows,
} from '../helpers/recompute-cases.ts';
import {
  clearSingleSource,
  type ClearingDecision,
  type ClearingReason,
} from './single-source-clearing.ts';

// One clearing account in the general ledger. `supplier` is left empty: the
// reader never uses it, and compare() needs it only for a balance
// reconciliation.
const scope: Scope = {
  supplier: '',
  entity: 'Synthetic Entity',
  account: '2150',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-09-30',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const headers = [
  'Date',
  'Account',
  'Clearing Ref',
  'Description',
  'Amount',
  'Currency',
];
const mapping: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  description: 3,
  amount: 4,
  currencyColumn: 5,
};
const post = (
  reference: string,
  amount: string,
  { date = '2026-09-10', account = '2150', currency = 'SAR' } = {},
) => [date, account, reference, 'Synthetic posting', amount, currency];
const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows
      .map((row) => row.map((c) => '"' + c.replace(/"/g, '""') + '"').join(','))
      .join('\n'),
  ).buffer as ArrayBuffer;

/** The production reading path for one source, each gate as it is today. */
async function read(
  rows: string[][],
  side: 'supplier' | 'ledger' = 'ledger',
  head = headers,
  map = mapping,
) {
  const file = await readFile('clearing-2150.csv', csv([head, ...rows]));
  assertInputFormats([file], [map], scope);
  const proven = verifyDirectionEvidence(file, map, scope.decimals);
  return { file, source: normalizeSource(file, proven, scope, side) };
}

const clearingBases: ClearingReason[] = [
  'SHARED_REFERENCE_NETS_TO_ZERO',
  'ACCOUNTANT_DECISION',
];
/** What every case must hold, whatever its outcome. */
function assertInvariants(
  file: SourceFile,
  source: SourceResult,
  cases: ReturnType<typeof clearSingleSource>['cases'],
) {
  const ids = cases.flatMap((c) => c.members.map((t) => t.id));
  // Every read row ends in exactly one case; none is lost or used twice.
  assert.equal(new Set(ids).size, ids.length, 'a row is in two cases');
  assert.deepEqual(
    [...ids].sort(),
    source.transactions.map((t) => t.id).sort(),
    'every read row is in a case',
  );
  // Every row of the sheet, the heading included, is read, excluded with a
  // reason, or in error: the reader already accounts for all of them.
  const errorRows = new Set(
    source.errors.filter((e) => e.row > 0).map((e) => e.row),
  );
  assert.equal(
    source.transactions.length + source.excluded.length + errorRows.size,
    file.sheets[0].rows.length,
    'every source row is accounted for',
  );
  // Nothing is created or lost: the cases add up to what was read.
  assert.equal(
    cases.reduce((total, c) => total + c.net, 0),
    source.total,
  );
  for (const c of cases) {
    if (c.status === 'cleared') {
      // Only evidence or a decision ever clears; equal amounts never do.
      assert.ok(
        clearingBases.includes(c.reason),
        `${c.id} cleared on ${c.reason}`,
      );
      assert.equal(c.net, 0, `${c.id} nets to zero`);
      assert.ok(c.basis, `${c.id} has a basis`);
      assert.ok(c.members.some((t) => t.amount > 0));
      assert.ok(c.members.some((t) => t.amount < 0));
    }
    // The trace leads back to the original cell.
    for (const [i, trace] of c.trace.entries()) {
      const member = c.members[i];
      assert.equal(trace.sourceRowId, member.id);
      assert.equal(trace.sheet, file.sheets[0].name);
      assert.equal(
        file.sheets[0].rows[trace.row - 1][mapping.amount],
        member.originalAmount,
      );
    }
  }
}
const outcome = (cases: ReturnType<typeof clearSingleSource>['cases']) =>
  cases.map((c) => [c.status, c.reason, c.members.map((t) => t.row)]);
const row = (source: SourceResult, n: number) =>
  source.transactions.find((t) => t.row === n)!;

// ---------------------------------------------------------------- reuse

test('reuse: one source goes through the production reader and its gates unchanged', async () => {
  const { source } = await read([
    post('CLR-1', '1000.00'),
    post('CLR-1', '-1000.00'),
  ]);
  assert.deepEqual(source.errors, []);
  assert.deepEqual(
    source.transactions.map((t) => [t.row, t.amount, t.reference, t.currency]),
    [
      [2, 100000, 'CLR-1', 'SAR'],
      [3, -100000, 'CLR-1', 'SAR'],
    ],
  );
  // The format guard takes one source as it is: an unanswered reading is
  // refused with its own code, and the recorded answer lets it through.
  const kwd = { ...scope, currency: 'KWD', decimals: 3 };
  const file = await readFile(
    'kwd.csv',
    csv([
      ['Date', 'Reference', 'Amount'],
      ['2026-09-01', 'CLR-2', '54.321'],
      ['2026-09-02', 'CLR-2', '-54.321'],
    ]),
  );
  const bare = inferMapping(file);
  assert.throws(
    () => assertInputFormats([file], [bare], kwd),
    (e) => isInputReadinessRejection(e, 'FORMAT_AMBIGUOUS_UNRESOLVED'),
  );
  assertInputFormats([file], [answerNumberFormat(file, bare, kwd, 'dot')], kwd);
  // Debit and credit columns with a running balance: the direction proof
  // works on one source, and refuses a claim the source does not prove.
  const split = await readFile('split.csv', csv(directionRows(false)));
  const proof = inferStatementDirection(split, directionMapping, 2)!;
  assert.ok(proof);
  const claimed = {
    ...directionMapping,
    multiplier: proof.multiplier,
    directionEvidence: proof,
  };
  assert.deepEqual(verifyDirectionEvidence(split, claimed, 2), claimed);
  assert.throws(() =>
    verifyDirectionEvidence(
      split,
      {
        ...claimed,
        multiplier: -proof.multiplier as 1 | -1,
        directionEvidence: {
          ...proof,
          multiplier: -proof.multiplier as 1 | -1,
        },
      },
      2,
    ),
  );
});

test('side: a fixed side labels the rows and changes nothing else', async () => {
  const rows = [
    post('CLR-1', '1000.00'),
    post('CLR-1', '-1000.00'),
    post('', '75.00'),
  ];
  const asLedger = (await read(rows, 'ledger')).source;
  const asSupplier = (await read(rows, 'supplier')).source;
  const unlabelled = (s: SourceResult) =>
    s.transactions.map(({ id: _id, side: _side, ...rest }) => rest);
  assert.deepEqual(unlabelled(asSupplier), unlabelled(asLedger));
  assert.deepEqual(
    { ...asSupplier, transactions: [] },
    { ...asLedger, transactions: [] },
  );
  // The prototype never reads side: the same rows give the same cases.
  const shape = (s: SourceResult) => outcome(clearSingleSource(s).cases);
  assert.deepEqual(shape(asSupplier), shape(asLedger));
  // side is part of the row id, so the same physical row read twice becomes
  // two rows. A single-source path must read each source once.
  assert.notEqual(asSupplier.transactions[0].id, asLedger.transactions[0].id);
});

// ---------------------------------------------------------------- A–G

test('A: a 1:1 pair that shares a clearing reference is cleared', async () => {
  const { file, source } = await read([
    post('CLR-1', '1000.00'),
    post('CLR-1', '-1000.00'),
  ]);
  const { cases } = clearSingleSource(source);
  assertInvariants(file, source, cases);
  assert.deepEqual(outcome(cases), [
    ['cleared', 'SHARED_REFERENCE_NETS_TO_ZERO', [2, 3]],
  ]);
  assert.equal(cases[0].basis, 'shared-clearing-reference');
});

test('B: 600 + 400 = 1,000 is not evidence; a shared reference is', async () => {
  const unproven = await read([
    post('INV-9', '1000.00'),
    post('PAY-1', '-600.00'),
    post('PAY-2', '-400.00'),
  ]);
  const before = clearSingleSource(unproven.source).cases;
  assertInvariants(unproven.file, unproven.source, before);
  assert.equal(unproven.source.total, 0, 'the three rows balance');
  assert.deepEqual(outcome(before), [
    ['open', 'NO_COUNTERPART', [2]],
    ['open', 'NO_COUNTERPART', [3]],
    ['open', 'NO_COUNTERPART', [4]],
  ]);
  const proven = await read([
    post('CLR-7', '1000.00'),
    post('CLR-7', '-600.00'),
    post('CLR-7', '-400.00'),
  ]);
  const after = clearSingleSource(proven.source).cases;
  assertInvariants(proven.file, proven.source, after);
  assert.deepEqual(outcome(after), [
    ['cleared', 'SHARED_REFERENCE_NETS_TO_ZERO', [2, 3, 4]],
  ]);
  // The same evidence with amounts that do not offset is a question, not a
  // silent partial clearing.
  const residual = await read([
    post('CLR-7', '1000.00'),
    post('CLR-7', '-600.00'),
    post('CLR-7', '-300.00'),
  ]);
  const left = clearSingleSource(residual.source).cases;
  assertInvariants(residual.file, residual.source, left);
  assert.deepEqual(outcome(left), [
    ['needs-review', 'SHARED_REFERENCE_RESIDUAL', [2, 3, 4]],
  ]);
  assert.equal(left[0].net, 10000);
});

test('C: several ways to reach zero are a question, never a choice', async () => {
  // Inside one reference: +1,000 −1,000 −600 −400. Two subsets net to zero
  // (listed by hand below), the bucket as a whole does not.
  const inBucket = await read([
    post('CLR-3', '1000.00'),
    post('CLR-3', '-1000.00'),
    post('CLR-3', '-600.00'),
    post('CLR-3', '-400.00'),
  ]);
  const zeroSubsets = [
    [2, 3],
    [2, 4, 5],
  ];
  for (const rows of zeroSubsets)
    assert.equal(
      rows.reduce((t, n) => t + row(inBucket.source, n).amount, 0),
      0,
    );
  const bucket = clearSingleSource(inBucket.source).cases;
  assertInvariants(inBucket.file, inBucket.source, bucket);
  assert.deepEqual(outcome(bucket), [
    ['needs-review', 'SHARED_REFERENCE_RESIDUAL', [2, 3, 4, 5]],
  ]);
  // Without evidence: two debits and two credits of 1,000. Two pairings are
  // possible; neither is picked.
  const noEvidence = await read([
    post('', '1000.00'),
    post('', '1000.00'),
    post('', '-1000.00'),
    post('', '-1000.00'),
  ]);
  const pairs = clearSingleSource(noEvidence.source).cases;
  assertInvariants(noEvidence.file, noEvidence.source, pairs);
  assert.deepEqual(outcome(pairs), [
    ['needs-review', 'AMBIGUOUS_AMOUNT_CANDIDATES', [2, 3, 4, 5]],
  ]);
});

test('D: a row that could complete two groups completes neither without evidence', async () => {
  // CLR-X and CLR-Y are each 500 short; the unreferenced −500 would close
  // either one.
  const rows = [
    post('CLR-X', '1000.00'),
    post('CLR-X', '-500.00'),
    post('CLR-Y', '800.00'),
    post('CLR-Y', '-300.00'),
    post('', '-500.00'),
  ];
  const competing = await read(rows);
  const cases = clearSingleSource(competing.source).cases;
  assertInvariants(competing.file, competing.source, cases);
  for (const group of [
    [2, 3, 6],
    [4, 5, 6],
  ])
    assert.equal(
      group.reduce((t, n) => t + row(competing.source, n).amount, 0),
      0,
    );
  assert.deepEqual(outcome(cases), [
    ['needs-review', 'SHARED_REFERENCE_RESIDUAL', [2, 3]],
    ['needs-review', 'SHARED_REFERENCE_RESIDUAL', [4, 5]],
    ['open', 'NO_COUNTERPART', [6]],
  ]);
  // Evidence that names one of them settles it, and only that one.
  rows[4] = post('CLR-X', '-500.00');
  const settled = await read(rows);
  const after = clearSingleSource(settled.source).cases;
  assertInvariants(settled.file, settled.source, after);
  assert.deepEqual(outcome(after), [
    ['cleared', 'SHARED_REFERENCE_NETS_TO_ZERO', [2, 3, 6]],
    ['needs-review', 'SHARED_REFERENCE_RESIDUAL', [4, 5]],
  ]);
});

test('E: open items stay visible even when the whole account nets to zero', async () => {
  const { file, source } = await read([
    post('CLR-1', '1000.00'),
    post('CLR-1', '-1000.00'),
    post('', '250.00'),
    post('', '-100.00'),
    post('', '-150.00'),
    post('', '75.00'),
    post('', '-75.00'),
  ]);
  assert.equal(source.total, 0, 'the account balances overall');
  const { cases } = clearSingleSource(source);
  assertInvariants(file, source, cases);
  assert.deepEqual(outcome(cases), [
    ['cleared', 'SHARED_REFERENCE_NETS_TO_ZERO', [2, 3]],
    ['needs-review', 'AMOUNT_ONLY_CANDIDATE', [7, 8]],
    ['open', 'NO_COUNTERPART', [4]],
    ['open', 'NO_COUNTERPART', [5]],
    ['open', 'NO_COUNTERPART', [6]],
  ]);
});

test('F: currency, account and cutoff are enforced by the reader itself', async () => {
  // Another currency: the row is a reading error, not a transaction, and the
  // prototype approves nothing while the reading is incomplete.
  const currency = await read([
    post('CLR-1', '1000.00'),
    post('CLR-1', '-1000.00', { currency: 'USD' }),
  ]);
  assert.deepEqual(currency.source.errors, [
    { row: 3, message: 'عملة الصف لا تطابق العملة المؤكدة' },
  ]);
  const stopped = clearSingleSource(currency.source);
  assertInvariants(currency.file, currency.source, stopped.cases);
  assert.deepEqual(outcome(stopped.cases), [
    ['open', 'SOURCE_INCOMPLETE', [2]],
  ]);
  // Two accounts in one source, or an account other than the confirmed one.
  for (const accounts of [
    ['2150', '2160'],
    ['2160', '2160'],
  ]) {
    const mixed = await read([
      post('CLR-1', '1000.00', { account: accounts[0] }),
      post('CLR-1', '-1000.00', { account: accounts[1] }),
    ]);
    assert.ok(
      mixed.source.errors.some(
        (e) => e.row === 0 && /رقم الحساب/.test(e.message),
      ),
      accounts.join(),
    );
    const result = clearSingleSource(mixed.source);
    assertInvariants(mixed.file, mixed.source, result.cases);
    assert.ok(result.cases.every((c) => c.status === 'open'));
  }
  // After the cutoff: excluded with its reason; its partner stays open.
  const late = await read([
    post('CLR-9', '300.00', { date: '2026-10-02' }),
    post('CLR-9', '-300.00'),
  ]);
  assert.deepEqual(
    late.source.excluded.map((x) => [x.row, x.reason]),
    [
      [1, 'صف العناوين المؤكد'],
      [2, 'بعد تاريخ المقارنة'],
    ],
  );
  const lateCases = clearSingleSource(late.source).cases;
  assertInvariants(late.file, late.source, lateCases);
  assert.deepEqual(outcome(lateCases), [['open', 'NO_COUNTERPART', [3]]]);
});

test('G: an accountant confirms 1:N that the evidence cannot prove', async () => {
  const { file, source } = await read([
    post('INV-77', '1000.00'),
    post('PAY-1', '-250.00'),
    post('PAY-2', '-250.00'),
    post('PAY-3', '-500.00'),
  ]);
  const ids = source.transactions.map((t) => t.id);
  assert.deepEqual(
    outcome(clearSingleSource(source).cases).map((c) => c[0]),
    ['open', 'open', 'open', 'open'],
  );
  const decision: ClearingDecision = {
    memberIds: ids,
    basis: 'external-confirmation',
    note: 'Remittance advice RA-9 lists the three payments against INV-77 (synthetic).',
  };
  const { cases } = clearSingleSource(source, [decision]);
  assertInvariants(file, source, cases);
  assert.deepEqual(outcome(cases), [
    ['cleared', 'ACCOUNTANT_DECISION', [2, 3, 4, 5]],
  ]);
  assert.equal(cases[0].basis, 'accountant-decision');
  // The basis and the arithmetic are separate conditions; each can fail alone.
  const refusals: [string, ClearingDecision[]][] = [
    ['balanced, but no reason', [{ ...decision, note: ' ' }]],
    [
      'a reason, but it does not offset',
      [{ ...decision, memberIds: ids.slice(0, 3) }],
    ],
    [
      'a row used twice',
      [
        { ...decision, memberIds: ids.slice(0, 2) },
        { ...decision, memberIds: [ids[0], ids[2]] },
      ],
    ],
    ['one sign only', [{ ...decision, memberIds: ids.slice(1) }]],
  ];
  for (const [label, decisions] of refusals)
    assert.throws(
      () => clearSingleSource(source, decisions),
      /decision refused|two cases/,
      label,
    );
});

// ---------------------------------------------- what does not carry over

test('compare() pairs two copies of one source row by row, never the offset', async () => {
  const rows = [post('CLR-1', '1000.00'), post('CLR-1', '-1000.00')];
  const supplier = (await read(rows, 'supplier')).source;
  const ledger = (await read(rows, 'ledger')).source;
  const result = compare(supplier, ledger, scope);
  // Its question is "is this the same item in two books", so each row finds
  // its own copy. The offsetting debit and credit are never linked.
  for (const m of result.matches)
    assert.equal(m.supplierId.split(':')[2], m.ledgerId.split(':')[2]);
  assert.ok(
    !result.matches.some(
      (m) =>
        m.supplierId === supplier.transactions[0].id &&
        m.ledgerId === ledger.transactions[1].id,
    ),
  );
});

test('identityConflicts() reads an invoice and the payment that clears it as a conflict', async () => {
  const head = [
    'Date',
    'Account',
    'Type',
    'Clearing Ref',
    'Description',
    'Amount',
    'Currency',
  ];
  const map: Mapping = {
    ...mapping,
    reference: 3,
    description: 4,
    amount: 5,
    currencyColumn: 6,
  };
  const { file, source } = await read(
    [
      [
        '2026-09-10',
        '2150',
        'Invoice',
        'CLR-5',
        'Synthetic posting',
        '1000.00',
        'SAR',
      ],
      [
        '2026-09-12',
        '2150',
        'Payment',
        'CLR-5',
        'Synthetic posting',
        '-1000.00',
        'SAR',
      ],
    ],
    'ledger',
    head,
    map,
  );
  const [invoice, payment] = source.transactions;
  assert.deepEqual(
    [invoice.documentType, payment.documentType],
    ['Invoice', 'Payment'],
  );
  assert.ok(identityConflicts(invoice, payment).length > 0);
  // In a clearing account that pair is the normal case.
  const { cases } = clearSingleSource(source);
  assert.equal(file.sheets[0].rows.length, 3);
  assert.deepEqual(outcome(cases), [
    ['cleared', 'SHARED_REFERENCE_NETS_TO_ZERO', [2, 3]],
  ]);
});

test('ReconciliationCase: a clearing pair forced into it reports a variance and counts rows twice', async () => {
  const rows = [post('CLR-1', '1000.00'), post('CLR-1', '-1000.00')];
  const supplier = (await read(rows, 'supplier')).source;
  const ledger = (await read(rows, 'ledger')).source;
  const debit = supplier.transactions[0],
    credit = ledger.transactions[1];
  const { cases } = buildReconciliationCases(
    supplier,
    ledger,
    scope,
    [
      {
        supplierId: debit.id,
        ledgerId: credit.id,
        kind: 'manual',
        reason: 'forced',
        note: 'forced',
      },
    ],
    [],
  );
  const forced = cases.find((c) => c.supplierMembers[0]?.id === debit.id)!;
  // A pair that clears to zero reads as a 2,000.00 difference, and as a
  // bridge item between two balances that do not exist here.
  assert.equal(forced.status, 'Matched');
  assert.equal(forced.variance, 200000);
  assert.equal(forced.bridgeEffect, -200000);
  // Two physical rows appear four times across the cases.
  const traced = cases.flatMap((c) => c.sourceTrace.map((t) => t.row));
  assert.equal(traced.length, 4);
  assert.deepEqual([...new Set(traced)].sort(), [2, 3]);
});

test('Decision: one supplier row, one ledger row, equal amounts; G cannot be written in it', async () => {
  const rows = [
    post('INV-77', '1000.00'),
    post('PAY-1', '-250.00'),
    post('PAY-2', '-250.00'),
    post('PAY-3', '-500.00'),
  ];
  const supplier = (await read(rows, 'supplier')).source;
  const ledger = (await read(rows, 'ledger')).source;
  const named: Scope = { ...scope, supplier: 'Synthetic' };
  const invoice = supplier.transactions[0].id;
  const decisions: Decision[] = ledger.transactions.slice(1).map((t) => ({
    supplierId: invoice,
    ledgerId: t.id,
    note: 'Remittance advice RA-9 (synthetic)',
  }));
  // The type holds two ids. Spreading 1:N over several decisions fails on
  // the first: compare() requires the two amounts to be equal.
  assert.throws(
    () => compare(supplier, ledger, named, decisions.slice(0, 1)),
    /يجب أن تتساوى المبالغ/,
  );
  const keys: (keyof Decision)[] = ['supplierId', 'ledgerId', 'note'];
  assert.deepEqual(Object.keys(decisions[0]).sort(), [...keys].sort());
});

test('reference: the column mapped as the clearing reference loses to a voucher column', async () => {
  // Each posting carries its own journal voucher, and the clearing reference
  // is mapped as the reference. The reader keeps the voucher and drops the
  // mapped value from the transaction; only the source row still holds it.
  const head = [
    'Date',
    'Account',
    'Voucher No',
    'Clearing Ref',
    'Description',
    'Amount',
    'Currency',
  ];
  const map: Mapping = {
    ...mapping,
    reference: 3,
    description: 4,
    amount: 5,
    currencyColumn: 6,
  };
  const { file, source } = await read(
    [
      [
        '2026-09-10',
        '2150',
        'JV-101',
        'CLR-1',
        'Synthetic posting',
        '1000.00',
        'SAR',
      ],
      [
        '2026-09-12',
        '2150',
        'JV-102',
        'CLR-1',
        'Synthetic posting',
        '-1000.00',
        'SAR',
      ],
    ],
    'ledger',
    head,
    map,
  );
  assert.deepEqual(
    source.transactions.map((t) => t.reference),
    ['JV-101', 'JV-102'],
  );
  assert.deepEqual(
    source.transactions.map((t) => t.voucherReference),
    ['JV-101', 'JV-102'],
  );
  const kept = (t: Transaction) =>
    Object.values(t).filter((v) => v === 'CLR-1');
  assert.deepEqual(source.transactions.flatMap(kept), []);
  assert.deepEqual(
    source.transactions.map((t) => file.sheets[0].rows[t.row - 1][3]),
    ['CLR-1', 'CLR-1'],
  );
  // So the evidence the accountant pointed at never reaches the grouping.
  const { cases } = clearSingleSource(source);
  assert.deepEqual(outcome(cases), [
    ['needs-review', 'AMOUNT_ONLY_CANDIDATE', [2, 3]],
  ]);
});
