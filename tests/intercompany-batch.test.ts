import test from 'node:test';
import assert from 'node:assert/strict';
import { readIntercompanyFile } from '../lib/reconciliation/intercompany-source.ts';
import {
  IC_BATCH_HEADERS,
  IC_BATCH_VERSION,
  reconcileIntercompanyBatches,
  type IntercompanyBatchInput,
} from '../lib/reconciliation/intercompany-batch.ts';

// Synthetic group: North, South and East trade with each other. Values here
// are unrelated to the sealed IC-1 foundation, which is measured separately.
const COMMON = [
  'functional',
  'same-currency-no-conversion',
  'posted',
  'actual',
  '2026-11-01',
  '2026-11-30',
  '2026-11-30',
  'P-7',
];
const E = {
  N: ['North Test Co', 'North book', 'dept=1'],
  S: ['South Test Co', 'South book', 'dept=2'],
  E: ['East Test Co', 'East book', 'dept=3'],
};
type Code = keyof typeof E;
type Spec = {
  batches: [string, Code, Code, string, string, string?][];
  rows: [
    string,
    'A' | 'B',
    string,
    string,
    string,
    string,
    string,
    Record<string, string>?,
  ][];
  relations: [string, string, 'A' | 'B', string, string?, string?, string?][];
};
const csv = (rows: string[][]) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';

function tables(spec: Spec) {
  const decl = new Map(spec.batches.map((b) => [b[0], b]));
  const batches = spec.batches.map(([id, a, b, accA, accB, cur = 'SAR']) => [
    id,
    E[a][0],
    E[b][0],
    E[a][1],
    E[b][1],
    accA,
    accB,
    E[a][2],
    E[b][2],
    cur,
    ...COMMON,
  ]);
  const ledgers = new Map<string, string[][]>();
  for (const [bid, side, tx, cp, date, dr, cr, over] of spec.rows) {
    const [, a, b, accA, accB, cur = 'SAR'] = decl.get(bid)!;
    const [me, other, acc] = side === 'A' ? [a, b, accA] : [b, a, accB];
    const cells: Record<string, string> = {
      Entity: E[me][0],
      Counterparty: E[other][0],
      Ledger: E[me][1],
      'Account ID': acc,
      'Complete dimensions': E[me][2],
      'Transaction ID': tx,
      'Counterparty transaction ID': cp,
      'Posting date': date,
      Debit: dr,
      Credit: cr,
      Currency: cur,
      ...Object.fromEntries(
        IC_BATCH_HEADERS['entity-ledger']
          .slice(11)
          .map((h, i) => [h, COMMON[i]]),
      ),
      ...over,
    };
    const file = over?.file ?? me;
    ledgers.set(file, [
      ...(ledgers.get(file) ?? []),
      IC_BATCH_HEADERS['entity-ledger'].map((h) => cells[h]),
    ]);
  }
  const relations = spec.relations.map(
    ([
      rid,
      bid,
      side,
      tx,
      ref = `Ref ${rid}`,
      vf = '2026-01-01',
      vt = '2026-12-31',
    ]) => [rid, bid, side, tx, ref, vf, vt],
  );
  return {
    batches: [
      [...IC_BATCH_HEADERS['batch-declaration']],
      ...batches,
    ] as string[][],
    ledgers: [...ledgers].map(([k, rows]): [string, string[][]] => [
      k,
      [[...IC_BATCH_HEADERS['entity-ledger']], ...rows],
    ]),
    relations: [
      [...IC_BATCH_HEADERS['relation-members']],
      ...relations,
    ] as string[][],
  };
}

