import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectFinancialHierarchySource4 as inspect } from '../lib/reconciliation/tb-financial-hierarchy-source.ts';
import {
  FIN_HIERARCHY_INTAKE_CONTRACT,
  FIN_HIERARCHY_SCOPE_HEADERS,
  type FinancialHierarchyScope,
} from '../lib/reconciliation/tb-financial-hierarchy-contract.ts';

const contract = JSON.parse(
  await readFile(
    new URL('../audit/tb-financial-hierarchy/contract.json', import.meta.url),
    'utf8',
  ),
);
const scope: FinancialHierarchyScope = contract.scope;
const headers = [
  'Node ID',
  'Parent ID',
  'Kind',
  'Line label',
  'Line class',
  'Amount',
  ...FIN_HIERARCHY_SCOPE_HEADERS,
];
const quote = (v: string) =>
  /[,"\r\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v;
type Row = [string, string, string, string, string, string];
const leaf = (
  id = 'ZERO',
  amount = '0',
  parent = '',
  classification = 'current-asset',
): Row => [id, parent, 'leaf', id, classification, amount];
function csv(rows: Row[], expected: FinancialHierarchyScope = scope) {
  return (
    [
      headers,
      ...rows.map((r) => [
        ...r,
        ...FIN_HIERARCHY_SCOPE_HEADERS.map((key) => expected[key]),
      ]),
    ]
      .map((r) => r.map(quote).join(','))
      .join('\n') + '\n'
  );
}
const run = (text: string, expectedScope = scope) =>
  inspect({
    name: 'source.csv',
    original: new TextEncoder().encode(text).buffer,
    expectedScope,
  });
const codes = (r: Awaited<ReturnType<typeof inspect>>) =>
  r.issues.map((i) => i.code);

void test('known 18 source4 projections keep full-oracle responsibilities separate', async () => {
  const expected: Record<string, string | null> = {
    'positive-nested': null,
    'positive-reordered': null,
    'equal-amount-wrong-owner': null,
    'two-parents': 'DUPLICATE_NODE',
    'parent-cycle': 'CYCLE',
    'missing-zero-leaf': null,
    'blank-zero-amount': 'MONEY',
    'wrong-control-total': 'CONTROL_TOTAL',
    'wrong-classification-balanced': null,
    'expired-proof': null,
    'duplicate-mapping': null,
    'unmapped-zero-account': null,
    'mapping-to-parent': null,
    // The frozen foreign-scope defect is in TB, beyond this source4 projection.
    'wrong-contra-sign': null,
    'late-unknown-row': 'KIND',
    'foreign-scope': null,
    'missing-parent': 'PARENT',
    // Its subminor Debit is in TB; direct source4 subminor tests below must block.
    'subminor-value': null,
  };
  for (const [id, code] of Object.entries(expected)) {
    const raw = await readFile(
      new URL(
        `../audit/tb-financial-hierarchy/frozen/${id}/financial-position.csv`,
        import.meta.url,
      ),
    );
    const r = await inspect({
      name: 'statement.csv',
      original: Uint8Array.from(raw).buffer,
      expectedScope: scope,
    });
    assert.equal(r.status, code ? 'blocked' : 'inspected', id);
    assert.equal(r.inventoryState.complete, true, id);
    if (code) assert.ok(codes(r).includes(code as never), id);
    assert.equal(r.kind, 'passive-source4-inspection');
    assert.equal(r.intakeContract, FIN_HIERARCHY_INTAKE_CONTRACT);
    assert.equal(
      'eligible' in r || 'approved' in r || 'consistency' in r,
      false,
    );
    if (id === 'two-parents') {
      const contenders = r.nodes.filter((n) => n.id === 'CASH-A');
      assert.equal(contenders.length, 2);
      assert.equal(new Set(contenders.map((n) => n.parentId)).size, 2);
      assert.equal(r.leafSums, null);
    }
  }
});

void test('nested and reordered facts use immediate-child controls and contribute leaves exactly once', async () => {
  const readings = [];
  for (const id of ['positive-nested', 'positive-reordered']) {
    const raw = await readFile(
      new URL(
        `../audit/tb-financial-hierarchy/frozen/${id}/financial-position.csv`,
        import.meta.url,
      ),
    );
    readings.push(
      await inspect({
        name: `${id}.csv`,
        original: Uint8Array.from(raw).buffer,
        expectedScope: scope,
      }),
    );
  }
  for (const r of readings) {
    assert.deepEqual(r.issues, []);
    assert.equal(r.leafSums?.assetsMinor, 120000n);
    assert.equal(r.leafSums?.liabilitiesMinor, 50000n);
    assert.equal(r.leafSums?.equityMinor, 70000n);
    assert.equal(r.leafSums?.equationMinor, 0n);
    assert.equal(r.leafSums?.leaves.length, 7);
    assert.equal(
      r.leafSums?.leaves.find((n) => n.nodeId === 'ALLOW')?.amountMinor,
      -10000n,
    );
    assert.equal(
      r.leafSums?.leaves.find((n) => n.nodeId === 'ZERO')?.amountMinor,
      0n,
    );
    const asset = r.controls.find((c) => c.nodeId === 'ASSETS')!;
    assert.deepEqual(asset.children.map((c) => c.nodeId).sort(), [
      'ALLOW',
      'CASH',
      'REC',
      'ZERO',
    ]);
    assert.equal(asset.childTotalMinor, 120000n);
    assert.equal(asset.suppliedMinor, 120000n);
    assert.equal(asset.differenceMinor, 0n);
    assert.equal(asset.matches, true);
    const cash = r.edges.find((e) => e.childId === 'CASH-A')!;
    assert.equal(cash.parentId, 'CASH');
    assert.deepEqual(cash.parentRows, [
      r.nodes.find((n) => n.id === 'CASH')!.row,
    ]);
    assert.equal(r.citations[cash.citationIndices[0]].raw, 'CASH');
  }
  assert.deepEqual(
    readings[0].leafSums?.categoryMinor,
    readings[1].leafSums?.categoryMinor,
  );
  assert.notEqual(readings[0].source?.sha256, readings[1].source?.sha256);
  assert.notEqual(
    readings[0].nodes.find((n) => n.id === 'CASH-A')?.row,
    readings[1].nodes.find((n) => n.id === 'CASH-A')?.row,
  );
});

void test('titles, explicit ownership and classification are checked without label or indentation inference', async () => {
  const cases: [Row[], string][] = [
    [[['P', '', 'title', 'Heading', '', ''], leaf('L', '0', 'P')], 'PARENT'],
    [
      [
        ['T', 'P', 'title', 'Heading', '', ''],
        ['P', '', 'parent', 'P', 'current-asset', '0'],
        leaf('L', '0', 'P'),
      ],
      'TITLE',
    ],
    [[['P', '', 'parent', 'P', 'current-asset', '0']], 'EMPTY_PARENT'],
    [
      [
        ['P', '', 'parent', 'P', 'current-asset', '1'],
        leaf('L', '1', 'P', 'equity'),
      ],
      'CLASSIFICATION',
    ],
    [
      [leaf('L', '0', ' P '), ['P', '', 'parent', 'P', 'current-asset', '0']],
      'PARENT',
    ],
    [[leaf('', '0')], 'IDENTITY'],
  ];
  for (const [rows, issue] of cases) {
    const r = await run(csv(rows));
    assert.equal(r.status, 'blocked');
    assert.ok(codes(r).includes(issue as never), issue);
    assert.equal(r.inventory.length, rows.length);
  }
  const exact = await run(
    csv([
      leaf('001'),
      leaf('0010'),
      leaf('001 '),
      leaf('__proto__'),
      leaf('constructor'),
    ]),
  );
  assert.equal(exact.status, 'inspected');
  assert.deepEqual(
    exact.nodes.map((n) => n.id),
    ['001', '0010', '001 ', '__proto__', 'constructor'],
  );
});

void test('duplicates never choose an owner or silently discard raw contenders', async () => {
  const r = await run(
    csv([
      ['P', '', 'parent', 'first', 'current-asset', '1'],
      ['P', '', 'parent', 'second', 'current-asset', '1'],
      leaf('L', '1', 'P'),
    ]),
  );
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.edges[0].parentRows, [2, 3]);
  assert.equal(r.controls.length, 2);
  assert.ok(
    r.controls.every((c) => c.childTotalMinor === null && c.matches === null),
  );
  assert.deepEqual(
    r.inventory.slice(0, 2).map((r) => r.raw[3]),
    ['first', 'second'],
  );
  assert.equal(r.issues.filter((i) => i.code === 'DUPLICATE_NODE').length, 2);
  assert.equal(r.leafSums, null);
});

