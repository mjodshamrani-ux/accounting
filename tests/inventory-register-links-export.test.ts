import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  STOCK_ROLES,
  STOCK_VERSION,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';
import {
  exportStockLinks,
  replayStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import { validateStockWorkerResponse } from '../lib/reconciliation/inventory-register-worker-binding.ts';

// A tiny synthetic tool store in yen: one linked row, one row whose evidence
// names another unit, an evidence row nothing names, and an item code with
// leading zeros.
const SCOPE = [
  'Synthetic Tool Store',
  'TL-STK',
  'TL-GL',
  'JPY',
  'functional',
  'posted',
  'Close',
  '2029-06-30',
  'C-9',
  'M-9',
  'V-9',
  'S-9',
];
const HEAD =
  'Entity,Inventory ledger,GL ledger,Currency,Currency basis,Posting status,Posting layer,As of,Chart version,Map version,Valuation policy version,Inventory account set version';
const csv = (header: string, rows: string[]) =>
  [header + ',' + HEAD, ...rows.map((r) => r + ',' + SCOPE.join(','))].join(
    '\n',
  ) + '\n';
const FILES = [
  csv(
    'Item ID,Item dimensions,Quantity,Unit,Quantity precision,Posted value,Valuation reference',
    ['00731,bay=1,4,EA,0,1200,R1', 'T-9,bay=2,1,BOX,0,800,R2'],
  ),
  csv(
    'Mapping ID,Item ID,Item dimensions,GL account,GL dimensions,Evidence ID',
    ['M1,00731,bay=1,5100,site=T,E1', 'M2,T-9,bay=2,5100,site=T,E2'],
  ),
  csv(
    'Evidence ID,Item ID,Item dimensions,Unit,Quantity precision,Valuation reference,GL account,GL dimensions,Account class,Sign,Value basis,Valid from,Valid to,Reference',
    [
      'E1,00731,bay=1,EA,0,R1,5100,site=T,inventory,debit-positive,provided-posted-carrying-value,2029-01-01,2029-12-31,P1',
      'E2,T-9,bay=2,EA,0,R2,5100,site=T,inventory,debit-positive,provided-posted-carrying-value,2029-01-01,2029-12-31,P2',
      'E3,Z,bay=3,EA,0,R3,5100,site=T,inventory,debit-positive,provided-posted-carrying-value,2029-01-01,2029-12-31,P3',
    ],
  ),
  csv('GL account,GL dimensions,Account class,Debit,Credit', [
    '5100,site=T,inventory,1200,0',
  ]),
];
function input(): StockInput {
  return {
    files: FILES.map((text, i) => {
      const bytes = new TextEncoder().encode(text);
      return {
        name: `tools-${i}.csv`,
        original: bytes.buffer,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sheets: [],
      };
    }) as unknown as StockInput['files'],
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    scope: {
      entity: SCOPE[0],
      inventoryLedger: SCOPE[1],
      glLedger: SCOPE[2],
      currency: SCOPE[3],
      currencyBasis: SCOPE[4],
      postingStatus: SCOPE[5],
      postingLayer: SCOPE[6],
      asOf: SCOPE[7],
      chartVersion: SCOPE[8],
      mapVersion: SCOPE[9],
      valuationPolicyVersion: SCOPE[10],
      inventoryAccountSetVersion: SCOPE[11],
      confirmed: true,
    },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
const values = (sheet: ExcelJS.Worksheet) =>
  sheet
    .getSheetValues()
    .slice(1)
    .map((row) => (row as unknown[]).slice(1));

void test('INV-3c: the links workbook has its four sheets, the rows as linked and reasoned, and codes as text', async () => {
  const { state, result } = await replayStock(input());
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportStockLinks(state, result));
  assert.deepEqual(
    book.worksheets.map((s) => s.name),
    ['Summary', 'Links', 'Link members', 'Unlinked records'],
  );
  const links = values(book.getWorksheet('Links')!);
  assert.deepEqual(
    links.slice(1).map((r) => [r[1], r[2], r[4], r[5]]),
    [
      [2, '00731', 'linked', ''],
      [3, 'T-9', 'unlinked', 'EVIDENCE_UNIT'],
    ],
  );
  assert.equal(typeof links[1][2], 'string', 'the leading zeros stay text');
  assert.deepEqual(
    values(book.getWorksheet('Unlinked records')!)
      .slice(1)
      .map((r) => [r[0], r[1], r[2], r[3], r[4] ?? null, r[5]]),
    [['evidence', result.records[2][2].id, 4, 'E3', null, 'NO_MAPPING']],
  );
  const members = values(book.getWorksheet('Link members')!).slice(1);
  assert.deepEqual(
    members.map((r) => [r[1], r[2], r[4], r[5]]),
    [
      [2, 'mapping', 2, 'M1'],
      [2, 'evidence', 2, 'E1'],
      [2, 'gl', 2, '5100'],
      [3, 'mapping', 3, 'M2'],
      [3, 'evidence', 3, 'E2'],
      [3, 'gl', 2, '5100'],
    ],
  );
  const summary = Object.fromEntries(
    values(book.getWorksheet('Summary')!).slice(1),
  );
  assert.deepEqual(
    [
      summary['Register records'],
      summary.Linked,
      summary.Unlinked,
      summary['Unlinked records'],
    ],
    [2, 1, 1, 1],
  );
});

void test('INV-3c: a links export for a changed result is refused, and the page refuses a workbook the worker did not make from its request', async () => {
  const { state, result } = await replayStock(input());
  const stale = structuredClone(result);
  stale.links[1].reasons = [];
  await assert.rejects(
    () => exportStockLinks(state, stale),
    /STOCK_STALE_EXPORT/,
  );
  const good = await exportStockLinks(state, result);
  const payload = { state: input(), result };
  await validateStockWorkerResponse('stock-links-export', good, payload);
  const other = input();
  other.scope.mapVersion = 'M-OTHER';
  const foreign = await replayStock(other);
  const wrong = await exportStockLinks(foreign.state, foreign.result);
  await assert.rejects(
    () => validateStockWorkerResponse('stock-links-export', wrong, payload),
    /STOCK_WORKER_BINDING/,
  );
});
