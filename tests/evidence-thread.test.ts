import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetThread,
  bankThread,
  allocationThread,
  arThread,
  clearingThread,
  financialThread,
  gatewayThread,
  glTbSectionsThread,
  glTbThread,
  movementAccountThread,
  movementPositionThread,
  payrollRegisterThread,
  intercompanyThread,
  payrollBankThread,
  payrollThread,
  stockThread,
  supplierThread,
  type GatewayTable,
  type Thread,
  type ThreadLabel,
} from '../lib/evidence-thread.ts';
import { reconcileGateway } from '../lib/reconciliation/payment-gateway.ts';
import {
  compare,
  inferMapping,
  normalizeSource,
} from '../lib/reconciliation/core.ts';
import { demoFiles, demoScope } from '../lib/reconciliation/demo.ts';
import { demoMappings } from '../lib/reconciliation/demo.ts';
import {
  gatewayFixture,
  gatewayTruth,
} from '../audit/payment-gateway/fixtures.ts';
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
import {
  GLS_PAGE_LABELS,
  GLS_SCOPE_FIELDS,
  GLS_VERSION,
  reconcileGlTbSections,
  type GlsScope,
} from '../lib/reconciliation/gl-tb-sections.ts';
import {
  PLR_ROLE,
  PLR_VERSION,
  reconcileLongRegister,
  type PlrLabel,
} from '../lib/reconciliation/payroll-long-register.ts';
import {
  IMB_ROLES,
  IMB_VERSION,
  reconcileMovementBridge,
  type ImbFile,
  type ImbReading,
  type ImbScopeField,
} from '../lib/reconciliation/inventory-movement-bridge.ts';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { BankResult } from '../lib/reconciliation/bank.ts';
import {
  reconcileClearing,
  type ClearingInput,
  type ClearingReading,
} from '../lib/reconciliation/clearing.ts';
import {
  clearingDemoReading,
  clearingDemoScope,
} from '../lib/reconciliation/clearing-demo.ts';
import {
  reconcileAr,
  suggestArScopeReading,
  type ArInput,
  type ArReading,
  type ArResult,
} from '../lib/reconciliation/ar.ts';
import { readArFile } from '../lib/reconciliation/ar-source.ts';
import { arDemoReadings, arDemoScope } from '../lib/reconciliation/ar-demo.ts';
import type { AllocationResult } from '../lib/reconciliation/allocation.ts';
import {
  financialTruth,
  finishedFinancial,
} from '../audit/tb-financial/fixtures.ts';
import {
  intercompanyTruth,
  finishedIntercompany,
} from '../audit/intercompany/fixtures.ts';

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

/** Every source and cell of a thread, against the files read here. A cell
 * past the end of the header row has no header in the file: its header is
 * `unheaded(column)`, the name the engine gives such a column. */