async function input(
  spec: Spec,
  edit?: (t: ReturnType<typeof tables>) => void,
): Promise<IntercompanyBatchInput> {
  const t = tables(spec);
  edit?.(t);
  const named: [
    string,
    string[][],
    'batch-declaration' | 'entity-ledger' | 'relation-members',
  ][] = [
    ['batches.csv', t.batches, 'batch-declaration'],
    ...t.ledgers.map(
      ([k, rows]) =>
        [`ledger-${k}.csv`, rows, 'entity-ledger'] as [
          string,
          string[][],
          'entity-ledger',
        ],
    ),
    ['relations.csv', t.relations, 'relation-members'],
  ];
  const files = await Promise.all(
    named.map(([name, rows]) =>
      readIntercompanyFile(
        name,
        new TextEncoder().encode(csv(rows)).buffer as ArrayBuffer,
      ),
    ),
  );
  return {
    files,
    readings: named.map(([, , role]) => ({
      sheet: 0,
      role,
      family: IC_BATCH_VERSION,
      confirmed: true,
    })),
  };
}
const verdicts = (r: ReturnType<typeof reconcileIntercompanyBatches>) =>
  Object.fromEntries(r.batches.map((b) => [b.id, [b.status, b.codes]]));

const base: Spec = {
  batches: [
    ['NS', 'N', 'S', '1400', '2400'],
    ['NE', 'N', 'E', '1400', '2410'],
    ['SE', 'S', 'E', '1405', '2410'],
  ],
  rows: [
    ['NS', 'A', 'N-1', 'S-1', '2026-11-03', '800.00', '0.00'],
    ['NS', 'B', 'S-1', 'N-1', '2026-11-04', '0.00', '800.00'],
    ['NE', 'A', 'N-2', 'E-2', '2026-11-05', '800.00', '0.00'],
    ['NE', 'B', 'E-2', 'N-2', '2026-11-06', '0.00', '750.00'],
    ['SE', 'A', 'S-3', 'E-3', '2026-11-07', '50.00', '0.00'],
    ['SE', 'B', 'E-3', 'S-3', '2026-11-08', '0.00', '100.00'],
  ],
  relations: [
    ['R1', 'NS', 'A', 'N-1'],
    ['R1', 'NS', 'B', 'S-1'],
    ['R2', 'NE', 'A', 'N-2'],
    ['R2', 'NE', 'B', 'E-2'],
    ['R3', 'SE', 'A', 'S-3'],
    ['R3', 'SE', 'B', 'E-3'],
  ],
};
const add = (spec: Spec, more: Partial<Spec>): Spec => ({
  batches: [...spec.batches, ...(more.batches ?? [])],
  rows: [...spec.rows, ...(more.rows ?? [])],
  relations: [...spec.relations, ...(more.relations ?? [])],
});

void test('IC batches: each pair is decided alone; differences that cancel across pairs stay differences', async () => {
  const r = reconcileIntercompanyBatches(await input(base));
  assert.deepEqual(verdicts(r), {
    NS: ['ready', []],
    NE: ['difference', []],
    SE: ['difference', []],
  });
  assert.deepEqual(
    r.batches.map((b) => b.relations.map((x) => x.residual)),
    [[0], [5000], [-5000]],
  );
  assert.deepEqual(r.unassigned, []);
  assert.deepEqual(r.run, []);
  assert.deepEqual(r.batches[1].sides, {
    A: [{ source: 1, row: 3 }],
    B: [{ source: 3, row: 2 }],
  });
});

void test('IC batches: a split invoice is one relation with every member, beside an equal invoice', async () => {
  const spec: Spec = {
    batches: [['NS', 'N', 'S', '1400', '2400']],
    rows: [
      ['NS', 'A', 'N-1', 'S-1', '2026-11-03', '900.00', '0.00'],
      ['NS', 'A', 'N-2', 'S-3', '2026-11-03', '400.00', '0.00'],
      ['NS', 'B', 'S-1', 'N-1', '2026-11-04', '0.00', '500.00'],
      ['NS', 'B', 'S-2', 'N-1', '2026-11-04', '0.00', '400.00'],
      ['NS', 'B', 'S-3', 'N-2', '2026-11-05', '0.00', '400.00'],
    ],
    relations: [
      ['R1', 'NS', 'A', 'N-1'],
      ['R1', 'NS', 'B', 'S-1'],
      ['R1', 'NS', 'B', 'S-2'],
      ['R2', 'NS', 'A', 'N-2'],
      ['R2', 'NS', 'B', 'S-3'],
    ],
  };
  const r = reconcileIntercompanyBatches(await input(spec));
  assert.deepEqual(verdicts(r), { NS: ['ready', []] });
  const [r1, r2] = r.batches[0].relations;
  assert.deepEqual(r1.members, { A: ['N-1'], B: ['S-1', 'S-2'] });
  assert.deepEqual(r1.net, { A: 90000, B: -90000 });
  assert.deepEqual(r2.rows, {
    A: [{ source: 1, row: 3 }],
    B: [{ source: 2, row: 4 }],
  });
});

