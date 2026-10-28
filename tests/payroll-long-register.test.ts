import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PLR_ROLE,
  PLR_VERSION,
  reconcileLongRegister,
  type PlrInput,
  type PlrLabel,
  type PlrResult,
} from '../lib/reconciliation/payroll-long-register.ts';
import { replayLongRegister } from '../lib/reconciliation/payroll-long-register-io.ts';

// A synthetic logistics company paid in QAR; none of its names, lines or
// amounts come from the sealed PAY-1 stories.
const SCOPE: Record<PlrLabel, string> = {
  Entity: 'Synthetic Freight WLL',
  'Payroll run': 'RUN-2027-03',
  Currency: 'QAR',
  'Period start': '2027-03-01',
  'Period end': '2027-03-31',
  'Payroll posting date': '2027-03-30',
  'Payment date': '2027-04-01',
};
const COLUMNS = [
  'Line ID',
  'Employee ID',
  'Employee dimensions',
  'Payee account',
  'Component',
  'Kind',
  'Amount',
];
const TOTALS = [
  'Total earnings',
  'Total deductions',
  'Total employer',
  'Total net',
];
const KINDS = ['earning', 'deduction', 'employer', 'net'];

type Row = string[];
const line = (
  id: string,
  employee: string,
  kind: string,
  amount: string,
  component = kind === 'net' ? 'Net pay' : 'Basic',
  dims = 'depot=DOH',
  payee = `PAY-${employee}`,
): Row => [id, employee, dims, payee, component, kind, amount];
/** Earning, deduction, employer and net lines of one driver. */
const driver = (
  p: string,
  employee: string,
  earn = '4000.00',
  ded = '300.00',
  er = '450.00',
  net = '3700.00',
  dims = 'depot=DOH',
  payee = `PAY-${employee}`,
): Row[] => [
  line(`${p}-1`, employee, 'earning', earn, 'Basic', dims, payee),
  line(`${p}-2`, employee, 'deduction', ded, 'Pension (employee)', dims, payee),
  line(`${p}-3`, employee, 'employer', er, 'Pension (employer)', dims, payee),
  line(`${p}-4`, employee, 'net', net, 'Net pay', dims, payee),
];
const cents = (v: string) => {
  const [a, b = ''] = v.trim().split('.');
  return BigInt(a) * 100n + BigInt(b.padEnd(2, '0') || '0');
};
const money = (n: bigint) => `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
function footing(lines: Row[], over: Record<string, string> = {}): Row[] {
  return TOTALS.map((label, i) => [
    label,
    over[label] ??
      money(
        lines
          .filter((r) => r[5] === KINDS[i])
          .reduce((a, r) => a + cents(r[6]), 0n),
      ),
  ]);
}
type SectionOptions = {
  labels?: Partial<Record<PlrLabel, string>>;
  drop?: PlrLabel[];
  extra?: Row[];
  columns?: Row;
  totals?: Row[];
  end?: string | false;
};
function section(id: string, lines: Row[], o: SectionOptions = {}): Row[] {
  const values = { ...SCOPE, ...o.labels };
  return [
    ['Section', id],
    ...(Object.keys(SCOPE) as PlrLabel[])
      .filter((k) => !o.drop?.includes(k))
      .map((k) => [k, values[k]]),
    ...(o.extra ?? []),
    o.columns ?? COLUMNS,
    ...lines,
    ...(o.totals ?? footing(lines)),
    ...(o.end === false ? [] : [['End section', o.end ?? id]]),
    [],
  ];
}
const runTotals = (
  lines: Row[],
  over: Record<string, string> = {},
  run = SCOPE['Payroll run'],
) => [['Run totals', run], ...footing(lines, over), ['End run totals', run]];
const csv = (rows: Row[], end = '\n') =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join(end) + end;
function input(
  text: string | Uint8Array,
  fields: Record<string, string> = SCOPE,
): PlrInput {
  const bytes =
    typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return {
    files: [
      {
        name: 'register.csv',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes,
      },
    ],
    readings: [{ role: PLR_ROLE, family: PLR_VERSION, confirmed: true }],
    scope: { confirmed: true, fields: fields as Record<PlrLabel, string> },
  };
}
const judge = (rows: Row[], fields?: Record<string, string>) =>
  reconcileLongRegister(input(csv(rows), fields));
/** Sections given as [id, lines, options], then run totals of every line. */
function register(...parts: [string, Row[], SectionOptions?][]): Row[] {
  return [
    ...parts.flatMap(([id, lines, o]) => section(id, lines, o)),
    ...runTotals(parts.flatMap(([, lines]) => lines)),
  ];
}
const verdicts = (r: PlrResult) =>
  Object.fromEntries(r.employees.map((e) => [e.key, [e.status, e.codes]]));
const OK = ['consistent', []];

void test('a run over two pages gives each employee every component, line by line', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102', '5200.50', '410.00', '600.00', '4790.50');
  const extra = line('A-0', 'D-101', 'earning', '350.25', 'Overtime');
  a[3][6] = '4050.25';
  const r = judge(
    register(['P1', a.slice(0, 2)], ['P2', [...a.slice(2), extra, ...b]]),
  );
  assert.equal(r.refused, null);
  assert.deepEqual(r.run, []);
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': OK,
    'D-102|depot=DOH': OK,
  });
  const d = r.employees[0];
  assert.deepEqual(
    [d.earnings, d.deductions, d.employer, d.net, d.payee],
    ['435025', '30000', '45000', '405025', 'PAY-D-101'],
  );
  assert.deepEqual(
    d.lines!.map((l) => [l.id, l.component, l.kind, l.amount]),
    [
      ['A-0', 'Overtime', 'earning', '35025'],
      ['A-1', 'Basic', 'earning', '400000'],
      ['A-2', 'Pension (employee)', 'deduction', '30000'],
      ['A-3', 'Pension (employer)', 'employer', '45000'],
      ['A-4', 'Net pay', 'net', '405025'],
    ],
  );
  assert.deepEqual(r.totals, {
    earnings: '955075',
    deductions: '71000',
    employer: '105000',
    net: '884075',
  });
  assert.deepEqual(
    r.sections.map((s) => [s.id, s.state, s.codes]),
    [
      ['P1', 'read', []],
      ['P2', 'read', []],
    ],
  );
});

void test('the employer contribution never enters net', () => {
  const r = judge(
    register([
      'P1',
      driver('A', 'D-101', '4000.00', '300.00', '450.00', '3250.00'),
    ]),
  );
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': ['inconsistent', ['NET_EQUATION']],
  });
  assert.equal(r.employees[0].employer, '45000');
});

void test('one employee in two depots is two employees, each needing its own net', () => {
  const both = [
    ...driver('A', 'D-101'),
    ...driver('B', 'D-101', '1000.00', '0.00', '0.00', '1000.00', 'depot=WKR'),
  ];
  assert.deepEqual(verdicts(judge(register(['P1', both]))), {
    'D-101|depot=DOH': OK,
    'D-101|depot=WKR': OK,
  });
  const one = [
    ...driver('A', 'D-101', '4000.00', '300.00', '450.00', '4700.00'),
    ...driver(
      'B',
      'D-101',
      '1000.00',
      '0.00',
      '0.00',
      '1000.00',
      'depot=WKR',
    ).slice(0, 3),
  ];
  const r = judge(register(['P1', one]));
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': ['inconsistent', ['NET_EQUATION']],
    'D-101|depot=WKR': ['missing', ['NET_ABSENT']],
  });
  assert.equal(r.employees[1].net, null);
  assert.deepEqual(r.sharedPayees, []);
});

void test('a line ID twice holds even when the lines agree; two IDs with equal content are two lines', () => {
  const a = driver('A', 'D-101');
  const r = judge(register(['P1', a], ['P2', [a[0], ...driver('B', 'D-102')]]));
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': ['held', ['DUPLICATE_LINE']],
    'D-102|depot=DOH': OK,
  });
  assert.equal(r.employees[0].lines, null);
  const loans = [
    ...driver('A', 'D-101', '4000.00', '300.00', '450.00', '3500.00'),
    line('A-5', 'D-101', 'deduction', '100.00', 'Loan'),
    line('A-6', 'D-101', 'deduction', '100.00', 'Loan'),
  ];
  const twice = judge(register(['P1', loans]));
  assert.deepEqual(verdicts(twice), { 'D-101|depot=DOH': OK });
  assert.equal(twice.employees[0].deductions, '50000');
});

void test('a shared payee account is listed, two payees for one employee hold it', () => {
  const r = judge(
    register([
      'P1',
      [
        ...driver(
          'A',
          'D-101',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'IBAN-X',
        ),
        ...driver(
          'B',
          'D-102',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'IBAN-X',
        ),
      ],
    ]),
  );
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': OK,
    'D-102|depot=DOH': OK,
  });
  assert.deepEqual(r.sharedPayees, [
    { payee: 'IBAN-X', employees: ['D-101', 'D-102'] },
  ]);
  const a = driver('A', 'D-101');
  a[3][3] = 'PAY-OTHER';
  assert.deepEqual(verdicts(judge(register(['P1', a]))), {
    'D-101|depot=DOH': ['held', ['PAYEE_CONFLICT']],
  });
});

void test('a blank amount is not zero and leaves no total checkable; a written zero is a line', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102');
  const printed = [...a, ...b];
  const blank = b.map((r) => [...r]);
  blank[1][6] = '';
  const r = judge([
    ...section('P1', a),
    ...section('P2', blank, { totals: footing(b) }),
    ...runTotals(printed),
  ]);
  assert.deepEqual(r.run, ['RUN_TOTALS']);
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': ['held', ['RUN_TOTALS']],
    'D-102|depot=DOH': ['held', ['AMOUNT', 'RUN_TOTALS', 'TOTAL_FIELD']],
  });
  assert.equal(r.totals, null);
  const zero = [
    ...driver('A', 'D-101'),
    line('A-5', 'D-101', 'earning', '0.00', 'Overtime'),
  ];
  const z = judge(register(['P1', zero]));
  assert.deepEqual(verdicts(z), { 'D-101|depot=DOH': OK });
  assert.equal(z.employees[0].lines!.length, 5);
});

void test('a page that never arrived holds every employee through the run totals', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102');
  const r = judge([...section('P1', a), ...runTotals([...a, ...b])]);
  assert.deepEqual(r.run, ['RUN_TOTAL_MISMATCH']);
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': ['held', ['RUN_TOTAL_MISMATCH']],
  });
  assert.deepEqual(r.printedRunTotals?.net, '740000');
  assert.deepEqual(r.totals?.net, '370000');
});

void test("a page total that disagrees holds only that page's employees", () => {
  const a = driver('A', 'D-101'),
    b = [...driver('B', 'D-102'), ...driver('C', 'D-103')];
  const r = judge([
    ...section('P1', a),
    ...section('P2', b, { totals: footing(b, { 'Total employer': '900.01' }) }),
    ...runTotals([...a, ...b]),
  ]);
  assert.deepEqual(r.run, []);
  assert.deepEqual(verdicts(r), {
    'D-101|depot=DOH': OK,
    'D-102|depot=DOH': ['held', ['TOTAL_MISMATCH']],
    'D-103|depot=DOH': ['held', ['TOTAL_MISMATCH']],
  });
  assert.deepEqual(r.sections[1].codes, ['TOTAL_MISMATCH']);
});

void test('a page of another run is excluded, listed and counted nowhere', () => {
  const a = driver('A', 'D-101');
  const bonus = [
    line('X-1', 'D-101', 'earning', '999.00', 'Bonus'),
    line('X-1', 'D-101', 'net', '999.00'),
  ];
  const r = judge([
    ...section('P1', a),
    ...section('PX', bonus, { labels: { 'Payroll run': 'RUN-2027-03-B' } }),
    ...runTotals(a),
  ]);
  assert.deepEqual(r.excludedSections, ['PX']);
  assert.deepEqual(verdicts(r), { 'D-101|depot=DOH': OK });
  assert.deepEqual(r.sections[1].state, 'excluded');
  const open = judge([
    ...section('P1', a),
    ...section('PX', bonus, {
      labels: { 'Payroll run': 'RUN-2027-03-B' },
      end: false,
    }),
    ...runTotals(a),
  ]);
  assert.deepEqual(open.excludedSections, []);
  assert.deepEqual(open.run, ['SECTION_UNCLOSED']);
  assert.deepEqual(verdicts(open), {
    'D-101|depot=DOH': ['held', ['SECTION_UNCLOSED']],
  });
  const later = judge([
    ...section('P1', a),
    ...section('PY', bonus, { labels: { 'Payment date': '2027-04-02' } }),
    ...runTotals(a),
  ]);
  assert.deepEqual(later.excludedSections, ['PY']);
  const same = judge([
    ...section('P1', a),
    ...section('P1', bonus, { labels: { 'Period end': '2027-03-30' } }),
    ...runTotals(a),
  ]);
  assert.deepEqual(same.excludedSections, ['P1']);
  assert.deepEqual(same.run, []);
});

void test('a broken structure anywhere holds everyone and lists what could not be placed', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102');
  const cases: [string, Row[], string[], [number, string][]][] = [
    [
      'a stray row',
      [
        ...section('P1', a),
        ['Page 1 of 2'],
        ...section('P2', b),
        ...runTotals([...a, ...b]),
      ],
      ['STRAY_ROW'],
      [[20, 'STRAY_ROW']],
    ],
    [
      'a header without its payment date',
      [
        ...section('P1', a),
        ...section('P2', b, { drop: ['Payment date'] }),
        ...runTotals(a),
      ],
      ['SECTION_HEADER'],
      [[20, 'SECTION_HEADER']],
    ],
    [
      'a notes column',
      [
        ...section('P1', a),
        ...section('P2', b, { columns: [...COLUMNS, 'Notes'] }),
        ...runTotals(a),
      ],
      ['SECTION_COLUMNS'],
      [[20, 'SECTION_COLUMNS']],
    ],
    [
      'a section never closed',
      [
        ...section('P1', a, { end: false }),
        ...section('P2', b),
        ...runTotals([...a, ...b]),
      ],
      ['SECTION_UNCLOSED'],
      [],
    ],
    [
      'one section ID twice',
      [...section('P1', a), ...section('P1', b), ...runTotals([...a, ...b])],
      ['SECTION_DUPLICATE'],
      [],
    ],
  ];
  for (const [name, rows, run, unplaced] of cases) {
    const r = judge(rows);
    assert.deepEqual(r.run, run, name);
    assert.deepEqual(
      r.unplaced.map((u) => [u.row, u.code]),
      unplaced,
      name,
    );
    for (const e of r.employees) assert.equal(e.status, 'held', name);
  }
  const blank = b.map((r) => [...r]);
  blank[2][2] = '';
  const r = judge(register(['P1', [...a, ...blank]]));
  assert.deepEqual(r.run, ['LINE_UNREADABLE']);
  assert.deepEqual(r.unplaced, [{ row: 16, code: 'LINE_UNREADABLE' }]);
  assert.equal(r.totals?.employer, '90000');
});

void test('run totals must be there once, closed, of this run and readable', () => {
  const a = driver('A', 'D-101');
  const base = section('P1', a);
  for (const [name, footer] of [
    ['absent', []],
    ['twice', [...runTotals(a), ...runTotals(a)]],
    ['of another run', runTotals(a, {}, 'RUN-2027-02')],
    ['unclosed', runTotals(a).slice(0, 5)],
    ['a blank total', runTotals(a, { 'Total net': '' })],
    [
      'a note inside',
      [...runTotals(a).slice(0, 5), ['Checked', 'yes'], runTotals(a)[5]],
    ],
  ] as [string, Row[]][]) {
    const r = judge([...base, ...footer]);
    assert.deepEqual(r.run, ['RUN_TOTALS'], name);
  }
  assert.deepEqual(judge([...runTotals(a), ...base]).run, []);
});

void test('the scope, the encoding and the CSV quoting refuse the run', () => {
  const rows = register(['P1', driver('A', 'D-101')]);
  for (const change of [
    { Currency: 'XXX' },
    { 'Period end': '2027-02-28' },
    { 'Payment date': '2027-03-29' },
    { 'Payroll posting date': '2027-02-30' },
    { Entity: ' Synthetic Freight WLL' },
  ])
    assert.equal(judge(rows, { ...SCOPE, ...change }).refused, 'SCOPE');
  const { Entity: _, ...short } = SCOPE;
  assert.equal(judge(rows, short).refused, 'SCOPE');
  assert.equal(
    reconcileLongRegister(input(new Uint8Array([0x53, 0xff, 0x0a]))).refused,
    'ENCODING',
  );
  for (const bad of ['Section,"P1\n', 'Section,P"1\n', 'Section,"P1"x\n'])
    assert.equal(reconcileLongRegister(input(bad)).refused, 'CSV', bad);
  const bom = new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode(csv(rows, '\r')),
  ]);
  assert.deepEqual(verdicts(reconcileLongRegister(input(bom))), {
    'D-101|depot=DOH': OK,
  });
});

void test('amounts follow the currency, in Latin, Arabic-Indic or Persian digits', () => {
  for (const [cell, ok] of [
    ['3700.00', true],
    ['3700', true],
    [' 3700.0 ', true],
    ['٣٧٠٠٫٠٠', true],
    ['۳۷۰۰', true],
    ['3700.001', false],
    ['3,700.00', false],
    ['-3700.00', false],
    ['3700.', false],
    ['', false],
  ] as [string, boolean][]) {
    const a = driver('A', 'D-101');
    a[3][6] = cell;
    const r = judge([
      ...section('P1', a, { totals: footing(driver('A', 'D-101')) }),
      ...runTotals(driver('A', 'D-101')),
    ]);
    assert.deepEqual(
      verdicts(r)['D-101|depot=DOH'],
      ok ? OK : ['held', ['AMOUNT', 'RUN_TOTALS', 'TOTAL_FIELD']],
      cell,
    );
  }
  const kwd = { ...SCOPE, Currency: 'KWD' };
  const k = driver('A', 'D-101', '400.125', '30.005', '45.000', '370.120');
  const rows = [
    ...section('P1', k, {
      labels: { Currency: 'KWD' },
      totals: [
        ['Total earnings', '400.125'],
        ['Total deductions', '30.005'],
        ['Total employer', '45.000'],
        ['Total net', '370.120'],
      ],
    }),
    ['Run totals', SCOPE['Payroll run']],
    ['Total earnings', '400.125'],
    ['Total deductions', '30.005'],
    ['Total employer', '45.000'],
    ['Total net', '370.120'],
    ['End run totals', SCOPE['Payroll run']],
  ];
  const r = judge(rows, kwd);
  assert.deepEqual(verdicts(r), { 'D-101|depot=DOH': OK });
  assert.equal(r.employees[0].net, '370120');
});

void test('kinds are exact, and identities follow the text rules', () => {
  for (const kind of ['Earning', 'earnings', 'allowance']) {
    const a = driver('A', 'D-101');
    a[0][5] = kind;
    const r = judge([
      ...section('P1', a, { totals: footing(driver('A', 'D-101')) }),
      ...runTotals(driver('A', 'D-101')),
    ]);
    assert.deepEqual(
      verdicts(r)['D-101|depot=DOH'],
      ['held', ['KIND', 'RUN_TOTALS', 'TOTAL_FIELD']],
      kind,
    );
  }
  for (const column of [0, 3, 4]) {
    const a = driver('A', 'D-101');
    a[1][column] = '=HYPERLINK("x")';
    assert.deepEqual(verdicts(judge(register(['P1', a]))), {
      'D-101|depot=DOH': ['held', ['IDENTITY']],
    });
  }
  for (const bad of [
    '@D',
    '-D',
    '+D',
    '=D',
    '#n/a',
    'D-1\u200b',
    'D-1\t',
    'D-1\u00a0',
    'D\u00a01',
    'x'.repeat(501),
  ]) {
    const a = driver('A', 'D-101');
    a[1][1] = bad;
    const r = judge(register(['P1', [...a, ...driver('B', 'D-102')]]));
    assert.deepEqual(r.run, ['LINE_UNREADABLE'], bad);
  }
  const wide = driver('A', 'D-101');
  wide[0] = [...wide[0], '', 'checked'];
  assert.deepEqual(verdicts(judge(register(['P1', wide]))), {
    'D-101|depot=DOH': ['held', ['LINE_WIDTH']],
  });
  const padded = driver('A', 'D-101');
  padded[0] = [...padded[0], '', '  '];
  assert.deepEqual(verdicts(judge(register(['P1', padded]))), {
    'D-101|depot=DOH': OK,
  });
});

void test('the input contract is checked before anything is read', () => {
  const good = input(csv(register(['P1', driver('A', 'D-101')])));
  const variants: [string, (i: PlrInput) => unknown][] = [
    ['READING', (i) => (i.readings[0].confirmed = false)],
    ['READING', (i) => ((i.readings[0] as { role: string }).role = 'register')],
    ['SOURCE', (i) => (i.files[0].name = 'register.xlsx')],
    ['SOURCE', (i) => (i.files[0].sha256 = 'abc')],
    ['SCOPE', (i) => (i.scope.confirmed = false)],
    ['INPUT', (i) => ((i as { extra?: number }).extra = 1)],
  ];
  for (const [code, change] of variants) {
    const copy = structuredClone(good);
    change(copy);
    assert.throws(() => reconcileLongRegister(copy), new RegExp(`PLR_${code}`));
  }
});

void test('the replay hashes its own copy and refuses a hash it was not given', async () => {
  const text = csv(register(['P1', driver('A', 'D-101')]));
  const bytes = new TextEncoder().encode(text);
  const original = bytes.slice().buffer;
  const request = {
    files: [{ name: 'register.csv', original }] as [
      { name: string; original: ArrayBuffer; sha256?: string },
    ],
    readings: [
      { role: PLR_ROLE, family: PLR_VERSION, confirmed: true },
    ] as PlrInput['readings'],
    scope: { confirmed: true, fields: { ...SCOPE } },
  };
  const pending = replayLongRegister(request);
  new Uint8Array(original).fill(0x20);
  request.scope.fields.Entity = 'Changed';
  const { state, result } = await pending;
  assert.deepEqual(verdicts(result), { 'D-101|depot=DOH': OK });
  assert.equal(state.scope.fields.Entity, SCOPE.Entity);
  assert.equal(
    state.files[0].sha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  await assert.rejects(
    replayLongRegister({
      ...request,
      files: [
        {
          name: 'register.csv',
          original: bytes.slice().buffer,
          sha256: '0'.repeat(64),
        },
      ],
    }),
    /PLR_SOURCE_HASH/,
  );
});

void test('the column order, page order and writer form change nothing', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102');
  const order = [6, 2, 0, 5, 1, 4, 3];
  const shuffled = [
    ...section(
      'P2',
      b.map((r) => order.map((j) => r[j])),
      { columns: order.map((j) => COLUMNS[j]), totals: footing(b) },
    ),
    ...runTotals([...a, ...b]),
    ...section('P1', a),
  ];
  const plain = judge(register(['P1', a], ['P2', b]));
  const other = reconcileLongRegister(input(csv(shuffled, '\r\n')));
  const facts = (r: PlrResult) =>
    r.employees.map((e) => ({
      ...e,
      rows: null,
      lines: e.lines && e.lines.map((l) => ({ ...l, row: null })),
    }));
  assert.deepEqual(facts(other), facts(plain));
  assert.deepEqual(other.totals, plain.totals);
  assert.deepEqual(other.run, []);
});

void test('contract details no story above reaches', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102');
  const held = (rows: Row[]) => judge(rows).run;
  // A section is closed only by its own end row, with two cells.
  const byRunEnd = section('P1', a, { end: false });
  assert.deepEqual(
    held([...byRunEnd, ['End run totals', 'P1'], ...runTotals(a)]),
    ['SECTION_UNCLOSED'],
  );
  const wideEnd = section('P1', a);
  wideEnd[wideEnd.length - 2] = ['End section', 'P1', 'x'];
  assert.deepEqual(held([...wideEnd, ...runTotals(a)]), ['SECTION_UNCLOSED']);
  const wideStart = section('P1', a);
  wideStart[0] = ['Section', 'P1', 'x'];
  assert.deepEqual(
    held([...wideStart, ...section('P2', b), ...runTotals([...a, ...b])]),
    ['RUN_TOTAL_MISMATCH', 'SECTION_HEADER', 'SECTION_UNCLOSED'],
  );
  // Labels: each once, none other, the dates real.
  for (const o of [
    { extra: [['Region', 'North']] },
    { extra: [['Currency', 'QAR']] },
    { labels: { 'Period end': '2027-02-30' } },
    { labels: { 'Payment date': '2027-4-01' } },
  ] as SectionOptions[]) {
    const r = judge([
      ...section('P1', a),
      ...section('P2', b, o),
      ...runTotals(a),
    ]);
    assert.deepEqual(r.run, ['SECTION_HEADER'], JSON.stringify(o));
    assert.deepEqual(r.excludedSections, [], JSON.stringify(o));
  }
  // A line after the totals leaves them uncheckable.
  const late = [...section('P1', a.slice(0, 3), { totals: footing(a) })];
  late.splice(late.length - 2, 0, a[3]);
  assert.deepEqual(verdicts(judge([...late, ...runTotals(a)])), {
    'D-101|depot=DOH': ['held', ['TOTAL_FIELD']],
  });
  // Total rows: two cells, each label once.
  const wideTotal = runTotals(a);
  wideTotal[4] = ['Total net', '3700.00', 'x'];
  assert.deepEqual(held([...section('P1', a), ...wideTotal]), ['RUN_TOTALS']);
  const twiceNet = runTotals(a);
  twiceNet[3] = ['Total net', '3700.00'];
  assert.deepEqual(held([...section('P1', a), ...twiceNet]), ['RUN_TOTALS']);
  const wideOpening = runTotals(a);
  wideOpening[0] = ['Run totals', SCOPE['Payroll run'], 'x'];
  assert.deepEqual(held([...section('P1', a), ...wideOpening]), ['RUN_TOTALS']);
  // The scope has exactly its seven fields.
  assert.equal(
    judge(register(['P1', a]), { ...SCOPE, Extra: 'x' }).refused,
    'SCOPE',
  );
  // Amounts stop at 10^14 minor units.
  for (const [cell, want] of [
    ['1000000000000.00', ['inconsistent', ['NET_EQUATION']]],
    ['1000000000000.01', ['held', ['AMOUNT', 'RUN_TOTALS', 'TOTAL_FIELD']]],
  ] as [string, unknown][]) {
    const big = driver('A', 'D-101');
    big[3][6] = cell;
    const r = judge([...section('P1', big), ...runTotals(big)]);
    assert.deepEqual(verdicts(r)['D-101|depot=DOH'], want, cell);
  }
  // Doubled quotes and commas inside a quoted field are read as written.
  const quoted = driver('A', 'D-101');
  quoted[0][4] = 'Allowance "A", night';
  const q = judge(register(['P1', quoted]));
  assert.equal(q.employees[0].lines![0].component, 'Allowance "A", night');
  // Identifiers are compared as written: no leading zero is added or removed.
  const zeros = judge(
    register(['P1', [...driver('A', '0410'), ...driver('B', '410')]]),
  );
  assert.deepEqual(verdicts(zeros), {
    '0410|depot=DOH': OK,
    '410|depot=DOH': OK,
  });
  // Unplaced rows are listed in row order.
  const loose = b.map((r) => [...r]);
  loose[0][1] = '';
  const out = judge([
    ['Printed today'],
    ...register(['P1', [...a, ...loose]]),
    ['Page 1 of 1'],
  ]);
  assert.deepEqual(
    out.unplaced.map((u) => [u.row, u.code]),
    [
      [1, 'STRAY_ROW'],
      [15, 'LINE_UNREADABLE'],
      [31, 'STRAY_ROW'],
    ],
  );
});

void test('a section ended by another ID is open, an unreadable total is not a total, two nets hold', () => {
  const a = driver('A', 'D-101'),
    b = driver('B', 'D-102');
  const r = judge([
    ...section('P1', a, { end: 'P9' }),
    ...section('P2', b),
    ...runTotals([...a, ...b]),
  ]);
  assert.deepEqual(r.run, ['SECTION_UNCLOSED']);
  for (const value of ['3,700.00', 'x', '-3700.00']) {
    const footer = runTotals(a, { 'Total net': value });
    assert.deepEqual(
      judge([...section('P1', a), ...footer]).run,
      ['RUN_TOTALS'],
      value,
    );
    const page = judge([
      ...section('P1', a, { totals: footing(a, { 'Total net': value }) }),
      ...runTotals(a),
    ]);
    assert.deepEqual(
      verdicts(page),
      { 'D-101|depot=DOH': ['held', ['TOTAL_FIELD']] },
      value,
    );
  }
  const two = [
    ...driver('A', 'D-101', '4000.00', '300.00', '450.00', '3000.00'),
    line('A-5', 'D-101', 'net', '700.00'),
  ];
  assert.deepEqual(verdicts(judge(register(['P1', two]))), {
    'D-101|depot=DOH': ['held', ['NET_REPEATED']],
  });
});
