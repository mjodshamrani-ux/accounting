import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import type { WorkerPort } from '../lib/reconciliation/worker-client.ts';
import {
  WORKER_CHANNEL,
  isRequest,
  assertSourceFile,
} from '../lib/reconciliation/protocol.ts';
import { ENGINE_VERSION } from '../lib/reconciliation/types.ts';
import { ImportDiagnosticError } from '../lib/reconciliation/import-diagnostics.ts';
class FakeWorker {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  stopped = false;
  sent!: { channel: string; id: number; action: string; payload: unknown };
  postMessage(message: typeof this.sent) {
    this.sent = message;
  }
  terminate() {
    this.stopped = true;
  }
  emit(data: unknown) {
    this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent);
  }
  respond(data: Record<string, unknown>) {
    this.emit({ ...this.sent, ...data });
  }
}
const valid = () => ({
  name: 'synthetic.xlsx',
  original: new ArrayBuffer(1),
  sha256: 'a'.repeat(64),
  sheets: [
    {
      name: 'Data',
      rows: [
        ['date', 'amount'],
        ['2026-07-01', '100'],
      ],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
function setup(timeout = 1000) {
  const workers: FakeWorker[] = [];
  const client = createWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as WorkerPort;
  }, timeout);
  return { workers, client };
}
test('typed PDF failure survives the worker without producing a partial source', async () => {
  const { workers, client } = setup();
  const failed = client.request('read', { name: 'mixed.pdf' });
  const diagnosis = {
    schemaVersion: 1,
    format: 'pdf',
    totalPages: 3,
    page: 2,
    contentKind: 'mixed',
    textItems: 4,
    textChars: 28,
    imagePaints: 1,
    code: 'PDF_IMAGE_CONTENT',
    route: 'visual-extraction-required',
    inspectedAllPages: false,
  };
  workers[0].respond({ ok: false, error: 'PDF contains an image', diagnosis });
  await assert.rejects(failed, (error: unknown) => {
    assert.ok(error instanceof ImportDiagnosticError);
    assert.deepEqual(error.diagnosis, diagnosis);
    return true;
  });
  assert.equal(workers[0].stopped, true);
  const next = client.request('read', { name: 'synthetic.xlsx' });
  workers[1].respond({ ok: true, value: valid() });
  assert.ok(await next);
});

test('unvalidated or misplaced diagnosis remains a plain failure, never trusted metadata', async () => {
  for (const [action, diagnosis] of [
    ['read', { page: 2, contentKind: 'mixed' }],
    [
      'normalize',
      {
        schemaVersion: 1,
        format: 'pdf',
        totalPages: 3,
        page: 2,
        contentKind: 'mixed',
        textItems: 4,
        textChars: 28,
        imagePaints: 1,
        code: 'PDF_IMAGE_CONTENT',
        route: 'visual-extraction-required',
        inspectedAllPages: false,
      },
    ],
  ] as const) {
    const { workers, client } = setup();
    const failed = client.request(action, {});
    workers[0].respond({ ok: false, error: 'failed', diagnosis });
    await assert.rejects(failed, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof ImportDiagnosticError));
      return true;
    });
  }
});
test('worker wire protocol ignores library messages and stale ids instead of resolving undefined', async () => {
  const { workers, client } = setup();
  const p = client.request('read', { name: 'synthetic.xlsx' });
  const w = workers[0];
  w.emit({ id: w.sent.id, action: 'read', value: undefined });
  w.emit({
    sourceName: 'worker',
    targetName: 'main',
    action: 'ready',
    data: null,
  });
  w.emit({ ...w.sent, id: 0, ok: true, value: undefined });
  const value = valid();
  w.respond({ ok: true, value });
  assert.equal(await p, value);
  assert.equal(w.stopped, false);
});
test('empty error messages always reject, and the next import gets a clean worker', async () => {
  const { workers, client } = setup();
  const bad = client.request('read', { name: 'synthetic.xlsx' });
  workers[0].respond({ ok: false, error: '' });
  await assert.rejects(bad, /تعذر/);
  assert.equal(workers[0].stopped, true);
  const next = client.request('read', { name: 'synthetic.xlsx' });
  assert.equal(workers.length, 2);
  workers[1].respond({ ok: true, value: valid() });
  assert.ok(await next);
});
test('missing value, malformed sheets, wrong source and wrong action cannot reach the UI', async () => {
  for (const response of [
    { ok: true },
    { ok: true, value: { sheets: [] } },
    { ok: true, value: { ...valid(), name: 'other.xlsx' } },
    { ok: true, value: valid(), action: 'ready' },
    { error: '' },
  ]) {
    const { workers, client } = setup();
    const p = client.request('read', { name: 'synthetic.xlsx' });
    workers[0].respond(response);
    await assert.rejects(p);
    assert.equal(workers[0].stopped, true);
  }
  assert.throws(() => assertSourceFile(undefined), /جدولًا صالحًا/);
});
test('abort, worker errors, message errors and timeout recover without poisoning subsequent requests', async () => {
  for (const failure of ['abort', 'error', 'messageerror', 'timeout']) {
    const { workers, client } = setup(10),
      controller = new AbortController();
    const p = client.request(
      'read',
      { name: 'synthetic.xlsx' },
      controller.signal,
    );
    const w = workers[0];
    if (failure === 'abort') controller.abort();
    if (failure === 'error')
      w.onerror?.call(w as unknown as AbstractWorker, {} as ErrorEvent);
    if (failure === 'messageerror')
      w.onmessageerror?.call(w as unknown as Worker, {} as MessageEvent);
    await assert.rejects(p);
    assert.equal(w.stopped, true);
    const next = client.request('read', { name: 'synthetic.xlsx' });
    workers[1].respond({ ok: true, value: valid() });
    await next;
  }
});
test('readiness checks engine version and concurrent calls cannot steal another response', async () => {
  const { workers, client } = setup();
  const ready = client.prepare();
  assert.equal(ready, client.prepare());
  workers[0].respond({ ok: true, value: { ready: true, engine: 'old' } });
  await assert.rejects(ready, /إصدار/);
  const next = client.prepare();
  workers[1].respond({
    ok: true,
    value: { ready: true, engine: ENGINE_VERSION },
  });
  await next;
  const p = client.request('read', { name: 'synthetic.xlsx' });
  await assert.rejects(client.request('read', {}), /انتظر/);
  workers[1].respond({ ok: true, value: valid() });
  await p;
});
test('worker dispatcher only accepts explicitly namespaced accounting requests', () => {
  assert.equal(isRequest({ id: 1, action: 'read', payload: {} }), false);
  assert.equal(
    isRequest({ channel: WORKER_CHANNEL, id: 1, action: 'read', payload: {} }),
    true,
  );
  assert.equal(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'invent',
      payload: {},
    }),
    false,
  );
  assert.equal(
    isRequest({ channel: WORKER_CHANNEL, id: 1, action: 'read' }),
    false,
  );
});
