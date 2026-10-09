import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { payrollFixture } from '../audit/payroll/fixtures.ts';
import {
  readPayrollFile,
  replayPayroll,
  savePayroll,
  restorePayroll,
  exportPayroll,
} from '../lib/reconciliation/payroll-io.ts';
import {
  reconcilePayroll,
  type PayrollEvent,
} from '../lib/reconciliation/payroll.ts';
const cases: { name: string }[] = JSON.parse(
  await readFile(
    new URL('../audit/payroll/cases.json', import.meta.url),
    'utf8',
  ),
);
const out = 'work/payroll/exports';
void test('fresh five-original payroll IO and strict sessions export 200 full native workbooks for 100 independent frozen component truths', async () => {
  await mkdir(out, { recursive: true });
  for (const c of cases) {
    const { state, truth } = await payrollFixture(c.name),
      fresh = await replayPayroll(state);
    assert.equal(fresh.result.financial, truth.kind, c.name);
    assert.deepEqual(fresh.result.totals, truth.totals, c.name);
    assert.deepEqual(fresh.result.comparisons, truth.comparisons, c.name);
    assert.deepEqual(fresh.result.bankComparison, truth.bankComparison, c.name);
    await writeFile(
      `${out}/${c.name}.xlsx`,
      new Uint8Array(await exportPayroll(state, fresh.result)),
    );
    const session = await savePayroll(state),
      restored = await restorePayroll(session);
    assert.deepEqual(restored.result, fresh.result, c.name);
    await writeFile(`${out}/${c.name}.json`, new Uint8Array(session));
    await writeFile(
      `${out}/${c.name}-restored.xlsx`,
      new Uint8Array(await exportPayroll(restored.state, restored.result)),
    );
  }
});
void test('payroll read, replay, save and export capture all source bytes and metadata before the first asynchronous digest', async () => {
  const native: typeof crypto.subtle.digest = Reflect.get(
    crypto.subtle,
    'digest',
  );
  for (const operation of ['read', 'replay', 'save', 'export'] as const) {
    const { state } = await payrollFixture(),
      originals = state.files.map((f) => f.original!.slice(0)),
      expected = reconcilePayroll(state);
    let release: () => void = () => {},
      calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    crypto.subtle.digest = async function (algorithm, data) {
      if (++calls === 1) await gate;
      return native.call(this, algorithm, data);
    };
    try {
      const pending =
        operation === 'read'
          ? readPayrollFile(state.files[0].name, state.files[0].original!)
          : operation === 'replay'
            ? replayPayroll(state)
            : operation === 'save'
              ? savePayroll(state)
              : exportPayroll(state, expected);
      assert.equal(calls, 1);
      state.files.forEach((f, i) => {
        new Uint8Array(f.original!).fill(0);
        f.name = 'replacement-' + i + '.csv';
        f.sha256 = '0'.repeat(64);
        f.sheets[0].rows[1][0] = 'FORGED';
        state.readings[i].confirmed = false;
      });
      state.scope.entity = 'OTHER';
      state.completeness = {
        confirmed: true,
        reference: 'OTHER',
        note: 'OTHER',
      };
      state.events.push({
        id: 'bad',
        type: 'accept',
        memberIds: [],
        context: 'bad',
        at: 'bad',
        reference: 'bad',
        note: 'bad',
      });
      release();
      let result: Awaited<typeof pending> | undefined;
      await assert.doesNotReject(async () => {
        result = await pending;
      }, 'Owned payroll source snapshot must still resolve after caller edits');
      assert.ok(result);
      if (operation === 'read')
        assert.deepEqual(
          (result as Awaited<ReturnType<typeof readPayrollFile>>).original,
          originals[0],
        );
      else if (operation === 'replay')
        assert.deepEqual(
          (result as Awaited<ReturnType<typeof replayPayroll>>).result,
          expected,
        );
      else if (operation === 'save')
        assert.deepEqual(
          (await restorePayroll(result as ArrayBuffer)).result,
          expected,
        );
      else assert.ok((result as ArrayBuffer).byteLength > 0);
    } finally {
      release();
      crypto.subtle.digest = native;
    }
  }
  const { state } = await payrollFixture();
  state.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(replayPayroll(state), /SOURCE_HASH/);
  const forged = (await payrollFixture()).state;
  forged.files[0].sheets[0].rows[1][2] = '900';
  assert.deepEqual(
    (await replayPayroll(forged)).result.totals,
    (await payrollFixture()).truth.totals,
  );
});
void test('strict payroll sessions, stale exports and complete accepted/undo/reject physical scope retain native evidence', async () => {
  const { state } = await payrollFixture();
  const before = await savePayroll(state),
    session = JSON.parse(new TextDecoder().decode(before));
  const encode = (v: unknown) =>
    new TextEncoder().encode(JSON.stringify(v)).buffer;
  for (const mutate of [
    (v: typeof session) => {
      v.injected = true;
    },
    (v: typeof session) => {
      v.files[0].extra = true;
    },
    (v: typeof session) => {
      v.scope.currency = 'USD';
    },
    (v: typeof session) => {
      v.files[0].sha256 = '0'.repeat(64);
    },
    (v: typeof session) => {
      v.events = Array.from({ length: 6 }, () => ({
        memberIds: Array(20000).fill('x'),
      }));
    },
  ]) {
    const tampered = structuredClone(session);
    mutate(tampered);
    await assert.rejects(restorePayroll(encode(tampered)));
  }
  const result = (await replayPayroll(state)).result;
  const invented = structuredClone(result);
  invented.totals!.register.gross = 999;
  await assert.rejects(exportPayroll(state, invented), /STALE_EXPORT/);
  state.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic complete selected payroll accounts and bank payout',
  };
  let r = (await replayPayroll(state)).result;
  const event = (type: PayrollEvent['type'], id: string): PayrollEvent => ({
    id,
    type,
    context: r.context,
    memberIds: [...r.memberIds],
    at: '2026-10-07T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic whole payroll component scope',
  });
  for (const [type, id] of [
    ['accept', 'a'],
    ['undo', 'b'],
    ['reject', 'c'],
  ] as const) {
    state.events.push(event(type, id));
    r = (await replayPayroll(state)).result;
    await writeFile(
      `${out}/event-${type}.xlsx`,
      new Uint8Array(await exportPayroll(state, r)),
    );
  }
  assert.equal(r.review, 'rejected');
  const bad = (
    await payrollFixture('malformed-register-competitor-full-member')
  ).state;
  const blocked = (await replayPayroll(bad)).result;
  assert.equal(blocked.memberIds.length, 39);
  bad.events = [
    {
      ...event('reject', 'bad'),
      context: blocked.context,
      memberIds: [...blocked.memberIds],
    },
  ];
  const rejected = (await replayPayroll(bad)).result;
  assert.equal(rejected.review, 'rejected');
  assert.equal(rejected.totals, null);
  await writeFile(
    `${out}/event-malformed-reject.xlsx`,
    new Uint8Array(await exportPayroll(bad, rejected)),
  );
});
void test('declared payroll comma parsing retains malformed records and every blank physical row through the aggregate limit', async () => {
  const { state } = await payrollFixture();
  state.files[0] = await readPayrollFile(
    state.files[0].name,
    new TextEncoder().encode(
      new TextDecoder().decode(state.files[0].original) +
        'bad;one\nbad;two\nbad;three\nbad;four\n',
    ).buffer,
  );
  const broken = await replayPayroll(state);
  assert.equal(broken.result.memberIds.length, 42);
  assert.equal(broken.result.records[0].length, 2);
  assert.equal(broken.result.totals, null);
  assert.equal(broken.result.issues.length, 4);
  const valid = (await payrollFixture()).state,
    base = new TextDecoder().decode(valid.files[0].original);
  valid.files[0] = await readPayrollFile(
    valid.files[0].name,
    new TextEncoder().encode(base + '\n'.repeat(19962)).buffer,
  );
  const full = await replayPayroll(valid);
  assert.equal(full.result.inventory.length, 20005);
  assert.equal(full.result.memberIds.length, 38);
  assert.equal(full.result.financial, 'ready');
  assert.deepEqual(
    (await restorePayroll(await savePayroll(valid))).result,
    full.result,
  );
  valid.files[0] = await readPayrollFile(
    valid.files[0].name,
    new TextEncoder().encode(base + '\n'.repeat(19963)).buffer,
  );
  await assert.rejects(replayPayroll(valid), /ROWS/);
  for (const original of [
    new Uint8Array([0xff, 0xfe]).buffer,
    new TextEncoder().encode('"unterminated').buffer,
  ])
    await assert.rejects(readPayrollFile('bad.csv', original));
});
void test('payroll worker response guard checks full recomputed component result, strict read identity and binary outputs', async () => {
  const { validateWorkerValue } =
    await import('../lib/reconciliation/protocol.ts');
  const { state } = await payrollFixture(),
    fresh = await replayPayroll(state);
  validateWorkerValue('payroll-reconcile', fresh, state);
  validateWorkerValue('payroll-restore', fresh, {
    buffer: await savePayroll(state),
  });
  const forged = structuredClone(fresh);
  forged.result.totals!.register.gross = 99;
  assert.throws(
    () => validateWorkerValue('payroll-reconcile', forged, state),
    /ENVELOPE/,
  );
  validateWorkerValue('payroll-read', fresh.state.files[0], {
    name: fresh.state.files[0].name,
  });
  assert.throws(() =>
    validateWorkerValue('payroll-read', fresh.state.files[0], {
      name: 'other.csv',
    }),
  );
  assert.throws(() =>
    validateWorkerValue(
      'payroll-export',
      { buffer: new ArrayBuffer(4) },
      { state, result: fresh.result },
    ),
  );
});
void test('payroll reference closure, restore byte snapshot and aggregate budgets use all five originals without financial aliases', async () => {
  const csv = (rows: string[][]) =>
    new TextEncoder().encode(
      rows
        .map((row) =>
          row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','),
        )
        .join('\n') + '\n',
    ).buffer;
  for (const count of [501, 2000, 2001]) {
    const { state } = await payrollFixture();
    for (const source of [0, 2]) {
      const rows = structuredClone(state.files[source].sheets[0].rows),
        column = rows[0].indexOf('Payroll reference');
      for (const row of rows.slice(1))
        if (row[rows[0].indexOf('Employee ID')] === 'A')
          row[column] = 'R'.repeat(count);
      state.files[source] = await readPayrollFile(
        state.files[source].name,
        csv(rows),
      );
    }
    const fresh = await replayPayroll(state);
    assert.equal(
      fresh.result.financial,
      count <= 2000 ? 'ready' : 'source-error',
    );
    assert.deepEqual(
      (await restorePayroll(await savePayroll(state))).result,
      fresh.result,
    );
    assert.ok((await exportPayroll(state, fresh.result)).byteLength);
  }
  const { state } = await payrollFixture(),
    session = await savePayroll(state),
    expected = (await replayPayroll(state)).result;
  const native: typeof crypto.subtle.digest = Reflect.get(
    crypto.subtle,
    'digest',
  );
  let release: () => void = () => {},
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  crypto.subtle.digest = async function (a, b) {
    if (++calls === 1) await gate;
    return native.call(this, a, b);
  };
  try {
    const pending = restorePayroll(session);
    assert.equal(calls, 1);
    new Uint8Array(session).fill(0);
    release();
    assert.deepEqual((await pending).result, expected);
  } finally {
    release();
    crypto.subtle.digest = native;
  }
  const oversized = structuredClone(state);
  for (const f of oversized.files)
    f.original = new ArrayBuffer(7 * 1024 * 1024);
  const clone = globalThis.structuredClone;
  let cloned = false;
  globalThis.structuredClone = (...args) => {
    cloned = true;
    return clone(...args);
  };
  try {
    await assert.rejects(replayPayroll(oversized), /SOURCE_CAPACITY/);
    assert.equal(cloned, false);
  } finally {
    globalThis.structuredClone = clone;
  }
  const running = structuredClone(state),
    rows = structuredClone(running.files[3].sheets[0].rows),
    template = rows[1];
  rows.splice(1, rows.length - 1);
  for (const [i, values] of [
    ['0', ['1000000000000', '0']],
    ['1', ['1000000000000', '0']],
    ['2', ['0', '1000000000000']],
  ] as const) {
    const r = [...template];
    r[0] = 'BOUND-' + i;
    r[3] = 'GL-BOUND-' + i;
    [r[6], r[7]] = values;
    rows.push(r);
  }
  running.files[3] = await readPayrollFile(running.files[3].name, csv(rows));
  const blocked = (await replayPayroll(running)).result;
  assert.equal(blocked.financial, 'source-error');
  assert.ok(
    blocked.issues.some((v) => v.code === 'AGGREGATE_BOUND' && v.row === 3),
  );
  assert.equal(blocked.totals, null);
  assert.equal(blocked.bankComparison.difference, null);
});
