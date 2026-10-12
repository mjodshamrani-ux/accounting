import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import JSZip from 'jszip';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileAr,
  type ArInput,
  type ArResult,
} from '../lib/reconciliation/ar.ts';
import {
  replayAr,
  saveAr,
  restoreAr,
  exportAr,
} from '../lib/reconciliation/ar-io.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import {
  WORKER_CHANNEL,
  isRequest,
  validateWorkerValue,
} from '../lib/reconciliation/protocol.ts';
import {
  snapshotArRequest,
  validateArWorkerResponse,
} from '../lib/reconciliation/ar-worker-binding.ts';
import { MAX_FILE_BYTES } from '../lib/reconciliation/types.ts';

type Request = {
  channel: string;
  id: number;
  action: string;
  payload: unknown;
};
type Envelope = Awaited<ReturnType<typeof replayAr>>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
class Port implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  stopped = false;
  sent!: Request;
  postMessage(message: unknown) {
    this.sent = message as Request;
  }
  terminate() {
    this.stopped = true;
  }
  emit(value: unknown, overrides: Record<string, unknown> = {}) {
    const { channel, id, action } = this.sent;
    const response = { channel, id, action, ok: true, value, ...overrides };
    void this.onmessage?.call(
      this as unknown as Worker,
      { data: response } as MessageEvent,
    );
    return response;
  }
}
async function fixture(scopeDetails = false): Promise<ArInput> {
  const files = await Promise.all(
    ['ledger', 'statement'].map(async (side, index) => {
      const raw = scopeDetails
        ? new TextEncoder().encode(
            [
              'AR_SCOPE,1',
              'Scope ID,SCOPE-1',
              `Source role,${index === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement'}`,
              'Perspective,seller-receivable',
              'Amount basis,original-movement',
              'Entity,Synthetic Seller',
              'Ledger,AR Book',
              'Customer,C0001',
              'Account,1200',
              'Currency,SAR',
              'Period start,2026-09-01',
              'Period end,2026-09-30',
              'Scope reference,Synthetic source reference',
              'DETAILS',
              'Parent scope ID,Posting ID,Document type,Own document number,Posting date,Original signed amount,Related invoice,Open balance,Description',
              `SCOPE-1,${side}-001,invoice,INV-001,2026-09-10,100.00,,${index ? '40.00' : '90.00'},Synthetic invoice`,
              'END_DETAILS',
            ].join('\n'),
          ).buffer
        : new Uint8Array(
            await fsRead(
              new URL(
                `../audit/ar-limited/frozen/positive-${side}.csv`,
                import.meta.url,
              ),
            ),
          ).buffer;
      return readFile(`${side}.csv`, raw);
    }),
  );
  const readings = [0, 1].map((side) => ({
    ...(scopeDetails
      ? {
          family: 'ar-scope-details-1',
          sheet: 0,
          header: 14,
          parent: 0,
          posting: 1,
          kind: 2,
          document: 3,
          date: 4,
          amount: 5,
          related: 6,
          open: 7,
          description: 8,
        }
      : {
          sheet: 0,
          header: 0,
          posting: 0,
          kind: 1,
          document: 2,
          date: 3,
          amount: 4,
          entity: 5,
          ledger: 6,
          customer: 7,
          account: 8,
          currency: 9,
          related: 10,
          description: 11,
        }),
    role:
      side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: true,
  }));
  return {
    files: files as ArInput['files'],
    readings: readings as ArInput['readings'],
    scope: {
      entity: 'Synthetic Seller',
      ledger: 'AR Book',
      customer: 'C0001',
      account: '1200',
      currency: 'SAR',
      start: '2026-09-01',
      end: '2026-09-30',
      confirmed: true,
    },
    events: [],
  };
}
function reviewed(input: ArInput) {
  const result = reconcileAr(input);
  input.events = [
    {
      context: result.context,
      at: '2026-10-11T00:00:00.000Z',
      action: 'reopen',
      ids: result.cases[0].ids,
      note: 'Synthetic reviewed correspondence',
    },
  ];
  return input;
}
function mutate(input: ArInput) {
  for (const file of input.files) {
    new Uint8Array(file.original!)[0] ^= 1;
    file.name = 'changed.csv';
    file.sha256 = 'a'.repeat(64);
    file.sheets = [];
  }
  for (const reading of input.readings) {
    reading.confirmed = false;
    reading.amount = 99;
  }
  input.scope.customer = 'changed';
  input.scope.confirmed = false;
  input.events[0].ids[0] = 'changed';
  input.events[0].note = 'changed';
  input.events.push(structuredClone(input.events[0]));
}
async function dispatched(request: Request) {
  if (request.action === 'ar-reconcile')
    return replayAr(request.payload as ArInput);
  if (request.action === 'ar-save') return saveAr(request.payload as ArInput);
  if (request.action === 'ar-restore')
    return restoreAr((request.payload as { buffer: ArrayBuffer }).buffer);
  const payload = request.payload as { state: ArInput; result: ArResult };
  return exportAr(payload.state, payload.result);
}

