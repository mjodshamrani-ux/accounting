import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINH_ROLES,
  FINH_VERSION,
  reconcileFinancialHierarchy,
  type FinHInput,
  type FinHResult,
} from '../lib/reconciliation/tb-financial-hierarchy.ts';
import { replayFinancialHierarchy } from '../lib/reconciliation/tb-financial-hierarchy-io.ts';
import { createHash } from 'node:crypto';

// A synthetic clinic, unlike FIN-1A's story and the H1 holdout: two levels
// of parents over current assets, a contra asset, one leaf fed by two
// dimensions of one account, an explicit zero, a noncurrent asset, a
// liability and equity.
const SCOPE = {
  Entity: 'SYN-SHIFA-CLINIC',
  Ledger: 'UNIT-TEST',
  Currency: 'QAR',
  'Currency basis': 'functional',
  'Posting status': 'posted',
  'Posting layer': 'actual',
  'Period start': '2028-01-01',
  'Period end': '2028-03-31',
  'As of': '2028-03-31',
  'Chart version': 'CLN-1',
  'Map version': 'CLN-MAP-2',
  'Closing basis': 'post-closing',
};
type Table = Record<string, string>[];
type Book = Record<(typeof FINH_ROLES)[number], Table>;
const ACCOUNTS: [string, string, string, number, string][] = [
  // account, dimensions, class, net in minor units, leaf
  ['C-10', 'ward=A', 'current-asset', 40000, 'MED-CASH'],
  ['C-10', 'ward=B', 'current-asset', 25050, 'MED-CASH'],
  ['C-20', 'ward=A', 'current-asset', 30000, 'PATIENTS'],
  ['C-29', 'ward=A', 'current-asset', -5000, 'DOUBTFUL'],
  ['C-30', 'ward=A', 'current-asset', 0, 'SUPPLIES'],
  ['N-50', 'ward=A', 'noncurrent-asset', 120000, 'SCANNER'],
  ['L-70', 'ward=A', 'current-liability', -60050, 'PAYABLES'],
  ['E-90', 'ward=A', 'equity', -150000, 'FUND'],
];
const NODES: [string, string, string, string, string][] = [
  ['T', '', 'title', 'Clinic position', ''],
  ['CUR', '', 'parent', 'Current assets', 'current-asset'],
  ['MED', 'CUR', 'parent', 'Medical cash', 'current-asset'],
  ['MED-CASH', 'MED', 'leaf', 'Cash at wards', 'current-asset'],
  ['RECV', 'CUR', 'parent', 'Receivables', 'current-asset'],
  ['PATIENTS', 'RECV', 'leaf', 'Patients', 'current-asset'],
  ['DOUBTFUL', 'RECV', 'leaf', 'Doubtful, contra', 'current-asset'],
  ['SUPPLIES', 'CUR', 'leaf', 'Supplies, zero', 'current-asset'],
  ['SCANNER', '', 'leaf', 'Scanner', 'noncurrent-asset'],
  ['PAYABLES', '', 'leaf', 'Payables', 'current-liability'],
  ['FUND', '', 'leaf', 'Fund', 'equity'],
];
const money = (minor: number) =>
  `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;
const policy = (cls: string) =>
  cls.endsWith('asset') ? 'debit-positive' : 'credit-positive';

function book(): Book {
  const contribution: Record<string, number> = {};
  for (const [, , cls, net, leaf] of ACCOUNTS)
    contribution[leaf] =
      (contribution[leaf] ?? 0) +
      (policy(cls) === 'debit-positive' ? net : -net);
  const amount = (id: string): number => {
    const node = NODES.find((n) => n[0] === id)!;
    return node[2] === 'leaf'
      ? (contribution[id] ?? 0)
      : NODES.filter((n) => n[1] === id).reduce((a, n) => a + amount(n[0]), 0);
  };
  const label = (id: string) => NODES.find((n) => n[0] === id)![3];
  return {
    'trial-balance': ACCOUNTS.map(([a, d, cls, net]) => ({
      'Account ID': a,
      'Complete dimensions': d,
      'Account label': `Account ${a}`,
      'Account class': cls,
      Debit: money(Math.max(net, 0)),
      Credit: money(Math.max(-net, 0)),
      ...SCOPE,
    })),
    'proposed-mapping': ACCOUNTS.map(([a, d, cls, , leaf], i) => ({
      'Mapping ID': `MP${i + 1}`,
      'Account ID': a,
      'Complete dimensions': d,
      'Line ID': leaf,
      Sign: policy(cls),
      'Evidence ID': `EV${i + 1}`,
      ...SCOPE,
    })),
    'presentation-evidence': ACCOUNTS.map(([a, d, cls, , leaf], i) => ({
      'Evidence ID': `EV${i + 1}`,
      'Account ID': a,
      'Complete dimensions': d,
      'Account class': cls,
      'Line ID': leaf,
      'Line label': label(leaf),
      'Line class': cls,
      Sign: policy(cls),
      'Valid from': '2028-01-01',
      'Valid to': '2028-12-31',
      'Evidence reference': `PACK-${i + 1}`,
      ...SCOPE,
    })),
    'financial-position': NODES.map(([id, parent, kind, lab, cls]) => ({
      'Node ID': id,
      'Parent ID': parent,
      Kind: kind,
      'Line label': lab,
      'Line class': cls,
      Amount: kind === 'title' ? '' : money(amount(id)),
      ...SCOPE,
    })),
  };
}
const cell = (v: string) =>
  /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
const csv = (t: Table, columns = t.length ? Object.keys(t[0]) : []) =>
  [columns, ...t.map((r) => columns.map((c) => r[c] ?? ''))]
    .map((r) => r.map(cell).join(','))
    .join('\n') + '\n';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

type Edit = (b: Book) => void;
type Raw = Partial<
  Record<(typeof FINH_ROLES)[number], (s: string) => string | Uint8Array>
>;
type Order = Partial<
  Record<(typeof FINH_ROLES)[number], (columns: string[]) => string[]>
>;
function input(
  edit?: Edit,
  raw: Raw = {},
  scope: Record<string, string> = SCOPE,
  order: Order = {},
): FinHInput {
  const b = book();
  edit?.(b);
  const files = FINH_ROLES.map((role) => {
    const columns = b[role].length ? Object.keys(b[role][0]) : [];
    const text = csv(b[role], order[role]?.(columns) ?? columns);
    const out = raw[role]?.(text) ?? text;
    const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
    return { name: `${role}.csv`, sha256: sha(bytes), bytes };
  });
  return {
    files: files as FinHInput['files'],
    readings: FINH_ROLES.map((role) => ({
      role,
      family: FINH_VERSION,
      confirmed: true,
    })) as FinHInput['readings'],
    scope: {
      confirmed: true,
      fields: { ...scope } as FinHInput['scope']['fields'],
    },
  };
}
function judge(edit?: Edit, raw?: Raw, order?: Order): FinHResult {
  try {
    return reconcileFinancialHierarchy(input(edit, raw, SCOPE, order));
  } catch (error) {
    assert.fail(`the engine stopped: ${String(error)}`);
  }
}
const codes = (r: FinHResult) =>
  [...new Set(r.issues.map((i) => i.code))].sort();
const at = (r: FinHResult, code: string) =>
  r.issues
    .filter((i) => i.code === code)
    .map((i) => [i.source, i.row, i.field]);
const row = (b: Book, role: keyof Book, field: string, value: string) => {
  const hits = b[role].filter((r) => r[field] === value);
  assert.equal(hits.length, 1, `${role} ${field}=${value}`);
  return hits[0];
};
const node = (b: Book, id: string) =>
  row(b, 'financial-position', 'Node ID', id);

void test('the clinic is eligible, with facts from the leaves only and members by account and dimensions', () => {
  const r = judge();
  assert.equal(r.status, 'eligible');
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.facts, {
    debitMinor: 215050,
    creditMinor: 215050,
    leafMinor: {
      'MED-CASH': 65050,
      PATIENTS: 30000,
      DOUBTFUL: -5000,
      SUPPLIES: 0,
      SCANNER: 120000,
      PAYABLES: 60050,
      FUND: 150000,
    },
    parentMinor: { CUR: 90050, MED: 65050, RECV: 25000 },
    members: {
      'MED-CASH': ['C-10|ward=A', 'C-10|ward=B'],
      PATIENTS: ['C-20|ward=A'],
      DOUBTFUL: ['C-29|ward=A'],
      SUPPLIES: ['C-30|ward=A'],
      SCANNER: ['N-50|ward=A'],
      PAYABLES: ['L-70|ward=A'],
      FUND: ['E-90|ward=A'],
    },
    categoryMinor: {
      'current-asset': 90050,
      'noncurrent-asset': 120000,
      'current-liability': 60050,
      'noncurrent-liability': 0,
      equity: 150000,
    },
    equationMinor: 0,
  });
  assert.deepEqual(r.ownership, {
    CUR: '',
    MED: 'CUR',
    'MED-CASH': 'MED',
    RECV: 'CUR',
    PATIENTS: 'RECV',
    DOUBTFUL: 'RECV',
    SUPPLIES: 'CUR',
    SCANNER: '',
    PAYABLES: '',
    FUND: '',
  });
  const med = r.lines.find((l) => l.id === 'MED-CASH')!;
  assert.deepEqual(
    med.members.map((m) => [
      m.account,
      m.dimensions,
      m.tbRow,
      m.evidenceRow,
      m.contribution,
    ]),
    [
      ['C-10', 'ward=A', 2, 2, 40000],
      ['C-10', 'ward=B', 3, 3, 25050],
    ],
  );
  assert.deepEqual(
    r.controls.map((c) => [c.id, c.supplied, c.childTotal, c.difference]),
    [
      ['CUR', 90050, 90050, 0],
      ['MED', 65050, 65050, 0],
      ['RECV', 25000, 25000, 0],
    ],
  );
  assert.deepEqual(r.equation, { reported: 0, calculated: 0 });
  assert.equal(r.nodes.find((n) => n.id === 'MED-CASH')!.depth, 3);
  assert.equal(r.inventory.length, 8 + 8 + 8 + 11);
});

void test('row order, column order and line ends do not change a fact; positions follow the rows', () => {
  const first = judge();
  const r = judge(
    (b) => {
      for (const role of FINH_ROLES) b[role].reverse();
    },
    {
      'presentation-evidence': (s) => s.replaceAll('\n', '\r\n'),
      'financial-position': (s) => s.replaceAll('\n', '\r'),
    },
    {
      'presentation-evidence': (columns) => [...columns].reverse(),
      'trial-balance': (columns) => [
        ...columns.slice(6),
        ...columns.slice(0, 6),
      ],
    },
  );
  assert.equal(r.status, 'eligible');
  assert.deepEqual(r.facts, first.facts);
  assert.deepEqual(r.ownership, first.ownership);
  assert.equal(r.lines.find((l) => l.id === 'FUND')!.row, 2);
});

void test('a parent amount is a control, never a second contribution', () => {
  const r = judge();
  assert.equal(r.facts!.categoryMinor['current-asset'], 90050);
  const doubled = judge((b) => {
    node(b, 'MED')['Amount'] = '1301.00';
  });
  assert.deepEqual(codes(doubled), ['CONTROL_TOTAL']);
  // MED's own control, and CUR's above it, which counts MED's amount.
  assert.deepEqual(at(doubled, 'CONTROL_TOTAL'), [
    [3, 3, 'Amount'],
    [3, 4, 'Amount'],
  ]);
});

void test('a byte-order mark, a blank line and an unreadable file stay what the contract says', () => {
  const bom = judge(undefined, { 'financial-position': (s) => '\uFEFF' + s });
  assert.deepEqual(codes(bom), ['HEADERS']);
  // A writer that quotes every field puts the mark before the first quote.
  const quotedBom = judge(undefined, {
    'financial-position': (s) => '\uFEFF"Node ID"' + s.slice('Node ID'.length),
  });
  assert.deepEqual(at(quotedBom, 'HEADERS'), [[3, 1, null]]);
  assert.deepEqual(codes(quotedBom), ['HEADERS']);
  assert.equal(bom.sources[3].readable, false);
  assert.deepEqual(bom.lines, []);
  assert.deepEqual(
    codes(judge(undefined, { 'trial-balance': (s) => s + '\n' })),
    ['WIDTH'],
  );
  assert.deepEqual(
    codes(
      judge(undefined, {
        'proposed-mapping': () => new Uint8Array([0x4d, 0xff, 0x0a]),
      }),
    ),
    ['CSV'],
  );
  assert.deepEqual(
    codes(
      judge(undefined, {
        'proposed-mapping': (s) => s.replace('\nMP1,', '\nM"P1,'),
      }),
    ),
    ['CSV'],
  );
  assert.deepEqual(
    codes(
      judge(undefined, {
        'proposed-mapping': (s) => s.replace('MP1,', '"MP"1,'),
      }),
    ),
    ['CSV'],
  );
  assert.deepEqual(codes(judge(undefined, { 'trial-balance': () => '' })), [
    'HEADERS',
  ]);
  // A broken quote in the header is a broken file, not a wrong header.
  const head = judge(undefined, {
    'trial-balance': (s) => s.replace('Account ID,', '"Account" ID,'),
  });
  assert.deepEqual(at(head, 'CSV'), [[0, 1, null]]);
  assert.deepEqual(codes(head), ['CSV']);
  assert.deepEqual(
    at(
      judge(undefined, {
        'proposed-mapping': (s) => s.replace('\nMP3,', '\n"MP"3,'),
      }),
      'CSV',
    ),
    [[1, 4, null]],
  );
  const short = judge(undefined, {
    'trial-balance': (s) => s + 'C-99,ward=A\n',
  });
  assert.deepEqual(codes(short), ['WIDTH']);
  assert.deepEqual(
    short.inventory.find((i) => i.source === 0 && i.row === 10)?.raw,
    ['C-99', 'ward=A'],
  );
});

void test('headers: an extra, missing or repeated column refuses the source', () => {
  const extra = judge(undefined, {
    'proposed-mapping': (s) =>
      s
        .split('\n')
        .map((l, i) => (l ? `${l},${i ? 'note' : 'Reviewer note'}` : l))
        .join('\n'),
  });
  assert.deepEqual(codes(extra), ['HEADERS']);
  assert.deepEqual(at(extra, 'HEADERS'), [[1, 1, null]]);
  const missing = judge((b) => {
    for (const r of b['trial-balance']) delete r['Account label'];
  });
  assert.deepEqual(codes(missing), ['HEADERS']);
  const repeated = judge(undefined, {
    'trial-balance': (s) => s.replace('Account label,', 'Account ID,'),
  });
  assert.deepEqual(codes(repeated), ['HEADERS']);
});

void test('limits: 200 records, 2000 characters a field, 131072 bytes a source', () => {
  const pad =
    (n: number, label = 'x') =>
    (b: Book) => {
      const tb = b['trial-balance'];
      const base = tb[4];
      while (tb.length < n)
        tb.push({
          ...base,
          'Account ID': `Z-${tb.length}`,
          'Account label': label,
        });
    };
  const at200 = judge((b) => {
    pad(200)(b);
    for (const r of b['trial-balance'].slice(8)) {
      b['proposed-mapping'].push({
        ...b['proposed-mapping'][4],
        'Mapping ID': `MZ${r['Account ID']}`,
        'Account ID': r['Account ID'],
        'Evidence ID': `EZ${r['Account ID']}`,
      });
      b['presentation-evidence'].push({
        ...b['presentation-evidence'][4],
        'Evidence ID': `EZ${r['Account ID']}`,
        'Account ID': r['Account ID'],
      });
    }
  });
  assert.equal(at200.status, 'eligible');
  assert.deepEqual(codes(judge(pad(201))), ['ROWS']);
  assert.deepEqual(
    codes(
      judge((b) => {
        b['trial-balance'][1]['Account label'] = 'ق'.repeat(2001);
      }),
    ),
    ['TEXT'],
  );
  const sameLength = judge((b) => {
    b['trial-balance'][1]['Account label'] = 'ق'.repeat(2000);
  });
  assert.equal(sameLength.status, 'eligible');
  assert.deepEqual(codes(judge(pad(120, 'y'.repeat(1100)))), ['BYTES']);
});

void test('money: plain decimals with at most two places, blank is not zero, and debit and credit are never negative', () => {
  for (const value of [
    '٤٠٠٫٠٠',
    '0400.00',
    '400.000',
    '',
    '1,400.00',
    '+400.00',
    '4e2',
    ' 400.00',
  ])
    assert.deepEqual(
      at(
        judge((b) => {
          b['trial-balance'][0].Debit = value;
        }),
        'MONEY',
      ),
      [[0, 2, 'Debit']],
      value,
    );
  const negative = judge((b) => {
    const r = b['trial-balance'][3];
    r.Debit = '-50.00';
    r.Credit = '0.00';
  });
  assert.deepEqual(at(negative, 'MONEY'), [[0, 5, 'Debit']]);
  const shortForms = judge((b) => {
    b['trial-balance'][0].Debit = '400';
    b['trial-balance'][1].Debit = '250.5';
    node(b, 'MED-CASH').Amount = '650.5';
    node(b, 'MED').Amount = '650.50';
  });
  assert.equal(shortForms.status, 'eligible');
  assert.deepEqual(
    codes(
      judge((b) => {
        node(b, 'FUND').Amount = '1000000000000.01';
      }),
    ),
    ['MONEY'],
  );
});

void test('the trial balance: both sides on one row, out of balance, unknown class', () => {
  const both = judge((b) => {
    const r = b['trial-balance'][6];
    r.Debit = '10.00';
    r.Credit = '610.50';
  });
  assert.deepEqual(codes(both), ['BOTH_SIDES']);
  assert.deepEqual(both.tb, { debit: 216050, credit: 216050 });
  const out = judge((b) => {
    b['trial-balance'][4].Debit = '0.01';
  });
  assert.deepEqual(codes(out), ['LEAF_TOTAL', 'TB_BALANCE']);
  const rootClass = judge((b) => {
    node(b, 'FUND')['Line class'] = 'reserve';
  });
  assert.ok(
    at(rootClass, 'CLASSIFICATION').some(
      ([s, r, f]) => s === 3 && r === 12 && f === 'Line class',
    ),
  );
  const unknown = judge((b) => {
    b['trial-balance'][5]['Account class'] = 'fixed-asset';
  });
  assert.ok(
    at(unknown, 'CLASSIFICATION').some(
      ([s, r, f]) => s === 0 && r === 7 && f === 'Account class',
    ),
  );
});

void test('duplicates name every contender and decide nothing that rests on them', () => {
  const account = judge((b) => {
    const tb = b['trial-balance'];
    tb[0].Debit = '300.00';
    tb.splice(1, 0, { ...tb[0], Debit: '100.00' });
  });
  assert.deepEqual(codes(account), ['DUPLICATE_ACCOUNT']);
  assert.deepEqual(
    at(account, 'DUPLICATE_ACCOUNT').map(([, r]) => r),
    [2, 3],
  );
  assert.equal(
    account.lines.find((l) => l.id === 'MED-CASH')!.calculated,
    null,
  );
  const twice = judge((b) => {
    const st = b['financial-position'];
    st.push({ ...node(b, 'PATIENTS'), 'Parent ID': 'MED' });
    node(b, 'MED').Amount = '950.50';
    node(b, 'CUR').Amount = '1200.50';
  });
  assert.deepEqual(codes(twice), ['DUPLICATE_NODE']);
  assert.deepEqual(
    at(twice, 'DUPLICATE_NODE').map(([, r]) => r),
    [7, 13],
  );
  assert.equal(twice.facts, null);
  // The second parent leaves the copy out of its amount; no control rests on it.
  const outside = judge((b) => {
    b['financial-position'].push({
      ...node(b, 'PATIENTS'),
      'Parent ID': 'MED',
    });
  });
  assert.deepEqual(codes(outside), ['DUPLICATE_NODE']);
  const mapped = judge((b) => {
    const m = b['proposed-mapping'];
    m.push({ ...m[2], 'Mapping ID': 'MP-AGAIN' });
  });
  assert.deepEqual(codes(mapped), ['DUPLICATE_MAPPING_ACCOUNT']);
  const mapId = judge((b) => {
    b['proposed-mapping'][1]['Mapping ID'] = 'MP1';
  });
  assert.deepEqual(codes(mapId), ['DUPLICATE_MAPPING_ID']);
  const proofId = judge((b) => {
    b['presentation-evidence'][1]['Evidence ID'] = 'EV1';
    b['proposed-mapping'][1]['Evidence ID'] = 'EV1';
  });
  assert.ok(codes(proofId).includes('DUPLICATE_PROOF'));
  const proofAccount = judge((b) => {
    const p = b['presentation-evidence'];
    p.push({ ...p[5], 'Evidence ID': 'EV-OLD', 'Valid to': '2028-02-15' });
  });
  assert.deepEqual(codes(proofAccount), [
    'DUPLICATE_PROOF_ACCOUNT',
    'UNUSED_PROOF',
    'VALIDITY',
  ]);
});

void test('the tree: an absent parent, a leaf or title as parent, a cycle, an empty parent, a title with an amount, an unknown kind', () => {
  assert.deepEqual(
    at(
      judge((b) => {
        node(b, 'SUPPLIES')['Parent ID'] = 'NOWHERE';
      }),
      'PARENT',
    ),
    [[3, 9, 'Parent ID']],
  );
  assert.deepEqual(
    codes(
      judge((b) => {
        node(b, 'SUPPLIES')['Parent ID'] = 'PATIENTS';
        node(b, 'CUR').Amount = '900.50';
      }),
    ),
    ['PARENT'],
  );
  assert.deepEqual(
    codes(
      judge((b) => {
        node(b, 'FUND')['Parent ID'] = 'T';
      }),
    ),
    ['PARENT'],
  );
  const cycle = judge((b) => {
    node(b, 'CUR')['Parent ID'] = 'RECV';
  });
  assert.ok(codes(cycle).includes('CYCLE'));
  assert.ok(at(cycle, 'CYCLE').some(([, r]) => r === 3));
  const self = judge((b) => {
    node(b, 'MED')['Parent ID'] = 'MED';
  });
  assert.ok(codes(self).includes('CYCLE'));
  assert.deepEqual(
    codes(
      judge((b) => {
        b['financial-position'].push({
          ...node(b, 'RECV'),
          'Node ID': 'EMPTY',
          'Parent ID': 'CUR',
          Amount: '0.00',
        });
      }),
    ),
    ['EMPTY_PARENT'],
  );
  assert.deepEqual(
    codes(
      judge((b) => {
        node(b, 'T').Amount = '0.00';
      }),
    ),
    ['TITLE'],
  );
  const kind = judge((b) => {
    node(b, 'SUPPLIES').Kind = 'Leaf';
  });
  assert.ok(codes(kind).includes('KIND'));
  assert.ok(!codes(kind).includes('CONTROL_TOTAL'));
  assert.ok(!codes(kind).includes('STATEMENT_EQUATION'));
});

void test('depth: a chain of twenty nodes reads, of twenty-one does not', () => {
  const chain = (n: number) => (b: Book) => {
    const st = b['financial-position'];
    const scanner = node(b, 'SCANNER');
    let parent = '';
    for (let i = 1; i < n; i++) {
      st.push({
        ...scanner,
        'Node ID': `LV${i}`,
        'Parent ID': parent,
        Kind: 'parent',
        'Line label': `Level ${i}`,
      });
      parent = `LV${i}`;
    }
    scanner['Parent ID'] = parent;
  };
  const twenty = judge(chain(20));
  assert.equal(twenty.status, 'eligible');
  assert.equal(twenty.nodes.find((n) => n.id === 'SCANNER')!.depth, 20);
  assert.deepEqual(at(judge(chain(21)), 'DEPTH'), [[3, 10, null]]);
});

void test('classes and signs: parent and child, TB and evidence, evidence and statement, and the sign policy', () => {
  const child = judge((b) => {
    for (const r of [node(b, 'SUPPLIES')]) r['Line class'] = 'noncurrent-asset';
    row(b, 'presentation-evidence', 'Line ID', 'SUPPLIES')['Line class'] =
      'noncurrent-asset';
    row(b, 'presentation-evidence', 'Line ID', 'SUPPLIES')['Account class'] =
      'noncurrent-asset';
    row(b, 'trial-balance', 'Account ID', 'C-30')['Account class'] =
      'noncurrent-asset';
  });
  assert.deepEqual(codes(child), ['CLASSIFICATION']);
  assert.deepEqual(at(child, 'CLASSIFICATION'), [[3, 9, 'Line class']]);
  assert.deepEqual(
    at(
      judge((b) => {
        row(b, 'presentation-evidence', 'Line ID', 'SCANNER')['Line label'] =
          'Scanner, imaging';
      }),
      'CLASSIFICATION',
    ),
    [[2, 7, 'Line class']],
  );
  assert.deepEqual(
    at(
      judge((b) => {
        row(b, 'presentation-evidence', 'Line ID', 'SCANNER')['Account class'] =
          'current-asset';
      }),
      'CLASSIFICATION',
    ),
    [
      [2, 7, 'Account class'],
      [2, 7, 'Line class'],
    ],
  );
  // An asset presented as a negative liability, both sides lower by the same amount.
  const asLiability = judge((b) => {
    const p = row(b, 'presentation-evidence', 'Line ID', 'SCANNER');
    p['Line class'] = 'current-liability';
    p.Sign = 'credit-positive';
    row(b, 'proposed-mapping', 'Line ID', 'SCANNER').Sign = 'credit-positive';
    Object.assign(node(b, 'SCANNER'), {
      'Line class': 'current-liability',
      Amount: '-1200.00',
    });
  });
  assert.deepEqual(codes(asLiability), ['CLASSIFICATION', 'SIGN_POLICY']);
  assert.deepEqual(at(asLiability, 'SIGN_POLICY'), [
    [2, 7, 'Sign'],
    [1, 7, 'Sign'],
  ]);
  const contra = judge((b) => {
    row(b, 'proposed-mapping', 'Line ID', 'DOUBTFUL').Sign = 'credit-positive';
    row(b, 'presentation-evidence', 'Line ID', 'DOUBTFUL').Sign =
      'credit-positive';
  });
  assert.deepEqual(codes(contra), ['LEAF_TOTAL', 'SIGN_POLICY']);
  assert.deepEqual(
    codes(
      judge((b) => {
        row(b, 'proposed-mapping', 'Line ID', 'FUND').Sign = 'credit';
      }),
    ),
    ['MAPPING_PROOF', 'SIGN'],
  );
});

void test('validity covers the whole period, inclusively, in strict calendar dates', () => {
  const at0 = (from: string, to: string) =>
    judge((b) => {
      Object.assign(b['presentation-evidence'][0], {
        'Valid from': from,
        'Valid to': to,
      });
    });
  assert.equal(at0('2028-01-01', '2028-03-31').status, 'eligible');
  assert.equal(at0('2027-12-31', '2028-04-01').status, 'eligible');
  for (const [from, to] of [
    ['2028-01-02', '2028-03-31'],
    ['2028-01-01', '2028-03-30'],
    ['2028-04-01', '2028-03-31'],
  ])
    assert.deepEqual(codes(at0(from, to)), ['VALIDITY'], `${from} ${to}`);
  for (const bad of [
    '20280101',
    '2028-1-01',
    '2028-02-30',
    '2028-01-01T00:00',
    ' 2028-01-01',
    '٢٠٢٨-٠١-٠١',
  ])
    assert.deepEqual(
      at(at0(bad, '2028-12-31'), 'DATE'),
      [[2, 2, 'Valid from']],
      bad,
    );
  assert.equal(at0('2028-01-01', '2028-02-29').status, 'blocked');
});

void test('evidence and map: every line proven once, every account mapped once, every leaf fed', () => {
  assert.deepEqual(
    codes(
      judge((b) => {
        row(b, 'presentation-evidence', 'Line ID', 'FUND')[
          'Evidence reference'
        ] = '';
      }),
    ),
    ['PROOF_REFERENCE'],
  );
  assert.deepEqual(
    codes(
      judge((b) => {
        row(b, 'proposed-mapping', 'Line ID', 'FUND')['Evidence ID'] =
          'SUGGESTED';
        b['presentation-evidence'].pop();
      }),
    ),
    ['MISSING_PROOF'],
  );
  assert.deepEqual(
    codes(
      judge((b) => {
        const p = b['presentation-evidence'];
        p.push({ ...p[7], 'Evidence ID': 'EV-SPARE', 'Account ID': 'E-91' });
      }),
    ),
    ['PROOF_ACCOUNT', 'UNUSED_PROOF'],
  );
  // Two equal amounts swapped between owners: totals unchanged, membership wrong.
  const swapped = judge((b) => {
    row(b, 'proposed-mapping', 'Mapping ID', 'MP3')['Line ID'] = 'SUPPLIES';
    row(b, 'proposed-mapping', 'Mapping ID', 'MP5')['Line ID'] = 'PATIENTS';
  });
  assert.ok(codes(swapped).includes('MAPPING_PROOF'));
  assert.deepEqual(
    codes(
      judge((b) => {
        row(b, 'proposed-mapping', 'Mapping ID', 'MP6')['Line ID'] = 'CUR';
        row(b, 'presentation-evidence', 'Evidence ID', 'EV6')['Line ID'] =
          'CUR';
        row(b, 'presentation-evidence', 'Evidence ID', 'EV6')['Line label'] =
          'Current assets';
        row(b, 'presentation-evidence', 'Evidence ID', 'EV6')['Line class'] =
          'current-asset';
        row(b, 'presentation-evidence', 'Evidence ID', 'EV6')['Account class'] =
          'current-asset';
        row(b, 'trial-balance', 'Account ID', 'N-50')['Account class'] =
          'current-asset';
      }),
    ),
    ['MAPPING_TARGET', 'PROOF_LINE', 'UNMAPPED_LEAF'],
  );
  const dims = judge((b) => {
    row(b, 'proposed-mapping', 'Mapping ID', 'MP2')['Complete dimensions'] =
      'Ward=B';
    row(b, 'presentation-evidence', 'Evidence ID', 'EV2')[
      'Complete dimensions'
    ] = 'Ward=B';
  });
  assert.deepEqual(codes(dims), [
    'LEAF_TOTAL',
    'MAPPING_ACCOUNT',
    'PROOF_ACCOUNT',
    'UNMAPPED_ACCOUNT',
  ]);
  assert.deepEqual(
    dims.lines.find((l) => l.id === 'MED-CASH')!.difference,
    -25050,
  );
  // FUND's only account is not in the TB: nothing to compute FUND from.
  const absent = judge((b) => {
    row(b, 'trial-balance', 'Account ID', 'E-90')['Account ID'] = 'E-91';
  });
  assert.deepEqual(codes(absent), [
    'MAPPING_ACCOUNT',
    'PROOF_ACCOUNT',
    'UNMAPPED_ACCOUNT',
  ]);
  assert.equal(absent.lines.find((l) => l.id === 'FUND')!.calculated, null);
  const zero = judge((b) => {
    b['proposed-mapping'].splice(4, 1);
  });
  assert.deepEqual(codes(zero), [
    'UNMAPPED_ACCOUNT',
    'UNMAPPED_LEAF',
    'UNUSED_PROOF',
  ]);
  const gone = judge((b) => {
    b['financial-position'] = b['financial-position'].filter(
      (r) => r['Node ID'] !== 'SUPPLIES',
    );
    b['proposed-mapping'].splice(4, 1);
    b['presentation-evidence'].splice(4, 1);
  });
  assert.deepEqual(codes(gone), ['UNMAPPED_ACCOUNT']);
});

void test('the statement equation and the aggregate limit', () => {
  const off = judge((b) => {
    node(b, 'FUND').Amount = '1500.01';
  });
  assert.deepEqual(codes(off), ['LEAF_TOTAL', 'STATEMENT_EQUATION']);
  const limit = (over: number) => (b: Book) => {
    b['trial-balance'] = b['trial-balance'].filter((r) =>
      ['N-50', 'E-90'].includes(r['Account ID']),
    );
    b['proposed-mapping'] = b['proposed-mapping'].filter((r) =>
      ['N-50', 'E-90'].includes(r['Account ID']),
    );
    b['presentation-evidence'] = b['presentation-evidence'].filter((r) =>
      ['N-50', 'E-90'].includes(r['Account ID']),
    );
    b['financial-position'] = b['financial-position'].filter((r) =>
      ['T', 'SCANNER', 'FUND'].includes(r['Node ID']),
    );
    const big = money(100000000000000 + over);
    Object.assign(row(b, 'trial-balance', 'Account ID', 'N-50'), {
      Debit: big,
    });
    Object.assign(row(b, 'trial-balance', 'Account ID', 'E-90'), {
      Credit: big,
    });
    node(b, 'SCANNER').Amount = big;
    node(b, 'FUND').Amount = big;
  };
  assert.equal(judge(limit(0)).status, 'eligible');
  assert.ok(codes(judge(limit(1))).includes('MONEY'));
  // Every amount within the limit, their totals beyond it.
  const half = money(50000000000001);
  const totals = judge((b) => {
    const keep = ['N-50', 'C-30', 'L-70', 'E-90'];
    for (const role of [
      'trial-balance',
      'proposed-mapping',
      'presentation-evidence',
    ] as const)
      b[role] = b[role].filter((r) => keep.includes(r['Account ID']));
    b['financial-position'] = b['financial-position'].filter((r) =>
      ['T', 'SCANNER', 'SUPPLIES', 'PAYABLES', 'FUND'].includes(r['Node ID']),
    );
    node(b, 'SUPPLIES')['Parent ID'] = '';
    row(b, 'trial-balance', 'Account ID', 'N-50').Debit = half;
    row(b, 'trial-balance', 'Account ID', 'C-30').Debit = half;
    row(b, 'trial-balance', 'Account ID', 'L-70').Credit = half;
    row(b, 'trial-balance', 'Account ID', 'E-90').Credit = half;
    for (const id of ['SCANNER', 'SUPPLIES', 'PAYABLES', 'FUND'])
      node(b, id).Amount = half;
  });
  assert.deepEqual(codes(totals), ['SUM']);
  // Reported assets at the limit and liabilities at minus it: every term
  // within the limit, the equation twice it.
  const equation = judge((b) => {
    node(b, 'SCANNER').Amount = money(100000000000000 - 90050);
    node(b, 'PAYABLES').Amount = money(-100000000000000);
  });
  assert.deepEqual(codes(equation), [
    'LEAF_TOTAL',
    'STATEMENT_EQUATION',
    'SUM',
  ]);
  assert.ok(
    at(equation, 'SUM').some(([, , f]) => f === 'Reported statement equation'),
  );
});

void test('scope rows, identities and empty roles', () => {
  assert.deepEqual(
    at(
      judge((b) => {
        node(b, 'PAYABLES')['Map version'] = 'CLN-MAP-1';
      }),
      'SCOPE',
    ),
    [[3, 11, null]],
  );
  assert.deepEqual(
    at(
      judge((b) => {
        b['trial-balance'][2]['Account ID'] = '';
      }),
      'IDENTITY',
    )[0],
    [0, 4, 'Account ID|Complete dimensions'],
  );
  assert.deepEqual(
    at(
      judge((b) => {
        b['proposed-mapping'][7]['Line ID'] = 'FUND\u200F';
        b['presentation-evidence'][7]['Line ID'] = 'FUND\u200F';
      }),
      'IDENTITY',
    ),
    [
      [1, 9, 'Line ID'],
      [2, 9, 'Line ID'],
    ],
  );
  const empty = judge(
    (b) => {
      b['trial-balance'] = [];
    },
    {
      'trial-balance': () =>
        csv([{ ...book()['trial-balance'][0] }]).split('\n')[0] + '\n',
    },
  );
  assert.deepEqual(codes(empty), ['EMPTY_SOURCE', 'NO_ACCOUNT']);
  const titleOnly = judge((b) => {
    b['financial-position'] = b['financial-position'].slice(0, 1);
  });
  assert.ok(codes(titleOnly).includes('NO_FINANCIAL_LEAF'));
});

void test('refusals: identical sources, an unconfirmed or unsupported scope, wrong readings, a file that is not CSV', () => {
  const same = input();
  same.files[1] = same.files[0];
  assert.throws(
    () => reconcileFinancialHierarchy(same),
    /FINH_INDEPENDENT_SOURCES/,
  );
  for (const change of [
    { Currency: 'KWD' },
    { Currency: 'XYZ' },
    { 'As of': '2028-03-30' },
    { 'Posting status': 'draft' },
    { 'Closing basis': 'pre-closing' },
    { 'Period start': '2028-04-01' },
    { 'Period end': '2028-02-30', 'As of': '2028-02-30' },
  ])
    assert.throws(
      () =>
        reconcileFinancialHierarchy(
          input(undefined, {}, { ...SCOPE, ...change }),
        ),
      /FINH_SCOPE/,
      JSON.stringify(change),
    );
  const unconfirmed = input();
  unconfirmed.scope.confirmed = false;
  assert.throws(() => reconcileFinancialHierarchy(unconfirmed), /FINH_SCOPE/);
  const swapped = input();
  swapped.readings = [
    swapped.readings[1],
    swapped.readings[0],
    swapped.readings[2],
    swapped.readings[3],
  ];
  assert.throws(() => reconcileFinancialHierarchy(swapped), /FINH_READING/);
  const xlsx = input();
  xlsx.files[0] = { ...xlsx.files[0], name: 'trial-balance.xlsx' };
  assert.throws(() => reconcileFinancialHierarchy(xlsx), /FINH_SOURCE/);
});

void test('the replay reads its own copies and checks the hash it was sent', async () => {
  const base = input();
  const files = base.files.map((f) => ({
    name: f.name,
    original: f.bytes.slice().buffer,
    sha256: f.sha256,
  }));
  const pending = replayFinancialHierarchy({
    files: files as Parameters<typeof replayFinancialHierarchy>[0]['files'],
    readings: base.readings,
    scope: base.scope,
  });
  new Uint8Array(files[3].original).fill(0x41);
  const { result } = await pending.catch((e: unknown) =>
    assert.fail(String(e)),
  );
  assert.equal(result.status, 'eligible');
  assert.equal(result.sources[3].sha256, base.files[3].sha256);
  // Without a hash from the caller, the copy still decides.
  const unhashed = base.files.map((f) => ({
    name: f.name,
    original: f.bytes.slice().buffer,
  }));
  const later = replayFinancialHierarchy({
    files: unhashed as Parameters<typeof replayFinancialHierarchy>[0]['files'],
    readings: base.readings,
    scope: base.scope,
  });
  new Uint8Array(unhashed[3].original).fill(0x41);
  const { result: copy } = await later.catch((e: unknown) =>
    assert.fail(String(e)),
  );
  assert.equal(copy.status, 'eligible');
  assert.equal(copy.sources[3].sha256, base.files[3].sha256);
  await assert.rejects(
    replayFinancialHierarchy({
      files: files.map((f, i) =>
        i ? f : { ...f, sha256: '0'.repeat(64) },
      ) as Parameters<typeof replayFinancialHierarchy>[0]['files'],
      readings: base.readings,
      scope: base.scope,
    }),
    /FINH_SOURCE_HASH/,
  );
});
