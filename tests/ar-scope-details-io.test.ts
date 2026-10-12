import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileAr,
  suggestArScopeReading,
  type ArInput,
  type ArEvent,
} from '../lib/reconciliation/ar.ts';
import {
  replayAr,
  saveAr,
  restoreAr,
  exportAr,
  AR_MAX_EXPORT_BYTES,
} from '../lib/reconciliation/ar-io.ts';

const scope: ArInput['scope'] = {
  entity: 'Synthetic Seller',
  ledger: 'AR Book',
  customer: '00017',
  account: '1200',
  currency: 'SAR',
  start: '2026-10-01',
  end: '2026-10-31',
  confirmed: true,
};
const headers = [
  'Parent scope ID',
  'Posting ID',
  'Document type',
  'Own document number',
  'Posting date',
  'Original signed amount',
  'Related invoice',
  'Open balance',
  'Description',
];
function records(side: number, invalid = false): string[][] {
  const parent = side ? 'RIGHT' : 'LEFT';
  return [
    ['AR_SCOPE', '1'],
    ['Scope ID', parent],
    [
      'Source role',
      side ? 'company-issued-customer-statement' : 'company-ar-ledger',
    ],
    ['Perspective', 'seller-receivable'],
    ['Amount basis', 'original-movement'],
    ['Entity', scope.entity],
    ['Ledger', scope.ledger],
    ['Customer', scope.customer],
    ['Account', scope.account],
    ['Currency', scope.currency],
    ['Period start', scope.start],
    ['Period end', scope.end],
    ['Scope reference', `Synthetic ${side}`],
    ['DETAILS'],
    headers,
    [
      invalid ? 'FOREIGN' : parent,
      `P-${side}`,
      'invoice',
      '000001',
      '2026-10-02',
      '100.00',
      '',
      side ? '0' : '40.00',
      'Synthetic only',
    ],
    ['END_DETAILS'],
  ];
}
async function fixture(nativeSide = -1, invalid = false): Promise<ArInput> {
  const files = [];
  for (const side of [0, 1] as const) {
    let bytes: ArrayBuffer;
    if (side === nativeSide) {
      const book = new ExcelJS.Workbook();
      book
        .addWorksheet('Original')
        .addRows(records(side, invalid && side === 0));
      bytes = Uint8Array.from(
        (await book.xlsx.writeBuffer()) as unknown as Uint8Array,
      ).buffer;
    } else
      bytes = new TextEncoder().encode(
        records(side, invalid && side === 0)
          .map((r) => r.join(','))
          .join('\n') + '\n',
      ).buffer;
    files.push(
      await readFile(`${side}.${side === nativeSide ? 'xlsx' : 'csv'}`, bytes),
    );
  }
  const readings = files.map((f, side) => ({
    ...suggestArScopeReading(f, side as 0 | 1)!,
    confirmed: true,
  }));
  return {
    files: files as ArInput['files'],
    readings: readings as ArInput['readings'],
    scope: { ...scope },
    events: [],
  };
}
function event(input: ArInput, action: ArEvent['action']): ArEvent {
  const result = reconcileAr(input);
  return {
    context: result.context,
    ids: result.cases[0].ids,
    action,
    note: 'Synthetic document correspondence reviewed',
    at: '2026-10-11T00:00:00.000Z',
  };
}
async function bookFor(input: ArInput) {
  const result = (await replayAr(input)).result;
  const bytes = await exportAr(input, result);
  assert.ok(bytes.byteLength < AR_MAX_EXPORT_BYTES);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  return { result, book };
}
void test('new native/CSV save and export preserve original amount, descriptive balance, inheritance and nine tables', async () => {
  const input = await fixture(1),
    saved = await saveAr(input);
  const envelope = JSON.parse(new TextDecoder().decode(saved));
  assert.deepEqual(Object.keys(envelope).sort(), [
    'events',
    'files',
    'format',
    'readings',
    'scope',
    'version',
  ]);
  assert.equal(envelope.version, 'ar-scope-details-1');
  assert.deepEqual(Object.keys(envelope.files[0]).sort(), [
    'data',
    'name',
    'sha256',
  ]);
  assert.deepEqual(
    Buffer.from(envelope.files[0].data, 'base64'),
    Buffer.from(input.files[0].original!),
  );
  const restored = await restoreAr(saved),
    { result, book } = await bookFor(restored.state);
  assert.deepEqual(restored.result, result);
  assert.deepEqual(result.totals, [10000, 10000]);
  assert.equal(result.cases[0].status, 'matched');
  assert.deepEqual(result.receiptAllocations, []);
  assert.equal(result.financialCompletenessAsserted, false);
  assert.equal(result.rows[0].originalRaw, '100.00');
  assert.equal(result.rows[0].openBalanceRaw, '40.00');
  assert.equal(result.rows[0].openBalanceRole, 'descriptive-unverified');
  assert.deepEqual(
    book.worksheets.map((s) => s.name),
    [
      'Summary',
      'Movements',
      'Cases',
      'Membership',
      'Ledger inventory',
      'Statement inventory',
      'Reading',
      'Decisions',
      'Sources',
    ],
  );
  const movements = book.getWorksheet('Movements')!;
  assert.equal(movements.getCell('O1').value, 'Source family');
  assert.equal(movements.getCell('P2').value, '100.00');
  assert.equal(movements.getCell('Q2').value, '40.00');
  assert.equal(movements.getCell('R2').value, 'descriptive-unverified');
  assert.equal(movements.getCell('S2').value, 'LEFT');
  const rawChunks = book
    .getWorksheet('Sources')!
    .getRows(2, book.getWorksheet('Sources')!.rowCount - 1)!;
  for (const side of [0, 1]) {
    const raw = rawChunks
      .filter((r) => r.getCell(1).value === side)
      .map((r) => {
        const value = r.getCell(7).value;
        assert.ok(typeof value === 'string');
        return value;
      })
      .join('');
    assert.deepEqual(
      Buffer.from(raw, 'base64'),
      Buffer.from(input.files[side].original!),
    );
  }
});
void test('new sessions retain reopened and human-confirmed decisions and reject altered context and cached data', async () => {
  const input = await fixture();
  input.events = [event(input, 'reopen')];
  const reopened = await restoreAr(await saveAr(input));
  assert.equal(reopened.result.cases[0].reason, 'reopened');
  await exportAr(reopened.state, reopened.result);
  input.events.push(event(input, 'accept'));
  const accepted = await restoreAr(await saveAr(input));
  assert.equal(accepted.result.cases[0].basis, 'human-confirmation');
  await exportAr(accepted.state, accepted.result);
  const saved = JSON.parse(new TextDecoder().decode(await saveAr(input)));
  saved.result = accepted.result;
  await assert.rejects(
    () => restoreAr(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /AR_SESSION/,
  );
  delete saved.result;
  saved.events[0].context += 'forged';
  await assert.rejects(
    () => restoreAr(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /AR_DECISION/,
  );
});
void test('new IO reads originals instead of trusting cached rows and binds export to replay result', async () => {
  const input = await fixture(),
    expected = reconcileAr(input);
  input.files[0].sheets[0].rows[15][5] = '900.00';
  assert.equal((await replayAr(input)).result.rows[0].amount, 10000);
  await exportAr(input, expected);
  expected.totals[0] = 90000;
  await assert.rejects(() => exportAr(input, expected), /AR_STALE_RESULT/);
  input.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => saveAr(input), /AR_SOURCE_HASH/);
});
void test('new session version is explicit and rejects version-only migration and noncanonical source base64', async () => {
  const input = await fixture(),
    saved = JSON.parse(new TextDecoder().decode(await saveAr(input)));
  saved.version = 'ar-limited-1';
  await assert.rejects(
    () => restoreAr(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /AR_SESSION/,
  );
  saved.version = 'ar-scope-details-1';
  saved.files[0].data += '\n';
  await assert.rejects(
    () => restoreAr(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /AR_SESSION/,
  );
});
void test('source errors round-trip and export inventory without turning rejected rows into members or claiming zero total', async () => {
  const input = await fixture(-1, true),
    restored = await restoreAr(await saveAr(input));
  assert.equal(
    restored.result.cases.filter((c) => c.status === 'matched').length,
    0,
  );
  assert.equal(restored.result.rows.length, 1);
  assert.ok(restored.result.errorInventoryRefs!.length);
  const { book } = await bookFor(restored.state);
  assert.equal(book.getWorksheet('Ledger inventory')!.rowCount, 18);
  assert.equal(book.getWorksheet('Membership')!.rowCount, 2);
  const structural = await fixture();
  const text = new TextDecoder()
    .decode(structural.files[0].original)
    .replace('END_DETAILS', '');
  structural.files[0] = await readFile(
    '0.csv',
    new TextEncoder().encode(text).buffer,
  );
  const { result, book: invalidBook } = await bookFor(structural);
  assert.equal(result.totals[0], null);
  const summary = invalidBook.getWorksheet('Summary')!;
  const total = summary
    .getRows(2, summary.rowCount - 1)!
    .find((r) => r.getCell(1).value === 'Ledger total minor units')!;
  assert.equal(total.getCell(2).value, null);
});
void test('replay/save/export capture bytes, readings, scope, events and expected result before first await', async () => {
  for (const operation of ['replay', 'save', 'export'] as const) {
    const input = await fixture(0),
      expected = reconcileAr(input),
      laterEvent = event(input, 'reopen');
    const pending =
      operation === 'replay'
        ? replayAr(input)
        : operation === 'save'
          ? saveAr(input)
          : exportAr(input, expected);
    new Uint8Array(input.files[0].original!).fill(0);
    input.readings[0].amount = 7;
    input.scope.customer = 'FOREIGN';
    input.events.push(laterEvent);
    expected.rows[0].amount = 999;
    const output = await pending;
    if (operation === 'replay')
      assert.equal(
        (output as Awaited<ReturnType<typeof replayAr>>).result.rows[0].amount,
        10000,
      );
    else assert.ok((output as ArrayBuffer).byteLength);
  }
});
void test('restore captures session bytes and source/event limits reject before parsing', async () => {
  const input = await fixture(0),
    bytes = await saveAr(input),
    pending = restoreAr(bytes);
  new Uint8Array(bytes).fill(0);
  assert.equal((await pending).result.rows[0].amount, 10000);
  await assert.rejects(
    () => restoreAr(new ArrayBuffer(32 * 1024 * 1024 + 1)),
    /AR_SESSION/,
  );
  const tooLarge = await fixture();
  tooLarge.files[0].original = new ArrayBuffer(8 * 1024 * 1024 + 1);
  await assert.rejects(() => replayAr(tooLarge), /AR_SOURCE/);
  const events = await fixture();
  events.events = Array(1001).fill({});
  await assert.rejects(() => saveAr(events), /AR_INPUT/);
});
void test('selected native sheet retains actual XML numeric spellings and never upgrades serial dates', async () => {
  const { default: JSZip } = await import('jszip');
  const input = await fixture();
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Unselected').addRow(['Unrelated original']);
  const sheet = book.addWorksheet('Selected original');
  sheet.addRows(records(0));
  sheet.getCell('F16').value = 100;
  sheet.getCell('H16').value = 40;
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  let xml = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
  xml = xml
    .replace(
      /<c\b[^>]*\br="F16"[^>]*>[\s\S]*?<\/c>/,
      '<c r="F16"><v>100.00</v></c>',
    )
    .replace(
      /<c\b[^>]*\br="H16"[^>]*>[\s\S]*?<\/c>/,
      '<c r="H16"><v>40.000</v></c>',
    );
  zip.file('xl/worksheets/sheet2.xml', xml);
  const bytes = Uint8Array.from(
    await zip.generateAsync({ type: 'uint8array' }),
  ).buffer;
  input.files[0] = await readFile('selected.xlsx', bytes);
  input.readings[0] = {
    ...suggestArScopeReading(input.files[0], 0, 1),
    confirmed: true,
  };
  const replay = await replayAr(input);
  assert.equal(replay.result.rows[0].originalRaw, '100.00');
  assert.equal(replay.result.rows[0].openBalanceRaw, '40.000');
  assert.equal(replay.result.rows[0].amount, 10000);
  assert.equal(replay.state.files[0].sheets[1].rows[15][7], '40.000');
  assert.deepEqual(
    Buffer.from(replay.state.files[0].original!),
    Buffer.from(bytes),
  );
  const restored = await restoreAr(await saveAr(input));
  assert.deepEqual(restored.result, replay.result);
  await exportAr(restored.state, restored.result);
  sheet.getCell('E16').value = new Date(Date.UTC(2026, 9, 2));
  input.files[0] = await readFile(
    'serial-date.xlsx',
    Uint8Array.from((await book.xlsx.writeBuffer()) as unknown as Uint8Array)
      .buffer,
  );
  const rejected = (await replayAr(input)).result;
  assert.equal(rejected.cases.filter((c) => c.status === 'matched').length, 0);
  assert.equal(rejected.rows.filter((r) => r.side === 0).length, 0);
});
void test('scope CSV uses literal comma grammar and preserves blank logical records and quoted multiline text', async () => {
  const input = await fixture();
  const original = new TextDecoder().decode(input.files[0].original);
  const text = original
    .replace('DETAILS\n', '\nDETAILS\n')
    .replace(
      'Synthetic only\nEND_DETAILS',
      '"line one\nline two;literal"\n\nEND_DETAILS',
    );
  input.files[0] = await readFile(
    'blank-multiline.csv',
    new TextEncoder().encode(text).buffer,
  );
  input.readings[0] = {
    ...suggestArScopeReading(input.files[0], 0),
    confirmed: true,
  };
  const result = (await replayAr(input)).result;
  assert.equal(result.cases[0].status, 'matched');
  assert.equal(result.rows[0].row, 17);
  assert.equal(result.rows[0].description, 'line one\nline two;literal');
  assert.deepEqual(
    result.inventory.find((i) => i.side === 0 && i.row === 14)!.values,
    [],
  );
  assert.deepEqual(
    result.inventory.find((i) => i.side === 0 && i.row === 17)!.lineSpan,
    [17, 18],
  );
  assert.deepEqual((await restoreAr(await saveAr(input))).result, result);
});
void test('rejected native merge preserves literal shared-string inventory instead of the merge master', async () => {
  const { default: JSZip } = await import('jszip');
  const input = await fixture();
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Original').addRows(records(0));
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  zip.file(
    'xl/worksheets/sheet1.xml',
    xml.replace(
      '</sheetData>',
      '</sheetData><mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells>',
    ),
  );
  input.files[0] = await readFile(
    'merged.xlsx',
    Uint8Array.from(await zip.generateAsync({ type: 'uint8array' })).buffer,
  );
  assert.equal(input.files[0].sheets[0].rows[1][1], 'Scope ID');
  input.readings[0] = {
    ...suggestArScopeReading(input.files[0], 0),
    confirmed: true,
  };
  const replay = await replayAr(input);
  assert.deepEqual(
    replay.result.inventory
      .find((i) => i.side === 0 && i.row === 2)!
      .values.slice(0, 2),
    ['Scope ID', 'LEFT'],
  );
  assert.equal(replay.result.status, 'source-error');
  assert.equal(replay.result.rows.filter((r) => r.side === 0).length, 0);
  const restored = await restoreAr(await saveAr(input));
  assert.deepEqual(restored.result, replay.result);
  const output = new ExcelJS.Workbook();
  await output.xlsx.load(await exportAr(restored.state, restored.result));
  assert.equal(
    output.getWorksheet('Ledger inventory')!.getCell('E3').value,
    'LEFT',
  );
});
async function diagnosticFixture(
  errors: number,
  validPerSide: [number, number],
) {
  const { readArFile } = await import('../lib/reconciliation/ar-source.ts');
  const input = await fixture();
  for (const side of [0, 1] as const) {
    const base = records(side),
      detail = base[15];
    const valid = Array.from({ length: validPerSide[side] }, (_, index) => {
      const row = [...detail];
      row[1] = `P-${side}-${index}`;
      row[3] = `INV-${index}`;
      return row;
    });
    const invalid = Array.from(
      { length: side === 0 ? errors : 0 },
      (_, index) => {
        const row = [...detail];
        row[0] = 'FOREIGN';
        row[1] = `BAD-${index}`;
        row[3] = `BAD-INV-${index}`;
        return row;
      },
    );
    const text =
      [...base.slice(0, 15), ...valid, ...invalid, ['END_DETAILS']]
        .map((r) => r.join(','))
        .join('\n') + '\n';
    input.files[side] = await readArFile(
      `${side}.csv`,
      new TextEncoder().encode(text).buffer,
      input.readings[side],
    );
  }
  return input;
}
void test('diagnostic export supports 250 valid pairs plus rejected evidence and bounds repeated global references', async () => {
  const input = await diagnosticFixture(1, [250, 250]);
  const { result, book } = await bookFor(input);
  assert.equal(result.rows.length, 500);
  assert.equal(result.cases.length, 250);
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 0);
  assert.equal(book.getWorksheet('Membership')!.rowCount, 501);
  assert.equal(
    book.getWorksheet('Cases')!.getCell('I2').value,
    JSON.stringify(result.errorInventoryRefs),
  );
  const repeated = await diagnosticFixture(80, [0, 2000]);
  const repeatedResult = (await replayAr(repeated)).result;
  assert.ok(JSON.stringify(repeatedResult.sourceIssues).length < 32767);
  assert.ok(
    JSON.stringify(repeatedResult.errorInventoryRefs).length *
      repeatedResult.cases.length >
      8 * 1024 * 1024,
  );
  await assert.rejects(
    () => exportAr(repeated, repeatedResult),
    /AR_EXPORT_EVIDENCE_LIMIT/,
  );
});
void test('20k rejected records plus 20k valid diagnostic members reject oversized Excel evidence without truncation', async () => {
  const input = await diagnosticFixture(20000, [0, 20000]);
  const result = (await replayAr(input)).result;
  assert.equal(result.rows.length, 20000);
  assert.equal(result.errorInventoryRefs!.length, 20000);
  assert.equal(result.cases.length, 20000);
  assert.ok(JSON.stringify(result.errorInventoryRefs).length > 32767);
  await assert.rejects(
    () => exportAr(input, result),
    /AR_EXPORT_EVIDENCE_LIMIT/,
  );
});