for (const scopeDetails of [false, true]) {
  void test(`AR ${scopeDetails ? 'scope details' : 'legacy'} captures all originals and choices before factory and later yields`, async () => {
    const original = reviewed(await fixture(scopeDetails)),
      expected = await replayAr(original);
    for (const action of ['ar-reconcile', 'ar-save', 'ar-export']) {
      const caller = structuredClone(original),
        result = structuredClone(expected.result),
        port = new Port();
      const client = createWorkerClient(() => {
        mutate(caller);
        result.context = 'factory-changed';
        result.rows = [];
        return port;
      });
      const promise = client.request<Envelope | ArrayBuffer>(
        action,
        action === 'ar-export' ? { state: caller, result } : caller,
      );
      await tick();
      caller.scope.entity = 'after-await';
      caller.events[0].ids[1] = 'after-await';
      const captured =
        action === 'ar-export'
          ? (port.sent.payload as { state: ArInput }).state
          : (port.sent.payload as ArInput);
      assert.deepEqual(captured.scope, original.scope);
      assert.deepEqual(captured.readings, original.readings);
      assert.deepEqual(captured.events, original.events);
      assert.ok(captured.files.every((file) => file.sheets.length === 0));
      port.emit(await dispatched(port.sent));
      const output = await promise;
      if (action === 'ar-reconcile')
        assert.deepEqual((output as Envelope).result, expected.result);
      if (action === 'ar-save')
        assert.deepEqual(
          (await restoreAr(output as ArrayBuffer)).result,
          expected.result,
        );
      if (action === 'ar-export')
        assert.ok((output as ArrayBuffer).byteLength > 0);
    }
  });
  void test(`AR ${scopeDetails ? 'scope details' : 'legacy'} rejects coherent foreign reconcile, session and export bytes`, async () => {
    const base = await fixture(scopeDetails),
      foreign = structuredClone(base);
    const file = foreign.files[0],
      raw = new TextDecoder()
        .decode(file.original)
        .replace('Synthetic invoice', 'Foreign invoice')
        .replace('Synthetic', 'Foreign');
    // Alter source descriptions without altering confirmed scope or financial totals.
    const text = scopeDetails
      ? new TextDecoder()
          .decode(file.original)
          .replace('Synthetic invoice', 'Foreign invoice')
      : raw.replace('Foreign Seller', 'Synthetic Seller');
    foreign.files[0] = await readFile(
      file.name,
      new TextEncoder().encode(text).buffer,
    );
    if (foreign.files[0].sha256 === base.files[0].sha256) {
      const source = new TextDecoder().decode(file.original).trimEnd() + '\n\n';
      foreign.files[0] = await readFile(
        file.name,
        new TextEncoder().encode(source).buffer,
      );
    }
    const a = await replayAr(base),
      b = await replayAr(foreign),
      session = await saveAr(base);
    const replies = [
      b,
      await saveAr(foreign),
      b,
      await exportAr(foreign, b.result),
    ];
    const payloads = [
      base,
      base,
      { buffer: session },
      { state: base, result: a.result },
    ];
    for (const [index, action] of [
      'ar-reconcile',
      'ar-save',
      'ar-restore',
      'ar-export',
    ].entries()) {
      const port = new Port(),
        client = createWorkerClient(() => port);
      const promise = client.request(action, payloads[index]);
      port.emit(replies[index]);
      await assert.rejects(promise, /AR_WORKER_BINDING/);
      assert.equal(port.stopped, true);
    }
  });
}

