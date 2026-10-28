import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  PG_BATCHES_HEADERS,
  PG_BATCHES_ROLES,
  PG_BATCHES_VERSION,
} from '../lib/reconciliation/payment-gateway-batches.ts';
import {
  gatewayBatchesCSV,
  replayGatewayBatches,
} from '../lib/reconciliation/payment-gateway-batches-io.ts';

// An electronics retailer's card gateway, in Kuwaiti dinars, for October
// 2027: a lineage of its own, not the sealed PG-1 stories.
const MID = 'MID-55031';
const BANK = 'KW-IBAN-0007';
const SCOPE = {
  entity: 'Synthetic Gulf Electronics Co',
  gateway: 'Synthetic Card Switch',
  merchantAccount: MID,
  bankAccount: BANK,
  currency: 'KWD',
  start: '2027-10-01',
  end: '2027-10-31',
  asOf: '2027-11-07',
  confirmed: true as const,
};
const READINGS = PG_BATCHES_ROLES.map((role) => ({
  sheet: 0 as const,
  role,
  family: PG_BATCHES_VERSION,
  confirmed: true as const,
}));
type Rows = string[][];
type Book = Rows[];
const sale = (
  id: string,
  batch: string,
  amount: string,
  date = '2027-10-05',
) => [id, batch, 'sale', date, amount, `Order ${id}`, MID, 'KWD'];
const refund = (id: string, batch: string, amount: string) => [
  id,
  batch,
  'refund',
  '2027-10-12',
  amount,
  `Return ${id}`,
  MID,
  'KWD',
];
const fee = (id: string, batch: string, amount: string) => [
  id,
  batch,
  amount,
  `Fee ${id}`,
  MID,
  'KWD',
];
const settle = (
  batch: string,
  gross: string,
  refunds: string,
  fees: string,
  net: string,
) => [batch, '2027-10-20', gross, refunds, fees, net, MID, 'KWD'];
const line = (payout: string, batch: string, amount: string) => [
  payout,
  batch,
  amount,
  MID,
  'KWD',
];
const credit = (ref: string, payout: string, date: string, amount: string) => [
  ref,
  payout,
  date,
  amount,
  BANK,
  'KWD',
];

/** Two batches paid together in one payout, credited in the period. */
const base = (): Book => [
  [
    sale('TXN-901', 'STL-A', '120.500'),
    sale('TXN-902', 'STL-A', '80.250'),
    refund('TXN-903', 'STL-A', '10.000'),
    sale('TXN-904', 'STL-B', '50.000'),
  ],
  [fee('FE-11', 'STL-A', '3.105'), fee('FE-12', 'STL-B', '1.250')],
  [
    settle('STL-A', '200.750', '10.000', '3.105', '187.645'),
    settle('STL-B', '50.000', '0', '1.250', '48.750'),
  ],
  [line('PO-1', 'STL-A', '187.645'), line('PO-1', 'STL-B', '48.750')],
  [credit('BK-1', 'PO-1', '2027-10-22', '236.395')],
];
const NAMES = ['tx', 'fees', 'settlements', 'lines', 'credits'];
const csvText = (rows: Rows) =>
  rows
    .map((r) =>
      r
        .map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(','),
    )
    .join('\r\n') + '\r\n';
