import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  GLS_VERSION,
  glsAmount,
  glsDate,
  glsText,
  reconcileGlTbSections,
  type GlsInput,
  type GlsResult,
} from '../lib/reconciliation/gl-tb-sections.ts';
import { replayGlTbSections } from '../lib/reconciliation/gl-tb-sections-io.ts';

// Synthetic ledger of a test trading company for November. Values here are
// unrelated to the sealed GLT-1 foundation, which is measured separately.
const RUN = {
  Entity: 'Test Trading Co',
  Ledger: 'Group book',
  Currency: 'USD',
  'Currency basis': 'functional',
  'Posting status': 'posted',
  'Posting layer': 'actual',
  'Period start': '2026-11-01',
  'Period end': '2026-11-30',
};
const SCOPE = {
  entity: RUN.Entity,
  ledger: RUN.Ledger,
  currency: RUN.Currency,
  currencyBasis: RUN['Currency basis'],
  postingStatus: RUN['Posting status'],
  postingLayer: RUN['Posting layer'],
  start: RUN['Period start'],
  end: RUN['Period end'],
  confirmed: true,
};
const LABELS = [
  'Entity',
  'Ledger',
  'Account',
  'Complete dimensions',
  'Currency',
  'Currency basis',
  'Posting status',
  'Posting layer',
  'Period start',
  'Period end',
];
const GL = ['Record ID', 'Record kind', 'Posting date', 'Debit', 'Credit'];
const TB = [
  'Account',
  'Complete dimensions',
  'Row type',
  'Parent account',
  'Opening debit',
  'Opening credit',
  'Period debit',
  'Period credit',
  'Closing debit',
  'Closing credit',
];
const SIX = ['20.00', '0.00', '5.00', '1.00', '24.00', '0.00'];

type Sec = {
  id?: string;
  account?: string;
  dims?: string;
  records?: string[][];
  labels?: Record<string, string>;
  drop?: string[];
  extra?: string[][];
  columns?: string[];
  end?: string | false;
};
function section(s: Sec = {}) {
  const id = s.id ?? 'N-1';
  const v: Record<string, string> = {
    ...RUN,
    Account: s.account ?? '7000',
    'Complete dimensions': s.dims ?? 'unit=a',
    ...s.labels,
  };
  const records = s.records ?? [
    [`${id}-o`, 'opening', '2026-11-01', '20.00', '0.00'],
    [`${id}-m1`, 'movement', '2026-11-05', '5.00', '0.00'],
    [`${id}-m2`, 'movement', '2026-11-20', '0.00', '1.00'],
    [`${id}-c`, 'closing', '2026-11-30', '24.00', '0.00'],
  ];
  return [
    ['Section', id],
    ...LABELS.filter((l) => !s.drop?.includes(l)).map((l) => [l, v[l]]),
    ...(s.extra ?? []),
    s.columns ?? GL,
    ...records,
    ...(s.end === false ? [] : [['End section', s.end ?? id]]),
    [],
  ];
}
type Pg = {
  id?: string;
  rows: string[][];
  labels?: Record<string, string>;
  columns?: string[];
  end?: string | false;
};
function page(p: Pg) {
  const id = p.id ?? 'TB-1';
  const v: Record<string, string> = { ...RUN, ...p.labels };
  return [
    ['Page', id],
    ...LABELS.filter((l) => l in RUN).map((l) => [l, v[l]]),
    p.columns ?? TB,
    ...p.rows,
    ...(p.end === false ? [] : [['End page', p.end ?? id]]),
    [],
  ];
}
const row = (
  account = '7000',
  dims = 'unit=a',
  six: string[] = SIX,
  kind = 'account',
  parent = '',
) => [account, dims, kind, parent, ...six];
const csv = (rows: string[][]) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';
const bytes = (text: string) => new TextEncoder().encode(text).buffer;

