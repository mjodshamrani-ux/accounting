import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { adjustmentFixture } from '../audit/bank-adjustment/fixtures.ts';
import { bankFixture } from '../audit/bank/fixtures.ts';
import { withdrawalDeposit } from './helpers/bank-wd-fixtures.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { replayBank } from '../lib/reconciliation/bank-io.ts';
import { replayBankAdjustments } from '../lib/reconciliation/bank-adjustment-io.ts';
import type { BankInput } from '../lib/reconciliation/bank.ts';
import type { BankAdjustmentInput } from '../lib/reconciliation/bank-adjustment.ts';
class Port {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  stopped = false;
  transform: (data: Record<string, unknown>) => Record<string, unknown> = (v) =>
    v;
  hold = false;
  held: (() => void) | null = null;
  arrived: (() => void) | null = null;
  worker = new NodeWorker(
    new URL('./helpers/bank-wd-worker.mjs', import.meta.url),
    { execArgv: ['--experimental-strip-types'] },
  );
  constructor() {
    this.worker.on('message', (data) => {
      const handler = this.onmessage;
      const emit = () =>
        handler?.call(
          this as unknown as Worker,
          { data: this.transform(data) } as MessageEvent,
        );
      if (this.hold) {
        this.held = emit;
        this.arrived?.();
      } else emit();
    });
    this.worker.on('error', () =>
      this.onerror?.call(this as unknown as AbstractWorker, {} as ErrorEvent),
    );
  }
  postMessage(data: unknown) {
    this.worker.postMessage(data);
  }
  terminate() {
    this.stopped = true;
    void this.worker.terminate();
  }
}
void test('WD real worker dispatch replays B1 and six B2.2 original sources, save restore export, source replacement and cancel', async () => {
  const ports: Port[] = [];
  const client = createWorkerClient(() => {
    const p = new Port();
    ports.push(p);
    return p;
  }, 30000);
  const state = await adjustmentFixture('closing-outflow');
  state.balance.bank = await withdrawalDeposit(state.balance.bank);
  const expected = (await replayBankAdjustments(state)).result;
  try {
    await client.prepare();
    for (let layer = 0; layer < 6; layer++) {
      const forged = structuredClone(state);
      [...forged.balance.bank.files, ...forged.balance.files, ...forged.files][
        layer
      ].sheets[0].rows[0][0] = 'cache-forgery';
      const value = await client.request<
        Awaited<ReturnType<typeof replayBankAdjustments>>
      >('bank-adjustment-reconcile', forged);
      assert.deepEqual(value.result, expected);
    }
    const saved = await client.request<ArrayBuffer>(
      'bank-adjustment-save',
      state,
    );
    const restored = await client.request<
      Awaited<ReturnType<typeof replayBankAdjustments>>
    >('bank-adjustment-restore', { buffer: saved });
    assert.deepEqual(restored.result, expected);
    const exported = await client.request<ArrayBuffer>(
      'bank-adjustment-export',
      { state: restored.state, result: restored.result },
    );
    assert.deepEqual(
      Array.from(new Uint8Array(exported).slice(0, 2)),
      [80, 75],
    );
    const bank = await withdrawalDeposit(await bankFixture('outgoing-fees'));
    const b = await client.request<Awaited<ReturnType<typeof replayBank>>>(
      'bank-reconcile',
      bank,
    );
    assert.deepEqual(b.result, (await replayBank(bank)).result);
    const archive = await client.request<ArrayBuffer>('bank-save', bank);
    const back = await client.request<Awaited<ReturnType<typeof replayBank>>>(
      'bank-restore',
      { buffer: archive },
    );
    assert.deepEqual(back.result, b.result);
    assert.ok(
      await client.request<ArrayBuffer>('bank-export', {
        state: back.state,
        result: back.result,
      }),
    );
    const current = structuredClone(bank);
    const bad = structuredClone(bank);
    bad.files[0].sha256 = '0'.repeat(64);
    await assert.rejects(
      () => client.request('bank-reconcile', bad),
      /SOURCE_HASH/,
    );
    assert.deepEqual(
      bank,
      current,
      'failed replacement retains previous valid source',
    );
    await client.prepare();
    const port = ports.at(-1)!;
    port.hold = true;
    const held = new Promise<void>((resolve) => {
      port.arrived = resolve;
    });
    const controller = new AbortController();
    const pending = client.request(
      'bank-adjustment-reconcile',
      state,
      controller.signal,
    );
    const rejected = assert.rejects(pending, /أُلغيت/);
    await held;
    controller.abort();
    await rejected;
    assert.equal(port.stopped, true);
    port.held!();
    const fresh = await client.request<
      Awaited<ReturnType<typeof replayBankAdjustments>>
    >('bank-adjustment-reconcile', state);
    assert.deepEqual(fresh.result, expected);
  } finally {
    ports.forEach((p) => p.terminate());
  }
});
void test('WD worker response binds source bytes, family/context and computed result before installation', async () => {
  const ports: Port[] = [];
  const client = createWorkerClient(() => {
    const p = new Port();
    ports.push(p);
    return p;
  }, 30000);
  const wd = await withdrawalDeposit(await bankFixture('outgoing-fees'));
  const canonical = await replayBank(await bankFixture('outgoing-fees'));
  const state = await adjustmentFixture('closing-outflow');
  state.balance.bank = wd;
  try {
    for (const transform of [
      (d: Record<string, unknown>) => ({ ...d, value: canonical }),
      (d: Record<string, unknown>) => {
        const v = d.value as Awaited<ReturnType<typeof replayBank>>;
        v.result.records[0].signed += 1;
        return d;
      },
      (d: Record<string, unknown>) => {
        const v = d.value as Awaited<ReturnType<typeof replayBank>>;
        v.state.files[0].original = new ArrayBuffer(1);
        return d;
      },
      (d: Record<string, unknown>) => ({ ...d, value: {} }),
      (d: Record<string, unknown>) => ({ ...d, action: 'bank-restore' }),
    ]) {
      await client.prepare();
      const port = ports.at(-1)!;
      port.transform = transform;
      await assert.rejects(() => client.request('bank-reconcile', wd));
      assert.equal(port.stopped, true);
    }
    await client.prepare();
    ports.at(-1)!.transform = (d) => {
      const v = d.value as {
        state: BankAdjustmentInput;
        result: { context: string };
      };
      v.result.context += 'stale';
      return d;
    };
    await assert.rejects(() =>
      client.request('bank-adjustment-reconcile', state),
    );
    await client.prepare();
    const port = ports.at(-1)!;
    port.transform = (d) => {
      const handler = port.onmessage;
      handler?.call(
        port as unknown as Worker,
        { data: { ...d, id: Number(d.id) + 999 } } as MessageEvent,
      );
      return d;
    };
    assert.deepEqual(
      (
        await client.request<{ state: BankInput; result: unknown }>(
          'bank-reconcile',
          wd,
        )
      ).result,
      (await replayBank(wd)).result,
    );
  } finally {
    ports.forEach((p) => p.terminate());
  }
});