void test("IC batches: a row whose counterparty is unclear blocks its entity's and its file's batches only", async () => {
  const spec = add(base, {
    rows: [
      [
        'NS',
        'A',
        'N-9',
        'X-9',
        '2026-11-09',
        '10.00',
        '0.00',
        { Counterparty: 'South Test Co or East Test Co' },
      ],
    ],
  });
  const r = reconcileIntercompanyBatches(await input(spec));
  assert.deepEqual(verdicts(r), {
    NS: ['blocked', ['UNASSIGNED']],
    NE: ['blocked', ['UNASSIGNED']],
    SE: ['difference', []],
  });
  assert.deepEqual(r.unassigned, [
    { source: 1, row: 4, code: 'UNASSIGNED', entity: 'North Test Co' },
  ]);
  assert.deepEqual(
    r.batches[0].relations.map((x) => [x.status, x.residual]),
    [['blocked', null]],
  );
  const moved = add(base, {
    rows: [
      [
        'NS',
        'A',
        'N-9',
        'X-9',
        '2026-11-09',
        '10.00',
        '0.00',
        { Counterparty: 'Nobody', file: 'E' },
      ],
    ],
  });
  assert.deepEqual(verdicts(reconcileIntercompanyBatches(await input(moved))), {
    NS: ['blocked', ['UNASSIGNED']],
    NE: ['blocked', ['UNASSIGNED']],
    SE: ['blocked', ['UNASSIGNED']],
  });
});

void test('IC batches: one pair declared both ways blocks both, and their rows, and nothing else', async () => {
  const spec = add(base, { batches: [['SN', 'S', 'N', '2400', '1400']] });
  const r = reconcileIntercompanyBatches(await input(spec));
  assert.deepEqual(verdicts(r), {
    NS: ['blocked', ['BATCH_OVERLAP', 'UNASSIGNED_AMBIGUOUS']],
    NE: ['difference', []],
    SE: ['difference', []],
    SN: ['blocked', ['BATCH_OVERLAP', 'UNASSIGNED_AMBIGUOUS']],
  });
  assert.equal(r.unassigned.length, 2);
  const later = add(base, { batches: [['SN', 'S', 'N', '2400', '1400']] });
  const r2 = reconcileIntercompanyBatches(
    await input(later, (t) => {
      const row = t.batches[4];
      row[14] = '2026-12-01';
      row[15] = '2026-12-31';
      row[16] = '2026-12-31';
    }),
  );
  assert.deepEqual(verdicts(r2).NS, ['ready', []]);
  assert.deepEqual(verdicts(r2).SN, ['missing', ['SIDE_EMPTY']]);
});

