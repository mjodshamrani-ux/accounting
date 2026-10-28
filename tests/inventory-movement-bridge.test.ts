import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  IMB_COLUMNS,
  IMB_GL_COLUMNS,
  IMB_ROLES,
  IMB_VERSION,
  imbNumber,
  imbRecords,
  imbText,
  reconcileMovementBridge,
  type ImbInput,
  type ImbResult,
  type ImbScopeField,
} from '../lib/reconciliation/inventory-movement-bridge.ts';
import { replayMovementBridge } from '../lib/reconciliation/inventory-movement-bridge-io.ts';

// A synthetic spare-parts dealer in Qatari riyals for February 2027; none of
// its items, warehouses, accounts or amounts come from the sealed INV-2
// stories.
const START = '2027-02-01',
  END = '2027-02-28',
  MID = '2027-02-14';
const SCOPE: Record<ImbScopeField, string> = {
  Entity: 'Synthetic Spare Parts WLL',
  Currency: 'QAR',
  'Period start': START,
  'Period end': END,
  'Negative balances': 'not allowed',
};
const INFLOWS = ['receipt', 'transfer-in', 'adjustment-in', 'return-in'];
const OUTFLOWS = ['issue', 'transfer-out', 'adjustment-out', 'return-out'];

type Row = string[];
type Opts = {
  item?: string;
  dims?: string;
  unit?: string;
  acct?: string;
  md?: string;
  pd?: string;
  tid?: string;
  oid?: string;
  id?: string;
};
const line = (id: string, kind: string, q: string, v: string, o: Opts = {}) => {
  const md =
    o.md ?? (kind === 'opening' ? START : kind === 'closing' ? END : MID);
  return [
    o.id ?? id,
    o.item ?? 'BRK-PAD',
    o.dims ?? 'site=DOH',
    kind,
    q,
    o.unit ?? 'set',
    v,
    md,
    o.pd ?? md,
    o.acct ?? '1401',
    o.tid ?? '',
    o.oid ?? '',
  ];
};
// Decimal text to an integer in 10^-places and back, for the test's own
// footing of the bridges and the GL.
const units = (t: string, places: number) => {
  const neg = t.startsWith('-'),
    [a, b = ''] = t.replace('-', '').split('.');
  const n =
    BigInt(a) * 10n ** BigInt(places) + BigInt(b.padEnd(places, '0') || '0');
  return neg ? -n : n;
};
const text = (n: bigint, places: number) => {
  const neg = n < 0n,
    s = String(neg ? -n : n).padStart(places + 1, '0');
  return (
    (neg ? '-' : '') +
    (places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s)
  );
};
const inPeriod = (r: Row) => START <= r[8] && r[8] <= END;
type Move = [string, string, string, Opts?];
/** An opening, movements and a closing footed from the movements posted in
 * February, unless given. */
function position(
  p: string,
  o: Opts & {
    opening?: [string, string] | null;
    moves?: Move[];
    closing?: [string, string] | null;
  } = {},
): Row[] {
  const rows: Row[] = [];
  const opening =
    o.opening === undefined
      ? (['40', '3200.00'] as [string, string])
      : o.opening;
  let q = 0n,
    v = 0n;
  if (opening) {
    rows.push(line(`${p}-O`, 'opening', opening[0], opening[1], o));
    q = units(opening[0], 3);
    v = units(opening[1], 2);
  }
  (o.moves ?? []).forEach(([kind, mq, mv, more], i) => {
    const r = line(`${p}-${i + 1}`, kind, mq, mv, { ...o, ...more });
    rows.push(r);
    if (inPeriod(r) && /^[0-9.]+$/.test(mq) && /^[0-9.]+$/.test(mv)) {
      const sign = INFLOWS.includes(kind) ? 1n : -1n;
      q += sign * units(mq, 3);
      v += sign * units(mv, 2);
    }
  });
  const closing =
    o.closing === undefined
      ? ([text(q, 3), text(v, 2)] as [string, string])
      : o.closing;
  if (closing) rows.push(line(`${p}-C`, 'closing', closing[0], closing[1], o));
  return rows;
}
/** The test's own GL: openings, February inflows as debits and outflows as
 * credits, a transfer within one account in neither. */