async function input(
  gl: string[][] | string,
  tb: string[][] | string,
  scope = SCOPE,
): Promise<GlsInput> {
  const files = [
    await readFile('gl.csv', bytes(typeof gl === 'string' ? gl : csv(gl))),
    await readFile('tb.csv', bytes(typeof tb === 'string' ? tb : csv(tb))),
  ];
  return {
    files: files as GlsInput['files'],
    readings: [
      { sheet: 0, role: 'gl-sections', family: GLS_VERSION, confirmed: true },
      { sheet: 0, role: 'tb-pages', family: GLS_VERSION, confirmed: true },
    ],
    scope: { ...scope },
  };
}
// A run the engine cannot finish is a failed expectation, not a crash.
async function judge(
  gl: string[][] | string,
  tb: string[][] | string,
  scope = SCOPE,
) {
  const i = await input(gl, tb, scope);
  try {
    return reconcileGlTbSections(i);
  } catch (error) {
    return assert.fail(`the engine stopped: ${String(error)}`);
  }
}
const statuses = (r: GlsResult) =>
  Object.fromEntries(r.accounts.map((a) => [a.key, [a.status, a.codes]]));

void test('accounts are decided one by one, with the six components and their places', async () => {
  const r = await judge(
    [...section(), ...section({ id: 'N-2', account: '7100' })],
    page({ rows: [row(), row('7100')] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['consistent', []],
    '7100|unit=a': ['consistent', []],
  });
  assert.deepEqual(r.accounts[0].gl, [2000, 0, 500, 100, 2400, 0]);
  assert.deepEqual(r.accounts[0].tb, [2000, 0, 500, 100, 2400, 0]);
  assert.deepEqual(r.accounts[1].sections, [{ id: 'N-2', row: 19 }]);
  assert.deepEqual(r.accounts[1].rows, [{ page: 'TB-1', row: 12 }]);
  assert.equal(r.decimals, 2);
  assert.deepEqual(
    r.sources.map((s) => s.role),
    ['gl-sections', 'tb-pages'],
  );
});

void test('two cost centres swapped are two differences, never one consistent total', async () => {
  const other = ['20.00', '0.00', '9.00', '1.00', '28.00', '0.00'];
  const r = await judge(
    [
      ...section(),
      ...section({
        id: 'N-2',
        dims: 'unit=b',
        records: [
          ['b-o', 'opening', '2026-11-01', '20.00', '0.00'],
          ['b-m', 'movement', '2026-11-05', '9.00', '1.00'],
          ['b-c', 'closing', '2026-11-30', '28.00', '0.00'],
        ],
      }),
    ],
    page({ rows: [row('7000', 'unit=a', other), row('7000', 'unit=b', SIX)] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['difference', ['closingDebit', 'periodDebit']],
    '7000|unit=b': ['difference', ['closingDebit', 'periodDebit']],
  });
});

void test('equal nets with another turnover differ by component', async () => {
  const r = await judge(
    section(),
    page({
      rows: [
        row('7000', 'unit=a', [
          '20.00',
          '0.00',
          '4.00',
          '0.00',
          '24.00',
          '0.00',
        ]),
      ],
    }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['difference', ['periodCredit', 'periodDebit']],
  });
});

void test('bridges are proven for each source before comparison', async () => {
  const r = await judge(
    section({
      records: [
        ['o', 'opening', '2026-11-01', '20.00', '0.00'],
        ['c', 'closing', '2026-11-30', '24.00', '0.00'],
      ],
    }),
    page({
      rows: [
        row('7000', 'unit=a', [
          '20.00',
          '0.00',
          '4.00',
          '0.00',
          '25.00',
          '0.00',
        ]),
      ],
    }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['inconsistent', ['GL_BRIDGE', 'TB_BRIDGE']],
  });
});

void test('codes are compared as written: a lost leading zero is another account', async () => {
  const r = await judge(
    section({ account: '0700' }),
    page({ rows: [row('700')] }),
  );
  assert.deepEqual(statuses(r), {
    '0700|unit=a': ['missing', ['TB_ROW_ABSENT']],
    '700|unit=a': ['missing', ['GL_SECTION_ABSENT']],
  });
});

void test('a blank amount is not zero, and a zero TB account without a section is missing', async () => {
  const blank = [...SIX];
  blank[3] = '';
  const r = await judge(
    section(),
    page({
      rows: [
        row('7000', 'unit=a', blank),
        row('7900', 'unit=a', ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00']),
      ],
    }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['AMOUNT']],
    '7900|unit=a': ['missing', ['GL_SECTION_ABSENT']],
  });
});

void test('a section never inherits dimensions; unreadable ones hold the code and are listed', async () => {
  const r = await judge(
    [
      ...section(),
      ...section({ id: 'N-2', drop: ['Complete dimensions'] }),
      ...section({ id: 'N-3', account: '7100' }),
    ],
    page({ rows: [row(), row('7000', 'unit=b'), row('7100')] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['SECTION_HEADER']],
    '7000|unit=b': ['held', ['SECTION_HEADER']],
    '7100|unit=a': ['consistent', []],
  });
  assert.deepEqual(r.unplaced, [
    { file: 'gl', row: 19, code: 'SECTION_HEADER' },
  ]);
  assert.deepEqual(r.run, []);
});

void test('another scope is excluded and listed; an unclosed section is held, never excluded', async () => {
  const august = { 'Period start': '2026-10-01', 'Period end': '2026-10-31' };
  const r = await judge(
    [
      ...section({
        id: 'OLD',
        labels: august,
        records: [['x', 'odd', 'never', '-1', '']],
      }),
      ...section(),
      ...section({ id: 'N-3', account: '7100', labels: august, end: false }),
    ],
    page({ rows: [row(), row('7100')] }).concat(
      page({ id: 'TB-0', labels: august, rows: [row()] }),
    ),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['consistent', []],
    '7100|unit=a': ['held', ['SECTION_UNCLOSED']],
  });
  assert.deepEqual(r.excludedSections, [{ id: 'OLD', row: 1 }]);
  assert.deepEqual(r.excludedPages, [{ id: 'TB-0', row: 15 }]);
});

void test('record faults hold their account only', async () => {
  const faulty = (records: string[][]) => [
    ['o', 'opening', '2026-11-01', '20.00', '0.00'],
    ...records,
    ['c', 'closing', '2026-11-30', '24.00', '0.00'],
  ];
  const cases: [string[][], string][] = [
    [[['m', 'movement', '2026-12-01', '4.00', '0.00']], 'POSTING_PERIOD'],
    [[['m', 'movement', '2026-11-31', '4.00', '0.00']], 'DATE'],
    [[['m', 'adjustment', '2026-11-05', '4.00', '0.00']], 'KIND'],
    [[['m', 'constructor', '2026-11-05', '4.00', '0.00']], 'KIND'],
    [[['=m', 'movement', '2026-11-05', '4.00', '0.00']], 'IDENTITY'],
    [[['m', 'movement', '2026-11-05', '4.00', '']], 'AMOUNT'],
    [[['o', 'movement', '2026-11-05', '4.00', '0.00']], 'DUPLICATE_RECORD'],
    [
      [
        ['o2', 'opening', '2026-11-01', '0.00', '0.00'],
        ['m', 'movement', '2026-11-05', '4.00', '0.00'],
      ],
      'ROLE_REPEATED',
    ],
  ];
  for (const [records, code] of cases) {
    const r = await judge(
      [
        ...section({ records: faulty(records) }),
        ...section({ id: 'N-2', account: '7100' }),
      ],
      page({ rows: [row(), row('7100')] }),
    );
    assert.deepEqual(
      statuses(r),
      {
        '7000|unit=a': ['held', [code]],
        '7100|unit=a': ['consistent', []],
      },
      code,
    );
  }
});

void test('missing roles and duplicates', async () => {
  const noOpening = [
    ['m', 'movement', '2026-11-05', '4.00', '0.00'],
    ['c', 'closing', '2026-11-30', '4.00', '0.00'],
  ];
  let r = await judge(section({ records: noOpening }), page({ rows: [] }));
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['missing', ['GL_OPENING_ABSENT', 'TB_ROW_ABSENT']],
  });
  r = await judge(
    [
      ...section(),
      ...section({ id: 'N-2' }),
      ...section({ id: 'N-3', account: '7100' }),
      ...section({ id: 'N-3', account: '7200' }),
    ],
    page({ rows: [row(), row('7100'), row('7100'), row('7200')] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['SECTION_DUPLICATE']],
    '7100|unit=a': ['held', ['SECTION_DUPLICATE', 'TB_CONFLICT']],
    '7200|unit=a': ['held', ['SECTION_DUPLICATE']],
  });
  const late = [
    ['o', 'opening', '2026-11-02', '20.00', '0.00'],
    ['c', 'closing', '2026-11-30', '20.00', '0.00'],
  ];
  r = await judge(
    section({ records: late }),
    page({
      rows: [
        row('7000', 'unit=a', [
          '20.00',
          '0.00',
          '0.00',
          '0.00',
          '20.00',
          '0.00',
        ]),
      ],
    }),
  );
  assert.deepEqual(statuses(r), { '7000|unit=a': ['held', ['DATE']] });
});

