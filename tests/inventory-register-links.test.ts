import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stockCSV } from '../lib/reconciliation/inventory-register-csv.ts';
import {
  reconcileStock,
  STOCK_LINK_REASONS,
  STOCK_ROLES,
  STOCK_VERSION,
  type StockInput,
  type StockResult,
} from '../lib/reconciliation/inventory-register.ts';
import { columnInput } from './inventory-column-fixture.ts';

// A small synthetic paint depot in Kuwaiti dinars, unrelated to the INV-3
// stories: every rule of the links on its own few rows.
const SCOPE = {
  entity: 'Synthetic Paint Depot',
  inventoryLedger: 'PNT-STK',
  glLedger: 'PNT-GL',
  currency: 'KWD',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Month end',
  asOf: '2028-03-31',
  chartVersion: 'C-7',
  mapVersion: 'M-7',
  valuationPolicyVersion: 'V-7',
  inventoryAccountSetVersion: 'S-7',
};
const SCOPE_VALUES = Object.values(SCOPE);
const HEADERS = [
  'Item ID,Item dimensions,Quantity,Unit,Quantity precision,Posted value,Valuation reference',
  'Mapping ID,Item ID,Item dimensions,GL account,GL dimensions,Evidence ID',
  'Evidence ID,Item ID,Item dimensions,Unit,Quantity precision,Valuation reference,GL account,GL dimensions,Account class,Sign,Value basis,Valid from,Valid to,Reference',
  'GL account,GL dimensions,Account class,Debit,Credit',
];
const SCOPE_HEADER =
  'Entity,Inventory ledger,GL ledger,Currency,Currency basis,Posting status,Posting layer,As of,Chart version,Map version,Valuation policy version,Inventory account set version';