function glFor(rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows)
    if ((r[3] === 'transfer-in' || r[3] === 'transfer-out') && inPeriod(r)) {
      if (!groups.has(r[10])) groups.set(r[10], []);
      groups.get(r[10])!.push(r);
    }
  const internal = new Set<Row>();
  for (const g of groups.values())
    if (g.length === 2 && g[0][9] === g[1][9])
      g.forEach((r) => internal.add(r));
  const acc = new Map<string, [bigint, bigint, bigint]>();
  for (const r of rows) {
    if (!/^-?[0-9.]+$/.test(r[6])) continue;
    if (!acc.has(r[9])) acc.set(r[9], [0n, 0n, 0n]);
    const a = acc.get(r[9])!,
      v = units(r[6], 2);
    if (r[3] === 'opening') a[0] += v;
    else if (
      [...INFLOWS, ...OUTFLOWS].includes(r[3]) &&
      inPeriod(r) &&
      !internal.has(r)
    )
      a[INFLOWS.includes(r[3]) ? 1 : 2] += v;
  }
  return [
    [...IMB_GL_COLUMNS],
    ...[...acc.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, [o, d, c]]) => [
        k,
        text(o, 2),
        text(d, 2),
        text(c, 2),
        text(o + d - c, 2),
      ]),
  ];
}
const csv = (rows: Row[], end = '\n') =>
  rows
    .map((r) =>
      r
        .map((c) => (/[",\r\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c))
        .join(','),
    )
    .join(end) + end;
const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function input(
  register: Uint8Array,
  gl: Uint8Array,
  scope: Record<string, string> = SCOPE,
): ImbInput {
  return {
    files: [
      { name: 'register.csv', sha256: sha(register), bytes: register },
      { name: 'gl.csv', sha256: sha(gl), bytes: gl },
    ],
    readings: [
      { role: IMB_ROLES[0], family: IMB_VERSION, confirmed: true },
      { role: IMB_ROLES[1], family: IMB_VERSION, confirmed: true },
    ],
    scope: { confirmed: true, fields: scope as Record<ImbScopeField, string> },
  };
}
function run(
  rows: Row[],
  o: {
    gl?: Row[] | Uint8Array;
    scope?: Partial<Record<ImbScopeField, string>>;
    header?: Row;
    raw?: Uint8Array;
  } = {},
): ImbResult {
  const register = o.raw ?? bytes(csv([o.header ?? [...IMB_COLUMNS], ...rows]));
  const gl =
    o.gl instanceof Uint8Array ? o.gl : bytes(csv(o.gl ?? glFor(rows)));
  try {
    return reconcileMovementBridge(
      input(register, gl, { ...SCOPE, ...o.scope }),
    );
  } catch (error) {
    // Any well-formed input is judged; a throw here is a wrong result.
    assert.fail(`the engine stopped: ${String(error)}`);
  }
}
const positions = (r: ImbResult) =>
  Object.fromEntries(r.positions.map((p) => [p.key, [p.status, p.codes]]));
const accounts = (r: ImbResult) =>
  Object.fromEntries(r.accounts.map((a) => [a.account, [a.status, a.codes]]));
const OK = ['consistent', []];
/** Judged, with at least one position, and every position consistent. */
const allConsistent = (r: ImbResult) => {
  assert.equal(r.refused, null);
  assert.ok(r.positions.length > 0);
  for (const p of r.positions) assert.deepEqual([p.status, p.codes], OK, p.key);
};

const BOOK = () => [
  ...position('A', {
    moves: [
      ['receipt', '25', '2000.00'],
      ['issue', '18', '1440.00'],
    ],
  }),
  ...position('B', {
    item: 'OIL-5W30',
    unit: 'ltr',
    opening: ['120.5', '1446.00'],
    moves: [
      ['receipt', '60', '720.00'],
      ['issue', '35.25', '423.00'],
    ],
  }),
  ...position('C', {
    item: 'FLT-AIR',
    dims: 'site=WAK',
    unit: 'pcs',
    acct: '1402',
    opening: ['200', '3000.00'],
    moves: [
      ['issue', '30', '450.00'],
      ['adjustment-in', '2', '30.00'],
      ['adjustment-out', '0', '12.50'],
    ],
  }),
];

void test('each position bridges in quantity and value, and each account equals the GL component by component', () => {
  const r = run(BOOK());
  assert.equal(r.refused, null);
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': OK,
    'OIL-5W30|site=DOH': OK,
    'FLT-AIR|site=WAK': OK,
  });
  const oil = r.positions.find((p) => p.item === 'OIL-5W30')!;
  assert.deepEqual(oil.opening, { quantity: '120500', value: '144600' });
  assert.deepEqual(oil.closing, { quantity: '145250', value: '174300' });
  assert.deepEqual(oil.computed, oil.closing);
  assert.deepEqual(oil.flows!.issue, { quantity: '35250', value: '42300' });
  assert.deepEqual(oil.flows!['transfer-in'], { quantity: '0', value: '0' });
  assert.deepEqual(
    oil.lines!.map((l) => [l.id, l.kind, l.quantity, l.value]),
    [
      ['B-1', 'receipt', '60000', '72000'],
      ['B-2', 'issue', '35250', '42300'],
      ['B-C', 'closing', '145250', '174300'],
      ['B-O', 'opening', '120500', '144600'],
    ],
  );
  assert.equal(oil.unit, 'ltr');
  assert.deepEqual(accounts(r), { '1401': OK, '1402': OK });
  const a = r.accounts.find((x) => x.account === '1401')!;
  assert.deepEqual(a.register, {
    opening: '464600',
    debit: '272000',
    credit: '186300',
    closing: '550300',
  });
  assert.deepEqual(a.gl, a.register);
  assert.deepEqual(a.difference, {
    opening: '0',
    debit: '0',
    credit: '0',
    closing: '0',
  });
  assert.deepEqual(r.totals, {
    opening: '764600',
    receipt: '272000',
    issue: '231300',
    'adjustment-in': '3000',
    'adjustment-out': '1250',
    'return-in': '0',
    'return-out': '0',
    closing: '807050',
    transferred: '0',
  });
  assert.deepEqual(r.run, []);
});

void test('a bridge that does not close is inconsistent in quantity, in value or both', () => {
  for (const [closing, codes] of [
    [['47', '3760.00'], []],
    [['46', '3760.00'], ['QUANTITY_BRIDGE']],
    [['47', '3760.01'], ['VALUE_BRIDGE']],
    [
      ['48', '3759.00'],
      ['QUANTITY_BRIDGE', 'VALUE_BRIDGE'],
    ],
  ] as [[string, string], string[]][]) {
    const r = run(
      position('A', {
        moves: [
          ['receipt', '25', '2000.00'],
          ['issue', '18', '1440.00'],
        ],
        closing,
      }),
      {
        gl: glFor(
          position('A', {
            moves: [
              ['receipt', '25', '2000.00'],
              ['issue', '18', '1440.00'],
            ],
          }),
        ),
      },
    );
    assert.deepEqual(
      positions(r)['BRK-PAD|site=DOH'],
      [codes.length ? 'inconsistent' : 'consistent', codes],
      closing.join(),
    );
    assert.deepEqual(
      accounts(r)['1401'],
      codes.length ? ['held', ['POSITION']] : OK,
    );
    assert.notEqual(r.totals, null);
  }
});

void test('a proven transfer is a credit and a debit of two accounts and never an entity receipt; within one account it is neither', () => {
  const two = [
    ...position('A', {
      moves: [['transfer-out', '10', '800.00', { tid: 'T-1' }]],
    }),
    ...position('D', {
      dims: 'site=WAK',
      acct: '1402',
      opening: ['5', '400.00'],
      moves: [['transfer-in', '10', '800.00', { tid: 'T-1' }]],
    }),
  ];
  let r = run(two);
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': OK,
    'BRK-PAD|site=WAK': OK,
  });
  assert.deepEqual(accounts(r), { '1401': OK, '1402': OK });
  assert.equal(r.accounts[0].register!.credit, '80000');
  assert.equal(r.accounts[1].register!.debit, '80000');
  assert.equal(r.totals!.receipt, '0');
  assert.equal(r.totals!.issue, '0');
  assert.equal(r.totals!.transferred, '80000');
  const one = [
    ...position('A', {
      moves: [['transfer-out', '10', '800.00', { tid: 'T-1' }]],
    }),
    ...position('D', {
      dims: 'site=WAK',
      opening: ['5', '400.00'],
      moves: [['transfer-in', '10', '800.00', { tid: 'T-1' }]],
    }),
  ];
  r = run(one);
  assert.deepEqual(accounts(r), { '1401': OK });
  assert.deepEqual(r.accounts[0].register, {
    opening: '360000',
    debit: '0',
    credit: '0',
    closing: '360000',
  });
});

