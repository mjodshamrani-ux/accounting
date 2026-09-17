import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import {
  normalizeSource,
  compare,
  inferMapping,
} from '../lib/reconciliation/core.ts';
import {
  verifyWorkbook,
  decimalMinor,
} from '../audit/reliability/verify-workbook.mjs';
import type { SourceFile } from '../lib/reconciliation/types.ts';

const scope = {
  supplier: 'Synthetic supplier',
  entity: 'Synthetic buyer',
  account: 'AP-100',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-08-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: true,
};
const sourceRows = [
  [
    ['2026-08-01', 'INV-00001', 'توريد', '100.00', 'SAR'],
    ['2026-08-02', 'CN-002', 'Credit note', '-20.00', 'SAR'],
    ['2026-08-03', 'INV-003', 'Services', '50.00', 'SAR'],
    ['2026-08-04', '', '=SUM(1,2)', '7.00', 'SAR'],
  ],
  [
    ['2026-08-01', 'INV-00001', 'توريد', '100.00', 'SAR'],
    ['2026-08-02', 'CN-002', 'Credit note', '-20.00', 'SAR'],
    ['2026-08-03', 'INV-003', 'Services', '55.00', 'SAR'],
    ['2026-08-05', 'INV-004', 'Transport', '30.00', 'SAR'],
  ],
];
const enc = new TextEncoder();
let fixturePromise: ReturnType<typeof makeFixture> | undefined;
async function makeFixture() {
  const files = (await Promise.all(
    sourceRows.map((rows, index) =>
      readFile(
        index ? 'ledger.csv' : 'supplier.csv',
        enc.encode(
          [
            'Date,Reference,Description,Amount,Currency',
            ...rows.map((row) =>
              row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','),
            ),
          ].join('\n'),
        ).buffer,
      ),
    ),
  )) as [SourceFile, SourceFile];
  const a = {
    ...inferMapping(files[0]),
    opening: '200',
    closing: '337',
    periodStart: '2026-08-01',
  };
  const b = {
    ...inferMapping(files[1]),
    opening: '210',
    closing: '375',
    periodStart: '2026-08-01',
  };
  const result = compare(
    normalizeSource(files[0], a, scope, 'supplier'),
    normalizeSource(files[1], b, scope, 'ledger'),
    scope,
  );
  // Every amount and membership is hand-calculated. IDs below are merely
  // opaque exported addresses, bound only after checking the membership oracle.
  const memberships = [
    { status: 'Matched', ids: ['supplier:0:2', 'ledger:0:2'] },
    { status: 'Matched', ids: ['supplier:0:3', 'ledger:0:3'] },
    { status: 'Needs Review', ids: ['supplier:0:4', 'ledger:0:4'] },
    { status: 'Unmatched', ids: ['supplier:0:5'] },
    { status: 'Unmatched', ids: ['ledger:0:5'] },
  ];
  assert.equal(result.cases.length, memberships.length);
  const cases = memberships.map((oracle) => {
    const actual = result.cases.find(
      (c) =>
        [...c.supplierMembers, ...c.ledgerMembers]
          .map((t) => t.id)
          .sort()
          .join('|') === [...oracle.ids].sort().join('|'),
    );
    assert.ok(actual);
    assert.equal(actual.status, oracle.status);
    return { ...oracle, id: actual.caseId };
  });
  const amounts = [
    [10000, -2000, 5000, 700],
    [10000, -2000, 5500, 3000],
  ];
  const rows = sourceRows.flatMap((items, index) =>
    items.map((row, offset) => ({
      id: `${index ? 'ledger' : 'supplier'}:0:${offset + 2}`,
      side: index ? 'ledger' : 'supplier',
      sheet: 'CSV',
      row: offset + 2,
      date: row[0],
      reference: row[1],
      description: row[2],
      originalAmount: row[3],
      minor: amounts[index][offset],
    })),
  );
  const expected = {
    decimals: 2,
    currency: 'SAR',
    rows,
    cases,
    bridge: { openingAdjustment: 1000, adjusted: 37500, residual: 0 },
    balances: {
      supplierOpening: 20000,
      ledgerOpening: 21000,
      supplierClosing: 33700,
      ledgerClosing: 37500,
    },
  };
  return {
    bytes: await exportWorkbook(result, files, {
      checked: false,
      name: '',
      notes: '',
    }),
    expected,
  };
}
const fixture = () => (fixturePromise ??= makeFixture());
async function modified(edit: (book: ExcelJS.Workbook) => void) {
  const { bytes } = await fixture();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  edit(book);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}

test('R045 independent exported workbook oracle accepts signed amounts, empty references, Arabic and an opening difference', async () => {
  const { bytes, expected } = await fixture();
  const report = await verifyWorkbook(bytes, expected);
  assert.equal(report.sourceRows, 8);
  assert.equal(report.cases, 5);
  assert.ok(report.formulas > 0);
});