void test('section columns, header labels and closure', async () => {
  const cases: [Sec, string[]][] = [
    [
      {
        columns: [
          'Record ID',
          'Record kind',
          'Posting date',
          'Debit',
          'Amount',
        ],
      },
      ['SECTION_COLUMNS'],
    ],
    [
      { records: [['o', 'opening', '2026-11-01', '20.00', '0.00', 'x']] },
      ['SECTION_COLUMNS'],
    ],
    [{ extra: [['Region', 'West']] }, ['SECTION_HEADER']],
    [{ extra: [['Ledger', 'Group book']] }, ['SECTION_HEADER']],
    [{ labels: { 'Period end': '2026-11-31' } }, ['SECTION_HEADER']],
    [{ end: 'N-9' }, ['SECTION_UNCLOSED']],
  ];
  for (const [s, codes] of cases) {
    const r = await judge(section(s), page({ rows: [row()] }));
    assert.deepEqual(
      statuses(r),
      { '7000|unit=a': ['held', codes] },
      JSON.stringify(s),
    );
  }
});

void test('a row outside every section or page, an unreadable section, page or row hold every account', async () => {
  const two = [...section(), ...section({ id: 'N-2', account: '7100' })];
  const both = page({ rows: [row(), row('7100')] });
  const all = (code: string) => ({
    '7000|unit=a': ['held', [code]],
    '7100|unit=a': ['held', [code]],
  });
  let r = await judge([['Checked by'], ...two], both);
  assert.deepEqual(
    [statuses(r), r.run, r.unplaced],
    [
      all('STRAY_ROW'),
      ['STRAY_ROW'],
      [{ file: 'gl', row: 1, code: 'STRAY_ROW' }],
    ],
  );
  r = await judge([...two, ...section({ id: 'N-3', account: '#n/a' })], both);
  assert.deepEqual(
    [statuses(r), r.run],
    [all('SECTION_UNREADABLE'), ['SECTION_UNREADABLE']],
  );
  r = await judge(two, [
    ...both,
    ...page({ id: 'TB-2', rows: [], end: false }),
  ]);
  assert.deepEqual(
    [statuses(r), r.run],
    [all('PAGE_UNREADABLE'), ['PAGE_UNREADABLE']],
  );
  r = await judge(
    two,
    page({ rows: [row(), row('7100'), row('7200', 'unit=a', SIX, 'Account')] }),
  );
  assert.deepEqual(
    [statuses(r), r.unplaced],
    [all('ROW_UNREADABLE'), [{ file: 'tb', row: 13, code: 'ROW_UNREADABLE' }]],
  );
});

