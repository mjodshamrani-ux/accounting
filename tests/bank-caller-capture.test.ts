import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { bankFixture } from '../audit/bank/fixtures.ts';
import { withdrawalDeposit } from './helpers/bank-wd-fixtures.ts';
import { createWorkerClient, type WorkerPort } from '../lib/reconciliation/worker-client.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { replayBank, saveBank } from '../lib/reconciliation/bank-io.ts';
import type { BankInput } from '../lib/reconciliation/bank.ts';

type Envelope = Record<string, unknown>;
class NativePort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  stopped = false;
  transform: (data: Envelope) => Envelope = (data) => data;
  worker = new NodeWorker(new URL('./helpers/bank-wd-worker.mjs', import.meta.url), {
    execArgv: ['--experimental-strip-types'],
  });
  constructor() {
    this.worker.on('message', (data: Envelope) => this.onmessage?.call(
      this as unknown as Worker,
      { data: this.transform(data) } as MessageEvent,
    ));
    this.worker.on('error', () => this.onerror?.call(this as unknown as AbstractWorker, {} as ErrorEvent));
  }
  postMessage(data: unknown) { this.worker.postMessage(data); }
  terminate() { this.stopped = true; void this.worker.terminate(); }
}

async function pair() {
  const requested = await withdrawalDeposit(await bankFixture('outgoing-fees'));
  const foreign = structuredClone(requested);
  foreign.scope.account = 'BANK-002';
  for (const [index, source] of foreign.files.entries()) {
    const original = new TextDecoder().decode(source.original).replaceAll('BANK-001', 'BANK-002');
    foreign.files[index] = await readFile(source.name, new TextEncoder().encode(original).buffer);
    assert.equal(foreign.files[index].original!.byteLength, requested.files[index].original!.byteLength);
  }
  const expected = await replayBank(requested), other = await replayBank(foreign);
  assert.notEqual(other.result.context, expected.result.context);
  assert.equal(other.result.status, expected.result.status, 'foreign envelope is genuinely coherent');
  return { requested, expected, other };
}

void test('bank capture: caller mutation cannot substitute coherent native reconcile or restore replies', async (t) => {
  const { requested, expected, other } = await pair();
  const originalSession = await saveBank(requested), foreignSession = await saveBank(other.state);
  assert.equal(originalSession.byteLength, foreignSession.byteLength);
  for (const mode of ['replace-state', 'mutate-originals', 'replace-session', 'mutate-session'] as const) {
    await t.test(mode, async () => {
      const ports: NativePort[] = [];
      const client = createWorkerClient(() => { const port = new NativePort(); ports.push(port); return port; }, 30000);
      const restore = mode.endsWith('session');
      const payload: BankInput | { buffer: ArrayBuffer } = restore
        ? { buffer: originalSession.slice(0) }
        : structuredClone(requested);
      try {
        await client.prepare();
        const port = ports.at(-1)!;
        port.transform = (data) => data.action === (restore ? 'bank-restore' : 'bank-reconcile')
          ? { ...data, value: structuredClone(other) }
          : data;
        const pending = client.request(restore ? 'bank-restore' : 'bank-reconcile', payload);
        if ('buffer' in payload) {
          if (mode === 'replace-session') payload.buffer = foreignSession.slice(0);
          else new Uint8Array(payload.buffer).set(new Uint8Array(foreignSession));
        } else if (mode === 'replace-state') {
          Object.assign(payload, structuredClone(other.state));
        } else {
          for (const [index, file] of payload.files.entries()) {
            new Uint8Array(file.original!).set(new Uint8Array(other.state.files[index].original!));
            file.sha256 = other.state.files[index].sha256;
          }
          payload.scope.account = other.state.scope.account;
        }
        await assert.rejects(pending, /BANK_WORKER_BINDING/);
        assert.equal(port.stopped, true, 'binding rejection terminates native worker');
        const retry = await client.request<typeof expected>('bank-reconcile', structuredClone(requested));
        assert.deepEqual(retry.result, expected.result, 'clean retry uses original authoritative sources');
        assert.notEqual(ports.at(-1), port, 'retry uses a fresh worker');
      } finally { ports.forEach((port) => port.terminate()); }
    });
  }
});

void test('bank capture: unchanged native replies accept submitted sources and session after caller mutation', async () => {
  const { requested, expected, other } = await pair();
  const ports: NativePort[] = [];
  const payload = structuredClone(requested);
  let factoryMutatedCaller = false;
  const client = createWorkerClient(() => {
    Object.assign(payload, structuredClone(other.state));
    factoryMutatedCaller = true;
    const port = new NativePort(); ports.push(port); return port;
  }, 30000);
  try {
    const pending = client.request<typeof expected>('bank-reconcile', payload);
    assert.equal(factoryMutatedCaller, true, 'caller mutation occurs inside factory before request returns or posts');
    Object.assign(payload, structuredClone(other.state));
    const value = await pending;
    assert.deepEqual(value.result, expected.result);
    assert.deepEqual(new Uint8Array(value.state.files[0].original!), new Uint8Array(requested.files[0].original!));
    const originalSession = await saveBank(requested), foreignSession = await saveBank(other.state);
    assert.equal(originalSession.byteLength, foreignSession.byteLength);
    const restorePayload = { buffer: originalSession.slice(0) };
    const restoring = client.request<typeof expected>('bank-restore', restorePayload);
    new Uint8Array(restorePayload.buffer).set(new Uint8Array(foreignSession));
    const restored = await restoring;
    assert.deepEqual(restored.result, expected.result);
    assert.deepEqual(new Uint8Array(restored.state.files[0].original!), new Uint8Array(requested.files[0].original!));
  } finally { ports.forEach((port) => port.terminate()); }
});