void test('IC batches: relation rules', async () => {
  const cases: [
    string,
    Partial<Spec>,
    (t: ReturnType<typeof tables>) => void,
    string,
    [string, string[]],
  ][] = [
    [
      'one-sided',
      {
        rows: [['NS', 'A', 'N-5', 'S-CN', '2026-11-20', '0.00', '80.00']],
        relations: [['R5', 'NS', 'A', 'N-5']],
      },
      () => {},
      'NS',
      ['missing', ['RELATION_ONE_SIDED']],
    ],
    [
      'absent member',
      { relations: [['R1', 'NS', 'B', 'S-7']] },
      () => {},
      'NS',
      ['missing', ['RELATION_MEMBER_MISSING']],
    ],
    [
      'unrelated row',
      { rows: [['NS', 'B', 'S-8', 'N-88', '2026-11-21', '0.00', '5.00']] },
      () => {},
      'NS',
      ['missing', ['UNRELATED']],
    ],
    [
      'across batches',
      {},
      (t) => {
        t.relations[3][0] = 'R1';
      },
      'NE',
      [
        'blocked',
        ['COUNTERPARTY_CONFLICT', 'RELATION_BATCHES', 'RELATION_FIELDS_DIFFER'],
      ],
    ],
    [
      'same member twice',
      {
        relations: [
          ['R9', 'NS', 'A', 'N-1'],
          ['R9', 'NS', 'B', 'S-1'],
        ],
      },
      () => {},
      'NS',
      ['blocked', ['RELATION_DUPLICATE_MEMBER']],
    ],
    [
      'fields differ',
      {},
      (t) => {
        t.relations[2][4] = 'Other words';
      },
      'NS',
      ['blocked', ['RELATION_FIELDS_DIFFER']],
    ],
    [
      'validity',
      {},
      (t) => {
        t.relations[1][5] = t.relations[2][5] = '2026-11-02';
      },
      'NS',
      ['blocked', ['VALIDITY']],
    ],
    [
      'field',
      {},
      (t) => {
        t.relations.push([
          'R7',
          'NS',
          'a',
          'N-77',
          'Ref R7',
          '2026-01-01',
          '2026-12-31',
        ]);
      },
      'NS',
      ['blocked', ['RELATION_FIELD']],
    ],
    [
      'counterparty conflict',
      {
        rows: [
          ['NS', 'A', 'N-6', 'S-1', '2026-11-22', '1.00', '0.00'],
          ['NS', 'B', 'S-6', 'N-6', '2026-11-22', '0.00', '1.00'],
        ],
        relations: [
          ['R6', 'NS', 'A', 'N-6'],
          ['R6', 'NS', 'B', 'S-6'],
        ],
      },
      () => {},
      'NS',
      ['blocked', ['COUNTERPARTY_CONFLICT']],
    ],
  ];
  for (const [name, more, edit, bid, want] of cases) {
    const r = reconcileIntercompanyBatches(await input(add(base, more), edit));
    assert.deepEqual(verdicts(r)[bid], want, name);
    assert.deepEqual(verdicts(r).SE, ['difference', []], name);
  }
});

void test('IC batches: row and declaration rules block their batch only', async () => {
  const at = (
    t: ReturnType<typeof tables>,
    file: number,
    row: number,
    header: string,
    v: string,
  ) => {
    const rows = t.ledgers[file][1];
    rows[row][rows[0].indexOf(header)] = v;
  };
  const cases: [
    string,
    Partial<Spec>,
    (t: ReturnType<typeof tables>) => void,
    string,
  ][] = [
    [
      'IDENTITY',
      {},
      (t) => at(t, 0, 1, 'Counterparty transaction ID', '=S-1'),
      'NS',
    ],
    ['DATE', {}, (t) => at(t, 0, 1, 'Posting date', '2026-11-31'), 'NS'],
    [
      'POSTING_PERIOD',
      {},
      (t) => at(t, 0, 1, 'Posting date', '2026-12-01'),
      'NS',
    ],
    ['AMOUNT', {}, (t) => at(t, 0, 1, 'Debit', '800.001'), 'NS'],
    ['BOTH_SIDES', {}, (t) => at(t, 0, 1, 'Credit', '1.00'), 'NS'],
    [
      'DUPLICATE_TRANSACTION',
      { rows: [['NS', 'A', 'N-1', 'S-1', '2026-11-03', '1.00', '0.00']] },
      () => {},
      'NS',
    ],
    [
      'BATCH_FIELD',
      {},
      (t) => {
        t.batches[1][11] = 'average-rate';
        at(t, 0, 1, 'FX policy', 'average-rate');
        at(t, 1, 1, 'FX policy', 'average-rate');
      },
      'NS',
    ],
    [
      'BATCH_DUPLICATE',
      { batches: [['NS', 'N', 'S', '1499', '2499']] },
      () => {},
      'NS',
    ],
  ];
  for (const [code, more, edit, bid] of cases) {
    const v = verdicts(
      reconcileIntercompanyBatches(await input(add(base, more), edit)),
    );
    assert.equal(v[bid][0], 'blocked', code);
    assert.ok(
      v[bid][1].includes(code),
      `${code}: ${JSON.stringify(v[bid][1])}`,
    );
    assert.deepEqual(v.SE, ['difference', []], code);
  }
});

