import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createVisualOcr } from '../lib/reconciliation/visual-ocr-client.ts';
import type {
  VisualOcrOptions,
  VisualOcrWorker,
} from '../lib/reconciliation/visual-ocr-client.ts';

type Packet = {
  workerId: string;
  jobId: string;
  action: string;
  payload: Record<string, unknown>;
};
class FakeWorker extends EventTarget implements VisualOcrWorker {
  packets: Packet[] = [];
  transfers: Transferable[][] = [];
  terminated = 0;
  listeners = new Map<string, Set<EventListenerOrEventListenerObject | null>>();
  handle: (packet: Packet) => void = (packet) => this.succeed(packet);
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  postMessage(
    value: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ) {
    const packet = value as Packet;
    this.packets.push(packet);
    this.transfers.push(
      Array.isArray(transferOrOptions)
        ? transferOrOptions
        : (transferOrOptions?.transfer ?? []),
    );
    this.handle(packet);
  }
  terminate() {
    this.terminated++;
  }
  reply(
    packet: Packet,
    status: string,
    data: unknown,
    patch: Record<string, unknown> = {},
  ) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: {
          workerId: packet.workerId,
          jobId: packet.jobId,
          action: packet.action,
          status,
          data,
          ...patch,
        },
      }),
    );
  }
  succeed(packet: Packet) {
    const data =
      packet.action === 'load'
        ? { loaded: true }
        : packet.action === 'loadLanguage'
          ? 'eng+ara'
          : packet.action === 'initialize'
            ? undefined
            : {
                text: 'PRIVATE OCR TEXT',
                blocks: [{ id: 'synthetic-block' }],
                confidence: 99,
              };
    this.reply(packet, 'resolve', data);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}