void test('totals are checked against the rows that name them, never against the GL', async () => {
  const gl = [...section(), ...section({ id: 'N-2', account: '7100' })];
  const total = ['40.00', '0.00', '10.00', '2.00', '48.00', '0.00'];
  const kids = [
    row('7000', 'unit=a', SIX, 'account', '7999'),
    row('7100', 'unit=a', SIX, 'account', '7999'),
  ];
  let r = await judge(
    gl,
    page({ rows: [...kids, row('7999', 'unit=a', total, 'total')] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['consistent', []],
    '7100|unit=a': ['consistent', []],
  });
  assert.deepEqual(r.orphanTotals, []);
  const wrong = [...total];
  wrong[2] = '10.01';
  const blank = [...SIX];
  blank[0] = '';
  r = await judge(
    gl,
    page({
      rows: [
        row('7000', 'unit=a', blank, 'account', '7999'),
        kids[1],
        row('7999', 'unit=a', total, 'total'),
      ],
    }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['AMOUNT', 'TOTAL_FIELD']],
    '7100|unit=a': ['held', ['TOTAL_FIELD']],
  });
  r = await judge(
    gl,
    page({ rows: [...kids, row('7999', 'unit=a', wrong, 'total')] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['TOTAL_MISMATCH']],
    '7100|unit=a': ['held', ['TOTAL_MISMATCH']],
  });
  r = await judge(
    gl,
    page({ rows: [...kids, row('7999', 'unit=a', total, 'total', '=7')] }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['TOTAL_FIELD']],
    '7100|unit=a': ['held', ['TOTAL_FIELD']],
  });
  r = await judge(
    gl,
    page({
      rows: [
        ...kids,
        row('7999', 'unit=b', total, 'total'),
        row('7990', 'unit=a', total, 'total', '7999'),
      ],
    }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['consistent', []],
    '7100|unit=a': ['consistent', []],
  });
  assert.deepEqual(
    r.orphanTotals.map((t) => t.key),
    ['7990|unit=a', '7999|unit=b'],
  );
});