void test('blank and non-ASCII or rounded money cannot become zero; signed contra remains exact', async () => {
  for (const value of [
    '',
    ' ',
    '+1',
    '01',
    '1.',
    '.1',
    '1.001',
    '1e2',
    'NaN',
    '١.٠٠',
    '１.００',
    '1,000.00',
    '1\n',
  ]) {
    const r = await run(csv([leaf('L', value)]));
    assert.equal(r.status, 'blocked', JSON.stringify(value));
    assert.ok(codes(r).includes('MONEY'), JSON.stringify(value));
    const issue = r.issues.find((i) => i.code === 'MONEY')!;
    assert.equal(r.citations[issue.citationIndices[0]].raw, value);
  }
  const r = await run(
    csv([leaf('A', '12.3'), leaf('B', '-0.01'), leaf('C', '-0.00')]),
  );
  assert.equal(r.status, 'inspected');
  assert.equal(r.leafSums?.assetsMinor, 1229n);
  assert.deepEqual(
    r.nodes.map((n) => n.amountMinor),
    [1230n, -1n, 0n],
  );
});

void test('financial term, final category, grand total, control and equation limits use exact integers', async () => {
  for (const value of ['999999999999.99', '1000000000000.00'])
    assert.equal((await run(csv([leaf('L', value)]))).status, 'inspected');
  const money = await run(csv([leaf('L', '1000000000000.01')]));
  assert.ok(codes(money).includes('MONEY'));
  const sum = await run(csv([leaf('A', '1000000000000'), leaf('B', '0.01')]));
  assert.ok(codes(sum).includes('SUM'));
  const grand = await run(
    csv([
      leaf('A', '1000000000000'),
      leaf('B', '0.01', '', 'noncurrent-asset'),
    ]),
  );
  assert.ok(grand.issues.some((i) => i.code === 'SUM' && i.field === 'Assets'));
  const equation = await run(
    csv([leaf('A', '1000000000000'), leaf('B', '-0.01', '', 'equity')]),
  );
  assert.ok(
    equation.issues.some(
      (i) => i.code === 'SUM' && i.field === 'Statement equation',
    ),
  );
  const control = await run(
    csv([
      ['P', '', 'parent', 'P', 'current-asset', '1000000000000'],
      leaf('A', '1000000000000', 'P'),
      leaf('B', '0.01', 'P'),
    ]),
  );
  assert.ok(
    control.issues.some(
      (i) => i.code === 'SUM' && i.field === 'Parent child total',
    ),
  );
  assert.equal(control.controls[0].childTotalMinor, 100000000000001n);
  const cancel = await run(
    csv([leaf('A', '1000000000000'), leaf('B', '1'), leaf('C', '-1')]),
  );
  assert.equal(cancel.status, 'inspected');
  assert.equal(cancel.leafSums?.assetsMinor, 100000000000000n);
});

