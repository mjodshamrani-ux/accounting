import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { finishedGateway } from '../audit/payment-gateway/fixtures.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
import {
  replayGateway,
  saveGateway,
  restoreGateway,
  exportGateway,
} from '../lib/reconciliation/payment-gateway-io.ts';
import { readGatewayFile } from '../lib/reconciliation/payment-gateway-source.ts';
import { snapshotGatewayInput } from '../lib/reconciliation/payment-gateway-worker-binding.ts';
import { MAX_FILE_BYTES } from '../lib/reconciliation/types.ts';
import type { GatewayInput } from '../lib/reconciliation/payment-gateway.ts';
import { readFile } from 'node:fs/promises';
import { PG_ROLES } from '../lib/reconciliation/payment-gateway.ts';

type Request = {
  channel: string;
  id: number;
  action: string;
  payload: unknown;
};
function port(
  reply: (req: Request) => unknown,
  capture?: (req: Request) => void,
) {
  let terminated = 0;
  const worker: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message: unknown) {
      const req = message as Request;
      capture?.(req);
      const handler = worker.onmessage;
      void Promise.resolve()
        .then(() => reply(req))
        .then((value) => {
          void handler?.call(
            worker as Worker,
            {
              data: {
                channel: WORKER_CHANNEL,
                id: req.id,
                action: req.action,
                ok: true,
                value,
              },
            } as MessageEvent,
          );
        });
    },
    terminate() {
      terminated++;
    },
  };
  return { worker, terminated: () => terminated };
}
async function foreignInput(base: GatewayInput) {
  const input = structuredClone(base);
  input.events = [];
  const file = input.files[0];
  const text = new TextDecoder()
    .decode(file.original)
    .replace('Order 001', 'Distinct order 001');
  input.files[0] = await readGatewayFile(
    file.name,
    new TextEncoder().encode(text).buffer,
  );
  return input;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function signedInput(): Promise<GatewayInput> {
  const dir = new URL(
    '../audit/payment-gateway-signed/fixtures/sar-mixed/',
    import.meta.url,
  );
  const bundle = JSON.parse(
    await readFile(new URL('bundle.json', dir), 'utf8'),
  );
  const files = await Promise.all(
    bundle.files.map(async (name: string) =>
      readGatewayFile(
        name,
        Uint8Array.from(await readFile(new URL(name, dir))).buffer,
      ),
    ),
  );
  return {
    files: [files[0], files[1], files[2], files[3]],
    readings: PG_ROLES.map((role, i) => ({
      role,
      sheet: 0,
      family: bundle.readings[i],
      confirmed: true,
    })) as GatewayInput['readings'],
    scope: { ...bundle.scope, confirmed: true },
    completeness: {
      confirmed: true,
      reference: 'Independent synthetic source inventory',
      note: 'Not field evidence',
    },
    events: [],
  };
}

void test('gateway caller snapshots all originals and choices before worker factory, excluding caches', async () => {
  const original = await finishedGateway('pending');
  const caller = structuredClone(original.state);
  let posted: Request | undefined;
  const p = port(
    (r) => replayGateway(r.payload as GatewayInput),
    (r) => {
      posted = r;
    },
  );
  const client = createWorkerClient(() => {
    new Uint8Array(caller.files[3].original!)[0] ^= 1;
    caller.scope.batchId = 'changed-inside-factory';
    caller.readings[0].confirmed = false;
    caller.completeness.note = 'changed';
    caller.events.push({
      id: 'factory-added-event',
      type: 'accept',
      batchId: original.result.scope.batchId,
      memberIds: original.result.memberIds,
      context: original.result.context,
      at: '2026-10-11T13:00:00.000Z',
      reference: 'Synthetic review',
      note: 'Synthetic event',
    });
    return p.worker;
  });
  const output = await client.request<typeof original>(
    'gateway-reconcile',
    caller,
  );
  assert.deepEqual(output.result, original.result);
  assert.equal(
    (posted!.payload as GatewayInput).scope.batchId,
    original.state.scope.batchId,
  );
  assert.ok(
    (posted!.payload as GatewayInput).files.every((f) => f.sheets.length === 0),
  );
  assert.deepEqual(
    new Uint8Array(output.state.files[3].original!),
    new Uint8Array(original.state.files[3].original!),
  );
});

void test('gateway coherent foreign result and restore envelope cannot replace the caller originals', async () => {
  const base = await finishedGateway('pending'),
    foreign = await replayGateway(await foreignInput(base.state));
  assert.equal(foreign.result.financial, base.result.financial);
  assert.notEqual(foreign.result.context, base.result.context);
  const saved = await saveGateway(base.state);
  for (const [action, payload] of [
    ['gateway-reconcile', base.state],
    ['gateway-restore', { buffer: saved }],
  ] as const) {
    const p = port(() => foreign),
      client = createWorkerClient(() => p.worker);
    await assert.rejects(client.request(action, payload), /PG_WORKER_BINDING/);
    assert.equal(p.terminated(), 1);
  }
});

void test('gateway read binds original bytes, name and parsed cells to the upload', async () => {
  const base = await finishedGateway('pending'),
    f = base.state.files[0];
  const other = (await foreignInput(base.state)).files[0];
  for (const value of [other, { ...f, sha256: 'a'.repeat(64) }]) {
    const p = port(() => value),
      client = createWorkerClient(() => p.worker);
    await assert.rejects(
      client.request('gateway-read', { name: f.name, buffer: f.original }),
      /PG_WORKER_BINDING/,
    );
  }
  const p = port(() => f),
    client = createWorkerClient(() => p.worker);
  const result = await client.request<typeof f>('gateway-read', {
    name: f.name,
    buffer: f.original,
  });
  assert.deepEqual(result, f);
});

void test('gateway save and export bind downloaded contents to the captured caller', async () => {
  const base = await finishedGateway('pending'),
    foreign = await replayGateway(await foreignInput(base.state));
  for (const action of ['gateway-save', 'gateway-export']) {
    const wrong =
      action === 'gateway-save'
        ? await saveGateway(foreign.state)
        : await exportGateway(foreign.state, foreign.result);
    const payload =
      action === 'gateway-save'
        ? base.state
        : { state: base.state, result: base.result };
    const p = port(() => wrong),
      client = createWorkerClient(() => p.worker);
    await assert.rejects(client.request(action, payload), /PG_WORKER_BINDING/);
  }
  const p = port((r) =>
    r.action === 'gateway-save'
      ? saveGateway(r.payload as GatewayInput)
      : exportGateway(
          (r.payload as typeof base).state,
          (r.payload as typeof base).result,
        ),
  );
  const client = createWorkerClient(() => p.worker);
  const saved = await client.request<ArrayBuffer>('gateway-save', base.state);
  assert.deepEqual((await restoreGateway(saved)).result, base.result);
  const workbook = await client.request<ArrayBuffer>('gateway-export', base);
  const parsed = new ExcelJS.Workbook();
  await parsed.xlsx.load(workbook);
  assert.equal(
    parsed.getWorksheet('Summary')!.getRow(5).getCell(2).text,
    base.result.status,
  );
});

void test('gateway export rejects display masking even with unchanged underlying money values', async () => {
  const base = await finishedGateway('pending'),
    exported = await exportGateway(base.state, base.result);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported);
  book.getWorksheet('Totals')!.getCell('A2').numFmt = ';;;';
  const masked = Uint8Array.from(
    new Uint8Array(await book.xlsx.writeBuffer()),
  ).buffer;
  const p = port(() => masked),
    client = createWorkerClient(() => p.worker);
  await assert.rejects(
    client.request('gateway-export', base),
    /PG_WORKER_BINDING/,
  );
});