void test('a transfer is proven only by both sides in the period with the same item, unit, quantity and value', () => {
  const pair = (
    out: Opts & { q?: string; v?: string } = {},
    inn: Opts & { q?: string; v?: string } = {},
  ) => [
    ...position('A', {
      moves: [
        [
          'transfer-out',
          out.q ?? '10',
          out.v ?? '800.00',
          { tid: 'T-1', ...out },
        ],
      ],
    }),
    ...position('D', {
      dims: 'site=WAK',
      acct: '1402',
      item: inn.item,
      unit: inn.unit,
      moves: [
        [
          'transfer-in',
          inn.q ?? '10',
          inn.v ?? '800.00',
          { tid: 'T-1', ...inn },
        ],
      ],
    }),
  ];
  const keyOf = (inn: Opts) => `${inn.item ?? 'BRK-PAD'}|site=WAK`;
  for (const [out, inn] of [
    [{}, { item: 'BRK-SHOE' }],
    [{}, { unit: 'box' }],
    [{}, { q: '9' }],
    [{}, { v: '799.99' }],
    [{ q: '1,0' }, {}],
  ] as [Opts & { q?: string }, Opts & { q?: string; v?: string }][]) {
    const p = positions(run(pair(out, inn)));
    assert.ok(
      (p['BRK-PAD|site=DOH'][1] as string[]).includes('TRANSFER_MISMATCH'),
      JSON.stringify([out, inn]),
    );
    assert.ok(
      (p[keyOf(inn)][1] as string[]).includes('TRANSFER_MISMATCH'),
      JSON.stringify([out, inn]),
    );
  }
  let r = run(
    position('A', {
      moves: [['transfer-out', '10', '800.00', { tid: 'T-1' }]],
    }),
  );
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': ['held', ['TRANSFER_UNPAIRED']],
  });
  r = run(pair({}, { md: END, pd: '2027-03-01' }));
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': ['held', ['TRANSFER_UNPAIRED']],
    'BRK-PAD|site=WAK': OK,
  });
  assert.deepEqual(r.excluded, [{ row: 6, id: 'D-1' }]);
  r = run([
    ...pair(),
    ...position('E', {
      dims: 'site=RAY',
      moves: [['transfer-in', '10', '800.00', { tid: 'T-1' }]],
    }),
  ]);
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': ['held', ['TRANSFER_REPEATED']],
    'BRK-PAD|site=RAY': ['held', ['TRANSFER_REPEATED']],
    'BRK-PAD|site=WAK': ['held', ['TRANSFER_REPEATED']],
  });
  r = run(pair({}, { tid: 'T-2' }));
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': ['held', ['TRANSFER_UNPAIRED']],
    'BRK-PAD|site=WAK': ['held', ['TRANSFER_UNPAIRED']],
  });
});

void test('a return names a receipt or an issue of the same item and unit, and stays within it', () => {
  const ret = (
    kind: string,
    origin: string,
    q = '2',
    v = '160.00',
    o: Opts = {},
  ) =>
    position('A', {
      moves: [
        [origin, '5', '400.00', { id: 'R-1' }],
        [kind, q, v, { oid: 'R-1', ...o }],
      ],
    });
  assert.deepEqual(positions(run(ret('return-out', 'receipt'))), {
    'BRK-PAD|site=DOH': OK,
  });
  assert.deepEqual(positions(run(ret('return-in', 'issue'))), {
    'BRK-PAD|site=DOH': OK,
  });
  assert.deepEqual(
    positions(run(ret('return-out', 'receipt', '5', '400.00'))),
    { 'BRK-PAD|site=DOH': OK },
  );
  assert.deepEqual(positions(run(ret('return-out', 'issue'))), {
    'BRK-PAD|site=DOH': ['held', ['RETURN_ORIGIN']],
  });
  assert.deepEqual(positions(run(ret('return-in', 'receipt'))), {
    'BRK-PAD|site=DOH': ['held', ['RETURN_ORIGIN']],
  });
  assert.deepEqual(
    positions(run(ret('return-out', 'receipt', '6', '160.00'))),
    { 'BRK-PAD|site=DOH': ['held', ['RETURN_CAPACITY']] },
  );
  assert.deepEqual(
    positions(run(ret('return-out', 'receipt', '2', '400.01'))),
    { 'BRK-PAD|site=DOH': ['held', ['RETURN_CAPACITY']] },
  );
  // An origin of another item, of another unit, named twice, or not read whole.
  let rows = [
    ...position('A', {
      moves: [['return-out', '2', '160.00', { oid: 'R-1' }]],
    }),
    ...position('G', {
      item: 'BRK-SHOE',
      moves: [['receipt', '5', '400.00', { id: 'R-1' }]],
    }),
  ];
  assert.deepEqual(positions(run(rows))['BRK-PAD|site=DOH'], [
    'held',
    ['RETURN_ORIGIN'],
  ]);
  rows = [
    ...position('A', {
      moves: [['return-out', '2', '160.00', { oid: 'R-1' }]],
    }),
    ...position('G', {
      dims: 'site=WAK',
      unit: 'box',
      moves: [['receipt', '5', '400.00', { id: 'R-1' }]],
    }),
  ];
  assert.deepEqual(positions(run(rows))['BRK-PAD|site=DOH'], [
    'held',
    ['RETURN_ORIGIN'],
  ]);
  rows = [
    ...ret('return-out', 'receipt'),
    line('R-1', 'receipt', '1', '80.00', {
      item: 'Z',
      pd: '2027-01-30',
      md: '2027-01-30',
    }),
  ];
  assert.deepEqual(positions(run(rows))['BRK-PAD|site=DOH'], [
    'held',
    ['DUPLICATE_MOVEMENT', 'RETURN_ORIGIN'],
  ]);
  rows = [
    ...position('A', {
      moves: [['return-out', '2', '160.00', { oid: 'R-1' }]],
    }),
    ...position('G', {
      dims: 'site=WAK',
      moves: [['receipt', '5', '400.00', { id: 'R-1', tid: 'X' }]],
    }),
  ];
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['RETURN_ORIGIN']],
    'BRK-PAD|site=WAK': ['held', ['LINK']],
  });
  // The warehouse may differ; returns of the period on one origin add up.
  rows = [
    ...ret('return-out', 'receipt', '3', '240.00'),
    ...position('W', {
      dims: 'site=WAK',
      moves: [['return-out', '3', '240.00', { oid: 'R-1' }]],
    }),
  ];
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['RETURN_CAPACITY']],
    'BRK-PAD|site=WAK': ['held', ['RETURN_CAPACITY']],
  });
  rows = [
    ...ret('return-out', 'receipt', '2', '160.00'),
    ...position('W', {
      dims: 'site=WAK',
      moves: [['return-out', '3', '240.00', { oid: 'R-1' }]],
    }),
  ];
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': OK,
    'BRK-PAD|site=WAK': OK,
  });
  rows = ret('return-out', 'receipt', '3', '240.00');
  rows.splice(
    3,
    0,
    line('A-9', 'return-out', '3', '240.00', { oid: 'R-1', md: '2027-03-02' }),
  );
  assert.deepEqual(positions(run(rows)), { 'BRK-PAD|site=DOH': OK });
  rows = ret('return-out', 'receipt', '1', '80.00');
  rows.splice(3, 0, line('A-9', 'return-out', '', '80.00', { oid: 'R-1' }));
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['QUANTITY', 'RETURN_CAPACITY']],
  });
  // An origin not in the register is listed and holds nothing.
  const r = run(
    position('A', {
      moves: [['return-out', '2', '160.00', { oid: 'GRN-0119' }]],
    }),
  );
  assert.deepEqual(positions(r), { 'BRK-PAD|site=DOH': OK });
  assert.deepEqual(r.unseenOrigins, [
    { row: 3, id: 'A-1', origin: 'GRN-0119' },
  ]);
});