void test('depth and record count limits include exact boundary and explicit incomplete aborts', async () => {
  function chain(depth: number): Row[] {
    return Array.from({ length: depth }, (_, i) =>
      i === depth - 1
        ? leaf(`N${i}`, '0', i ? `N${i - 1}` : '')
        : [`N${i}`, i ? `N${i - 1}` : '', 'parent', 'P', 'current-asset', '0'],
    );
  }
  for (const depth of [19, 20])
    assert.equal((await run(csv(chain(depth)))).status, 'inspected');
  assert.ok(codes(await run(csv(chain(21)))).includes('DEPTH'));
  for (const count of [199, 200]) {
    const r = await run(
      csv(Array.from({ length: count }, (_, i) => leaf(`N${i}`))),
    );
    assert.equal(r.status, 'inspected');
    assert.equal(r.inventory.length, count);
  }
  const r = await run(
    csv(Array.from({ length: 202 }, (_, i) => leaf(`N${i}`))),
  );
  assert.equal(r.status, 'blocked');
  assert.ok(codes(r).includes('ROWS'));
  assert.equal(r.inventoryState.complete, false);
  assert.equal(r.inventoryState.reason, 'ROWS');
  assert.equal(r.inventory.length, 201);
});

void test('empty/header/title-only and unknown late records never produce a clean empty inspection', async () => {
  for (const text of [
    '',
    headers.join(',') + '\n',
    csv([['T', '', 'title', 'Heading', '', '']]),
  ]) {
    const r = await run(text);
    assert.equal(r.status, 'blocked');
    assert.ok(r.issues.length > 0);
    assert.equal(r.leafSums, null);
  }
  const r = await run(
    csv([leaf(), ['late', '', 'mystery', 'ignored?', '', '']]),
  );
  assert.equal(r.status, 'blocked');
  assert.equal(r.inventory.length, 2);
  assert.equal(r.nodes.at(-1)?.id, 'late');
  const issue = r.issues.find((i) => i.code === 'KIND')!;
  assert.equal(issue.row, 3);
  assert.equal(r.citations[issue.citationIndices[0]].raw, 'mystery');
});

void test('scope is supplied explicitly, exact per record, and constrained to the prototype policy', async () => {
  const foreign = { ...scope, Entity: scope.Entity + ' ' };
  const r = await run(csv([leaf()], foreign));
  assert.equal(r.status, 'blocked');
  assert.ok(
    r.issues.some(
      (i) => i.code === 'SCOPE' && i.field === 'Entity' && i.row === 2,
    ),
  );
  assert.equal(r.scope?.Entity, scope.Entity);
  for (const [key, value] of [
    ['Currency', 'KWD'],
    ['Currency basis', 'presentation'],
    ['Posting status', 'draft'],
    ['Closing basis', 'pre-closing'],
  ]) {
    const expected = { ...scope, [key]: value };
    assert.ok(
      codes(await run(csv([leaf()], expected), expected)).includes(
        'UNSUPPORTED_SCOPE',
      ),
    );
  }
  for (const expected of [
    { ...scope, 'Period start': '2026-02-29' },
    { ...scope, 'Period start': '2026-10-01' },
    { ...scope, 'As of': '2026-09-29' },
  ])
    assert.equal(
      (await run(csv([leaf()], expected), expected)).status,
      'blocked',
    );
  const leap = {
    ...scope,
    'Period start': '2024-02-29',
    'Period end': '2024-02-29',
    'As of': '2024-02-29',
  };
  assert.equal((await run(csv([leaf()], leap), leap)).status, 'inspected');
});