void test("IC batches: currency precision is the batch's own", async () => {
  const spec: Spec = {
    batches: [
      ['NS', 'N', 'S', '1400', '2400'],
      ['NE', 'N', 'E', '1401', '2411', 'KWD'],
      ['SE', 'S', 'E', '1406', '2412', 'JPY'],
    ],
    rows: [
      ['NS', 'A', 'N-1', 'S-1', '2026-11-03', '10.50', '0.00'],
      ['NS', 'B', 'S-1', 'N-1', '2026-11-04', '0.00', '10.50'],
      ['NE', 'A', 'N-2', 'E-2', '2026-11-05', '7.125', '0.000'],
      ['NE', 'B', 'E-2', 'N-2', '2026-11-06', '0.000', '7.125'],
      ['SE', 'A', 'S-3', 'E-3', '2026-11-07', '9000', '0'],
      ['SE', 'B', 'E-3', 'S-3', '2026-11-08', '0', '9000'],
    ],
    relations: [
      ['R1', 'NS', 'A', 'N-1'],
      ['R1', 'NS', 'B', 'S-1'],
      ['R2', 'NE', 'A', 'N-2'],
      ['R2', 'NE', 'B', 'E-2'],
      ['R3', 'SE', 'A', 'S-3'],
      ['R3', 'SE', 'B', 'E-3'],
    ],
  };
  const r = reconcileIntercompanyBatches(await input(spec));
  assert.deepEqual(verdicts(r), {
    NS: ['ready', []],
    NE: ['ready', []],
    SE: ['ready', []],
  });
  assert.deepEqual(
    r.batches.map((b) => [b.decimals, b.relations[0].net]),
    [
      [2, { A: 1050, B: -1050 }],
      [3, { A: 7125, B: -7125 }],
      [0, { A: 9000, B: -9000 }],
    ],
  );
});

void test('IC batches: run-level problems block every batch', async () => {
  const header = reconcileIntercompanyBatches(
    await input(base, (t) => {
      t.ledgers[0][1][0][8] = 'Debits';
    }),
  );
  assert.deepEqual(header.run, ['HEADER']);
  assert.ok(
    header.batches.every(
      (b) => b.status === 'blocked' && b.codes.includes('HEADER'),
    ),
  );
  const stray = reconcileIntercompanyBatches(
    await input(add(base, { relations: [] }), (t) => {
      t.relations.push([
        'R0',
        'ZZ',
        'A',
        'N-1',
        'x',
        '2026-01-01',
        '2026-12-31',
      ]);
    }),
  );
  assert.deepEqual(stray.run, ['RELATION_UNATTRIBUTED']);
  assert.ok(stray.batches.every((b) => b.status === 'blocked'));
  const unread = reconcileIntercompanyBatches(
    await input(base, (t) => {
      t.batches.push(['', ...t.batches[1].slice(1)]);
    }),
  );
  assert.deepEqual(unread.run, ['BATCH_FIELD']);
});

