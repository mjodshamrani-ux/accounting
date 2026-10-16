import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Worker } from 'node:worker_threads';
import { replayStockPdfOriginals } from '../lib/reconciliation/inventory-register.ts';
import { exportStockPdf } from '../lib/reconciliation/inventory-pdf-workbook.ts';
import { stockPdfTextParts } from '../lib/reconciliation/inventory-pdf-workbook-evidence.ts';
import { validateStockPdfWorkerResponse } from '../lib/reconciliation/inventory-pdf-lifecycle.ts';
import { snapshotStockPdfRequest } from '../lib/reconciliation/inventory-pdf-request.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL, isRequest } from '../lib/reconciliation/protocol.ts';
import {
  pdfLifecycleFixture,
  pdfDecision,
  g3Contract,
} from './helpers/inventory-pdf-lifecycle-fixture.ts';
const fixture = await pdfLifecycleFixture();
test.after(fixture.close);
const payload = async (code = 'P02') => {
  const state = await fixture.input(code);
  return { state, result: (await replayStockPdfOriginals(state)).result };
};
async function book(bytes: ArrayBuffer) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(bytes as never);
  return b;
}
const rows = (b: ExcelJS.Workbook, name: string): unknown[][] => {
  const s = b.getWorksheet(name);
  assert.ok(s, name);
  return Array.from({ length: s.rowCount - 1 }, (_, i) => {
    const r = s.getRow(i + 2);
    return Array.from(
      { length: s.columnCount },
      (_, c) => r.getCell(c + 1).value ?? null,
    );
  });
};
for (const code of [
  ...g3Contract.ready,
  ...g3Contract.difference,
  ...g3Contract.missing,
  ...Object.keys(g3Contract.sourceErrors),
] as string[])
  void test(
    'G5a PDF workbook retains exact accounting, literal evidence and originals ' +
      code,
    async () => {
      const p = await payload(code),
        b = await book(await exportStockPdf(p)),
        r = p.result;
      const summary = new Map(rows(b, 'Summary').map(([k, v]) => [k, v]));
      assert.equal(summary.get('Financial'), r.financial);
      assert.equal(
        summary.get('Register minor'),
        r.totals?.registerMinor ?? null,
      );
      assert.equal(summary.get('GL minor'), r.totals?.glMinor ?? null);
      assert.equal(summary.get('Review'), 'needs-review');
      assert.deepEqual(
        rows(b, 'Register'),
        r.records[0].map((v) => [v.id, v.source, v.row, v.page, ...v.values]),
      );
      const e = r.pdfEvidence!;
      const evidence = rows(b, 'PDF evidence');
      assert.ok(
        evidence.every(
          (row, i) => row[2] === i + 1 && row[3] === evidence.length,
        ),
      );
      assert.deepEqual(JSON.parse(evidence.map((row) => row[4]).join('')), e);
      assert.deepEqual(
        rows(b, 'PDF literals'),
        e.literals.map((v) => [
          v.span.sourceHash,
          v.span.page,
          v.span.line,
          JSON.stringify(v.span.items),
          v.start,
          v.end,
          JSON.stringify(v.operators),
          1,
          1,
          v.text,
        ]),
      );
      assert.deepEqual(
        rows(b, 'PDF records'),
        e.records.flatMap((v) =>
          Object.entries(v.raw).map(([field, raw]) => [
            v.id,
            v.page,
            v.line,
            v.row,
            field,
            raw,
          ]),
        ),
      );
      assert.equal(
        rows(b, 'PDF links').length,
        e.links.reduce(
          (n, l) =>
            n + l.mappingIds.length + l.policyIds.length + l.glIds.length + 1,
          0,
        ),
      );
      const originalRows = rows(b, 'Sources');
      for (const [i, f] of p.state.files.entries()) {
        const parts = originalRows.filter((v) => v[0] === i);
        assert.ok(
          parts.every(
            (v, n) =>
              v[2] === f.name &&
              v[3] === (i ? 'CSV' : 'PDF') &&
              v[4] === f.sha256 &&
              v[5] === n + 1 &&
              v[6] === parts.length,
          ),
        );
        assert.equal(
          parts.map((v) => v[7]).join(''),
          Buffer.from(f.original).toString('base64'),
        );
      }
    },
  );
