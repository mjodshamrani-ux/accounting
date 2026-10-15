import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { hierarchyInput } from './inventory-hierarchy-fixture.ts';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  createWorkerClient,
  type WorkerPort,
} from '../lib/reconciliation/worker-client.ts';
import { WORKER_CHANNEL } from '../lib/reconciliation/protocol.ts';
async function edited(edit: (s: ExcelJS.Worksheet) => void) {
  const input = await hierarchyInput('P02');
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(input.files[0].original!);
  edit(b.worksheets[0]);
  input.files[0] = await readStockFile(
    'register.xlsx',
    Uint8Array.from(new Uint8Array(await b.xlsx.writeBuffer())).buffer,
  );
  return input;
}
void test('INV-1D native numeric quantity and money retain stored precision and original header merge geometry', async () => {
  const input = await edited((s) => {
    s.getCell('B17').value = 1.25;
    s.getCell('D17').value = 2;
    s.getCell('E17').value = 400;
    s.getCell('E17').numFmt = '0.00';
  });
  const r = await replayStock(input);
  assert.equal(r.result.financial, 'ready', JSON.stringify(r.result.issues));
  assert.deepEqual(r.result.records[0][0].values, [
    '0009',
    'warehouse=W1;batch=B7',
    125,
    'KG',
    2,
    40000,
    'VAL-A',
  ]);
  assert.deepEqual(r.result.hierarchyEvidence!.records[0].parent.merge, {
    top: 14,
    left: 2,
    bottom: 14,
    right: 6,
    text: 'W1',
  });
  assert.deepEqual(
    (await restoreStock(await saveStock(r.state))).result,
    r.result,
  );
});
void test('INV-1D native numeric identities and a rounded or cash-formatted quantity block financial approval', async () => {
  for (const edit of [
    (s: ExcelJS.Worksheet) => {
      s.getCell('A17').value = 9;
      s.getCell('A17').numFmt = '0000';
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('B17').value = 1.25;
      s.getCell('B17').numFmt = '0';
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('B17').value = 1.25;
      s.getCell('B17').numFmt = '"SAR" 0.00';
    },
  ]) {
    const r = await replayStock(await edited(edit));
    assert.equal(r.result.financial, 'source-error');
    assert.equal(r.result.totals, null);
  }
});
void test('INV-1D hidden headers, merged money and formulas stay explicit source errors', async () => {
  for (const edit of [
    (s: ExcelJS.Worksheet) => {
      s.getRow(14).hidden = true;
    },
    (s: ExcelJS.Worksheet) => {
      s.mergeCells('E17:F17');
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell('E17').value = { formula: '200+200', result: 400 };
    },
  ]) {
    const r = await replayStock(await edited(edit));
    assert.equal(r.result.financial, 'source-error');
    assert.ok(r.result.issues.length);
  }
});
void test('INV-1D original XML payload in a covered header cell, even zero, is never erased by merge normalization', async () => {
  const input = await hierarchyInput('P02'),
    zip = await JSZip.loadAsync(input.files[0].original!);
  const p = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(p)!.async('string');
  xml = xml.replace(
    /(<row r="14">)(.*?)(<\/row>)/,
    (_all, a, b, c) => a + b + '<c r="C14"><v>0</v></c>' + c,
  );
  zip.file(p, xml);
  input.files[0] = await readStockFile(
    'register.xlsx',
    await zip.generateAsync({ type: 'arraybuffer' }),
  );
  const r = await replayStock(input);
  assert.equal(r.result.financial, 'source-error');
  assert.ok(
    Object.values(input.files[0].sheets[0].rowIssues ?? {})
      .flat()
      .some((v) => v.includes('NATIVE_HIERARCHY_MERGE')),
  );
});
void test('INV-1D worker response cannot substitute a dimension citation from the next parent while retaining all money', async () => {
  const input = await hierarchyInput('P02'),
    checked = await replayStock(input);
  const fake = structuredClone(checked);
  fake.result.hierarchyEvidence!.records[0].parent =
    fake.result.hierarchyEvidence!.records[3].parent;
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate() {},
    postMessage(raw) {
      const r = raw as { id: number; action: string };
      queueMicrotask(() =>
        this.onmessage?.call(
          this as unknown as Worker,
          {
            data: {
              channel: WORKER_CHANNEL,
              id: r.id,
              action: r.action,
              ok: true,
              value: fake,
            },
          } as MessageEvent,
        ),
      );
    },
  };
  const client = createWorkerClient(() => port);
  await assert.rejects(() => client.request('stock-reconcile', input));
});
