import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFile as bytes,
  writeFile,
  mkdtemp,
  rm,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
  exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION,
  STOCK_ROLES,
  STOCK_VALUES,
  STOCK_FIELDS,
  STOCK_SCOPE_HEADERS,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';
import { validateWorkerValue } from '../lib/reconciliation/protocol.ts';
import type { StockSectionEvidence } from '../lib/reconciliation/inventory-section-components.ts';

const suite = path.resolve(
  import.meta.dirname,
  '../audit/inventory-section-components',
);
const temporary = await mkdtemp(path.join(tmpdir(), 'tarasuf-inv1b-'));
const corpusRoot = path.join(temporary, 'sources');
const python = process.env.PYTHON ?? 'python3';
const run = (file: string, args: string[]) =>
  execFileSync(python, ['-B', path.join(suite, file), ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
run('generate.py', ['--output-dir', corpusRoot]);
type Cite = { source: number; row: number; column: number; raw: string };
type OracleRecord = {
  sourceRow: number;
  endRow?: number;
  raw: Record<string, string>;
  citations: Record<string, Cite>;
  boundaries?: Record<string, Cite>;
  scopeCitations: Record<string, Cite>;
  quantityUnits?: number;
  postedValueMinor?: number;
};
type OracleSource = {
  role: number;
  name: string;
  sha256: string;
  sheetName: string;
  inventory: { row: number; fate: string; cells: Cite[] }[];
  records: OracleRecord[];
};
type Observation = {
  id: string;
  financial: string;
  totals: unknown;
  sources: OracleSource[];
};
const observed = JSON.parse(run('oracle.py', ['--root', corpusRoot])) as {
  cases: Observation[];
};
const corpus = JSON.parse(
  await bytes(path.join(corpusRoot, 'corpus.json'), 'utf8'),
) as {
  cases: {
    id: string;
    files: string[];
    container: string;
    producer: string;
    variant: string;
  }[];
};
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});
const scope: StockInput['scope'] = {
  entity: 'Synthetic INV1 Owner',
  inventoryLedger: 'STOCK-BOOK',
  glLedger: 'GL-BOOK',
  currency: 'SAR',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-09-30',
  chartVersion: 'CHART-INV1',
  mapVersion: 'MAP-INV1',
  valuationPolicyVersion: 'provided-posted-values-1',
  inventoryAccountSetVersion: 'INV-SET-1',
  confirmed: true,
};
const sha = (value: Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const rowID = (source: OracleSource, row: number) =>
  JSON.stringify([STOCK_VERSION, source.role, source.sha256, 0, row]);
async function input(id: string): Promise<StockInput> {
  const entry = corpus.cases.find((c) => c.id === id)!;
  const files = [];
  for (const relative of entry.files) {
    const original = new Uint8Array(
      await bytes(path.join(corpusRoot, relative)),
    ).buffer;
    files.push(await readStockFile(path.basename(relative), original));
  }
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope: { ...scope },
    readings: STOCK_ROLES.map((role, index) => ({
      sheet: 0,
      role,
      family: index === 0 ? 'inventory-section-components-1' : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
function expectedValues(record: OracleRecord, role: number) {
  return STOCK_VALUES[role].map((field) =>
    field === 'Quantity'
      ? record.quantityUnits
      : field === 'Posted value'
        ? record.postedValueMinor
        : field === 'Quantity precision'
          ? Number(record.raw[field])
          : ['Debit', 'Credit'].includes(field)
            ? money(record.raw[field])
            : record.raw[field],
  );
}
function money(raw: string) {
  const [integer, fraction = ''] = raw.split('.');
  return Number(BigInt(integer + fraction.padEnd(2, '0')));
}

void test('INV-1B: immutable pre-evaluation originals, independent producers and instrument controls', async () => {
  const manifest = JSON.parse(
    await bytes(path.join(suite, 'INPUT-MANIFEST.json'), 'utf8'),
  ) as { files: { path: string; bytes: number; sha256: string }[] };
  assert.equal(manifest.files.length, 49);
  async function paths(directory: string): Promise<string[]> {
    return (
      await Promise.all(
        (
          await readdir(directory, { withFileTypes: true })
        ).map(async (entry) =>
          entry.isDirectory()
            ? paths(path.join(directory, entry.name))
            : [path.relative(corpusRoot, path.join(directory, entry.name))],
        ),
      )
    ).flat();
  }
  assert.deepEqual(
    (await paths(corpusRoot)).sort(),
    manifest.files.map((f) => f.path).sort(),
  );
  for (const file of manifest.files) {
    const original = await bytes(path.join(corpusRoot, file.path));
    assert.equal(original.byteLength, file.bytes, file.path);
    assert.equal(sha(original), file.sha256, file.path);
  }
  assert.equal(corpus.cases.length, 12);
  assert.equal(corpus.cases.filter((c) => c.container === 'xlsx').length, 6);
  assert.deepEqual([...new Set(corpus.cases.map((c) => c.producer))].sort(), [
    'openpyxl',
    'stdlib-csv',
    'xlsxwriter',
  ]);
  execFileSync(
    python,
    [
      '-B',
      '-m',
      'unittest',
      'discover',
      '-s',
      suite,
      '-p',
      'test_oracle.py',
      '-v',
    ],
    {
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
});

void test('INV-1B: six native positive layouts prove item values, exact dimension membership, mapping and policy before/after sessions', async () => {
  for (const entry of corpus.cases.filter((c) => c.id.startsWith('INV1B-P'))) {
    const truth = observed.cases.find((c) => c.id === entry.id)!;
    const current = await replayStock(await input(entry.id));
    const r = current.result;
    assert.equal(r.financial, 'ready', entry.id);
    assert.equal(r.status, 'needs-review', 'ready cannot mean approved');
    assert.equal(r.review, 'needs-review');
    assert.deepEqual(r.totals, { registerMinor: 150000, glMinor: 150000 });
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(
      r.records.map((rows) => rows.length),
      [4, 4, 4, 2],
    );
    for (let source = 0; source < 4; source++) {
      const document = truth.sources[source];
      assert.equal(current.state.files[source].sha256, document.sha256);
      assert.equal(
        sha(new Uint8Array(current.state.files[source].original!)),
        document.sha256,
      );
      assert.deepEqual(
        r.records[source],
        document.records.map((record) => ({
          id: rowID(document, record.sourceRow),
          source,
          row: record.sourceRow,
          values: expectedValues(record, source),
        })),
        entry.id + ':source-' + source,
      );
    }
    assert.deepEqual(
      r.comparisons.map((c) => [
        c.account,
        c.dimensions,
        c.registerMinor,
        c.glMinor,
        c.differenceMinor,
      ]),
      [
        ['INV-1', 'branch=01', 100000, 100000, 0],
        ['INV-1', 'branch=02', 50000, 50000, 0],
      ],
    );
    assert.deepEqual(
      r.memberIds,
      truth.sources.flatMap((source) =>
        source.inventory
          .filter((row) => row.row > 1 && row.cells.some((c) => c.raw !== ''))
          .map((row) => rowID(source, row.row)),
      ),
      'physical scope/header/component/control/end rows cannot disappear',
    );
    assert.deepEqual(
      r.inventory,
      truth.sources.flatMap((source) =>
        source.inventory.map((row) => ({
          source: source.role,
          row: row.row,
          kind: row.fate,
        })),
      ),
    );
    const literalCells = truth.sources.flatMap((source) => {
      const width = source.name.endsWith('.xlsx')
        ? Math.max(...source.inventory.map((row) => row.cells.length))
        : null;
      const headers = source.inventory[0].cells.map((cell) => cell.raw);
      return source.inventory.flatMap((row) => {
        const raw = row.cells.map((cell) => cell.raw);
        const values =
          width === null
            ? raw
            : [...raw, ...Array<string>(width - raw.length).fill('')];
        const field = raw[0] === 'Scope' ? raw[1] : (raw[0] ?? '');
        return values.map((text, column) => ({
          source: source.role,
          row: row.row,
          column: column + 1,
          field: source.role === 0 ? field : headers[column],
          text,
        }));
      });
    });
    assert.deepEqual(r.cells, literalCells, entry.id + ':each-source-cell');
    const evidence = r.sectionEvidence;
    assert.ok(evidence, entry.id + ':section evidence exists');
    const source = truth.sources[0];
    const cite = (value: Cite) => ({
      sourceHash: source.sha256,
      sheet: 0,
      sheetName: source.sheetName,
      row: value.row,
      column: value.column,
      raw: value.raw,
    });
    assert.equal(evidence.family, 'inventory-section-components-1');
    assert.equal(evidence.sourceHash, source.sha256);
    assert.deepEqual(evidence.format, cite(source.inventory[0].cells[1]));
    assert.deepEqual(
      evidence.scope,
      Object.fromEntries(
        STOCK_FIELDS.map((key, i) => [
          key,
          cite(source.records[0].scopeCitations[STOCK_SCOPE_HEADERS[i]]),
        ]),
      ),
    );
    assert.equal(evidence.sections.length, 4);
    for (let i = 0; i < 4; i++) {
      const record = source.records[i];
      const section: StockSectionEvidence['sections'][number] =
        evidence.sections[i];
      assert.equal(section.recordId, rowID(source, record.sourceRow));
      assert.equal(section.startRow, record.sourceRow);
      assert.equal(section.endRow, record.endRow);
      assert.deepEqual(
        section.fields,
        Object.fromEntries(
          STOCK_VALUES[0].map((field) => [
            field,
            cite(record.citations[field]),
          ]),
        ),
      );
      assert.deepEqual(section.boundaries, {
        start: cite(record.boundaries!['Section']),
        end: cite(record.boundaries!['End section']),
      });
      const control = source.inventory
        .slice(record.sourceRow, record.endRow! - 1)
        .find((row) => row.cells[0]?.raw === 'Section subtotal');
      assert.deepEqual(
        section.subtotal,
        control ? cite(control.cells[1]) : undefined,
      );
    }
    const reportControl = source.inventory.find(
      (row) => row.cells[0]?.raw === 'Report total',
    );
    assert.deepEqual(
      evidence.reportTotal,
      reportControl ? cite(reportControl.cells[1]) : undefined,
    );
    validateWorkerValue('stock-reconcile', current, current.state);
    const forged = structuredClone(current);
    forged.result.records[0][0].values[1] = 'warehouse=FOREIGN;batch=OTHER';
    assert.throws(
      () => validateWorkerValue('stock-reconcile', forged, current.state),
      /STOCK_ENVELOPE/,
    );
    const foreignCitation = structuredClone(current);
    foreignCitation.result.sectionEvidence!.sections[0].fields[
      'Posted value'
    ].row = source.records[1].citations['Posted value'].row;
    assert.throws(
      () =>
        validateWorkerValue('stock-reconcile', foreignCitation, current.state),
      /STOCK_ENVELOPE/,
    );
    const restored = await restoreStock(await saveStock(current.state));
    assert.deepEqual(restored.result, r, entry.id + ':original replay');
    for (let i = 0; i < 4; i++)
      assert.deepEqual(
        restored.state.files[i].original,
        current.state.files[i].original,
      );
  }
});

void test('INV-1B: valid exports preserve native original bytes, branch money and all field/boundary citations independently', async () => {
  for (const entry of corpus.cases.filter((c) => c.id.startsWith('INV1B-P'))) {
    const current = await replayStock(await input(entry.id));
    const restored = await restoreStock(await saveStock(current.state));
    for (const [kind, value] of [
      ['direct', current],
      ['restored', restored],
    ] as const) {
      const workbook = await exportStock(value.state, value.result);
      const output = path.join(temporary, entry.id + '-' + kind + '.xlsx');
      await writeFile(output, new Uint8Array(workbook));
      const checked = JSON.parse(
        run('check_export.py', [
          '--workbook',
          output,
          '--case-dir',
          path.join(corpusRoot, 'cases', entry.id),
        ]),
      ) as { pass: boolean; logicalMembers: number; fieldCitations: number };
      assert.equal(checked.pass, true, entry.id + ':' + kind);
      assert.equal(checked.logicalMembers, 14);
      assert.equal(checked.fieldCitations, entry.id === 'INV1B-P04' ? 54 : 49);
    }
  }
});

void test('INV-1B: source-error and missing relationships cannot be concealed by a balanced global total or approved', async () => {
  for (const entry of corpus.cases.filter((c) => c.id.startsWith('INV1B-N'))) {
    const truth = observed.cases.find((c) => c.id === entry.id)!;
    const current = await replayStock(await input(entry.id));
    const r = current.result;
    assert.equal(r.financial, truth.financial, entry.id);
    assert.equal(r.review, 'needs-review');
    if (truth.financial === 'source-error') {
      assert.equal(r.totals, null);
      assert.ok(r.issues.length > 0);
      assert.ok(
        r.comparisons.every((c) =>
          Object.entries(c)
            .filter(([key]) => key.endsWith('Minor'))
            .every(([, value]) => value === null),
        ),
      );
    } else assert.ok(r.missing.length > 0);
    if (entry.id === 'INV1B-N05') {
      assert.equal(
        r.records[0].reduce(
          (total, record) => total + Number(record.values[5]),
          0,
        ),
        150000,
        'all supplied values remain visible despite bad evidence',
      );
      assert.deepEqual(
        r.totals,
        { registerMinor: 60000, glMinor: 150000 },
        'only properly evidenced original keys contribute to comparison',
      );
      assert.equal(
        r.missing.filter((value) => value.startsWith('evidence:')).length,
        2,
      );
    }
    assert.equal(
      r.inventory.filter((row) => row.source === 0).length,
      truth.sources[0].inventory.length,
    );
    const restored = await restoreStock(await saveStock(current.state));
    assert.deepEqual(restored.result, r);
    current.state.completeness = {
      confirmed: true,
      reference: 'INV1B synthetic whole scope',
      note: 'Synthetic test attestation only',
    };
    const complete = await replayStock(current.state);
    complete.state.events = [
      {
        id: 'ILLEGAL',
        type: 'accept',
        memberIds: complete.result.memberIds,
        context: complete.result.context,
        at: '2026-10-14T00:00:00.000Z',
        reference: 'Illegal synthetic approval',
        note: 'Must not accept',
      },
    ];
    await assert.rejects(
      () => replayStock(complete.state),
      /STOCK_EVENT_ACCEPT/,
    );
  }
});

void test('INV-1B: an omitted quantity cannot be filled with zero from precision or policy despite correct carrying value and GL', async () => {
  for (const wanted of ['10', '0']) {
    const state = await input('INV1B-P02');
    const rows = state.files[0].sheets[0].rows.map((row) => [...row]);
    const missing = rows.findIndex(
      (row) => row[0] === 'Quantity' && row[1] === wanted,
    );
    assert.ok(missing > 0, 'actual quantity source row exists');
    rows.splice(missing, 1);
    const source = new TextEncoder().encode(
      rows
        .map((row) =>
          row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(','),
        )
        .join('\n') + '\n',
    ).buffer;
    state.files[0] = await readStockFile('register.csv', source);
    const current = await replayStock(state);
    assert.equal(current.result.financial, 'source-error', wanted);
    assert.equal(current.result.totals, null);
    assert.ok(
      current.result.issues.some((issue) => issue.code === 'MISSING_COMPONENT'),
    );
    assert.ok(
      current.result.comparisons.every(
        (comparison) => comparison.differenceMinor === null,
      ),
    );
    assert.equal(
      current.result.inventory.filter((row) => row.source === 0).length,
      rows.length,
    );
    assert.equal(
      (await restoreStock(await saveStock(current.state))).result.financial,
      'source-error',
    );
  }
});

void test('INV-1B: complete explicit approval survives native sessions/export; old context or partial membership never does', async () => {
  for (const id of ['INV1B-P02', 'INV1B-P04']) {
    const state = await input(id);
    let current = await replayStock(state);
    current.state.events = [
      {
        id: 'EARLY',
        type: 'accept',
        memberIds: current.result.memberIds,
        context: current.result.context,
        at: '2026-10-14T00:00:00.000Z',
        reference: 'Synthetic early',
        note: 'Completeness not attested',
      },
    ];
    await assert.rejects(
      () => replayStock(current.state),
      /STOCK_EVENT_ACCEPT/,
    );
    state.completeness = {
      confirmed: true,
      reference: 'INV1B synthetic whole scope',
      note: 'Synthetic test attestation only',
    };
    current = await replayStock(state);
    state.events = [
      {
        id: 'INV1B-ACCEPT',
        type: 'accept',
        memberIds: current.result.memberIds,
        context: current.result.context,
        at: '2026-10-14T00:00:00.000Z',
        reference: 'INV1B synthetic approval',
        note: 'Synthetic reviewed proof only',
      },
    ];
    const accepted = await replayStock(state);
    assert.equal(accepted.result.review, 'accepted');
    assert.equal(accepted.result.status, 'consistent-with-evidence');
    const restored = await restoreStock(await saveStock(state));
    assert.deepEqual(restored.result, accepted.result);
    const output = path.join(temporary, id + '-accepted.xlsx');
    await writeFile(
      output,
      new Uint8Array(await exportStock(restored.state, restored.result)),
    );
    assert.equal(
      JSON.parse(
        run('check_export.py', [
          '--workbook',
          output,
          '--case-dir',
          path.join(corpusRoot, 'cases', id),
          '--accepted',
        ]),
      ).pass,
      true,
    );
    const partial = structuredClone(state);
    partial.events[0].memberIds.pop();
    await assert.rejects(() => replayStock(partial), /STOCK_EVENT_MEMBERS/);
    const foreign = await input(id === 'INV1B-P02' ? 'INV1B-P04' : 'INV1B-P02');
    foreign.completeness = structuredClone(state.completeness);
    foreign.events = structuredClone(state.events);
    await assert.rejects(() => replayStock(foreign), /STOCK_EVENT/);
    const undo = structuredClone(state);
    undo.events.push({
      ...undo.events[0],
      id: 'INV1B-UNDO',
      type: 'undo',
      at: '2026-10-14T00:00:01.000Z',
    });
    assert.equal(
      (await restoreStock(await saveStock(undo))).result.review,
      'needs-review',
    );
  }
});

void test('INV-1B: real exported financial/dimension/citation/source faults fail independently for their invariant', async () => {
  const current = await replayStock(await input('INV1B-P04'));
  const workbook = await exportStock(current.state, current.result);
  const original = await JSZip.loadAsync(workbook);
  const book = await original.file('xl/workbook.xml')!.async('string');
  const relations = await original
    .file('xl/_rels/workbook.xml.rels')!
    .async('string');
  const worksheetPart = (name: string) => {
    const sheet = book.match(
      new RegExp(`<sheet\\b[^>]*name="${name}"[^>]*r:id="([^"]+)"`),
    );
    assert.ok(sheet, name + ':worksheet');
    const relationship = relations.match(
      new RegExp(`<Relationship\\b[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`),
    );
    assert.ok(relationship, name + ':relationship');
    return path.posix.join('xl', relationship[1]);
  };
  const faults = [
    ['amount', 'Register', 'I2', '59999', 'RECORD_VALUE', false],
    ['fraction', 'Register', 'I2', '60000.001', 'NONINTEGER_NUMBER', false],
    [
      'item-dimensions',
      'Register',
      'E2',
      'warehouse=W2;batch=B01',
      'RECORD_VALUE',
      true,
    ],
    ['mapped-branch', 'Mapping', 'H2', 'branch=02', 'RECORD_VALUE', true],
    [
      'policy-valuation',
      'Policy evidence',
      'I2',
      'V-0007-W2-B01',
      'RECORD_VALUE',
      true,
    ],
    [
      'citation-position',
      'Section citations',
      'F15',
      '999',
      'SECTION_CITATIONS',
      false,
    ],
    [
      'citation-text',
      'Section citations',
      'I15',
      'wrong original text',
      'SECTION_CITATIONS',
      true,
    ],
    ['embedded-original', 'Sources', 'H2', 'AAAA', 'ORIGINAL_BYTES', true],
  ] as const;
  for (const [name, table, address, value, reason, literal] of faults) {
    const archive = await JSZip.loadAsync(workbook),
      part = worksheetPart(table);
    const xml = await archive.file(part)!.async('string'),
      pattern = new RegExp(`<c r="${address}"[^>]*>.*?<\\/c>`);
    assert.ok(pattern.test(xml), name + ':actual target cell exists');
    archive.file(
      part,
      xml.replace(
        pattern,
        literal
          ? `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`
          : `<c r="${address}"><v>${value}</v></c>`,
      ),
    );
    const mutant = path.join(temporary, 'fault-' + name + '.xlsx');
    await writeFile(
      mutant,
      await archive.generateAsync({ type: 'uint8array' }),
    );
    const rejected = spawnSync(
      python,
      [
        '-B',
        path.join(suite, 'check_export.py'),
        '--workbook',
        mutant,
        '--case-dir',
        path.join(corpusRoot, 'cases', 'INV1B-P04'),
      ],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.equal(rejected.error, undefined, name + ':no process failure');
    assert.equal(rejected.signal, null, name + ':no timeout/termination');
    assert.equal(rejected.status, 1, name + ':accounting/evidence rejection');
    assert.match(rejected.stderr, /AssertionError/);
    assert.match(rejected.stderr, new RegExp(reason));
  }
});
