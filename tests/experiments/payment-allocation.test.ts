// EXPERIMENT ONLY — see ./payment-allocation.ts. Run it directly:
//   node --experimental-strip-types --test tests/experiments/*.test.ts
// Synthetic sources, one currency (SAR, two places): 1,000.00 is 100000.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../../lib/reconciliation/io.ts';
import { compare, parseMoney } from '../../lib/reconciliation/core.ts';
import { buildReconciliationCases } from '../../lib/reconciliation/cases.ts';
import { prepareVerifiedSources } from '../../lib/reconciliation/source-preparation.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';
import {
  AllocationLedger,
  allocateFromRemittance,
  allocationGroups,
  itemsFrom,
  readRemittance,
  suggestions,
  type Allocation,
  type AllocatableItem,
  type MatchRelation,
} from './payment-allocation.ts';

const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Entity',
  account: '',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-09-30',
  dateWindow: 3,
  confirmed: true,
  coverageConfirmed: false,
};
const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows.map((r) => r.map((c) => '"' + c + '"').join(',')).join('\n'),
  ).buffer as ArrayBuffer;

// Open items: the reader's open-items report, amount = remaining.
const OPEN_TOP = [
  ['Open Items'],
  ['As of', '2026-09-30'],
  ['Currency', 'SAR'],
  [],
];
const openMapping: Mapping = {
  ...defaultMapping(),
  header: OPEN_TOP.length,
  date: 0,
  reference: 1,
  amount: 3,
  reportType: 'open-items',
};
// Payments: a transactions report.
const PAY_TOP = [['Payments'], []];
const payMapping: Mapping = {
  ...defaultMapping(),
  header: PAY_TOP.length,
  date: 0,
  reference: 1,
  amount: 2,
};

type Invoice = [
  reference: string,
  remaining: string,
  original?: string,
  date?: string,
];
type Payment = [reference: string, amount: string, date?: string];
async function setup(
  invoices: Invoice[],
  payments: Payment[],
  currency = 'SAR',
) {
  const s = { ...scope, currency };
  const openFile = await readFile(
    'open-items.csv',
    csv([
      ...OPEN_TOP.map((r) =>
        r[0] === 'Currency' ? ['Currency', currency] : r,
      ),
      ['Invoice Date', 'Invoice No', 'Original Amount', 'Remaining Amount'],
      ...invoices.map(
        ([ref, remaining, original = remaining, date = '2026-09-18']) => [
          date,
          ref,
          original,
          remaining,
        ],
      ),
    ]),
  );
  const payFile = await readFile(
    'payments.csv',
    csv([
      ...PAY_TOP,
      ['Payment Date', 'Payment Ref', 'Amount'],
      ...payments.map(([ref, amount, date = '2026-09-20']) => [
        date,
        ref,
        amount,
      ]),
    ]),
  );
  const {
    sources: [open],
  } = prepareVerifiedSources([openFile], [openMapping], s, ['ledger']);
  const {
    sources: [paid],
  } = prepareVerifiedSources([payFile], [payMapping], s, ['supplier']);
  assert.deepEqual([open.errors, paid.errors], [[], []]);
  const items = [...itemsFrom(paid, 'payment'), ...itemsFrom(open, 'invoice')];
  const ledger = new AllocationLedger(items, currency);
  const before = JSON.stringify([
    [...ledger.items.values()],
    openFile.sheets,
    payFile.sheets,
  ]);
  const id = (reference: string) =>
    [...ledger.items.values()].find(
      (item) => item.reference === reference.replace(/-/g, ''),
    )!.id;
  return { ledger, id, openFile, payFile, open, paid, before };
}
async function remittance(
  lines: [payment: string, invoice: string, amount: string][],
) {
  const file = await readFile(
    'remittance.csv',
    csv([
      ['Remittance Advice'],
      [],
      ['Payment Ref', 'Invoice No', 'Amount Applied'],
      ...lines,
    ]),
  );
  return readRemittance(file, 2, 2);
}