void test('TB row fields: a parent that does not read and a cell past the columns', async () => {
  const r = await judge(
    [...section(), ...section({ id: 'N-2', account: '7100' })],
    page({
      rows: [
        row('7000', 'unit=a', SIX, 'account', '+1'),
        [...row('7100'), 'seen'],
      ],
    }),
  );
  assert.deepEqual(statuses(r), {
    '7000|unit=a': ['held', ['ROW_FIELD']],
    '7100|unit=a': ['held', ['ROW_FIELD']],
  });
});

void test('reading rules', () => {
  for (const bad of [
    '',
    '   ',
    '=A',
    '+A',
    '@A',
    '-A',
    '#ref!',
    '#NUM!x',
    'A\u00a0',
    'A\u200b',
    'A\u202e',
    'A\u2028',
    'a'.repeat(501),
  ])
    assert.equal(glsText(bad), null, JSON.stringify(bad));
  assert.equal(glsText('  Group book '), 'Group book');
  assert.equal(glsText('\u{1d7d8}'.repeat(500)), '\u{1d7d8}'.repeat(500));
  assert.equal(glsDate(' 2028-02-29 '), '2028-02-29');
  assert.equal(glsDate('2000-02-29'), '2000-02-29');
  assert.equal(glsDate('2100-02-29'), null);
  for (const bad of [
    '2026-02-29',
    '2026-13-01',
    '0000-01-01',
    '2026-1-01',
    '٢٠٢٦-١١-٠١',
  ])
    assert.equal(glsDate(bad), null, bad);
  assert.equal(glsAmount('۱۲٫۵۰', 2), 1250);
  assert.equal(glsAmount('١٫٠٠٥', 3), 1005);
  assert.equal(glsAmount('007', 0), 7);
  assert.equal(glsAmount('1000000000000.00', 2), 1e14);
  for (const [bad, d] of [
    ['1000000000000.01', 2],
    ['1.5', 0],
    ['1.', 2],
    ['.5', 2],
    ['1,000', 2],
    ['-1', 2],
    ['', 2],
    ['1e3', 2],
  ] as const)
    assert.equal(glsAmount(bad, d), null, bad);
});