const snapshot = (name: string, bytes: Uint8Array) => ({
  name,
  original: bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
const files = (book: Book, headers = PG_BATCHES_HEADERS) =>
  book.map((rows, i) =>
    snapshot(
      `${NAMES[i]}.csv`,
      new TextEncoder().encode(csvText([[...headers[i]], ...rows])),
    ),
  );
/** The engine's own refusal where a result was expected is a wrong answer,
 * so it fails as an assertion with the same message; anything else it throws
 * stays what it is. */
const replay = (input: Parameters<typeof replayGatewayBatches>[0]) =>
  replayGatewayBatches(input).then(
    (r) => r.result,
    (e: Error) => {
      if (!String(e?.message).startsWith('PG_BATCHES_')) throw e;
      throw new assert.AssertionError({ message: e.message });
    },
  );
const run = (
  book: Book,
  scope: object = SCOPE,
  readings: object[] = READINGS,
) =>
  replay({
    files: files(book),
    readings: readings as typeof READINGS,
    scope: scope as typeof SCOPE,
  });
const refusal = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (e: Error) => e.message === `PG_BATCHES_${code}`);
const edit = (change: (book: Book) => void) => {
  const book = base();
  change(book);
  return book;
};

void test('two batches paid in one payout and credited in the period are consistent, member by member', async () => {
  const r = await run(base());
  assert.equal(r.refused, null);
  assert.equal(r.decimals, 3);
  assert.deepEqual(r.batches, [
    {
      row: 2,
      batch: 'STL-A',
      sales: [2, 3],
      refunds: [4],
      fees: [2],
      components: { sales: 200750, refunds: 10000, fees: 3105 },
      settlement: { gross: 200750, refunds: 10000, fees: 3105, net: 187645 },
      paid: 187645,
      payouts: ['PO-1'],
      status: 'consistent',
      reasons: [],
    },
    {
      row: 3,
      batch: 'STL-B',
      sales: [5],
      refunds: [],
      fees: [3],
      components: { sales: 50000, refunds: 0, fees: 1250 },
      settlement: { gross: 50000, refunds: 0, fees: 1250, net: 48750 },
      paid: 48750,
      payouts: ['PO-1'],
      status: 'consistent',
      reasons: [],
    },
  ]);
  assert.deepEqual(r.payouts, [
    {
      payout: 'PO-1',
      lines: [2, 3],
      batches: ['STL-A', 'STL-B'],
      amount: 236395,
      credit: { row: 2, valueDate: '2027-10-22', amount: 236395 },
      status: 'consistent',
      reasons: [],
    },
  ]);
  assert.deepEqual(r.credits, []);
  assert.deepEqual(
    r.records.transactions.map((t) => [t.row, t.id, t.batch, t.kind]),
    [
      [2, 'TXN-901', 'STL-A', 'sale'],
      [3, 'TXN-902', 'STL-A', 'sale'],
      [4, 'TXN-903', 'STL-A', 'refund'],
      [5, 'TXN-904', 'STL-B', 'sale'],
    ],
  );
  assert.equal(r.sources.length, 5);
  assert.equal(JSON.parse(r.context)[0], PG_BATCHES_VERSION);
});

void test('a sale written under the other batch shows on both, though the payout total is right', async () => {
  const r = await run(edit((b) => (b[0][1][1] = 'STL-B')));
  assert.deepEqual(
    r.batches.map((x) => [x.batch, x.status, x.reasons, x.sales]),
    [
      ['STL-A', 'review', ['SALES'], [2]],
      ['STL-B', 'review', ['SALES'], [3, 5]],
    ],
  );
  assert.deepEqual(
    r.payouts.map((p) => [p.status, p.reasons]),
    [['consistent', []]],
  );
  const moved = await run(edit((b) => (b[0][2][1] = 'STL-B')));
  assert.deepEqual(
    moved.batches.map((x) => [x.batch, x.reasons, x.refunds]),
    [
      ['STL-A', ['REFUNDS'], []],
      ['STL-B', ['REFUNDS'], [4]],
    ],
  );
});

void test('a fee that names the other batch is that batch\u2019s fee, and both show it', async () => {
  const r = await run(edit((b) => (b[1][1][1] = 'STL-A')));
  assert.deepEqual(
    r.batches.map((x) => [x.batch, x.reasons, x.fees, x.components.fees]),
    [
      ['STL-A', ['FEES'], [2, 3], 4355],
      ['STL-B', ['FEES'], [], 0],
    ],
  );
});

void test('a settlement row that does not add up is NET, whatever its members say', async () => {
  const r = await run(
    edit((b) => {
      b[2][0][5] = '187.655';
      b[3][0][2] = '187.655';
      b[4][0][3] = '236.405';
    }),
  );
  assert.deepEqual(
    r.batches.map((x) => [x.batch, x.status, x.reasons]),
    [
      ['STL-A', 'review', ['NET']],
      ['STL-B', 'consistent', []],
    ],
  );
});

void test('a batch paid in two payouts: in transit after the period, not deposited without a credit', async () => {
  const split = (credit2: string[] | null) =>
    edit((b) => {
      b[3] = [
        line('PO-1', 'STL-A', '100.000'),
        line('PO-1', 'STL-B', '48.750'),
        line('PO-2', 'STL-A', '87.645'),
      ];
      b[4] = [
        credit('BK-1', 'PO-1', '2027-10-22', '148.750'),
        ...(credit2 ? [credit2] : []),
      ];
    });
  const late = await run(split(credit('BK-2', 'PO-2', '2027-11-03', '87.645')));
  assert.deepEqual(
    late.payouts.map((p) => [p.payout, p.status, p.reasons, p.lines]),
    [
      ['PO-1', 'consistent', [], [2, 3]],
      ['PO-2', 'in-transit', [], [4]],
    ],
  );
  assert.deepEqual(
    late.batches.map((x) => [x.batch, x.status, x.payouts, x.paid]),
    [
      ['STL-A', 'in-transit', ['PO-1', 'PO-2'], 187645],
      ['STL-B', 'consistent', ['PO-1'], 48750],
    ],
  );
  const never = await run(split(null));
  assert.deepEqual(never.payouts[1].reasons, ['NOT_DEPOSITED']);
  assert.equal(never.payouts[1].credit, null);
  assert.deepEqual(
    never.batches.map((x) => [x.status, x.reasons]),
    [
      ['review', ['PAYOUT']],
      ['consistent', []],
    ],
  );
  const onEnd = await run(
    split(credit('BK-2', 'PO-2', '2027-10-31', '87.645')),
  );
  assert.equal(onEnd.payouts[1].status, 'consistent');
  const afterAsOf = await run(
    split(credit('BK-2', 'PO-2', '2027-11-08', '87.645')),
  );
  assert.equal(afterAsOf.refused, 'SOURCE_ERRORS');
  assert.deepEqual(afterAsOf.errors, [{ source: 4, row: 3, code: 'PERIOD' }]);
});

void test('two credits whose total is right but whose amounts are swapped are both CREDIT', async () => {
  const r = await run(
    edit((b) => {
      b[3] = [
        line('PO-1', 'STL-A', '187.645'),
        line('PO-2', 'STL-B', '48.750'),
      ];
      b[4] = [
        credit('BK-1', 'PO-1', '2027-10-22', '48.750'),
        credit('BK-2', 'PO-2', '2027-10-22', '187.645'),
      ];
    }),
  );
  assert.deepEqual(
    r.payouts.map((p) => [p.payout, p.reasons]),
    [
      ['PO-1', ['CREDIT']],
      ['PO-2', ['CREDIT']],
    ],
  );
  assert.deepEqual(
    r.batches.map((x) => x.reasons),
    [['PAYOUT'], ['PAYOUT']],
  );
});

void test('payout lines short of the net and over it', async () => {
  const short = await run(
    edit((b) => {
      b[3][1][2] = '48.700';
      b[4][0][3] = '236.345';
    }),
  );
  assert.deepEqual(short.batches[1].reasons, ['PAID_SHORT']);
  const over = await run(
    edit((b) => {
      b[3][1][2] = '48.800';
      b[4][0][3] = '236.445';
    }),
  );
  assert.deepEqual(over.batches[1].reasons, ['PAID_OVER']);
  assert.equal(over.batches[0].status, 'consistent');
});

void test('a bank credit no payout line names is unlinked, and changes no batch', async () => {
  const r = await run(
    edit((b) => b[4].push(credit('BK-9', 'PO-77', '2027-10-25', '48.750'))),
  );
  assert.deepEqual(r.credits, [
    {
      row: 3,
      reference: 'BK-9',
      payout: 'PO-77',
      valueDate: '2027-10-25',
      amount: 48750,
      reasons: ['UNLINKED_CREDIT'],
    },
  ]);
  assert.deepEqual(
    r.batches.map((x) => x.status),
    ['consistent', 'consistent'],
  );
});

void test('amounts: Arabic-Indic digits and separator are read, a direction mark is not removed', async () => {
  const arabic = await run(
    edit((b) => (b[0][0][4] = '\u0661\u0662\u0660\u066b\u0665\u0660\u0660')),
  );
  assert.equal(arabic.refused, null);
  assert.equal(arabic.batches[0].components.sales, 200750);
  const extended = await run(
    edit((b) => (b[0][0][4] = '\u06f1\u06f2\u06f0.500')),
  );
  assert.equal(extended.batches[0].status, 'consistent');
  const surrounded = await run(edit((b) => (b[0][0][4] = ' 120.500\u001c')));
  assert.equal(surrounded.refused, null);
  for (const value of [
    '\u200e120.500',
    '\ufeff120.500',
    '-120.500',
    '+120.500',
    '120.5000',
    '1,120.500',
    '120,500',
    '',
    '1e2',
    '100000000000.001',
  ]) {
    const r = await run(edit((b) => (b[0][0][4] = value)));
    assert.deepEqual(
      r.errors,
      [{ source: 0, row: 2, code: 'AMOUNT' }],
      JSON.stringify(value),
    );
  }
  const negativeZero = await run(edit((b) => (b[1][0][2] = '-0')));
  assert.deepEqual(negativeZero.errors, [
    { source: 1, row: 2, code: 'AMOUNT' },
  ]);
  const ceiling = await run(edit((b) => (b[0][0][4] = '100000000000.000')));
  assert.equal(ceiling.refused, null, 'a sale at the ceiling is read');
  assert.deepEqual(ceiling.batches[0].reasons, ['SALES']);
});

void test('every row rule has its code, and any row error refuses the whole review', async () => {
  const cases: [string, (b: Book) => void, [number, number, string][]][] = [
    ['kind', (b) => (b[0][0][2] = 'Sale'), [[0, 2, 'KIND']]],
    ['before period', (b) => (b[0][0][3] = '2027-09-30'), [[0, 2, 'PERIOD']]],
    ['not a day', (b) => (b[0][0][3] = '2027-02-29'), [[0, 2, 'DATE']]],
    ['slashes', (b) => (b[0][0][3] = '2027/10/05'), [[0, 2, 'DATE']]],
    ['century', (b) => (b[0][0][3] = '2100-02-29'), [[0, 2, 'DATE']]],
    ['leap day', (b) => (b[0][0][3] = '2028-02-29'), [[0, 2, 'PERIOD']]],
    ['April 31', (b) => (b[0][3][3] = '2027-04-31'), [[0, 5, 'DATE']]],
    ['dash id', (b) => (b[0][0][0] = '-TXN'), [[0, 2, 'IDENTITY']]],
    ['padded id', (b) => (b[0][0][0] = ' TXN-901'), [[0, 2, 'IDENTITY']]],
    ['error id', (b) => (b[0][0][0] = '#N/A'), [[0, 2, 'IDENTITY']]],
    ['hidden mark', (b) => (b[0][0][0] = 'TXN\u200b901'), [[0, 2, 'IDENTITY']]],
    ['empty batch', (b) => (b[0][0][1] = ''), [[0, 2, 'IDENTITY']]],
    ['no reference', (b) => (b[0][0][5] = ''), [[0, 2, 'TEXT']]],
    ['control reference', (b) => (b[1][0][3] = 'Fee\u0007'), [[1, 2, 'TEXT']]],
    [
      'other merchant',
      (b) => (b[0][3][6] = 'MID-55032'),
      [[0, 5, 'ROW_SCOPE']],
    ],
    ['other currency', (b) => (b[3][1][4] = 'USD'), [[3, 3, 'ROW_SCOPE']]],
    ['other bank', (b) => (b[4][0][4] = 'KW-IBAN-0008'), [[4, 2, 'ROW_SCOPE']]],
    ['extra cell', (b) => b[1][0].push('note'), [[1, 2, 'COLUMNS']]],
    [
      'repeated transaction',
      (b) => (b[0][3][0] = 'TXN-901'),
      [
        [0, 2, 'DUPLICATE'],
        [0, 5, 'DUPLICATE'],
      ],
    ],
    [
      'payout credited twice',
      (b) => b[4].push(credit('BK-2', 'PO-1', '2027-10-23', '236.395')),
      [
        [4, 2, 'DUPLICATE'],
        [4, 3, 'DUPLICATE'],
      ],
    ],
    [
      'batch twice in one payout',
      (b) => b[3].push(line('PO-1', 'STL-B', '0')),
      [
        [3, 3, 'DUPLICATE'],
        [3, 4, 'DUPLICATE'],
      ],
    ],
    [
      'settlement row in error',
      (b) => (b[2][1][1] = '2027-11-01'),
      [
        [0, 5, 'MEMBER'],
        [1, 3, 'MEMBER'],
        [2, 3, 'PERIOD'],
        [3, 3, 'MEMBER'],
      ],
    ],
    // After the cascade, so a member check that is gone fails an assertion
    // before the review meets a batch it does not know.
    ['member of no batch', (b) => (b[1][1][1] = 'STL-Z'), [[1, 3, 'MEMBER']]],
  ];
  for (const [name, change, want] of cases) {
    const r = await run(edit(change));
    assert.equal(r.refused, 'SOURCE_ERRORS', name);
    assert.deepEqual(
      r.errors.map((e) => [e.source, e.row, e.code]),
      want,
      name,
    );
    assert.deepEqual([r.batches, r.payouts, r.credits], [[], [], []], name);
    assert.deepEqual(r.records.transactions, [], name);
  }
});

void test('a zero fee stays a member, a blank line is skipped and rows keep their physical numbers', async () => {
  const book = edit((b) => b[1].push(fee('FE-13', 'STL-B', '0.000')));
  const parts = files(book);
  const text = new TextDecoder().decode(parts[0].original);
  const lines = text.split('\r\n');
  lines.splice(2, 0, '', ' , ');
  parts[0] = snapshot('tx.csv', new TextEncoder().encode(lines.join('\r\n')));
  const r = await replay({
    files: parts,
    readings: READINGS,
    scope: SCOPE,
  });
  assert.equal(r.refused, null);
  assert.deepEqual(r.batches[0].sales, [2, 5]);
  assert.deepEqual(r.batches[1].fees, [3, 4]);
});

void test('row order changes row numbers only', async () => {
  const forward = await run(base());
  const reversed = await run(base().map((rows) => [...rows].reverse()));
  const byId = (r: typeof forward) =>
    r.batches
      .map((x) =>
        JSON.stringify([x.batch, x.status, x.reasons, x.paid, x.components]),
      )
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(byId(reversed), byId(forward));
  assert.deepEqual(reversed.payouts[0].batches, ['STL-B', 'STL-A']);
  assert.deepEqual(
    JSON.stringify(await run(base())),
    JSON.stringify(forward),
    'the same bytes give the same result',
  );
});

void test('refusals in the contract order: READING, SCOPE, then each file read and its headers', async () => {
  await refusal(
    run(
      base(),
      SCOPE,
      READINGS.map((r, i) =>
        i === 2 ? { ...r, family: 'payment-gateway-batch-1' } : r,
      ),
    ),
    'READING',
  );
  await refusal(run(base(), SCOPE, [...READINGS].reverse()), 'READING');
  await refusal(run(base(), SCOPE, READINGS.slice(1)), 'READING');
  for (const scope of [
    { ...SCOPE, confirmed: false },
    { ...SCOPE, asOf: '2027-10-30' },
    { ...SCOPE, end: '2027-09-30' },
    { ...SCOPE, currency: 'XAU' },
    { ...SCOPE, currency: 'kwd' },
    { ...SCOPE, start: '2027-02-30' },
    { ...SCOPE, merchantAccount: ' MID-55031' },
    { ...SCOPE, extra: 'x' },
  ])
    await refusal(run(base(), scope), 'SCOPE');
  const { merchantAccount: _, ...missing } = SCOPE;
  await refusal(run(base(), missing), 'SCOPE');
  // SCOPE before a file that cannot be read.
  const bad = files(base());
  bad[0] = { ...bad[0], name: 'tx.txt' };
  await refusal(
    replayGatewayBatches({
      files: bad,
      readings: READINGS,
      scope: { ...SCOPE, confirmed: false as unknown as true },
    }),
    'SCOPE',
  );
  await refusal(
    replayGatewayBatches({ files: bad, readings: READINGS, scope: SCOPE }),
    'SOURCE',
  );
  const headers = (side: number, head: string[]) =>
    PG_BATCHES_HEADERS.map((h, i) => (i === side ? head : h));
  for (const head of [
    PG_BATCHES_HEADERS[0].filter((h) => h !== 'Reference'),
    [...PG_BATCHES_HEADERS[0], 'Reference'],
    [...PG_BATCHES_HEADERS[0], 'Channel'],
    PG_BATCHES_HEADERS[0].map((h) => h.toLowerCase()),
  ])
    await refusal(
      replayGatewayBatches({
        files: files(base(), headers(0, head)),
        readings: READINGS,
        scope: SCOPE,
      }),
      'COLUMNS',
    );
  // Headers in another order, padded, with blank trailing headers, are read.
  const moved = [...PG_BATCHES_HEADERS[3]].reverse();
  const book = base();
  book[3] = book[3].map((r) => [...r].reverse());
  const shuffled = files(book, headers(3, moved));
  const padded = new TextEncoder().encode(
    csvText([
      [' Bank reference ', ...PG_BATCHES_HEADERS[4].slice(1), '', ''],
      ...base()[4],
    ]),
  );
  shuffled[4] = snapshot('credits.csv', padded);
  const read = await replay({
    files: shuffled,
    readings: READINGS,
    scope: SCOPE,
  });
  assert.equal(read.refused, null);
  assert.equal(read.payouts[0].status, 'consistent');
  // COLUMNS of an earlier file before SOURCE of a later one.
  const order = files(base(), headers(1, ['Fee ID']));
  order[3] = { ...order[3], name: 'lines.pdf' };
  await refusal(
    replayGatewayBatches({ files: order, readings: READINGS, scope: SCOPE }),
    'COLUMNS',
  );
  const forged = files(base());
  forged[2] = { ...forged[2], sha256: forged[1].sha256 };
  await refusal(
    replayGatewayBatches({ files: forged, readings: READINGS, scope: SCOPE }),
    'SOURCE_HASH',
  );
  await refusal(
    replayGatewayBatches({
      files: files(base()).slice(1),
      readings: READINGS,
      scope: SCOPE,
    }),
    'SOURCE',
  );
});

void test('the comma grammar: quotes are kept, a stray quote or bad bytes are SOURCE, no delimiter is guessed', async () => {
  const bytes = (text: string) =>
    new TextEncoder().encode(text).buffer as ArrayBuffer;
  assert.deepEqual(
    gatewayBatchesCSV(bytes('\ufeffa,"b,""c""\r\nd"\n\n"",e\r')),
    [['a', 'b,"c"\r\nd'], [], ['', 'e']],
  );
  assert.deepEqual(gatewayBatchesCSV(bytes('a;b;c\n')), [['a;b;c']]);
  assert.deepEqual(
    gatewayBatchesCSV(bytes('\ufeff\ufeffa\n')),
    [['\ufeffa']],
    'one byte order mark is dropped, a second is a character',
  );
  for (const text of ['a"b,c\n', 'a"b"\n', '"a"b,c\n', '"a,b\n', 'a,b\u0000\n'])
    assert.throws(
      () => gatewayBatchesCSV(bytes(text)),
      (e: Error) => e.message === 'PG_BATCHES_SOURCE',
      JSON.stringify(text),
    );
  assert.throws(
    () => gatewayBatchesCSV(Uint8Array.from([0x61, 0xff, 0x0a]).buffer),
    (e: Error) => e.message === 'PG_BATCHES_SOURCE',
  );
  const quoted = files(base());
  quoted[0] = snapshot(
    'tx.csv',
    new TextEncoder().encode(
      csvText([[...PG_BATCHES_HEADERS[0]], ...base()[0]]).replace(
        'Order TXN-901',
        '"Order, TXN-901"',
      ),
    ),
  );
  const r = await replay({
    files: quoted,
    readings: READINGS,
    scope: SCOPE,
  });
  assert.equal(r.records.transactions[0].reference, 'Order, TXN-901');
});

void test('the reader ceiling: 20,030 rows with the header are read, one more is ROWS', async () => {
  const many = (n: number) => {
    const book = base();
    book[0] = [];
    let cents = 0;
    for (let i = 0; i < n; i++) {
      book[0].push(sale(`TXN-${i}`, 'STL-B', '0.001'));
      cents += 1;
    }
    book[2][1] = settle('STL-B', (cents / 1000).toFixed(3), '0', '1.250', '0');
    return book;
  };
  const at = await run(many(20029));
  assert.equal(at.refused, null);
  assert.equal(at.batches[1].sales.length, 20029);
  await refusal(run(many(20030)), 'ROWS');
});

void test('a total no integer holds exactly is refused, never rounded', async () => {
  const yen = { ...SCOPE, currency: 'JPY' };
  const book: Book = [
    Array.from({ length: 91 }, (_, i) => [
      `TXN-${i}`,
      'STL-J',
      'sale',
      '2027-10-05',
      '100000000000000',
      'Order',
      MID,
      'JPY',
    ]),
    [],
    [['STL-J', '2027-10-20', '1', '0', '0', '1', MID, 'JPY']],
    [],
    [],
  ];
  await refusal(run(book, yen), 'TOTAL_LIMIT');
  book[0] = book[0].slice(0, 90);
  const r = await run(book, yen);
  assert.equal(r.batches[0].components.sales, 9e15);
  const decimals = await run(
    [
      [['TXN-1', 'STL-J', 'sale', '2027-10-05', '100.0', 'Order', MID, 'JPY']],
      [],
      [['STL-J', '2027-10-20', '100', '0', '0', '100', MID, 'JPY']],
      [],
      [],
    ],
    yen,
  );
  assert.deepEqual(decimals.errors, [{ source: 0, row: 2, code: 'AMOUNT' }]);
});

const xlsx = async (
  rows: Rows,
  change: (sheet: ExcelJS.Worksheet) => void,
): Promise<Uint8Array> => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Gateway');
  sheet.addRows(rows);
  change(sheet);
  return new Uint8Array(await book.xlsx.writeBuffer());
};

