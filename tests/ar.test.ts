import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile as fsRead } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readFile } from '../lib/reconciliation/io.ts';
import {
  reconcileAr,
  type ArInput,
  type ArEvent,
} from '../lib/reconciliation/ar.ts';
import {
  replayAr,
  saveAr,
  restoreAr,
  exportAr,
} from '../lib/reconciliation/ar-io.ts';
const root = new URL('../audit/ar-limited/frozen/', import.meta.url);
export async function arFixture(name = 'positive'): Promise<ArInput> {
  const files = await Promise.all(
    ['ledger', 'statement'].map(async (side) =>
      readFile(
        `${side}.csv`,
        new Uint8Array(await fsRead(new URL(`${name}-${side}.csv`, root)))
          .buffer,
      ),
    ),
  );
  return {
    files: files as ArInput['files'],
    readings: [0, 1].map((side) => ({
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
      role:
        side === 0 ? 'company-ar-ledger' : 'company-issued-customer-statement',
      perspective: 'seller-receivable',
      basis: 'original-movement',
      confirmed: true,
    })) as ArInput['readings'],
    scope: {
      entity: 'Synthetic Seller',
      ledger: 'AR Book',
      customer: 'C0001',
      account: '1200',
      currency: 'SAR',
      start: '2026-09-01',
      end: '2026-09-30',
      confirmed: true,
    },
    events: [],
  };
}
function decision(
  input: ArInput,
  action: ArEvent['action'],
  ids = reconcileAr(input).cases[0].ids,
): ArEvent {
  return {
    context: reconcileAr(input).context,
    at: '2026-10-06T00:00:00.000Z',
    action,
    ids,
    note: 'Synthetic reviewed document correspondence confirmed',
  };
}
void test('AR frozen positives and negative source contracts preserve exact membership independently of AP', async () => {
  const truth = JSON.parse(
    await fsRead(new URL('expected.json', root), 'utf8'),
  );
  for (const contract of truth.cases) {
    const input = await arFixture(contract.name),
      result = (await replayAr(input)).result;
    assert.equal(
      result.cases.filter((c) => c.status === 'matched').length,
      contract.automaticPairCount,
    );
    assert.deepEqual(
      result.cases
        .filter((c) => c.status === 'matched')
        .map((c) =>
          c.ids.map((id) => result.rows.find((r) => r.id === id)!.row),
        ),
      contract.requiredPairs,
    );
    assert.deepEqual(
      result.totals,
      contract.files.map((f: { amountsMinor: number[] }) =>
        f.amountsMinor.reduce((a, b) => a + b, 0),
      ),
    );
    assert.equal(
      new Set(result.cases.flatMap((c) => c.ids)).size,
      result.rows.length,
    );
  }
});
void test('AR reading requires seller perspective, original amounts, distinct sources and explicit roles', async () => {
  const input = await arFixture();
  for (const [key, value] of [
    ['perspective', 'buyer-payable'],
    ['basis', 'open-balance'],
    ['role', 'supplier'],
  ] as const)
    assert.throws(
      () =>
        reconcileAr({
          ...input,
          readings: [
            { ...input.readings[0], [key]: value } as never,
            input.readings[1],
          ],
        }),
      /AR_READING/,
    );
  assert.throws(
    () => reconcileAr({ ...input, files: [input.files[0], input.files[0]] }),
    /AR_SAME_SOURCE/,
  );
  assert.throws(
    () =>
      reconcileAr({ ...input, scope: { ...input.scope, confirmed: false } }),
    /AR_SCOPE/,
  );
  assert.throws(
    () =>
      reconcileAr({
        ...input,
        readings: [{ ...input.readings[0], document: 10 }, input.readings[1]],
      }),
    /AR_COLUMNS/,
  );
});
void test('AR metadata cannot manufacture authority for a generic reference but reviewed exact correspondence can be confirmed', async () => {
  const input = await arFixture();
  input.files[0].sheets[0].rows[0][2] = 'Document number';
  const result = reconcileAr(input);
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 0);
  input.events = [decision(input, 'accept')];
  const accepted = reconcileAr(input);
  assert.equal(accepted.cases[0].basis, 'human-confirmation');
  assert.equal(accepted.cases[0].status, 'matched');
});
void test('AR original bytes override forged parsed caches and bind export and session hashes', async () => {
  const input = await arFixture(),
    baseline = reconcileAr(input);
  input.files[0].sheets[0].rows[1][4] = '1';
  assert.equal((await replayAr(input)).result.rows[0].amount, 10000);
  await assert.rejects(
    () => exportAr(input, reconcileAr(input)),
    /STALE_RESULT/,
  );
  await exportAr(input, baseline);
  input.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => saveAr(input), /SOURCE_HASH/);
});
void test('AR reopen persists across replay/session, human reconfirmation is explicit, stale or partial decisions fail', async () => {
  const input = await arFixture();
  input.events = [decision(input, 'reopen')];
  const restored = await restoreAr(await saveAr(input));
  assert.equal(restored.result.cases[0].reason, 'reopened');
  assert.deepEqual(restored.result, reconcileAr(input));
  input.events.push(decision(input, 'accept'));
  assert.equal(
    (await replayAr(input)).result.cases[0].basis,
    'human-confirmation',
  );
  assert.throws(
    () =>
      reconcileAr({ ...input, scope: { ...input.scope, customer: 'OTHER' } }),
    /DECISION/,
  );
  assert.throws(
    () =>
      reconcileAr({
        ...input,
        events: [decision(input, 'reopen', [reconcileAr(input).rows[0].id])],
      }),
    /DECISION/,
  );
});
void test('AR human confirmation cannot override amount/date/type conflicts or duplicate document candidates', async () => {
  for (const name of [
    'amount-difference',
    'type-collision',
    'receipt-is-not-invoice-allocation',
    'duplicate-own-document',
  ]) {
    const input = await arFixture(name);
    input.events = [decision(input, 'accept')];
    assert.throws(() => reconcileAr(input), /DECISION/);
  }
});
void test('AR unreadable competing cells block all approval and retain native rows; helper formulas remain allowed', async () => {
  const input = await arFixture(),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('AR');
  sheet.addRows(input.files[0].sheets[0].rows);
  [
    '"L999"',
    '"invoice"',
    '"I001"',
    '"2026-09-15"',
    '100',
    '"Synthetic Seller"',
    '"AR Book"',
    '"C0001"',
    '"1200"',
    '"SAR"',
  ].forEach((formula, i) => {
    sheet.getRow(5).getCell(i + 1).value = { formula };
  });
  sheet.getCell('M6').value = { formula: '1+1' };
  input.files[0] = await readFile(
    'ledger.xlsx',
    new Uint8Array((await book.xlsx.writeBuffer()) as unknown as Uint8Array)
      .buffer,
  );
  const result = (await replayAr(input)).result;
  assert.equal(result.inventory.filter((i) => i.kind === 'error').length, 1);
  assert.equal(
    result.inventory.find((i) => i.side === 0 && i.row === 6)!.kind,
    'blank',
  );
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 0);
  input.events = [decision(input, 'accept')];
  await assert.rejects(() => replayAr(input), /DECISION/);
  input.events = [];
  assert.deepEqual((await restoreAr(await saveAr(input))).result, result);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await exportAr(input, result));
  assert.equal(
    out.getWorksheet('Ledger inventory')!.getCell('B6').value,
    'error',
  );
});
void test('AR wrong scope, direction, unknown kinds, duplicate posting and dates remain visible blockers', async () => {
  for (const [column, value] of [
    [5, 'Other Seller'],
    [6, 'Other Book'],
    [7, 'C0002'],
    [8, 'Other Account'],
    [9, 'USD'],
    [4, '-100'],
    [1, 'constructor'],
    [3, '2026-10-01'],
    [3, '2026-02-30'],
    [4, '1,000'],
  ] as [number, string][]) {
    const input = await arFixture();
    input.files[0].sheets[0].rows[1][column] = value;
    const result = reconcileAr(input);
    assert.equal(result.inventory.filter((i) => i.kind === 'error').length, 1);
    assert.equal(result.cases.filter((c) => c.status === 'matched').length, 0);
  }
  const input = await arFixture();
  input.files[0].sheets[0].rows[2][0] = 'L001';
  const result = reconcileAr(input);
  assert.equal(result.inventory.filter((i) => i.kind === 'error').length, 2);
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 0);
});
void test('AR hidden/formula headers and overlapping mappings fail before any approval', async () => {
  const input = await arFixture();
  input.files[0].sheets[0].hiddenRows = [1];
  assert.throws(() => reconcileAr(input), /COLUMNS/);
  input.files[0].sheets[0].hiddenRows = [];
  input.readings[0].document = input.readings[0].posting;
  assert.throws(() => reconcileAr(input), /COLUMNS/);
});
void test('AR unreadable unselected native XLSX headers cannot hide competing document roles', async () => {
  const input = await arFixture(),
    book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('AR');
  sheet.addRows(input.files[0].sheets[0].rows);
  sheet.getCell('M1').value = { formula: '"Own document number"' };
  sheet.getCell('M2').value = 'OTHER-I001';
  input.files[0] = await readFile(
    'ledger.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  assert.equal(input.files[0].sheets[0].rows[0][12], '');
  assert.throws(() => reconcileAr(input), /AR_COLUMNS/);
  await assert.rejects(() => replayAr(input), /AR_COLUMNS/);
  await assert.rejects(() => saveAr(input), /AR_COLUMNS/);
  await assert.rejects(() => exportAr(input, {} as never), /AR_COLUMNS/);
  const unsafeSession = {
    format: 'tarasuf-ar-session',
    version: 'ar-limited-1',
    files: input.files.map((f) => ({
      name: f.name,
      sha256: f.sha256,
      data: Buffer.from(f.original!).toString('base64'),
    })),
    readings: input.readings,
    scope: input.scope,
    events: [],
  };
  await assert.rejects(
    () =>
      restoreAr(new TextEncoder().encode(JSON.stringify(unsafeSession)).buffer),
    /AR_COLUMNS/,
  );
});
void test('AR decision time is mandatory, canonical UTC and retained through native replay and Excel', async () => {
  const input = await arFixture();
  const reopened = decision(input, 'reopen');
  for (const at of [
    undefined,
    '',
    '2026-02-30T00:00:00.000Z',
    '2026-10-06',
    '2026-10-06T00:00:00.000+00:00',
  ]) {
    input.events = [{ ...reopened, at } as ArEvent];
    assert.throws(() => reconcileAr(input), /DECISION/);
  }
  input.events = [reopened];
  const restored = await restoreAr(await saveAr(input));
  assert.equal(restored.state.events[0].at, input.events[0].at);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await exportAr(restored.state, restored.result));
  assert.equal(
    book.getWorksheet('Decisions')!.getCell('F2').value,
    input.events[0].at,
  );
});
void test('AR related-invoice contradiction blocks otherwise exact credit document identity', async () => {
  const input = await arFixture();
  input.files[1].sheets[0].rows[2][10] = 'OTHER';
  const result = reconcileAr(input);
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 2);
  assert.equal(
    result.cases.find((c) => c.document === 'CN001')!.reason,
    'related-conflict',
  );
});
void test('AR snapshots cannot be changed by later mutations of input reading or source inventory', async () => {
  const input = await arFixture(),
    result = reconcileAr(input);
  input.readings[0].amount = 1;
  input.scope.customer = 'Other';
  input.files[0].sheets[0].rows[1][2] = 'Other';
  assert.equal(result.readings[0].amount, 4);
  assert.equal(result.scope.customer, 'C0001');
  assert.equal(result.inventory[1].values[2], 'I001');
});
void test('AR sessions reject cached result, wrong versions and forged source hashes', async () => {
  const input = await arFixture(),
    saved = JSON.parse(new TextDecoder().decode(await saveAr(input)));
  saved.result = {};
  await assert.rejects(
    () => restoreAr(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /SESSION/,
  );
  delete saved.result;
  saved.files[1].sha256 = '0'.repeat(64);
  await assert.rejects(
    () => restoreAr(new TextEncoder().encode(JSON.stringify(saved)).buffer),
    /SOURCE_HASH/,
  );
});

void test('AR credit note and receipt with same own number and signed amount remain distinct document types', async () => {
  const input = await arFixture();
  input.files[0].sheets[0].rows = [
    input.files[0].sheets[0].rows[0],
    input.files[0].sheets[0].rows[2],
  ];
  input.files[1].sheets[0].rows = [
    input.files[1].sheets[0].rows[0],
    input.files[1].sheets[0].rows[3],
  ];
  input.files[1].sheets[0].rows[1][2] = 'CN001';
  input.files[1].sheets[0].rows[1][4] = '-25';
  assert.equal(
    reconcileAr(input).cases.filter((c) => c.status === 'matched').length,
    0,
  );
});

void test('AR decisions are invalidated by a changed period or reading even when members still qualify', async () => {
  const input = await arFixture();
  input.events = [decision(input, 'reopen')];
  assert.throws(
    () =>
      reconcileAr({ ...input, scope: { ...input.scope, start: '2026-09-02' } }),
    /DECISION/,
  );
  assert.throws(
    () =>
      reconcileAr({
        ...input,
        readings: [
          { ...input.readings[0], description: -1 },
          input.readings[1],
        ],
      }),
    /DECISION/,
  );
});
void test('AR uses exact currency precision and preserves errors rather than rounding or assuming two decimals', async () => {
  for (const [currency, amount, expected] of [
    ['KWD', '100.123', 100123],
    ['JPY', '100', 100],
  ] as const) {
    const input = await arFixture();
    input.scope.currency = currency;
    for (const file of input.files) {
      file.sheets[0].rows = file.sheets[0].rows.slice(0, 2);
      file.sheets[0].rows[1][9] = currency;
      file.sheets[0].rows[1][4] = amount;
    }
    const result = reconcileAr(input);
    assert.equal(result.cases[0].status, 'matched');
    assert.deepEqual(result.totals, [expected, expected]);
    input.files[0].sheets[0].rows[1][4] =
      currency === 'JPY' ? '100.1' : '100.1234';
    assert.equal(
      reconcileAr(input).cases.filter((c) => c.status === 'matched').length,
      0,
    );
  }
  const input = await arFixture();
  input.scope.currency = 'UNKNOWN';
  assert.throws(() => reconcileAr(input), /SCOPE/);
});
void test('AR 20k total movements retain ownership without quadratic document search', async () => {
  const input = await arFixture();
  for (const side of [0, 1] as const) {
    const base = input.files[side].sheets[0].rows[1];
    input.files[side].sheets[0].rows = [
      input.files[side].sheets[0].rows[0],
      ...Array.from({ length: 10000 }, (_, i) => {
        const row = [...base];
        row[0] = `${side}:${i}`;
        row[2] = `I${i}`;
        row[4] = String(i + 1);
        return row;
      }),
    ];
  }
  const start = performance.now(),
    result = reconcileAr(input);
  assert.equal(result.rows.length, 20000);
  assert.equal(
    result.cases.filter((c) => c.status === 'matched').length,
    10000,
  );
  assert.equal(new Set(result.cases.flatMap((c) => c.ids)).size, 20000);
  assert.ok(performance.now() - start < 6000);
});

void test('AR source roles cannot be hidden by mapping a related invoice or alternate customer as the own identity', async () => {
  const input = await arFixture();
  input.readings[0].related = -1;
  input.readings[0].document = 10;
  assert.throws(() => reconcileAr(input), /COLUMN_ROLE/);
  const other = await arFixture();
  other.files[0].sheets[0].rows[0].push('Customer ID');
  other.files[0].sheets[0].rows[1].push('OTHER');
  assert.throws(() => reconcileAr(other), /COLUMN_ROLE/);
  const duplicate = await arFixture();
  duplicate.files[0].sheets[0].rows[0].push('Document number');
  assert.throws(() => reconcileAr(duplicate), /COLUMN_ROLE/);
});

void test('AR unselected explicit related-invoice evidence still blocks contradictory documents', async () => {
  const input = await arFixture();
  input.readings[0].related = -1;
  input.readings[1].related = -1;
  input.files[1].sheets[0].rows[2][10] = 'OTHER';
  const result = reconcileAr(input);
  assert.equal(
    result.cases.find((c) => c.document === 'CN001')!.reason,
    'related-conflict',
  );
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 2);
  input.files[1].sheets[0].formulaCells = { '3:11': { formula: '1+1' } };
  assert.equal(
    reconcileAr(input).cases.filter((c) => c.status === 'matched').length,
    0,
  );
});

