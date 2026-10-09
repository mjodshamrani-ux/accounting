import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
import { stockFixture } from '../audit/inventory-register/fixtures.ts';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
  exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  reconcileStock,
  STOCK_VERSION,
  STOCK_HEADERS,
  type StockEvent,
} from '../lib/reconciliation/inventory-register.ts';
const cases: { case: string }[] = JSON.parse(
  await readFile(
    new URL('../audit/inventory-register/cases.json', import.meta.url),
    'utf8',
  ),
);
const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows
      .map((row) => row.map((v) => '"' + v.replace(/"/g, '""') + '"').join(','))
      .join('\n') + '\n',
  ).buffer;
void test('20,000 aggregate physical rows including blank originals are admitted; 20,001 are rejected before metadata clone', async () => {
  const { state } = await stockFixture(),
    base = new TextDecoder().decode(state.files[0].original);
  state.files[0] = await readStockFile(
    'source-0.csv',
    new TextEncoder().encode(base + '\n'.repeat(19993)).buffer,
  );
  const current = await replayStock(state);
  assert.equal(current.result.financial, 'ready');
  assert.equal(current.result.inventory.length, 20004);
  assert.equal(current.result.memberIds.length, 7);
  assert.equal(
    current.result.inventory.filter((v) => v.kind === 'blank').length,
    19993,
  );
  const restored = await restoreStock(await saveStock(state));
  assert.deepEqual(restored.result, current.result);
  state.files[0] = await readStockFile(
    'source-0.csv',
    new TextEncoder().encode(base + '\n'.repeat(19994)).buffer,
  );
  await assert.rejects(() => replayStock(state), /STOCK_ROWS/);
});
void test('Currency precisions remain monetary-only and signed GL intermediates cannot recover after exceeding bound', async () => {
  for (const [currency, expected] of [
    ['JPY', 1300],
    ['KWD', 1300000],
  ] as const) {
    const { state } = await stockFixture();
    state.scope.currency = currency;
    for (let i = 0; i < 4; i++) {
      const rows = structuredClone(state.files[i].sheets[0].rows),
        column = rows[0].indexOf('Currency');
      for (const row of rows.slice(1)) row[column] = currency;
      state.files[i] = await readStockFile(`source-${i}.csv`, csv(rows));
    }
    const r = (await replayStock(state)).result;
    assert.equal(r.financial, 'ready');
    assert.equal(r.totals?.registerMinor, expected);
    assert.equal(r.records[0][1].values[2], 35);
  }
  const { state } = await stockFixture(),
    scope = Object.values(state.scope).slice(0, 12) as string[];
  const records: string[][][] = [
    [0, 1, 2].map((i) => [
      String(i),
      'warehouse=W1',
      '0',
      'EA',
      '0',
      '0',
      `V-${i}`,
    ]),
    [0, 1, 2].map((i) => [
      `MAP-${i}`,
      String(i),
      'warehouse=W1',
      String(i),
      'branch=01',
      `POL-${i}`,
    ]),
    [0, 1, 2].map((i) => [
      `POL-${i}`,
      String(i),
      'warehouse=W1',
      'EA',
      '0',
      `V-${i}`,
      String(i),
      'branch=01',
      'inventory',
      'debit-positive',
      'provided-posted-carrying-value',
      '2026-01-01',
      '2026-12-31',
      'SYN',
    ]),
    [0, 1, 2].map((i) => [
      String(i),
      'branch=01',
      'inventory',
      i < 2 ? '1000000000000' : '0',
      i < 2 ? '0' : '1000000000000',
    ]),
  ];
  for (let i = 0; i < 4; i++)
    state.files[i] = await readStockFile(
      `source-${i}.csv`,
      csv([STOCK_HEADERS[i], ...records[i].map((v) => [...v, ...scope])]),
    );
  const r = (await replayStock(state)).result;
  assert.equal(r.financial, 'source-error');
  assert.equal(r.totals, null);
  assert.deepEqual(r.issues, [{ source: 3, row: 3, code: 'TOTAL_BOUND' }]);
  assert.ok(r.comparisons.every((v) => v.differenceMinor === null));
});
void test('Declared comma grammar retains malformed semicolon physical members and read/reconcile worker envelopes fail closed', async () => {
  const { state } = await stockFixture();
  const original =
    new TextDecoder().decode(state.files[0].original) +
    'bad;one\nbad;two\nbad;three\nbad;four\n';
  state.files[0] = await readStockFile(
    'source-0.csv',
    new TextEncoder().encode(original).buffer,
  );
  const fresh = await replayStock(state),
    r = fresh.result;
  assert.equal(r.memberIds.length, 11);
  assert.equal(r.issues.length, 4);
  assert.equal(r.totals, null);
  assert.equal(r.records[0].length, 2);
  validateWorkerValue('stock-reconcile', fresh, state);
  validateWorkerValue('stock-read', state.files[0], { name: 'source-0.csv' });
  assert.throws(
    () =>
      validateWorkerValue(
        'stock-reconcile',
        {
          ...fresh,
          result: { ...r, totals: { registerMinor: 130000, glMinor: 130000 } },
        },
        state,
      ),
    /STOCK_ENVELOPE/,
  );
  assert.throws(() =>
    validateWorkerValue('stock-read', state.files[0], { name: 'wrong.csv' }),
  );
  assert.throws(() => validateWorkerValue('stock-save', {}, state));
});
void test('Fresh four-original stock replay, strict sessions and 82 full native workbooks for all41 frozen truths', async () => {
  await mkdir('work/inventory-register/exports', { recursive: true });
  for (const c of cases) {
    const { state, truth } = await stockFixture(c.case),
      r = reconcileStock(state),
      fresh = await replayStock(state);
    assert.deepEqual(fresh.result, r, c.case);
    const session = await saveStock(state),
      restored = await restoreStock(session);
    assert.deepEqual(restored.result, r, c.case + ':session');
    assert.deepEqual(
      restored.state.files.map((f) => f.sha256),
      truth.expected.hashes,
      c.case + ':original hashes',
    );
    await writeFile(
      `work/inventory-register/exports/${c.case}-direct.xlsx`,
      new Uint8Array(await exportStock(state, r)),
    );
    await writeFile(
      `work/inventory-register/exports/${c.case}-restored.xlsx`,
      new Uint8Array(await exportStock(restored.state, restored.result)),
    );
  }
});
void test('Snapshots all4 original bytes and all metadata before first await; original hashes and forged cached money cannot authorize results', async () => {
  const { state } = await stockFixture(),
    expected = reconcileStock(state),
    names = state.files.map((f) => f.name);
  const native = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void,
    first = true;
  crypto.subtle.digest = (...args: Parameters<typeof native>) => {
    if (first) {
      first = false;
      return new Promise<ArrayBuffer>((resolve) => {
        release = () => {
          void native(...args).then(resolve);
        };
      });
    }
    return native(...args);
  };
  try {
    const pending = replayStock(state);
    assert.equal(typeof release, 'function', 'first hash await reached');
    state.files.forEach((f) => {
      new Uint8Array(f.original!).fill(0);
      f.name = 'changed.csv';
      f.sha256 = '0'.repeat(64);
    });
    state.scope.confirmed = false;
    state.scope.mapVersion = 'changed';
    state.readings[3].confirmed = false;
    state.completeness.confirmed = true;
    state.completeness.reference = 'changed';
    state.events.push({} as StockEvent);
    release();
    let fresh: Awaited<typeof pending> | undefined;
    await assert.doesNotReject(async () => {
      fresh = await pending;
    }, 'Owned original bytes and metadata must still resolve after caller edits');
    assert.ok(fresh);
    assert.deepEqual(fresh.result, expected);
    assert.deepEqual(
      fresh.state.files.map((f) => f.name),
      names,
    );
  } finally {
    crypto.subtle.digest = native;
  }
  const { state: cache } = await stockFixture();
  cache.files[0].sheets[0].rows[1][5] = '0';
  assert.equal(reconcileStock(cache).financial, 'difference');
  assert.equal((await replayStock(cache)).result.financial, 'ready');
  cache.files[3].sha256 = '0'.repeat(64);
  await assert.rejects(() => replayStock(cache), /STOCK_SOURCE_HASH/);
});
void test('Strict session/export authority and accepted/reject/undo whole-source membership native exports', async () => {
  const { state, truth } = await stockFixture();
  state.completeness = {
    confirmed: true,
    reference: 'SYNTHETIC inventory',
    note: 'Synthetic attestation; not field evidence',
  };
  const context = JSON.stringify([
    STOCK_VERSION,
    truth.expected.hashes,
    state.readings,
    state.scope,
    state.completeness,
  ]);
  const members = truth.expected.members.map(
    ([source, row]: [number, number]) =>
      JSON.stringify([
        STOCK_VERSION,
        source,
        truth.expected.hashes[source],
        0,
        row,
      ]),
  );
  const action = (type: StockEvent['type'], id: string): StockEvent => ({
    id,
    type,
    context,
    memberIds: members,
    at: '2026-10-08T01:00:00.000Z',
    reference: 'SYNTHETIC',
    note: 'Whole supplied scope only',
  });
  for (const [name, actions, status] of [
    ['accepted', [action('accept', 'a')], 'consistent-with-evidence'],
    ['undo', [action('accept', 'a'), action('undo', 'u')], 'needs-review'],
    ['reject', [action('reject', 'r')], 'needs-review'],
  ] as const) {
    state.events = [...actions];
    const r = reconcileStock(state);
    assert.equal(r.status, status);
    await writeFile(
      `work/inventory-register/exports/event-${name}.xlsx`,
      new Uint8Array(await exportStock(state, r)),
    );
  }
  state.events = [];
  const r = reconcileStock(state);
  await assert.rejects(
    () =>
      exportStock(state, { ...r, totals: { registerMinor: 0, glMinor: 0 } }),
    /STOCK_STALE_EXPORT/,
  );
  const raw = JSON.parse(new TextDecoder().decode(await saveStock(state)));
  for (const forged of [
    { ...raw, result: r },
    { ...raw, format: 'other' },
    { ...raw, files: raw.files.map((f: object) => ({ ...f, sheets: [] })) },
  ])
    await assert.rejects(
      () =>
        restoreStock(new TextEncoder().encode(JSON.stringify(forged)).buffer),
      /STOCK_SESSION/,
    );
  const { state: bad, truth: badTruth } = await stockFixture(
    'malformed-competitor-still-member',
  );
  const badContext = JSON.stringify([
    STOCK_VERSION,
    badTruth.expected.hashes,
    bad.readings,
    bad.scope,
    bad.completeness,
  ]);
  bad.events = [
    {
      ...action('reject', 'malformed'),
      context: badContext,
      memberIds: badTruth.expected.members.map(
        ([source, row]: [number, number]) =>
          JSON.stringify([
            STOCK_VERSION,
            source,
            badTruth.expected.hashes[source],
            0,
            row,
          ]),
      ),
    },
  ];
  assert.equal(bad.events[0].memberIds.length, 8);
  const blocked = reconcileStock(bad);
  assert.equal(blocked.totals, null);
  assert.equal(blocked.review, 'rejected');
  await writeFile(
    'work/inventory-register/exports/event-malformed-reject.xlsx',
    new Uint8Array(await exportStock(bad, blocked)),
  );
});