void test('XLSX: a hidden row or a formula is CELL, a hidden header row or a hidden column under the header is COLUMNS', async () => {
  const tx = [[...PG_BATCHES_HEADERS[0]], ...base()[0]];
  const with_ = async (change: (sheet: ExcelJS.Worksheet) => void) => {
    const parts = files(base());
    parts[0] = snapshot('tx.xlsx', await xlsx(tx, change));
    return replay({
      files: parts,
      readings: READINGS,
      scope: SCOPE,
    });
  };
  const plain = await with_(() => {});
  assert.equal(plain.refused, null);
  assert.equal(plain.sources[0].sheet, 'Gateway');
  const hidden = await with_((s) => (s.getRow(3).hidden = true));
  assert.deepEqual(hidden.errors, [{ source: 0, row: 3, code: 'CELL' }]);
  const formula = await with_(
    (s) => (s.getCell('E2').value = { formula: '100+20.5', result: 120.5 }),
  );
  assert.deepEqual(formula.errors, [{ source: 0, row: 2, code: 'CELL' }]);
  const blankHidden = await with_((s) => {
    s.getRow(7).hidden = true;
    s.getCell('A7').value = ' ';
  });
  assert.deepEqual(blankHidden.errors, [{ source: 0, row: 7, code: 'CELL' }]);
  await refusal(
    with_((s) => (s.getRow(1).hidden = true)),
    'COLUMNS',
  );
  await refusal(
    with_((s) => (s.getColumn(6).hidden = true)),
    'COLUMNS',
  );
  const merged = await with_((s) => s.mergeCells('F2:G2'));
  assert.deepEqual(merged.errors, [{ source: 0, row: 2, code: 'CELL' }]);
  const timed = await with_(
    (s) => (s.getCell('D3').value = new Date('2027-10-05T10:30:00Z')),
  );
  assert.deepEqual(timed.errors, [{ source: 0, row: 3, code: 'CELL' }]);
  const numericId = await with_((s) => {
    s.getCell('A2').value = 901;
    s.getCell('A2').numFmt = '0.00';
  });
  assert.deepEqual(numericId.errors, [{ source: 0, row: 2, code: 'CELL' }]);
  const formatted = await with_((s) => {
    s.getCell('E2').value = 120.5;
    s.getCell('E2').numFmt = '0.000';
  });
  assert.equal(
    formatted.refused,
    null,
    'an amount shown to its places is read',
  );
  assert.equal(formatted.batches[0].components.sales, 200750);
  await refusal(
    with_((s) => (s.getCell('A20031').value = 'x')),
    'ROWS',
  );
  const number = await with_((s) => (s.getCell('E2').value = 120.5));
  assert.equal(number.refused, null, 'a plain number cell is its own digits');
  assert.equal(number.batches[0].components.sales, 200750);
});
