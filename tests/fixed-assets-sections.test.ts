import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FA_SECTIONS_COLUMNS,
  FA_SECTIONS_GL_HEADER,
  FA_SECTIONS_MAP_HEADER,
  FA_SECTIONS_ROLES,
  FA_SECTIONS_VERSION,
} from '../lib/reconciliation/fixed-assets-sections.ts';
import { replayAssetSections } from '../lib/reconciliation/fixed-assets-sections-io.ts';

// A fabrication plant's asset register in Bahraini dinars at 30 June 2028:
// a lineage of its own, not the sealed FA-1 stories.
const SCOPE = {
  entity: 'Synthetic Sitra Fabrication WLL',
  assetLedger: 'FAR-2028',
  glLedger: 'GL-BH',
  currency: 'BHD',
  asOf: '2028-06-30',
  confirmed: true as const,
};
const READINGS = FA_SECTIONS_ROLES.map((role) => ({
  sheet: 0 as const,
  role,
  family: FA_SECTIONS_VERSION,
  confirmed: true as const,
}));
const PM = 'Plant and machinery',
  MV = 'Motor vehicles',
  CH = 'Computer hardware';
const ACCOUNTS: Record<string, Record<string, string>> = {
  [PM]: { cost: '2110', depreciation: '2119', impairment: '2118' },
  [MV]: { cost: '2120', depreciation: '2129', impairment: '2128' },
  [CH]: { cost: '2130', depreciation: '2139', impairment: '2138' },
};
const CLASS: Record<string, string> = {
  cost: 'fixed-asset-cost',
  depreciation: 'accumulated-depreciation',
  impairment: 'accumulated-impairment',
};
const DIMS = 'PL-01';
type Asset = [string, string, number, number, number];
const P1: Asset = ['PM-7001', 'LINE-A', 4500250, 1800100, 0];
const P2: Asset = ['PM-7002', 'LINE-B', 1200000, 960000, 60000];
const M1: Asset = ['MV-3001', 'FLEET', 980500, 392200, 0];
const C1: Asset = ['CH-5001', 'IT', 310000, 310000, 0];
const money = (minor: number) => {
  const sign = minor < 0 ? '-' : '';
  const n = Math.abs(minor);
  return `${sign}${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, '0')}`;
};
type Rows = string[][];
type Options = {
  labels?: Record<string, string | null>;
  extra?: Rows;
  columns?: string[] | null;
  end?: string | null;
  totals?: Rows;
  rows?: Rows;
};
const COMPONENTS = ['cost', 'depreciation', 'impairment', 'carrying'];
function assetRows(
  a: Asset,
  columns: string[],
  change: Record<string, string> = {},
) {
  const [id, dims, cost, dep, imp] = a;
  const amounts: Record<string, number> = {
    cost,
    depreciation: dep,
    impairment: imp,
    carrying: cost - dep - imp,
  };
  return COMPONENTS.map((c) => {
    const fields: Record<string, string> = {
      'Asset ID': id,
      'Asset dimensions': dims,
      Component: c,
      Amount: change[c] ?? money(amounts[c]),
      'Valuation reference': `VR-${id.slice(0, 2)}`,
    };
    return columns.map((h) => fields[h]);
  });
}
function section(
  id: string,
  location: string,
  category: string,
  assets: Asset[],
  o: Options = {},
): Rows {
  const values: Record<string, string | null> = {
    Entity: SCOPE.entity,
    'Asset ledger': SCOPE.assetLedger,
    Currency: SCOPE.currency,
    'As of': SCOPE.asOf,
    Location: location,
    Category: category,
    ...o.labels,
  };
  const columns =
    o.columns === undefined ? [...FA_SECTIONS_COLUMNS] : o.columns;
  const out: Rows = [['Section', id]];
  for (const [k, v] of Object.entries(values)) if (v !== null) out.push([k, v]);
  out.push(...(o.extra ?? []));
  if (columns) {
    out.push(columns);
    for (const a of assets) out.push(...assetRows(a, columns));
  }
  out.push(...(o.rows ?? []), ...(o.totals ?? []));
  if (o.end !== null) out.push(['End section', o.end ?? id]);
  return out;
}
function mapRows(
  categories: string[],
  extra: Rows = [],
  skip: string[] = [],
): Rows {
  const out: Rows = [[...FA_SECTIONS_MAP_HEADER]];
  for (const cat of categories)
    for (const c of ['cost', 'depreciation', 'impairment'])
      if (!skip.includes(`${cat}|${c}`))
        out.push([
          cat,
          c,
          ACCOUNTS[cat][c],
          DIMS,
          CLASS[c],
          '2020-01-01',
          '9999-12-31',
        ]);
  return [...out, ...extra];
}
function glRow(
  account: string,
  component: string,
  normal: number,
  change: Record<number, string> = {},
) {
  const [debit, credit] =
    component === 'cost'
      ? normal >= 0
        ? [normal, 0]
        : [0, -normal]
      : normal >= 0
        ? [0, normal]
        : [-normal, 0];
  const row = [
    account,
    DIMS,
    CLASS[component],
    money(debit),
    money(credit),
    SCOPE.entity,
    SCOPE.glLedger,
    SCOPE.currency,
    SCOPE.asOf,
  ];
  for (const [k, v] of Object.entries(change)) row[Number(k)] = v;
  return row;
}
/** GL rows equal to the assets each category holds, moved by adjust. */
function glRows(
  holdings: Record<string, Asset[]>,
  adjust: Record<string, number> = {},
  skip: string[] = [],
): Rows {
  const out: Rows = [[...FA_SECTIONS_GL_HEADER]];
  for (const [cat, assets] of Object.entries(holdings))
    ['cost', 'depreciation', 'impairment'].forEach((c, i) => {
      const account = ACCOUNTS[cat][c];
      if (skip.includes(account)) return;
      const sum = assets.reduce((s, a) => s + (a[2 + i] as number), 0);
      out.push(glRow(account, c, sum + (adjust[account] ?? 0)));
    });
  return out;
}
const csv = (rows: Rows) =>
  rows
    .map((r) =>
      r
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
        .join(','),
    )
    .join('\n') + '\n';