void test('gateway raw transport capacities/types are rejected before original hashing or factory', async () => {
  const base = await finishedGateway('pending');
  let factories = 0;
  const client = createWorkerClient(() => {
    factories++;
    return port(() => base).worker;
  });
  const bad = structuredClone(base.state);
  bad.files[0].original = new ArrayBuffer(MAX_FILE_BYTES + 1);
  await assert.rejects(
    client.request('gateway-reconcile', bad),
    /PG_WORKER_SOURCE/,
  );
  await assert.rejects(
    client.request('gateway-restore', { buffer: new Uint8Array(1) }),
    /PG_WORKER_SOURCE/,
  );
  assert.equal(factories, 0);
  const returned = structuredClone(base);
  returned.state.files[0].original = new ArrayBuffer(MAX_FILE_BYTES + 1);
  const p = port(() => returned),
    goodClient = createWorkerClient(() => p.worker);
  await assert.rejects(goodClient.request('gateway-reconcile', base.state));
  assert.equal(p.terminated(), 1);
});

void test('gateway cancellation during caller replay ignores late response and retry uses a fresh worker', async () => {
  const base = await finishedGateway('pending');
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let first = true,
    factories = 0;
  const firstPort = port(() => base),
    nextPort = port(() => base);
  const client = createWorkerClient(() =>
    ++factories === 1 ? firstPort.worker : nextPort.worker,
  );
  const controller = new AbortController();
  let installed = false;
  crypto.subtle.digest = async (algorithm, data) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return originalDigest(algorithm, data);
  };
  try {
    const request = client
      .request<typeof base>('gateway-reconcile', base.state, controller.signal)
      .then((value) => {
        installed = true;
        return value;
      });
    const rejection = assert.rejects(request, /أُلغيت/);
    await reached;
    controller.abort();
    await rejection;
    assert.equal(firstPort.terminated(), 1);
    release();
    await tick();
    await tick();
    assert.equal(installed, false);
    const retry = await client.request<typeof base>(
      'gateway-reconcile',
      base.state,
    );
    assert.deepEqual(retry.result, base.result);
    assert.equal(factories, 2);
  } finally {
    release();
    crypto.subtle.digest = originalDigest;
  }
});