void test('the posting date places a movement: posted outside is excluded and listed, happened outside is in and listed', () => {
  let r = run(
    position('A', {
      moves: [
        ['receipt', '25', '2000.00', { md: '2027-02-27', pd: '2027-03-01' }],
        ['issue', '18', '1440.00'],
      ],
    }),
  );
  assert.deepEqual(positions(r), { 'BRK-PAD|site=DOH': OK });
  assert.deepEqual(r.excluded, [{ row: 3, id: 'A-1' }]);
  assert.deepEqual(r.positions[0].rows, [2, 4, 5]);
  r = run(
    position('A', {
      moves: [['receipt', '25', '2000.00', { md: '2027-01-30', pd: START }]],
    }),
  );
  assert.deepEqual(r.datedOutside, [{ row: 3, id: 'A-1' }]);
  assert.deepEqual(r.excluded, []);
  r = run(
    position('A', {
      moves: [['receipt', '25', '2000.00', { md: START, pd: END }]],
    }),
  );
  assert.deepEqual([r.excluded, r.datedOutside], [[], []]);
  // An item only on excluded lines is no position, and its account no account.
  r = run(
    [
      ...position('A'),
      line('Z-1', 'receipt', '5', '50.00', {
        item: 'ZZ',
        acct: '1499',
        pd: '2027-03-03',
      }),
    ],
    {
      gl: glFor(position('A')),
    },
  );
  assert.deepEqual(positions(r), { 'BRK-PAD|site=DOH': OK });
  assert.deepEqual(accounts(r), { '1401': OK });
  // A line that does not read whole is never excluded.
  r = run([
    ...position('A'),
    line('Z-1', 'receipt', '5', '5..0', { pd: '2027-03-03' }),
  ]);
  assert.deepEqual(positions(r), { 'BRK-PAD|site=DOH': ['held', ['VALUE']] });
  assert.deepEqual(r.excluded, []);
});

void test('units and accounts are compared as written; a missing balance is never zero; balances sit on the boundaries', () => {
  assert.deepEqual(
    positions(
      run(
        position('A', { moves: [['receipt', '5', '400.00', { unit: 'SET' }]] }),
      ),
    ),
    {
      'BRK-PAD|site=DOH': ['held', ['UNIT_CONFLICT']],
    },
  );
  let r = run(
    position('A', { moves: [['receipt', '5', '400.00', { acct: '1402' }]] }),
  );
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': ['held', ['ACCOUNT_CONFLICT']],
  });
  assert.deepEqual(accounts(r), {
    '1401': ['held', ['POSITION']],
    '1402': ['held', ['POSITION']],
  });
  r = run(
    position('A', {
      opening: null,
      closing: null,
      moves: [['receipt', '5', '400.00']],
    }),
  );
  assert.deepEqual(positions(r), {
    'BRK-PAD|site=DOH': ['missing', ['CLOSING_ABSENT', 'OPENING_ABSENT']],
  });
  assert.equal(r.positions[0].computed, null);
  assert.equal(r.totals, null);
  r = run(
    position('A', { closing: null, moves: [['receipt', '5', '400.00']] }),
  );
  assert.deepEqual(r.positions[0].computed, {
    quantity: '45000',
    value: '360000',
  });
  assert.deepEqual(r.positions[0].codes, ['CLOSING_ABSENT']);
  let rows = position('A');
  rows.push(line('A-C2', 'closing', '40', '3200.00'));
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['BALANCE_REPEATED']],
  });
  for (const [i, j, v] of [
    [0, 7, '2027-02-02'],
    [0, 8, '2027-01-31'],
    [1, 7, '2027-02-27'],
    [1, 8, '2027-03-01'],
  ] as [number, number, string][]) {
    rows = position('A');
    rows[i][j] = v;
    assert.deepEqual(
      positions(run(rows)),
      { 'BRK-PAD|site=DOH': ['held', ['BALANCE_DATE']] },
      `${i}:${j}`,
    );
  }
});