void test('AR restore clones submitted bytes before factory, and reply bytes before validation yields', async () => {
  const base = await fixture(),
    expected = await replayAr(base),
    session = await saveAr(base),
    original = session.slice(0),
    port = new Port();
  const client = createWorkerClient(() => {
    new Uint8Array(session).fill(0);
    return port;
  });
  const promise = client.request<Envelope>('ar-restore', { buffer: session });
  assert.deepEqual(
    new Uint8Array((port.sent.payload as { buffer: ArrayBuffer }).buffer),
    new Uint8Array(original),
  );
  const reply = structuredClone(expected);
  port.emit(reply);
  reply.result.context = 'late foreign';
  new Uint8Array(reply.state.files[0].original!).fill(0);
  assert.deepEqual((await promise).result, expected.result);
  const direct = structuredClone(expected),
    validation = validateArWorkerResponse(
      'ar-reconcile',
      direct,
      snapshotArRequest('ar-reconcile', base),
    );
  direct.result.rows = [];
  assert.deepEqual(((await validation) as Envelope).result, expected.result);
  const save = await saveAr(base),
    p2 = new Port(),
    c2 = createWorkerClient(() => p2),
    saved = c2.request<ArrayBuffer>('ar-save', base);
  p2.emit(save);
  new Uint8Array(save).fill(0);
  assert.deepEqual((await restoreAr(await saved)).result, expected.result);
});

void test('AR cancellation before creation, during preparation, and after validation yield ignores late replies and retries fresh', async () => {
  const base = await fixture(),
    expected = await replayAr(base),
    ports: Port[] = [];
  const client = createWorkerClient(() => {
    const port = new Port();
    ports.push(port);
    return port;
  });
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    client.request('ar-reconcile', base, before.signal),
    /أُلغيت/,
  );
  assert.equal(ports.length, 0);
  const preparation = client.prepare();
  const busy = client.request('ar-reconcile', base);
  await assert.rejects(busy, /انتظر/);
  ports[0].emit({
    ready: true,
    engine: (await import('../lib/reconciliation/types.ts')).ENGINE_VERSION,
  });
  await preparation;
  const controller = new AbortController(),
    cancelled = client.request('ar-reconcile', base, controller.signal);
  const oldHandler = ports[0].onmessage,
    oldRequest = ports[0].sent;
  ports[0].emit(structuredClone(expected));
  controller.abort();
  await assert.rejects(cancelled, /أُلغيت/);
  assert.equal(ports[0].stopped, true);
  const retry = client.request<Envelope>('ar-reconcile', base);
  assert.equal(ports.length, 2);
  assert.ok(ports[1].sent.id > oldRequest.id);
  void oldHandler?.call(
    ports[0] as unknown as Worker,
    { data: { ...oldRequest, ok: true, value: expected } } as MessageEvent,
  );
  ports[1].emit(expected, { id: oldRequest.id });
  await tick();
  ports[1].emit(expected);
  assert.deepEqual((await retry).result, expected.result);
  const delayed = new AbortController(),
    waiting = client.request('ar-reconcile', base, delayed.signal);
  delayed.abort();
  await assert.rejects(waiting, /أُلغيت/);
  const duringFactory = new AbortController(),
    factoryPort = new Port(),
    factoryClient = createWorkerClient(() => {
      duringFactory.abort();
      return factoryPort;
    });
  await assert.rejects(
    factoryClient.request('ar-reconcile', base, duringFactory.signal),
    /أُلغيت/,
  );
  assert.equal(factoryPort.stopped, true);
});