/** Money is conserved item by item, and nothing in the sources changes. */
function assertConservation(ctx: Awaited<ReturnType<typeof setup>>) {
  const { ledger, openFile, payFile, before } = ctx;
  for (const [id, b] of ledger.balances()) {
    assert.equal(b.allocated + b.remaining, b.available, id);
    assert.ok(b.remaining >= 0, id);
  }
  let fromPayments = 0,
    toInvoices = 0;
  for (const a of ledger.allocations) {
    assert.ok(a.amountMinor > 0);
    assert.equal(ledger.items.get(a.paymentId)!.kind, 'payment');
    assert.equal(ledger.items.get(a.invoiceId)!.kind, 'invoice');
    fromPayments += a.amountMinor;
    toInvoices += a.amountMinor;
  }
  assert.equal(fromPayments, toInvoices);
  // Every item traces to its source cell, and that cell is its amount.
  const files: Record<string, [SourceFile, number]> = {
    'open-items.csv': [openFile, 3],
    'payments.csv': [payFile, 2],
  };
  for (const item of ledger.items.values()) {
    const [file, column] = files[item.trace.source];
    assert.equal(
      file.sheets[0].rows[item.trace.row - 1][column],
      item.trace.text,
    );
    assert.equal(parseMoney(item.trace.text, 'dot', 2), item.availableMinor);
  }
  assert.equal(
    JSON.stringify([
      [...ledger.items.values()],
      openFile.sheets,
      payFile.sheets,
    ]),
    before,
    'allocating changes no source amount',
  );
}
const balance = (ledger: AllocationLedger, id: string) => {
  const b = ledger.balances().get(id)!;
  return [b.allocated, b.remaining];
};
const review = (reference: string, reason: string): Allocation['basis'] => ({
  type: 'accountant-review',
  reference,
  reason,
});

// ---------------------------------------------------------------- A–K

test('A: 1:1 with the invoice named in the remittance', async () => {
  const ctx = await setup([['INV-1', '1000.00']], [['PAY-1', '1000.00']]);
  allocateFromRemittance(
    ctx.ledger,
    await remittance([['PAY-1', 'INV-1', '1000.00']]),
  );
  assertConservation(ctx);
  assert.deepEqual(balance(ctx.ledger, ctx.id('PAY-1')), [100000, 0]);
  assert.deepEqual(balance(ctx.ledger, ctx.id('INV-1')), [100000, 0]);
});

test('B: one payment row in three allocations, counted once', async () => {
  const ctx = await setup(
    [
      ['INV-A', '400.00'],
      ['INV-B', '350.00'],
      ['INV-C', '250.00'],
    ],
    [['PAY-1', '1000.00']],
  );
  allocateFromRemittance(
    ctx.ledger,
    await remittance([
      ['PAY-1', 'INV-A', '400.00'],
      ['PAY-1', 'INV-B', '350.00'],
      ['PAY-1', 'INV-C', '250.00'],
    ]),
  );
  assertConservation(ctx);
  const pay = ctx.id('PAY-1');
  assert.equal(
    ctx.ledger.allocations.filter((a) => a.paymentId === pay).length,
    3,
  );
  assert.deepEqual(balance(ctx.ledger, pay), [100000, 0]);
  for (const ref of ['INV-A', 'INV-B', 'INV-C'])
    assert.equal(ctx.ledger.remaining(ctx.id(ref)), 0);
  // The supplier case builder holds a row in one case only: the same payment
  // row in three relations is refused there.
  assert.throws(
    () =>
      buildReconciliationCases(
        ctx.paid,
        ctx.open,
        scope,
        ctx.open.transactions.map((t) => ({
          supplierId: pay,
          ledgerId: t.id,
          kind: 'manual' as const,
          reason: 'forced',
          note: 'forced',
        })),
        [],
      ),
    /صف المصدر مستخدم في أكثر من حالة/,
  );
});

test('C: one invoice settled by two payments', async () => {
  const ctx = await setup(
    [['INV-1', '1000.00']],
    [
      ['PAY-1', '600.00'],
      ['PAY-2', '400.00'],
    ],
  );
  allocateFromRemittance(
    ctx.ledger,
    await remittance([
      ['PAY-1', 'INV-1', '600.00'],
      ['PAY-2', 'INV-1', '400.00'],
    ]),
  );
  assertConservation(ctx);
  assert.deepEqual(balance(ctx.ledger, ctx.id('INV-1')), [100000, 0]);
  assert.equal(
    ctx.ledger.allocations.filter((a) => a.invoiceId === ctx.id('INV-1'))
      .length,
    2,
  );
});

