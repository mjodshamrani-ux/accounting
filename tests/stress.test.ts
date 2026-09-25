import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  compare,
  normalizeSource,
  parseMoney,
  money,
  safeSum,
} from '../lib/reconciliation/core.ts';
import {
  parseCSV,
  readFile,
  exportWorkbook,
  validateCellText,
} from '../lib/reconciliation/io.ts';
import { explainResult } from '../lib/reconciliation/assistant.ts';
import { interpretModelOutput } from '../lib/reconciliation/local-ai.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import { separateSheets } from './helpers/separate-export.ts';
const scope = {
  supplier: 'مورد / Supplier',
  entity: 'Entity',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-08-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 1,
  amount: 2,
  description: 3,
};
const file = (rows: string[][]): SourceFile => ({
  name: 'synthetic.csv',
  sheets: [
    {
      name: 'بيانات Data',
      rows: [['date', 'reference', 'amount', 'description'], ...rows],
      formulaRows: [],
      hiddenRows: [],
    },
  ],
});
const run = (a: string[][], b: string[][]) =>
  compare(
    normalizeSource(file(a), mapping, scope, 'supplier'),
    normalizeSource(separateSheets(file(b)), mapping, scope, 'ledger'),
    scope,
  );
let seed = 20260908;
const rnd = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
// Independent brute-force oracle: original fixture values, no engine parser/reference helper.
function oracle(a: string[][], b: string[][]) {
  const norm = (s: string) =>
    s
      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
      .normalize('NFKC')
      .trim()
      .toUpperCase()
      .replace(/[\s\-/]/g, '');
  return a
    .flatMap((s, i) => {
      const ref = norm(s[1]);
      if (
        !/\p{L}/u.test(ref) ||
        !/[0-9]/.test(ref) ||
        ref.length < 4 ||
        Number(s[2]) === 0
      )
        return [];
      if (
        a.filter((t) => norm(t[1]) === ref).length !== 1 ||
        b.filter((t) => norm(t[1]) === ref).length !== 1
      )
        return [];
      const j = b.findIndex(
        (t) =>
          t[1].trim() === s[1].trim() &&
          Number(t[2]) === Number(s[2]) &&
          Math.abs(Number(t[0].slice(-2)) - Number(s[0].slice(-2))) <= 2,
      );
      return j < 0 ? [] : [`${i + 2}:${j + 2}`];
    })
    .sort();
}
test('3000 seeded bilingual generated reconciliations agree with independent brute-force oracle', () => {
  let totalMatches = 0,
    totalUnmatched = 0;
  for (let trial = 0; trial < 3000; trial++) {
    const a: string[][] = [],
      b: string[][] = [];
    for (let i = 0; i < 12; i++) {
      const ref =
        (i % 2 ? 'INV-' : 'فاتورة-') + String(rnd() % 10).padStart(3, '0');
      const amount = String((rnd() % 401) - 200);
      const date = `2026-08-${String(1 + (rnd() % 20)).padStart(2, '0')}`;
      a.push([date, ref, amount, 'وصف Description']);
      b.push([
        rnd() % 3 ? date : '2026-08-25',
        rnd() % 4 ? ref : ref.replace('-', ''),
        rnd() % 3 ? amount : String(-Number(amount)),
        'Payment دفعة',
      ]);
    }
    const r = run(a, b);
    totalMatches += r.matches.length;
    totalUnmatched += r.supplierOnly.length;
    assert.deepEqual(
      r.matches
        .map(
          (m) =>
            `${m.supplierId.split(':').at(-1)}:${m.ledgerId.split(':').at(-1)}`,
        )
        .sort(),
      oracle(a, b),
      `seed case ${trial}`,
    );
    assert.equal(
      new Set(r.matches.map((m) => m.supplierId)).size,
      r.matches.length,
    );
    assert.equal(
      new Set(r.matches.map((m) => m.ledgerId)).size,
      r.matches.length,
    );
    const supplierMembers = r.cases.flatMap((c) => c.supplierMembers);
    const ledgerMembers = r.cases.flatMap((c) => c.ledgerMembers);
    assert.equal(supplierMembers.length, a.length);
    assert.equal(ledgerMembers.length, b.length);
    assert.deepEqual(
      supplierMembers.map((t) => t.id).sort(),
      r.supplier.transactions.map((t) => t.id).sort(),
    );
    assert.deepEqual(
      ledgerMembers.map((t) => t.id).sort(),
      r.ledger.transactions.map((t) => t.id).sort(),
    );
    assert.equal(
      new Set([...supplierMembers, ...ledgerMembers].map((t) => t.id)).size,
      a.length + b.length,
    );
    assert.equal(
      safeSum(supplierMembers.map((t) => t.amount)),
      r.supplier.total,
    );
    assert.equal(safeSum(ledgerMembers.map((t) => t.amount)), r.ledger.total);
  }
  assert.ok(totalMatches > 1000, `only ${totalMatches} positive matches`);
  assert.ok(totalUnmatched > 1000);
});
test('10000 decimal format/sign/Arabic digit cases preserve exact integer units', () => {
  for (let i = 0; i < 10000; i++) {
    const dp = [0, 2, 3][i % 3],
      n = (rnd() % 100000000) * (i % 2 ? -1 : 1);
    const text = money(n, dp);
    assert.equal(parseMoney(text, 'dot', dp), n);
    const comma = text.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
    assert.equal(parseMoney(comma, 'comma', dp), n);
    const arabic = text
      .replace(/\d/g, (d) => String.fromCharCode(1632 + Number(d)))
      .replace(/,/g, '٬')
      .replace(/\./g, '٫');
    assert.equal(parseMoney(arabic, 'dot', dp), n);
  }
});
test('1000 quoted multilingual CSV roundtrips preserve commas, newlines and quotes', () => {
  const values = [
    'العربية',
    'English',
    '中文',
    'مبلغ, description',
    'line\nnext',
    'quote"value',
    ' =SUM(A1:A2)',
    'إشعار دائن',
  ];
  for (let i = 0; i < 1000; i++) {
    const row = Array.from({ length: 4 }, () => values[rnd() % values.length]);
    const csv = [['a', 'b', 'c', 'd'], row]
      .map((r) => r.map((c) => '"' + c.replace(/"/g, '""') + '"').join(','))
      .join('\r\n');
    assert.deepEqual(parseCSV(csv), [['a', 'b', 'c', 'd'], row]);
  }
});
test('20000 repeated references remain unpaired and bounded in time', () => {
  const a = Array.from({ length: 20000 }, () => [
    '2026-08-01',
    'INV-100',
    '10',
    'مكرر',
  ]);
  const start = performance.now();
  const r = run(a, a);
  assert.equal(r.matches.length, 0);
  assert.equal(r.ambiguousIds.length, 40000);
  assert.equal(r.supplierOnly.length, 0);
  assert.equal(r.caseCounts.needsReviewCases, 1);
  assert.equal(r.caseCounts.needsReviewSourceRows, 40000);
  assert.equal(r.cases[0].classification, 'AMBIGUOUS_CANDIDATE');
  assert.equal(r.cases[0].supplierMembers.length, 20000);
  assert.equal(r.cases[0].ledgerMembers.length, 20000);
  assert.equal(
    new Set(r.cases[0].sourceTrace.map((t) => t.sourceRowId)).size,
    40000,
  );
  assert.ok(performance.now() - start < 15000);
});
test('bilingual workbook export preserves source text, numbers and formula-looking content across all transaction sheets', async () => {
  const a = [
    [
      '2026-08-01',
      'فاتورة-001',
      '1234.56',
      '=HYPERLINK("https://example.invalid","شرح")',
    ],
    ['2026-08-02', 'INV-002', '-12.34', 'دفعة Payment'],
  ];
  const b = [
    ['2026-08-01', 'فاتورة-001', '1234.56', 'English description'],
    ['2026-08-02', 'INV-003', '-12.34', 'إشعار دائن Credit Note'],
  ];
  const r = run(a, b);
  const bytes = await exportWorkbook(r, [file(a), separateSheets(file(b))], {
    name: 'Reviewer مراجع',
    notes: '=1+1',
    checked: false,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  let formulas = 0;
  wb.eachSheet((s) =>
    s.eachRow((row) =>
      row.eachCell((c) => {
        if (c.type === ExcelJS.ValueType.Formula) {
          formulas++;
          assert.ok(['Summary', 'Reconciliation Bridge'].includes(s.name));
          assert.doesNotMatch(c.formula, /HYPERLINK|https?:\/\//i);
        }
      }),
    ),
  );
  assert.ok(
    formulas > 0,
    'engine totals remain native formulas; user text remains inert',
  );
  assert.equal(
    wb.getWorksheet('Supplier transactions')!.getCell('G2').value,
    a[0][3],
  );
  for (const name of [
    'Supplier transactions',
    'Ledger transactions',
    'Unmatched',
  ]) {
    const sheet = wb.getWorksheet(name)!;
    sheet.eachRow((row, n) => {
      if (n > 1) {
        assert.equal(typeof row.getCell(8).value, 'number');
        assert.equal(row.getCell(8).numFmt, '#,##0.00', name);
      }
    });
  }
  const signoff = wb.getWorksheet('Review Sign-off')!;
  assert.equal(signoff.getCell('B7').value, '=1+1');
  assert.equal(signoff.getCell('B7').type, ExcelJS.ValueType.String);
});
test('XML-incompatible control characters cannot silently change during CSV to Excel export', async () => {
  await assert.rejects(async () => {
    const f = await readFile(
      'control.csv',
      new TextEncoder().encode(
        'date,reference,amount,description\n2026-08-01,INV-001,10,"bad\u0008text"',
      ).buffer,
    );
    const r = compare(
      normalizeSource(f, mapping, scope, 'supplier'),
      normalizeSource(f, mapping, scope, 'ledger'),
      scope,
    );
    await exportWorkbook(r, [f, f], { name: '', notes: '', checked: false });
  });
});
test('2000 prefix reference questions and model routing attacks never select existing shorter document', () => {
  const r = run(
    [['2026-08-01', 'INV-001', '10', '']],
    [['2026-08-01', 'INV-001', '10', '']],
  );
  for (let i = 0; i < 2000; i++) {
    const q = `Why INV-001${i + 10}?`;
    assert.equal(explainResult(r, q).sourceIds.length, 0);
    assert.equal(
      interpretModelOutput(
        r,
        '{"intent":"transaction","transactionId":"supplier:0:2"}',
        q,
      ),
      null,
    );
  }
});
test('200 input permutations preserve economic matches and totals without relying on row position', () => {
  const a = Array.from({ length: 40 }, (_, i) => [
    '2026-08-01',
    `INV-${100 + i}`,
    String(i % 2 ? -i - 1 : i + 1),
    'وصف',
  ]);
  const b = a.map((r) => [...r]);
  b[3][2] = '900';
  b[5][1] = 'OTHER-500';
  const signature = (r: ReturnType<typeof run>) =>
    r.matches
      .map(
        (m) =>
          r.supplier.transactions.find((t) => t.id === m.supplierId)!.reference,
      )
      .sort();
  const expected = run(a, b);
  const shuffle = (rows: string[][]) => {
    const out = rows.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = rnd() % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  for (let i = 0; i < 200; i++) {
    const r = run(shuffle(a), shuffle(b));
    assert.deepEqual(signature(r), signature(expected));
    assert.equal(r.supplier.total, expected.supplier.total);
    assert.equal(r.ledger.total, expected.ledger.total);
  }
});
test('5000-row XLSX import, reconciliation and export preserve every original numeric amount', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('بيانات Data');
  sheet.addRow(['date', 'reference', 'amount', 'description']);
  const expected = new Map<string, number>();
  for (let i = 0; i < 5000; i++) {
    const minor = (i + 1) * (i % 2 ? -1 : 1);
    const ref = `INV-${i + 10000}`;
    sheet.addRow(['2026-08-01', ref, minor / 100, `دفعة Payment ${i}`]);
    expected.set(ref, minor);
  }
  sheet.getColumn(3).numFmt = '#,##0.00';
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const source = await readFile(
    'large-bilingual.xlsx',
    bytes.buffer as ArrayBuffer,
  );
  // The ledger is its own export of the same entries.
  wb.creator = 'Synthetic ledger';
  const ledgerSource = await readFile(
    'large-bilingual-ledger.xlsx',
    new Uint8Array(await wb.xlsx.writeBuffer()).buffer as ArrayBuffer,
  );
  const s = normalizeSource(source, mapping, scope, 'supplier'),
    l = normalizeSource(ledgerSource, mapping, scope, 'ledger');
  const r = compare(s, l, scope);
  assert.equal(r.matches.length, 5000);
  assert.equal(r.supplierOnly.length, 0);
  assert.equal(r.ledgerOnly.length, 0);
  for (const t of s.transactions)
    assert.equal(t.amount, expected.get(t.reference));
  const output = await exportWorkbook(r, [source, ledgerSource], {
    checked: false,
    name: 'مراجع Reviewer',
    notes: '',
  });
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(output);
  for (const name of ['Supplier transactions', 'Ledger transactions']) {
    const ws = reopened.getWorksheet(name)!;
    assert.equal(ws.rowCount, 5001);
    ws.eachRow((row, i) => {
      if (i > 1)
        assert.equal(
          Math.round(Number(row.getCell(8).value) * 100),
          expected.get(String(row.getCell(5).value)),
        );
    });
  }
});
test('invalid XML controls and unpaired surrogates are rejected while legitimate multilingual text survives', () => {
  for (const code of [
    0, 1, 2, 7, 8, 11, 12, 14, 31, 0xfffe, 0xffff, 0xd800, 0xdc00,
  ])
    assert.throws(() =>
      validateCellText('text' + String.fromCharCode(code) + 'نص'),
    );
  for (const text of [
    'العربية English 中文 😀',
    'line\nnext\r\nend',
    'a\tb',
    'فاتورة ١٢٣',
  ])
    assert.doesNotThrow(() => validateCellText(text));
});
test('malformed UTF-8 bytes cannot become replacement characters in imported references', async () => {
  const prefix = new TextEncoder().encode(
    'date,reference,amount\n2026-08-01,INV-',
  );
  for (const tail of [[0xc3, 0x28], [0xed, 0xa0, 0x80], [0xff], [0xe2, 0x82]]) {
    const bytes = new Uint8Array([...prefix, ...tail, 44, 49, 48]);
    await assert.rejects(readFile('invalid.csv', bytes.buffer));
  }
});