void test('AR exact transport, input envelopes and 8/32/96 MiB bounds reject malformed replies', async () => {
  const base = await fixture(),
    expected = await replayAr(base);
  for (const overrides of [
    { extra: true },
    { payload: {} },
    { timings: { read: NaN } },
    { kind: 'progress', progress: {} },
    { action: 'ar-save' },
  ]) {
    const port = new Port(),
      client = createWorkerClient(() => port),
      promise = client.request('ar-reconcile', base);
    port.emit(expected, overrides);
    await assert.rejects(promise);
    assert.equal(port.stopped, true);
  }
  const reply = { ...expected, extra: true };
  assert.throws(
    () => validateWorkerValue('ar-reconcile', reply, base),
    /AR_WORKER/,
  );
  for (const action of ['ar-save', 'ar-export'])
    for (const value of [
      new ArrayBuffer(0),
      new Uint8Array(1),
      new ArrayBuffer((action === 'ar-save' ? 32 : 96) * 1024 * 1024 + 1),
    ])
      assert.throws(
        () => validateWorkerValue(action, value, base),
        /AR_WORKER/,
      );
  const tooLarge = structuredClone(base);
  tooLarge.files[0].original = new ArrayBuffer(MAX_FILE_BYTES + 1);
  assert.throws(() => snapshotArRequest('ar-reconcile', tooLarge), /AR_WORKER/);
  const events = structuredClone(base);
  events.events = Array.from({ length: 1001 }, () => ({
    context: '',
    at: '',
    action: 'accept',
    ids: [],
    note: '',
  }));
  assert.throws(() => snapshotArRequest('ar-save', events), /AR_WORKER/);
  for (const payload of [
    { buffer: new ArrayBuffer(32 * 1024 * 1024 + 1) },
    { buffer: new ArrayBuffer(1), extra: true },
  ])
    assert.throws(() => snapshotArRequest('ar-restore', payload), /AR_WORKER/);
  assert.equal(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'ar-reconcile',
      payload: base,
      extra: true,
    }),
    false,
  );
});

void test('AR rejects trailing session/export bytes and workbook corruption beyond financial totals', async () => {
  const base = await fixture(),
    result = (await replayAr(base)).result;
  const session = await saveAr(base),
    trailing = new Uint8Array(session.byteLength + 1);
  trailing.set(new Uint8Array(session));
  trailing[session.byteLength] = 1;
  await assert.rejects(
    validateArWorkerResponse(
      'ar-save',
      trailing.buffer,
      snapshotArRequest('ar-save', base),
    ),
  );
  const exported = await exportAr(base, result),
    appended = new Uint8Array(exported.byteLength + 1);
  appended.set(new Uint8Array(exported));
  const payload = snapshotArRequest('ar-export', { state: base, result });
  await assert.rejects(
    validateArWorkerResponse('ar-export', appended.buffer, payload),
    /AR_WORKER_EXPORT/,
  );
  const zip = await JSZip.loadAsync(exported),
    sheet = zip.file('xl/worksheets/sheet9.xml')!;
  zip.file(
    sheet.name,
    (await sheet.async('string')).replace(/<row\b[^>]*>[\s\S]*?<\/row>/, ''),
  );
  const corrupt = await zip.generateAsync({ type: 'arraybuffer' });
  await assert.rejects(
    validateArWorkerResponse('ar-export', corrupt, payload),
    /AR_WORKER_BINDING/,
  );
  const extra = await JSZip.loadAsync(exported);
  extra.file('hidden.txt', 'foreign');
  await assert.rejects(
    validateArWorkerResponse(
      'ar-export',
      await extra.generateAsync({ type: 'arraybuffer' }),
      payload,
    ),
    /AR_WORKER_BINDING/,
  );
});

void test('AR coherent replies with requested bytes but foreign readings, scope or decisions fail binding', async () => {
  for (const scopeDetails of [false, true]) {
    const base = await fixture(scopeDetails);
    for (const choice of ['reading', 'scope', 'events']) {
      const foreign = structuredClone(base);
      if (choice === 'reading') foreign.readings[0].description = -1;
      if (choice === 'scope') foreign.scope.end = '2026-10-31';
      if (choice === 'events') reviewed(foreign);
      const reply = await replayAr(foreign),
        port = new Port(),
        client = createWorkerClient(() => port);
      const request = client.request('ar-reconcile', base);
      port.emit(reply);
      await assert.rejects(
        request,
        /AR_WORKER_BINDING/,
        `${scopeDetails}:${choice}`,
      );
    }
  }
});

void test('AR worker dispatch snapshots originals and choices before its first await', async () => {
  const base = reviewed(await fixture(true)),
    expected = await replayAr(base);
  const messages: Record<string, unknown>[] = [],
    fakeSelf = {
      onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
      postMessage(message: Record<string, unknown>) {
        messages.push(message);
      },
    };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    value: fakeSelf,
    configurable: true,
  });
  try {
    await import('../lib/reconciliation/worker.ts');
    const caller = structuredClone(base),
      done = fakeSelf.onmessage!({
        data: {
          channel: WORKER_CHANNEL,
          id: 1,
          action: 'ar-reconcile',
          payload: caller,
        },
      } as MessageEvent);
    mutate(caller);
    await done;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].ok, true);
    assert.deepEqual((messages[0].value as Envelope).result, expected.result);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});

