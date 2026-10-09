import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assetFixture } from '../audit/fixed-assets/fixtures.ts';
import {
  reconcileAsset,
  assertAssetEventBudget,
  type AssetEvent,
} from '../lib/reconciliation/fixed-assets.ts';
const cases: { name: string; kind: string }[] = JSON.parse(
  await readFile(
    new URL('../audit/fixed-assets/cases.json', import.meta.url),
    'utf8',
  ),
);
void test('61 pre-engine asset Decimal truths preserve every component, equation, account, missing, raw cell and malformed member', async () => {
  for (const c of cases) {
    const { state, truth } = await assetFixture(c.name),
      before = structuredClone(state),
      r = reconcileAsset(state);
    assert.equal(r.financial, truth.kind, c.name);
    assert.equal(r.decimals, truth.decimals, c.name);
    assert.deepEqual(r.totals, truth.totals, c.name);
    assert.deepEqual(r.comparisons, truth.comparisons, c.name);
    assert.deepEqual(
      r.records.map((rows) => rows.map(({ memberId: _, ...row }) => row)),
      truth.records,
      c.name,
    );
    // Standard-library calendar exceptions are normalized to the product validity code;
    // positions, counts, values and every other issue code remain independently asserted.
    assert.deepEqual(
      r.issues.map((i) => [i.source, i.row, i.code]),
      truth.issues.map(([source, row, code]: [number, number, string]) => [
        source,
        row,
        ['DATE', 'year 0 is out of range'].includes(code) ? 'VALIDITY' : code,
      ]),
      c.name,
    );
    assert.deepEqual(r.missing, truth.missing, c.name);
    assert.deepEqual(
      r.inventory.map((i) => [i.source, i.row, i.kind]),
      truth.inventory,
      c.name,
    );
    assert.deepEqual(
      r.cells.map((i) => [i.source, i.row, i.column, i.field, i.text]),
      truth.cells,
      c.name,
    );
    assert.deepEqual(
      r.memberIds.map((id) => {
        const a = JSON.parse(id);
        return [a[1], a[4]];
      }),
      truth.members,
      c.name,
    );
    assert.deepEqual(state, before, c.name + ':input immutable');
  }
});
void test('asset review accepts only whole healthy component scope with completeness, atomic undo, exact hashes and malformed physical closure', async () => {
  const { state } = await assetFixture();
  let r = reconcileAsset(state);
  const event = (type: AssetEvent['type'], id: string): AssetEvent => ({
    id,
    type,
    memberIds: [...r.memberIds],
    context: r.context,
    at: '2026-10-07T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic whole asset scope',
  });
  state.events = [event('accept', 'a')];
  assert.throws(() => reconcileAsset(state), /EVENT_ACCEPT/);
  state.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic complete selected account set',
  };
  state.events = [];
  r = reconcileAsset(state);
  state.events = [event('accept', 'a')];
  assert.equal(reconcileAsset(state).status, 'consistent-with-evidence');
  const partial = structuredClone(state);
  partial.events[0].memberIds.pop();
  assert.throws(() => reconcileAsset(partial), /EVENT_MEMBERS/);
  const foreign = structuredClone(state);
  foreign.scope.mapVersion = 'OTHER';
  assert.throws(() => reconcileAsset(foreign), /EVENT/);
  state.events.push(event('undo', 'b'));
  assert.equal(reconcileAsset(state).review, 'needs-review');
  state.events.push(event('reject', 'c'));
  assert.equal(reconcileAsset(state).review, 'rejected');
  assert.throws(
    () =>
      reconcileAsset({
        ...state,
        events: [...state.events, event('reject', 'd')],
      }),
    /EVENT_SEQUENCE/,
  );
  const bad = (await assetFixture('malformed-register-competitor-full-member'))
    .state;
  {
    const result = reconcileAsset(bad);
    assert.equal(result.memberIds.length, 18);
    assert.equal(result.financial, 'source-error');
    bad.events = [
      {
        ...event('reject', 'bad'),
        context: result.context,
        memberIds: result.memberIds,
      },
    ];
    assert.equal(reconcileAsset(bad).review, 'rejected');
    assert.equal(reconcileAsset(bad).totals, null);
    bad.events[0].type = 'accept';
    assert.throws(() => reconcileAsset(bad), /EVENT_ACCEPT/);
  }
});
void test('asset calendar, metadata, currency and event budgets reject before cloning; year zero cannot reach acceptance', async () => {
  const { state } = await assetFixture();
  for (const date of ['0000-09-30', '2026-W40-3', '20260930', '2026-02-30'])
    assert.throws(
      () => reconcileAsset({ ...state, scope: { ...state.scope, asOf: date } }),
      /VALIDITY/,
    );
  assert.throws(
    () =>
      reconcileAsset({
        ...state,
        scope: { ...state.scope, confirmed: 1 as unknown as boolean },
      }),
    /SCOPE/,
  );
  assert.throws(
    () =>
      reconcileAsset({
        ...state,
        scope: { ...state.scope, currencyBasis: 'presentation' },
      }),
    /SCOPE/,
  );
  assert.throws(
    () =>
      reconcileAsset({ ...state, scope: { ...state.scope, currency: 'USD' } }),
    /CURRENCY/,
  );
  assert.throws(
    () =>
      reconcileAsset({
        ...state,
        readings: [
          { ...state.readings[0], role: 'gl' },
          ...state.readings.slice(1),
        ] as typeof state.readings,
      }),
    /READING/,
  );
  assert.throws(
    () =>
      assertAssetEventBudget(
        Array.from({ length: 1001 }, () => ({ memberIds: [] })),
      ),
    /EVENT_CAPACITY/,
  );
  assertAssetEventBudget(
    Array.from({ length: 5 }, () => ({ memberIds: Array(20000).fill('x') })),
  );
  assert.throws(
    () =>
      assertAssetEventBudget(
        Array.from({ length: 6 }, () => ({
          memberIds: Array(20000).fill('x'),
        })),
      ),
    /EVENT_CAPACITY/,
  );
  const r = reconcileAsset(state);
  assert.throws(
    () =>
      reconcileAsset({
        ...state,
        events: [
          {
            id: 'zero',
            type: 'reject',
            memberIds: r.memberIds,
            context: r.context,
            at: '0000-01-01T00:00:00.000Z',
            reference: 'SYN',
            note: 'SYN',
          },
        ],
      }),
    /EVENT/,
  );
});
