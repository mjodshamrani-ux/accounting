import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assetFixture } from '../audit/fixed-assets/fixtures.ts';
import {
  readAssetFile,
  replayAsset,
  saveAsset,
  restoreAsset,
  exportAsset,
} from '../lib/reconciliation/fixed-assets-io.ts';
import {
  reconcileAsset,
  type AssetEvent,
} from '../lib/reconciliation/fixed-assets.ts';
const cases: { name: string }[] = JSON.parse(
  await readFile(
    new URL('../audit/fixed-assets/cases.json', import.meta.url),
    'utf8',
  ),
);
const out = 'work/fixed-assets/exports';
void test('fresh four-original asset IO and strict sessions export 122 full native workbooks for 61 independent frozen component truths', async () => {
  await mkdir(out, { recursive: true });
  for (const c of cases) {
    const { state, truth } = await assetFixture(c.name),
      fresh = await replayAsset(state);
    assert.equal(fresh.result.financial, truth.kind, c.name);
    assert.deepEqual(fresh.result.totals, truth.totals, c.name);
    assert.deepEqual(fresh.result.comparisons, truth.comparisons, c.name);
    await writeFile(
      `${out}/${c.name}.xlsx`,
      new Uint8Array(await exportAsset(state, fresh.result)),
    );
    const session = await saveAsset(state),
      restored = await restoreAsset(session);
    assert.deepEqual(restored.result, fresh.result, c.name);
    await writeFile(`${out}/${c.name}.json`, new Uint8Array(session));
    await writeFile(
      `${out}/${c.name}-restored.xlsx`,
      new Uint8Array(await exportAsset(restored.state, restored.result)),
    );
  }
});
void test('asset read, replay, save and export capture all source bytes and metadata before the first asynchronous digest', async () => {
  const native: typeof crypto.subtle.digest = Reflect.get(
    crypto.subtle,
    'digest',
  );
  for (const operation of ['read', 'replay', 'save', 'export'] as const) {
    const { state } = await assetFixture(),
      originals = state.files.map((f) => f.original!.slice(0)),
      expected = reconcileAsset(state);
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
          ? readAssetFile(state.files[0].name, state.files[0].original!)
          : operation === 'replay'
            ? replayAsset(state)
            : operation === 'save'
              ? saveAsset(state)
              : exportAsset(state, expected);
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
      }, 'Owned asset source snapshot must still resolve after caller edits');
      assert.ok(result);
      if (operation === 'read')
        assert.deepEqual(
          (result as Awaited<ReturnType<typeof readAssetFile>>).original,
          originals[0],
        );
      else if (operation === 'replay')
        assert.deepEqual(
          (result as Awaited<ReturnType<typeof replayAsset>>).result,
          expected,
        );
      else if (operation === 'save')
        assert.deepEqual(
          (await restoreAsset(result as ArrayBuffer)).result,
          expected,
        );
      else assert.ok((result as ArrayBuffer).byteLength > 0);
    } finally {
      release();
      crypto.subtle.digest = native;
    }
  }
  const { state } = await assetFixture();
  state.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(replayAsset(state), /SOURCE_HASH/);
  const forged = (await assetFixture()).state;
  forged.files[0].sheets[0].rows[1][2] = '900';
  assert.deepEqual((await replayAsset(forged)).result.totals, {
    register: {
      cost: 140000,
      depreciation: 30000,
      impairment: 5000,
      carrying: 105000,
    },
    gl: {
      cost: 140000,
      depreciation: 30000,
      impairment: 5000,
      carrying: 105000,
    },
  });
});
void test('strict asset sessions, stale exports and complete accepted/undo/reject physical scope retain native evidence', async () => {
  const { state } = await assetFixture();
  const before = await saveAsset(state),
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
    await assert.rejects(restoreAsset(encode(tampered)));
  }
  const result = (await replayAsset(state)).result;
  const invented = structuredClone(result);
  invented.totals!.register.cost = 999;
  await assert.rejects(exportAsset(state, invented), /STALE_EXPORT/);
  state.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic complete selected asset accounts',
  };
  let r = (await replayAsset(state)).result;
  const event = (type: AssetEvent['type'], id: string): AssetEvent => ({
    id,
    type,
    context: r.context,
    memberIds: [...r.memberIds],
    at: '2026-10-07T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic whole asset component scope',
  });
  for (const [type, id] of [
    ['accept', 'a'],
    ['undo', 'b'],
    ['reject', 'c'],
  ] as const) {
    state.events.push(event(type, id));
    r = (await replayAsset(state)).result;
    await writeFile(
      `${out}/event-${type}.xlsx`,
      new Uint8Array(await exportAsset(state, r)),
    );
  }
  assert.equal(r.review, 'rejected');
  const bad = (await assetFixture('malformed-register-competitor-full-member'))
    .state;
  const blocked = (await replayAsset(bad)).result;
  assert.equal(blocked.memberIds.length, 18);
  bad.events = [
    {
      ...event('reject', 'bad'),
      context: blocked.context,
      memberIds: [...blocked.memberIds],
    },
  ];
  const rejected = (await replayAsset(bad)).result;
  assert.equal(rejected.review, 'rejected');
  assert.equal(rejected.totals, null);
  await writeFile(
    `${out}/event-malformed-reject.xlsx`,
    new Uint8Array(await exportAsset(bad, rejected)),
  );
});
void test('declared asset comma parsing retains malformed records and every blank physical row through the aggregate limit', async () => {
  const { state } = await assetFixture();
  state.files[0] = await readAssetFile(
    state.files[0].name,
    new TextEncoder().encode(
      new TextDecoder().decode(state.files[0].original) +
        'bad;one\nbad;two\nbad;three\nbad;four\n',
    ).buffer,
  );
  const broken = await replayAsset(state);
  assert.equal(broken.result.memberIds.length, 21);
  assert.equal(broken.result.records[0].length, 2);
  assert.equal(broken.result.totals, null);
  assert.equal(broken.result.issues.length, 4);
  const valid = (await assetFixture()).state,
    base = new TextDecoder().decode(valid.files[0].original);
  valid.files[0] = await readAssetFile(
    valid.files[0].name,
    new TextEncoder().encode(base + '\n'.repeat(19983)).buffer,
  );
  const full = await replayAsset(valid);
  assert.equal(full.result.inventory.length, 20004);
  assert.equal(full.result.memberIds.length, 17);
  assert.equal(full.result.financial, 'ready');
  assert.deepEqual(
    (await restoreAsset(await saveAsset(valid))).result,
    full.result,
  );
  valid.files[0] = await readAssetFile(
    valid.files[0].name,
    new TextEncoder().encode(base + '\n'.repeat(19984)).buffer,
  );
  await assert.rejects(replayAsset(valid), /ROWS/);
  for (const original of [
    new Uint8Array([0xff, 0xfe]).buffer,
    new TextEncoder().encode('"unterminated').buffer,
  ])
    await assert.rejects(readAssetFile('bad.csv', original));
});
void test('asset worker response guard checks full recomputed component result, strict read identity and binary outputs', async () => {
  const { validateWorkerValue } =
    await import('../lib/reconciliation/protocol.ts');
  const { state } = await assetFixture(),
    fresh = await replayAsset(state);
  validateWorkerValue('asset-reconcile', fresh, state);
  validateWorkerValue('asset-restore', fresh, {
    buffer: await saveAsset(state),
  });
  const forged = structuredClone(fresh);
  forged.result.totals!.register.cost = 99;
  assert.throws(
    () => validateWorkerValue('asset-reconcile', forged, state),
    /ENVELOPE/,
  );
  validateWorkerValue('asset-read', fresh.state.files[0], {
    name: fresh.state.files[0].name,
  });
  assert.throws(() =>
    validateWorkerValue('asset-read', fresh.state.files[0], {
      name: 'other.csv',
    }),
  );
  assert.throws(() =>
    validateWorkerValue(
      'asset-export',
      { buffer: new ArrayBuffer(4) },
      { state, result: fresh.result },
    ),
  );
});
void test('asset derived difference remains exact at twice the bounded input when GL normal has opposite sign', async () => {
  const { state } = await assetFixture('minor-bound-inclusive');
  const rows = structuredClone(state.files[3].sheets[0].rows);
  rows[1][rows[0].indexOf('Debit')] = '0';
  rows[1][rows[0].indexOf('Credit')] = '1000000000000';
  const csv =
    rows
      .map((row) =>
        row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(','),
      )
      .join('\n') + '\n';
  state.files[3] = await readAssetFile(
    state.files[3].name,
    new TextEncoder().encode(csv).buffer,
  );
  const r = (await replayAsset(state)).result;
  assert.equal(r.financial, 'difference');
  assert.equal(r.totals!.register.cost, 100000000000000);
  assert.equal(r.totals!.gl.cost, -100000000000000);
  assert.equal(r.comparisons[0].difference, 200000000000000);
  assert.ok(Number.isSafeInteger(r.comparisons[0].difference));
  await mkdir('work/fixed-assets/derived-bound', { recursive: true });
  for (let i = 0; i < 4; i++)
    await writeFile(
      `work/fixed-assets/derived-bound/source-${i}.csv`,
      new Uint8Array(state.files[i].original!),
    );
  await writeFile(
    'work/fixed-assets/derived-bound/scope.json',
    JSON.stringify(
      Object.fromEntries(
        Object.entries(state.scope).filter(([k]) => k !== 'confirmed'),
      ),
    ) + '\n',
  );
  await writeFile(
    'work/fixed-assets/derived-bound/result.json',
    JSON.stringify(r) + '\n',
  );
  await writeFile(
    'work/fixed-assets/derived-bound/result.xlsx',
    new Uint8Array(await exportAsset(state, r)),
  );
});
