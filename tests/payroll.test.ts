import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { payrollFixture } from '../audit/payroll/fixtures.ts';
import {
  reconcilePayroll,
  assertPayrollEventBudget,
  type PayrollEvent,
} from '../lib/reconciliation/payroll.ts';
const cases: { name: string; kind: string }[] = JSON.parse(
  await readFile(
    new URL('../audit/payroll/cases.json', import.meta.url),
    'utf8',
  ),
);
void test('100 pre-engine payroll Decimal truths preserve every component, equation, account, missing, raw cell and malformed member', async () => {
  for (const c of cases) {
    const { state, truth } = await payrollFixture(c.name),
      before = structuredClone(state),
      r = reconcilePayroll(state);
    assert.equal(r.financial, truth.kind, c.name);
    assert.equal(r.decimals, truth.decimals, c.name);
    assert.deepEqual(r.totals, truth.totals, c.name);
    assert.deepEqual(r.comparisons, truth.comparisons, c.name);
    assert.deepEqual(r.bankComparison, truth.bankComparison, c.name);
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
void test('payroll review accepts only whole healthy component scope with completeness, atomic undo, exact hashes and malformed physical closure', async () => {
  const { state } = await payrollFixture();
  let r = reconcilePayroll(state);
  const event = (type: PayrollEvent['type'], id: string): PayrollEvent => ({
    id,
    type,
    memberIds: [...r.memberIds],
    context: r.context,
    at: '2026-10-07T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic whole payroll scope',
  });
  state.events = [event('accept', 'a')];
  assert.throws(() => reconcilePayroll(state), /EVENT_ACCEPT/);
  state.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic complete selected account set',
  };
  state.events = [];
  r = reconcilePayroll(state);
  state.events = [event('accept', 'a')];
  assert.equal(reconcilePayroll(state).status, 'consistent-with-evidence');
  const partial = structuredClone(state);
  partial.events[0].memberIds.pop();
  assert.throws(() => reconcilePayroll(partial), /EVENT_MEMBERS/);
  const foreign = structuredClone(state);
  foreign.scope.mapVersion = 'OTHER';
  assert.throws(() => reconcilePayroll(foreign), /EVENT/);
  state.events.push(event('undo', 'b'));
  assert.equal(reconcilePayroll(state).review, 'needs-review');
  state.events.push(event('reject', 'c'));
  assert.equal(reconcilePayroll(state).review, 'rejected');
  assert.throws(
    () =>
      reconcilePayroll({
        ...state,
        events: [...state.events, event('reject', 'd')],
      }),
    /EVENT_SEQUENCE/,
  );
  const bad = (
    await payrollFixture('malformed-register-competitor-full-member')
  ).state;
  {
    const result = reconcilePayroll(bad);
    assert.equal(result.memberIds.length, 39);
    assert.equal(result.financial, 'source-error');
    bad.events = [
      {
        ...event('reject', 'bad'),
        context: result.context,
        memberIds: result.memberIds,
      },
    ];
    assert.equal(reconcilePayroll(bad).review, 'rejected');
    assert.equal(reconcilePayroll(bad).totals, null);
    bad.events[0].type = 'accept';
    assert.throws(() => reconcilePayroll(bad), /EVENT_ACCEPT/);
  }
});
void test('payroll calendar, metadata, currency and event budgets reject before cloning; year zero cannot reach acceptance', async () => {
  const { state } = await payrollFixture();
  for (const date of ['0000-09-30', '2026-W40-3', '20260930', '2026-02-30'])
    assert.throws(
      () =>
        reconcilePayroll({
          ...state,
          scope: { ...state.scope, paymentDate: date },
        }),
      /VALIDITY/,
    );
  assert.throws(
    () =>
      reconcilePayroll({
        ...state,
        scope: { ...state.scope, confirmed: 1 as unknown as boolean },
      }),
    /SCOPE/,
  );
  assert.throws(
    () =>
      reconcilePayroll({
        ...state,
        scope: { ...state.scope, currencyBasis: 'presentation' },
      }),
    /SCOPE/,
  );
  assert.throws(
    () =>
      reconcilePayroll({
        ...state,
        scope: { ...state.scope, currency: 'USD' },
      }),
    /CURRENCY/,
  );
  assert.throws(
    () =>
      reconcilePayroll({
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
      assertPayrollEventBudget(
        Array.from({ length: 1001 }, () => ({ memberIds: [] })),
      ),
    /EVENT_CAPACITY/,
  );
  assertPayrollEventBudget(
    Array.from({ length: 5 }, () => ({ memberIds: Array(20000).fill('x') })),
  );
  assert.throws(
    () =>
      assertPayrollEventBudget(
        Array.from({ length: 6 }, () => ({
          memberIds: Array(20000).fill('x'),
        })),
      ),
    /EVENT_CAPACITY/,
  );
  const r = reconcilePayroll(state);
  assert.throws(
    () =>
      reconcilePayroll({
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
