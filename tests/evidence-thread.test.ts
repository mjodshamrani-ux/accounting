import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetThread,
  bankThread,
  allocationThread,
  glTbThread,
  payrollBankThread,
  payrollThread,
  stockThread,
  type Thread,
  type ThreadLabel,
} from '../lib/evidence-thread.ts';
import {
  assetFrozenNames,
  assetLongNames,
  fixedAssetsCase,
} from '../audit/reconciliation-sheet/fixed-assets-cases.ts';
import {
  payrollCase,
  payrollFrozenNames,
} from '../audit/reconciliation-sheet/payroll-cases.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import {
  STOCK_ROLES,
  STOCK_VERSION,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';
import { replayStock } from '../lib/reconciliation/inventory-register-io.ts';
import {
  BALANCE_FIELDS,
  GL_TB_VERSION,
  reconcileGlTb,
  type GlTbInput,
} from '../lib/reconciliation/gl-tb.ts';
import { readFile as readSource } from '../lib/reconciliation/io.ts';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { BankResult } from '../lib/reconciliation/bank.ts';
import type { AllocationResult } from '../lib/reconciliation/allocation.ts';

// The thread is held to the source bytes themselves: each file is read here
// with its own small CSV reader, not the engine's, and every cell the thread
// shows must be the text at that row and column, under that header.
function csv(bytes: ArrayBuffer): string[][] {
  const text = new TextDecoder('utf-8', { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/u, '');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const labelsOf = (files: readonly SourceFile[]): ThreadLabel[] =>
  files.map((f) => ({ name: f.name, sheet: f.sheets[0]?.name ?? null }));

/** Every source and cell of a thread, against the files read here. */
function heldToSources(
  thread: Thread,
  files: readonly SourceFile[],
  roles: readonly string[],
  what: string,
) {
  for (const s of thread) {
    assert.equal(s.name, files[s.source].name, `${what}: source name`);
    assert.equal(s.role, roles[s.source], `${what}: source role`);
    assert.ok('row' in s.place, `${what}: a row`);
    const rows = csv(files[s.source].original!);
    const row = rows[s.place.row - 1];
    assert.ok(row, `${what}: row ${s.place.row} is in ${s.name}`);
    assert.ok(s.cells, `${what}: cells kept`);
    assert.deepEqual(
      s.cells.map((c) => c.column),
      row.map((_, i) => i + 1),
      `${what}: every cell of row ${s.place.row}, in order`,
    );
    for (const c of s.cells) {
      assert.equal(c.text, row[c.column - 1], `${what}: cell text`);
      assert.equal(c.field, rows[0][c.column - 1] ?? '', `${what}: header`);
    }
  }
}

const ASSET_ROLES = ['register', 'mapping', 'policy-evidence', 'gl'];
const PAYROLL_ROLES = [
  'register',
  'mapping',
  'policy-evidence',
  'gl',
  'bank-payout',
];

void test('a fixed-assets comparison opens its GL row and the register rows the engine assigned to it, with every cell as the file has it', async () => {
  let comparisons = 0;
  for (const name of [...assetFrozenNames, ...assetLongNames]) {
    const { state, result } = await fixedAssetsCase(name);
    const labels = labelsOf(state.files);
    result.comparisons.forEach((comparison, i) => {
      const thread = assetThread(result, labels, i);
      const what = `${name} comparison ${i}`;
      assert.deepEqual(
        thread.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
        [
          [3, comparison.glRow],
          ...comparison.registerRows.map((r) => [0, r]),
        ],
        `${what}: the rows the engine names, GL first`,
      );
      heldToSources(thread, state.files, ASSET_ROLES, what);
      // The GL row is the one of the account and dimensions compared.
      const gl = thread[0].cells!;
      assert.equal(
        gl.find((c) => c.field === 'GL account')?.text,
        comparison.account,
        `${what}: the GL row's account`,
      );
      comparisons++;
    });
    assert.deepEqual(assetThread(result, labels, result.comparisons.length), []);
  }
  assert.ok(comparisons > 20, `${comparisons} comparisons read`);
});

void test('a payroll comparison opens its GL row and register rows, and the register net its bank payout rows, as the files have them', async () => {
  let comparisons = 0,
    banks = 0;
  for (const name of payrollFrozenNames) {
    const { state, result } = await payrollCase(name);
    const labels = labelsOf(state.files);
    result.comparisons.forEach((comparison, i) => {
      const thread = payrollThread(result, labels, i);
      const what = `${name} comparison ${i}`;
      assert.deepEqual(
        thread.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
        [
          [3, comparison.glRow],
          ...comparison.registerRows.map((r) => [0, r]),
        ],
        `${what}: the rows the engine names, GL first`,
      );
      heldToSources(thread, state.files, PAYROLL_ROLES, what);
      comparisons++;
    });
    const bank = payrollBankThread(result, labels);
    assert.deepEqual(
      bank.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
      result.bankComparison.bankRows.map((r) => [4, r]),
      `${name}: the bank rows the engine names`,
    );
    heldToSources(bank, state.files, PAYROLL_ROLES, `${name} bank`);
    banks += bank.length;
    assert.deepEqual(payrollThread(result, labels, -1), []);
  }
  assert.ok(comparisons > 20 && banks > 5, `${comparisons}, ${banks} read`);
});

// The INV-3 stories, sealed before the links were built: four CSV files and
// a scope each, read from their bytes as the product replays them.
const LINKS = new URL(
  '../audit/inventory-links-foundation/frozen/',
  import.meta.url,
);
async function linksStory(sid: string): Promise<StockInput> {
  const scope = JSON.parse(
    await readFile(new URL(`${sid}-scope.json`, LINKS), 'utf8'),
  ) as StockInput['scope'];
  const files = await Promise.all(
    ['register', 'mapping', 'evidence', 'gl'].map(async (role) => {
      const bytes = await readFile(new URL(`${sid}-${role}.csv`, LINKS));
      return {
        name: `${sid}-${role}.csv`,
        original: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sheets: [],
      } as unknown as SourceFile;
    }),
  );
  return {
    files: files as StockInput['files'],
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    scope: { ...scope, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}

void test('an inventory register row opens itself, then the mapping, policy evidence and GL rows the engine names for it, linked or not, as the files have them', async () => {
  const stories = [
    ...new Set(
      (await readdir(LINKS))
        .map((f) => /^(L\d+)-register\.csv$/u.exec(f)?.[1])
        .filter((s): s is string => !!s),
    ),
  ].sort();
  assert.ok(stories.length >= 20, `${stories.length} stories`);
  let links = 0,
    unlinked = 0,
    related = 0;
  for (const sid of stories) {
    const state = await linksStory(sid);
    let result;
    try {
      ({ result } = await replayStock(state));
    } catch {
      continue; // a story the family refuses has no rows to open
    }
    const labels = state.files.map((f) => ({ name: f.name, sheet: null }));
    result.links.forEach((link, i) => {
      const thread = stockThread(result, labels, i);
      const what = `${sid} link ${i}`;
      assert.deepEqual(
        thread.map((s) => [s.source, 'row' in s.place ? s.place.row : null]),
        [
          [0, link.row],
          ...link.mappings.map((m) => [1, m.row]),
          ...link.evidence.map((e) => [2, e.row]),
          ...link.gl.map((g) => [3, g.row]),
        ],
        `${what}: the register row, then the rows the engine names`,
      );
      heldToSources(thread, state.files, STOCK_ROLES, what);
      // The register row is the item and dimensions the link is for, in
      // whatever order the file puts its columns.
      const register = thread[0].cells!,
        text = (field: string) => register.find((c) => c.field === field)?.text;
      assert.equal(text('Item ID'), link.item, `${what}: the item`);
      assert.equal(text('Item dimensions'), link.dimensions, `${what}: dims`);
      links++;
      if (link.status === 'unlinked') unlinked++;
      related += thread.length - 1;
    });
    assert.deepEqual(stockThread(result, labels, result.links.length), []);
  }
  assert.ok(
    links > 300 && unlinked >= 20 && related > 600,
    `${links} links, ${unlinked} unlinked, ${related} related rows read`,
  );
});

void test('an inventory record read from a page or a matrix column shows its place and says its cells are not kept by row', () => {
  const result = {
    links: [
      {
        id: 'r1',
        row: 4,
        page: 2,
        item: 'A',
        dimensions: 'x',
        status: 'linked',
        reasons: [],
        mappings: [{ id: 'm1', row: 3, key: 'k' }],
        evidence: [],
        account: null,
        gl: [{ id: 'g1', row: 5, column: 2 }],
      },
    ],
    cells: [
      { source: 0, row: 4, column: 1, field: 'Item ID', text: 'A' },
      { source: 1, row: 3, column: 1, field: 'Mapping ID', text: 'M' },
      { source: 3, row: 5, column: 2, field: 'GL account', text: '1' },
    ],
  } as unknown as Parameters<typeof stockThread>[0];
  const labels = [
    { name: 'register.pdf', sheet: null },
    { name: 'map.csv', sheet: null },
    { name: 'policy.csv', sheet: null },
    { name: 'gl.xlsx', sheet: 'GL' },
  ];
  assert.deepEqual(stockThread(result, labels, 0), [
    {
      source: 0,
      role: 'register',
      name: 'register.pdf',
      sheet: null,
      place: { page: 2, line: 4 },
      cells: null,
    },
    {
      source: 1,
      role: 'mapping',
      name: 'map.csv',
      sheet: null,
      place: { row: 3 },
      cells: [{ column: 1, field: 'Mapping ID', text: 'M' }],
    },
    {
      source: 3,
      role: 'gl',
      name: 'gl.xlsx',
      sheet: 'GL',
      place: { row: 5 },
      cells: null,
    },
  ]);
});

// The GL and TB frozen cases, with their sealed amounts by component.
const GLTB = new URL('../audit/gl-tb/frozen/', import.meta.url);
const glTbTruth = JSON.parse(
  await readFile(new URL('expected.json', GLTB), 'utf8'),
) as {
  scope: GlTbInput['scope'];
  cases: {
    name: string;
    status: string;
    glAmounts: number[] | null;
    tbAmounts: number[] | null;
  }[];
};
// A money cell of the cases in minor units, read here: digits with at most
// two decimals, an optional minus and thousands commas.
function minor(text: string) {
  const m = /^(-?)([\d,]+)(?:\.(\d{1,2}))?$/u.exec(text.trim());
  assert.ok(m, `a money cell: ${JSON.stringify(text)}`);
  const units =
    Number(m[2].replace(/,/gu, '')) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -units : units;
}
const TB_FIELD_HEADERS = [
  'Opening debit',
  'Opening credit',
  'Period debit',
  'Period credit',
  'Closing debit',
  'Closing credit',
];
const GL_KINDS = ['opening', 'opening', 'movement', 'movement', 'closing', 'closing'];

void test('a GL and TB balance component opens each cell the engine summed, GL rows then the TB row, and they add up to the sealed amounts', async () => {
  let components = 0,
    cells = 0;
  for (const c of glTbTruth.cases) {
    const files = await Promise.all(
      ['gl', 'tb'].map(async (side) => {
        const bytes = await readFile(new URL(`${c.name}-${side}.csv`, GLTB));
        return readSource(
          `${c.name}-${side}.csv`,
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        );
      }),
    );
    const input: GlTbInput = {
      files: files as GlTbInput['files'],
      readings: [
        { sheet: 0, role: 'gl-detail', family: GL_TB_VERSION, confirmed: true },
        {
          sheet: 0,
          role: 'trial-balance',
          family: GL_TB_VERSION,
          confirmed: true,
        },
      ],
      scope: { ...glTbTruth.scope, confirmed: true },
    };
    const result = reconcileGlTb(input);
    const rows = files.map((f) => csv(f.original!));
    BALANCE_FIELDS.forEach((field, i) => {
      const thread = glTbThread(result, field),
        what = `${c.name} ${field}`;
      const gl = thread.filter((s) => s.source === 0),
        tb = thread.filter((s) => s.source === 1);
      assert.deepEqual(
        thread.map((s) => s.source),
        [...gl, ...tb].map((s) => s.source),
        `${what}: GL rows first, then TB`,
      );
      for (const s of thread) {
        assert.equal(s.name, files[s.source].name, `${what}: the file`);
        assert.equal(s.role, result.sources[s.source].role, `${what}: role`);
        assert.ok('row' in s.place, `${what}: a row`);
        const file = rows[s.source],
          row = file[s.place.row - 1];
        assert.ok(row, `${what}: row ${s.place.row} is in the file`);
        assert.equal(s.cells?.length, 1, `${what}: the one cell summed`);
        const [cell] = s.cells!;
        assert.equal(cell.text, row[cell.column - 1], `${what}: cell text`);
        assert.equal(
          file[0][cell.column - 1],
          s.source === 0
            ? i % 2
              ? 'Credit'
              : 'Debit'
            : TB_FIELD_HEADERS[i],
          `${what}: the column of the component`,
        );
        assert.equal(cell.field, file[0][cell.column - 1], `${what}: header`);
        if (s.source === 0)
          assert.equal(
            row[file[0].indexOf('Record kind')],
            GL_KINDS[i],
            `${what}: a GL row of the component's kind`,
          );
        cells++;
      }
      // The cells add up to the figure the table shows, and where the case
      // records its amounts, to the sealed amount too. A side the engine
      // could not total draws no cell.
      const glSum = gl.reduce((n, s) => n + minor(s.cells![0].text), 0),
        tbCells = tb.map((s) => minor(s.cells![0].text));
      if (result.gl) {
        assert.equal(glSum, result.gl[field], `${what}: GL sum`);
        // Every GL row of the component's kind, and no other, read from the
        // file here. A case with a source error leaves the rows in error out
        // of its totals by design, and is held by its sum alone.
        const kind = rows[0][0].indexOf('Record kind');
        if (c.status !== 'source-error')
          assert.deepEqual(
            gl.map((s) => ('row' in s.place ? s.place.row : 0)),
            rows[0]
              .map((r, at) => [r, at + 1] as const)
              .filter(([r], at) => at > 0 && r[kind] === GL_KINDS[i])
              .map(([, n]) => n),
            `${what}: every GL row of its kind`,
          );
      }
      else assert.deepEqual(gl, [], `${what}: no GL total, no GL cell`);
      if (result.tb)
        assert.deepEqual(tbCells, [result.tb[field]], `${what}: the TB cell`);
      else assert.deepEqual(tb, [], `${what}: no TB total, no TB cell`);
      if (c.glAmounts) assert.equal(glSum, c.glAmounts[i], `${what}: sealed GL`);
      if (c.tbAmounts)
        assert.deepEqual(tbCells, [c.tbAmounts[i]], `${what}: sealed TB`);
      components++;
    });
  }
  assert.ok(
    components === glTbTruth.cases.length * 6 && cells > 100,
    `${components} components, ${cells} cells`,
  );
});

void test('a bank movement and an allocation item open the row they were read from with the cells the reader traced, and an unknown row opens nothing', () => {
  const bank = {
    sources: [
      { name: 'statement.csv', hash: 'a', sheet: 'CSV', role: 'bank' },
      { name: 'cashbook.csv', hash: 'b', sheet: 'Book', role: 'cashbook' },
    ],
    records: [
      {
        id: 'r1',
        side: 1,
        row: 7,
        traces: [
          { field: 'Amount', column: 4, text: '1,250.00' },
          { field: 'Reference', column: 2, text: 'INV-77' },
        ],
      },
    ],
  } as unknown as BankResult;
  assert.deepEqual(bankThread(bank, 'r1'), [
    {
      source: 1,
      role: 'cashbook',
      name: 'cashbook.csv',
      sheet: 'Book',
      place: { row: 7 },
      cells: [
        { column: 4, field: 'Amount', text: '1,250.00' },
        { column: 2, field: 'Reference', text: 'INV-77' },
      ],
    },
  ]);
  assert.deepEqual(bankThread(bank, 'r2'), []);
  const allocation = {
    sources: [
      { name: 'payments.csv', hash: 'a', sheet: 'CSV', role: 'payments' },
      { name: 'invoices.csv', hash: 'b', sheet: 'CSV', role: 'invoices' },
    ],
    items: [
      {
        id: 'i1',
        side: 0,
        row: 3,
        traces: [
          { field: 'Original amount', column: 5, text: '90', amount: 9000 },
        ],
      },
    ],
  } as unknown as AllocationResult;
  assert.deepEqual(allocationThread(allocation, 'i1'), [
    {
      source: 0,
      role: 'payments',
      name: 'payments.csv',
      sheet: 'CSV',
      place: { row: 3 },
      cells: [{ column: 5, field: 'Original amount', text: '90' }],
    },
  ]);
  assert.deepEqual(allocationThread(allocation, 'missing'), []);
});