type Book = string[][][];
// One paint item linked to account 2100/site=K, with its own mapping and
// evidence. `over` changes evidence fields by index.
function paint(
  book: Book,
  item: string,
  dims: string,
  {
    value = '1.250',
    unit = 'L',
    prec = '0',
    ref = `R-${item}`,
    account = '2100',
    map = true,
    evidence = true,
    over = {} as Record<number, string>,
  } = {},
) {
  const n = book[0].length + 1;
  book[0].push([item, dims, '5', unit, prec, value, ref]);
  if (map) book[1].push([`MP${n}`, item, dims, account, 'site=K', `EV${n}`]);
  if (evidence) {
    const e = [
      `EV${n}`,
      item,
      dims,
      unit,
      prec,
      ref,
      account,
      'site=K',
      'inventory',
      'debit-positive',
      'provided-posted-carrying-value',
      '2028-01-01',
      '2028-12-31',
      `POL-${n}`,
    ];
    for (const [i, v] of Object.entries(over)) e[Number(i)] = v;
    book[2].push(e);
  }
}
const empty = (): Book => [[], [], [], []];
const file = (i: number, rows: string[][]) => {
  const text =
    [
      HEADERS[i] + ',' + SCOPE_HEADER,
      ...rows.map((r) => [...r, ...SCOPE_VALUES].join(',')),
    ].join('\n') + '\n';
  const bytes = new TextEncoder().encode(text);
  return {
    name: `paint-${i}.csv`,
    original: bytes.buffer,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sheets: [
      {
        name: 'CSV',
        rows: stockCSV(bytes.buffer),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
};
function run(
  book: Book,
  gl: string[][] = [['2100', 'site=K', 'inventory', '1.250', '0.000']],
): StockResult {
  book[3] = gl;
  const input: StockInput = {
    files: [
      file(0, book[0]),
      file(1, book[1]),
      file(2, book[2]),
      file(3, book[3]),
    ],
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    scope: { ...SCOPE, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  return reconcileStock(input);
}
const brief = (r: StockResult) =>
  r.links.map((l) => [l.row, l.status, l.reasons]);
const rows = (refs: { row: number }[]) => refs.map((x) => x.row);
// The family's missing keys are exactly what the links and unlinked records say.
function consistent(r: StockResult) {
  const derived = new Set<string>();
  r.records.forEach((records, i) => {
    if (!records.length) derived.add(`source:${i}`);
  });
  for (const l of r.links)
    if (l.status === 'unlinked')
      derived.add(
        (['NO_MAPPING', 'MAPPINGS'].includes(l.reasons[0])
          ? 'mapping:'
          : 'evidence:') + JSON.stringify([l.item, l.dimensions]),
      );
  for (const u of r.unlinked)
    derived.add(
      {
        mapping: 'orphan-mapping:',
        evidence: 'orphan-evidence:',
        gl: 'account:',
        account: 'gl:',
      }[u.role] +
        (u.role === 'mapping' || u.role === 'evidence'
          ? u.key[0]
          : JSON.stringify(u.key)),
    );
  assert.deepEqual(
    [...derived].sort(),
    [...r.missing].sort(),
    'links say what the missing keys say',
  );
  assert.equal(
    r.links.length,
    r.records[0].length,
    'one link per register record',
  );
}

void test('INV-3 links: a linked row names its mapping, evidence, account and GL rows by record', () => {
  const b = empty();
  paint(b, 'PNT-1', 'site=K');
  const r = run(b);
  const [l] = r.links;
  assert.equal(l.status, 'linked');
  assert.deepEqual(l.reasons, []);
  assert.equal(l.id, r.records[0][0].id);
  assert.deepEqual(
    [rows(l.mappings), rows(l.evidence), rows(l.gl)],
    [[2], [2], [2]],
  );
  assert.deepEqual([l.mappings[0].key, l.evidence[0].key], ['MP1', 'EV1']);
  assert.equal(l.mappings[0].id, r.records[1][0].id);
  assert.deepEqual(l.account, { account: '2100', dimensions: 'site=K' });
  assert.deepEqual(r.unlinked, []);
  assert.equal(r.financial, 'ready');
  consistent(r);
});

void test('INV-3 links: no mapping, two mappings, no evidence and two evidence rows, each named and none chosen', () => {
  const b = empty();
  paint(b, 'A', 'site=K');
  paint(b, 'B', 'site=K', { map: false, evidence: false });
  paint(b, 'C', 'site=K');
  b[1].push(['MP-C2', 'C', 'site=K', '2200', 'site=K', 'EV4']);
  paint(b, 'D', 'site=K', { evidence: false });
  paint(b, 'E', 'site=K');
  b[2].push([...b[2][b[2].length - 1].slice(0, 13), 'POL-E2']);
  const r = run(b);
  assert.deepEqual(brief(r), [
    [2, 'linked', []],
    [3, 'unlinked', ['NO_MAPPING']],
    [4, 'unlinked', ['MAPPINGS']],
    [5, 'unlinked', ['NO_EVIDENCE']],
    [6, 'unlinked', ['EVIDENCES']],
  ]);
  const [, none, two, missing, both] = r.links;
  assert.deepEqual(
    [none.mappings, none.evidence, none.account],
    [[], [], null],
  );
  assert.deepEqual(
    [rows(two.mappings), two.evidence, two.account],
    [[3, 4], [], null],
  );
  assert.deepEqual(
    [rows(missing.mappings), missing.evidence, missing.account],
    [[5], [], { account: '2100', dimensions: 'site=K' }],
  );
  assert.deepEqual(rows(both.evidence), [4, 5]);
  assert.equal(r.financial, 'source-error');
  consistent(r);
});

void test('INV-3 links: every differing evidence field, alone and together, in contract order', () => {
  const fields: [number, string][] = [
    [1, 'EVIDENCE_ITEM'],
    [2, 'EVIDENCE_DIMENSIONS'],
    [3, 'EVIDENCE_UNIT'],
    [4, 'EVIDENCE_PRECISION'],
    [5, 'EVIDENCE_VALUATION'],
    [6, 'EVIDENCE_ACCOUNT'],
    [7, 'EVIDENCE_ACCOUNT_DIMENSIONS'],
  ];
  const other: Record<number, string> = {
    1: 'Q',
    2: 'site=Q',
    3: 'GAL',
    4: '2',
    5: 'R-Q',
    6: '2999',
    7: 'site=Q',
  };
  for (const [index, code] of fields) {
    const b = empty();
    paint(b, 'A', 'site=K', { over: { [index]: other[index] } });
    const r = run(b);
    assert.deepEqual(brief(r), [[2, 'unlinked', [code]]], code);
    assert.deepEqual(
      r.links[0].account,
      { account: '2100', dimensions: 'site=K' },
      `${code}: the mapping's account, whatever the evidence names`,
    );
    consistent(r);
  }
  const b = empty();
  paint(b, 'A', 'site=K', { over: { 7: 'site=Q', 3: 'GAL', 5: 'R-Q' } });
  assert.deepEqual(run(b).links[0].reasons, [
    'EVIDENCE_UNIT',
    'EVIDENCE_VALUATION',
    'EVIDENCE_ACCOUNT_DIMENSIONS',
  ]);
  assert.deepEqual(
    STOCK_LINK_REASONS.slice(4),
    fields.map(([, c]) => c),
  );
});

void test('INV-3 links: identity is compared as written, and the unmatched mapping is unlinked', () => {
  const b = empty();
  paint(b, '420', 'site=K');
  paint(b, '00420', 'site=K', { map: false, evidence: false });
  paint(b, 'Z', 'Site=K', { map: false, evidence: false });
  b[1].push(['MP-z', 'Z', 'site=K', '2100', 'site=K', 'EV2']);
  const r = run(b);
  assert.deepEqual(brief(r), [
    [2, 'linked', []],
    [3, 'unlinked', ['NO_MAPPING']],
    [4, 'unlinked', ['NO_MAPPING']],
  ]);
  assert.deepEqual(
    r.unlinked.map((u) => [u.role, u.record?.row ?? null, u.key, u.reason]),
    [['mapping', 3, ['MP-z'], 'NO_REGISTER']],
  );
  consistent(r);
});

void test('INV-3 links: unlinked records in role order, then accounts in the order of their first linked row', () => {
  const b = empty();
  paint(b, 'A', 'site=K', { account: '2300' });
  paint(b, 'B', 'site=K');
  paint(b, 'C', 'site=K', { account: '2400' });
  b[1].push(['MP-X', 'X', 'site=K', '2100', 'site=K', 'EV3']);
  b[2].push([
    'EV-X',
    'X',
    'site=K',
    'L',
    '0',
    'R-X',
    '2100',
    'site=K',
    'inventory',
    'debit-positive',
    'provided-posted-carrying-value',
    '2028-01-01',
    '2028-12-31',
    'POL-X',
  ]);
  const r = run(b, [
    ['2100', 'site=K', 'inventory', '1.257', '0.000'],
    ['2900', 'site=K', 'inventory', '0.500', '0.000'],
  ]);
  assert.deepEqual(
    r.unlinked.map((u) => [u.role, u.record?.row ?? null, u.key, u.reason]),
    [
      ['mapping', 5, ['MP-X'], 'NO_REGISTER'],
      ['evidence', 5, ['EV-X'], 'NO_MAPPING'],
      ['gl', 3, ['2900', 'site=K'], 'NO_LINKED_REGISTER'],
      ['account', null, ['2300', 'site=K'], 'NO_GL_RECORD'],
      ['account', null, ['2400', 'site=K'], 'NO_GL_RECORD'],
    ],
  );
  consistent(r);
});

void test('INV-3 links: an account used only by unlinked rows does not make its GL row linked', () => {
  const b = empty();
  paint(b, 'A', 'site=K');
  paint(b, 'B', 'site=K', { account: '2500', unit: 'KG', over: { 3: 'L' } });
  const r = run(b, [
    ['2100', 'site=K', 'inventory', '1.250', '0.000'],
    ['2500', 'site=K', 'inventory', '1.257', '0.000'],
  ]);
  assert.deepEqual(r.links[1].reasons, ['EVIDENCE_UNIT']);
  assert.deepEqual(rows(r.links[1].gl), [3], 'the rule looked at the GL row');
  assert.deepEqual(
    r.unlinked.map((u) => [u.role, u.record?.row, u.reason]),
    [['gl', 3, 'NO_LINKED_REGISTER']],
  );
  consistent(r);
});

void test('INV-3 links: a row that does not read has no link; a mapping that does not read is no mapping', () => {
  const b = empty();
  paint(b, 'A', 'site=K');
  b[0].push(['A2', 'site=K', 'five', 'L', '0', '1.000', 'R-A2']);
  paint(b, 'B', 'site=K', { map: false });
  b[1].push(['MP-B', 'B', 'site=K', '2100', 'site=K', '']);
  const r = run(b);
  assert.deepEqual(brief(r), [
    [2, 'linked', []],
    [4, 'unlinked', ['NO_MAPPING']],
  ]);
  assert.deepEqual(
    r.unlinked.map((u) => [u.role, u.key[0], u.reason]),
    [['evidence', 'EV3', 'NO_MAPPING']],
  );
  assert.equal(r.financial, 'source-error');
  consistent(r);
});

void test('INV-3 links: two register rows of one item both link, in register order', () => {
  const b = empty();
  paint(b, 'B', 'site=K');
  paint(b, 'A', 'site=K');
  b[0].push([...b[0][0]]);
  const r = run(b, [['2100', 'site=K', 'inventory', '3.757', '0.000']]);
  assert.deepEqual(brief(r), [
    [2, 'linked', []],
    [3, 'linked', []],
    [4, 'linked', []],
  ]);
  assert.deepEqual(rows(r.links[2].mappings), [2]);
  consistent(r);
});

void test("INV-3 links: the decision is the family's, with or without unlinked rows", () => {
  const b = empty();
  paint(b, 'A', 'site=K');
  paint(b, 'B', 'site=K', { over: { 5: 'R-OLD' } });
  const r = run(b);
  assert.equal(r.financial, 'missing');
  assert.deepEqual(r.missing, ['evidence:["B","site=K"]']);
  assert.deepEqual(
    r.comparisons[0].registerMinor,
    1250,
    'only the linked row contributes',
  );
  assert.equal(r.status, 'missing');
});

void test("INV-3 links: a column reading has links with the register cell's column", async () => {
  const r = reconcileStock(await columnInput('C02'));
  assert.ok(r.links.length > 0);
  assert.equal(r.links.length, r.records[0].length);
  r.links.forEach((l, i) => {
    assert.equal(l.id, r.records[0][i].id);
    assert.equal(l.column, r.records[0][i].column);
  });
  consistent(r);
});
