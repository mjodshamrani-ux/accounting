import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readStockFile } from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION,
  STOCK_SECTION_FAMILY,
  STOCK_ROLES,
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  STOCK_HEADERS,
  reconcileStock,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';

const source = (name: string, rows: string[][]) => {
  const csv =
    rows
      .map((r) =>
        r
          .map((v) =>
            /[",\n\r]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v,
          )
          .join(','),
      )
      .join('\n') + '\n';
  const original = new TextEncoder().encode(csv).buffer;
  return {
    name,
    original,
    sha256: createHash('sha256').update(new Uint8Array(original)).digest('hex'),
    sheets: [
      {
        name: 'CSV',
        rows: structuredClone(rows),
        formulaRows: [],
        hiddenRows: [],
      },
    ],
  };
};
function input(currency = 'SAR'): StockInput {
  const scope: StockInput['scope'] = {
    entity: 'Synthetic precision stock',
    inventoryLedger: 'STOCK',
    glLedger: 'GL',
    currency,
    currencyBasis: 'functional',
    postingStatus: 'posted',
    postingLayer: 'Current',
    asOf: '2026-09-30',
    chartVersion: 'CHART',
    mapVersion: 'MAP',
    valuationPolicyVersion: 'SUPPLIED',
    inventoryAccountSetVersion: 'SET',
    confirmed: true,
  };
  const money =
    currency === 'JPY'
      ? ['43', '7']
      : currency === 'KWD'
        ? ['43.200', '6.800']
        : ['43.20', '6.80'];
  const scopeValues = STOCK_FIELDS.map((k) => scope[k]);
  const register = [
    ['Format', 'INV1A-SECTIONS-1'],
    ...STOCK_SCOPE_HEADERS.map((k, i) => ['Scope', k, scopeValues[i]]),
  ];
  for (let i = 0; i < 2; i++)
    register.push(
      ['Section'],
      ['Item ID', '0009'],
      ['Item dimensions', `warehouse=W${i + 1};batch=A`],
      ['Unit', 'EA'],
      ['Quantity precision', '2'],
      ['Valuation reference', `VAL-${i + 1}`],
      ['Component', 'Value'],
      ['Quantity', '1.25'],
      ['Posted value', money[i]],
      ['End section'],
    );
  register.push(['End report']);
  const mapping = STOCK_HEADERS[1].slice();
  const policy = STOCK_HEADERS[2].slice();
  const gl = STOCK_HEADERS[3].slice();
  const files = [
    source('register.csv', register),
    source('map.csv', [
      mapping,
      ...[0, 1].map((i) => [
        `MAP-${i + 1}`,
        '0009',
        `warehouse=W${i + 1};batch=A`,
        'INV-9',
        `branch=0${i + 1}`,
        `POL-${i + 1}`,
        ...scopeValues,
      ]),
    ]),
    source('policy.csv', [
      policy,
      ...[0, 1].map((i) => [
        `POL-${i + 1}`,
        '0009',
        `warehouse=W${i + 1};batch=A`,
        'EA',
        '2',
        `VAL-${i + 1}`,
        'INV-9',
        `branch=0${i + 1}`,
        'inventory',
        'debit-positive',
        'provided-posted-carrying-value',
        '2026-09-30',
        '2026-09-30',
        `EVID-${i + 1}`,
        ...scopeValues,
      ]),
    ]),
    source('gl.csv', [
      gl,
      ...[0, 1].map((i) => [
        'INV-9',
        `branch=0${i + 1}`,
        'inventory',
        money[i],
        '0',
        ...scopeValues,
      ]),
    ]),
  ];
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope,
    readings: STOCK_ROLES.map((role, i) => ({
      role,
      sheet: 0,
      family: i === 0 ? STOCK_SECTION_FAMILY : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
function edit(
  state: StockInput,
  mutate: (rows: string[][]) => void,
): StockInput {
  const next = structuredClone(state),
    rows = next.files[0].sheets[0].rows;
  mutate(rows);
  next.files[0] = source('register.csv', rows);
  return next;
}
function bad(state: StockInput, code: string) {
  const r = reconcileStock(state);
  assert.equal(r.financial, 'source-error');
  assert.equal(r.totals, null);
  assert.ok(
    r.issues.some((v) => v.code === code),
    JSON.stringify(r.issues),
  );
  for (const row of r.comparisons)
    for (const key of [
      'registerMinor',
      'debitMinor',
      'creditMinor',
      'glMinor',
      'differenceMinor',
    ] as const)
      assert.equal(row[key], null);
  assert.equal(
    r.inventory.length,
    state.files.reduce((n, f) => n + f.sheets[0].rows.length, 0),
  );
  assert.equal(
    r.cells.length,
    state.files.reduce(
      (n, f) => n + f.sheets[0].rows.reduce((a, row) => a + row.length, 0),
      0,
    ),
  );
  return r;
}
void test('Section values use source precision, literal dimensions and inclusive policy dates for SAR, JPY and KWD', () => {
  for (const [currency, total, amounts] of [
    ['SAR', 5000, [4320, 680]],
    ['JPY', 50, [43, 7]],
    ['KWD', 50000, [43200, 6800]],
  ] as const) {
    const state = input(currency),
      snapshot = JSON.stringify(state);
    const r = reconcileStock(state);
    assert.equal(r.financial, 'ready', currency);
    assert.equal(r.review, 'needs-review');
    assert.deepEqual(r.totals, { registerMinor: total, glMinor: total });
    assert.deepEqual(
      r.records[0].map((v) => v.values),
      [
        ['0009', 'warehouse=W1;batch=A', 125, 'EA', 2, amounts[0], 'VAL-1'],
        ['0009', 'warehouse=W2;batch=A', 125, 'EA', 2, amounts[1], 'VAL-2'],
      ],
    );
    assert.deepEqual(
      r.comparisons.map((v) => [
        v.dimensions,
        v.registerMinor,
        v.glMinor,
        v.differenceMinor,
      ]),
      [
        ['branch=01', amounts[0], amounts[0], 0],
        ['branch=02', amounts[1], amounts[1], 0],
      ],
    );
    assert.deepEqual(
      r.records[0].map((v) => v.row),
      [14, 24],
    );
    assert.deepEqual(
      r.sectionEvidence?.sections.map((v) => [v.startRow, v.endRow]),
      [
        [14, 23],
        [24, 33],
      ],
    );
    assert.equal(r.sectionEvidence?.scope.entity?.row, 2);
    assert.equal(r.sectionEvidence?.scope.entity?.column, 3);
    assert.deepEqual(r.sectionEvidence?.sections[0].fields['Quantity'], {
      sourceHash: state.files[0].sha256,
      sheet: 0,
      sheetName: 'CSV',
      row: 21,
      column: 2,
      raw: '1.25',
    });
    assert.deepEqual(
      r.memberIds
        .filter((v) => JSON.parse(v)[1] === 0)
        .map((v) => JSON.parse(v)[4]),
      Array.from({ length: 33 }, (_, i) => i + 2),
    );
    assert.equal(JSON.stringify(state), snapshot);
  }
});
void test('Subtotals validate supplied carrying values and never fill or repair a missing component', () => {
  const positive = edit(input(), (rows) => {
    rows.splice(22, 0, ['Section subtotal', '43.20']);
    rows.splice(-1, 0, ['Report total', '50.00']);
  });
  const r = reconcileStock(positive);
  assert.equal(r.financial, 'ready');
  assert.equal(r.sectionEvidence?.sections[0].subtotal?.row, 23);
  assert.equal(r.sectionEvidence?.sections[0].subtotal?.raw, '43.20');
  assert.equal(r.sectionEvidence?.reportTotal?.row, 35);
  assert.equal(r.sectionEvidence?.reportTotal?.raw, '50.00');
  bad(
    edit(positive, (rows) => {
      rows.find((r) => r[0] === 'Section subtotal')![1] = '42.00';
    }),
    'CONTROL_MISMATCH',
  );
  bad(
    edit(positive, (rows) => {
      rows.splice(
        rows.findIndex((r) => r[0] === 'Posted value'),
        1,
      );
    }),
    'MISSING_COMPONENT',
  );
});
void test('Repeated valid detail headers, role order changes and sparse rows preserve section membership and value citations', () => {
  const state = edit(input(), (rows) => {
    [rows[20], rows[21]] = [rows[21], rows[20]];
    rows.splice(21, 0, ['Component', 'Value'], []);
  });
  const r = reconcileStock(state);
  assert.equal(r.financial, 'ready');
  assert.deepEqual(r.records[0][0].values, [
    '0009',
    'warehouse=W1;batch=A',
    125,
    'EA',
    2,
    4320,
    'VAL-1',
  ]);
  assert.equal(r.sectionEvidence?.sections[0].fields['Posted value'].row, 21);
  assert.equal(r.sectionEvidence?.sections[0].fields['Quantity'].row, 24);
  assert.equal(
    r.inventory.find((v) => v.source === 0 && v.row === 23)?.kind,
    'blank',
  );
  assert.ok(
    !r.memberIds.some((v) => JSON.parse(v)[1] === 0 && JSON.parse(v)[4] === 23),
  );
});
void test('Numeric failures identify the actual original value row and clear every account comparison', () => {
  const amount = bad(
    edit(input('JPY'), (rows) => {
      rows[21][1] = '43.001';
    }),
    'PRECISION',
  );
  assert.ok(
    amount.issues.some(
      (v) => v.source === 0 && v.row === 22 && v.code === 'PRECISION',
    ),
  );
  const quantity = bad(
    edit(input(), (rows) => {
      rows[20][1] = '1.251';
    }),
    'PRECISION',
  );
  assert.ok(
    quantity.issues.some(
      (v) => v.source === 0 && v.row === 21 && v.code === 'PRECISION',
    ),
  );
  for (const value of ['-43.20', '43,20', '4.32e1', '43.20CR', '43.20 '])
    bad(
      edit(input(), (rows) => {
        rows[21][1] = value;
      }),
      'NUMBER',
    );
});
void test('Neither totals nor repeated detail headers allow duplicate or late section identities to bind silently', () => {
  bad(
    edit(input(), (rows) => {
      rows.splice(22, 0, ['Component', 'Value'], ['Posted value', '43.20']);
    }),
    'DUPLICATE_COMPONENT',
  );
  bad(
    edit(input(), (rows) => {
      rows.splice(21, 0, ['Item dimensions', 'warehouse=W2;batch=A']);
    }),
    'LATE_SECTION_FIELD',
  );
  bad(
    edit(input(), (rows) => {
      rows.splice(15, 0, ['Item ID', '0009']);
    }),
    'DUPLICATE_SECTION_FIELD',
  );
  bad(
    edit(input(), (rows) => {
      rows[25][1] = 'warehouse=W1;batch=A';
    }),
    'DUPLICATE',
  );
});
void test('Orphan components, missing end markers, trailing rows and missing source scope stay original evidence', () => {
  bad(
    edit(input(), (rows) => {
      const value = rows.splice(21, 1)[0];
      rows.splice(22, 0, value);
    }),
    'ORPHAN_COMPONENT',
  );
  const unclosed = edit(input(), (rows) => {
    rows.splice(22, 1);
  });
  const unclosedResult = bad(unclosed, 'MISSING_END_SECTION');
  assert.ok(
    !unclosedResult.sectionEvidence?.sections.some((v) => v.startRow === 14),
  );
  for (const section of unclosedResult.sectionEvidence!.sections) {
    assert.equal(
      unclosed.files[0].sheets[0].rows[section.boundaries.end.row - 1][
        section.boundaries.end.column - 1
      ],
      'End section',
    );
    assert.equal(section.boundaries.end.raw, 'End section');
  }
  bad(
    edit(input(), (rows) => {
      rows.splice(-1, 1);
    }),
    'MISSING_END_REPORT',
  );
  bad(
    edit(input(), (rows) => {
      rows.push(['Posted value', '50.00']);
    }),
    'TRAILING_ROW',
  );
  bad(
    edit(input(), (rows) => {
      rows.splice(4, 1);
    }),
    'MISSING_SCOPE',
  );
  bad(
    edit(input(), (rows) => {
      rows.splice(30, 0, ['Scope', 'Currency', 'SAR']);
    }),
    'SCOPE_CONFLICT',
  );
});
void test('An equal grand total cannot repair opposite dimension policy bindings', () => {
  const state = edit(input(), (rows) => {
    [rows[15][1], rows[25][1]] = [rows[25][1], rows[15][1]];
  });
  const r = reconcileStock(state);
  assert.equal(r.financial, 'missing');
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.missing.filter((v) => v.startsWith('evidence:')).sort(), [
    'evidence:["0009","warehouse=W1;batch=A"]',
    'evidence:["0009","warehouse=W2;batch=A"]',
  ]);
  assert.notEqual(r.review, 'accepted');
});
void test('The section family is register-only and requires the explicit original format marker', () => {
  const state = input();
  assert.throws(
    () =>
      reconcileStock({
        ...state,
        readings: state.readings.map((r, i) =>
          i === 1 ? { ...r, family: STOCK_SECTION_FAMILY } : r,
        ) as StockInput['readings'],
      }),
    /STOCK_READING/,
  );
  bad(
    edit(state, (rows) => {
      rows[0][1] = 'INV1A-MATRIX-1';
    }),
    'FORMAT',
  );
});

void test('Hidden and formula source rows remain inventory members and cause whole-scope diagnostics', () => {
  const hidden = input();
  hidden.files[0].sheets[0].hiddenRows = [22];
  const r = bad(hidden, 'HIDDEN_SOURCE');
  assert.ok(
    r.memberIds.some((v) => JSON.parse(v)[1] === 0 && JSON.parse(v)[4] === 22),
  );
  const formula = input();
  formula.files[0].sheets[0].formulaRows = [22];
  bad(formula, 'FORMULA_SOURCE');
});
async function native(
  state: StockInput,
  configure: (sheet: ExcelJS.Worksheet) => void,
  writeLayout?: (archive: JSZip) => Promise<void>,
) {
  const next = structuredClone(state);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Supplied section stock');
  next.files[0].sheets[0].rows.forEach((row, index) => {
    sheet.getRow(index + 1).values = row;
  });
  configure(sheet);
  let original = new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
  if (writeLayout) {
    const archive = await JSZip.loadAsync(original);
    await writeLayout(archive);
    original = new Uint8Array(
      await archive.generateAsync({ type: 'uint8array' }),
    ).buffer;
  }
  next.files[0] = await readStockFile('register.xlsx', original);
  return next;
}
void test('A genuine native workbook with hidden empty rows and helper columns still proves all values and bindings', async () => {
  const state = await native(
    edit(input(), (rows) => {
      rows.splice(22, 0, []);
    }),
    (sheet) => {
      sheet.getRow(23).hidden = true;
      sheet.getColumn(4).hidden = true;
      // Explicitly allocate empty formatted source cells and a zero-width column.
      sheet.getCell('D1').numFmt = '0.00';
      sheet.getCell('D23').numFmt = '0.00';
      sheet.getColumn(4).width = 0;
    },
    async (archive) => {
      // ExcelJS omits a width of zero; write the intended source layout
      // explicitly, before asking the application to read the real bytes.
      const part = 'xl/worksheets/sheet1.xml';
      const xml = await archive.file(part)!.async('string');
      const column = /<col\b(?=[^>]*min="4")(?=[^>]*max="4")[^>]*\/>/;
      assert.match(xml, column);
      archive.file(
        part,
        xml.replace(column, (tag) =>
          tag.replace(/\swidth="[^"]*"/, '').replace('/>', ' width="0"/>'),
        ),
      );
    },
  );
  const archive = await JSZip.loadAsync(state.files[0].original!);
  const originalWorksheet = await archive
    .file('xl/worksheets/sheet1.xml')!
    .async('string');
  assert.match(
    originalWorksheet,
    /<col\b[^>]*min="4"[^>]*max="4"[^>]*width="0"/,
  );
  assert.ok(state.files[0].sheets[0].hiddenRows.includes(23));
  assert.ok(state.files[0].sheets[0].xlsxHeaders!.hiddenColumns.includes(4));
  const r = reconcileStock(state);
  assert.equal(
    r.financial,
    'ready',
    JSON.stringify({
      issues: r.issues,
      rowIssues: state.files[0].sheets[0].rowIssues,
      cellIssues: state.files[0].sheets[0].cellIssues,
    }),
  );
  assert.deepEqual(r.totals, { registerMinor: 5000, glMinor: 5000 });
  assert.deepEqual(
    r.records[0].map((v) => v.values),
    [
      ['0009', 'warehouse=W1;batch=A', 125, 'EA', 2, 4320, 'VAL-1'],
      ['0009', 'warehouse=W2;batch=A', 125, 'EA', 2, 680, 'VAL-2'],
    ],
  );
  assert.deepEqual(
    r.comparisons.map((v) => [v.dimensions, v.differenceMinor]),
    [
      ['branch=01', 0],
      ['branch=02', 0],
    ],
  );
  assert.equal(
    r.inventory.find((v) => v.source === 0 && v.row === 23)?.kind,
    'blank',
  );
  assert.ok(
    !r.memberIds.some((v) => JSON.parse(v)[1] === 0 && JSON.parse(v)[4] === 23),
  );
});
void test('Explicit numeric zero and unknown blank-result formulas remain protected source facts', async () => {
  const zero = await native(input(), (sheet) => {
    sheet.getCell('B22').value = 0;
    sheet.getRow(22).hidden = true;
  });
  const zeroResult = bad(zero, 'HIDDEN_SOURCE');
  assert.equal(zero.files[0].sheets[0].rows[21][1], '0');
  assert.ok(
    zeroResult.memberIds.some(
      (v) => JSON.parse(v)[1] === 0 && JSON.parse(v)[4] === 22,
    ),
  );
  const formula = await native(input(), (sheet) => {
    sheet.getCell('A35').value = { formula: 'SUM(B21:B22)' };
  });
  const formulaResult = bad(formula, 'FORMULA_SOURCE');
  assert.equal(formula.files[0].sheets[0].rows[34][0], '');
  assert.equal(
    formula.files[0].sheets[0].formulaCells?.['35:1'].formula,
    'SUM(B21:B22)',
  );
  assert.equal(
    formulaResult.inventory.find((v) => v.source === 0 && v.row === 35)?.kind,
    'error',
  );
  assert.ok(
    formulaResult.memberIds.some(
      (v) => JSON.parse(v)[1] === 0 && JSON.parse(v)[4] === 35,
    ),
  );
});
void test('A date-rendered quantity or money cannot become an approved serial amount merely because the raw number balances', async () => {
  for (const [address, value] of [
    ['B21', 1.25],
    ['B22', 43.2],
  ] as const) {
    const state = await native(input(), (sheet) => {
      sheet.getCell(address).value = value;
      sheet.getCell(address).numFmt = 'yyyy-mm-dd';
    });
    const r = reconcileStock(state);
    assert.equal(
      r.financial,
      'source-error',
      address + ': ' + JSON.stringify(r),
    );
    assert.equal(r.totals, null);
    assert.ok(r.issues.length > 0);
    for (const row of r.comparisons) assert.equal(row.differenceMinor, null);
  }
});
