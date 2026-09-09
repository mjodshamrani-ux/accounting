import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type { Mapping, Scope } from '../lib/reconciliation/types.ts';

// The economic oracle is authored in integer minor units. It does not call any
// engine parser/formatter or compute expected results from imported cells.
const supplierMinor = [125000, -50000, -25000, 700];
const ledgerMinor = [125000, -50000, -23000, 1000];
const references = ['INV-100', 'دفعة-٢٠٠', 'CN-300', 'INV-400'];
const english = [
  'date',
  'reference',
  'amount',
  'debit',
  'credit',
  'description',
];
const arabic = ['التاريخ', 'المرجع', 'المبلغ', 'مدين', 'دائن', 'الوصف'];

test('date-window boundaries hold across leap days, year changes and either source order', async () => {
  const cases = [
    ['2024-02-28', '2024-03-01', 2],
    ['2024-02-29', '2024-03-01', 1],
    ['2025-02-28', '2025-03-01', 1],
    ['2025-12-31', '2026-01-01', 1],
    ['2026-08-01', '2026-08-08', 7],
    ['2026-08-01', '2026-08-09', 8],
  ] as const;
  for (const [first, second, gap] of cases) {
    for (const window of [0, 1, 2, 7]) {
      for (const dates of [
        [first, second],
        [second, first],
      ]) {
        const scope: Scope = {
          supplier: 'S',
          entity: 'E',
          account: 'AP',
          currency: 'SAR',
          decimals: 2,
          cutoff: '2026-08-31',
          dateWindow: window,
          confirmed: true,
          coverageConfirmed: false,
        };
        const mapping = {
          ...defaultMapping(),
          date: 0,
          reference: 1,
          amount: 2,
        };
        const files = await Promise.all(
          dates.map((date) =>
            readFile(
              'synthetic.csv',
              new TextEncoder().encode(
                `date,reference,amount\n${date},INV-100,100.00`,
              ).buffer,
            ),
          ),
        );
        const result = compare(
          normalizeSource(files[0], mapping, scope, 'supplier'),
          normalizeSource(files[1], mapping, scope, 'ledger'),
          scope,
        );
        assert.equal(
          result.matches.length,
          gap <= window ? 1 : 0,
          `${dates.join('/')} window=${window}`,
        );
        if (gap > window)
          assert.ok(result.diagnostics.some((d) => d.code === 'DATE_GAP'));
        else assert.equal(result.matches[0].evidence?.dateGap, gap);
      }
    }
  }
});

function digits(s: string, ar: boolean) {
  return ar ? s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : s;
}
function decimalText(
  value: number,
  places: number,
  comma: boolean,
  ar: boolean,
  grouped = false,
) {
  const abs = Math.abs(value)
    .toString()
    .padStart(places + 1, '0');
  const whole = places ? abs.slice(0, -places) : abs;
  const head = grouped
    ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, comma ? '.' : ',')
    : whole;
  const body = head + (places ? (comma ? ',' : '.') + abs.slice(-places) : '');
  return digits(value < 0 ? `(${body})` : body, ar);
}

