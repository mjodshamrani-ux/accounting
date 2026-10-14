import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  STOCK_VERSION,
  STOCK_MATRIX_FAMILY,
  STOCK_ROLES,
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  STOCK_HEADERS,
  STOCK_VALUES,
  reconcileStock,
  type StockInput,
  type StockResult,
} from '../lib/reconciliation/inventory-register.ts';
import type { StockCellCitation } from '../lib/reconciliation/inventory-section-components.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';

function source(name: string, rows: string[][]): SourceFile {
  const csv =
    rows
      .map((row) =>
        row
          .map((value) =>
            /[",\r\n]/.test(value)
              ? '"' + value.replaceAll('"', '""') + '"'
              : value,
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
}
function input(currency = 'SAR'): StockInput {
  const scope: StockInput['scope'] = {
    entity: 'Synthetic matrix precision stock',
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
  const scopeValues = STOCK_FIELDS.map((key) => scope[key]);
  const money =
    currency === 'JPY'
      ? ['43', '7', '50']
      : currency === 'KWD'
        ? ['43.200', '6.800', '50.000']
        : ['43.20', '6.80', '50.00'];
  const facts = [
    ['0009', 'warehouse=W1;batch=A', '1.25', 'KG', '2', money[0], 'VAL-1'],
    ['009', 'warehouse=W2;batch=B', '2.50', 'KG', '2', money[1], 'VAL-2'],
  ];
  const rows = [
    ['Format', 'INV1A-MATRIX-1'],
    ...STOCK_SCOPE_HEADERS.map((label, index) => [
      'Scope',
      label,
      scopeValues[index],
    ]),
    ['Field', 'FACT-A', 'FACT-B'],
    ...STOCK_VALUES[0].map((label, index) => [
      label,
      facts[0][index],
      facts[1][index],
    ]),
    ['Report total', money[2]],
    ['End report'],
  ];
  const files = [
    source('register.csv', rows),
    source('map.csv', [
      STOCK_HEADERS[1],
      ...facts.map((fact, index) => [
        `MAP-${index + 1}`,
        fact[0],
        fact[1],
        'INV-9',
        `branch=0${index + 1}`,
        `POL-${index + 1}`,
        ...scopeValues,
      ]),
    ]),
    source('policy.csv', [
      STOCK_HEADERS[2],
      ...facts.map((fact, index) => [
        `POL-${index + 1}`,
        fact[0],
        fact[1],
        fact[3],
        fact[4],
        fact[6],
        'INV-9',
        `branch=0${index + 1}`,
        'inventory',
        'debit-positive',
        'provided-posted-carrying-value',
        '2026-09-30',
        '2026-09-30',
        `EVID-${index + 1}`,
        ...scopeValues,
      ]),
    ]),
    source('gl.csv', [
      STOCK_HEADERS[3],
      ...facts.map((fact, index) => [
        'INV-9',
        `branch=0${index + 1}`,
        'inventory',
        fact[5],
        '0',
        ...scopeValues,
      ]),
    ]),
  ];
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope,
    readings: STOCK_ROLES.map((role, index) => ({
      role,
      sheet: 0,
      family: index === 0 ? STOCK_MATRIX_FAMILY : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
function edit(
  state: StockInput,
  change: (rows: string[][]) => void,
): StockInput {
  const next = structuredClone(state),
    rows = next.files[0].sheets[0].rows;
  change(rows);
  next.files[0] = source('register.csv', rows);
  return next;
}
function conserved(state: StockInput, result: StockResult) {
  assert.equal(
    result.inventory.length,
    state.files.reduce((sum, file) => sum + file.sheets[0].rows.length, 0),
  );
  assert.equal(
    result.cells.length,
    state.files.reduce(
      (sum, file) =>
        sum + file.sheets[0].rows.reduce((n, row) => n + row.length, 0),
      0,
    ),
  );
  for (const cell of result.cells)
    assert.equal(
      cell.text,
      state.files[cell.source].sheets[0].rows[cell.row - 1][cell.column - 1],
    );
  assert.equal(new Set(result.memberIds).size, result.memberIds.length);
  for (const id of result.memberIds) {
    const tuple = JSON.parse(id);
    assert.equal(tuple.length, 5);
    assert.equal(tuple[0], STOCK_VERSION);
    assert.equal(tuple[2], state.files[tuple[1]].sha256);
    assert.ok(
      state.files[tuple[1]].sheets[0].rows[tuple[4] - 1].some((value) =>
        value.trim(),
      ),
    );
  }
}
function bad(state: StockInput, code: string, coordinate?: [number, number]) {
  const result = reconcileStock(state);
  assert.equal(result.financial, 'source-error');
  assert.equal(result.totals, null);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === code &&
        (!coordinate ||
          (issue.row === coordinate[0] && issue.column === coordinate[1])),
    ),
    JSON.stringify(result.issues),
  );
  for (const comparison of result.comparisons)
    for (const key of [
      'registerMinor',
      'debitMinor',
      'creditMinor',
      'glMinor',
      'differenceMinor',
    ] as const)
      assert.equal(comparison[key], null);
  assert.equal(result.review, 'needs-review');
  assert.ok(result.matrixEvidence);
  assert.equal(result.sectionEvidence, undefined);
  conserved(state, result);
  return result;
}
function cited(state: StockInput, citation: StockCellCitation) {
  assert.equal(citation.sourceHash, state.files[0].sha256);
  assert.equal(citation.sheet, 0);
  assert.equal(citation.sheetName, 'CSV');
  assert.equal(
    citation.raw,
    state.files[0].sheets[0].rows[citation.row - 1][citation.column - 1],
  );
}
void test('Matrix preserves each literal item, dimension, quantity, valuation reference and own-column citation for SAR/JPY/KWD', () => {
  for (const [currency, total, amounts] of [
    ['SAR', 5000, [4320, 680]],
    ['JPY', 50, [43, 7]],
    ['KWD', 50000, [43200, 6800]],
  ] as const) {
    const state = input(currency),
      snapshot = JSON.stringify(state),
      result = reconcileStock(state);
    assert.equal(result.financial, 'ready');
    assert.equal(result.review, 'needs-review');
    assert.deepEqual(result.totals, { registerMinor: total, glMinor: total });
    assert.deepEqual(
      result.records[0].map((record) => record.values),
      [
        ['0009', 'warehouse=W1;batch=A', 125, 'KG', 2, amounts[0], 'VAL-1'],
        ['009', 'warehouse=W2;batch=B', 250, 'KG', 2, amounts[1], 'VAL-2'],
      ],
    );
    assert.equal(new Set(result.records[0].map((record) => record.id)).size, 2);
    assert.deepEqual(
      result.records[0].map((record) => JSON.parse(record.id)),
      [
        [STOCK_VERSION, 0, state.files[0].sha256, 0, 15, 2],
        [STOCK_VERSION, 0, state.files[0].sha256, 0, 15, 3],
      ],
    );
    const evidence = result.matrixEvidence!;
    cited(state, evidence.format);
    for (const key of STOCK_FIELDS) {
      cited(state, evidence.scope[key]!);
      assert.equal(evidence.scope[key]!.raw, state.scope[key]);
    }
    assert.equal(evidence.bands[0].header.row, 14);
    assert.equal(evidence.bands[0].completedRolesAtRow, 21);
    assert.equal(evidence.bands[0].boundary!.kind, 'report-total');
    assert.equal(evidence.bands[0].boundary!.citation.row, 22);
    assert.equal(evidence.reportEnd!.row, 23);
    for (const band of evidence.bands) {
      cited(state, band.header);
      for (const axis of band.columns) cited(state, axis.key);
      cited(state, band.boundary!.citation);
      for (const record of band.records) {
        assert.deepEqual(Object.keys(record.fields), STOCK_VALUES[0]);
        cited(state, record.anchor);
        cited(state, record.axis);
        assert.deepEqual(record.anchor, record.fields['Item ID'].value);
        assert.equal(record.anchor.column, record.column);
        assert.equal(record.axis.column, record.column);
        for (const label of STOCK_VALUES[0]) {
          const field = record.fields[label];
          cited(state, field.value);
          cited(state, field.role);
          assert.equal(field.role.raw, label);
          assert.equal(field.role.column, 1);
          assert.equal(field.value.column, record.column);
          assert.equal(field.value.row, field.role.row);
        }
      }
    }
    assert.equal(result.memberIds.length, 28);
    assert.equal(
      result.inventory.filter(
        (row) => row.source === 0 && row.kind === 'matrix-field',
      ).length,
      7,
    );
    conserved(state, result);
    assert.equal(JSON.stringify(state), snapshot);
  }
});
void test('Role-row and whole-axis permutations preserve field ownership while actual Item ID anchor changes', () => {
  const state = edit(input(), (rows) => {
    const fields = rows.slice(14, 21);
    const order = [3, 5, 1, 6, 4, 0, 2];
    rows.splice(
      14,
      7,
      ...order.map((index) => [
        fields[index][0],
        fields[index][2],
        fields[index][1],
      ]),
    );
    rows[13] = ['Field', 'FACT-B', 'FACT-A'];
  });
  const result = reconcileStock(state);
  assert.equal(result.financial, 'ready');
  assert.deepEqual(
    result.records[0].map((record) => record.values),
    [
      ['009', 'warehouse=W2;batch=B', 250, 'KG', 2, 680, 'VAL-2'],
      ['0009', 'warehouse=W1;batch=A', 125, 'KG', 2, 4320, 'VAL-1'],
    ],
  );
  assert.deepEqual(
    result.records[0].map((record) => [record.row, record.column]),
    [
      [20, 2],
      [20, 3],
    ],
  );
  for (const record of result.matrixEvidence!.bands[0].records) {
    assert.equal(record.anchor.row, 20);
    assert.equal(record.fields['Quantity'].value.row, 21);
    assert.equal(record.fields['Posted value'].value.row, 16);
    assert.equal(record.fields['Item dimensions'].value.row, 17);
    for (const field of Object.values(record.fields)) cited(state, field.value);
  }
  conserved(state, result);
});
void test('Complete split bands can reuse presentation axis names and contain a wholly blank separator column without borrowing fields', () => {
  const state = edit(input(), (rows) => {
    const fields = rows.slice(14, 21);
    rows.splice(
      13,
      8,
      ['Field', 'RECORD'],
      ...fields.map((field) => [field[0], field[1]]),
      [],
      ['Field', '', 'RECORD'],
      ...[6, 2, 0, 1, 5, 3, 4].map((index) => [
        fields[index][0],
        '',
        fields[index][2],
      ]),
    );
  });
  const result = reconcileStock(state);
  assert.equal(result.financial, 'ready');
  assert.deepEqual(
    result.records[0].map((record) => record.values),
    [
      ['0009', 'warehouse=W1;batch=A', 125, 'KG', 2, 4320, 'VAL-1'],
      ['009', 'warehouse=W2;batch=B', 250, 'KG', 2, 680, 'VAL-2'],
    ],
  );
  const bands = result.matrixEvidence!.bands;
  assert.equal(bands.length, 2);
  assert.equal(bands[0].boundary!.kind, 'field');
  assert.deepEqual(bands[0].boundary!.citation, bands[1].header);
  assert.equal(bands[0].completedRolesAtRow, 21);
  assert.deepEqual(
    bands.map((band) => band.columns.map((axis) => axis.column)),
    [[2], [3]],
  );
  assert.equal(bands[1].records[0].anchor.row, 26);
  assert.equal(bands[1].records[0].anchor.column, 3);
  assert.equal(
    result.inventory.filter((row) => row.source === 0 && row.kind === 'blank')
      .length,
    1,
  );
  conserved(state, result);
});
void test('Equal grand totals never hide swapped branch values or resolve a dimension/ref ownership conflict', () => {
  const values = edit(input(), (rows) => {
    [rows[19][1], rows[19][2]] = [rows[19][2], rows[19][1]];
  });
  const result = reconcileStock(values);
  assert.equal(result.financial, 'difference');
  assert.deepEqual(result.totals, { registerMinor: 5000, glMinor: 5000 });
  assert.deepEqual(
    result.comparisons.map((row) => [row.dimensions, row.differenceMinor]),
    [
      ['branch=01', -3640],
      ['branch=02', 3640],
    ],
  );
  const dimensions = edit(input(), (rows) => {
    [rows[15][1], rows[15][2]] = [rows[15][2], rows[15][1]];
  });
  const missing = reconcileStock(dimensions);
  assert.equal(missing.financial, 'missing');
  assert.equal(missing.review, 'needs-review');
  assert.equal(missing.totals!.registerMinor, 0);
  assert.equal(missing.totals!.glMinor, 5000);
  assert.ok(missing.missing.some((key) => key.startsWith('mapping:')));
  assert.equal(missing.issues.length, 0);
});
void test('An explicit zero quantity/value requires its own source citations and matching zero GL member', () => {
  const state = edit(input(), (rows) => {
    rows[16][2] = '0.00';
    rows[19][2] = '0.00';
    rows[21][1] = '43.20';
  });
  const gl = state.files[3].sheets[0].rows;
  gl[2][3] = '0.00';
  state.files[3] = source('gl.csv', gl);
  const result = reconcileStock(state);
  assert.equal(result.financial, 'ready');
  assert.equal(result.records[0][1].values[2], 0);
  assert.equal(result.records[0][1].values[5], 0);
  assert.equal(
    result.matrixEvidence!.bands[0].records[1].fields['Quantity'].value.row,
    17,
  );
  assert.equal(
    result.matrixEvidence!.bands[0].records[1].fields['Posted value'].value.row,
    20,
  );
  const without = structuredClone(state);
  without.files[3] = source(
    'gl.csv',
    without.files[3].sheets[0].rows.slice(0, 2),
  );
  const missing = reconcileStock(without);
  assert.equal(missing.financial, 'missing');
  assert.ok(missing.missing.includes('gl:["INV-9","branch=02"]'));
  const noQuantity = edit(state, (rows) => {
    rows[16][2] = '';
  });
  const absent = bad(noQuantity, 'MISSING_MATRIX_VALUE', [17, 3]);
  assert.equal(absent.records[0].length, 1);
  assert.equal(absent.matrixEvidence!.bands[0].records.length, 1);
});
void test('Missing/repeated roles and an early next axis cannot borrow values from a neighbouring band', () => {
  const repeated = edit(input(), (rows) => {
    rows.splice(21, 0, [...rows[16]]);
  });
  bad(repeated, 'DUPLICATE_MATRIX_FIELD', [22, 1]);
  const absent = edit(input(), (rows) => {
    rows.splice(16, 1);
  });
  assert.equal(bad(absent, 'MISSING_MATRIX_FIELD').records[0].length, 0);
  const early = edit(input(), (rows) => {
    rows.splice(18, 0, ['Field', 'EARLY-A', 'EARLY-B']);
  });
  const result = bad(early, 'MISSING_MATRIX_FIELD');
  assert.equal(result.records[0].length, 0);
  assert.equal(result.matrixEvidence!.bands.length, 2);
  assert.deepEqual(
    result.matrixEvidence!.bands[0].boundary!.citation,
    result.matrixEvidence!.bands[1].header,
  );
});
void test('Repeated axis labels and anonymous populated separators or extra columns are explicit physical source errors', () => {
  const duplicate = edit(input(), (rows) => {
    rows[13][2] = rows[13][1];
  });
  bad(duplicate, 'DUPLICATE_MATRIX_AXIS', [14, 3]);
  const separator = edit(input(), (rows) => {
    for (let index = 13; index <= 20; index++) rows[index].splice(2, 0, '');
    rows[16][2] = '0';
  });
  bad(separator, 'ORPHAN_MATRIX_COLUMN', [17, 3]);
  const orphan = edit(input(), (rows) => {
    rows[19].push('', '6.80');
  });
  const result = bad(orphan, 'ORPHAN_MATRIX_COLUMN', [20, 5]);
  assert.ok(
    result.cells.some(
      (cell) =>
        cell.source === 0 &&
        cell.row === 20 &&
        cell.column === 5 &&
        cell.text === '6.80',
    ),
  );
  const truncated = edit(input(), (rows) => {
    rows[19].pop();
  });
  bad(truncated, 'MISSING_MATRIX_VALUE', [20, 3]);
});
void test('Global duplicate item/dimension competitors survive malformed financial values and split-band presentation changes', () => {
  const state = edit(input(), (rows) => {
    rows[14][2] = rows[14][1];
    rows[15][2] = rows[15][1];
    rows[19][2] = 'wrong';
  });
  const result = bad(state, 'DUPLICATE', [15, 3]);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'NUMBER' && issue.row === 20 && issue.column === 3,
    ),
  );
  assert.equal(result.records[0].length, 1);
  assert.equal(result.matrixEvidence!.bands[0].records.length, 2);
  const split = edit(input(), (rows) => {
    const fields = rows.slice(14, 21);
    rows.splice(
      13,
      8,
      ['Field', 'FIRST'],
      ...fields.map((field) => [field[0], field[1]]),
      ['Field', 'SECOND'],
      ...fields.map((field) => [field[0], field[1]]),
    );
  });
  const duplicate = bad(split, 'DUPLICATE');
  assert.equal(duplicate.matrixEvidence!.bands.length, 2);
  assert.equal(
    duplicate.issues.filter((issue) => issue.code === 'DUPLICATE').length,
    2,
  );
});
void test('Late/repeated scope, unknown rows, bad controls, missing end and populated trailing facts never gain approval', () => {
  bad(
    edit(input(), (rows) => {
      rows.splice(15, 0, ['Scope', 'Currency', 'SAR']);
    }),
    'SCOPE_CONFLICT',
    [16, 1],
  );
  bad(
    edit(input(), (rows) => {
      rows.splice(2, 0, [...rows[1]]);
    }),
    'DUPLICATE_SCOPE',
    [3, 2],
  );
  bad(
    edit(input(), (rows) => {
      rows.splice(18, 0, ['Memo', 'not a field']);
    }),
    'UNKNOWN_ROW',
    [19, 1],
  );
  bad(
    edit(input(), (rows) => {
      rows[21][1] = '49.99';
    }),
    'CONTROL_MISMATCH',
    [22, 2],
  );
  const noEnd = edit(input(), (rows) => {
    rows.splice(21, 2);
  });
  const missing = bad(noEnd, 'MISSING_END_REPORT');
  assert.equal(missing.matrixEvidence!.reportEnd, undefined);
  assert.equal(missing.matrixEvidence!.bands[0].boundary, undefined);
  assert.equal(missing.matrixEvidence!.bands[0].completedRolesAtRow, 21);
  bad(
    edit(input(), (rows) => {
      rows.push(['Posted value', '43.20']);
    }),
    'TRAILING_ROW',
    [24, 1],
  );
});
void test('Strict quantity/value numeric guards apply at the actual matrix row and column', () => {
  for (const [role, value, code] of [
    ['Quantity', '1e2', 'NUMBER'],
    ['Quantity', '-1.25', 'NUMBER'],
    ['Quantity', '1.250', 'PRECISION'],
    ['Quantity precision', '7', 'QUANTITY_PRECISION'],
    ['Posted value', '4,320.00', 'NUMBER'],
    ['Posted value', '43.201', 'PRECISION'],
    ['Posted value', '+43.20', 'NUMBER'],
    ['Posted value', '100000000000001', 'BOUND'],
  ]) {
    const row = STOCK_VALUES[0].indexOf(role) + 15;
    const state = edit(input(), (rows) => {
      rows[row - 1][2] = value;
    });
    bad(state, code, [row, 3]);
  }
});
void test('Ready remains unapproved until explicit completeness and all physical members are reviewed; logical IDs are not decision members', () => {
  const state = input();
  const initial = reconcileStock(state);
  assert.throws(
    () =>
      reconcileStock({
        ...state,
        events: [
          {
            id: 'APPROVE',
            type: 'accept',
            memberIds: initial.memberIds,
            context: initial.context,
            at: '2026-10-14T00:00:00.000Z',
            reference: 'WHOLE',
            note: 'Reviewed',
          },
        ],
      }),
    /STOCK_EVENT_ACCEPT/,
  );
  state.completeness = {
    confirmed: true,
    reference: 'COUNT-4',
    note: 'All sources independently reviewed',
  };
  const ready = reconcileStock(state);
  state.events = [
    {
      id: 'APPROVE',
      type: 'accept',
      memberIds: ready.memberIds,
      context: ready.context,
      at: '2026-10-14T00:00:00.000Z',
      reference: 'WHOLE',
      note: 'Reviewed',
    },
  ];
  assert.equal(reconcileStock(state).status, 'consistent-with-evidence');
  const logical = {
    ...state,
    events: [
      {
        ...state.events[0],
        memberIds: ready.records.flat().map((record) => record.id),
      },
    ],
  };
  assert.throws(() => reconcileStock(logical), /STOCK_EVENT_MEMBERS/);
  const changed = edit(state, (rows) => {
    rows[13][1] = 'CHANGED-PRESENTATION';
  });
  assert.throws(() => reconcileStock(changed), /STOCK_EVENT/);
});
void test('Matrix family is source-driven and register-only while canonical sources retain their prior record shapes', () => {
  const state = input();
  bad(
    edit(state, (rows) => {
      rows[0][1] = 'INV1A-SECTIONS-1';
    }),
    'FORMAT',
    [1, 2],
  );
  const foreign = structuredClone(state);
  foreign.readings[1].family = STOCK_MATRIX_FAMILY;
  assert.throws(() => reconcileStock(foreign), /STOCK_READING/);
  const result = reconcileStock(state);
  for (const records of result.records.slice(1))
    for (const record of records) {
      assert.equal(Object.hasOwn(record, 'column'), false);
      assert.equal(JSON.parse(record.id).length, 5);
    }
  assert.equal(
    result.issues.some((issue) => Object.hasOwn(issue, 'column')),
    false,
  );
});
void test('Logical-column budget rejects expansion beyond the aggregate cap before allocating financial projections', () => {
  const state = input(),
    originalRows = state.files[0].sheets[0].rows;
  const prefix = originalRows.slice(0, 13),
    fields = originalRows.slice(14, 21);
  const rows = [...prefix];
  for (let band = 0; band < 203; band++) {
    rows.push([
      'Field',
      ...Array.from({ length: 99 }, (_, index) => `F-${band}-${index}`),
    ]);
    rows.push(
      ...fields.map((field) => [field[0], ...Array(99).fill(field[1])]),
    );
  }
  rows.push(['End report']);
  state.files[0] = source('register.csv', rows);
  assert.ok(rows.length < 20000);
  assert.throws(() => reconcileStock(state), /STOCK_LOGICAL_ROWS/);
  const allowed = edit(state, (physical) => {
    physical.splice(13 + 202 * 8, 8);
  });
  // After removing one complete band, 202*99 facts plus six other source
  // facts still exceed the aggregate cap by four despite the short source.
  assert.throws(() => reconcileStock(allowed), /STOCK_LOGICAL_ROWS/);
});
