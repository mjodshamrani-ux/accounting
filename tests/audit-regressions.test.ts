import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { deflateRawSync } from 'node:zlib';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import {
  explainResult,
  containsExactIdentifier,
} from '../lib/reconciliation/assistant.ts';
import {
  interpretModelOutput,
  askLocalModel,
} from '../lib/reconciliation/local-ai.ts';
import { validateZipContents } from '../lib/reconciliation/zip.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../lib/reconciliation/demo.ts';
import type { Mapping } from '../lib/reconciliation/types.ts';
const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
const map: Mapping = {
  ...demoMappings[0],
  amount: 2,
  description: -1,
  currencyColumn: -1,
  opening: '',
  closing: '',
};
const baseline = () =>
  compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
  );
async function excel(
  value: string | number,
  format = '0.000',
  creator = 'Synthetic vendor',
) {
  const book = new ExcelJS.Workbook();
  // A ledger's copy of the same entries is its own export (another creator).
  book.creator = creator;
  const s = book.addWorksheet('data');
  s.addRow(['date', 'reference', 'amount']);
  s.addRow(['2026-08-01', 'INV-100', value]);
  s.getCell('C2').numFmt = format;
  return readFile(
    'data.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
}
test('A02: native Excel 1.234 never matches native 1234 under comma locale', async () => {
  const [a, b] = await Promise.all([excel(1.234), excel(1234)]);
  const m = { ...map, numberFormat: 'comma' as const },
    s = { ...scope, decimals: 3 };
  const r = compare(
    normalizeSource(a, m, s, 'supplier'),
    normalizeSource(b, m, s, 'ledger'),
    s,
  );
  assert.equal(r.supplier.transactions[0].amount, 1234);
  assert.equal(r.ledger.transactions[0].amount, 1234000);
  assert.equal(r.matches.length, 0);
});
test('native/text × dot/comma × 0/2/3 decimal matrix preserves expected minor units', async () => {
  for (const dp of [0, 2, 3])
    for (const format of ['dot', 'comma'] as const)
      for (const native of [true, false]) {
        const digits = dp === 0 ? '' : dp === 2 ? '.25' : '.234';
        const decimal = '1234' + digits;
        const f = await excel(
          native
            ? Number(decimal)
            : format === 'dot'
              ? decimal
              : decimal.replace('.', ','),
        );
        const r = normalizeSource(
          f,
          { ...map, numberFormat: format },
          { ...scope, decimals: dp },
          'supplier',
        );
        assert.equal(r.errors.length, 0);
        assert.equal(
          r.transactions[0].amount,
          dp === 0 ? 1234 : dp === 2 ? 123425 : 1234234,
        );
      }
});
test('native percentages and excess precision block rather than reinterpret or round', async () => {
  for (const [v, fmt] of [
    [0.5, '0%'],
    [1.234, '0.000'],
  ] as const) {
    const r = normalizeSource(await excel(v, fmt), map, scope, 'supplier');
    assert.ok(r.errors.length);
    assert.equal(r.transactions.length, 0);
  }
});
test('A01: references and row IDs must match whole tokens, never prefixes', () => {
  for (const [query, id, expected] of [
    ['INV-001999', 'INV-001', false],
    ['supplier:0:20', 'supplier:0:2', false],
    ['لماذا INV-001؟', 'INV-001', true],
    ['(A[001])', 'A[001]', true],
    ['XINV-001', 'INV-001', false],
  ] as const)
    assert.equal(containsExactIdentifier(query, id), expected);
  const r = baseline();
  const answer = explainResult(r, 'لماذا لم تطابق INV-001999؟');
  assert.equal(answer.kind, 'unsupported');
  assert.deepEqual(answer.sourceIds, []);
});
test('model cannot route a question to an unrelated but existing document', () => {
  assert.equal(
    interpretModelOutput(
      baseline(),
      '{"intent":"transaction","transactionId":"supplier:0:3"}',
      'Explain INV-001999',
    ),
    null,
  );
});
test('Arabic AI path declines before invoking unsupported model API', async () => {
  let calls = 0;
  const result = await askLocalModel(
    baseline(),
    'فسر هذه الحركة',
    new AbortController().signal,
    {
      availability: async () => {
        calls++;
        return 'available';
      },
      create: async () => {
        throw Error('unexpected');
      },
    },
  );
  assert.equal(result, null);
  assert.equal(calls, 0);
});
test('original bytes and fingerprint survive import; reparsing blocks a corrupted numeric interpretation on export', async () => {
  const f = await excel(1.234);
  assert.ok(f.original);
  assert.match(f.sha256!, /^[a-f0-9]{64}$/);
  const g = await excel(1.234, '0.000', 'Synthetic ledger');
  const s = { ...scope, decimals: 3 },
    a = normalizeSource(f, map, s, 'supplier'),
    b = normalizeSource(g, map, s, 'ledger');
  const r = compare(a, b, s);
  r.supplier.transactions[0].amount = 1234000;
  await assert.rejects(
    () => exportWorkbook(r, [f, g], { checked: false, name: '', notes: '' }),
    /إعادة الحساب/,
  );
});
test('title merge and errors on unrelated worksheet do not contaminate selected clean data', async () => {
  const book = new ExcelJS.Workbook();
  const other = book.addWorksheet('Instructions');
  other.mergeCells('A1:B1');
  other.getCell('A1').value = { error: '#VALUE!' };
  const data = book.addWorksheet('Data');
  data.mergeCells('A1:C1');
  data.getCell('A1').value = 'عنوان';
  data.addRow(['date', 'reference', 'amount']);
  data.addRow(['2026-08-01', 'INV-100', 20]);
  const f = await readFile(
    'multi.xlsx',
    new Uint8Array(await book.xlsx.writeBuffer()).buffer,
  );
  const r = normalizeSource(
    f,
    { ...map, sheet: 1, header: 1 },
    scope,
    'supplier',
  );
  assert.equal(r.errors.length, 0);
  assert.equal(r.transactions.length, 1);
});
function craftedZip(payload: Uint8Array, declared: number) {
  const packed = deflateRawSync(payload),
    name = Buffer.from('data.xml'),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return new Uint8Array(
    Buffer.concat([local, name, packed, central, name, end]),
  ).buffer;
}
test('A04: actual decompressed bytes cannot exceed falsified declared size', async () => {
  await assert.rejects(
    () => validateZipContents(craftedZip(new Uint8Array(1024 * 1024), 1)),
    /الفعلي/,
  );
});
test('actual 33 MB expansion stops at 32 MB budget even when index underreports', async () => {
  await assert.rejects(
    () =>
      validateZipContents(
        craftedZip(new Uint8Array(33 * 1024 * 1024), 32 * 1024 * 1024),
      ),
    /الفعلي/,
  );
});
test('ZIP integrity rejects bad CRC and truncated index', async () => {
  await assert.rejects(
    () => validateZipContents(craftedZip(new Uint8Array([1, 2, 3]), 3)),
    /تالف/,
  );
  await assert.rejects(() => validateZipContents(new ArrayBuffer(10)), /تالف/);
});
test('session roundtrip reparses originals and never restores reviewer approval', async () => {
  const bytes = await saveSession({
    files: demoFiles,
    mappings: demoMappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { name: 'مراجع', notes: 'ملاحظة', checked: true },
  });
  const saved = await restoreSession(bytes);
  assert.equal(saved.result.matches.length, 2);
  assert.equal(saved.review.checked, false);
  assert.equal(saved.review.notes, 'ملاحظة');
  assert.ok(saved.files[0].sha256);
});
test('session tampered fingerprint, unknown version and invalid decisions are rejected', async () => {
  const bytes = await saveSession({
    files: demoFiles,
    mappings: demoMappings,
    scope,
    decisions: [],
    rejected: [],
    events: [],
    review: { name: '', notes: '', checked: false },
  });
  const original = JSON.parse(new TextDecoder().decode(bytes));
  for (const mutate of [
    (p: any) => {
      p.files[0].sha256 = 'fake';
    },
    (p: any) => {
      p.engine = 'unknown';
    },
    (p: any) => {
      p.decisions = [{ supplierId: 'fake', ledgerId: 'fake', note: 'claim' }];
    },
  ]) {
    const p = structuredClone(original);
    mutate(p);
    await assert.rejects(() =>
      restoreSession(new TextEncoder().encode(JSON.stringify(p)).buffer),
    );
  }
});

// Exercise the ExcelJS path that imports uuid for conditional-formatting extension records.
test('patched UUID dependency remains compatible with Excel conditional-formatting export', async()=>{
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Data');sheet.addRow([1]);sheet.addConditionalFormatting({ref:'A1',rules:[{type:'iconSet',iconSet:'3Stars',priority:1,cfvo:[{type:'percent',value:0},{type:'percent',value:33},{type:'percent',value:67}]}]});
 const bytes=await book.xlsx.writeBuffer();const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);assert.equal(reopened.getWorksheet('Data')!.getCell('A1').value,1);
});