void test('negative balances follow the scope; a sign on a movement never reads', () => {
  for (const rows of [
    position('A', { moves: [['issue', '45', '400.00']] }),
    position('A', { moves: [['issue', '5', '3300.00']] }),
    position('A', {
      opening: ['-2', '-160.00'],
      moves: [['receipt', '5', '400.00']],
    }),
  ]) {
    assert.deepEqual(positions(run(rows)), {
      'BRK-PAD|site=DOH': ['held', ['NEGATIVE_BALANCE']],
    });
    const r = run(rows, { scope: { 'Negative balances': 'allowed' } });
    assert.deepEqual(positions(r), { 'BRK-PAD|site=DOH': OK });
    assert.deepEqual(accounts(r), { '1401': OK });
  }
  const zero = position('A', { opening: ['0', '0.00'] });
  zero[0][4] = '-0';
  zero[0][6] = '-0.00';
  assert.deepEqual(positions(run(zero)), { 'BRK-PAD|site=DOH': OK });
  const signed = position('A', {
    moves: [['receipt', '-5', '-400.00']],
    closing: ['35', '2800.00'],
  });
  assert.deepEqual(positions(run(signed)), {
    'BRK-PAD|site=DOH': ['held', ['QUANTITY', 'VALUE']],
  });
});

void test('a line whose item or dimensions cannot be read holds every position and every account', () => {
  for (const [j, v] of [
    [1, '=BRK-PAD'],
    [2, ''],
    [2, 'site\u00a0DOH'],
  ] as [number, string][]) {
    const rows = BOOK();
    rows[2][j] = v;
    const r = run(rows, { gl: glFor(BOOK()) });
    assert.ok(
      r.positions.every(
        (p) => p.status === 'held' && p.codes.includes('LINE_UNREADABLE'),
      ),
    );
    assert.deepEqual(accounts(r), {
      '1401': ['held', ['LINE_UNREADABLE', 'POSITION']],
      '1402': ['held', ['LINE_UNREADABLE', 'POSITION']],
    });
    assert.deepEqual(r.unplaced, [
      { file: 'register', row: 4, code: 'LINE_UNREADABLE' },
    ]);
    assert.deepEqual(r.run, ['LINE_UNREADABLE']);
    assert.equal(r.totals, null);
  }
});

void test('a GL file refused as a file holds every account but not the bridges; GL lines hold their own account', () => {
  for (const raw of [
    '"GL account,Opening\n',
    'GL account,Opening,Debit,Credit\n',
    '\n\n',
  ]) {
    const r = run(BOOK(), { gl: bytes(raw) });
    assert.deepEqual(
      accounts(r),
      { '1401': ['held', ['GL_FILE']], '1402': ['held', ['GL_FILE']] },
      raw,
    );
    allConsistent(r);
    assert.deepEqual(r.run, ['GL_FILE']);
    assert.notEqual(r.totals, null);
  }
  const r0 = run(BOOK(), { gl: new Uint8Array([0xff, 0xfe, 0x41]) });
  assert.deepEqual(r0.run, ['GL_FILE']);
  const gl = glFor(BOOK());
  for (const [j, v] of [
    [2, '-1.00'],
    [3, '-1.00'],
    [1, '4,646.00'],
    [4, ''],
    [2, '1.001'],
  ] as [number, string][]) {
    const changed = gl.map((r) => [...r]);
    changed[1][j] = v;
    assert.deepEqual(
      accounts(run(BOOK(), { gl: changed })),
      { '1401': ['held', ['GL_AMOUNT']], '1402': OK },
      v,
    );
  }
  let changed = gl.map((r) => [...r]);
  changed[2].push('', 'checked');
  assert.deepEqual(accounts(run(BOOK(), { gl: changed }))['1402'], [
    'held',
    ['GL_WIDTH'],
  ]);
  changed = gl.map((r) => [...r]);
  changed[2].push('', ' ');
  assert.deepEqual(accounts(run(BOOK(), { gl: changed }))['1402'], OK);
  changed = [...gl, [...gl[2]]];
  assert.deepEqual(accounts(run(BOOK(), { gl: changed }))['1402'], [
    'held',
    ['GL_DUPLICATE'],
  ]);
  changed = [...gl, ['#name?', '0.00', '0.00', '0.00', '0.00']];
  const r = run(BOOK(), { gl: changed });
  assert.deepEqual(accounts(r), {
    '1401': ['held', ['GL_UNREADABLE']],
    '1402': ['held', ['GL_UNREADABLE']],
  });
  assert.deepEqual(r.unplaced, [{ file: 'gl', row: 4, code: 'GL_UNREADABLE' }]);
  // Balances may carry a minus sign.
  const neg = run(position('A', { opening: ['0', '-1.00'], moves: [] }), {
    gl: [[...IMB_GL_COLUMNS], ['1401', '-1.00', '0.00', '0.00', '-1.00']],
    scope: { 'Negative balances': 'allowed' },
  });
  assert.deepEqual(accounts(neg), { '1401': OK });
});

void test('an account is compared only when every position naming it is consistent, and absences are named', () => {
  const book = BOOK();
  const gl = glFor(book);
  let r = run(book, { gl: gl.slice(0, 2) });
  assert.deepEqual(accounts(r)['1402'], ['missing', ['GL_ABSENT']]);
  assert.equal(r.accounts[1].gl, null);
  assert.equal(r.accounts[1].register!.credit, '46250');
  r = run(book, { gl: [...gl, ['1499', '10.00', '0.00', '0.00', '10.00']] });
  assert.deepEqual(accounts(r)['1499'], ['missing', ['REGISTER_ABSENT']]);
  assert.deepEqual(r.accounts[2].gl, {
    opening: '1000',
    debit: '0',
    credit: '0',
    closing: '1000',
  });
  assert.equal(r.accounts[2].register, null);
  const off = BOOK();
  off[off.length - 1][6] = '2567.51';
  r = run(off, { gl });
  assert.deepEqual(accounts(r), { '1401': OK, '1402': ['held', ['POSITION']] });
  assert.deepEqual(positions(r)['FLT-AIR|site=WAK'], [
    'inconsistent',
    ['VALUE_BRIDGE'],
  ]);
});