void test('AR native generic document header needs human confirmation that survives source replay and Excel', async () => {
  const input = await arFixture();
  const bytes = new TextDecoder()
    .decode(input.files[0].original)
    .replace('Own document number', 'Document number');
  input.files[0] = await readFile(
    'ledger.csv',
    new TextEncoder().encode(bytes).buffer,
  );
  assert.equal(
    (await replayAr(input)).result.cases.filter((c) => c.status === 'matched')
      .length,
    0,
  );
  input.events = [decision(input, 'accept')];
  const restored = await restoreAr(await saveAr(input));
  assert.equal(restored.result.cases[0].basis, 'human-confirmation');
  assert.equal(
    restored.result.cases.filter((c) => c.status === 'matched').length,
    1,
  );
  await exportAr(restored.state, restored.result);
});

void test('AR Arabic native role headers and document types preserve exact own-number leading zeros', async () => {
  const input = await arFixture();
  const headings = [
    'معرف الحركة الفريد',
    'نوع المستند',
    'رقم المستند الأصلي',
    'تاريخ الترحيل',
    'مبلغ الحركة الأصلي الموقع',
    'الكيان',
    'الدفتر',
    'معرف العميل',
    'الحساب',
    'العملة',
    'الفاتورة المرتبطة',
    'الوصف',
  ];
  const names = {
    invoice: 'فاتورة',
    'credit-note': 'إشعار دائن',
    receipt: 'قبض',
  };
  for (const side of [0, 1] as const) {
    const rows = input.files[side].sheets[0].rows.map((row) => [...row]);
    rows[0] = headings;
    for (const row of rows.slice(1))
      row[1] = names[row[1] as keyof typeof names];
    rows[1][2] = '000001';
    input.files[side] = await readFile(
      `${side}.csv`,
      new TextEncoder().encode(
        rows.map((row) => row.join(',')).join('\n') + '\n',
      ).buffer,
    );
  }
  const result = (await replayAr(input)).result;
  assert.equal(result.cases.filter((c) => c.status === 'matched').length, 3);
  assert.equal(result.cases[0].document, '000001');
  assert.deepEqual((await restoreAr(await saveAr(input))).result, result);
  await exportAr(input, result);
});
