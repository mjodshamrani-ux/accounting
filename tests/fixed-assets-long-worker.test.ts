import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import {
  replayAsset,
  saveAsset,
  validateAssetWorkerResponse,
} from '../lib/reconciliation/fixed-assets-io.ts';
import { assetLongFixture } from './helpers/fixed-assets-long-fixtures.ts';
import { ASSET_VERSION } from '../lib/reconciliation/fixed-assets.ts';
import {
  AssetLongPort,
  type AssetLongResponse,
} from './helpers/fixed-assets-long-port.ts';
void test('actual asset worker reads four CSV originals, reconciles forged cache, saves/restores and exports long family', async () => {
  const ports: AssetLongPort[] = [],
    client = createWorkerClient(() => {
      const p = new AssetLongPort();
      ports.push(p);
      return p;
    });
  try {
    const state = await assetLongFixture(),
      expected = await replayAsset(state);
    for (const f of state.files)
      assert.deepEqual(
        await client.request('asset-read', {
          name: f.name,
          buffer: f.original,
        }),
        f,
      );
    state.files[0].sheets[0].rows[1][3] = 'FORGED';
    const result = await client.request<typeof expected>(
      'asset-reconcile',
      state,
    );
    assert.deepEqual(result, expected);
    const saved = await client.request<ArrayBuffer>('asset-save', state);
    const restored = await client.request<typeof expected>('asset-restore', {
      buffer: saved,
    });
    assert.deepEqual(restored, expected);
    assert.ok(
      (
        await client.request<ArrayBuffer>('asset-export', {
          state,
          result: expected.result,
        })
      ).byteLength > 0,
    );
    const stale = structuredClone(expected.result);
    stale.totals!.register.cost++;
    await assert.rejects(
      client.request('asset-export', { state, result: stale }),
      /STALE_EXPORT/,
    );
  } finally {
    ports.forEach((p) => p.terminate());
  }
});
void test('actual worker replies with forged totals, context, original bytes, parsed caches, family, valid foreign result or binary are rejected', async () => {
  const alternate = await replayAsset(
    await assetLongFixture('10-all-zero-members-retained'),
  );
  for (const mutate of [
    (r: AssetLongResponse) => {
      (r.value as Awaited<ReturnType<typeof replayAsset>>).result.totals!
        .register.cost++;
    },
    (r: AssetLongResponse) => {
      (r.value as Awaited<ReturnType<typeof replayAsset>>).result.context =
        'FORGED';
    },
    (r: AssetLongResponse) => {
      new Uint8Array(
        (r.value as Awaited<ReturnType<typeof replayAsset>>).state.files[0]
          .original!,
      )[0] ^= 1;
    },
    (r: AssetLongResponse) => {
      (
        r.value as Awaited<ReturnType<typeof replayAsset>>
      ).state.files[0].sheets[0].rows[1][3] = '500';
    },
    (r: AssetLongResponse) => {
      (
        r.value as Awaited<ReturnType<typeof replayAsset>>
      ).state.readings[0].family = ASSET_VERSION;
    },
    (r: AssetLongResponse) => {
      r.value = structuredClone(alternate);
    },
  ]) {
    const ports: AssetLongPort[] = [],
      client = createWorkerClient(() => {
        const p = new AssetLongPort((r, deliver) => {
          if (r.ok && r.action === 'asset-reconcile') mutate(r);
          deliver(r);
        });
        ports.push(p);
        return p;
      });
    try {
      await assert.rejects(
        client.request('asset-reconcile', await assetLongFixture()),
      );
      assert.ok(ports[0].terminated);
    } finally {
      ports.forEach((p) => p.terminate());
    }
  }
  for (const action of ['asset-save', 'asset-export'] as const) {
    const ports: AssetLongPort[] = [],
      client = createWorkerClient(() => {
        const p = new AssetLongPort((r, deliver) => {
          if (r.ok) r.value = new ArrayBuffer(4);
          deliver(r);
        });
        ports.push(p);
        return p;
      });
    const state = await assetLongFixture(),
      result = (await replayAsset(state)).result;
    try {
      await assert.rejects(
        client.request(
          action,
          action === 'asset-save' ? state : { state, result },
        ),
      );
    } finally {
      ports.forEach((p) => p.terminate());
    }
  }
});
void test('actual restore cannot substitute another valid complete session and input snapshot binds a later response', async () => {
  const state = await assetLongFixture(),
    expected = await replayAsset(state),
    alternate = await replayAsset(
      await assetLongFixture('10-all-zero-members-retained'),
    );
  const ports: AssetLongPort[] = [],
    client = createWorkerClient(() => {
      const p = new AssetLongPort((r, deliver) => {
        if (r.ok && r.action === 'asset-restore') r.value = alternate;
        deliver(r);
      });
      ports.push(p);
      return p;
    });
  try {
    await assert.rejects(
      client.request('asset-restore', { buffer: await saveAsset(state) }),
      /REQUEST_BINDING/,
    );
  } finally {
    ports.forEach((p) => p.terminate());
  }
  const snapshots: AssetLongPort[] = [],
    bound = createWorkerClient(() => {
      const p = new AssetLongPort();
      snapshots.push(p);
      return p;
    });
  try {
    const pending = bound.request('asset-reconcile', state);
    state.files.forEach((f) => new Uint8Array(f.original!).fill(0));
    state.scope.entity = 'OTHER';
    state.readings[0].confirmed = false;
    assert.deepEqual(await pending, expected);
  } finally {
    snapshots.forEach((p) => p.terminate());
  }
});
void test('actual stale worker ID/action, cancellation and delayed replies never complete another request', async () => {
  const ports: AssetLongPort[] = [];
  let release = () => {},
    received = () => {};
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const client = createWorkerClient(() => {
    const first = ports.length === 0;
    const p = new AssetLongPort((r, deliver) => {
      if (first && r.ok) {
        deliver({ ...r, id: r.id + 1000 });
        release = () => deliver(r);
        received();
      } else deliver(r);
    });
    ports.push(p);
    return p;
  });
  try {
    const state = await assetLongFixture(),
      controller = new AbortController();
    const pending = client.request('asset-reconcile', state, controller.signal);
    await arrived;
    controller.abort();
    await assert.rejects(pending, /أُلغيت/);
    release();
    assert.deepEqual(
      await client.request('asset-reconcile', state),
      await replayAsset(state),
    );
    assert.ok(ports[0].terminated);
  } finally {
    ports.forEach((p) => p.terminate());
  }
  const bad: AssetLongPort[] = [],
    wrong = createWorkerClient(() => {
      const p = new AssetLongPort((r, deliver) =>
        deliver({ ...r, action: 'asset-save' }),
      );
      bad.push(p);
      return p;
    });
  try {
    await assert.rejects(
      wrong.request('asset-reconcile', await assetLongFixture()),
      /غير صالحة/,
    );
  } finally {
    bad.forEach((p) => p.terminate());
  }
});

void test('IO worker guard independently rejects forged totals before request binding, without relying on protocol guard', async () => {
  const state = await assetLongFixture(),
    fresh = await replayAsset(state);
  const forged = structuredClone(fresh);
  forged.result.totals!.register.cost++;
  await assert.rejects(
    validateAssetWorkerResponse('asset-reconcile', forged, state),
    /ASSET_ENVELOPE/,
  );
  assert.deepEqual(
    await validateAssetWorkerResponse('asset-reconcile', fresh, state),
    fresh,
  );
});