void test('equal totals across accounts never stand for equal accounts', () => {
  const book = BOOK();
  const gl = glFor(book);
  for (const [j, code] of [
    [1, 'OPENING_DIFF'],
    [2, 'DEBIT_DIFF'],
    [3, 'CREDIT_DIFF'],
    [4, 'CLOSING_DIFF'],
  ] as [number, string][]) {
    const changed = gl.map((r) => [...r]);
    changed[1][j] = text(units(changed[1][j], 2) - 1n, 2);
    changed[2][j] = text(units(changed[2][j], 2) + 1n, 2);
    const r = run(book, { gl: changed });
    assert.deepEqual(
      accounts(r),
      { '1401': ['difference', [code]], '1402': ['difference', [code]] },
      code,
    );
    const key = code.slice(0, -5).toLowerCase() as 'opening';
    assert.equal(r.accounts[0].difference![key], '1');
    assert.equal(r.accounts[1].difference![key], '-1');
  }
});

void test('repeated headers are listed and skipped in both files; the header reads in any order, padded and spaced', () => {
  const rows = BOOK();
  const gl = glFor(rows);
  let r = run([...rows.slice(0, 3), [...IMB_COLUMNS], ...rows.slice(3)], {
    gl: [gl[0], gl[1], [...IMB_GL_COLUMNS], gl[2]],
  });
  allConsistent(r);
  assert.deepEqual(r.repeatedHeaders, [
    { file: 'gl', row: 3 },
    { file: 'register', row: 5 },
  ]);
  const moved = [...IMB_COLUMNS.slice(1), IMB_COLUMNS[0]];
  r = run([...rows.slice(0, 3), moved, ...rows.slice(3)]);
  assert.deepEqual(r.repeatedHeaders, []);
  assert.ok(positions(r)['Item dimensions|Kind'][0] === 'held');
  const order = [...IMB_COLUMNS].reverse();
  const reordered = rows.map((x) => [
    ...order.map((c) => x[IMB_COLUMNS.indexOf(c)]),
    '',
    '',
  ]);
  r = run(reordered, { header: [...order.map((c) => ` ${c} `), '', ''], gl });
  allConsistent(r);
});

void test('the scope, the encoding, the CSV quoting and the header refuse the run', () => {
  for (const change of [
    { Currency: 'XAU' },
    { 'Period start': '2027-03-01' },
    { 'Period end': '2027-02-29' },
    { 'Negative balances': 'Allowed' },
    { Entity: '=Co' },
    { Entity: ' Synthetic Spare Parts WLL' },
  ])
    assert.equal(
      run(BOOK(), { scope: change }).refused,
      'SCOPE',
      JSON.stringify(change),
    );
  const extra = { ...SCOPE, Ledger: 'X' };
  const reg = bytes(csv([[...IMB_COLUMNS], ...BOOK()]));
  assert.equal(
    reconcileMovementBridge(input(reg, reg, extra)).refused,
    'SCOPE',
  );
  assert.equal(
    run([], { raw: new Uint8Array([0x4d, 0xe9, 0x0a]) }).refused,
    'ENCODING',
  );
  assert.equal(run([], { raw: bytes('Movement ID,"Item\n') }).refused, 'CSV');
  assert.equal(run([], { raw: bytes('a,b"c\n') }).refused, 'CSV');
  assert.equal(run([], { raw: bytes('"a"b\n') }).refused, 'CSV');
  assert.equal(run([], { raw: bytes(',,\n\n') }).refused, 'HEADER');
  assert.equal(
    run(BOOK(), { header: [...IMB_COLUMNS, 'Note'] }).refused,
    'HEADER',
  );
  assert.equal(
    run(BOOK(), { header: [...IMB_COLUMNS.slice(0, -1), 'Movement ID'] })
      .refused,
    'HEADER',
  );
  assert.equal(
    run(BOOK(), { header: IMB_COLUMNS.map((c) => c.toLowerCase()) }).refused,
    'HEADER',
  );
  const refused = run(BOOK(), { scope: { Currency: 'XAU' } });
  assert.deepEqual(
    [refused.positions, refused.accounts, refused.decimals],
    [[], [], null],
  );
});

void test('numbers read Latin, Arabic-Indic and Persian digits within the currency decimals and the bound', () => {
  assert.equal(imbNumber('12', 3, false), 12000n);
  assert.equal(imbNumber('12.125', 3, false), 12125n);
  assert.equal(imbNumber('12.1255', 3, false), null);
  assert.equal(imbNumber('\u0661\u0662\u066b\u0665', 2, false), 1250n);
  assert.equal(imbNumber('\u06f1\u06f2', 0, false), 12n);
  assert.equal(imbNumber('-5', 2, false), null);
  assert.equal(imbNumber('-5', 2, true), -500n);
  assert.equal(imbNumber('-0', 2, true), 0n);
  for (const bad of [
    '',
    ' ',
    '1,000',
    '+5',
    '5-',
    '1e3',
    '.5',
    '5.',
    '--5',
    '(5)',
  ])
    assert.equal(imbNumber(bad, 2, true), null, bad);
  assert.equal(imbNumber('1000000000000', 2, false), 10n ** 14n);
  assert.equal(imbNumber('1000000000000.01', 2, false), null);
  assert.equal(imbNumber('-1000000000000.01', 2, true), null);
  const rows = position('A', {
    moves: [
      ['receipt', '\u0662\u0665', '\u0662\u0660\u0660\u0660\u066b\u0660\u0660'],
    ],
    closing: ['65', '5200.00'],
  });
  assert.deepEqual(
    positions(
      run(rows, {
        gl: glFor(position('A', { moves: [['receipt', '25', '2000.00']] })),
      }),
    ),
    {
      'BRK-PAD|site=DOH': OK,
    },
  );
  for (const [currency, value, ok] of [
    ['KWD', '1.125', true],
    ['KWD', '1.1255', false],
    ['JPY', '7', true],
    ['JPY', '7.0', false],
  ] as [string, string, boolean][]) {
    const r = run(
      position('A', {
        opening: ['1', value],
        moves: [],
        closing: ['1', value],
      }),
      {
        scope: { Currency: currency },
        gl: [[...IMB_GL_COLUMNS], ['1401', value, '0', '0', value]],
      },
    );
    assert.equal(
      r.positions[0].status === 'consistent',
      ok,
      `${currency} ${value}`,
    );
  }
});