test('D: a partial payment leaves the invoice open', async () => {
  const ctx = await setup([['INV-1', '1000.00']], [['PAY-1', '600.00']]);
  allocateFromRemittance(
    ctx.ledger,
    await remittance([['PAY-1', 'INV-1', '600.00']]),
  );
  assertConservation(ctx);
  assert.deepEqual(balance(ctx.ledger, ctx.id('INV-1')), [60000, 40000]);
  assert.deepEqual(balance(ctx.ledger, ctx.id('PAY-1')), [60000, 0]);
  // The supplier path cannot state it: a manual decision needs equal amounts.
  assert.throws(
    () =>
      compare(
        ctx.paid,
        {
          ...ctx.open,
          mapping: { ...ctx.open.mapping, reportType: 'transactions' },
        },
        scope,
        [
          {
            supplierId: ctx.id('PAY-1'),
            ledgerId: ctx.id('INV-1'),
            note: 'Part payment per advice (synthetic)',
          },
        ],
      ),
    /يجب أن تتساوى المبالغ/,
  );
});

test('E: an unallocated remainder is not spent on another invoice', async () => {
  const ctx = await setup(
    [
      ['INV-A', '400.00'],
      ['INV-B', '350.00'],
      ['INV-X', '250.00'],
    ],
    [['PAY-1', '1000.00']],
  );
  allocateFromRemittance(
    ctx.ledger,
    await remittance([
      ['PAY-1', 'INV-A', '400.00'],
      ['PAY-1', 'INV-B', '350.00'],
    ]),
  );
  assertConservation(ctx);
  assert.deepEqual(balance(ctx.ledger, ctx.id('PAY-1')), [75000, 25000]);
  assert.deepEqual(balance(ctx.ledger, ctx.id('INV-X')), [0, 25000]);
  // 250 left and a 250 invoice open is at most a question for the reviewer.
  assert.deepEqual(suggestions(ctx.ledger, scope.dateWindow), [
    {
      paymentId: ctx.id('PAY-1'),
      invoiceId: ctx.id('INV-X'),
      status: 'needs-review',
    },
  ]);
  assert.equal(ctx.ledger.allocations.length, 2);
});

test('F: later decisions see what earlier ones used', async () => {
  const ctx = await setup(
    [
      ['INV-A', '400.00'],
      ['INV-B', '350.00'],
      ['INV-C', '700.00'],
    ],
    [['PAY-1', '1000.00']],
  );
  const pay = ctx.id('PAY-1');
  const decide = (invoice: string, amount: number) =>
    ctx.ledger.apply([
      {
        paymentId: pay,
        invoiceId: ctx.id(invoice),
        amountMinor: amount,
        basis: review(
          'Call with supplier AR, 2026-09-22 (synthetic)',
          `Applied to ${invoice}`,
        ),
      },
    ]);
  decide('INV-A', 40000);
  assert.equal(ctx.ledger.remaining(pay), 60000);
  decide('INV-B', 35000);
  assert.equal(ctx.ledger.remaining(pay), 25000);
  // The first 400 cannot be allocated again, on either side.
  assert.throws(() => decide('INV-C', 70000), /has 25000 available/);
  assert.throws(() => decide('INV-A', 10000), /has 0 available/);
  assertConservation(ctx);
});

test('G: over-allocation is refused from either side, all or nothing', async () => {
  const ctx = await setup(
    [
      ['INV-A', '700.00'],
      ['INV-B', '500.00'],
    ],
    [['PAY-1', '1000.00']],
  );
  const pay = ctx.id('PAY-1');
  const basis = review(
    'Payment advice PA-3 (synthetic)',
    'Split stated by the supplier',
  );
  assert.throws(
    () =>
      ctx.ledger.apply([
        {
          paymentId: pay,
          invoiceId: ctx.id('INV-A'),
          amountMinor: 70000,
          basis,
        },
        {
          paymentId: pay,
          invoiceId: ctx.id('INV-B'),
          amountMinor: 50000,
          basis,
        },
      ]),
    /has 100000 available/,
  );
  assert.equal(
    ctx.ledger.allocations.length,
    0,
    'nothing of the refused decision remains',
  );
  const inv = await setup(
    [['INV-1', '500.00']],
    [
      ['PAY-1', '300.00'],
      ['PAY-2', '300.00'],
    ],
  );
  assert.throws(
    () =>
      inv.ledger.apply(
        ['PAY-1', 'PAY-2'].map((p) => ({
          paymentId: inv.id(p),
          invoiceId: inv.id('INV-1'),
          amountMinor: 30000,
          basis,
        })),
      ),
    /has 50000 available/,
  );
  assertConservation(ctx);
  assertConservation(inv);
});

