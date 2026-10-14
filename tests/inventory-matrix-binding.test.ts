import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import {
  STOCK_VERSION, STOCK_MATRIX_FAMILY, STOCK_ROLES, type StockInput, type StockEvent,
} from '../lib/reconciliation/inventory-register.ts';
import {
  readStockFile, replayStock, saveStock, exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import { createWorkerClient, type WorkerPort } from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';

// Reuse the learned P04 matrix story for transport regression only. The
// independent INV-1C oracle owns new stories and source-family acceptance.
const temporary = await mkdtemp(path.join(tmpdir(), 'tarasuf-inv1c-binding-'));
execFileSync(process.env.PYTHON ?? 'python3', ['-B', '-c', [
  'from pathlib import Path', 'import runpy,sys',
  'm=runpy.run_path(sys.argv[1])', 'p=Path(sys.argv[2])',
  'm["write_xlsx"](p/"register.xlsx",m["matrix"]())',
  'm["write_csv"](p/"register.csv",m["matrix"]())',
  'for i,rows in enumerate(m["canonical_roles"]()[1:],1): m["write_csv"](p/f"source-{i}.csv",rows)',
].join('\n'), new URL('../audit/inventory-source-diversity-v1/generate.py', import.meta.url).pathname, temporary], { timeout: 30000 });
after(async () => rm(temporary, { recursive: true, force: true }));
const scope: StockInput['scope'] = {
  entity: 'Synthetic INV1 Owner', inventoryLedger: 'STOCK-BOOK', glLedger: 'GL-BOOK',
  currency: 'SAR', currencyBasis: 'functional', postingStatus: 'posted', postingLayer: 'Current',
  asOf: '2026-09-30', chartVersion: 'CHART-INV1', mapVersion: 'MAP-INV1',
  valuationPolicyVersion: 'provided-posted-values-1', inventoryAccountSetVersion: 'INV-SET-1', confirmed: true,
};
async function input(xlsx = false): Promise<StockInput> {
  const names = [xlsx ? 'register.xlsx' : 'register.csv', 'source-1.csv', 'source-2.csv', 'source-3.csv'];
  const files = await Promise.all(names.map(async (name) => readStockFile(name,
    Uint8Array.from(await readFile(path.join(temporary, name))).buffer)));
  return {
    files: [files[0], files[1], files[2], files[3]], scope: { ...scope },
    readings: STOCK_ROLES.map((role, source) => ({
      role, sheet: 0, family: source === 0 ? STOCK_MATRIX_FAMILY : STOCK_VERSION, confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' }, events: [],
  };
}
type Checked = Awaited<ReturnType<typeof replayStock>>;
type Request = { channel: string; id: number; action: string; payload: unknown };
type Response = { channel: string; id: number; action: string; ok: boolean; value?: unknown; error?: string };
function port(reply: (request: Request) => unknown) {
  let terminated = 0;
  const worker: WorkerPort = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage(message: unknown) {
      const request = message as Request, handler = worker.onmessage;
      void Promise.resolve().then(() => reply(request)).then((value) => {
        void handler?.call(worker as Worker, { data: {
          channel: WORKER_CHANNEL, id: request.id, action: request.action, ok: true, value,
        } } as MessageEvent);
      }).catch((error: unknown) => {
        void handler?.call(worker as Worker, { data: {
          channel: WORKER_CHANNEL, id: request.id, action: request.action, ok: false,
          error: error instanceof Error ? error.message : 'Synthetic response failure',
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
  constructor() {
    this.worker = new NodeWorker(new URL('./helpers/bank-wd-worker.mjs', import.meta.url));
    this.worker.on('message', (response: Response) => this.onmessage?.call(
      this as unknown as Worker, { data: response } as MessageEvent));
    this.worker.on('error', (error) => this.onerror?.call(
      this as unknown as Worker, { message: error.message } as ErrorEvent));
    this.worker.on('messageerror', (error) => this.onmessageerror?.call(
      this as unknown as Worker, { data: error } as MessageEvent));
  }
  postMessage(message: unknown) { this.worker.postMessage(message); }
  terminate() { void this.worker.terminate(); }
}
const expected = [
  ['0007', 'warehouse=W1;batch=B01', 10, 'EA', 0, 60000, 'V-0007-W1-B01'],
  ['0007', 'warehouse=W1;batch=B02', 10, 'EA', 0, 40000, 'V-0007-W1-B02'],
  ['0007', 'warehouse=W2;batch=B01', 10, 'EA', 0, 50000, 'V-0007-W2-B01'],
  ['0008', 'warehouse=W1;batch=B00', 0, 'EA', 0, 0, 'V-0008-W1-B00'],
];
function truth(checked: Checked) {
  const source = checked.state.files[0], result = checked.result;
  assert.equal(result.financial, 'ready', JSON.stringify(result.issues));
  assert.deepEqual(result.records[0].map((record) => record.values), expected);
  assert.deepEqual(result.records[0].map((record) => [record.row, record.column]), [[15, 2], [15, 3], [15, 4], [15, 5]]);
  assert.deepEqual(result.records[0].map((record) => JSON.parse(record.id)), [2, 3, 4, 5]
    .map((column) => [STOCK_VERSION, 0, source.sha256, 0, 15, column]));
  assert.deepEqual(result.totals, { registerMinor: 150000, glMinor: 150000 });
  assert.deepEqual(result.comparisons.map((row) => [row.dimensions, row.registerMinor, row.glMinor, row.differenceMinor]),
    [['branch=01', 100000, 100000, 0], ['branch=02', 50000, 50000, 0]]);
  assert.equal(result.memberIds.length, 31);
  assert.equal(new Set(result.memberIds).size, 31);
  assert.ok(result.memberIds.every((id) => JSON.parse(id).length === 5));
  const matrix = result.matrixEvidence;
  assert.ok(matrix); assert.equal(matrix.family, STOCK_MATRIX_FAMILY);
  assert.equal(matrix.sourceHash, source.sha256); assert.equal(matrix.sheetName, source.sheets[0].name);
  assert.equal(matrix.bands.length, 1);
  assert.deepEqual(matrix.bands[0].columns.map(({ column, key }) => [column, key.row, key.column, key.raw]),
    [[2, 14, 2, 'K-A'], [3, 14, 3, 'K-B'], [4, 14, 4, 'K-C'], [5, 14, 5, 'K-Z']]);
  assert.equal(matrix.bands[0].records.length, 4);
  for (const [index, record] of matrix.bands[0].records.entries()) {
    assert.equal(record.recordId, result.records[0][index].id);
    assert.equal(record.column, index + 2);
    assert.deepEqual(Object.keys(record.fields).sort(),
      ['Item ID', 'Item dimensions', 'Quantity', 'Unit', 'Quantity precision', 'Posted value', 'Valuation reference'].sort());
    assert.equal(record.anchor.row, 15); assert.equal(record.anchor.column, index + 2);
    assert.equal(record.axis.row, 14); assert.equal(record.axis.column, index + 2);
    for (const [role, cites] of Object.entries(record.fields)) {
      assert.equal(cites.value.column, record.column); assert.equal(cites.role.column, 1);
      assert.equal(cites.value.row, cites.role.row); assert.equal(cites.role.raw, role);
      for (const cite of [cites.value, cites.role]) {
        assert.equal(cite.sourceHash, source.sha256); assert.equal(cite.sheet, 0);
        assert.equal(cite.sheetName, source.sheets[0].name);
        assert.equal(cite.raw, source.sheets[0].rows[cite.row - 1][cite.column - 1]);
      }
    }
  }
}
function event(checked: Checked, type: StockEvent['type'], id: string): StockEvent {
  return { id, type, memberIds: [...checked.result.memberIds], context: checked.result.context,
    at: '2026-10-14T12:00:00.000Z', reference: 'Synthetic matrix review', note: 'Entire supplied scope reviewed' };
}
async function foreign(state: StockInput) {
  const changed = structuredClone(state), file = changed.files[0]; changed.events = [];
  changed.files[0] = await readStockFile(file.name,
    new TextEncoder().encode(new TextDecoder().decode(file.original) + '\n').buffer);
  const checked = await replayStock(changed); truth(checked); return checked;
}

for (const xlsx of [false, true]) void test(`INV-1C actual worker ${xlsx ? 'XLSX' : 'CSV'} matrix IDs/citations/members survive review/session/export/undo`, async () => {
  const ports: StockPort[] = [], client = createWorkerClient(() => { const p = new StockPort(); ports.push(p); return p; });
  try {
    const state = await input(xlsx);
    for (const file of state.files) assert.deepEqual(await client.request('stock-read', { name: file.name, buffer: file.original }), file);
    state.files[0].sheets[0].rows[19][1] = '999.00';
    const checked = await client.request<Checked>('stock-reconcile', state); truth(checked);
    state.completeness = { confirmed: true, reference: 'WHOLE-MATRIX', note: 'All physical source rows reviewed' };
    const reviewable = await client.request<Checked>('stock-reconcile', state);
    state.events = [event(reviewable, 'accept', 'matrix-accept')];
    const accepted = await client.request<Checked>('stock-reconcile', state); truth(accepted);
    assert.equal(accepted.result.status, 'consistent-with-evidence');
    const session = await client.request<ArrayBuffer>('stock-save', state);
    const envelope = JSON.parse(new TextDecoder().decode(session));
    assert.equal(envelope.version, STOCK_VERSION); assert.equal(envelope.readings[0].family, STOCK_MATRIX_FAMILY);
    assert.ok(envelope.files.every((file: Record<string, unknown>) => !Object.hasOwn(file, 'sheets')));
    assert.deepEqual(await client.request('stock-restore', { buffer: session }), accepted);
    const original = await client.request<ArrayBuffer>('stock-export', accepted);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(original);
    const register = book.getWorksheet('Register')!, headers = register.getRow(1).values as unknown[];
    const column = headers.indexOf('Source column'); assert.ok(column > 0);
    assert.deepEqual([2, 3, 4, 5].map((row) => register.getRow(row).getCell(column).value), [2, 3, 4, 5]);
    assert.ok(book.getWorksheet('Matrix citations'));
    state.events.push(event(accepted, 'undo', 'matrix-undo'));
    const undone = await client.request<Checked>('stock-reconcile', state); truth(undone);
    assert.equal(undone.result.review, 'needs-review');
  } finally { ports.forEach((p) => p.terminate()); }
});

void test('INV-1C equal-text neighboring column citations and unique money totals cannot substitute matrix ownership', async () => {
  const base = await replayStock(await input()); truth(base);
  const changes: ((checked: Checked) => void)[] = [
    (value) => { value.result.matrixEvidence!.bands[0].records[0].fields.Quantity.value.column = 3; },
    (value) => { value.result.matrixEvidence!.bands[0].records[0].fields.Quantity.role.row = 19; },
    (value) => { value.result.records[0][0].column = 3; },
    (value) => { value.result.records[0][0].id = value.result.records[0][1].id; },
    (value) => { value.result.matrixEvidence!.bands[0].records[0].axis.column = 3; },
  ];
  for (const change of changes) {
    const falseReply = structuredClone(base); change(falseReply);
    assert.deepEqual(falseReply.result.totals, base.result.totals);
    const p = port(() => falseReply);
    await assert.rejects(createWorkerClient(() => p.worker).request('stock-reconcile', base.state), /STOCK_WORKER_BINDING/);
    assert.equal(p.terminated(), 1);
  }
});

void test('INV-1C a valid equal-money foreign matrix cannot replace read/reconcile/restore/save/export caller originals', async () => {
  const base = await replayStock(await input()), other = await foreign(base.state); truth(base);
  assert.deepEqual(base.result.totals, other.result.totals); assert.notEqual(base.result.context, other.result.context);
  const session = await saveStock(base.state), foreignSession = await saveStock(other.state), foreignExport = await exportStock(other.state, other.result);
  for (const [action, payload, response] of [
    ['stock-read', { name: base.state.files[0].name, buffer: base.state.files[0].original }, other.state.files[0]],
    ['stock-reconcile', base.state, other], ['stock-restore', { buffer: session }, other],
    ['stock-save', base.state, foreignSession], ['stock-export', base, foreignExport],
  ] as const) {
    const p = port(() => response);
    await assert.rejects(createWorkerClient(() => p.worker).request(action, payload), /STOCK_WORKER_BINDING/);
  }
});

void test('INV-1C logical column IDs do not authorize an incomplete physical review or legacy-family replay', async () => {
  const base = await replayStock(await input()); truth(base);
  base.state.completeness = { confirmed: true, reference: 'WHOLE', note: 'Entire supplied matrix reviewed' };
  const reviewable = await replayStock(base.state);
  for (const members of [reviewable.result.records[0].map((record) => record.id), reviewable.result.memberIds.slice(1)]) {
    const invalid = structuredClone(reviewable.state), accept = event(reviewable, 'accept', 'wrong-members');
    accept.memberIds = members; invalid.events = [accept];
    await assert.rejects(replayStock(invalid), /STOCK_EVENT_MEMBERS/);
  }
  const invalid = structuredClone(reviewable.state), accept = event(reviewable, 'accept', 'old-context');
  const oldContext = JSON.parse(accept.context); oldContext[2][0].family = STOCK_VERSION;
  accept.context = JSON.stringify(oldContext); invalid.events = [accept];
  await assert.rejects(replayStock(invalid), /STOCK_EVENT/);
});

void test('INV-1C a money-correct workpaper with another source column is rejected by caller-bound export', async () => {
  const base = await replayStock(await input()); truth(base);
  const original = await exportStock(base.state, base.result), book = new ExcelJS.Workbook(); await book.xlsx.load(original);
  const register = book.getWorksheet('Register')!, headers = register.getRow(1).values as unknown[];
  const column = headers.indexOf('Source column'); assert.ok(column > 0);
  register.getRow(2).getCell(column).value = 3;
  const falseWorkbook = Uint8Array.from(new Uint8Array(await book.xlsx.writeBuffer())).buffer;
  const p = port(() => falseWorkbook);
  await assert.rejects(createWorkerClient(() => p.worker).request('stock-export', base), /STOCK_WORKER_BINDING/);
});