test('R045 independent verifier rejects amount, sign, visible reference, row count and cached formula mutations', async () => {
  const { bytes, expected } = await fixture();
  // A valid control must pass first so a broken verifier cannot make every mutation look detected.
  await verifyWorkbook(bytes, expected);
  for (const [label, edit] of [
    [
      'amount',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Supplier transactions')!.getCell('H2').value = 101;
      },
    ],
    [
      'sign',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Ledger transactions')!.getCell('H3').value = 20;
      },
    ],
    [
      'visible-reference',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Matches')!.getCell('D2').value = 'INV-DIFFERENT';
      },
    ],
    [
      'source-count',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Matches')!.getCell('O2').value = 9;
      },
    ],
    [
      'visible-date',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Matches')!.getCell('C2').value = new Date(
          '2026-08-02T00:00:00Z',
        );
      },
    ],
    [
      'summary-closing-balance',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Summary')!.eachRow((row) => {
          if (row.getCell(1).value === 'Supplier Closing Balance')
            row.getCell(2).value = 338;
        });
      },
    ],
    [
      'currency',
      (b: ExcelJS.Workbook) => {
        b.getWorksheet('Summary')!.eachRow((row) => {
          if (row.getCell(1).value === 'Currency') row.getCell(2).value = 'USD';
        });
      },
    ],
    [
      'missing-bridge-case',
      (b: ExcelJS.Workbook) => {
        const variance = expected.cases.find(
          (c) => c.status === 'Needs Review',
        )!.id;
        b.getWorksheet('Reconciliation Bridge')!.eachRow((row) => {
          if (row.getCell(1).value === variance) row.values = [];
        });
      },
    ],
    [
      'formula',
      (b: ExcelJS.Workbook) => {
        const s = b.getWorksheet('Summary')!;
        s.eachRow((row) => {
          if (row.getCell(1).value === 'Auto Matched Cases')
            row.getCell(2).value = {
              formula: 'COUNTIF(\'Matches\'!Q2:Q3,"Manual")',
              result: 2,
            };
        });
      },
    ],
  ] as const) {
    await assert.rejects(verifyWorkbook(await modified(edit), expected), label);
  }
});

test('R045 independent decimal oracle rejects lost minor precision rather than rounding', () => {
  assert.equal(decimalMinor('1.234e1', 2), 1234n);
  assert.equal(decimalMinor('-0.01', 2), -1n);
  assert.throws(() => decimalMinor('1.234', 2));
});

test('R045 independent verifier covers transaction-only, zero-effect rejected cases, manual decisions and currency precision', async () => {
  for (const [decimals, amount, minor, decision] of [
    [0, '12', 12, 'auto'],
    [3, '12.345', 12345, 'auto'],
    [2, '12.00', 1200, 'rejected'],
    [2, '12.00', 1200, 'manual'],
  ] as const) {
    const aRef = 'INV-00001',
      bRef = decision === 'manual' ? 'INV-OTHER' : aRef;
    const files = (await Promise.all(
      [aRef, bRef].map((reference, i) =>
        readFile(
          i ? 'ledger.csv' : 'supplier.csv',
          enc.encode(
            `Date,Reference,Description,Amount\n2026-08-01,${reference},Invoice,${amount}`,
          ).buffer,
        ),
      ),
    )) as [SourceFile, SourceFile];
    const runScope = {
      ...scope,
      coverageConfirmed: false,
      decimals,
      currency: decimals === 0 ? 'JPY' : decimals === 3 ? 'KWD' : 'SAR',
    };
    const a = normalizeSource(
      files[0],
      inferMapping(files[0]),
      runScope,
      'supplier',
    );
    const b = normalizeSource(
      files[1],
      inferMapping(files[1]),
      runScope,
      'ledger',
    );
    const result = compare(
      a,
      b,
      runScope,
      decision === 'manual'
        ? [
            {
              supplierId: 'supplier:0:2',
              ledgerId: 'ledger:0:2',
              note: 'Verified against the original source documents by the accountant',
            },
          ]
        : [],
      decision === 'rejected' ? ['supplier:0:2|ledger:0:2'] : [],
    );
    assert.equal(result.cases.length, 1);
    const status = decision === 'rejected' ? 'Rejected' : 'Matched';
    assert.equal(result.cases[0].status, status);
    const expected = {
      decimals,
      currency: runScope.currency,
      bridge: null,
      balances: {
        supplierOpening: null,
        ledgerOpening: null,
        supplierClosing: null,
        ledgerClosing: null,
      },
      rows: [aRef, bRef].map((reference, index) => ({
        id: `${index ? 'ledger' : 'supplier'}:0:2`,
        side: index ? 'ledger' : 'supplier',
        sheet: 'CSV',
        row: 2,
        date: '2026-08-01',
        reference,
        description: 'Invoice',
        originalAmount: amount,
        minor,
      })),
      cases: [
        {
          id: result.cases[0].caseId,
          status,
          ids: ['supplier:0:2', 'ledger:0:2'],
        },
      ],
    };
    const report = await verifyWorkbook(
      await exportWorkbook(result, files, {
        checked: false,
        name: '',
        notes: '',
      }),
      expected,
    );
    assert.equal(report.sourceRows, 2);
  }
});