void test('G5a output records complete accept and undo history, never a fresh automatic approval', async () => {
  const s = await fixture.input('P03');
  s.completeness = {
    confirmed: true,
    reference: 'Synthetic completeness review',
    note: 'All original pages reviewed',
  };
  for (const type of ['accept', 'undo', 'reject', 'undo'] as const) {
    const prior = await replayStockPdfOriginals(s);
    s.events.push(pdfDecision(prior, type, 'event-' + s.events.length));
    const r = (await replayStockPdfOriginals(s)).result;
    const b = await book(await exportStockPdf({ state: s, result: r }));
    assert.equal(
      new Map(rows(b, 'Summary').map(([k, v]) => [k, v])).get('Review'),
      r.review,
    );
    assert.equal(rows(b, 'Events').length, s.events.length);
    assert.deepEqual(
      rows(b, 'Event members'),
      s.events.flatMap((e) => e.memberIds.map((id) => [e.id, id])),
    );
  }
});
void test('G5a expected result, original bytes and choices are captured before awaiting', async () => {
  const p = await payload(),
    original = structuredClone(p);
  const pending = exportStockPdf(p);
  p.result.totals!.registerMinor++;
  p.result.pdfEvidence!.literals[0].text = 'caller mutation';
  p.state.scope.entity = 'FOREIGN';
  for (const f of p.state.files) new Uint8Array(f.original).fill(0);
  let exported!: ArrayBuffer;
  await assert.doesNotReject(async () => {
    exported = await pending;
  });
  const b = await book(exported);
  assert.equal(
    new Map(rows(b, 'Summary').map(([k, v]) => [k, v])).get('Register minor'),
    original.result.totals!.registerMinor,
  );
  assert.deepEqual(
    JSON.parse(
      rows(b, 'PDF evidence')
        .map((v) => v[4])
        .join(''),
    ),
    original.result.pdfEvidence,
  );
});
void test('G5a changed result fields cannot be exported even if totals remain equal', async () => {
  const base = await payload();
  for (const mutate of [
    (p: typeof base) => {
      p.result.records[0][0].values[0] = '000FOREIGN';
    },
    (p: typeof base) => {
      p.result.records[0][0].values[2] = 500;
    },
    (p: typeof base) => {
      p.result.pdfEvidence!.links[0].mappingIds = [];
    },
    (p: typeof base) => {
      p.result.pdfEvidence!.literals[0].text += ' ';
    },
    (p: typeof base) => {
      p.result.pdfEvidence!.records[0].page++;
    },
    (p: typeof base) => {
      p.result.review = 'accepted';
    },
    (p: typeof base) => {
      p.result.totals!.registerMinor++;
    },
  ]) {
    const p = structuredClone(base);
    mutate(p);
    await assert.rejects(() => exportStockPdf(p), /STOCK_PDF_STALE_EXPORT/);
  }
});
void test('G5a changed source, context, choices or old financial cache cannot authorize export', async () => {
  const base = await payload();
  const p = structuredClone(base);
  p.state.completeness.note = 'Changed scope review';
  await assert.rejects(() => exportStockPdf(p), /STOCK_PDF_STALE_EXPORT/);
  const bad = structuredClone(base);
  new Uint8Array(bad.state.files[3].original)[30] ^= 1;
  await assert.rejects(() => exportStockPdf(bad));
  for (const extra of [
    { cache: {} },
    { geometry: {} },
    { financialApproval: true },
  ])
    assert.throws(
      () => snapshotStockPdfRequest('stock-pdf-export', { ...base, ...extra }),
      /STOCK_PDF_EXPORT_REQUEST/,
    );
  assert.ok(
    isRequest({
      channel: WORKER_CHANNEL,
      id: 2,
      action: 'stock-pdf-export',
      payload: base,
    }),
  );
});
void test('G5a returned workbook cannot replace a captured request, even if valid and self-consistent', async () => {
  const a = await payload('P02'),
    foreign = await payload('P03');
  const bytes = await exportStockPdf(foreign);
  await assert.rejects(
    () => validateStockPdfWorkerResponse('stock-pdf-export', bytes, a),
    /STOCK_PDF_WORKER_EXPORT_BINDING/,
  );
  const expected = await exportStockPdf(a);
  assert.ok(
    await validateStockPdfWorkerResponse('stock-pdf-export', expected, a),
  );
});
void test('G5a altered amounts, literal text, membership, source bytes and extra ZIP payload are refused', async () => {
  const p = await payload(),
    valid = await exportStockPdf(p);
  for (const [name, row, column, replacement] of [
    ['Summary', 19, 2, 0],
    ['Register', 2, 7, 999],
    ['PDF links', 2, 3, 'foreign-member'],
    ['PDF literals', 2, 10, 'foreign literal'],
    ['PDF evidence', 2, 5, '{}'],
    ['Sources', 2, 8, 'AAAA'],
  ] as const) {
    const b = await book(valid);
    b.getWorksheet(name)!.getCell(row, column).value = replacement;
    const tampered = new Uint8Array(await b.xlsx.writeBuffer()).buffer;
    await assert.rejects(
      () => validateStockPdfWorkerResponse('stock-pdf-export', tampered, p),
      /STOCK_PDF_WORKER_EXPORT_BINDING/,
    );
  }
  const trailing = new Uint8Array(valid.byteLength + 1);
  trailing.set(new Uint8Array(valid));
  await assert.rejects(
    () =>
      validateStockPdfWorkerResponse('stock-pdf-export', trailing.buffer, p),
    /STOCK_WORKER_EXPORT_ENVELOPE/,
  );
});
void test('G5a chunk boundaries preserve UTF-16 surrogate pairs without truncation', () => {
  const text = 'a'.repeat(29999) + '😀' + 'ب'.repeat(60000);
  const parts = stockPdfTextParts(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every((p) => p.length <= 30000 && p.isWellFormed()));
});
void test('G5a worker validation owns returned ZIP and requested evidence before awaiting', async () => {
  const p = await payload(),
    valid = await exportStockPdf(p);
  const pending = validateStockPdfWorkerResponse('stock-pdf-export', valid, p);
  new Uint8Array(valid).fill(0);
  p.result.review = 'accepted';
  p.state.completeness.note = 'Mutated during validation';
  let bytes!: ArrayBuffer;
  await assert.doesNotReject(async () => {
    bytes = (await pending) as ArrayBuffer;
  });
  const b = await book(bytes);
  assert.equal(
    new Map(rows(b, 'Summary').map(([k, v]) => [k, v])).get('Review'),
    'needs-review',
  );
});
void test('G5a formula-like names and reviewer text remain literal workbook strings', async () => {
  const s = await fixture.input();
  s.files[0].name = '=1+1.pdf';
  await assert.rejects(() => replayStockPdfOriginals(s), /STOCK_IDENTITY/);
  s.files[0].name = 'review =1+1.pdf';
  const r = await replayStockPdfOriginals(s),
    e = pdfDecision(r, 'reject');
  e.reference = 'Review =HYPERLINK("https://example.invalid")';
  e.note = 'Note +CMD';
  s.events.push(e);
  const result = (await replayStockPdfOriginals(s)).result;
  const b = await book(await exportStockPdf({ state: s, result }));
  assert.equal(rows(b, 'Sources')[0][2], s.files[0].name);
  assert.equal(rows(b, 'Events')[0][4], e.reference);
  assert.equal(rows(b, 'Events')[0][5], e.note);
  for (const sheet of b.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
        assert.notEqual(cell.type, ExcelJS.ValueType.Hyperlink);
      }),
    );
});
class NativePort implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  worker = new Worker(new URL('./helpers/bank-wd-worker.mjs', import.meta.url));
  constructor() {
    this.worker.on('message', (data) =>
      this.onmessage?.call(
        this as unknown as globalThis.Worker,
        { data } as MessageEvent,
      ),
    );
    this.worker.on('error', (e) =>
      this.onerror?.call(
        this as unknown as globalThis.Worker,
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
void test('G5a genuine structured-clone Worker exports the requested original PDF result', async () => {
  const port = new NativePort(),
    client = createWorkerClient(() => port, 60000);
  try {
    const p = await payload('P04');
    const bytes = await client.request<ArrayBuffer>('stock-pdf-export', p);
    const b = await book(bytes);
    assert.equal(rows(b, 'Register').length, 7);
    assert.deepEqual(
      JSON.parse(
        rows(b, 'PDF evidence')
          .map((v) => v[4])
          .join(''),
      ),
      p.result.pdfEvidence,
    );
  } finally {
    port.terminate();
  }
});
void test('G5a cancelled native export cannot install a late ZIP and retry uses a fresh Worker', async () => {
  const ports: NativePort[] = [];
  const client = createWorkerClient(() => {
    const p = new NativePort();
    ports.push(p);
    return p;
  }, 60000);
  try {
    const p = await payload(),
      control = new AbortController();
    const pending = client.request('stock-pdf-export', p, control.signal);
    control.abort();
    await assert.rejects(pending, /Abort|cancel|أُلغيت|إلغاء/i);
    const data = await client.request<ArrayBuffer>('stock-pdf-export', p);
    assert.equal(rows(await book(data), 'Register').length, 7);
    assert.ok(ports.length >= 2);
  } finally {
    for (const p of ports) p.terminate();
  }
});