void test('gateway captured input leaves original cached rows disposable', async () => {
  const base = await finishedGateway('pending'),
    input = structuredClone(base.state);
  input.files[0].sheets[0].rows = [['invented cached rows']];
  const captured = snapshotGatewayInput(input);
  assert.deepEqual((await replayGateway(captured)).result, base.result);
});

void test('signed gateway worker preserves raw sign and magnitude through reconcile/save/restore/export', async () => {
  const input = await signedInput();
  const p = port((r) => {
    if (r.action === 'gateway-reconcile')
      return replayGateway(r.payload as GatewayInput);
    if (r.action === 'gateway-save')
      return saveGateway(r.payload as GatewayInput);
    if (r.action === 'gateway-restore')
      return restoreGateway((r.payload as { buffer: ArrayBuffer }).buffer);
    const payload = r.payload as Awaited<ReturnType<typeof replayGateway>>;
    return exportGateway(payload.state, payload.result);
  });
  const client = createWorkerClient(() => p.worker);
  const checked = await client.request<
    Awaited<ReturnType<typeof replayGateway>>
  >('gateway-reconcile', input);
  assert.equal(checked.result.financial, 'ready');
  assert.deepEqual(checked.result.totals, [15000, 2000, 300, 12700]);
  assert.deepEqual(
    checked.result.records[0].map((r) => [
      r.signedAmount?.raw,
      r.signedAmount?.signedMinor,
      r.signedAmount?.magnitude,
    ]),
    [
      ['+100.00', 10000, 10000],
      ['-20.00', -2000, 2000],
      ['50', 5000, 5000],
    ],
  );
  const saved = await client.request<ArrayBuffer>(
    'gateway-save',
    checked.state,
  );
  const restored = await client.request<typeof checked>('gateway-restore', {
    buffer: saved,
  });
  assert.deepEqual(restored.result, checked.result);
  const exported = await client.request<ArrayBuffer>(
    'gateway-export',
    restored,
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported);
  const row = book.getWorksheet('Transactions')!.getRow(3);
  assert.equal(row.getCell(7).text, '-20.00');
  assert.equal(row.getCell(9).value, -2000);
  assert.equal(row.getCell(10).value, 2000);
});

void test('gateway export snapshots its expected result and original sources before the factory', async () => {
  const checked = await replayGateway(await signedInput());
  const caller = structuredClone(checked);
  const p = port((r) => {
    const input = r.payload as typeof checked;
    return exportGateway(input.state, input.result);
  });
  const client = createWorkerClient(() => {
    caller.result.status = 'difference';
    caller.result.records[0][1].signedAmount!.raw = '20.00';
    new Uint8Array(caller.state.files[3].original!)[0] ^= 1;
    return p.worker;
  });
  const exported = await client.request<ArrayBuffer>('gateway-export', caller);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported);
  assert.equal(
    book.getWorksheet('Transactions')!.getRow(3).getCell(7).text,
    '-20.00',
  );
});
