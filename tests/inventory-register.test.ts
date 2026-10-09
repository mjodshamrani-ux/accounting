import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stockCSV } from '../lib/reconciliation/inventory-register-csv.ts';
import {
  reconcileStock,
  STOCK_VERSION,
  STOCK_ROLES,
  assertStockEventBudget,
  type StockInput,
  type StockEvent,
} from '../lib/reconciliation/inventory-register.ts';
const root = new URL('../audit/inventory-register/', import.meta.url);
const cases: { case: string; financial: string }[] = JSON.parse(
  await readFile(new URL('cases.json', root), 'utf8'),
);
async function fixture(name = 'independent-units-positive') {
  const truth = JSON.parse(
    await readFile(new URL(`cases/${name}/expected.json`, root), 'utf8'),
  );
  const files = await Promise.all(
    [0, 1, 2, 3].map(async (source) => {
      const bytes = new Uint8Array(
        await readFile(new URL(`cases/${name}/source-${source}.csv`, root)),
      ).buffer;
      return {
        name: `source-${source}.csv`,
        original: bytes,
        sha256: createHash('sha256')
          .update(new Uint8Array(bytes))
          .digest('hex'),
        sheets: [
          {
            name: 'CSV',
            rows: stockCSV(bytes),
            formulaRows: [],
            hiddenRows: [],
          },
        ],
      };
    }),
  );
  const input: StockInput = {
    files: [files[0], files[1], files[2], files[3]],
    scope: { ...truth.scope, confirmed: true },
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  return { input, expected: truth.expected };
}
const missing = (v: string) =>
  v.replace(
    /^(mapping|evidence|gl|account):\('([^']*)', '([^']*)'\)$/,
    (_, kind, a, b) => kind + ':' + JSON.stringify([a, b]),
  );
void test('41 pre-engine CSV Decimal truths preserve separate quantity/value, comparisons, all cells, physical inventory and malformed members', async () => {
  for (const c of cases) {
    const { input, expected } = await fixture(c.case),
      before = JSON.stringify(input),
      r = reconcileStock(input);
    assert.equal(r.financial, expected.financial, c.case);
    assert.equal(r.decimals, expected.decimals, c.case);
    assert.deepEqual(
      r.records.map((rows) => rows.map(({ row, values }) => ({ row, values }))),
      expected.records,
      c.case + ':read values',
    );
    assert.deepEqual(
      r.issues
        .map((v) => [v.source, v.row, v.code])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      expected.issues.sort((a: unknown, b: unknown) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
      c.case + ':issues',
    );
    assert.deepEqual(
      r.missing.sort(),
      expected.missing.map(missing).sort(),
      c.case + ':missing',
    );
    assert.deepEqual(
      r.comparisons,
      expected.comparisons,
      c.case + ':per account',
    );
    assert.deepEqual(r.totals, expected.totals, c.case + ':money only');
    assert.deepEqual(
      r.inventory.map((v) => [v.source, v.row, v.kind]),
      expected.inventory,
      c.case + ':physical inventory',
    );
    assert.deepEqual(
      r.cells.map((v) => [v.source, v.row, v.column, v.field, v.text]),
      expected.cells,
      c.case + ':full cell evidence',
    );
    assert.deepEqual(
      r.memberIds.map((v) => {
        const id = JSON.parse(v);
        return [id[1], id[4]];
      }),
      expected.members,
      c.case + ':full nonblank membership',
    );
    assert.equal(JSON.stringify(input), before, c.case + ':input unchanged');
  }
});
function event(
  input: StockInput,
  type: StockEvent['type'],
  id = type,
): StockEvent {
  const r = reconcileStock({ ...input, events: [] });
  return {
    id,
    type,
    context: r.context,
    memberIds: r.memberIds,
    at: '2026-10-08T01:00:00.000Z',
    reference: 'SYNTHETIC reference',
    note: 'Synthetic whole scope only; not field evidence',
  };
}
void test('Whole scope acceptance requires strict completeness, all physical members, every account zero and immutable source/scope context; undo permits redecision', async () => {
  const { input } = await fixture();
  assert.throws(
    () => reconcileStock({ ...input, events: [event(input, 'accept')] }),
    /STOCK_EVENT_ACCEPT/,
  );
  input.completeness = {
    confirmed: true,
    reference: 'SYNTHETIC complete',
    note: 'Attestation test only',
  };
  const accepted = event(input, 'accept');
  assert.equal(
    reconcileStock({ ...input, events: [accepted] }).status,
    'consistent-with-evidence',
  );
  assert.throws(
    () =>
      reconcileStock({
        ...input,
        events: [{ ...accepted, memberIds: accepted.memberIds.slice(1) }],
      }),
    /STOCK_EVENT_MEMBERS/,
  );
  assert.throws(
    () =>
      reconcileStock({
        ...input,
        events: [
          {
            ...accepted,
            memberIds: accepted.memberIds.map(() => accepted.memberIds[0]),
          },
        ],
      }),
    /STOCK_EVENT_MEMBERS/,
  );
  assert.throws(
    () =>
      reconcileStock({
        ...input,
        events: [accepted, { ...accepted, id: 'again' }],
      }),
    /STOCK_EVENT_SEQUENCE/,
  );
  const undo = event(input, 'undo'),
    reject = event(input, 'reject');
  assert.equal(
    reconcileStock({ ...input, events: [accepted, undo, reject] }).review,
    'rejected',
  );
  assert.throws(
    () => reconcileStock({ ...input, events: [undo] }),
    /STOCK_EVENT_SEQUENCE/,
  );
  for (const field of [
    'confirmed',
    'mapVersion',
    'inventoryAccountSetVersion',
  ] as const) {
    const scope = {
      ...input.scope,
      [field]: field === 'confirmed' ? false : 'different',
    };
    assert.throws(
      () => reconcileStock({ ...input, scope, events: [accepted] }),
      /STOCK_(SCOPE|EVENT)/,
    );
  }
  for (const name of [
    'malformed-competitor-still-member',
    'opposite-account-differences-zero-grand',
    'unmapped-zero-gl-not-dropped',
  ]) {
    const { input: bad } = await fixture(name);
    bad.completeness = input.completeness;
    assert.throws(
      () => reconcileStock({ ...bad, events: [event(bad, 'accept')] }),
      /STOCK_EVENT_ACCEPT/,
    );
    assert.equal(
      reconcileStock({ ...bad, events: [event(bad, 'reject')] }).review,
      'rejected',
    );
  }
});
void test('Independent scope, role and capacity boundaries reject before authority or event clone', async () => {
  const { input } = await fixture();
  for (const [key, value] of [
    ['currencyBasis', 'presentation'],
    ['postingStatus', 'unposted'],
    ['currency', 'USD'],
    ['entity', ''],
    ['entity', 'x'.repeat(501)],
    ['asOf', '2026-02-30'],
  ]) {
    assert.throws(
      () =>
        reconcileStock({ ...input, scope: { ...input.scope, [key]: value } }),
      /STOCK_/,
    );
  }
  assert.throws(
    () =>
      reconcileStock({
        ...input,
        scope: {
          ...input.scope,
          confirmed: 'true',
        } as unknown as StockInput['scope'],
      }),
    /STOCK_SCOPE/,
  );
  assert.throws(
    () =>
      reconcileStock({
        ...input,
        readings: input.readings.map((r, i) => ({
          ...r,
          confirmed: i !== 1,
        })) as StockInput['readings'],
      }),
    /STOCK_READING/,
  );
  assert.throws(
    () =>
      assertStockEventBudget(
        Array.from({ length: 6 }, () => ({
          memberIds: Array(20000).fill('not cloned'),
        })),
      ),
    /STOCK_EVENT_CAPACITY/,
  );
  assertStockEventBudget(
    Array.from({ length: 5 }, () => ({
      memberIds: Array(20000).fill('not cloned'),
    })),
  );
  const parse = (s: string) => stockCSV(new TextEncoder().encode(s).buffer);
  assert.equal(parse('a,b\n'.repeat(20001)).length, 20001);
  assert.throws(() => parse('a,b\n'.repeat(20002)), /STOCK_SOURCE_LIMIT/);
  assert.equal(parse('x'.repeat(32767))[0][0].length, 32767);
  assert.throws(() => parse('x'.repeat(32768)), /STOCK_CELL_LIMIT/);
  assert.equal(parse('😀'.repeat(16383) + 'x')[0][0].length, 32767);
  assert.throws(() => parse('😀'.repeat(16384)), /STOCK_CELL_LIMIT/);
  assert.throws(() => stockCSV(Uint8Array.from([0xc0, 0xaf]).buffer));
  assert.throws(() => parse('"unterminated'), /STOCK_CSV/);
  assert.deepEqual(parse('"a,b","q""q"\r\n\r\n""\n'), [
    ['a,b', 'q"q'],
    [],
    [''],
  ]);
  const rows = input.files[0].sheets[0].rows;
  input.files[0].sheets[0].rows = [
    ...rows,
    ...Array.from({ length: 19994 }, () => []),
  ];
  assert.throws(() => reconcileStock(input), /STOCK_ROWS/);
});