test('H: invoices that add up to the payment are not an allocation', async () => {
  const ctx = await setup(
    [
      ['INV-A', '600.00'],
      ['INV-B', '400.00'],
    ],
    [['PAY-1', '1000.00']],
  );
  assert.equal(
    60000 + 40000,
    ctx.ledger.items.get(ctx.id('PAY-1'))!.availableMinor,
  );
  assert.deepEqual(suggestions(ctx.ledger, scope.dateWindow), []);
  assert.equal(ctx.ledger.allocations.length, 0);
  assertConservation(ctx);
  // One invoice of the same amount, close in date, is only a question.
  const one = await setup([['INV-Z', '1000.00']], [['PAY-9', '1000.00']]);
  assert.deepEqual(suggestions(one.ledger, scope.dateWindow), [
    {
      paymentId: one.id('PAY-9'),
      invoiceId: one.id('INV-Z'),
      status: 'needs-review',
    },
  ]);
  assert.equal(one.ledger.allocations.length, 0);
});

const choices: Invoice[] = [
  ['INV-A', '600.00'],
  ['INV-B', '400.00'],
  ['INV-C', '700.00'],
  ['INV-D', '300.00'],
];
test('I: two sets reach the payment; neither is chosen', async () => {
  const ctx = await setup(choices, [['PAY-1', '1000.00']]);
  for (const set of [
    ['INV-A', 'INV-B'],
    ['INV-C', 'INV-D'],
  ])
    assert.equal(
      set.reduce(
        (t, r) => t + ctx.ledger.items.get(ctx.id(r))!.availableMinor,
        0,
      ),
      100000,
    );
  assert.deepEqual(suggestions(ctx.ledger, scope.dateWindow), []);
  assert.equal(ctx.ledger.allocations.length, 0);
  assertConservation(ctx);
});

test('J: an external confirmation settles I, and only for this payment', async () => {
  const ctx = await setup(choices, [['PAY-1', '1000.00']]);
  const basis: Allocation['basis'] = {
    type: 'external-confirmation',
    reference: 'Supplier confirmation CONF-17, 2026-09-25 (synthetic)',
    reason: 'The supplier states PAY-1 settles INV-C and INV-D',
  };
  ctx.ledger.apply(
    [
      ['INV-C', 70000],
      ['INV-D', 30000],
    ].map(([ref, amount]) => ({
      paymentId: ctx.id('PAY-1'),
      invoiceId: ctx.id(ref as string),
      amountMinor: amount as number,
      basis,
    })),
  );
  assertConservation(ctx);
  assert.deepEqual(
    ctx.ledger.allocations.map((a) => a.basis.type),
    ['external-confirmation', 'external-confirmation'],
  );
  assert.deepEqual(
    [
      ctx.ledger.remaining(ctx.id('INV-A')),
      ctx.ledger.remaining(ctx.id('INV-B')),
    ],
    [60000, 40000],
  );
  // The decision is not a rule: the same shape elsewhere gets nothing.
  const again = await setup(choices, [['PAY-2', '1000.00']]);
  assert.deepEqual(suggestions(again.ledger, scope.dateWindow), []);
  assert.equal(again.ledger.allocations.length, 0);
});

test('K: an invoice already part-paid offers its remaining amount only', async () => {
  const ctx = await setup(
    [['INV-K', '600.00', '1000.00']],
    [
      ['PAY-1', '600.00'],
      ['PAY-2', '1000.00'],
    ],
  );
  const invoice = ctx.ledger.items.get(ctx.id('INV-K'))!;
  assert.equal(invoice.availableMinor, 60000);
  // The reader keeps one amount: the remaining one. The original 1,000.00 is
  // only in the source row; `originalAmount` is the text of the cell read.
  const t = ctx.open.transactions[0];
  assert.deepEqual([t.amount, t.originalAmount], [60000, '600.00']);
  assert.equal(ctx.openFile.sheets[0].rows[t.row - 1][2], '1000.00');
  assert.ok(!Object.values(t).includes('1000.00'));
  assert.throws(
    () => allocateFromRemittanceSync(ctx, [['PAY-2', 'INV-K', 100000]]),
    /has 60000 available/,
  );
  ctx.ledger.apply([
    {
      paymentId: ctx.id('PAY-1'),
      invoiceId: invoice.id,
      amountMinor: 60000,
      basis: review(
        'Remittance RA-12 (synthetic)',
        'Final instalment of INV-K',
      ),
    },
  ]);
  assertConservation(ctx);
  assert.deepEqual(balance(ctx.ledger, invoice.id), [60000, 0]);
  // The reader refuses the original amount as the amount of an open item.
  const {
    sources: [asOriginal],
  } = prepareVerifiedSources(
    [ctx.openFile],
    [{ ...openMapping, amount: 2 }],
    scope,
    ['ledger'],
  );
  assert.match(
    asOriginal.errors[0].message,
    /معنى عمود المبلغ لا يوافق نوع التقرير/,
  );
});
function allocateFromRemittanceSync(
  ctx: Awaited<ReturnType<typeof setup>>,
  lines: [string, string, number][],
) {
  ctx.ledger.apply(
    lines.map(([p, i, amount]) => ({
      paymentId: ctx.id(p),
      invoiceId: ctx.id(i),
      amountMinor: amount,
      basis: review('Advice (synthetic)', 'test'),
    })),
  );
}

