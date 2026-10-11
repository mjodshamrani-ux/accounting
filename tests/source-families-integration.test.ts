import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  GL_TB_VERSION,
  GL_TB_VERTICAL_FAMILY,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import { replayGlTb } from '../lib/reconciliation/gl-tb-io.ts';
import { replayBank } from '../lib/reconciliation/bank-io.ts';
import { replayAsset } from '../lib/reconciliation/fixed-assets-io.ts';
import { bankFixture } from '../audit/bank/fixtures.ts';
import { withdrawalDeposit } from './helpers/bank-wd-fixtures.ts';
import { assetLongFixture } from './helpers/fixed-assets-long-fixtures.ts';
import {
  AssetLongPort,
  type AssetLongResponse,
} from './helpers/fixed-assets-long-port.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';

async function fixtures() {
  const root = new URL(
    './fixtures/gl-tb-vertical/P01-two-sided-six-components/',
    import.meta.url,
  );
  const facts = JSON.parse(await fsRead(new URL('facts.json', root), 'utf8'));
  const files = await Promise.all(
    ['gl.csv', 'tb-vertical.csv'].map(async (name) =>
      readFile(name, new Uint8Array(await fsRead(new URL(name, root))).buffer),
    ),
  );
  const tb: GlTbInput = {
    files: files as GlTbInput['files'],
    scope: facts.scope,
    readings: [
      { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
      {
        sheet: 0,
        role: 'trial-balance',
        family: GL_TB_VERTICAL_FAMILY,
        confirmed: true,
      },
    ],
  };
  const bank = await withdrawalDeposit(await bankFixture('outgoing-fees'));
  const asset = await assetLongFixture();
  return [
    { domain: 'gl-tb', input: tb, value: await replayGlTb(tb) },
    { domain: 'bank', input: bank, value: await replayBank(bank) },
    { domain: 'asset', input: asset, value: await replayAsset(asset) },
  ];
}
void test('integrated actual worker alternates TB/bank/assets and reverse through six original save/restore/export cycles', async () => {
  const cases = await fixtures(),
    ports: AssetLongPort[] = [];
  const client = createWorkerClient(() => {
    const p = new AssetLongPort();
    ports.push(p);
    return p;
  });
  try {
    for (const item of [...cases, ...cases.toReversed()]) {
      const actual = await client.request<typeof item.value>(
        `${item.domain}-reconcile`,
        item.input,
      );
      assert.deepEqual(actual, item.value);
      const saved = await client.request<ArrayBuffer>(
        `${item.domain}-save`,
        item.input,
      );
      const restored = await client.request<typeof item.value>(
        `${item.domain}-restore`,
        { buffer: saved },
      );
      assert.deepEqual(restored, item.value);
      const book = await client.request<ArrayBuffer>(`${item.domain}-export`, {
        state: restored.state,
        result: restored.result,
      });
      assert.deepEqual([...new Uint8Array(book).subarray(0, 2)], [80, 75]);
    }
    assert.equal(
      ports.length,
      1,
      'same actual worker dispatches all families without leaked binding',
    );
  } finally {
    ports.forEach((p) => p.terminate());
  }
});
void test('each integrated guard rejects a valid foreign-family response and a clean retry succeeds', async () => {
  const cases = await fixtures();
  for (const [i, item] of cases.entries()) {
    const ports: AssetLongPort[] = [];
    let forge = true;
    const client = createWorkerClient(() => {
      const p = new AssetLongPort((response, deliver) => {
        if (
          forge &&
          response.ok &&
          response.action === `${item.domain}-reconcile`
        )
          deliver({ ...response, value: cases[(i + 1) % 3].value });
        else deliver(response);
      });
      ports.push(p);
      return p;
    });
    try {
      await assert.rejects(
        client.request(`${item.domain}-reconcile`, item.input),
      );
      forge = false;
      assert.deepEqual(
        await client.request(`${item.domain}-reconcile`, item.input),
        item.value,
      );
    } finally {
      ports.forEach((p) => p.terminate());
    }
  }
});
void test('cancelled native reply from each family cannot install into a newer different-family request', async () => {
  const cases = await fixtures();
  for (const [i, item] of cases.entries()) {
    let held: AssetLongResponse | undefined,
      arrived: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const ports: AssetLongPort[] = [];
    const client = createWorkerClient(() => {
      const first = ports.length === 0;
      const p = new AssetLongPort((response, deliver) => {
        if (first && response.action === `${item.domain}-reconcile`) {
          held = response;
          arrived();
        } else deliver(response);
      });
      ports.push(p);
      return p;
    });
    try {
      const controller = new AbortController();
      let installed = false;
      const pending = client
        .request(`${item.domain}-reconcile`, item.input, controller.signal)
        .then(() => {
          installed = true;
        });
      const rejected = assert.rejects(pending);
      await ready;
      const oldHandler = ports[0].onmessage!;
      controller.abort();
      await rejected;
      const next = cases[(i + 1) % 3];
      const retry = client.request(`${next.domain}-reconcile`, next.input);
      oldHandler.call(
        ports[0] as unknown as Worker,
        { data: held } as MessageEvent,
      );
      assert.deepEqual(await retry, next.value);
      assert.equal(installed, false);
    } finally {
      ports.forEach((p) => p.terminate());
    }
  }
});
