import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assetThread,
  bankThread,
  allocationThread,
  arThread,
  clearingThread,
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