// ------------------------------------------------ basis, scope, match

test('basis: every human basis needs its reference and a reason; a document must agree', async () => {
  const ctx = await setup(
    [
      ['INV-1', '1000.00'],
      ['INV-2', '500.00'],
    ],
    [
      ['PAY-1', '1000.00'],
      ['PAY-2', '400.00'],
    ],
  );
  const one = (
    basis: Allocation['basis'],
    invoice = 'INV-1',
    amount = 40000,
    payment = 'PAY-1',
  ): Allocation => ({
    paymentId: ctx.id(payment),
    invoiceId: ctx.id(invoice),
    amountMinor: amount,
    basis,
  });
  for (const basis of [
    review('', 'confirmed'),
    review('Call 2026-09-22', ' '),
    {
      type: 'external-confirmation',
      reference: ' ',
      reason: 'confirmed',
    } as const,
  ])
    assert.throws(
      () => ctx.ledger.apply([one(basis)]),
      /reference and a reason/,
    );
  const [line] = await remittance([['PAY-1', 'INV-1', '400.00']]);
  // The document names INV-1 for 400.00: it cannot back 500.00, or INV-2.
  assert.throws(
    () => ctx.ledger.apply([one({ type: 'document', line }, 'INV-1', 50000)]),
    /does not state/,
  );
  assert.throws(
    () => ctx.ledger.apply([one({ type: 'document', line }, 'INV-2')]),
    /does not state/,
  );
  // Nor another payment of the same amount.
  assert.throws(
    () =>
      ctx.ledger.apply([
        one({ type: 'document', line }, 'INV-1', 40000, 'PAY-2'),
      ]),
    /does not state/,
  );
  ctx.ledger.apply([one({ type: 'document', line })]);
  assertConservation(ctx);
});

test('scope: no allocation to a missing item, of a non-positive amount, or across currencies', async () => {
  const ctx = await setup(
    [['INV-1', '1000.00']],
    [
      ['PAY-1', '1000.00'],
      ['PAY-L', '50.00', '2026-10-02'],
    ],
  );
  // A payment after the cutoff is excluded by the reader, so it is not an item.
  assert.deepEqual(
    ctx.paid.excluded.filter((x) => x.row > 3).map((x) => x.reason),
    ['بعد تاريخ المقارنة'],
  );
  const basis = review('Advice (synthetic)', 'test');
  const pay = ctx.id('PAY-1');
  const inv = ctx.id('INV-1');
  for (const [bad, message] of [
    [
      { paymentId: 'supplier:0:9', invoiceId: inv, amountMinor: 100, basis },
      /unknown/,
    ],
    [{ paymentId: inv, invoiceId: pay, amountMinor: 100, basis }, /unknown/],
    [{ paymentId: pay, invoiceId: inv, amountMinor: 0, basis }, /positive/],
    [{ paymentId: pay, invoiceId: inv, amountMinor: -100, basis }, /positive/],
  ] as const)
    assert.throws(() => ctx.ledger.apply([bad]), message);
  // A USD payment read under a USD scope beside a SAR invoice.
  const usd = await setup([], [['PAY-U', '1000.00']], 'USD');
  const mixed = new AllocationLedger(
    [
      ...usd.ledger.items.values(),
      ctx.ledger.items.get(inv)!,
    ] as AllocatableItem[],
    'SAR',
  );
  assert.throws(
    () =>
      mixed.apply([
        { paymentId: usd.id('PAY-U'), invoiceId: inv, amountMinor: 100, basis },
      ]),
    /outside the confirmed currency/,
  );
});

