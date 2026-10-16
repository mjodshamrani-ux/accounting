import { stockFixture } from '../audit/inventory-register/fixtures.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  replayStockPdfOriginals,
  reconcileStock,
  compareInventoryPdfSources,
  type StockPdfReplay,
} from '../lib/reconciliation/inventory-register.ts';
import {
  saveStockPdf,
  restoreStockPdf,
  validateStockPdfWorkerResponse,
} from '../lib/reconciliation/inventory-pdf-lifecycle.ts';
import {
  STOCK_PDF_LIFECYCLE_VERSION,
  snapshotStockPdfState,
  snapshotStockPdfRequest,
  snapshotStockPdfTransport,
  sameStockPdfData,
} from '../lib/reconciliation/inventory-pdf-request.ts';
import {
  readStockFile,
  restoreStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  createWorkerClient,
  workerRequestTimeout,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL, isRequest } from '../lib/reconciliation/protocol.ts';
import { Worker as NodeWorker } from 'node:worker_threads';
import {
  pdfLifecycleFixture,
  g3Contract,
  pdfDecision,
} from './helpers/inventory-pdf-lifecycle-fixture.ts';
const fixture = await pdfLifecycleFixture();
test.after(fixture.close);
const parse = (b: ArrayBuffer) => JSON.parse(new TextDecoder().decode(b));
const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).buffer;
const digest = (b: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const replay = replayStockPdfOriginals;
function truth(r: StockPdfReplay) {
  assert.equal(r.version, STOCK_PDF_LIFECYCLE_VERSION);
  assert.equal(r.result.financial, 'ready');
  assert.deepEqual(r.result.totals, {
    registerMinor: 1285750,
    glMinor: 1285750,
  });
  assert.deepEqual(
    r.result.records[0]
      .map((r) => r.values)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [...g3Contract.facts].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
  );
  assert.equal(r.result.memberIds.length, 28);
  assert.ok(
    r.result.pdfEvidence!.links.every(
      (l) =>
        l.supported &&
        l.mappingIds.length === 1 &&
        l.policyIds.length === 1 &&
        l.glIds.length === 1,
    ),
  );
}
for (const code of [
  ...g3Contract.ready,
  ...g3Contract.difference,
  ...g3Contract.missing,
  ...Object.keys(g3Contract.sourceErrors),
] as string[])
  void test('G4 fresh source/session parity ' + code, async () => {
    const input = await fixture.input(code),
      first = await replay(input);
    const financial = g3Contract.ready.includes(code)
      ? 'ready'
      : g3Contract.difference.includes(code)
        ? 'difference'
        : g3Contract.missing.includes(code)
          ? 'missing'
          : 'source-error';
    assert.equal(first.result.financial, financial);
    assert.equal(first.result.review, 'needs-review');
    assert.deepEqual(await restoreStockPdf(await saveStockPdf(input)), first);
    assert.deepEqual(
      first.state.files.map((f) => digest(f.original)),
      input.files.map((f) => f.sha256),
    );
    if (financial === 'ready') truth(first);
    if (financial === 'source-error') assert.equal(first.result.totals, null);
  });
void test('G4 decisions accept, undo, reject and reopen bind all original members and complete scope', async () => {
  const state = await fixture.input('P03');
  state.completeness = {
    confirmed: true,
    reference: 'Synthetic completeness review',
    note: 'Review includes all source pages',
  };
  let r = await replay(state);
  truth(r);
  for (const [i, type] of (
    ['accept', 'undo', 'reject', 'undo'] as const
  ).entries()) {
    state.events.push(pdfDecision(r, type, 'd-' + i));
    r = await replay(state);
    truth(r);
    assert.equal(
      r.result.review,
      type === 'accept'
        ? 'accepted'
        : type === 'reject'
          ? 'rejected'
          : 'needs-review',
    );
    assert.deepEqual(await restoreStockPdf(await saveStockPdf(state)), r);
  }
});
void test('G4 cannot accept difference, missing, late-page source error or incomplete review', async () => {
  for (const code of ['P02', 'N04', 'N05', 'N10']) {
    const state = await fixture.input(code);
    state.completeness = {
      confirmed: code !== 'P02',
      reference: 'Synthetic review',
      note: 'Explicit review',
    };
    const r = await replay(state);
    state.events.push(pdfDecision(r, 'accept'));
    await assert.rejects(() => replay(state), /STOCK_EVENT_ACCEPT/);
  }
});
void test('G4 rejects G3 context even when source, money and members are the same', async () => {
  const s = await fixture.input();
  const old = await compareInventoryPdfSources({
    files: s.files.map(({ name, original }) => ({ name, original })) as never,
    scope: s.scope,
  });
  s.events.push({
    ...pdfDecision(await replay(s), 'reject'),
    context: old.result.context,
  });
  await assert.rejects(() => replay(s), /STOCK_EVENT/);
});
void test('G4 changed companion original with refreshed digest invalidates previous decision', async () => {
  const s = await fixture.input();
  s.events.push(pdfDecision(await replay(s), 'reject'));
  s.files[3].original = new TextEncoder().encode(
    new TextDecoder().decode(s.files[3].original) + '\n',
  ).buffer;
  s.files[3].sha256 = digest(s.files[3].original);
  await assert.rejects(() => replay(s), /STOCK_EVENT/);
});
void test('G4 changing completeness, scope or physical members cannot carry previous decision', async () => {
  for (const change of ['completeness', 'scope', 'members']) {
    const s = await fixture.input();
    s.events.push(pdfDecision(await replay(s), 'reject'));
    if (change === 'completeness') s.completeness.note = 'Changed choice';
    if (change === 'scope') s.scope.mapVersion = 'FOREIGN';
    if (change === 'members')
      s.events[0].memberIds[0] = s.events[0].memberIds[1];
    await assert.rejects(() => replay(s), /STOCK_EVENT/);
  }
});
void test('G4 owns every original and decision choice before the first await', async () => {
  const input = await fixture.input(),
    expected = structuredClone(input),
    promise = replay(input);
  for (const f of input.files) new Uint8Array(f.original).fill(0);
  input.scope.entity = 'Mutated';
  input.completeness.confirmed = true;
  input.events.push({} as never);
  await assert.doesNotReject(async () => {
    const actual = await promise;
    truth(actual);
    assert.deepEqual(actual.state, expected);
  });
});
void test('G4 rejects changed original bytes, including a later companion, instead of trusting stored digest', async () => {
  for (const index of [0, 1, 2, 3]) {
    const s = await fixture.input();
    new Uint8Array(s.files[index].original)[20] ^= 1;
    await assert.rejects(() => replay(s));
  }
});
void test('G4 rejects caches, fake source geometry, alternate families and result-based authority', async () => {
  for (const key of ['result', 'readings', 'pdfEvidence', 'geometry']) {
    const s = await fixture.input();
    assert.throws(
      () => snapshotStockPdfState({ ...s, [key]: {} }),
      /STOCK_PDF_REQUEST/,
    );
  }
  const s = await fixture.input();
  (s.files[0] as unknown as Record<string, unknown>).sheets = [];
  assert.throws(() => snapshotStockPdfState(s), /STOCK_PDF_SOURCE/);
  assert.throws(
    () => snapshotStockPdfRequest('stock-pdf-export', s),
    /STOCK_PDF_ACTION/,
  );
});
void test('G4 strict session versions and fields prevent legacy migration or cached approvals', async () => {
  const original = parse(await saveStockPdf(await fixture.input()));
  for (const key of ['result', 'readings', 'pdfEvidence', 'sheets']) {
    await assert.rejects(
      () => restoreStockPdf(bytes({ ...original, [key]: {} })),
      /STOCK_PDF_SESSION/,
    );
  }
  for (const version of [
    'inventory-pdf-lifecycle-0',
    'inventory-posted-register-gl-1',
  ])
    await assert.rejects(
      () => restoreStockPdf(bytes({ ...original, version })),
      /STOCK_PDF_SESSION/,
    );
  const altered = structuredClone(original);
  altered.files[3].data = altered.files[2].data;
  await assert.rejects(
    () => restoreStockPdf(bytes(altered)),
    /STOCK_SOURCE_HASH/,
  );
  const noncanonical = structuredClone(original);
  noncanonical.files[0].data += '\n';
  await assert.rejects(
    () => restoreStockPdf(bytes(noncanonical)),
    /STOCK_PDF_SESSION/,
  );
  await assert.rejects(
    async () => restoreStock(await saveStockPdf(await fixture.input())),
    /STOCK_SESSION/,
  );
  await assert.rejects(
    async () =>
      readStockFile('register.pdf', (await fixture.input()).files[0].original),
    /STOCK_SOURCE/,
  );
});
void test('G4 graph envelope permits bounded native glyph strings and rejects cycles, NaN and excessive depth', () => {
  assert.equal(
    (snapshotStockPdfTransport({ text: 'x'.repeat(65537) }) as { text: string })
      .text.length,
    65537,
  );
  for (const v of [
    { text: 'x'.repeat(2000001) },
    { n: NaN },
    new Date(),
    { loop: null as unknown },
  ]) {
    if (typeof v === 'object' && 'loop' in v) v.loop = v;
    assert.throws(() => snapshotStockPdfTransport(v), /STOCK_PDF_ENVELOPE/);
  }
  assert.equal(sameStockPdfData({ n: false }, { n: 0 }), false);
});
void test('G4 worker rejects changed fields, quantities, zero, foreign dimensions, citations and financial links', async () => {
  const s = await fixture.input(),
    baseline = await replay(s);
  for (const change of [
    (r: StockPdfReplay) => {
      r.result.totals!.registerMinor = 0;
    },
    (r: StockPdfReplay) => {
      r.result.records[0][0].values[2] = 500;
    },
    (r: StockPdfReplay) => {
      r.result.records[0][0].values[1] = 'warehouse=FOREIGN;batch=LOT-X';
    },
    (r: StockPdfReplay) => {
      r.result.pdfEvidence!.links[0].mappingIds =
        r.result.pdfEvidence!.links[1].mappingIds;
    },
    (r: StockPdfReplay) => {
      r.result.pdfEvidence!.links[0].policyIds =
        r.result.pdfEvidence!.links[1].policyIds;
    },
    (r: StockPdfReplay) => {
      r.result.pdfEvidence!.links[0].glIds =
        r.result.pdfEvidence!.links[1].glIds;
    },
    (r: StockPdfReplay) => {
      r.result.pdfEvidence!.reading.source.pages[0].literals.text = 'Forged';
    },
    (r: StockPdfReplay) => {
      r.result.pdfEvidence!.reading.records[0].page = 99;
    },
    (r: StockPdfReplay) => {
      r.result.memberIds.pop();
    },
    (r: StockPdfReplay) => {
      r.result.review = 'accepted';
    },
    (r: StockPdfReplay) => {
      r.state.files[3].name = 'foreign.csv';
    },
  ]) {
    const changed = structuredClone(baseline);
    change(changed);
    await assert.rejects(
      async () =>
        validateStockPdfWorkerResponse('stock-pdf-reconcile', changed, s),
      /STOCK_PDF_WORKER_BINDING/,
    );
  }
});
void test('G4 response snapshots resist mutation during fresh source replay', async () => {
  const s = await fixture.input(),
    value = await replay(s),
    wanted = structuredClone(value);
  const pending = validateStockPdfWorkerResponse(
    'stock-pdf-reconcile',
    value,
    s,
  );
  value.result.totals!.registerMinor = 0;
  value.result.pdfEvidence!.links.length = 0;
  new Uint8Array(value.state.files[0].original).fill(0);
  await assert.doesNotReject(async () =>
    assert.deepEqual(await pending, wanted),
  );
});
void test('G4 foreign but internally consistent worker reply and saved session cannot replace request', async () => {
  const s = await fixture.input('P02'),
    other = await fixture.input('P03');
  await assert.rejects(
    async () =>
      validateStockPdfWorkerResponse(
        'stock-pdf-reconcile',
        await replay(other),
        s,
      ),
    /STOCK_PDF_WORKER_BINDING/,
  );
  await assert.rejects(
    async () =>
      validateStockPdfWorkerResponse(
        'stock-pdf-save',
        await saveStockPdf(other),
        s,
      ),
    /STOCK_PDF_WORKER_BINDING/,
  );
  await assert.rejects(
    async () =>
      validateStockPdfWorkerResponse('stock-pdf-restore', await replay(other), {
        buffer: await saveStockPdf(s),
      }),
    /STOCK_PDF_WORKER_BINDING/,
  );
});
class Port implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  worker = new NodeWorker(
    new URL('./helpers/bank-wd-worker.mjs', import.meta.url),
  );
  constructor() {
    this.worker.on('message', (data) =>
      this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent),
    );
    this.worker.on('error', (e) =>
      this.onerror?.call(
        this as unknown as Worker,
        { message: e.message } as ErrorEvent,
      ),
    );
  }
  postMessage(message: unknown) {
    this.worker.postMessage(message);
  }
  terminate() {
    void this.worker.terminate();
  }
}
void test('G4 actual Worker roundtrip, review, save and restore keep original amounts and page/member evidence', async () => {
  const port = new Port(),
    client = createWorkerClient(() => port, 60000);
  try {
    const s = await fixture.input('P04');
    s.completeness = {
      confirmed: true,
      reference: 'Synthetic completeness',
      note: 'All pages reviewed',
    };
    const first = await client.request<StockPdfReplay>(
      'stock-pdf-reconcile',
      s,
    );
    truth(first);
    s.events.push(pdfDecision(first, 'accept'));
    const accepted = await client.request<StockPdfReplay>(
      'stock-pdf-reconcile',
      s,
    );
    truth(accepted);
    assert.equal(accepted.result.review, 'accepted');
    const saved = await client.request<ArrayBuffer>('stock-pdf-save', s);
    assert.deepEqual(
      await client.request('stock-pdf-restore', { buffer: saved }),
      accepted,
    );
  } finally {
    port.terminate();
  }
});
void test('G4 request protocol rejects alternate top-level fields and uses PDF replay deadline', () => {
  assert.equal(workerRequestTimeout('stock-pdf-reconcile', {}), 180000);
  assert.equal(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 1,
      action: 'stock-pdf-reconcile',
      payload: {},
      extra: true,
    }),
    false,
  );
});
function fakePort(
  reply: (action: string, payload: unknown) => unknown,
  after?: () => void,
) {
  let stopped = 0;
  const worker: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message: unknown) {
      const m = message as { id: number; action: string; payload: unknown };
      const handler = worker.onmessage;
      void Promise.resolve()
        .then(() => reply(m.action, m.payload))
        .then((value) => {
          void handler?.call(
            worker as Worker,
            {
              data: {
                channel: WORKER_CHANNEL,
                id: m.id,
                action: m.action,
                ok: true,
                value,
              },
            } as MessageEvent,
          );
          after?.();
        })
        .catch((error: unknown) => {
          void handler?.call(
            worker as Worker,
            {
              data: {
                channel: WORKER_CHANNEL,
                id: m.id,
                action: m.action,
                ok: false,
                error:
                  error instanceof Error ? error.message : 'Synthetic failure',
              },
            } as MessageEvent,
          );
        });
    },
    terminate() {
      stopped++;
    },
  };
  return { worker, stopped: () => stopped };
}
void test('G4 client rejects foreign financial response and terminates that worker', async () => {
  const input = await fixture.input('P02'),
    foreign = await replay(await fixture.input('P03'));
  const p = fakePort(() => foreign),
    client = createWorkerClient(() => p.worker);
  await assert.rejects(
    () => client.request('stock-pdf-reconcile', input),
    /STOCK_PDF_WORKER_BINDING/,
  );
  assert.equal(p.stopped(), 1);
});
void test('G4 client owns originals before the Worker factory can mutate caller input', async () => {
  const input = await fixture.input(),
    expected = structuredClone(input),
    p = fakePort((_, payload) => replay(payload as typeof input));
  const client = createWorkerClient(() => {
    new Uint8Array(input.files[0].original).fill(0);
    input.scope.entity = 'Mutated in factory';
    return p.worker;
  });
  const actual = await client.request<StockPdfReplay>(
    'stock-pdf-reconcile',
    input,
  );
  truth(actual);
  assert.deepEqual(actual.state, expected);
});
void test('G4 abort during async response validation cannot install its late result and retry uses fresh Worker', async () => {
  const input = await fixture.input(),
    controller = new AbortController();
  let created = 0;
  const client = createWorkerClient(() => {
    created++;
    return fakePort(
      (_, payload) => replay(payload as typeof input),
      created === 1 ? () => controller.abort() : undefined,
    ).worker;
  });
  await assert.rejects(
    () => client.request('stock-pdf-reconcile', input, controller.signal),
    /أُلغيت/,
  );
  truth(await client.request<StockPdfReplay>('stock-pdf-reconcile', input));
  assert.equal(created, 2);
});
void test('G4 explicit session reload never accepts old cached source geometry after source replacement', async () => {
  const s = await fixture.input('P04'),
    before = await replay(s),
    next = await fixture.input('N10');
  const fake = structuredClone(before);
  fake.state.files = next.files;
  await assert.rejects(
    () => validateStockPdfWorkerResponse('stock-pdf-reconcile', fake, next),
    /STOCK_PDF_WORKER_BINDING/,
  );
  const fresh = await restoreStockPdf(await saveStockPdf(next));
  assert.equal(fresh.result.financial, 'source-error');
  assert.equal(fresh.result.totals, null);
});
void test('G4 a valid appended CSV blank row cannot bypass the declared digest', async () => {
  const state = await fixture.input();
  state.files[3].original = new TextEncoder().encode(
    new TextDecoder().decode(state.files[3].original) + '\n',
  ).buffer;
  await assert.rejects(() => replay(state), /STOCK_SOURCE_HASH/);
});
void test('G4 a unique foreign physical member cannot replace a real member', async () => {
  const s = await fixture.input();
  s.events.push(pdfDecision(await replay(s), 'reject'));
  s.events[0].memberIds[0] = JSON.stringify([
    'inventory-native-pdf-register-1',
    0,
    'a'.repeat(64),
    1,
    1,
  ]);
  await assert.rejects(() => replay(s), /STOCK_EVENT_MEMBERS/);
});
void test('G4 equivalent reordered object fields remain valid while arrays and source bytes retain order', async () => {
  const s = await fixture.input(),
    fresh = await replay(s);
  const reorder = (v: unknown): unknown => {
    if (v instanceof ArrayBuffer) return v.slice(0);
    if (Array.isArray(v)) return v.map(reorder);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .reverse()
          .map(([k, value]) => [k, reorder(value)]),
      );
    return v;
  };
  assert.deepEqual(
    await validateStockPdfWorkerResponse(
      'stock-pdf-reconcile',
      reorder(fresh),
      s,
    ),
    fresh,
  );
  const changed = structuredClone(fresh);
  changed.result.records[0].reverse();
  await assert.rejects(
    () => validateStockPdfWorkerResponse('stock-pdf-reconcile', changed, s),
    /STOCK_PDF_WORKER_BINDING/,
  );
});
void test('G4 sparse decision members cannot approve incomplete physical evidence', async () => {
  for (const extra of [false, true]) {
    const s = await fixture.input();
    s.completeness = {
      confirmed: true,
      reference: 'Synthetic review',
      note: 'All original pages reviewed',
    };
    s.events.push(pdfDecision(await replay(s), 'accept'));
    Reflect.deleteProperty(s.events[0].memberIds, '0');
    if (extra)
      (s.events[0].memberIds as unknown as Record<string, unknown>).hidden =
        'Compensating non-index property';
    await assert.rejects(() => replay(s), /STOCK_EVENT_CAPACITY/);
  }
});
void test('G4 dense choices cannot carry non-index properties or sparse source slots', async () => {
  const s = await fixture.input();
  (s.events as unknown as Record<string, unknown>).hidden = 'Ignored choice';
  assert.throws(() => snapshotStockPdfState(s), /STOCK_EVENT_CAPACITY/);
  const other = await fixture.input();
  Reflect.deleteProperty(other.files, '0');
  assert.throws(() => snapshotStockPdfState(other), /STOCK_PDF_REQUEST/);
});
void test('G4 shared guard also prevents sparse approval in the legacy CSV kernel', async () => {
  const { state } = await stockFixture();
  state.completeness = {
    confirmed: true,
    reference: 'Synthetic legacy review',
    note: 'All original rows reviewed',
  };
  const r = reconcileStock(state);
  assert.equal(r.financial, 'ready');
  state.events.push({
    id: 'sparse-legacy',
    type: 'accept',
    context: r.context,
    memberIds: [...r.memberIds],
    at: '2026-10-16T09:00:00.000Z',
    reference: 'Synthetic review',
    note: 'Whole original scope',
  });
  Reflect.deleteProperty(state.events[0].memberIds, '0');
  assert.throws(() => reconcileStock(state), /STOCK_EVENT_CAPACITY/);
});
void test('G4 actual Worker rejects sparse evidence even when the client preflight is bypassed', async () => {
  const port = new Port(),
    state = await fixture.input();
  state.completeness = {
    confirmed: true,
    reference: 'Synthetic review',
    note: 'All pages',
  };
  state.events.push(pdfDecision(await replay(state), 'accept'));
  Reflect.deleteProperty(state.events[0].memberIds, '0');
  try {
    const reply = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error('Raw Worker timeout')),
          10000,
        );
        port.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        port.onerror = () => {
          clearTimeout(timer);
          reject(Error('Raw Worker failure'));
        };
        port.postMessage({
          channel: WORKER_CHANNEL,
          id: 101,
          action: 'stock-pdf-reconcile',
          payload: state,
        });
      },
    );
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'STOCK_EVENT_CAPACITY');
    assert.equal(Object.hasOwn(reply, 'value'), false);
  } finally {
    port.terminate();
  }
});