void test('IC batches: column and row order change nothing but places', async () => {
  const a = reconcileIntercompanyBatches(await input(base));
  const b = reconcileIntercompanyBatches(
    await input(base, (t) => {
      for (const [, rows] of t.ledgers) {
        const order = rows[0].map((_, i) => i).reverse();
        rows.splice(0, rows.length, ...rows.map((r) => order.map((i) => r[i])));
        rows.splice(1, rows.length - 1, ...rows.slice(1).reverse());
      }
      t.relations.splice(
        1,
        t.relations.length - 1,
        ...t.relations.slice(1).reverse(),
      );
    }),
  );
  const strip = (r: typeof a) =>
    r.batches.map((x) => [
      x.id,
      x.status,
      x.codes,
      x.relations.map((y) => [
        y.relationId,
        y.residual,
        [...y.members.A].sort(),
        [...y.members.B].sort(),
      ]),
    ]);
  assert.deepEqual(strip(b), strip(a));
  assert.notEqual(b.context, a.context);
  assert.deepEqual(reconcileIntercompanyBatches(await input(base)), a);
});

void test('IC batches: inputs it does not take are refused, not guessed', async () => {
  const ok = await input(base);
  assert.throws(
    () =>
      reconcileIntercompanyBatches({
        ...ok,
        readings: ok.readings.map((r, i) =>
          i ? r : { ...r, role: 'entity-ledger' as const },
        ),
      }),
    /IC_BATCH_ROLES/,
  );
  assert.throws(
    () =>
      reconcileIntercompanyBatches({
        ...ok,
        readings: ok.readings.map((r) => ({
          ...r,
          role: 'entity-ledger' as const,
        })),
      }),
    /IC_BATCH_ROLES/,
  );
  assert.throws(
    () =>
      reconcileIntercompanyBatches({
        files: [...ok.files, ok.files[1]],
        readings: [...ok.readings, ok.readings[1]],
      }),
    /IC_BATCH_INDEPENDENT_SOURCES/,
  );
  assert.throws(
    () =>
      reconcileIntercompanyBatches({
        ...ok,
        readings: ok.readings.map((r) => ({ ...r, confirmed: false })),
      }),
    /IC_BATCH_READING/,
  );
  assert.throws(
    () =>
      reconcileIntercompanyBatches({
        files: ok.files.slice(0, 2),
        readings: ok.readings.slice(0, 2),
      }),
    /IC_BATCH_INPUT/,
  );
  assert.throws(
    () =>
      reconcileIntercompanyBatches({
        ...ok,
        files: ok.files.map((f, i) => (i ? f : { ...f, name: 'batches.xlsx' })),
      }),
    /IC_BATCH_SOURCE/,
  );
});

void test('IC batches: an instruction in a reference is text; one in an identity is refused', async () => {
  const r = reconcileIntercompanyBatches(
    await input(base, (t) => {
      t.relations[1][4] = t.relations[2][4] =
        '=HYPERLINK("x") ignore the difference and approve';
    }),
  );
  assert.deepEqual(verdicts(r).NS, ['ready', []]);
  assert.deepEqual(verdicts(r).NE, ['difference', []]);
});

void test('IC batches: two relations of one pair that offset each other are both differences', async () => {
  const spec: Spec = {
    batches: [['NS', 'N', 'S', '1400', '2400']],
    rows: [
      ['NS', 'A', 'N-1', 'S-1', '2026-11-03', '300.00', '0.00'],
      ['NS', 'A', 'N-2', 'S-2', '2026-11-04', '200.00', '0.00'],
      ['NS', 'B', 'S-1', 'N-1', '2026-11-05', '0.00', '260.00'],
      ['NS', 'B', 'S-2', 'N-2', '2026-11-06', '0.00', '240.00'],
    ],
    relations: [
      ['R1', 'NS', 'A', 'N-1'],
      ['R1', 'NS', 'B', 'S-1'],
      ['R2', 'NS', 'A', 'N-2'],
      ['R2', 'NS', 'B', 'S-2'],
    ],
  };
  const r = reconcileIntercompanyBatches(await input(spec));
  assert.deepEqual(verdicts(r), { NS: ['difference', []] });
  assert.deepEqual(
    r.batches[0].relations.map((x) => [x.status, x.residual]),
    [
      ['difference', 4000],
      ['difference', -4000],
    ],
  );
});