function heldToSources(
  thread: Thread,
  files: readonly SourceFile[],
  roles: readonly string[],
  what: string,
  unheaded: (column: number) => string = () => '',
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
      assert.equal(
        c.field,
        rows[0][c.column - 1] ?? unheaded(c.column),
        `${what}: header`,
      );
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

const CLEARING = new URL('../audit/clearing/frozen/', import.meta.url);

// A clearing story: the frozen file as it is, or rewritten here so that a
// blank row and a row in error sit between movements, or the columns come in
// another order. The engine reads the first row as the header, and only it. The members of each case
// are named by posting identifier, read from the frozen file with the
// expected groups, so that no story's answer comes from the engine.
async function clearingStories() {
  const bytes = await readFile(new URL('source.csv', CLEARING)),
    expected = JSON.parse(
      await readFile(new URL('expected.json', CLEARING), 'utf8'),
    ) as {
      automaticGroups: number[][];
      unlinkedRows: number[];
      residualGroup: { rows: number[] };
      manualDecision: { rows: number[]; note: string };
    };
  const frozen = csv(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    posting = (row: number) => frozen[row - 1][0];
  const groups = [
    ...expected.automaticGroups,
    expected.residualGroup.rows,
  ].map((g) => g.map(posting));
  const apart = expected.unlinkedRows.map((r) => [posting(r)]),
    decided = expected.manualDecision.rows.map(posting);
  const write = (rows: string[][]) =>
    rows.map((r) => r.join(',')).join('\n') + '\n';
  const order = [6, 5, 4, 3, 2, 1, 0];
  return {
    expected,
    stories: [
      {
        name: 'frozen',
        text: write(frozen),
        reading: { ...clearingDemoReading },
        groups: [...groups, ...apart],
      },
      {
        name: 'blank and error rows',
        text: write([
          ...frozen.slice(0, 4),
          [''],
          ['P099', 'C001', '2026-13-40', '5.00', '2150', 'SAR', 'Bad date'],
          ...frozen.slice(4),
        ]),
        reading: { ...clearingDemoReading },
        groups: null,
        error: 'P099',
      },
      {
        name: 'columns in another order',
        text: write(frozen.map((r) => order.map((c) => r[c]))),
        reading: {
          ...clearingDemoReading,
          posting: 6,
          reference: 5,
          date: 4,
          amount: 3,
          account: 2,
          currency: 1,
          description: 0,
        } satisfies ClearingReading,
        groups: [...groups, ...apart],
      },
      {
        name: 'decided by hand',
        text: write(frozen),
        reading: { ...clearingDemoReading },
        decide: expected.manualDecision,
        groups: [...groups, decided],
      },
    ],
  };
}

void test('a clearing case opens each movement row the engine put in it, every cell under its header as the file has it', async () => {
  const { stories } = await clearingStories();
  let cases = 0,
    cells = 0;
  for (const story of stories) {
    const bytes = new TextEncoder().encode(story.text);
    const input: ClearingInput = {
      file: await readSource('clearing.csv', bytes.buffer as ArrayBuffer),
      reading: story.reading,
      scope: { ...clearingDemoScope },
      events: [],
    };
    if (story.decide) {
      const first = reconcileClearing(input),
        rows = csv(bytes.buffer as ArrayBuffer);
      input.events.push({
        context: first.context,
        action: 'clear',
        ids: first.rows
          .filter((r) => story.decide!.rows.includes(r.row))
          .map((r) => {
            assert.equal(
              r.posting,
              rows[r.row - 1][story.reading.posting],
              `${story.name}: decided row`,
            );
            return r.id;
          }),
        note: story.decide.note,
      });
    }
    const result = reconcileClearing(input),
      file = csv(bytes.buffer as ArrayBuffer),
      header = file[story.reading.header],
      at = header.indexOf('Posting ID');
    assert.ok(at >= 0, `${story.name}: the header row is the one read`);
    const members: string[][] = [];
    result.cases.forEach((c, i) => {
      const thread = clearingThread(result, 'clearing.csv', i),
        what = `${story.name} case ${i}`;
      assert.deepEqual(
        thread.map((s) => ('row' in s.place ? s.place.row : 0)),
        c.ids.map((id) => result.rows.find((r) => r.id === id)!.row),
        `${what}: one row per member, in the case's order`,
      );
      for (const s of thread) {
        assert.equal(s.source, 0, `${what}: the one source`);
        assert.equal(s.role, 'movements', `${what}: role`);
        assert.equal(s.name, 'clearing.csv', `${what}: the file`);
        assert.equal(s.sheet, result.sheet, `${what}: the sheet`);
        assert.ok('row' in s.place, `${what}: a row`);
        const row = file[s.place.row - 1];
        assert.ok(row, `${what}: row ${s.place.row} is in the file`);
        assert.equal(s.cells?.length, row.length, `${what}: every cell`);
        s.cells!.forEach((cell, j) => {
          assert.equal(cell.column, j + 1, `${what}: column`);
          assert.equal(cell.text, row[j], `${what}: cell text`);
          assert.equal(cell.field, header[j], `${what}: header`);
          cells++;
        });
      }
      members.push(
        thread.map((s) => ('row' in s.place ? file[s.place.row - 1][at] : '')),
      );
      cases++;
    });
    const sorted = (groups: string[][]) =>
      groups.map((g) => [...g].sort().join(' ')).sort();
    if (story.groups)
      assert.deepEqual(
        sorted(members),
        sorted(story.groups),
        `${story.name}: the members of each case`,
      );
    // Every movement the file has is in one case, and the row in error in
    // none; a story that moves rows keeps its members.
    if (story.error) {
      assert.ok(
        !members.flat().includes(story.error),
        `${story.name}: the row in error opens from no case`,
      );
      assert.deepEqual(
        members.flat().sort(),
        file
          .slice(story.reading.header + 1)
          .map((r) => r[at])
          .filter((p) => p && p !== story.error)
          .sort(),
        `${story.name}: every movement in one case`,
      );
    }
    assert.deepEqual(
      clearingThread(result, 'clearing.csv', result.cases.length),
      [],
      `${story.name}: an unknown case opens nothing`,
    );
  }
  assert.ok(cases >= 18 && cells > 200, `${cases} cases, ${cells} cells`);
});

const AR_LIMITED = new URL('../audit/ar-limited/frozen/', import.meta.url),
  AR_SCOPE = new URL('../audit/ar-scope-details/fixtures/', import.meta.url);
const bufferOf = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

// A receivables case as the files hold it: each source the thread draws is a
// row of its record, every cell under the header row the test finds in the
// file itself (the first row, or the row after the DETAILS marker of a scope
// block), and a pair the engine matched names one document in both records.
function arHeldToFiles(
  result: ArResult,
  files: string[][][],
  what: string,
): { cases: number; cells: number; pairs: string[][] } {
  let cells = 0;
  const pairs: string[][] = [];
  const headerOf = (side: number) => {
    const file = files[side],
      details = file.findIndex((r) => r[0] === 'DETAILS');
    return details >= 0 ? details + 1 : 0;
  };
  result.cases.forEach((c, i) => {
    const thread = arThread(result, i),
      at = `${what} case ${i}`;
    assert.deepEqual(
      thread.map((s) => [s.source, 'row' in s.place ? s.place.row : 0]),
      c.ids.map((id) => {
        const r = result.rows.find((row) => row.id === id)!;
        return [r.side, r.row];
      }),
      `${at}: one source per member, in the case's order`,
    );
    for (const s of thread) {
      assert.equal(s.role, result.sources[s.source].role, `${at}: role`);
      assert.equal(s.name, result.sources[s.source].name, `${at}: the file`);
      assert.equal(s.sheet, result.sources[s.source].sheet, `${at}: sheet`);
      assert.ok('row' in s.place, `${at}: a row`);
      const file = files[s.source],
        header = file[headerOf(s.source)],
        row = file[s.place.row - 1];
      assert.ok(row && s.place.row - 1 > headerOf(s.source), `${at}: a row`);
      assert.equal(s.cells?.length, row.length, `${at}: every cell`);
      s.cells!.forEach((cell, j) => {
        assert.equal(cell.column, j + 1, `${at}: column`);
        assert.equal(cell.text, row[j], `${at}: cell text`);
        assert.equal(cell.field, header[j], `${at}: header`);
        cells++;
      });
    }
    if (c.status === 'matched' && c.kind !== 'scope') {
      // The two members name one document, as the files write it.
      const named = thread.map((s) => {
        const file = files[s.source],
          header = file[headerOf(s.source)],
          row = file[s.place && 'row' in s.place ? s.place.row - 1 : 0];
        return [
          row[header.indexOf('Document type')],
          row[header.indexOf('Own document number')],
        ].join(' ');
      });
      assert.deepEqual(
        thread.map((s) => s.source).sort((a, b) => a - b),
        [0, 1],
        `${at}: a pair, one movement from each record`,
      );
      assert.equal(named[0], named[1], `${at}: one document in both`);
      pairs.push(thread.map((s) => String('row' in s.place && s.place.row)));
    }
  });
  assert.deepEqual(
    arThread(result, result.cases.length),
    [],
    `${what}: an unknown case opens nothing`,
  );
  return { cases: result.cases.length, cells, pairs };
}

void test('a receivables case opens each movement the engine put in it, from either record, every cell under its header as the files have it', async () => {
  let cases = 0,
    cells = 0,
    matched = 0;
  const sealed = JSON.parse(
    await readFile(new URL('expected.json', AR_LIMITED), 'utf8'),
  ) as {
    cases: {
      name: string;
      requiredPairs: number[][];
      automaticPairCount: number;
    }[];
  };
  for (const c of sealed.cases) {
    const bytes = await Promise.all(
      ['ledger', 'statement'].map((side) =>
        readFile(new URL(`${c.name}-${side}.csv`, AR_LIMITED)),
      ),
    );
    const input: ArInput = {
      files: (await Promise.all(
        bytes.map((b, side) =>
          readSource(`${c.name}-${side}.csv`, bufferOf(b)),
        ),
      )) as ArInput['files'],
      readings: arDemoReadings,
      scope: arDemoScope,
      events: [],
    };
    const result = reconcileAr(input),
      files = bytes.map((b) => csv(bufferOf(b)));
    const held = arHeldToFiles(result, files, c.name);
    // The matched pairs are the sealed ones, by row in each record.
    assert.deepEqual(
      held.pairs.map((p) => p.join(':')).sort(),
      c.requiredPairs.map((p) => p.join(':')).sort(),
      `${c.name}: the sealed pairs`,
    );
    assert.equal(held.pairs.length, c.automaticPairCount, c.name);
    cases += held.cases;
    cells += held.cells;
    matched += held.pairs.length;
  }
  // The scope-and-details family, in each sealed bundle written as CSV.
  const truths = JSON.parse(
    await readFile(new URL('TRUTHS.json', AR_SCOPE), 'utf8'),
  ) as Record<string, { expected: { matchedPairCount?: number } }>;
  let bundles = 0;
  for (const entry of await readdir(AR_SCOPE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = new URL(`${entry.name}/`, AR_SCOPE),
      bundle = JSON.parse(await readFile(new URL('bundle.json', root), 'utf8'));
    if (!bundle.files.every((f: string) => f.endsWith('.csv'))) continue;
    const bytes = await Promise.all(
      bundle.files.map((f: string) => readFile(new URL(f, root))),
    );
    const files = await Promise.all(
      bundle.files.map((f: string, side: number) =>
        readArFile(
          f,
          bufferOf(bytes[side]),
          bundle.families[side] === 'ar-scope-details-1'
            ? ({
                family: 'ar-scope-details-1',
                sheet: bundle.sheets[side],
              } as ArReading)
            : undefined,
        ),
      ),
    );
    const readings = files.map((file, side) => {
      if (bundle.families[side] !== 'ar-scope-details-1')
        return {
          ...arDemoReadings[side as 0 | 1],
          sheet: bundle.sheets[side],
          confirmed: bundle.readingConfirmed[side],
        };
      const reading = suggestArScopeReading(
        file,
        side as 0 | 1,
        bundle.sheets[side],
      );
      reading.confirmed = bundle.readingConfirmed[side];
      if (bundle.selectedAmountHeaders)
        reading.amount = file.sheets[reading.sheet].rows[
          reading.header
        ].indexOf(bundle.selectedAmountHeaders[side]);
      return reading;
    });
    const result = reconcileAr({
      files: files as ArInput['files'],
      readings: readings as ArInput['readings'],
      scope: bundle.scope,
      events: [],
    });
    const held = arHeldToFiles(
      result,
      bytes.map((b) => csv(bufferOf(b))),
      entry.name,
    );
    const truth = truths[entry.name]?.expected.matchedPairCount;
    if (truth !== undefined)
      assert.equal(held.pairs.length, truth, `${entry.name}: sealed pairs`);
    cases += held.cases;
    cells += held.cells;
    matched += held.pairs.length;
    bundles++;
  }
  assert.ok(
    bundles >= 68 && cases >= 97 && matched >= 37 && cells >= 1335,
    `${bundles} bundles, ${cases} cases, ${matched} pairs, ${cells} cells`,
  );
});

void test('a line of a printed customer statement opens its page and line, and says its cells are not kept', () => {
  const result = {
    sources: [
      { hash: 'a', name: 'ledger.csv', sheet: 'CSV', role: 'company-ar-ledger' },
      {
        hash: 'b',
        name: 'statement.pdf',
        sheet: 'PDF',
        role: 'company-issued-customer-statement',
      },
    ],
    readings: [arDemoReadings[0], { family: 'ar-statement-pdf-1' }],
    rows: [
      { id: 'l', side: 0, row: 2 },
      { id: 'p', side: 1, row: 7, pdf: { page: 2, line: 4, items: [9, 10] } },
    ],
    inventory: [
      { side: 0, row: 1, kind: 'header', values: ['Posting ID', 'Kind'] },
      { side: 0, row: 2, kind: 'movement', values: ['L001', 'invoice'] },
      { side: 1, row: 7, kind: 'movement', values: ['INV-1 100.00'] },
    ],
    cases: [{ id: 'c', ids: ['p', 'l'] }],
  } as unknown as ArResult;
  assert.deepEqual(arThread(result, 0), [
    {
      source: 1,
      role: 'company-issued-customer-statement',
      name: 'statement.pdf',
      sheet: null,
      place: { page: 2, line: 4 },
      cells: null,
    },
    {
      source: 0,
      role: 'company-ar-ledger',
      name: 'ledger.csv',
      sheet: 'CSV',
      place: { row: 2 },
      cells: [
        { column: 1, field: 'Posting ID', text: 'L001' },
        { column: 2, field: 'Kind', text: 'invoice' },
      ],
    },
  ]);
  assert.deepEqual(arThread(result, 1), []);
});

const FINANCIAL_ROLES = [
  'trial-balance',
  'proposed-mapping',
  'presentation-evidence',
  'financial-position',
];

// The text of a thread source's cell under one header, as the thread shows it.
const cellOf = (s: Thread[number], field: string) =>
  s.cells?.find((c) => c.field === field)?.text;

void test('a line of the financial position opens its statement row, then the account, mapping and evidence rows of each member, as the files have them', async () => {
  let cases = 0,
    lines = 0,
    sealed = 0,
    members = 0,
    several = 0,
    none = 0,
    cells = 0;
  for (const c of financialTruth.cases) {
    if (c.reject) continue;
    const { state, result } = await finishedFinancial(c.name);
    cases++;
    const facts = c.financialFacts;
    result.lines.forEach((line, i) => {
      const thread = financialThread(result, i),
        what = `${c.name} line ${line.lineId}`,
        places = thread.map((s) => [
          s.source,
          'row' in s.place ? s.place.row : 0,
        ]);
      heldToSources(thread, state.files, FINANCIAL_ROLES, what);
      for (const s of thread)
        assert.equal(
          s.sheet,
          state.files[s.source].sheets[0].name,
          `${what}: sheet`,
        );
      // The line's own row first, then three rows for each member, in the
      // engine's order: what the files say at those rows names the line and
      // each member, account, mapping and evidence alike.
      assert.equal(thread.length, 1 + 3 * line.members.length, what);
      assert.deepEqual(places[0], [3, line.row], `${what}: the line's row`);
      assert.equal(cellOf(thread[0], 'Line ID'), line.lineId, what);
      line.members.forEach((m, k) => {
        const [account, mapping, proof] = thread.slice(1 + 3 * k, 4 + 3 * k);
        assert.deepEqual(
          [account.source, mapping.source, proof.source],
          [0, 1, 2],
          `${what}: member ${m.mappingId} sources`,
        );
        assert.equal(cellOf(account, 'Account ID'), m.account, what);
        assert.equal(cellOf(account, 'Complete dimensions'), m.dimensions, what);
        assert.equal(cellOf(mapping, 'Mapping ID'), m.mappingId, what);
        assert.equal(cellOf(mapping, 'Line ID'), line.lineId, what);
        assert.equal(cellOf(mapping, 'Evidence ID'), m.evidenceId, what);
        assert.equal(cellOf(proof, 'Evidence ID'), m.evidenceId, what);
        members++;
      });
      // Where the case is sealed with its facts, the rows are the sealed
      // ones, found without the engine.
      const truth = facts?.lines.find((l) => l.id === line.lineId);
      if (truth) {
        assert.deepEqual(
          places,
          [
            [3, truth.row],
            ...truth.members.flatMap((m) => [
              [0, m.accountRow],
              [1, m.mappingRow],
              [2, m.evidenceRow],
            ]),
          ],
          `${what}: the sealed rows`,
        );
        sealed++;
      }
      if (line.members.length > 1) several++;
      if (!line.members.length) none++;
      cells += thread.reduce((n, s) => n + (s.cells?.length ?? 0), 0);
      lines++;
    });
    if (facts)
      assert.equal(
        result.lines.length,
        facts.lines.length,
        `${c.name}: every sealed line`,
      );
    assert.deepEqual(
      financialThread(result, result.lines.length),
      [],
      `${c.name}: an unknown line opens nothing`,
    );
  }
  // As measured on the frozen set: lines of one, two and three members, and
  // lines of a blocked case whose members the engine could not name.
  assert.ok(
    cases >= 57 &&
      lines >= 336 &&
      sealed >= 120 &&
      members >= 368 &&
      several >= 53 &&
      none >= 22 &&
      cells >= 27_088,
    `${cases} cases, ${lines} lines (${sealed} sealed, ${several} of several members, ${none} of none), ${members} members, ${cells} cells`,
  );
});

const IC_ROLES = [
  'left-ledger',
  'right-ledger',
  'relationship-evidence',
  'timing-evidence',
];

void test('an intercompany pair opens its relationship row, then every ledger row it names and its timing evidence, as the files have them', async () => {
  let cases = 0,
    pairs = 0,
    sealed = 0,
    oneSided = 0,
    timed = 0,
    doubled = 0,
    cells = 0;
  for (const c of intercompanyTruth.cases) {
    if (c.reject) continue;
    const { state, result } = await finishedIntercompany(c.name);
    cases++;
    const facts = c.financialFacts;
    result.pairs.forEach((pair, i) => {
      const thread = intercompanyThread(result, i),
        what = `${c.name} pair ${pair.relationId}`,
        places = thread.map((s) => [
          s.source,
          'row' in s.place ? s.place.row : 0,
        ]);
      heldToSources(
        thread,
        state.files,
        IC_ROLES,
        what,
        (column) => `Column ${column}`,
      );
      for (const s of thread)
        assert.equal(
          s.sheet,
          state.files[s.source].sheets[0].name,
          `${what}: sheet`,
        );
      // The relationship row first, then the ledger rows, then the timing
      // evidence, each as the engine lists them; what the files hold at
      // those rows names the pair and the transactions it pairs.
      assert.equal(
        thread.length,
        1 + pair.members.length + pair.timing.length,
        what,
      );
      const [relation] = thread,
        ledger = thread.slice(1, 1 + pair.members.length),
        timing = thread.slice(1 + pair.members.length);
      assert.equal(relation.source, 2, `${what}: the relationship first`);
      assert.equal(cellOf(relation, 'Relation ID'), pair.relationId, what);
      for (const s of ledger)
        assert.equal(
          cellOf(s, 'Transaction ID'),
          cellOf(
            relation,
            s.source === 0 ? 'Left transaction ID' : 'Right transaction ID',
          ),
          `${what}: the ledger row the relationship names`,
        );
      for (const s of timing) assert.equal(s.source, 3, `${what}: timing`);
      // Where the case is sealed with its facts, the rows are the sealed
      // ones, found without the engine.
      const truth = facts?.groups.find((g) => g.id === pair.relationId);
      if (truth) {
        assert.deepEqual(
          places,
          [
            [2, truth.relationRow],
            ...(truth.left ? [[0, truth.left.row]] : []),
            ...(truth.right ? [[1, truth.right.row]] : []),
            ...truth.timing.map((t) => [3, t.row]),
          ],
          `${what}: the sealed rows`,
        );
        sealed++;
      }
      if (!pair.left || !pair.right) oneSided++;
      if (pair.timing.length) timed++;
      if (pair.members.length > 2) doubled++;
      cells += thread.reduce((n, s) => n + (s.cells?.length ?? 0), 0);
      pairs++;
    });
    if (facts)
      assert.equal(
        result.pairs.length,
        facts.groups.length,
        `${c.name}: every sealed pair`,
      );
    assert.deepEqual(
      intercompanyThread(result, result.pairs.length),
      [],
      `${c.name}: an unknown pair opens nothing`,
    );
  }
  // As measured on the frozen set: pairs missing one side, pairs with timing
  // evidence, and pairs whose transaction is written twice in one ledger
  // (duplicate-left-entry, malformed-duplicate-contender), whose thread
  // draws both rows.
  assert.ok(
    cases >= 71 &&
      pairs >= 203 &&
      sealed >= 76 &&
      oneSided >= 35 &&
      timed >= 8 &&
      doubled >= 2 &&
      cells >= 13_567,
    `${cases} cases, ${pairs} pairs (${sealed} sealed, ${oneSided} one-sided, ${timed} with timing evidence, ${doubled} with a transaction written twice), ${cells} cells`,
  );
});

const PG_ROLES = ['transactions', 'fee-evidence', 'settlement', 'payout'];

void test('a payment gateway batch opens, from its totals, the transaction and fee rows they sum, and from its residuals every row of the batch, as the files have them', async () => {
  let cases = 0,
    totals = 0,
    residuals = 0,
    sealed = 0,
    rows = 0,
    cells = 0;
  for (const c of gatewayTruth.cases) {
    // The one case the engine refuses outright has no table to open.
    if (c.status.startsWith('throws:')) continue;
    const state = await gatewayFixture(c.name),
      result = reconcileGateway(state);
    cases++;
    const tables: [GatewayTable, number[] | null, number[]][] = [
      ['totals', result.totals, [0, 1]],
      ['residuals', result.residuals, [0, 1, 2, 3]],
    ];
    for (const [table, shown, from] of tables) {
      if (!shown) continue;
      const thread = gatewayThread(result, table),
        what = `${c.name} ${table}`;
      heldToSources(thread, state.files, PG_ROLES, what);
      for (const s of thread)
        assert.equal(
          s.sheet,
          state.files[s.source].sheets[0].name,
          `${what}: sheet`,
        );
      // The rows, worked out from the files here: each row under the header
      // that holds any text, of each source the table draws on, in source
      // order and then in row order.
      assert.deepEqual(
        thread.map((s) => [s.source, 'row' in s.place ? s.place.row : 0]),
        from.flatMap((source) =>
          csv(state.files[source].original!).flatMap((row, i) =>
            i > 0 && row.some((v) => v.trim()) ? [[source, i + 1]] : [],
          ),
        ),
        `${what}: the rows`,
      );
      // Where the case is sealed, each row's cells are the sealed ones.
      if (c.expected) {
        for (const s of thread) {
          const row = 'row' in s.place ? s.place.row : 0;
          assert.deepEqual(
            s.cells,
            c.expected.cells
              .filter((e) => e.source === s.source && e.row === row)
              .map(({ column, field, text }) => ({ column, field, text })),
            `${what}: the sealed cells of row ${row}`,
          );
        }
        sealed++;
      }
      if (table === 'totals') totals++;
      else residuals++;
      rows += thread.length;
      cells += thread.reduce((n, s) => n + (s.cells?.length ?? 0), 0);
    }
  }
  // As measured on the frozen set: two cases have totals and no residuals
  // (a source missing), and the cases in source error have neither.
  assert.ok(
    cases >= 42 &&
      totals >= 21 &&
      residuals >= 19 &&
      sealed >= 40 &&
      rows >= 204 &&
      cells >= 3_770,
    `${cases} cases, ${totals} totals and ${residuals} residuals shown (${sealed} sealed), ${rows} rows, ${cells} cells`,
  );
});

// The supplier stories this test writes: invoices, a payment and a credit
// note on the statement, the ledger with some of them, one at another amount
// and one of its own, each file in its own order, some with a title row
// above the header. Synthetic only.
function supplierStory(k: number) {
  const rows = (side: 'supplier' | 'ledger') => {
    const out: string[][] = [];
    for (let i = 1; i <= 6 + (k % 5); i++) {
      if (side === 'ledger' && i % 4 === 0) continue;
      const amount = side === 'ledger' && i === 3 ? 100 * i + 7 : 100 * i;
      out.push([
        `2026-08-${String(2 + i).padStart(2, '0')}`,
        `INV-${k}-${i}`,
        `Synthetic invoice ${i}`,
        `${amount.toLocaleString('en-US')}.00`,
      ]);
    }
    out.push(
      side === 'supplier'
        ? ['2026-08-20', `PAY-${k}`, 'Synthetic payment', '-150.00']
        : ['2026-08-21', `LOCAL-${k}`, 'Ledger only accrual', '75.00'],
    );
    if (side === 'supplier' && k % 2)
      out.push(['2026-08-22', `CN-${k}`, 'Synthetic credit note', '-40.00']);
    return k % 3 ? out.reverse() : out;
  };
  const header = ['Date', 'Reference', 'Description', 'Amount'];
  const titled = k % 4 === 1;
  return (['supplier', 'ledger'] as const).map((side) => ({
    side,
    titled,
    text:
      [
        ...(titled ? [[`Synthetic ${side} statement ${k}`, '', '', '']] : []),
        header,
        ...rows(side),
      ]
        .map((r) => r.map((v) => (v.includes(',') ? `"${v}"` : v)).join(','))
        .join('\n') + '\n',
  }));
}
const SUPPLIER_ROLES = ['supplier', 'ledger'];
/** Every source of a supplier thread against the files read here: the
 * case's traced rows, in order, each with every cell of its row in the file
 * under the header row of its reading. */
function supplierHeld(
  thread: Thread,
  result: ReturnType<typeof compare>,
  rows: readonly (readonly string[][])[],
  headerRows: readonly number[],
  id: string,
  what: string,
  names: readonly string[],
) {
  const found = result.cases.find((c) =>
    c.sourceTrace.some((t) => t.sourceRowId === id),
  )!;
  assert.deepEqual(
    thread.map((s) => [s.source, 'row' in s.place ? s.place.row : 0]),
    found.sourceTrace.map((t) => [t.side === 'supplier' ? 0 : 1, t.row]),
    `${what}: the case's rows, in its order`,
  );
  let cells = 0;
  for (const s of thread) {
    assert.equal(s.role, SUPPLIER_ROLES[s.source], `${what}: role`);
    assert.equal(s.name, names[s.source], `${what}: the file`);
    assert.ok('row' in s.place && s.cells, `${what}: cells drawn`);
    const file = rows[s.source],
      line = file[s.place.row - 1],
      header = file[headerRows[s.source]];
    assert.deepEqual(
      s.cells,
      line.map((text, i) => ({ column: i + 1, field: header[i] ?? '', text })),
      `${what}: row ${s.place.row} of the ${s.role} as the file has it`,
    );
    cells += s.cells.length;
  }
  return cells;
}

void test('a supplier result row opens every row the engine traced for its case, as the files have them, and none of a file it was not computed from', async () => {
  // The example: files held in the page without a SHA-256, drawn by the
  // sheet fingerprint the engine records instead.
  const scope = { ...demoScope, confirmed: true, coverageConfirmed: true };
  const demo = compare(
    normalizeSource(demoFiles[0], demoMappings[0], scope, 'supplier'),
    normalizeSource(demoFiles[1], demoMappings[1], scope, 'ledger'),
    scope,
  );
  let rowsOpened = 0,
    cells = 0,
    stories = 0,
    grouped = 0;
  for (const tx of [
    ...demo.supplier.transactions,
    ...demo.ledger.transactions,
  ]) {
    const thread = supplierThread(demo, demoFiles, tx.id);
    cells += supplierHeld(
      thread,
      demo,
      demoFiles.map((f) => f.sheets[0].rows),
      [0, 0],
      tx.id,
      `example ${tx.side} ${tx.row}`,
      demoFiles.map((f) => f.name),
    );
    rowsOpened++;
  }
  assert.deepEqual(supplierThread(demo, demoFiles, 'no-such-row'), []);
  // Stories written here as CSV bytes, read by the application's reader
  // and by this test's own.
  for (let k = 0; k < 24; k++) {
    const story = supplierStory(k);
    const files = await Promise.all(
      story.map((f) =>
        readSource(
          `${f.side}-${k}.csv`,
          new TextEncoder().encode(f.text).buffer as ArrayBuffer,
        ),
      ),
    );
    const headerRows = story.map((f) => (f.titled ? 1 : 0));
    const read = files.map((file, i) =>
      normalizeSource(
        file,
        inferMapping(file, 0, headerRows[i]),
        scope,
        story[i].side,
      ),
    );
    const result = compare(read[0], read[1], scope);
    const rows = story.map((f) => csv(new TextEncoder().encode(f.text).buffer as ArrayBuffer));
    assert.ok(
      result.supplier.transactions.length >= 7 &&
        result.ledger.transactions.length >= 5,
      `story ${k}: rows read`,
    );
    for (const tx of [
      ...result.supplier.transactions,
      ...result.ledger.transactions,
    ]) {
      const thread = supplierThread(result, files, tx.id);
      cells += supplierHeld(
        thread,
        result,
        rows,
        headerRows,
        tx.id,
        `story ${k} ${tx.side} ${tx.row}`,
        files.map((f) => f.name),
      );
      if (thread.length > 1) grouped++;
      rowsOpened++;
    }
    // A file the result was not computed from draws no cells: the ledger
    // with one cell changed under the same name, or under another name.
    const id = result.supplier.transactions[0].id;
    const changed = await readSource(
      `ledger-${k}.csv`,
      new TextEncoder().encode(story[1].text.replace('Ledger only', 'Ledger-only'))
        .buffer as ArrayBuffer,
    );
    const renamed = { ...files[1], name: `other-${k}.csv` };
    for (const [other, why] of [
      [changed, 'changed'],
      [renamed, 'renamed'],
    ] as const) {
      const drawn = supplierThread(result, [files[0], other], id);
      for (const s of drawn)
        assert.equal(
          s.cells === null,
          s.source === 1,
          `story ${k}: the ${why} ledger draws no cells, the statement does`,
        );
    }
    stories++;
  }
  // As measured: the example's 14 rows and the stories', 304 of them in a
  // case of more than one row.
  assert.ok(
    stories >= 24 && rowsOpened >= 416 && grouped >= 304 && cells >= 2_954,
    `${stories} stories, ${rowsOpened} rows opened (${grouped} with more than one row), ${cells} cells`,
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

// The row of a TB page that names its columns, found here from the file as
// this test reads it: the first row after the page's start row with more
// than two cells, trailing empty cells aside.
function tbColumns(rows: string[][], row: number): string[] {
  const trim = (v: string) => v.replace(/^ +| +$/g, '');
  const wide = (r: string[]) => {
    let n = r.length;
    while (n && !trim(r[n - 1])) n--;
    return n;
  };
  let start = row - 1;
  while (start > 0 && trim(rows[start][0] ?? '') !== 'Page') start--;
  const head = rows.slice(start + 1, row - 1).find((r) => wide(r) > 2);
  assert.ok(head, `the page above row ${row} names its columns`);
  return head.map(trim);
}

void test('a GL sections and TB pages account opens the row of each GL section and each TB row the engine read for it, as the files have them, and none of a file it was not computed from', async () => {
  const trim = (v: string) => v.replace(/^ +| +$/g, '');
  let stories = 0,
    accounts = 0,
    sections = 0,
    tbRows = 0,
    cells = 0,
    both = 0;
  for (const dir of [
    'audit/gl-tb-sections-foundation/frozen',
    'audit/gl-tb-sections-holdout-h1/frozen',
  ]) {
    const sids = (await readdir(dir))
      .filter((n) => n.endsWith('-scope.json'))
      .map((n) => n.slice(0, -'-scope.json'.length))
      .sort();
    for (const sid of sids) {
      const bytes = await Promise.all(
        ['gl', 'tb'].map(async (role) => {
          const b = await readFile(`${dir}/${sid}-${role}.csv`);
          return b.buffer.slice(
            b.byteOffset,
            b.byteOffset + b.byteLength,
          ) as ArrayBuffer;
        }),
      );
      const files = await Promise.all(
        bytes.map((b, i) => readSource(`${sid}-${['gl', 'tb'][i]}.csv`, b)),
      );
      const labels = JSON.parse(
        await readFile(`${dir}/${sid}-scope.json`, 'utf8'),
      ) as Record<string, string>;
      const scope = {
        ...Object.fromEntries(
          GLS_SCOPE_FIELDS.map((k, i) => [k, labels[GLS_PAGE_LABELS[i]]]),
        ),
        confirmed: true,
      } as GlsScope;
      const result = reconcileGlTbSections({
        files: [files[0], files[1]],
        readings: [
          { sheet: 0, role: 'gl-sections', family: GLS_VERSION, confirmed: true },
          { sheet: 0, role: 'tb-pages', family: GLS_VERSION, confirmed: true },
        ],
        scope,
      });
      const rows = bytes.map((b) => csv(b));
      for (const [i, account] of result.accounts.entries()) {
        const thread = glTbSectionsThread(result, files, i);
        const what = `${sid} ${account.key}`;
        assert.equal(
          thread.length,
          account.sections.length + account.rows.length,
          `${what}: each section and TB row the engine read`,
        );
        for (const [k, s] of thread.entries()) {
          const gl = k < account.sections.length,
            source = gl ? 0 : 1,
            row = gl
              ? account.sections[k].row
              : account.rows[k - account.sections.length].row;
          assert.equal(s.source, source, `${what}: the source`);
          assert.equal(s.role, ['gl-sections', 'tb-pages'][source]);
          assert.equal(s.name, files[source].name, `${what}: the file`);
          assert.equal(s.sheet, 'CSV', `${what}: the sheet`);
          assert.deepEqual(s.place, { row }, `${what}: the row`);
          const line = rows[source][row - 1];
          assert.deepEqual(
            s.cells,
            line.map((text, n) => ({ column: n + 1, field: '', text })),
            `${what}: row ${row} as the file has it`,
          );
          // The row is what the engine says it is, read here on its own: a
          // section's opening row with its id, or the account's TB row.
          if (gl) {
            assert.equal(trim(line[0]), 'Section', `${what}: a section`);
            assert.equal(
              trim(line[1]),
              account.sections[k].id ?? trim(line[1]),
              `${what}: the section's id`,
            );
            sections++;
          } else {
            const head = tbColumns(rows[1], row);
            assert.equal(
              trim(line[head.indexOf('Account')]),
              account.account,
              `${what}: the TB row of the account`,
            );
            assert.equal(
              trim(line[head.indexOf('Complete dimensions')]),
              account.dimensions,
              `${what}: the TB row of its dimensions`,
            );
            tbRows++;
          }
          cells += s.cells?.length ?? 0;
        }
        if (account.sections.length && account.rows.length) both++;
        accounts++;
      }
      assert.deepEqual(
        glTbSectionsThread(result, files, result.accounts.length),
        [],
        `${sid}: no account past the last opens nothing`,
      );
      // A file the result was not computed from draws no cells, and no
      // sheet, for its side: the TB with one byte changed.
      if (result.accounts.length) {
        const changed = await readSource(
          files[1].name,
          new TextEncoder().encode(
            new TextDecoder().decode(bytes[1]).replace(/\n?$/u, '\n\n'),
          ).buffer as ArrayBuffer,
        );
        for (const [i] of result.accounts.entries())
          for (const s of glTbSectionsThread(result, [files[0], changed], i))
            assert.equal(
              s.cells === null && s.sheet === null,
              s.source === 1,
              `${sid}: the changed TB draws its rows by place alone`,
            );
        assert.ok(
          glTbSectionsThread(result, [null, null], 0).every(
            (s) => s.cells === null && s.sheet === null,
          ),
          `${sid}: no file held, every row by its place alone`,
        );
      }
      stories++;
    }
  }
  // As measured: the 29 sealed stories and the 18 of H1.
  assert.ok(
    stories >= 47 &&
      accounts >= 325 &&
      sections >= 316 &&
      tbRows >= 317 &&
      both >= 305 &&
      cells >= 3_887,
    `${stories} stories, ${accounts} accounts, ${sections} sections, ${tbRows} TB rows, ${both} with both, ${cells} cells`,
  );
});

// The row of a payroll section that names its columns, found here from the
// file as this test reads it: the first row after the section's start row
// with more than two cells, trailing empty cells aside.
function sectionColumns(rows: string[][], row: number): string[] {
  const trim = (v: string) => v.replace(/^ +| +$/g, '');
  const wide = (r: string[]) => {
    let n = r.length;
    while (n && !trim(r[n - 1])) n--;
    return n;
  };
  let start = row - 1;
  while (start > 0 && trim(rows[start][0] ?? '') !== 'Section') start--;
  const head = rows.slice(start + 1, row - 1).find((r) => wide(r) > 2);
  assert.ok(head, `the section above row ${row} names its columns`);
  return head.map(trim);
}

void test('an employee of the long payroll register opens every row the engine read a line of it from, by its place, and no cell', async () => {
  const trim = (v: string) => v.replace(/^ +| +$/g, '');
  let stories = 0,
    employees = 0,
    rowsOpened = 0,
    sealedLines = 0;
  for (const dir of [
    'audit/payroll-long-register-foundation/frozen',
    'audit/payroll-long-register-holdout-h1/frozen',
  ]) {
    const sealed = JSON.parse(
      await readFile(`${dir}/EXPECTED.json`, 'utf8'),
    ).stories;
    for (const sid of Object.keys(sealed).sort()) {
      const raw = await readFile(`${dir}/${sid}-register.csv`);
      const bytes = new Uint8Array(raw);
      const fields = JSON.parse(
        await readFile(`${dir}/${sid}-scope.json`, 'utf8'),
      ) as Record<PlrLabel, string>;
      const result = reconcileLongRegister({
        files: [
          {
            name: `${sid}-register.csv`,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes,
          },
        ],
        readings: [{ role: PLR_ROLE, family: PLR_VERSION, confirmed: true }],
        scope: { confirmed: true, fields },
      });
      // A register the engine refuses whole (its encoding, its quoting) has
      // no employee, and is not read here either.
      const rows = result.employees.length
        ? csv(
            raw.buffer.slice(
              raw.byteOffset,
              raw.byteOffset + raw.byteLength,
            ) as ArrayBuffer,
          )
        : [];
      const want = sealed[sid].employees ?? {};
      for (const [i, e] of result.employees.entries()) {
        const what = `${sid} ${e.key}`;
        const thread = payrollRegisterThread(result, i);
        assert.deepEqual(
          thread,
          e.rows.map((row) => ({
            source: 0,
            role: PLR_ROLE,
            name: `${sid}-register.csv`,
            sheet: null,
            place: { row },
            cells: null,
          })),
          `${what}: each row the engine read for it, by its place`,
        );
        // Each row is a line of this employee, read here on its own under
        // its section's column row, in the order of the file; and an
        // employee the seal decides opens its sealed lines (the seal lists
        // them by id, the file need not: H29 writes the net line first).
        assert.ok(
          e.rows.every((row, n) => !n || row > e.rows[n - 1]),
          `${what}: its rows in the order of the file`,
        );
        const ids = e.rows.map((row) => {
          const head = sectionColumns(rows, row),
            line = rows[row - 1];
          assert.equal(
            `${trim(line[head.indexOf('Employee ID')])}|${trim(line[head.indexOf('Employee dimensions')])}`,
            e.key,
            `${what}: row ${row} is a line of the employee`,
          );
          return trim(line[head.indexOf('Line ID')]);
        });
        const sealedEmployee = want[e.key];
        if (sealedEmployee?.lines) {
          assert.deepEqual(
            [...ids].sort(),
            sealedEmployee.lines.map((l: [string]) => l[0]).sort(),
            `${what}: the sealed lines`,
          );
          sealedLines += ids.length;
        }
        rowsOpened += thread.length;
        employees++;
      }
      assert.deepEqual(
        payrollRegisterThread(result, result.employees.length),
        [],
        `${sid}: no employee past the last opens nothing`,
      );
      stories++;
    }
  }
  // Measured on the two sealed sets: 70 stories, 502 employees, 2,530
  // rows, 2,218 of them sealed lines. A floor, so a story that stops being
  // read fails here rather than passing on fewer employees.
  assert.ok(
    stories >= 70 &&
      employees >= 502 &&
      rowsOpened >= 2530 &&
      sealedLines >= 2218,
    `${stories} stories, ${employees} employees, ${rowsOpened} rows, ${sealedLines} sealed lines`,
  );
});

void test('a position of the inventory movement bridge opens every register row the engine placed under it, and a GL account its rows of the GL summary, by their place and no cell', async () => {
  const trim = (v: string) => v.replace(/^ +| +$/g, '');
  // The file's rows, read here on their own, and the columns of its first
  // row that is not blank.
  const table = (raw: Buffer) => {
    const rows = csv(
      raw.buffer.slice(
        raw.byteOffset,
        raw.byteOffset + raw.byteLength,
      ) as ArrayBuffer,
    );
    const head = rows.find((r) => r.some((v) => trim(v)));
    assert.ok(head, 'the file has a row that is not blank');
    const at = (name: string) => {
      const n = head.map(trim).indexOf(name);
      assert.ok(n >= 0, `the file has the column ${name}`);
      return n;
    };
    return { rows, at };
  };
  const thread = (name: string, source: 0 | 1, rows: number[]) =>
    rows.map((row) => ({
      source,
      role: IMB_ROLES[source],
      name,
      sheet: null,
      place: { row },
      cells: null,
    }));
  let stories = 0,
    positions = 0,
    accounts = 0,
    registerRows = 0,
    glRows = 0,
    sealedRows = 0;
  for (const dir of [
    'audit/inventory-movement-foundation/frozen',
    'audit/inventory-movement-holdout-h1/frozen',
  ]) {
    const sealed = JSON.parse(
      await readFile(`${dir}/EXPECTED.json`, 'utf8'),
    ).stories;
    for (const sid of Object.keys(sealed).sort()) {
      const names = [`${sid}-register.csv`, `${sid}-gl.csv`] as const;
      const raws = await Promise.all(names.map((n) => readFile(`${dir}/${n}`)));
      const files = raws.map((raw, i) => {
        const bytes = new Uint8Array(raw);
        return {
          name: names[i],
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes,
        };
      }) as [ImbFile, ImbFile];
      const readings = IMB_ROLES.map((role) => ({
        role,
        family: IMB_VERSION,
        confirmed: true,
      })) as [ImbReading, ImbReading];
      const fields = JSON.parse(
        await readFile(`${dir}/${sid}-scope.json`, 'utf8'),
      ) as Record<ImbScopeField, string>;
      const result = reconcileMovementBridge({
        files,
        readings,
        scope: { confirmed: true, fields },
      });
      // A file the engine refuses whole (its encoding, its quoting, its
      // columns) gives no position or account row, and is not read here.
      if (result.positions.length) {
        const register = table(raws[0]),
          item = register.at('Item ID'),
          dims = register.at('Item dimensions'),
          id = register.at('Movement ID');
        const want = sealed[sid].positions ?? {};
        for (const [i, p] of result.positions.entries()) {
          const what = `${sid} ${p.key}`;
          const opened = movementPositionThread(result, i);
          assert.deepEqual(
            opened,
            thread(names[0], 0, p.rows),
            `${what}: each register row the engine placed under it, by its place`,
          );
          assert.ok(
            p.rows.length > 0 &&
              p.rows.every((row, n) => !n || row > p.rows[n - 1]),
            `${what}: its rows, in the order of the file`,
          );
          const ids = p.rows.map((row) => {
            const line = register.rows[row - 1];
            assert.equal(
              `${trim(line[item])}|${trim(line[dims])}`,
              p.key,
              `${what}: row ${row} is a line of the position`,
            );
            return trim(line[id]);
          });
          // The seal names each position's rows and, for a position it
          // judges, its lines by id.
          const sealedPosition = want[p.key];
          if (sealedPosition) {
            assert.deepEqual(
              p.rows,
              sealedPosition.rows,
              `${what}: the sealed rows`,
            );
            if (sealedPosition.lines)
              assert.deepEqual(
                [...ids].sort(),
                sealedPosition.lines.map((l: [string]) => l[0]).sort(),
                `${what}: the sealed lines`,
              );
            sealedRows += p.rows.length;
          }
          registerRows += opened.length;
          positions++;
        }
      }
      assert.deepEqual(
        movementPositionThread(result, result.positions.length),
        [],
        `${sid}: no position past the last opens nothing`,
      );
      if (result.accounts.length) {
        // The rows of the GL summary that name each account, found here on
        // their own; a GL summary the engine refuses as a file gives none.
        const named = new Map<string, number[]>();
        if (!result.run.includes('GL_FILE')) {
          const gl = table(raws[1]),
            account = gl.at('GL account');
          for (const [n, line] of gl.rows.entries()) {
            const a = trim(line[account] ?? '');
            if (!a || a === 'GL account') continue;
            named.set(a, [...(named.get(a) ?? []), n + 1]);
          }
        }
        for (const [i, a] of result.accounts.entries()) {
          const what = `${sid} account ${a.account}`;
          const opened = movementAccountThread(result, i);
          assert.deepEqual(
            opened,
            thread(names[1], 1, a.rows),
            `${what}: each GL summary row the engine read for it, by its place`,
          );
          assert.deepEqual(
            a.rows,
            named.get(a.account) ?? [],
            `${what}: the rows of the GL summary that name it`,
          );
          glRows += opened.length;
          accounts++;
        }
      }
      assert.deepEqual(
        movementAccountThread(result, result.accounts.length),
        [],
        `${sid}: no account past the last opens nothing`,
      );
      stories++;
    }
  }
  // Measured on the two sealed sets: 79 stories, 306 positions, 152
  // accounts, 1,425 register rows, all of them sealed, and 148 GL rows. A
  // floor, so a story that stops being read fails here rather than passing
  // on fewer rows.
  assert.ok(
    stories >= 79 &&
      positions >= 306 &&
      accounts >= 152 &&
      registerRows >= 1425 &&
      glRows >= 148 &&
      sealedRows >= 1425,
    `${stories} stories, ${positions} positions, ${accounts} accounts, ${registerRows} register rows, ${glRows} GL rows, ${sealedRows} sealed rows`,
  );
});