const assetBaseUrl = 'https://app.test/accounting/';
const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const originalCreate = URL.createObjectURL.bind(URL);
const originalRevoke = URL.revokeObjectURL.bind(URL);
const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  'location',
);
let blobs: Blob[], revoked: string[], constructed: string[];
beforeEach(() => {
  blobs = [];
  revoked = [];
  constructed = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'https://app.test/accounting/' },
  });
  URL.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return `blob:https://app.test/test-${blobs.length}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});
afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  if (originalLocation)
    Object.defineProperty(globalThis, 'location', originalLocation);
  else Reflect.deleteProperty(globalThis, 'location');
});
const options = (
  worker: FakeWorker,
  extra: Partial<VisualOcrOptions> = {},
): VisualOcrOptions => ({
  assetBaseUrl,
  workerFactory: (url) => {
    constructed.push(url);
    return worker;
  },
  ...extra,
});
function cleaned(worker: FakeWorker) {
  assert.equal(worker.terminated, 1);
  assert.equal(worker.listenerCount, 0);
  assert.deepEqual(revoked, constructed);
}

void test('fixed same-origin bootstrap and exact vendor protocol load both languages without fetching', async () => {
  const worker = new FakeWorker();
  const client = await createVisualOcr(options(worker));
  assert.deepEqual(
    worker.packets.map((p) => p.action),
    ['load', 'loadLanguage', 'initialize'],
  );
  assert.equal(new Set(worker.packets.map((p) => p.workerId)).size, 1);
  assert.equal(new Set(worker.packets.map((p) => p.jobId)).size, 3);
  assert.deepEqual(worker.packets[0].payload, {
    options: {
      lstmOnly: true,
      corePath: 'https://app.test/accounting/ocr/tesseract-core-lstm.wasm.js',
      logging: false,
    },
  });
  assert.deepEqual(worker.packets[1].payload, {
    langs: 'eng+ara',
    options: {
      langPath: 'https://app.test/accounting/ocr/languages',
      cacheMethod: 'none',
      gzip: true,
      lstmOnly: true,
    },
  });
  assert.deepEqual(worker.packets[2].payload, {
    langs: 'eng+ara',
    oem: 1,
    config: {},
  });
  const bootstrap = await blobs[0].text();
  assert.equal(
    bootstrap,
    'self.__mizanOcrVendorUrl = "https://app.test/accounting/ocr/worker-vendor.js";\nimportScripts("https://app.test/accounting/ocr/worker.js");',
  );
  assert.ok(!bootstrap.includes('fetch'));
  client.destroy();
  client.destroy();
  cleaned(worker);
});

void test('only blocks leave recognition; caller PNG bytes are neither detached nor overwritten', async () => {
  const worker = new FakeWorker();
  const client = await createVisualOcr(options(worker));
  const source = png(),
    before = [...source];
  const output = await client.recognize(source);
  assert.deepEqual(output, [{ id: 'synthetic-block' }]);
  const packet = worker.packets[3];
  assert.deepEqual(packet.payload.options, {});
  assert.deepEqual(packet.payload.output, { text: true, blocks: true });
  assert.ok(packet.payload.image instanceof Uint8Array);
  assert.notEqual((packet.payload.image as Uint8Array).buffer, source.buffer);
  assert.equal(
    worker.transfers[3][0],
    (packet.payload.image as Uint8Array).buffer,
  );
  assert.deepEqual([...source], before);
  assert.ok(!JSON.stringify(output).includes('PRIVATE'));
  client.destroy();
  cleaned(worker);
});

void test('foreign, credentialed, query/hash and non-HTTP asset bases never construct a worker', async () => {
  for (const base of [
    'https://foreign.test/accounting',
    'https://user:secret@app.test/accounting',
    'https://app.test/accounting?q=private',
    'https://app.test/accounting#private',
    'https://app.test/accounting?',
    'https://app.test/accounting#',
    'data:text/javascript,evil()',
    'file:///private/data',
    'https://app.test/invalid path',
    'https://app.test/\\foreign',
  ]) {
    const worker = new FakeWorker();
    await assert.rejects(
      createVisualOcr(options(worker, { assetBaseUrl: base })),
      /نفس موقع التطبيق/,
    );
    assert.equal(worker.packets.length, 0);
  }
  assert.equal(blobs.length, 0);
  assert.equal(constructed.length, 0);
});

void test('abort before and during every startup stage terminates immediately without an initialization handle', async () => {
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    createVisualOcr(options(new FakeWorker(), { signal: pre.signal })),
    { name: 'AbortError' },
  );
  assert.equal(blobs.length, 0);
  for (const target of ['load', 'loadLanguage', 'initialize']) {
    const worker = new FakeWorker(),
      controller = new AbortController();
    worker.handle = (packet) => {
      if (packet.action === target) controller.abort();
      else worker.succeed(packet);
    };
    await assert.rejects(
      createVisualOcr(options(worker, { signal: controller.signal })),
      { name: 'AbortError' },
    );
    assert.equal(worker.terminated, 1);
    assert.equal(worker.listenerCount, 0);
    assert.equal(worker.packets.at(-1)?.action, target);
  }
  assert.deepEqual(revoked, constructed);
});

void test('abort during worker construction still revokes and terminates the owned handle', async () => {
  const worker = new FakeWorker(),
    controller = new AbortController();
  await assert.rejects(
    createVisualOcr({
      assetBaseUrl,
      signal: controller.signal,
      workerFactory: (url) => {
        constructed.push(url);
        controller.abort();
        return worker;
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(worker.packets.length, 0);
  cleaned(worker);
});

void test('one startup deadline covers all stages even if the worker keeps emitting progress', async () => {
  const worker = new FakeWorker();
  worker.handle = (packet) => {
    if (packet.action === 'load') worker.succeed(packet);
    else
      worker.reply(packet, 'progress', {
        status: 'loading language traineddata',
        progress: 0.5,
      });
  };
  await assert.rejects(
    createVisualOcr(options(worker, { startupTimeoutMs: 15 })),
    { name: 'TimeoutError' },
  );
  cleaned(worker);
});

void test('page deadline hard-terminates a hung recognition and future pages cannot reuse the worker', async () => {
  const worker = new FakeWorker();
  const client = await createVisualOcr(options(worker, { pageTimeoutMs: 15 }));
  worker.handle = () => {};
  await assert.rejects(client.recognize(png()), { name: 'TimeoutError' });
  cleaned(worker);
  await assert.rejects(client.recognize(png()), { name: 'TimeoutError' });
  client.destroy();
  assert.equal(worker.terminated, 1);
});

void test('abort or destroy during recognition settles the page and releases every listener and Blob', async () => {
  for (const abort of [true, false]) {
    const worker = new FakeWorker(),
      controller = new AbortController();
    const client = await createVisualOcr(
      options(worker, { signal: controller.signal }),
    );
    worker.handle = () => {};
    const page = client.recognize(png());
    if (abort) controller.abort();
    else client.destroy();
    await assert.rejects(page, { name: 'AbortError' });
    assert.equal(worker.terminated, 1);
    assert.equal(worker.listenerCount, 0);
  }
  assert.deepEqual(revoked, constructed);
});

void test('concurrent recognition is rejected without changing the active page or its input', async () => {
  const worker = new FakeWorker();
  const client = await createVisualOcr(options(worker));
  worker.handle = () => {};
  const first = client.recognize(png());
  await assert.rejects(client.recognize(png()), /صفحة قيد القراءة/);
  assert.equal(
    worker.packets.filter((p) => p.action === 'recognize').length,
    1,
  );
  worker.succeed(worker.packets.at(-1)!);
  assert.deepEqual(await first, [{ id: 'synthetic-block' }]);
  client.destroy();
  cleaned(worker);
});

void test('unknown, stale and cross-action replies never resolve the active page', async () => {
  for (const patch of [
    { workerId: 'foreign' },
    { jobId: 'stale' },
    { action: 'initialize' },
    { status: 'complete' },
    { approved: true },
  ]) {
    const worker = new FakeWorker();
    const client = await createVisualOcr(options(worker));
    worker.handle = (packet) =>
      worker.reply(packet, 'resolve', { text: 'SECRET', blocks: [] }, patch);
    await assert.rejects(
      client.recognize(png()),
      /استجابة قارئ الصور غير صالحة/,
    );
    assert.equal(worker.terminated, 1);
    assert.equal(worker.listenerCount, 0);
  }
  assert.deepEqual(revoked, constructed);
});

void test('initialize failures are sanitized and late vendor resolve messages cannot resurrect the worker', async () => {
  const worker = new FakeWorker();
  worker.handle = (packet) => {
    if (packet.action !== 'initialize') {
      worker.succeed(packet);
      return;
    }
    worker.reply(packet, 'reject', 'PRIVATE DOCUMENT TEXT / secret file path');
    worker.reply(packet, 'resolve', undefined);
  };
  await assert.rejects(
    createVisualOcr(options(worker)),
    (error: Error) =>
      !error.message.includes('PRIVATE') && /تعذر تشغيل/.test(error.message),
  );
  cleaned(worker);
});

void test('malformed recognition data, worker errors and decode errors are sanitized and release resources', async () => {
  for (const mode of ['text-only', 'null-blocks', 'error', 'messageerror']) {
    const worker = new FakeWorker();
    const client = await createVisualOcr(options(worker));
    worker.handle = (packet) => {
      if (mode === 'text-only')
        worker.reply(packet, 'resolve', { text: 'PRIVATE' });
      else if (mode === 'null-blocks')
        worker.reply(packet, 'resolve', { text: 'PRIVATE', blocks: null });
      else {
        const event = new Event(mode, { cancelable: true });
        Object.defineProperty(event, 'message', {
          value: 'PRIVATE worker failure',
        });
        worker.dispatchEvent(event);
        assert.ok(event.defaultPrevented);
      }
    };
    await assert.rejects(
      client.recognize(png()),
      (error: Error) => !error.message.includes('PRIVATE'),
    );
    assert.equal(worker.terminated, 1);
    assert.equal(worker.listenerCount, 0);
  }
  assert.deepEqual(revoked, constructed);
});

void test('progress uses fixed status labels, rejects malformed status, and never exposes raw worker text', async () => {
  const worker = new FakeWorker();
  const statuses: string[] = [];
  const client = await createVisualOcr(
    options(worker, { onProgress: (status) => statuses.push(status) }),
  );
  worker.handle = (packet) => {
    worker.reply(packet, 'progress', {
      status: 'recognizing text',
      progress: 0.3,
      text: 'PRIVATE',
    });
    worker.succeed(packet);
  };
  await client.recognize(png());
  assert.ok(statuses.includes('قراءة الصفحة على جهازك'));
  assert.ok(statuses.every((status) => !status.includes('PRIVATE')));
  worker.handle = (packet) =>
    worker.reply(packet, 'progress', {
      status: 'PRIVATE DOCUMENT',
      progress: 0.9,
    });
  await assert.rejects(client.recognize(png()), /استجابة قارئ الصور غير صالحة/);
  cleaned(worker);
});

void test('invalid image input never reaches the worker and factory exceptions revoke the Blob', async () => {
  const worker = new FakeWorker();
  const client = await createVisualOcr(options(worker));
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([1, 2, 3]),
    new Uint8Array(10),
  ])
    await assert.rejects(client.recognize(bytes), /صورة الصفحة غير صالحة/);
  assert.equal(worker.packets.length, 3);
  client.destroy();
  cleaned(worker);
  await assert.rejects(
    createVisualOcr({
      assetBaseUrl,
      workerFactory: (url) => {
        constructed.push(url);
        throw Error('PRIVATE constructor failure');
      },
    }),
    (error: Error) => !error.message.includes('PRIVATE'),
  );
  assert.deepEqual(revoked, constructed);
});
