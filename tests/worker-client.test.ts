import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkerClient,
  workerRequestTimeout,
} from '../lib/reconciliation/worker-client.ts';
import { isProcessingProgress } from '../lib/reconciliation/processing-progress.ts';
import type { ProcessingProgress } from '../lib/reconciliation/processing-progress.ts';
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
  progress(progress: unknown, overrides: Record<string, unknown> = {}) {
    const { channel, id, action } = this.sent;
    this.emit({
      channel,
      id,
      action,
      kind: 'progress',
      progress,
      ...overrides,
    });
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

test('verified PDF progress is bounded metadata and never resolves the source request', async () => {
  const { client, workers } = setup();
  const seen: ProcessingProgress[] = [];
  let resolved = false;
  const p = client
    .request('read', { name: 'statement.PDF' }, undefined, (progress) => {
      seen.push({ ...progress });
      // An observer cannot rewrite the sequence used to validate later messages.
      progress.total = 99;
      progress.completed = 99;
    })
    .then((value) => {
      resolved = true;
      return value;
    });
  const w = workers[0];
  const expected = [
    { stage: 'pdf-read', completed: 0, total: 70 },
    { stage: 'pdf-read', completed: 1, total: 70 },
    { stage: 'pdf-read', completed: 1, total: 70 },
    { stage: 'pdf-read', completed: 70, total: 70 },
    { stage: 'pdf-layout', completed: 0, total: 70 },
    { stage: 'pdf-layout', completed: 70, total: 70 },
  ];
  for (const progress of expected) w.progress(progress);
  await Promise.resolve();
  assert.equal(
    resolved,
    false,
    '100% layout is not a source or accounting success',
  );
  assert.deepEqual(seen, expected);
  const source = { ...valid(), name: 'statement.PDF' };
  w.respond({ ok: true, value: source });
  assert.equal(await p, source);
  assert.equal(w.stopped, false);
});

test('progress cannot bypass final source validation or typed late-page failure', async () => {
  for (const response of [
    { ok: true, value: { ...valid(), name: 'wrong.pdf' } },
    { ok: true },
    {
      ok: false,
      error: 'Late page failed',
      diagnosis: {
        schemaVersion: 1,
        format: 'pdf',
        totalPages: 70,
        page: 70,
        contentKind: 'mixed',
        textItems: 4,
        textChars: 28,
        imagePaints: 1,
        code: 'PDF_IMAGE_CONTENT',
        route: 'visual-extraction-required',
        inspectedAllPages: false,
      },
    },
  ]) {
    const { client, workers } = setup();
    const p = client.request('read', { name: 'statement.pdf' });
    workers[0].progress({ stage: 'pdf-read', completed: 69, total: 70 });
    workers[0].respond(response);
    await assert.rejects(p, (error: unknown) => {
      if (!response.ok) {
        assert.ok(error instanceof ImportDiagnosticError);
        assert.equal(error.diagnosis.page, 70);
      }
      return true;
    });
    assert.equal(workers[0].stopped, true);
  }
});

test('malformed or misplaced current-request progress fails closed', async () => {
  const sample = { stage: 'pdf-read', completed: 1, total: 70 };
  const malformed = [
    null,
    [],
    {},
    { ...sample, stage: 'reconcile' },
    { ...sample, completed: -1 },
    { ...sample, completed: 1.5 },
    { ...sample, completed: 71 },
    { ...sample, completed: NaN },
    { ...sample, total: 0 },
    { ...sample, total: 101 },
    { ...sample, total: Infinity },
    { ...sample, total: '70' },
    { ...sample, rawText: 'private source text' },
  ];
  for (const progress of malformed) {
    assert.equal(isProcessingProgress(progress), false);
    const { client, workers } = setup();
    const p = client.request('read', { name: 'statement.pdf' });
    workers[0].progress(progress);
    await assert.rejects(p, /غير صالحة/);
    assert.equal(workers[0].stopped, true);
  }
  for (const [action, payload, overrides] of [
    ['read', { name: 'statement.csv' }, {}],
    ['normalize', { name: 'statement.pdf' }, {}],
    ['read', { name: 'statement.pdf' }, { action: 'ready' }],
    ['read', { name: 'statement.pdf' }, { kind: 'done' }],
    [
      'read',
      { name: 'statement.pdf' },
      { kind: undefined, ok: true, value: valid() },
    ],
    ['read', { name: 'statement.pdf' }, { ok: true, value: valid() }],
    ['read', { name: 'statement.pdf' }, { rawText: 'private source text' }],
  ] as const) {
    const { client, workers } = setup();
    const p = client.request(action, payload);
    workers[0].progress(sample, overrides);
    await assert.rejects(p, /غير صالحة/);
    assert.equal(workers[0].stopped, true);
  }
});

test('PDF progress rejects regressions, changed totals and premature or reversed stages', async () => {
  const read = (completed: number, total = 70) => ({
    stage: 'pdf-read',
    completed,
    total,
  });
  const layout = (completed: number, total = 70) => ({
    stage: 'pdf-layout',
    completed,
    total,
  });
  for (const sequence of [
    [layout(0)],
    [read(2), read(1)],
    [read(2), read(2, 71)],
    [read(69), layout(0)],
    [read(70), layout(0, 71)],
    [read(70), layout(2), layout(1)],
    [read(70), layout(0), read(70)],
  ]) {
    const { client, workers } = setup();
    const p = client.request('read', { name: 'statement.pdf' });
    for (const progress of sequence) workers[0].progress(progress);
    await assert.rejects(p, /غير صالحة/);
    assert.equal(workers[0].stopped, true);
  }
});

test('library and stale progress are ignored; abort clears the sequence for the next worker', async () => {
  const { client, workers } = setup();
  const controller = new AbortController();
  const seen: ProcessingProgress[] = [];
  const p = client.request(
    'read',
    { name: 'statement.pdf' },
    controller.signal,
    (progress) => seen.push(progress),
  );
  const progress = { stage: 'pdf-read', completed: 10, total: 70 };
  const w = workers[0];
  w.progress(progress, { channel: 'pdfjs' });
  w.progress(progress, { id: w.sent.id + 1 });
  w.emit({ kind: 'progress', progress });
  assert.equal(seen.length, 0);
  w.progress(progress);
  assert.equal(seen.length, 1);
  controller.abort();
  await assert.rejects(p, /أُلغيت/);
  w.progress({ ...progress, completed: 70 });
  assert.equal(seen.length, 1);
  assert.equal(w.stopped, true);
  const next = client.request(
    'read',
    { name: 'next.pdf' },
    undefined,
    (progress) => seen.push(progress),
  );
  workers[1].progress({ stage: 'pdf-read', completed: 0, total: 2 });
  workers[1].respond({ ok: true, value: { ...valid(), name: 'next.pdf' } });
  await next;
  assert.deepEqual(seen.at(-1), { stage: 'pdf-read', completed: 0, total: 2 });
});

test('PDF deadlines cover the request; progress never extends the fixed deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers: FakeWorker[] = [];
  const client = createWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as WorkerPort;
  });
  const p = client.request('read', { name: 'statement.pdf' });
  const rejected = assert.rejects(p, /180/);
  const w = workers[0];
  t.mock.timers.tick(45000);
  assert.equal(w.stopped, false);
  w.progress({ stage: 'pdf-read', completed: 1, total: 70 });
  t.mock.timers.tick(134999);
  assert.equal(w.stopped, false);
  w.progress({ stage: 'pdf-read', completed: 69, total: 70 });
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(w.stopped, true);
  const overridden = setup(50);
  const q = overridden.client.request('read', { name: 'statement.pdf' });
  const overrideRejected = assert.rejects(q, /0\.05/);
  t.mock.timers.tick(49);
  overridden.workers[0].progress({
    stage: 'pdf-read',
    completed: 0,
    total: 70,
  });
  t.mock.timers.tick(1);
  await overrideRejected;
  assert.equal(overridden.workers[0].stopped, true);
});