test('match and allocation are separate relations on the same payment', async () => {
  const ctx = await setup(
    [
      ['INV-A', '400.00'],
      ['INV-B', '350.00'],
      ['INV-C', '250.00'],
    ],
    [['PAY-1', '1000.00']],
  );
  // The bank shows the same payment; matching it moves no money.
  const bankFile = await readFile(
    'bank.csv',
    csv([
      ['Bank'],
      [],
      ['Value Date', 'Bank Ref', 'Amount'],
      ['2026-09-20', 'BNK-77', '1000.00'],
    ]),
  );
  const {
    sources: [bank],
  } = prepareVerifiedSources([bankFile], [{ ...payMapping }], scope, [
    'ledger',
  ]);
  const [bankItem] = itemsFrom(bank, 'payment');
  const match: MatchRelation = {
    itemId: ctx.id('PAY-1'),
    counterpartId: bankItem.id,
    basis: 'Same bank reference on the payment advice (synthetic)',
  };
  assert.equal(
    ctx.ledger.remaining(match.itemId),
    100000,
    'a match allocates nothing',
  );
  allocateFromRemittance(
    ctx.ledger,
    await remittance([
      ['PAY-1', 'INV-A', '400.00'],
      ['PAY-1', 'INV-B', '350.00'],
      ['PAY-1', 'INV-C', '250.00'],
    ]),
  );
  // The value is allocated once, from one side of the match. The bank copy is
  // not an allocatable item: allocating both would allocate 2,000.00.
  assert.throws(
    () =>
      ctx.ledger.apply([
        {
          paymentId: bankItem.id,
          invoiceId: ctx.id('INV-A'),
          amountMinor: 100,
          basis: review('x', 'x'),
        },
      ]),
    /unknown/,
  );
  assert.equal(
    ctx.ledger.allocations.reduce((t, a) => t + a.amountMinor, 0),
    100000,
  );
  assert.deepEqual(match, {
    itemId: ctx.id('PAY-1'),
    counterpartId: bankItem.id,
    basis: 'Same bank reference on the payment advice (synthetic)',
  });
  assertConservation(ctx);
});

test('case: any grouping is a view over the allocations, and groups can merge', async () => {
  // PAY-1 pays A and part of B; PAY-2 pays the rest of B and C. No split of
  // allocations into payment-owned or invoice-owned cases keeps both views.
  const ctx = await setup(
    [
      ['INV-A', '400.00'],
      ['INV-B', '600.00'],
      ['INV-C', '300.00'],
    ],
    [
      ['PAY-1', '700.00'],
      ['PAY-2', '600.00'],
    ],
  );
  allocateFromRemittance(
    ctx.ledger,
    await remittance([
      ['PAY-1', 'INV-A', '400.00'],
      ['PAY-1', 'INV-B', '300.00'],
      ['PAY-2', 'INV-B', '300.00'],
      ['PAY-2', 'INV-C', '300.00'],
    ]),
  );
  assertConservation(ctx);
  const byPayment = (p: string) =>
    ctx.ledger.allocations.filter((a) => a.paymentId === ctx.id(p)).length;
  const byInvoice = (i: string) =>
    ctx.ledger.allocations.filter((a) => a.invoiceId === ctx.id(i)).length;
  assert.deepEqual(
    [byPayment('PAY-1'), byPayment('PAY-2'), byInvoice('INV-B')],
    [2, 2, 2],
  );
  assert.deepEqual(allocationGroups(ctx.ledger), [
    [
      ctx.id('INV-A'),
      ctx.id('INV-B'),
      ctx.id('INV-C'),
      ctx.id('PAY-1'),
      ctx.id('PAY-2'),
    ].sort(),
  ]);
});

test('K: the original amount needs a second reading of the same file', async () => {
  // A workaround, not a model: reading the open-items document again as a
  // transactions report with the original amount column yields the original
  // under the same row id. It borrows transaction semantics for a snapshot.
  const ctx = await setup(
    [['INV-K', '600.00', '1000.00']],
    [['PAY-1', '600.00']],
  );
  const {
    sources: [asTransactions],
  } = prepareVerifiedSources(
    [ctx.openFile],
    [{ ...openMapping, amount: 2, reportType: 'transactions' }],
    scope,
    ['ledger'],
  );
  assert.deepEqual(
    [asTransactions.transactions[0].id, asTransactions.transactions[0].amount],
    [ctx.open.transactions[0].id, 100000],
  );
});