void test('identities follow the text rules; kinds, links, dates and width are exact', () => {
  assert.equal(imbText('  MV-1  '), 'MV-1');
  assert.equal(imbText('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(imbText('x'.repeat(501)), null);
  for (const bad of [
    '',
    '=A',
    '+A',
    '@A',
    '-A',
    '#ref!',
    '#N/A x',
    'A\u200bB',
    'A\u00a0B',
    'A\tB',
    '\u2028',
  ])
    assert.equal(imbText(bad), null, JSON.stringify(bad));
  assert.equal(imbText('0420'), '0420');
  const one = (j: number, v: string) => {
    const rows = position('A', {
      moves: [
        ['receipt', '5', '400.00'],
        ['issue', '2', '160.00'],
      ],
    });
    rows[1][j] = v;
    return positions(
      run(rows, {
        gl: glFor(
          position('A', {
            moves: [
              ['receipt', '5', '400.00'],
              ['issue', '2', '160.00'],
            ],
          }),
        ),
      }),
    )['BRK-PAD|site=DOH'];
  };
  for (const [j, v, code] of [
    [0, '', 'IDENTITY'],
    [0, '-7', 'IDENTITY'],
    [5, '\tset', 'IDENTITY'],
    [9, '#VALUE!', 'IDENTITY'],
    [3, 'Receipt', 'KIND'],
    [3, 'receipts', 'KIND'],
    [4, '1,000', 'QUANTITY'],
    [4, '', 'QUANTITY'],
    [6, '400.001', 'VALUE'],
    [7, '2027-02-30', 'DATE'],
    [8, '14/02/2027', 'DATE'],
    [10, 'T-1', 'LINK'],
    [11, 'R-1', 'LINK'],
  ] as [number, string, string][])
    assert.deepEqual(one(j, v), ['held', [code]], `${j}:${v}`);
  assert.deepEqual(one(3, ' receipt '), OK);
  let rows = position('A', { moves: [['receipt', '5', '400.00']] });
  rows[1].push('', 'urgent');
  assert.deepEqual(positions(run(rows))['BRK-PAD|site=DOH'], [
    'held',
    ['LINE_WIDTH'],
  ]);
  rows = position('A', { moves: [['receipt', '5', '400.00']] });
  rows[1].push('', '  ');
  assert.deepEqual(positions(run(rows))['BRK-PAD|site=DOH'], OK);
  for (const [kind, o] of [
    ['transfer-out', { tid: '' }],
    ['transfer-out', { tid: 'T-1', oid: 'R-1' }],
    ['return-out', { oid: 'R-1', tid: 'T-1' }],
    ['return-in', { oid: '=R' }],
    ['opening', { tid: 'T-1' }],
  ] as [string, Opts][]) {
    rows = position('A', { moves: [[kind, '1', '80.00', o]] });
    assert.ok(
      (positions(run(rows))['BRK-PAD|site=DOH'][1] as string[]).includes(
        'LINK',
      ),
      kind,
    );
  }
  rows = position('A', { moves: [['receipt', '5', '400.00']] });
  rows[1][3] = 'return';
  rows[1][11] = 'R-1';
  assert.deepEqual(positions(run(rows))['BRK-PAD|site=DOH'], [
    'held',
    ['KIND', 'LINK'],
  ]);
});

void test('one Movement ID on two lines holds both positions, an excluded line included', () => {
  let rows = [
    ...position('A', { moves: [['receipt', '5', '400.00', { id: 'M-1' }]] }),
    ...position('G', {
      item: 'BRK-SHOE',
      moves: [['issue', '5', '400.00', { id: 'M-1' }]],
    }),
  ];
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['DUPLICATE_MOVEMENT']],
    'BRK-SHOE|site=DOH': ['held', ['DUPLICATE_MOVEMENT']],
  });
  rows = [
    ...position('A', { moves: [['receipt', '5', '400.00', { id: 'M-1' }]] }),
    line('M-1', 'receipt', '1', '8.00', { item: 'Q', pd: '2027-03-09' }),
  ];
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['DUPLICATE_MOVEMENT']],
  });
});

void test('the input contract is checked before anything is read', () => {
  const ok = input(
    bytes(csv([[...IMB_COLUMNS], ...BOOK()])),
    bytes(csv(glFor(BOOK()))),
  );
  const bad = (mutate: (i: ImbInput) => unknown, code: string) => {
    const i = structuredClone(ok) as unknown as Record<string, unknown>;
    mutate(i as unknown as ImbInput);
    assert.throws(
      () => reconcileMovementBridge(i as unknown as ImbInput),
      new RegExp(`^Error: IMB_${code}$`),
      code,
    );
  };
  bad((i) => (i.files as unknown[]).pop(), 'INPUT');
  bad((i) => ((i as unknown as Record<string, unknown>).extra = 1), 'INPUT');
  bad((i) => (i.readings[0].confirmed = false), 'READING');
  bad((i) => (i.readings[1].role = 'movement-register'), 'READING');
  bad(
    (i) =>
      ((i.readings[0] as unknown as Record<string, unknown>).family =
        'inventory-posted-register-gl-1'),
    'READING',
  );
  bad((i) => (i.files[1].name = 'gl.xlsx'), 'SOURCE');
  bad((i) => (i.files[0].sha256 = 'x'), 'SOURCE');
  bad((i) => (i.files[0].bytes = new Uint8Array()), 'SOURCE');
  bad((i) => (i.scope.confirmed = false), 'SCOPE');
  const wide = bytes(
    csv([[...IMB_COLUMNS], Array.from({ length: 101 }, () => 'x')]),
  );
  assert.throws(
    () => reconcileMovementBridge(input(wide, ok.files[1].bytes)),
    /IMB_SOURCE_CAPACITY/,
  );
});