void test('the run scope and the inputs are refused when they cannot be held', async () => {
  const ok = await input(section(), page({ rows: [row()] }));
  const bad = (change: (i: GlsInput) => void, code: string) => {
    const i = structuredClone(ok);
    change(i);
    assert.throws(() => reconcileGlTbSections(i), new RegExp(`GLS_${code}`));
  };
  bad((i) => (i.scope.currency = 'XYZ'), 'SCOPE');
  bad((i) => (i.scope.currency = 'toString'), 'SCOPE');
  bad((i) => (i.scope.currencyBasis = 'presentation'), 'SCOPE');
  bad((i) => (i.scope.start = '2026-12-01'), 'SCOPE');
  bad((i) => (i.scope.confirmed = false), 'SCOPE');
  bad((i) => (i.readings[0].confirmed = false), 'READING');
  bad((i) => i.readings.reverse(), 'READING');
  bad((i) => (i.files[1] = i.files[0]), 'INDEPENDENT_SOURCES');
  bad((i) => (i.files[0].name = 'gl.xlsx'), 'SOURCE');
});

void test('yen and dinar precision', async () => {
  const jpy = { ...SCOPE, currency: 'JPY' };
  const records = [
    ['o', 'opening', '2026-11-01', '1500', '0'],
    ['c', 'closing', '2026-11-30', '1500', '0'],
  ];
  const r = await judge(
    section({ labels: { Currency: 'JPY' }, records }),
    page({
      labels: { Currency: 'JPY' },
      rows: [row('7000', 'unit=a', ['1500', '0', '0', '0', '1500.0', '0'])],
    }),
    jpy,
  );
  assert.deepEqual(statuses(r), { '7000|unit=a': ['held', ['AMOUNT']] });
});

void test('layout changes keep every verdict and component', async () => {
  const gl = [...section(), ...section({ id: 'N-2', account: '7100' })];
  const tb = page({
    rows: [
      row(),
      row('7100', 'unit=a', ['20.00', '0.00', '5.00', '1.00', '24.01', '0.00']),
    ],
  });
  const want = await judge(gl, tb);
  const shuffle = (rows: string[][], order: number[]) =>
    rows.map((r) => (r.length > 2 ? order.map((i) => r[i] ?? '') : r));
  const relabel = (rows: string[][]) => {
    const out = rows.map((r) => [...r]);
    const at = out.findIndex((r) => r[0] === 'Ledger');
    [out[at], out[at + 1]] = [out[at + 1], out[at]];
    return out;
  };
  const padded = (rows: string[][], w: number) =>
    rows.map((r) => [...r, ...Array(w - r.length).fill('')]);
  const text =
    '\uFEFF' +
    csv(padded(relabel(shuffle(gl, [4, 2, 0, 3, 1])), 6)).replaceAll(
      '\n',
      '\r\n',
    );
  const got = await judge(
    text,
    padded(shuffle(tb, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]), 12),
  );
  assert.deepEqual(got.accounts, want.accounts);
  assert.deepEqual(statuses(got), {
    '7000|unit=a': ['consistent', []],
    '7100|unit=a': ['inconsistent', ['TB_BRIDGE']],
  });
});

void test('the worker replays from the original bytes and ignores rows the page sends', async () => {
  const i = await input(section(), page({ rows: [row()] }));
  i.files[1].sheets[0].rows = [['Page', 'forged']];
  const { result } = await replayGlTbSections(i);
  assert.deepEqual(statuses(result), { '7000|unit=a': ['consistent', []] });
  const changed = await input(section(), page({ rows: [row()] }));
  changed.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(replayGlTbSections(changed), /GLS_SOURCE_HASH/);
});