test('longer deadlines apply only to PDF import or original-source session/export checks', () => {
  for (const action of ['ready', 'normalize', 'reconcile', 'compare'])
    assert.equal(
      workerRequestTimeout(action, { name: 'statement.pdf' }),
      45000,
    );
  assert.equal(workerRequestTimeout('read', { name: 'statement.xlsx' }), 45000);
  assert.equal(workerRequestTimeout('read', { name: 'statement.PDF' }), 180000);
  assert.equal(
    workerRequestTimeout('restore-session', { buffer: new ArrayBuffer(1) }),
    180000,
  );
  for (const action of ['save-session', 'export']) {
    assert.equal(
      workerRequestTimeout(action, {
        files: [{ name: 'a.csv' }, { name: 'b.xlsx' }],
      }),
      45000,
    );
    assert.equal(
      workerRequestTimeout(action, {
        files: [{ name: 'a.csv' }, { name: 'b.PDF' }],
      }),
      180000,
    );
  }
});

test('reviewed image worker replies replay originals before gaining in-memory authority',async()=>{
  const {knownVisualSource}=await import('../audit/visual-accounting/make_record.mjs');
  const {readVisualAccountingSource,visualAccountingMapping}=await import('../lib/reconciliation/visual-accounting-source.ts');
  const {normalizeSource}=await import('../lib/reconciliation/core.ts');
  const f=await knownVisualSource(),file=await readVisualAccountingSource('statement.tarasuf-reviewed.json',f.bytes.slice().buffer);
  const {client,workers}=setup(5000);
  const pending=client.request<import('../lib/reconciliation/types.ts').SourceFile>('read',{name:file.name});
  workers[0].respond({ok:true,value:structuredClone(file)});
  const restored=await pending;
  const c=f.context,scope={supplier:c.supplier,entity:c.entity,account:c.account,currency:c.currency,decimals:c.decimals,cutoff:c.cutoff,dateWindow:3,confirmed:true,coverageConfirmed:false};
  assert.equal(normalizeSource(restored,visualAccountingMapping(restored),scope,'supplier').transactions.length,1);
  const bad=structuredClone(file);bad.sheets[0].rows[1][2]='250.00';
  const failure=client.request('read',{name:file.name});workers[0].respond({ok:true,value:bad});
  await assert.rejects(failure,/مصدر الصورة/);
});
test('abort during async image replay cannot resolve or disturb the following worker request',async()=>{
  const {knownVisualSource}=await import('../audit/visual-accounting/make_record.mjs');
  const {readVisualAccountingSource}=await import('../lib/reconciliation/visual-accounting-source.ts');
  const f=await knownVisualSource(),file=await readVisualAccountingSource('statement.tarasuf-reviewed.json',f.bytes.slice().buffer);
  const {client,workers}=setup(5000),controller=new AbortController();
  const pending=client.request('read',{name:file.name},controller.signal);
  workers[0].respond({ok:true,value:structuredClone(file)});
  controller.abort(); await assert.rejects(pending,/أُلغيت/);
  const next=client.request('read',{name:'synthetic.xlsx'});
  workers[1].respond({ok:true,value:valid()}); assert.equal((await next as {name:string}).name,'synthetic.xlsx');
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(workers[1].stopped,false);
});