for (const extension of ['csv', 'xlsx'] as const)
  for (const places of [0, 2, 3])
    for (const mode of ['signed', 'split'] as const)
      for (const comma of [false, true])
        for (const ar of [false, true]) {
          const name = `${extension}/${places}/${mode}/${comma ? 'comma' : 'dot'}/${ar ? 'Arabic-reversed' : 'English'}`;
          test(`supplier layout end-to-end oracle: ${name}`, async () => {
            const order = ar ? [5, 4, 1, 3, 0, 2] : [1, 0, 5, 2, 4, 3];
            const scope: Scope = {
              supplier: 'Supplier مورد',
              entity: 'Entity جهة',
              account: 'AP',
              currency: places === 0 ? 'JPY' : places === 2 ? 'SAR' : 'KWD',
              decimals: places,
              cutoff: '2026-08-31',
              dateWindow: 2,
              confirmed: true,
              coverageConfirmed: true,
            };
            const dateFormat: Mapping['dateFormat'] =
              places === 0 ? 'dmy' : places === 2 ? 'mdy' : 'ymd';
            const date =
              places === 0
                ? '13/08/2026'
                : places === 2
                  ? '08/13/2026'
                  : '2026/08/13';
            const position = (index: number) => order.indexOf(index);
            const make = async (
              amounts: number[],
              side: 'supplier' | 'ledger',
            ) => {
              const headers = order.map((i) => (ar ? arabic : english)[i]);
              const rows: (string | number)[][] = [
                ['SYNTHETIC supplier statement — no real company'],
                [],
                headers,
              ];
              const multiplier = ar ? -1 : 1;
              for (let i = 0; i < amounts.length; i++) {
                const n = amounts[i] * multiplier;
                const text = (v: number) =>
                  decimalText(v, places, comma, ar, true);
                // Numeric XLSX cells keep their native value regardless of selected locale.
                const amount = (v: number): string | number =>
                  extension === 'xlsx' && !ar ? v / 10 ** places : text(v);
                const values: (string | number)[] = [
                  digits(date, ar),
                  side === 'ledger' && i === 3 ? 'INV-500' : references[i],
                  amount(n),
                  n >= 0 ? amount(n) : '',
                  n < 0 ? amount(-n) : '',
                  `وصف Description ${i}\n=SUM(A1:A2)`,
                ];
                rows.push(order.map((index) => values[index]));
                if (i === 1) rows.push(headers); // Repeated page heading is explicitly accounted for.
              }
              let buffer: ArrayBuffer;
              if (extension === 'xlsx') {
                const workbook = new ExcelJS.Workbook();
                workbook
                  .addWorksheet('Instructions')
                  .addRow(['Synthetic cover only']);
                const sheet = workbook.addWorksheet('الحركات Transactions');
                for (const row of rows) sheet.addRow(row);
                const out = await workbook.xlsx.writeBuffer();
                buffer = new Uint8Array(out).buffer;
              } else {
                const separator = comma ? ';' : ar ? '\t' : ',';
                buffer = new TextEncoder().encode(
                  '\uFEFF' +
                    rows
                      .map((row) =>
                        row
                          .map((c) => '"' + String(c).replace(/"/g, '""') + '"')
                          .join(separator),
                      )
                      .join(ar ? '\r\n' : '\n'),
                ).buffer;
              }
              const file = await readFile(
                `synthetic-${side}.${extension}`,
                buffer,
              );
              const mapping: Mapping = {
                ...defaultMapping(),
                sheet: extension === 'xlsx' ? 1 : 0,
                header: 2,
                date: position(0),
                reference: position(1),
                amount: position(2),
                debit: position(3),
                credit: position(4),
                description: position(5),
                mode,
                multiplier,
                dateFormat,
                numberFormat: comma ? 'comma' : 'dot',
                opening: decimalText(100000, places, comma, ar),
                closing: decimalText(
                  side === 'supplier' ? 150700 : 153000,
                  places,
                  comma,
                  ar,
                ),
                periodStart: '2026-08-01',
                excluded: {
                  '6': 'Repeated page heading verified against original',
                },
              };
              return {
                file,
                mapping,
                normalized: normalizeSource(file, mapping, scope, side),
              };
            };
            const a = await make(supplierMinor, 'supplier');
            const b = await make(ledgerMinor, 'ledger');
            assert.deepEqual(a.normalized.errors, []);
            assert.deepEqual(b.normalized.errors, []);
            assert.deepEqual(
              a.normalized.transactions.map((t) => t.amount),
              supplierMinor,
            );
            assert.deepEqual(
              b.normalized.transactions.map((t) => t.amount),
              ledgerMinor,
            );
            assert.deepEqual(
              a.normalized.transactions.map((t) => t.row),
              [4, 5, 7, 8],
            );
            assert.ok(
              a.normalized.transactions.every((t) => t.date === '2026-08-13'),
            );
            assert.equal(a.normalized.total, 50700);
            assert.equal(b.normalized.total, 53000);
            const result = compare(a.normalized, b.normalized, scope);
            assert.deepEqual(
              result.matches.map((m) => m.evidence?.reference),
              references.slice(0, 2),
            );
            assert.equal(result.supplierOnly.length, 2);
            assert.equal(result.ledgerOnly.length, 2);
            assert.deepEqual(result.bridge, {
              delta: -2300,
              openingAdjustment: 0,
              itemAdjustment: 2300,
              adjusted: 153000,
              residual: 0,
            });
            assert.ok(
              result.diagnostics.some((d) => d.code === 'AMOUNT_DIFFERENCE'),
            );
            const output = await exportWorkbook(result, [a.file, b.file], {
              name: '',
              notes: 'Synthetic audit',
              checked: false,
              events: [],
            });
            const reopened = new ExcelJS.Workbook();
            await reopened.xlsx.load(output as any);
            // Check exported numeric cells against the authored oracle, not engine formatting.
            for (const [sheetName, expected] of [
              ['Supplier transactions', supplierMinor],
              ['Ledger transactions', ledgerMinor],
            ] as const) {
              const sheet = reopened.getWorksheet(sheetName)!;
              assert.ok(sheet);
              assert.equal(sheet.rowCount, 5);
              for (let i = 0; i < expected.length; i++) {
                assert.equal(sheet.getCell(1, 8).value, 'المبلغ الموحد');
                assert.equal(
                  sheet.getCell(i + 2, 8).value,
                  expected[i] / 10 ** places,
                );
                assert.equal(
                  sheet.getCell(i + 2, 7).value,
                  `وصف Description ${i}\n=SUM(A1:A2)`,
                );
              }
            }
          });
        }