const bytes = (text: string | Uint8Array) => {
  const b = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return b.buffer.slice(
    b.byteOffset,
    b.byteOffset + b.byteLength,
  ) as ArrayBuffer;
};
const sha = (b: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
type Given = {
  register: Rows | ArrayBuffer;
  map: Rows | ArrayBuffer;
  gl: Rows | ArrayBuffer;
  scope?: Record<string, unknown>;
  readings?: unknown;
  names?: string[];
};
function input(g: Given) {
  const names = g.names ?? ['T-register.csv', 'T-map.csv', 'T-gl.csv'];
  const files = [g.register, g.map, g.gl].map((f, i) => {
    const original = f instanceof ArrayBuffer ? f : bytes(csv(f));
    return { name: names[i], original, sha256: sha(original) };
  });
  return { files, readings: g.readings ?? READINGS, scope: g.scope ?? SCOPE };
}
async function attempt(g: Given) {
  try {
    return {
      result: (await replayAssetSections(input(g) as never)).result,
      refused: null,
    };
  } catch (error) {
    const m = String((error as Error).message);
    // The engine returns a review or a refusal for every input: anything else
    // it raises fails here as an assertion, not as an error.
    if (!m.startsWith('FA_SECTIONS_'))
      assert.fail(`the engine raised ${(error as Error).name}: ${m}`);
    return { result: null, refused: m.slice('FA_SECTIONS_'.length) };
  }
}
/** A review that must not be refused: a refusal fails here as an assertion. */
async function review(g: Given) {
  const r = await attempt(g);
  assert.equal(r.refused, null, `refused ${r.refused}`);
  return r.result!;
}
async function refusal(g: Given) {
  return (await attempt(g)).refused;
}
type Result = Awaited<ReturnType<typeof review>>;
const accounts = (r: Result) =>
  Object.fromEntries(r.accounts.map((a) => [a.account, [a.status, a.codes]]));
const account = (r: Result, acct: string) =>
  r.accounts.find((a) => a.account === acct)!;
const sections = (r: Result) => r.sections.map((s) => [s[2], s[5], s[6]]);
const assetOf = (r: Result, id: string, sid?: string) =>
  r.assets.find(
    (a) => a.assetId === id && (sid === undefined || a.section === sid),
  )!;
const PLANT = section('S-SIT-PM', 'Sitra plant', PM, [P1, P2]);
const FLEET = section('S-MAN-MV', 'Manama office', MV, [M1]);
const two = (more: Partial<Given> = {}): Given => ({
  register: [...PLANT, ...FLEET],
  map: mapRows([PM, MV]),
  gl: glRows({ [PM]: [P1, P2], [MV]: [M1] }),
  ...more,
});

void test('a register of two sections: every account consistent, its members, amounts and inventory', async () => {
  const g = two();
  const r = await review(g);
  assert.equal(r.decimals, 3);
  assert.deepEqual(
    r.hashes,
    input(g).files.map((f) => f.sha256),
  );
  assert.deepEqual(r.run, []);
  assert.deepEqual(sections(r), [
    ['S-SIT-PM', 'read', []],
    ['S-MAN-MV', 'read', []],
  ]);
  assert.deepEqual(r.sections[0].slice(0, 5), [
    1,
    17,
    'S-SIT-PM',
    'Sitra plant',
    PM,
  ]);
  assert.deepEqual(
    r.accounts.map((a) => [
      a.account,
      a.component,
      a.status,
      a.register,
      a.gl,
      a.difference,
    ]),
    [
      ['2110', 'cost', 'consistent', 5700250, 5700250, 0],
      ['2118', 'impairment', 'consistent', 60000, 60000, 0],
      ['2119', 'depreciation', 'consistent', 2760100, 2760100, 0],
      ['2120', 'cost', 'consistent', 980500, 980500, 0],
      ['2128', 'impairment', 'consistent', 0, 0, 0],
      ['2129', 'depreciation', 'consistent', 392200, 392200, 0],
    ],
  );
  assert.deepEqual(account(r, '2119').members, [
    ['S-SIT-PM', 'PM-7001', 'LINE-A', 'depreciation'],
    ['S-SIT-PM', 'PM-7002', 'LINE-B', 'depreciation'],
  ]);
  assert.equal(account(r, '2110').glRow, 2);
  const p2 = assetOf(r, 'PM-7002');
  assert.deepEqual(p2.amounts, {
    cost: 1200000,
    depreciation: 960000,
    impairment: 60000,
    carrying: 180000,
  });
  assert.deepEqual(p2.rows, {
    cost: [13],
    depreciation: [14],
    impairment: [15],
    carrying: [16],
  });
  assert.equal(p2.valuation, 'VR-PM');
  assert.equal(p2.location, 'Sitra plant');
  assert.deepEqual(r.inventory, {
    register: {
      blank: 0,
      section: 2,
      end: 2,
      stray: 0,
      label: 12,
      columns: 2,
      total: 0,
      record: 12,
    },
    map: { header: 1, blank: 0, row: 6 },
    gl: { header: 1, blank: 0, row: 6 },
  });
});

void test('refusals in the contract order: READING, SCOPE, files in role order, COLUMNS', async () => {
  for (const readings of [
    READINGS.map((r, i) => (i === 1 ? { ...r, confirmed: false } : r)),
    READINGS.map((r, i) => (i === 2 ? { ...r, family: 'x' } : r)),
    READINGS.map((r, i) => (i === 0 ? { ...r, sheet: 1 } : r)),
    [...READINGS].reverse(),
    READINGS.slice(0, 2),
    READINGS.map((r) => ({ ...r, note: 'x' })),
  ])
    assert.equal(await refusal(two({ readings })), 'READING');
  for (const scope of [
    { ...SCOPE, confirmed: false },
    { ...SCOPE, currency: 'XAU' },
    { ...SCOPE, asOf: '2027-02-29' },
    { ...SCOPE, entity: 'X ' },
    { ...SCOPE, glLedger: undefined },
    { ...SCOPE, extra: 'x' },
  ])
    assert.equal(await refusal(two({ scope })), 'SCOPE');
  assert.equal(
    await refusal(
      two({ readings: [READINGS[0]], scope: { ...SCOPE, currency: 'XAU' } }),
    ),
    'READING',
  );
  assert.equal(
    await refusal(
      two({ scope: { ...SCOPE, currency: 'XAU' }, register: bytes('') }),
    ),
    'SCOPE',
  );
  assert.equal(
    await refusal(
      two({ register: bytes(new Uint8Array([0xff])), map: [['x']] }),
    ),
    'SOURCE',
  );
  assert.equal(await refusal(two({ map: [['x']], gl: bytes('"a') })), 'SOURCE');
  assert.equal(
    await refusal(two({ map: [[...FA_SECTIONS_MAP_HEADER, 'Note']] })),
    'COLUMNS',
  );
  assert.equal(
    await refusal(two({ gl: [FA_SECTIONS_GL_HEADER.slice(1)] })),
    'COLUMNS',
  );
  assert.equal(
    await refusal(
      two({ map: [[...FA_SECTIONS_MAP_HEADER.slice(1), 'Category']] }),
    ),
    null,
  );
  assert.equal(
    await refusal(two({ names: ['T.csv', 'T-map.xlsx', 'T-gl.csv'] })),
    'SOURCE',
  );
  assert.equal(
    await refusal(two({ names: ['T.CSV', 'M.Csv', 'G.csv'] })),
    null,
  );
});

void test('the reader: one byte order mark dropped, a second is text; grammar, encoding and ceilings', async () => {
  const BOM = [0xef, 0xbb, 0xbf];
  const reg = new TextEncoder().encode(csv([...PLANT, ...FLEET]));
  const r = await review(
    two({ register: bytes(new Uint8Array([...BOM, ...reg])) }),
  );
  assert.deepEqual(r.run, []);
  const twice = await review(
    two({ register: bytes(new Uint8Array([...BOM, ...BOM, ...reg])) }),
  );
  assert.deepEqual(twice.run, ['STRAY_ROW']);
  for (const text of [
    '',
    'a"b\n',
    '"a"b\n',
    '"a\n',
    'a\u0001\n',
    'a\u000b\n',
    'a\uffff\n',
  ])
    assert.equal(
      await refusal(two({ register: bytes(text) })),
      'SOURCE',
      JSON.stringify(text),
    );
  assert.equal(
    await refusal(two({ register: bytes(new Uint8Array([0xc3, 0x28])) })),
    'SOURCE',
  );
  assert.equal(
    await refusal(two({ register: bytes(','.repeat(100) + '\n') })),
    'CAPACITY',
  );
  assert.equal(
    await refusal(two({ register: bytes('\n'.repeat(20002)) })),
    'CAPACITY',
  );
  assert.equal(
    await refusal(two({ register: bytes('a'.repeat(32768)) })),
    'CAPACITY',
  );
  assert.equal(
    await refusal(
      two({ register: bytes(new Uint8Array(8 * 1024 * 1024 + 1).fill(0x20)) }),
    ),
    'CAPACITY',
  );
  const wide = await review(two({ register: bytes('\n'.repeat(20001)) }));
  assert.equal(wide.inventory.register.blank, 20001);
  const tab = await review(
    two({ register: [...PLANT, ...FLEET, ['note\twith tab']] }),
  );
  assert.deepEqual(tab.run, ['STRAY_ROW']);
});

void test('a file whose bytes are not the hash it came with is refused', async () => {
  const given = input(two());
  given.files[1].sha256 = '0'.repeat(64);
  await assert.rejects(
    replayAssetSections(given as never),
    /FA_SECTIONS_SOURCE_HASH/,
  );
});

void test('sections: unclosed, header, scope and columns, each the first code in order', async () => {
  const cases: [Rows, string, string[]][] = [
    [
      section('S1', 'Sitra plant', PM, [P1], { end: null }),
      'held',
      ['SECTION_UNCLOSED'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], { end: 'S9' }),
      'held',
      ['SECTION_UNCLOSED'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], { extra: [['Cost centre', 'X']] }),
      'held',
      ['SECTION_HEADER'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        extra: [['Location', 'Again']],
      }),
      'held',
      ['SECTION_HEADER'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        labels: { 'As of': '2028-06-31' },
      }),
      'held',
      ['SECTION_HEADER'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], { labels: { Location: null } }),
      'held',
      ['SECTION_HEADER'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], { extra: [['Note']] }),
      'held',
      ['SECTION_HEADER'],
    ],
    [section('=S1', 'Sitra plant', PM, [P1]), 'held', ['SECTION_HEADER']],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        labels: { Entity: 'Other WLL' },
      }),
      'excluded',
      ['SECTION_SCOPE'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], { labels: { Currency: 'SAR' } }),
      'excluded',
      ['SECTION_SCOPE'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        labels: { 'Asset ledger': 'FAR-2027' },
      }),
      'excluded',
      ['SECTION_SCOPE'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        labels: { 'As of': '2027-06-30' },
      }),
      'excluded',
      ['SECTION_SCOPE'],
    ],
    [
      section('S1', 'Sitra plant', PM, [], { columns: null }),
      'held',
      ['SECTION_COLUMNS'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        columns: [...FA_SECTIONS_COLUMNS, 'Amount'],
      }),
      'held',
      ['SECTION_COLUMNS'],
    ],
    [
      section('S1', 'Sitra plant', PM, [], {
        columns: ['Asset ID', 'Cost', 'Carrying amount'],
      }),
      'held',
      ['SECTION_COLUMNS'],
    ],
    [
      section('S1', 'Sitra plant', PM, [], {
        columns: [
          'Asset ID',
          'Asset dimensions',
          'Component',
          'Amount',
          'Valuation',
        ],
      }),
      'held',
      ['SECTION_COLUMNS'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        end: 'S9',
        extra: [['Note', 'x']],
      }),
      'held',
      ['SECTION_UNCLOSED'],
    ],
    [
      section('S1', 'Sitra plant', PM, [P1], {
        extra: [['Note', 'x']],
        labels: { Entity: 'Other' },
      }),
      'held',
      ['SECTION_HEADER'],
    ],
    [
      section('S1', 'Sitra plant', PM, [], {
        labels: { Entity: 'Other' },
        columns: ['A', 'B', 'C'],
      }),
      'excluded',
      ['SECTION_SCOPE'],
    ],
  ];
  for (const [rows, status, codes] of cases) {
    const r = await review(two({ register: [...rows, ...FLEET] }));
    assert.deepEqual(
      sections(r)[0].slice(1),
      [status, codes],
      JSON.stringify(rows.slice(0, 2)),
    );
    const held = status === 'held';
    assert.deepEqual(
      accounts(r)['2110'],
      held ? ['held', codes] : ['missing', ['REGISTER_ABSENT']],
    );
    assert.deepEqual(accounts(r)['2120'], ['consistent', []]);
    assert.equal(
      r.assets.some((a) => a.section === sections(r)[0][0]),
      false,
    );
  }
  const padded = await review(
    two({
      register: [
        ...PLANT.slice(0, -1),
        ['End section', 'S-SIT-PM', '', ''],
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(sections(padded)[0].slice(1), ['read', []]);
});

void test('a section whose category cannot be read holds every account', async () => {
  for (const o of [
    { labels: { Category: null } },
    { labels: { Category: '=PM' } },
    { extra: [['Category', PM]] },
  ]) {
    const r = await review(
      two({
        register: [...section('S1', 'Sitra plant', PM, [P1], o), ...FLEET],
      }),
    );
    assert.deepEqual(r.run, ['SECTION_UNREADABLE']);
    assert.deepEqual(r.unplaced, [
      ['register-sections', 1, 'SECTION_UNREADABLE'],
    ]);
    assert.equal(r.sections[0][4], null);
    assert.deepEqual(accounts(r)['2120'], ['held', ['SECTION_UNREADABLE']]);
  }
});

void test('rows outside every section hold every account; a row of empty cells does not', async () => {
  for (const stray of [
    ['Page 2'],
    ['End section', 'S-SIT-PM'],
    [' '],
    ['', 'x'],
    ['Section total', 'cost', '1.000'],
  ]) {
    const r = await review(two({ register: [...PLANT, stray, ...FLEET] }));
    assert.deepEqual(r.run, ['STRAY_ROW'], JSON.stringify(stray));
    assert.deepEqual(r.unplaced, [
      ['register-sections', PLANT.length + 1, 'STRAY_ROW'],
    ]);
    assert.deepEqual(accounts(r)['2129'], ['held', ['STRAY_ROW']]);
  }
  const r = await review(two({ register: [...PLANT, ['', ''], [], ...FLEET] }));
  assert.deepEqual(r.run, []);
  assert.equal(r.inventory.register.blank, 2);
});

void test('two sections under one ID are held and still read', async () => {
  const r = await review(
    two({
      register: [
        ...section('S1', 'Sitra plant', PM, [P1, P2]),
        ...section('S1', 'Manama office', MV, [M1]),
      ],
    }),
  );
  assert.deepEqual(sections(r), [
    ['S1', 'held', ['SECTION_DUPLICATE']],
    ['S1', 'held', ['SECTION_DUPLICATE']],
  ]);
  assert.equal(r.assets.length, 3);
  assert.deepEqual(accounts(r)['2128'], ['held', ['SECTION_DUPLICATE']]);
});

void test('an excluded section needs no map for its category', async () => {
  const r = await review(
    two({
      register: [
        ...PLANT,
        ...section('S-OLD', 'Sitra plant', CH, [C1], {
          labels: { 'As of': '2027-06-30' },
        }),
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(r.unmapped, []);
  assert.deepEqual(accounts(r)['2110'], ['consistent', []]);
});

void test('labels are not carried from the section before', async () => {
  const r = await review(
    two({
      register: [
        ...PLANT,
        ...section('S-MAN-MV', 'Manama office', MV, [M1], {
          labels: { Currency: null },
        }),
      ],
    }),
  );
  assert.deepEqual(sections(r)[1].slice(1), ['held', ['SECTION_HEADER']]);
});

void test('assets: a missing component is never derived, a written zero is a component', async () => {
  for (const c of COMPONENTS) {
    const rows = section('S-SIT-PM', 'Sitra plant', PM, [P1, P2]).filter(
      (row) => !(row[0] === 'PM-7002' && row[2] === c),
    );
    const r = await review(two({ register: [...rows, ...FLEET] }));
    assert.deepEqual(assetOf(r, 'PM-7002').codes, ['COMPONENT_MISSING'], c);
    assert.equal(assetOf(r, 'PM-7002').amounts[c as 'cost'], null);
    for (const acct of ['2110', '2119', '2118'])
      assert.deepEqual(accounts(r)[acct], ['held', ['COMPONENT_MISSING']]);
    assert.deepEqual(accounts(r)['2129'], ['consistent', []]);
  }
  const zero = await review(two());
  assert.equal(assetOf(zero, 'PM-7001').amounts.impairment, 0);
});

void test('assets: repeated components, amounts that do not read, the carrying equation, references and words', async () => {
  const cases: [Rows, string[]][] = [
    [
      [['PM-7001', 'LINE-A', 'depreciation', '1800.100', 'VR-PM']],
      ['COMPONENT_REPEATED'],
    ],
    [
      [['PM-7001', 'LINE-A', 'carrying', '1.000', 'VR-PM']],
      ['COMPONENT_REPEATED'],
    ],
  ];
  for (const [rows, codes] of cases) {
    const r = await review(
      two({
        register: [
          ...section('S-SIT-PM', 'Sitra plant', PM, [P1], { rows }),
          ...FLEET,
        ],
      }),
    );
    assert.deepEqual(assetOf(r, 'PM-7001').codes, codes);
    assert.equal(assetOf(r, 'PM-7001').rows[rows[0][2] as 'cost'].length, 2);
  }
  const withAmount = (text: string) =>
    section('S-SIT-PM', 'Sitra plant', PM, [], {
      rows: assetRows(P1, [...FA_SECTIONS_COLUMNS], { depreciation: text }),
    });
  for (const text of [
    '',
    '-0.000',
    '+1.000',
    '1e3',
    '1,800.100',
    '1800.1000',
    '1800.100 ',
    '\u0661.000',
    '1800\u00a0',
    '.5',
    '1.',
  ])
    assert.deepEqual(
      assetOf(
        await review(two({ register: [...withAmount(text), ...FLEET] })),
        'PM-7001',
      ).codes,
      ['AMOUNT'],
      text,
    );
  for (const text of ['100000000000.001', '100000000000.0010'])
    assert.deepEqual(
      assetOf(
        await review(two({ register: [...withAmount(text), ...FLEET] })),
        'PM-7001',
      ).codes,
      ['AMOUNT'],
      text,
    );
  for (const text of ['0001800.100', '1800.1'])
    assert.deepEqual(
      assetOf(
        await review(two({ register: [...withAmount(text), ...FLEET] })),
        'PM-7001',
      ).codes,
      [],
      text,
    );
  const carrying = (change: Record<string, string>) =>
    section('S-SIT-PM', 'Sitra plant', PM, [], {
      rows: assetRows(P1, [...FA_SECTIONS_COLUMNS], change),
    });
  for (const change of [
    { carrying: '2700.151' },
    { impairment: '4500.250', carrying: '0.000' },
  ] as Record<string, string>[])
    assert.deepEqual(
      assetOf(
        await review(two({ register: [...carrying(change), ...FLEET] })),
        'PM-7001',
      ).codes,
      ['CARRYING'],
    );
  const vr = (rows: Rows) =>
    section('S-SIT-PM', 'Sitra plant', PM, [], { rows });
  const p1 = assetRows(P1, [...FA_SECTIONS_COLUMNS]);
  const other = p1.map((row, i) =>
    i === 3 ? [...row.slice(0, 4), 'VR-OTHER'] : row,
  );
  const r = await review(two({ register: [...vr(other), ...FLEET] }));
  assert.deepEqual(assetOf(r, 'PM-7001').codes, ['VALUATION']);
  assert.equal(assetOf(r, 'PM-7001').valuation, null);
  const spaced = p1.map((row, i) =>
    i === 3 ? [...row.slice(0, 4), 'VR-PM '] : row,
  );
  const t = await review(two({ register: [...vr(spaced), ...FLEET] }));
  assert.deepEqual(assetOf(t, 'PM-7001').codes, ['TEXT']);
  assert.equal(assetOf(t, 'PM-7001').valuation, 'VR-PM');
  for (const word of ['Cost', 'cost ', 'accumulated depreciation', '']) {
    const rows = p1.map((row, i) =>
      i === 0 ? [row[0], row[1], word, row[3], row[4]] : row,
    );
    const w = await review(two({ register: [...vr(rows), ...FLEET] }));
    assert.deepEqual(
      assetOf(w, 'PM-7001').codes,
      ['COMPONENT', 'COMPONENT_MISSING'],
      word,
    );
    assert.deepEqual(assetOf(w, 'PM-7001').unread, [9]);
  }
  const noted = p1.map((row, i) =>
    i === 1 ? [...row, '', 'checked'] : i === 2 ? [...row, '', ''] : row,
  );
  assert.deepEqual(
    assetOf(
      await review(two({ register: [...vr(noted), ...FLEET] })),
      'PM-7001',
    ).codes,
    ['CELLS'],
  );
});

void test('assets: identity as written, unplaced rows, and an asset ID in two sections', async () => {
  const id = (aid: string, dims: string): Asset => [aid, dims, 1000, 0, 0];
  const r = await review(
    two({
      register: [
        ...section('S-SIT-PM', 'Sitra plant', PM, [
          P1,
          id('001', 'D'),
          id('1', 'D'),
          id('PM-7001', 'LINE-A2'),
        ]),
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(
    r.assets
      .filter((a) => a.section === 'S-SIT-PM')
      .map((a) => [a.assetId, a.dimensions, a.status]),
    [
      ['001', 'D', 'read'],
      ['1', 'D', 'read'],
      ['PM-7001', 'LINE-A', 'read'],
      ['PM-7001', 'LINE-A2', 'read'],
    ],
  );
  assert.equal(r.assets.filter((a) => a.section === 'S-SIT-PM').length, 4);
  for (const aid of ['PM\u200f7009', 'x'.repeat(501)]) {
    const r = await review(
      two({
        register: [
          ...section('S-SIT-PM', 'Sitra plant', PM, [P1], {
            rows: [[aid, 'X', 'cost', '1.000', 'VR']],
          }),
          ...FLEET,
        ],
      }),
    );
    assert.deepEqual(
      sections(r)[0].slice(1),
      ['held', ['ROW_UNPLACED']],
      aid.slice(0, 9),
    );
  }
  const longest = await review(
    two({
      register: [
        ...section('S-SIT-PM', 'Sitra plant', PM, [
          P1,
          ['x'.repeat(500), 'D', 1000, 0, 0],
        ]),
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(sections(longest)[0].slice(1), ['read', []]);
  const bad = await review(
    two({
      register: [
        ...section('S-SIT-PM', 'Sitra plant', PM, [P1], {
          rows: [
            ['=PM-7009', 'X', 'cost', '1.000', 'VR'],
            ['PM-7010', ' X', 'cost', '1.000', 'VR'],
          ],
        }),
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(bad.unplaced, [
    ['register-sections', 13, 'ROW_UNPLACED'],
    ['register-sections', 14, 'ROW_UNPLACED'],
  ]);
  assert.deepEqual(sections(bad)[0].slice(1), ['held', ['ROW_UNPLACED']]);
  assert.equal(bad.assets.filter((a) => a.section === 'S-SIT-PM').length, 1);
  assert.deepEqual(accounts(bad)['2118'], ['held', ['ROW_UNPLACED']]);
  const twice = await review(
    two({
      register: [
        ...PLANT,
        ...section('S-MAN-MV', 'Manama office', MV, [
          M1,
          ['PM-7002', 'OTHER', 5, 0, 0],
        ]),
      ],
    }),
  );
  assert.deepEqual(assetOf(twice, 'PM-7002', 'S-SIT-PM').codes, [
    'ID_SECTIONS',
  ]);
  assert.deepEqual(assetOf(twice, 'PM-7002', 'S-MAN-MV').codes, [
    'ID_SECTIONS',
  ]);
  assert.deepEqual(assetOf(twice, 'PM-7001').codes, []);
  for (const acct of ['2110', '2119', '2118', '2120', '2129', '2128'])
    assert.deepEqual(accounts(twice)[acct], ['held', ['ID_SECTIONS']]);
  const excluded = await review(
    two({
      register: [
        ...PLANT,
        ...section('S-OLD', 'Sitra plant', PM, [P1], {
          labels: { 'As of': '2027-06-30' },
        }),
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(assetOf(excluded, 'PM-7001').codes, []);
  assert.deepEqual(accounts(excluded)['2110'], ['consistent', []]);
});

void test('section totals: agree, one minor unit out, unreadable, uncheckable', async () => {
  const total = (c: string, v: string) => ['Section total', c, v];
  const withTotals = (totals: Rows, rows: Rows = []) =>
    review(
      two({
        register: [
          ...section('S-SIT-PM', 'Sitra plant', PM, [P1, P2], { totals, rows }),
          ...FLEET,
        ],
      }),
    );
  const agree = await withTotals([
    total('cost', '5700.250'),
    total('depreciation', '2760.100'),
    total('impairment', '60.000'),
    total('carrying', '2880.150'),
  ]);
  assert.deepEqual(sections(agree)[0].slice(1), ['read', []]);
  for (const t of [total('cost', '5700.251'), total('carrying', '2880.149')]) {
    const r = await withTotals([t]);
    assert.deepEqual(
      sections(r)[0].slice(1),
      ['held', ['TOTAL_MISMATCH']],
      t[1],
    );
    assert.deepEqual(accounts(r)['2118'], ['held', ['TOTAL_MISMATCH']]);
    assert.deepEqual(accounts(r)['2120'], ['consistent', []]);
  }
  for (const totals of [
    [[...total('cost', '5700.250'), 'x']],
    [total('Cost', '5700.250')],
    [total('cost', '5,700.250')],
    [total('cost', '5700.250'), total('cost', '5700.250')],
  ])
    assert.deepEqual(
      sections(await withTotals(totals))[0].slice(1),
      ['held', ['TOTAL_FIELD']],
      JSON.stringify(totals),
    );
  assert.deepEqual(
    sections(
      await withTotals(
        [total('cost', '5700.250')],
        [['PM-9', 'X', 'Cost', '1.000', 'VR']],
      ),
    )[0].slice(1),
    ['held', ['TOTAL_FIELD']],
  );
  assert.deepEqual(
    sections(
      await withTotals(
        [total('cost', '5700.250')],
        [['PM-9', 'X', 'cost', 'x', 'VR']],
      ),
    )[0].slice(1),
    ['held', ['TOTAL_FIELD']],
  );
  const other = await withTotals(
    [total('depreciation', '2760.100')],
    [['PM-9', 'X', 'cost', 'x', 'VR']],
  );
  assert.deepEqual(sections(other)[0].slice(1), ['read', []]);
  const counted = await withTotals(
    [total('cost', '5701.250')],
    [['=PM-9', 'X', 'cost', '1.000', 'VR']],
  );
  assert.deepEqual(sections(counted)[0].slice(1), ['held', ['ROW_UNPLACED']]);
});

void test('the map: validity inclusive, expired, failing rows, another class, repeated and absent pairs', async () => {
  const withMap = (
    change: (rows: Rows) => Rows,
    gl = glRows({ [PM]: [P1, P2], [MV]: [M1] }),
  ) => review(two({ map: change(mapRows([PM, MV])), gl }));
  const set = (k: number, i: number, v: string) => (rows: Rows) =>
    rows.map((r, j) => (j === k ? r.map((x, n) => (n === i ? v : x)) : r));
  for (const [i, v] of [
    [5, '2028-06-30'],
    [6, '2028-06-30'],
  ] as [number, string][])
    assert.deepEqual(accounts(await withMap(set(1, i, v)))['2110'], [
      'consistent',
      [],
    ]);
  const expired = await withMap(set(2, 6, '2028-06-29'));
  assert.deepEqual(expired.unmapped, [[PM, 'depreciation', 'MAP_EXPIRED']]);
  assert.deepEqual(accounts(expired)['2119'], ['held', ['MAP_EXPIRED']]);
  assert.deepEqual(accounts(expired)['2129'], ['held', ['MAP_EXPIRED']]);
  assert.deepEqual(accounts(expired)['2110'], ['consistent', []]);
  for (const change of [
    (rows: Rows) => set(3, 6, '2028-12-31')(set(3, 5, '2029-01-01')(rows)),
    set(3, 5, '2028-02-30'),
    set(3, 2, '=2118'),
    set(3, 3, ''),
    (rows: Rows) => rows.map((r, j) => (j === 3 ? [...r, 'note'] : r)),
  ]) {
    const r = await withMap(change);
    assert.deepEqual(r.unmapped, [[PM, 'impairment', 'MAP_ROW']]);
    assert.deepEqual(accounts(r)['2128'], ['held', ['MAP_ROW']]);
  }
  const cls = await withMap(set(1, 4, 'accumulated-depreciation'));
  assert.deepEqual(cls.unmapped, [[PM, 'cost', 'MAP_CLASS']]);
  const twice = await withMap((rows) => [
    ...rows,
    [PM, 'cost', '2111', DIMS, CLASS.cost, '2028-01-01', '9999-12-31'],
  ]);
  assert.deepEqual(twice.unmapped, [[PM, 'cost', 'MAP_REPEATED']]);
  const absent = await withMap((rows) =>
    rows.filter((r) => !(r[0] === MV && r[1] === 'impairment')),
  );
  assert.deepEqual(absent.unmapped, [[MV, 'impairment', 'MAP_ABSENT']]);
  assert.deepEqual(accounts(absent)['2118'], ['held', ['MAP_ABSENT']]);
  assert.deepEqual(accounts(absent)['2128'], ['held', ['MAP_ABSENT']]);
  const elsewhere = await withMap((rows) => [
    ...rows,
    [CH, 'cost', '2130', DIMS, CLASS.cost, '2020-01-01', '2021-12-31'],
  ]);
  assert.deepEqual(elsewhere.unmapped, []);
  assert.deepEqual(accounts(elsewhere)['2110'], ['consistent', []]);
  const history = await withMap((rows) => [
    ...rows,
    [PM, 'cost', '2190', DIMS, CLASS.cost, '2015-01-01', '2019-12-31'],
  ]);
  assert.deepEqual(accounts(history)['2110'], ['consistent', []]);
  const unmappedGL = await withMap(set(1, 6, '2028-06-29'), [
    ...glRows({ [PM]: [P1, P2], [MV]: [M1] }),
    glRow('2199', 'cost', 7),
  ]);
  assert.deepEqual(accounts(unmappedGL)['2199'], ['held', ['MAP_EXPIRED']]);
  for (const row of [
    ['=PM', 'cost', '1', DIMS, CLASS.cost, '2020-01-01', '9999-12-31'],
    [PM, 'carrying', '1', DIMS, CLASS.cost, '2020-01-01', '9999-12-31'],
    [PM, 'Cost', '1', DIMS, CLASS.cost, '2020-01-01', '9999-12-31'],
  ]) {
    const r = await withMap((rows) => [...rows, row]);
    assert.deepEqual(r.run, ['MAP_UNREADABLE']);
    assert.deepEqual(r.unplaced, [['category-map', 8, 'MAP_UNREADABLE']]);
  }
  const blankRows = await withMap((rows) => [...rows, [], ['', '']]);
  assert.deepEqual(blankRows.inventory.map, { header: 1, blank: 2, row: 6 });
});

void test('GL rows: failing fields, another scope, repeated, unreadable, signs and classes', async () => {
  const withGL = (change: (rows: Rows) => Rows, map = mapRows([PM, MV])) =>
    review(two({ gl: change(glRows({ [PM]: [P1, P2], [MV]: [M1] })), map }));
  for (const [k, v] of [
    [2, 'other'],
    [3, ''],
    [4, '1.0001'],
    [9, 'note'],
  ] as [number, string][]) {
    const r = await withGL((rows) =>
      rows.map((row, j) =>
        j === 1
          ? k === 9
            ? [...row, v]
            : row.map((x, n) => (n === k ? v : x))
          : row,
      ),
    );
    assert.deepEqual(accounts(r)['2110'], ['held', ['GL_ROW']], String(k));
  }
  for (const k of [5, 6, 7, 8]) {
    const r = await withGL((rows) =>
      rows.map((row, j) =>
        j === 1 ? row.map((x, n) => (n === k ? 'X' : x)) : row,
      ),
    );
    assert.deepEqual(accounts(r)['2110'], ['held', ['GL_SCOPE']], String(k));
  }
  const repeated = await withGL((rows) => [...rows, rows[1]]);
  assert.deepEqual(accounts(repeated)['2110'], ['held', ['GL_REPEATED']]);
  const unreadable = await withGL((rows) => [
    ...rows,
    [
      '',
      DIMS,
      CLASS.cost,
      '1.000',
      '0.000',
      SCOPE.entity,
      SCOPE.glLedger,
      'BHD',
      SCOPE.asOf,
    ],
  ]);
  assert.deepEqual(unreadable.run, ['GL_UNREADABLE']);
  assert.deepEqual(unreadable.unplaced, [['gl-balances', 8, 'GL_UNREADABLE']]);
  const signs = await withGL((rows) =>
    rows.map((row) =>
      row[0] === '2110'
        ? glRow('2110', 'cost', -500)
        : row[0] === '2119'
          ? glRow('2119', 'depreciation', -700)
          : row,
    ),
  );
  assert.equal(account(signs, '2110').gl, -500);
  assert.equal(account(signs, '2110').difference, 5700750);
  assert.equal(account(signs, '2119').gl, -700);
  const conflict = await withGL((rows) =>
    rows.map((row) =>
      row[0] === '2119'
        ? row.map((x, n) => (n === 2 ? CLASS.impairment : x))
        : row,
    ),
  );
  assert.deepEqual(accounts(conflict)['2119'], ['held', ['CLASS_CONFLICT']]);
  const unmapped = await withGL((rows) => [
    ...rows,
    glRow('2198', 'impairment', 4),
  ]);
  assert.deepEqual(accounts(unmapped)['2198'], ['missing', ['UNMAPPED']]);
  assert.equal(account(unmapped, '2198').component, 'impairment');
  assert.equal(account(unmapped, '2198').gl, 4);
  assert.equal(account(unmapped, '2198').register, null);
  const both = await withGL(
    (rows) => rows,
    [
      ...mapRows([PM, MV], [], [`${MV}|impairment`]),
      [
        MV,
        'impairment',
        '2129',
        DIMS,
        CLASS.impairment,
        '2020-01-01',
        '9999-12-31',
      ],
    ],
  );
  assert.deepEqual(accounts(both)['2129'], ['held', ['ACCOUNT_COMPONENTS']]);
  assert.equal(account(both, '2129').component, null);
  assert.deepEqual(accounts(both)['2128'], ['missing', ['UNMAPPED']]);
});

void test('accounts: members of two categories, held amounts, missing accounts at zero, differences of their own', async () => {
  const shared = await review(
    two({
      map: [
        ...mapRows([PM, MV], [], [`${MV}|impairment`]),
        [
          MV,
          'impairment',
          '2118',
          DIMS,
          CLASS.impairment,
          '2020-01-01',
          '9999-12-31',
        ],
      ],
      gl: glRows({ [PM]: [P1, P2], [MV]: [M1] }, {}, ['2118', '2128']).concat([
        glRow('2118', 'impairment', 60000),
      ]),
    }),
  );
  assert.deepEqual(
    account(shared, '2118').members.map((m) => m[1]),
    ['MV-3001', 'PM-7001', 'PM-7002'],
  );
  assert.equal(account(shared, '2118').register, 60000);
  assert.equal(accounts(shared)['2128'], undefined);
  const held = await review(
    two({
      gl: glRows({ [PM]: [P1, P2], [MV]: [M1] }).map((r, j) =>
        j === 1 ? r.map((x, n) => (n === 7 ? 'SAR' : x)) : r,
      ),
    }),
  );
  const a = account(held, '2110');
  assert.deepEqual([a.register, a.gl, a.difference], [null, null, null]);
  assert.equal(a.members.length, 2);
  const missing = await review(
    two({
      map: mapRows([PM, MV, CH]),
      gl: [
        ...glRows({ [PM]: [P1, P2], [MV]: [M1] }, {}, ['2119']),
        glRow('2130', 'cost', 0),
      ],
    }),
  );
  assert.deepEqual(accounts(missing)['2130'], ['missing', ['REGISTER_ABSENT']]);
  assert.equal(account(missing, '2130').gl, 0);
  assert.deepEqual(accounts(missing)['2139'], [
    'missing',
    ['GL_ABSENT', 'REGISTER_ABSENT'],
  ]);
  assert.deepEqual(accounts(missing)['2119'], ['missing', ['GL_ABSENT']]);
  assert.equal(account(missing, '2119').register, 2760100);
  const offset = await review(
    two({
      gl: glRows({ [PM]: [P1, P2], [MV]: [M1] }, { '2110': 250, '2120': -250 }),
    }),
  );
  assert.deepEqual(
    [account(offset, '2110').difference, account(offset, '2120').difference],
    [-250, 250],
  );
  assert.deepEqual(
    [
      accounts(offset)['2110'][0],
      accounts(offset)['2120'][0],
      accounts(offset)['2119'][0],
    ],
    ['difference', 'difference', 'consistent'],
  );
  const swapped = await review(
    two({
      register: [
        ...section('S-SIT-PM', 'Sitra plant', PM, [
          P1,
          [P2[0], P2[1], P2[2], P2[4], P2[3]],
        ]),
        ...FLEET,
      ],
    }),
  );
  assert.deepEqual(
    [accounts(swapped)['2119'][0], accounts(swapped)['2118'][0]],
    ['difference', 'difference'],
  );
  assert.equal(account(swapped, '2119').difference, -900000);
  assert.equal(account(swapped, '2118').difference, 900000);
});

void test('a held asset holds every account of its category and no other', async () => {
  const r = await review(
    two({
      register: [
        ...section('S-SIT-PM', 'Sitra plant', PM, [P1], {
          rows: [['PM-7001', 'LINE-A', 'impairment', '0.000', 'VR-PM']],
        }),
        ...FLEET,
      ],
    }),
  );
  for (const acct of ['2110', '2119', '2118'])
    assert.deepEqual(accounts(r)[acct], ['held', ['COMPONENT_REPEATED']]);
  for (const acct of ['2120', '2129', '2128'])
    assert.deepEqual(accounts(r)[acct], ['consistent', []]);
});

void test('sums beyond exact integers are refused', async () => {
  const big = (n: number): Given => {
    const assets: Asset[] = Array.from({ length: n }, (_, i) => [
      `B${i}`,
      'D',
      1e14,
      0,
      0,
    ]);
    return {
      register: section('S1', 'Sitra plant', PM, assets),
      map: mapRows([PM]),
      gl: [
        [...FA_SECTIONS_GL_HEADER],
        glRow('2110', 'cost', 0),
        glRow('2119', 'depreciation', 0),
        glRow('2118', 'impairment', 0),
      ],
    };
  };
  assert.equal(account(await review(big(90)), '2110').register, 90e14);
  assert.equal(await refusal(big(91)), 'TOTAL_LIMIT');
  const totals = section(
    'S1',
    'Sitra plant',
    PM,
    Array.from({ length: 91 }, (_, i) => [`B${i}`, 'D', 1e14, 0, 0] as Asset),
    { totals: [['Section total', 'cost', '1.000']] },
  );
  assert.equal(
    await refusal({
      register: totals,
      map: mapRows([PM]),
      gl: [[...FA_SECTIONS_GL_HEADER]],
    }),
    'TOTAL_LIMIT',
  );
});