void test('the replay hashes its own copies and refuses a hash it was not given', async () => {
  const register = bytes(csv([[...IMB_COLUMNS], ...BOOK()])),
    gl = bytes(csv(glFor(BOOK())));
  const request = {
    files: [
      {
        name: 'register.csv',
        original: register.slice().buffer,
        sha256: sha(register),
      },
      { name: 'gl.csv', original: gl.slice().buffer },
    ] as [
      { name: string; original: ArrayBuffer; sha256?: string },
      { name: string; original: ArrayBuffer },
    ],
    readings: input(register, gl).readings,
    scope: { confirmed: true, fields: { ...SCOPE } },
  };
  const pending = replayMovementBridge(request);
  new Uint8Array(request.files[0].original).fill(0x41);
  request.scope.fields.Currency = 'XAU';
  const { state, result } = await pending;
  assert.equal(result.refused, null);
  assert.equal(state.files[0].sha256, sha(register));
  assert.equal(state.files[1].sha256, sha(gl));
  assert.deepEqual(new Uint8Array(state.files[1].original), gl);
  assert.equal(state.scope.fields.Currency, 'QAR');
  await assert.rejects(
    replayMovementBridge({
      ...request,
      files: [
        {
          name: 'register.csv',
          original: register.slice().buffer,
          sha256: '0'.repeat(64),
        },
        request.files[1],
      ],
    }),
    /IMB_SOURCE_HASH/,
  );
  await assert.rejects(
    replayMovementBridge({ ...request, files: [request.files[0]] as never }),
    /IMB_INPUT/,
  );
});

void test('line order, GL order and the writer form change nothing but row numbers', () => {
  const book = BOOK();
  const gl = glFor(book);
  const base = run(book, { gl });
  const strip = (r: ImbResult) => ({
    positions: r.positions.map((p) => ({
      ...p,
      rows: [],
      lines: p.lines && p.lines.map((l) => ({ ...l, row: 0 })),
    })),
    accounts: r.accounts.map((a) => ({ ...a, rows: [] })),
    totals: r.totals,
    run: r.run,
  });
  const shuffled = [
    book[5],
    book[0],
    book[9],
    book[2],
    book[7],
    book[1],
    book[4],
    book[8],
    book[3],
    book[6],
    book[10],
    book[11],
    book[12],
  ];
  assert.equal(shuffled.length, book.length);
  const turned = run(shuffled, { gl: [gl[0], ...gl.slice(1).reverse()] });
  assert.deepEqual(strip(turned), strip(base));
  const quoted = (rows: Row[]) =>
    bytes(
      '\ufeff' +
        rows
          .map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(','))
          .join('\r\n') +
        '\r\n',
    );
  const form = reconcileMovementBridge(
    input(quoted([[...IMB_COLUMNS], ...book]), quoted(gl)),
  );
  assert.deepEqual(strip(form), strip(base));
  const cr = reconcileMovementBridge(
    input(bytes(csv([[...IMB_COLUMNS], ...book], '\r')), bytes(csv(gl, '\r'))),
  );
  assert.deepEqual(strip(cr), strip(base));
});

void test('positions are ordered by item then dimensions, and records keep blank lines', () => {
  const r = run([
    ...position('Z', { item: 'A-B', dims: 'w' }),
    ...position('Y', { item: 'A', dims: 'w' }),
  ]);
  assert.deepEqual(
    r.positions.map((p) => p.key),
    ['A|w', 'A-B|w'],
  );
  assert.deepEqual(imbRecords(bytes('a,b\r\n\r\nc,\n')), [
    ['a', 'b'],
    [''],
    ['c', ''],
  ]);
  assert.equal(imbRecords(bytes('"a\nb",c\n')) instanceof Array, true);
});

void test('contract details the first round of mutations found without a test', () => {
  // A doubled quote inside a quoted field is one quote.
  assert.deepEqual(imbRecords(bytes('"a ""b"" c",d\n')), [['a "b" c', 'd']]);
  // A header with a column twice is not the twelve, even when all twelve are there.
  assert.equal(
    run(BOOK(), { header: [...IMB_COLUMNS, 'Movement ID'] }).refused,
    'HEADER',
  );
  // The header reads in any order.
  const order = [...IMB_COLUMNS].reverse();
  const r = run(
    BOOK().map((x) => order.map((c) => x[IMB_COLUMNS.indexOf(c)])),
    { header: order, gl: glFor(BOOK()) },
  );
  assert.equal(r.refused, null);
  assert.deepEqual(Object.values(positions(r)), [OK, OK, OK]);
  // Two openings hold as two closings do.
  const rows = position('A');
  rows.splice(1, 0, line('A-O2', 'opening', '40', '3200.00'));
  assert.deepEqual(positions(run(rows)), {
    'BRK-PAD|site=DOH': ['held', ['BALANCE_REPEATED']],
  });
  // Two transfer sides whose quantity reads on neither are not equal.
  const pair = [
    ...position('A', {
      moves: [['transfer-out', '1,0', '800.00', { tid: 'T-1' }]],
      closing: ['30', '2400.00'],
    }),
    ...position('D', {
      dims: 'site=WAK',
      moves: [['transfer-in', '10,', '800.00', { tid: 'T-1' }]],
      closing: ['50', '4000.00'],
    }),
  ];
  for (const p of Object.values(positions(run(pair))))
    assert.ok((p[1] as string[]).includes('TRANSFER_MISMATCH'));
  // A position with a closing and no opening is missing, not inconsistent.
  const late = run(
    position('A', { opening: null, moves: [['receipt', '5', '400.00']] }),
  );
  assert.deepEqual(positions(late), {
    'BRK-PAD|site=DOH': ['missing', ['OPENING_ABSENT']],
  });
  // A register of one unreadable line has no position and no totals, and the
  // unplaced rows of both files are in file order, GL first.
  const lone = run([line('Z-1', 'receipt', '5', '400.00', { item: '@Z' })], {
    gl: [[...IMB_GL_COLUMNS], ['#N/A', '0.00', '0.00', '0.00', '0.00']],
  });
  assert.deepEqual(lone.positions, []);
  assert.equal(lone.totals, null);
  assert.deepEqual(lone.unplaced, [
    { file: 'gl', row: 2, code: 'GL_UNREADABLE' },
    { file: 'register', row: 2, code: 'LINE_UNREADABLE' },
  ]);
});
