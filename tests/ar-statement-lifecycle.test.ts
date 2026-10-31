// AR-1 PDF A3: the printed customer statement through replay, session,
// export and the worker boundary, from original bytes. Each near case
// differs from a passing one in one decisive fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {
  exportAr,
  replayAr,
  restoreAr,
  saveAr,
} from '../lib/reconciliation/ar-io.ts';
import {
  snapshotArInput,
  snapshotArRequest,
  validateArWorkerResponse,
} from '../lib/reconciliation/ar-worker-binding.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
import type { ArInput } from '../lib/reconciliation/ar.ts';

const frozen = new URL(
  '../audit/ar-statement-foundation/frozen/',
  import.meta.url,
);
const bytes = async (name: string) =>
  Uint8Array.from(await readFile(new URL(name, frozen))).buffer;
const sha = (b: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(b)).digest('hex');
const scope = {
  entity: 'Synthetic Seller Co',
  ledger: 'AR Book',
  customer: 'C0001',
  account: '1200',
  currency: 'SAR',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
const ledgerReading = {
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
  role: 'company-ar-ledger',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
} as const;
const statementReading = {
  family: 'ar-statement-pdf-1',
  role: 'company-issued-customer-statement',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
} as const;
async function input(
  story = 'A01',
  change: { names?: [string, string]; statement?: ArrayBuffer } = {},
) {
  const ledger = await bytes(`${story}-ledger.csv`);
  const statement = change.statement ?? (await bytes(`${story}-statement.pdf`));
  const [ledgerName, statementName] = change.names ?? [
    `${story}-ledger.csv`,
    `${story}-statement.pdf`,
  ];
  return {
    files: [
      { name: ledgerName, sha256: sha(ledger), original: ledger, sheets: [] },
      {
        name: statementName,
        sha256: sha(statement),
        original: statement,
        sheets: [],
      },
    ],
    readings: [{ ...ledgerReading }, { ...statementReading }],
    scope: { ...scope },
    events: [],
  } as unknown as ArInput;
}

void test('the statement is the second source, a PDF, and only with its own reading', async () => {
  const ok = await replayAr(await input());
  assert.equal(ok.result.version, 'ar-statement-pdf-1');
  assert.equal(ok.result.status, 'matched');
  await assert.rejects(
    replayAr(await input('A01', { names: ['A01-ledger.csv', 'A01-statement.csv'] })),
    /AR_SOURCE/,
  );
  const legacy = await input();
  legacy.readings[1] = { ...ledgerReading, role: 'company-issued-customer-statement' };
  await assert.rejects(replayAr(legacy), /AR_SOURCE/);
  // A table named as a table is refused by its name, never parsed as a PDF.
  const table = await bytes('A01-ledger.csv');
  await assert.rejects(
    replayAr(await input('A01', { names: ['A01-ledger.csv', 'statement.csv'], statement: table })),
    (e: Error) => e.message === 'AR_SOURCE',
  );
});

void test('changed bytes are refused by their hash before they are parsed', async () => {
  const garbage = new TextEncoder().encode('not a pdf at all').buffer as ArrayBuffer;
  const wrong = await input('A01', { statement: garbage });
  (wrong.files[1] as { sha256: string }).sha256 = 'f'.repeat(64);
  await assert.rejects(replayAr(wrong), /AR_SOURCE_HASH/);
  // With its own hash the same bytes reach the PDF reader, which refuses them.
  await assert.rejects(replayAr(await input('A01', { statement: garbage })), (e: Error) =>
    !/AR_SOURCE_HASH/.test(e.message),
  );
});

void test('a session restores only as the family its readings name', async () => {
  let saved: ArrayBuffer | undefined;
  await assert.doesNotReject(async () => {
    saved = await saveAr(await input());
  });
  const session = JSON.parse(new TextDecoder().decode(saved));
  assert.equal(session.version, 'ar-statement-pdf-1');
  let restored: Awaited<ReturnType<typeof restoreAr>> | undefined;
  await assert.doesNotReject(async () => {
    restored = await restoreAr(new TextEncoder().encode(JSON.stringify(session)).buffer as ArrayBuffer);
  });
  assert.equal(restored?.result.status, 'matched');
  for (const version of ['ar-limited-1', 'ar-scope-details-1'])
    await assert.rejects(
      restoreAr(new TextEncoder().encode(JSON.stringify({ ...session, version })).buffer as ArrayBuffer),
      /AR_SESSION/,
    );
});

void test('the workpaper names each printed line and section, and older families keep their columns', async () => {
  const sheetRows = async (workbook: ArrayBuffer, name: string) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(workbook);
    const sheet = book.getWorksheet(name);
    return sheet
      ? sheet.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1))
      : undefined;
  };
  const { state, result } = await replayAr(await input('A03'));
  const workbook = await exportAr(state, result);
  const sections = await sheetRows(workbook, 'Statement sections');
  assert.ok(sections, 'the Statement sections sheet');
  assert.deepEqual(
    sections.slice(1).map((r) => [r[1], r[11]]),
    [
      ['C0001', 'true'],
      ['C0002', 'false'],
    ],
  );
  const movements = (await sheetRows(workbook, 'Movements'))!;
  const at = movements[0].indexOf('PDF place JSON');
  const statementRows = movements.slice(1).filter((r) => r[1] === 1);
  assert.deepEqual(
    statementRows.map((r) => String(r[at])),
    result.rows.filter((r) => r.side === 1).map((r) => JSON.stringify(r.pdf)),
  );
  // The existing family's workpaper has neither the sheet nor the column.
  const csv = new TextEncoder().encode(
    [
      'Posting ID,Document type,Own document number,Posting date,Original signed amount,Entity,Ledger,Customer,Account,Currency,Related invoice,Description',
      'S1,invoice,INV-1,2026-09-02,10.00,Synthetic Seller Co,AR Book,C0001,1200,SAR,,',
    ].join('\n') + '\n',
  ).buffer as ArrayBuffer;
  const ledger = await bytes('A01-ledger.csv');
  const older = await replayAr({
    files: [
      { name: 'ledger.csv', sha256: sha(ledger), original: ledger, sheets: [] },
      { name: 'statement.csv', sha256: sha(csv), original: csv, sheets: [] },
    ],
    readings: [{ ...ledgerReading }, { ...ledgerReading, role: 'company-issued-customer-statement' }],
    scope: { ...scope },
    events: [],
  } as unknown as ArInput);
  const olderBook = await exportAr(older.state, older.result);
  assert.equal(await sheetRows(olderBook, 'Statement sections'), undefined);
  assert.equal((await sheetRows(olderBook, 'Movements'))![0].includes('PDF place JSON'), false);
});

void test('the worker boundary carries bytes, never a reading, and binds the reply', async () => {
  const request = await input();
  const forged = {
    ...request,
    files: [request.files[0], { ...request.files[1], kind: 'ar-statement-pdf', reading: { lines: [] } }],
  } as unknown as ArInput;
  let snapshot: ArInput | undefined;
  assert.doesNotThrow(() => {
    snapshot = snapshotArInput(forged);
  });
  assert.equal('reading' in snapshot!.files[1], false);
  // A statement reading on the ledger side is not a statement.
  const swapped = await input();
  swapped.readings = [{ ...statementReading }, { ...statementReading }] as never;
  assert.throws(() => snapshotArInput(swapped), /AR_WORKER_READING/);
  const replay = await replayAr(request);
  await assert.doesNotReject(
    validateArWorkerResponse('ar-reconcile', replay, snapshotArRequest('ar-reconcile', request)),
  );
  assert.doesNotThrow(() => validateWorkerValue('ar-reconcile', replay, {}));
  const otherFamily = structuredClone(replay);
  otherFamily.result.version = 'ar-statement-pdf-2';
  assert.throws(() => validateWorkerValue('ar-reconcile', otherFamily, {}), /AR_WORKER_ENVELOPE/);
});
