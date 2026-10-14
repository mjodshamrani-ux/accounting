import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  STOCK_VERSION,
  STOCK_SECTION_FAMILY,
  STOCK_ROLES,
  type StockInput,
  type StockEvent,
} from '../lib/reconciliation/inventory-register.ts';
import {
  readStockFile, replayStock, saveStock, restoreStock, exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  snapshotStockInputRequest,
  snapshotStockTransportData,
} from '../lib/reconciliation/inventory-register-request.ts';
import {
  createWorkerClient, type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
import { MAX_FILE_BYTES } from '../lib/reconciliation/types.ts';
import { stockFixture } from '../audit/inventory-register/fixtures.ts';

// Reuse the sealed INV-1A inputs. These boundary tests create no new source family.
const temporary = await mkdtemp(path.join(tmpdir(), 'tarasuf-inv1b-binding-'));
const sources = path.join(temporary, 'sources');
execFileSync(process.env.PYTHON ?? 'python3', ['-B',
  new URL('../audit/inventory-source-diversity-v1/generate.py', import.meta.url).pathname,
  '--output-dir', sources], { timeout: 30000 });
after(async () => rm(temporary, { recursive: true, force: true }));
const scope: StockInput['scope'] = {
  entity: 'Synthetic INV1 Owner', inventoryLedger: 'STOCK-BOOK', glLedger: 'GL-BOOK',
  currency: 'SAR', currencyBasis: 'functional', postingStatus: 'posted', postingLayer: 'Current',
  asOf: '2026-09-30', chartVersion: 'CHART-INV1', mapVersion: 'MAP-INV1',
  valuationPolicyVersion: 'provided-posted-values-1', inventoryAccountSetVersion: 'INV-SET-1', confirmed: true,
};
async function input(xlsx = false): Promise<StockInput> {
  const directory = path.join(sources, 'cases', xlsx ? 'INV1A-P03' : 'INV1A-P02');
  const names = [xlsx ? 'register.xlsx' : 'register.csv', 'source-1.csv', 'source-2.csv', 'source-3.csv'];
  const files = await Promise.all(names.map(async (name) =>
    readStockFile(name, Uint8Array.from(await readFile(path.join(directory, name))).buffer)));
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope: { ...scope },
    readings: STOCK_ROLES.map((role, source) => ({
      sheet: 0, role, family: source === 0 ? STOCK_SECTION_FAMILY : STOCK_VERSION, confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' }, events: [],
  };
}
type Request = { channel: string; id: number; action: string; payload: unknown };
type Response = { channel: string; id: number; action: string; ok: boolean; value?: unknown; error?: string };
function port(reply: (request: Request) => unknown, capture?: (request: Request) => void, afterReply?: () => void) {
  let terminated = 0;
  const worker: WorkerPort = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage(message: unknown) {
      const request = message as Request, handler = worker.onmessage;
      capture?.(request);
      void Promise.resolve().then(() => reply(request)).then((value) => {
        void handler?.call(worker as Worker, { data: {
          channel: WORKER_CHANNEL, id: request.id, action: request.action, ok: true, value,
        } } as MessageEvent);
        afterReply?.();
      }).catch((error: unknown) => {
        void handler?.call(worker as Worker, { data: {
          channel: WORKER_CHANNEL, id: request.id, action: request.action, ok: false,
          error: error instanceof Error ? error.message : 'Synthetic reply failure',
        } } as MessageEvent);
      });
    }, terminate() { terminated++; },
  };
  return { worker, terminated: () => terminated };
}
class StockPort implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  worker: NodeWorker;
  terminated = false;
  constructor(transform: (response: Response) => Response = (response) => response) {
    // This existing bridge installs self and imports the actual shared worker.ts.
    // Its filename is historical; all accounting actions run in that worker.
    this.worker = new NodeWorker(new URL('./helpers/bank-wd-worker.mjs', import.meta.url));
    this.worker.on('message', (response: Response) => this.onmessage?.call(
      this as unknown as Worker, { data: transform(response) } as MessageEvent));
    this.worker.on('error', (error) => this.onerror?.call(
      this as unknown as Worker, { message: error.message } as ErrorEvent));
    this.worker.on('messageerror', (error) => this.onmessageerror?.call(
      this as unknown as Worker, { data: error } as MessageEvent));
  }
  postMessage(message: unknown) { this.worker.postMessage(message); }
  terminate() { this.terminated = true; void this.worker.terminate(); }
}
function event(value: Awaited<ReturnType<typeof replayStock>>, type: StockEvent['type'], id: string): StockEvent {
  return { id, type, memberIds: [...value.result.memberIds], context: value.result.context,
    at: '2026-10-14T12:00:00.000Z', reference: 'Synthetic inventory review', note: 'Whole supplied scope only' };
}
const expectedItems = [
  ['0007', 'warehouse=W1;batch=B01', 10, 'EA', 0, 60000, 'V-0007-W1-B01'],
  ['0007', 'warehouse=W1;batch=B02', 10, 'EA', 0, 40000, 'V-0007-W1-B02'],
  ['0007', 'warehouse=W2;batch=B01', 10, 'EA', 0, 50000, 'V-0007-W2-B01'],
  ['0008', 'warehouse=W1;batch=B00', 0, 'EA', 0, 0, 'V-0008-W1-B00'],
];
function financialTruth(value: Awaited<ReturnType<typeof replayStock>>) {
  assert.equal(value.result.financial, 'ready');
  assert.deepEqual(value.result.records[0].map((record) => record.values), expectedItems);
  assert.deepEqual(value.result.records[0].map((record) => record.row), [14, 24, 34, 44]);
  assert.deepEqual(value.result.totals, { registerMinor: 150000, glMinor: 150000 });
  assert.deepEqual(value.result.comparisons.map((row) => [row.account, row.dimensions, row.registerMinor, row.glMinor, row.differenceMinor]),
    [['INV-1', 'branch=01', 100000, 100000, 0], ['INV-1', 'branch=02', 50000, 50000, 0]]);
  assert.equal(value.result.memberIds.length, 63);
  assert.equal(value.result.inventory.filter((row) => row.source === 0).length, 54);
}

void test('INV-1B stock requests discard cached sheets while synchronously owning originals, families and every decision field', async () => {
  const original = await input(), caller = structuredClone(original);
  caller.files[0].sheets = [];
  const captured = snapshotStockInputRequest(caller);
  assert.ok(captured.files.every((file) => file.sheets.length === 0));
  new Uint8Array(caller.files[3].original!)[0] ^= 1;
  caller.scope.entity = 'Later entity'; caller.readings[0].family = STOCK_VERSION;
  caller.completeness.note = 'Later note';
  assert.deepEqual(captured.scope, original.scope);
  assert.deepEqual(captured.readings, original.readings);
  assert.deepEqual(captured.completeness, original.completeness);
  assert.deepEqual(new Uint8Array(captured.files[3].original!), new Uint8Array(original.files[3].original!));
  for (const marker of [{ kind: 'reviewed-visual-source' }, { pdf: {} }, { visual: {} }, { unknownAuthority: true }]) {
    const forged = structuredClone(original); Object.assign(forged.files[0], marker);
    assert.throws(() => snapshotStockInputRequest(forged), /STOCK_WORKER_SOURCE/);
  }
});

void test('INV-1B the result transport budget admits more than 500000 cell evidence objects without pretending to prove financial capacity', () => {
  const cell = { source: 0, row: 1, column: 1, field: 'Posted value', text: '0' };
  // Repeated references keep the instrument frugal. These are transport objects,
  // not original source rows or an accounting/capacity success case.
  const payload = { cells: Array(524288).fill(cell) };
  const captured = snapshotStockTransportData(payload) as typeof payload;
  assert.equal(captured.cells.length, 524288);
  assert.notEqual(captured, payload);
  assert.notEqual(captured.cells[0], cell);
  assert.throws(() => snapshotStockTransportData({ cells: Array(1400000).fill(cell) }), /STOCK_WORKER_ENVELOPE/);
  assert.throws(() => snapshotStockTransportData({ text: Array(800).fill('x'.repeat(65536)) }), /STOCK_WORKER_ENVELOPE/);
});

for (const xlsx of [false, true]) void test(`INV-1B actual worker ${xlsx ? 'Excel' : 'CSV'} section amounts, dimensions and bindings survive review/save/restore/export/undo`, async () => {
  const ports: StockPort[] = [], client = createWorkerClient(() => {
    const worker = new StockPort(); ports.push(worker); return worker;
  });
  try {
    const state = await input(xlsx);
    for (const file of state.files) assert.deepEqual(await client.request('stock-read', {
      name: file.name, buffer: file.original,
    }), file);
    state.files[0].sheets[0].rows[21][1] = '900.00';
    const checked = await client.request<Awaited<ReturnType<typeof replayStock>>>('stock-reconcile', state);
    financialTruth(checked);
    assert.equal(checked.result.review, 'needs-review');
    state.completeness = { confirmed: true, reference: 'SYN-WHOLE', note: 'All supplied source rows reviewed' };
    const reviewable = await client.request<typeof checked>('stock-reconcile', state);
    state.events = [event(reviewable, 'accept', 'INV-accept')];
    const accepted = await client.request<typeof checked>('stock-reconcile', state);
    financialTruth(accepted); assert.equal(accepted.result.status, 'consistent-with-evidence');
    const session = await client.request<ArrayBuffer>('stock-save', state);
    const envelope = JSON.parse(new TextDecoder().decode(session));
    assert.equal(envelope.version, STOCK_VERSION, 'Do not migrate the legacy session format silently');
    assert.ok(envelope.files.every((file: Record<string, unknown>) => !Object.hasOwn(file, 'sheets')));
    const restored = await client.request<typeof checked>('stock-restore', { buffer: session });
    assert.deepEqual(restored, accepted);
    const workbook = await client.request<ArrayBuffer>('stock-export', accepted);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(workbook);
    const sourcesSheet = book.getWorksheet('Sources')!;
    assert.equal(sourcesSheet.getRow(2).getCell(4).text, xlsx ? 'Supplied stock' : 'CSV');
    assert.equal(sourcesSheet.getRow(2).getCell(5).text, state.files[0].sha256);
    state.events.push(event(accepted, 'undo', 'INV-undo'));
    const undone = await client.request<typeof checked>('stock-reconcile', state);
    financialTruth(undone); assert.equal(undone.result.review, 'needs-review');
  } finally { ports.forEach((worker) => worker.terminate()); }
});

void test('INV-1B caller metadata and original edits inside the worker factory cannot change the submitted scope', async () => {
  const original = await replayStock(await input()), caller = structuredClone(original.state);
  let posted: Request | undefined;
  const p = port((request) => replayStock(request.payload as StockInput), (request) => { posted = request; });
  const client = createWorkerClient(() => {
    new Uint8Array(caller.files[2].original!)[0] ^= 1;
    caller.scope.mapVersion = 'Later map'; caller.readings[0].confirmed = false;
    caller.completeness.note = 'Later note'; caller.events.push(event(original, 'reject', 'late-event'));
    return p.worker;
  });
  const output = await client.request<typeof original>('stock-reconcile', caller);
  assert.deepEqual(output, original);
  assert.ok((posted!.payload as StockInput).files.every((file) => file.sheets.length === 0));
});

async function foreign(state: StockInput) {
  const changed = structuredClone(state), file = changed.files[0];
  changed.events = [];
  changed.files[0] = await readStockFile(file.name,
    new TextEncoder().encode(new TextDecoder().decode(file.original) + '\n').buffer);
  const value = await replayStock(changed);
  assert.equal(value.result.financial, 'ready');
  return value;
}

void test('INV-1B coherent foreign results, scopes, choices and decisions cannot replace the request even when all monetary totals agree', async () => {
  const base = await replayStock(await input()), other = await foreign(base.state);
  assert.deepEqual(other.result.totals, base.result.totals);
  assert.notEqual(other.result.context, base.result.context);
  const saved = await saveStock(base.state);
  for (const [action, payload] of [['stock-reconcile', base.state], ['stock-restore', { buffer: saved }]] as const) {
    const p = port(() => other), client = createWorkerClient(() => p.worker);
    await assert.rejects(client.request(action, payload), /STOCK_WORKER_BINDING/);
    assert.equal(p.terminated(), 1);
  }
  for (const changedField of ['scope', 'completeness', 'events'] as const) {
    const changed = structuredClone(base.state);
    if (changedField === 'scope') changed.scope.mapVersion = 'OTHER';
    if (changedField === 'completeness') changed.completeness.note = 'OTHER';
    if (changedField === 'events') changed.events = [event(base, 'reject', 'other-review')];
    const response = await replayStock(changed), p = port(() => response);
    await assert.rejects(createWorkerClient(() => p.worker).request('stock-reconcile', base.state), /STOCK_WORKER_BINDING/);
  }
});

void test('INV-1B read binds hash, bytes and cached cells to the uploaded section original', async () => {
  const state = await input(), original = state.files[0], other = (await foreign(state)).state.files[0];
  const corrupt = structuredClone(original); corrupt.sheets[0].rows[21][1] = '999.00';
  for (const reply of [other, corrupt, { ...original, sha256: 'a'.repeat(64) }]) {
    const p = port(() => reply);
    await assert.rejects(createWorkerClient(() => p.worker).request('stock-read', {
      name: original.name, buffer: original.original,
    }), /STOCK_WORKER_BINDING/);
  }
  const mutable = original.original!.slice(0), p = port((request) => {
    const payload = request.payload as { name: string; buffer: ArrayBuffer };
    return readStockFile(payload.name, payload.buffer);
  });
  const client = createWorkerClient(() => { new Uint8Array(mutable).fill(0); return p.worker; });
  assert.deepEqual(await client.request('stock-read', { name: original.name, buffer: mutable }), original);
});

void test('INV-1B a disposable reply cache never becomes the installed accounting source', async () => {
  const base = await replayStock(await input()), poisoned = structuredClone(base);
  poisoned.state.files[0].sheets[0].rows[21][1] = '900.00';
  const p = port(() => poisoned);
  const installed = await createWorkerClient(() => p.worker).request<typeof base>('stock-reconcile', base.state);
  assert.deepEqual(installed, base);
  assert.equal(installed.state.files[0].sheets[0].rows[21][1], '600.00');
});

void test('INV-1B returned originals and accounting evidence are captured before asynchronous replay', async () => {
  const base = await replayStock(await input()), reply = structuredClone(base);
  const p = port(() => reply, undefined, () => {
    new Uint8Array(reply.state.files[0].original!)[0] ^= 1;
    reply.state.scope.entity = 'After response';
    reply.result.records[0][0].values[5] = 99999;
  });
  const installed = await createWorkerClient(() => p.worker).request<typeof base>('stock-reconcile', base.state);
  assert.deepEqual(installed, base);
});

void test('INV-1B save and export reject valid foreign outputs while serving exact caller originals', async () => {
  const base = await replayStock(await input()), other = await foreign(base.state);
  for (const action of ['stock-save', 'stock-export'] as const) {
    const response = action === 'stock-save' ? await saveStock(other.state) : await exportStock(other.state, other.result);
    const p = port(() => response), payload = action === 'stock-save' ? base.state : base;
    await assert.rejects(createWorkerClient(() => p.worker).request(action, payload), /STOCK_WORKER_BINDING/);
  }
  const p = port((request) => request.action === 'stock-save'
    ? saveStock(request.payload as StockInput)
    : exportStock((request.payload as typeof base).state, (request.payload as typeof base).result));
  const client = createWorkerClient(() => p.worker);
  assert.deepEqual((await restoreStock(await client.request('stock-save', base.state))).result, base.result);
  assert.ok((await client.request<ArrayBuffer>('stock-export', base)).byteLength > 0);
});

void test('INV-1B export rejects hidden numeric display, formula replacement, unknown ZIP content and forged expanded-size metadata', async () => {
  const base = await replayStock(await input()), original = await exportStock(base.state, base.result);
  const corruptions: ArrayBuffer[] = [];
  const book = new ExcelJS.Workbook(); await book.xlsx.load(original);
  book.getWorksheet('Register')!.getCell('I2').numFmt = ';;;';
  corruptions.push(Uint8Array.from(new Uint8Array(await book.xlsx.writeBuffer())).buffer);
  const formula = new ExcelJS.Workbook(); await formula.xlsx.load(original);
  formula.getWorksheet('Register')!.getCell('I2').value = { formula: '60000', result: 60000 };
  corruptions.push(Uint8Array.from(new Uint8Array(await formula.xlsx.writeBuffer())).buffer);
  const zip = await JSZip.loadAsync(original); zip.file('private-unexpected.txt', 'Unexpected output');
  corruptions.push(await zip.generateAsync({ type: 'arraybuffer' }));
  const badSize = original.slice(0), bytes = new DataView(badSize);
  const central = bytes.getUint32(badSize.byteLength - 22 + 16, true);
  bytes.setUint32(central + 24, 192 * 1024 * 1024 + 1, true); corruptions.push(badSize);
  for (const output of corruptions) {
    const p = port(() => output);
    await assert.rejects(createWorkerClient(() => p.worker).request('stock-export', base), /STOCK_WORKER_(?:BINDING|EXPORT_CAPACITY|EXPORT_ENVELOPE)/);
  }
});

void test('INV-1B decisions remain bound to family, complete physical members and a valid event sequence', async () => {
  const state = await input(); state.completeness = { confirmed: true, reference: 'SYN', note: 'Whole scope' };
  const base = await replayStock(state); state.events = [event(base, 'accept', 'accepted')];
  assert.equal((await replayStock(state)).result.review, 'accepted');
  const changedFamily = structuredClone(state); changedFamily.readings[0].family = STOCK_VERSION;
  await assert.rejects(replayStock(changedFamily), /STOCK_(?:EVENT|READING|SOURCE)/);
  const incompleteMembers = structuredClone(state); incompleteMembers.events[0].memberIds.pop();
  await assert.rejects(replayStock(incompleteMembers), /STOCK_EVENT_MEMBERS/);
  const sequence = structuredClone(state); sequence.events.push(event(base, 'accept', 'accepted-twice'));
  await assert.rejects(replayStock(sequence), /STOCK_EVENT_SEQUENCE/);
  const scopeChanged = structuredClone(state); scopeChanged.scope.asOf = '2026-09-31';
  await assert.rejects(replayStock(scopeChanged), /STOCK_VALIDITY/);
});

void test('INV-1B raw transport bounds and unsupported discriminators fail before creating a worker', async () => {
  const state = await input(); let factories = 0;
  const client = createWorkerClient(() => { factories++; return port(() => null).worker; });
  const oversized = structuredClone(state); oversized.files[0].original = new ArrayBuffer(MAX_FILE_BYTES + 1);
  await assert.rejects(client.request('stock-reconcile', oversized), /STOCK_WORKER_SOURCE/);
  await assert.rejects(client.request('stock-restore', { buffer: new Uint8Array(10) }), /STOCK_WORKER_SOURCE/);
  const marked = structuredClone(state); marked.files[0].kind = 'visual-draft';
  await assert.rejects(client.request('stock-reconcile', marked), /STOCK_WORKER_SOURCE/);
  assert.equal(factories, 0);
});

void test('INV-1B the unchanged canonical session remains readable without promoting it to the new family', async () => {
  const { state } = await stockFixture(), base = await replayStock(state), saved = await saveStock(state);
  const decoded = JSON.parse(new TextDecoder().decode(saved)); assert.equal(decoded.version, STOCK_VERSION);
  const p = port((request) => restoreStock((request.payload as { buffer: ArrayBuffer }).buffer));
  const restored = await createWorkerClient(() => p.worker).request<typeof base>('stock-restore', { buffer: saved });
  assert.deepEqual(restored, base);
  assert.ok(restored.state.readings.every((reading) => reading.family === STOCK_VERSION));
});