void test('AR reply copying includes export bytes, and malformed result additions fail exact comparison', async () => {
  const base = await fixture(true),
    expected = await replayAr(base),
    payload = { state: base, result: expected.result },
    bytes = await exportAr(base, expected.result);
  const port = new Port(),
    client = createWorkerClient(() => port),
    request = client.request<ArrayBuffer>('ar-export', payload);
  port.emit(bytes);
  new Uint8Array(bytes).fill(0);
  assert.ok((await request).byteLength > 0);
  const extra = structuredClone(expected);
  Object.assign(extra.result, { extra: undefined });
  await assert.rejects(
    validateArWorkerResponse(
      'ar-reconcile',
      extra,
      snapshotArRequest('ar-reconcile', base),
    ),
    /AR_WORKER_BINDING/,
  );
});

void test('AR export rejects oversized ZIP expansion metadata and mismatched CRC before accepting content', async () => {
  const base = await fixture(),
    result = (await replayAr(base)).result,
    exported = await exportAr(base, result),
    payload = snapshotArRequest('ar-export', { state: base, result });
  const oversized = exported.slice(0),
    view = new DataView(oversized),
    central = view.getUint32(oversized.byteLength - 22 + 16, true);
  view.setUint32(central + 24, 192 * 1024 * 1024 + 1, true);
  await assert.rejects(
    validateArWorkerResponse('ar-export', oversized, payload),
    /AR_WORKER_EXPORT_CAPACITY/,
  );
  const corrupted = exported.slice(0),
    raw = new DataView(corrupted),
    local = raw.getUint32(central + 42, true),
    crc = raw.getUint32(central + 16, true) ^ 1;
  raw.setUint32(central + 16, crc, true);
  raw.setUint32(local + 14, crc, true);
  await assert.rejects(
    validateArWorkerResponse('ar-export', corrupted, payload),
    /AR_WORKER_EXPORT_ENVELOPE/,
  );
  // Claim a small expansion consistently in both headers; the stream bounds actual bytes.
  const falseSize = exported.slice(0),
    small = new DataView(falseSize);
  let cursor = central;
  while (small.getUint32(cursor, true) === 0x02014b50) {
    const uncompressed = small.getUint32(cursor + 24, true);
    if (uncompressed > 100) {
      const offset = small.getUint32(cursor + 42, true);
      small.setUint32(cursor + 24, 1, true);
      small.setUint32(offset + 22, 1, true);
      break;
    }
    cursor +=
      46 +
      small.getUint16(cursor + 28, true) +
      small.getUint16(cursor + 30, true) +
      small.getUint16(cursor + 32, true);
  }
  await assert.rejects(
    validateArWorkerResponse('ar-export', falseSize, payload),
  );
});

void test('AR malformed reply discards worker and allows a clean retry with bounded transport', async () => {
  const base = await fixture(),
    expected = await replayAr(base),
    ports: Port[] = [];
  const client = createWorkerClient(() => {
    const port = new Port();
    ports.push(port);
    return port;
  });
  const failed = client.request('ar-reconcile', base);
  ports[0].emit({ state: {}, result: {} });
  await assert.rejects(failed, /AR_WORKER_ENVELOPE/);
  assert.equal(ports[0].stopped, true);
  const retry = client.request<Envelope>('ar-reconcile', base);
  assert.equal(ports.length, 2);
  ports[1].emit(expected);
  assert.deepEqual((await retry).result, expected.result);
  const tooManyRows = structuredClone(expected);
  tooManyRows.result.rows = Array.from(
    { length: 40001 },
    () => expected.result.rows[0],
  );
  assert.throws(
    () => validateWorkerValue('ar-reconcile', tooManyRows, base),
    /AR_WORKER_ENVELOPE/,
  );
  const tooManyInventory = structuredClone(expected);
  tooManyInventory.result.inventory = Array.from(
    { length: 40061 },
    () => expected.result.inventory[0],
  );
  assert.throws(
    () => validateWorkerValue('ar-reconcile', tooManyInventory, base),
    /AR_WORKER_ENVELOPE/,
  );
});
