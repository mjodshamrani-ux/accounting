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
import { readFile } from '../lib/reconciliation/io.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';
import {
  readStockFile,
  replayStock,
  saveStock,
  restoreStock,
  exportStock,
} from '../lib/reconciliation/inventory-register-io.ts';
import {
  STOCK_VERSION,
  STOCK_SECTION_FAMILY,
  STOCK_MATRIX_FAMILY,
  STOCK_VALUES,
  STOCK_FIELDS,
  STOCK_ROLES,
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';

// Frozen INV-1A input/oracle remains unchanged; its revealed target sections
// now exercise INV-1B sections and INV-1C transposed columns. Historical
// failures stay in the audit report; original sources/oracle are unchanged.
const suite = path.resolve(
  import.meta.dirname,
  '../audit/inventory-source-diversity-v1',
);
const temporary = await mkdtemp(path.join(tmpdir(), 'tarasuf-inv1a-'));
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
type OracleSource = {
  role: number;
  name: string;
  sha256: string;
  inventory: { row: number; fate: string; cells: Cite[] }[];
  records: {
    raw: Record<string, string>;
    citations: Record<string, Cite>;
    scopeCitations: Record<string, Cite>;
    quantityUnits?: number;
    postedValueMinor?: number;
  }[];
};
type Observation = {
  id: string;
  layout: string;
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
  cases: { id: string; files: string[]; layout: string; container: string }[];
};
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});
const hash = (value: ArrayBuffer) =>
  createHash('sha256').update(new Uint8Array(value)).digest('hex');
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
async function input(id: string, legacy = false): Promise<StockInput> {
  const entry = corpus.cases.find((c) => c.id === id)!;
  const files: SourceFile[] = [];
  for (const relative of entry.files) {
    const original = new Uint8Array(
      await bytes(path.join(corpusRoot, relative)),
    ).buffer;
    files.push(await readStockFile(path.basename(relative), original));
  }
  return {
    files: [files[0], files[1], files[2], files[3]],
    scope,
    readings: STOCK_ROLES.map((role, source) => ({
      sheet: 0,
      role,
      family:
        !legacy && source === 0
          ? files[0].sheets[0].rows[0]?.[1] === 'INV1A-MATRIX-1'
            ? STOCK_MATRIX_FAMILY
            : files[0].sheets[0].rows[0]?.[1] === 'INV1A-SECTIONS-1'
              ? STOCK_SECTION_FAMILY
              : STOCK_VERSION
          : STOCK_VERSION,
      confirmed: true,
    })) as StockInput['readings'],
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}

void test('INV-1A: exact serialized inputs remain the pre-evaluation sources, including layout and cell labels', async () => {
  const manifest = JSON.parse(
    await bytes(path.join(suite, 'INPUT-MANIFEST.json'), 'utf8'),
  ) as { files: { path: string; bytes: number; sha256: string }[] };
  assert.equal(
    manifest.files.length,
    49,
    '48 financial source files plus corpus index',
  );
  async function paths(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map(async (e) =>
          e.isDirectory()
            ? paths(path.join(directory, e.name))
            : [path.relative(corpusRoot, path.join(directory, e.name))],
        ),
      )
    ).flat();
  }
  assert.deepEqual(
    (await paths(corpusRoot)).sort(),
    manifest.files.map((f) => f.path).sort(),
  );
  for (const file of manifest.files) {
    const value = await bytes(path.join(corpusRoot, file.path));
    assert.equal(value.byteLength, file.bytes, file.path);
    assert.equal(
      createHash('sha256').update(value).digest('hex'),
      file.sha256,
      file.path,
    );
  }
});

void test('INV-1A: independent checker passes hand-fixed monetary, membership and citation fault controls', () => {
  const report = execFileSync(
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
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  assert.equal(typeof report, 'string');
});

void test('INV-1A: bounded source inventory has one story, three structures and four valid presentations', () => {
  assert.equal(corpus.cases.length, 12);
  assert.equal(observed.cases.length, 12);
  assert.deepEqual(
    observed.cases.filter((c) => c.financial === 'ready').map((c) => c.id),
    ['INV1A-P01', 'INV1A-P02', 'INV1A-P03', 'INV1A-P04'],
  );
  assert.equal(new Set(observed.cases.map((c) => c.layout)).size, 3);
  for (const c of observed.cases.filter((c) => c.id.startsWith('INV1A-P'))) {
    assert.deepEqual(c.totals, { registerMinor: 150000, glMinor: 150000 });
    assert.deepEqual(
      c.sources.map((s) => s.records.length),
      [4, 4, 4, 2],
    );
    assert.deepEqual(
      c.sources[0].records.map((r) => [
        r.raw['Item ID'],
        r.raw['Item dimensions'],
        r.raw['Posted value'],
      ]),
      [
        ['0007', 'warehouse=W1;batch=B01', '600.00'],
        ['0007', 'warehouse=W1;batch=B02', '400.00'],
        ['0007', 'warehouse=W2;batch=B01', '500.00'],
        ['0008', 'warehouse=W1;batch=B00', '0.00'],
      ],
    );
  }
});

void test('INV-1A: actual CSV/XLSX reader preserves every independently inspected physical cell and byte hash', async () => {
  for (const entry of corpus.cases) {
    const expected = observed.cases.find((c) => c.id === entry.id)!;
    for (let source = 0; source < 4; source++) {
      const relative = entry.files[source];
      const original = new Uint8Array(
        await bytes(path.join(corpusRoot, relative)),
      ).buffer;
      const file = await readFile(path.basename(relative), original);
      assert.deepEqual(
        file.original,
        original,
        entry.id + '/' + source + ':original',
      );
      assert.equal(file.sha256, hash(original));
      assert.equal(file.sha256, expected.sources[source].sha256);
      const rows = file.sheets[0].rows;
      assert.equal(
        rows.length,
        expected.sources[source].inventory.length,
        entry.id + '/' + source + ':rows',
      );
      for (const row of expected.sources[source].inventory) {
        assert.notEqual(
          row.fate,
          'unclassified',
          'every physical row needs an explicit fate',
        );
        for (const cell of row.cells) {
          assert.equal(
            rows[cell.row - 1][cell.column - 1],
            cell.raw,
            entry.id + '/' + source + ':' + cell.row + ':' + cell.column,
          );
        }
        assert.ok(
          rows[row.row - 1].slice(row.cells.length).every((v) => v === ''),
          'only rectangular padding may be added',
        );
      }
      assert.deepEqual(
        file.sheets[0].cellIssues ?? {},
        {},
        'fixtures use visible literal values',
      );
    }
  }
});

void test('INV-1A: canonical control succeeds with four distinct keys, an explicit zero and per-branch truth', async () => {
  const state = await input('INV1A-P01');
  const current = await replayStock(state);
  assert.equal(current.result.financial, 'ready');
  assert.equal(current.result.status, 'needs-review');
  assert.deepEqual(current.result.totals, {
    registerMinor: 150000,
    glMinor: 150000,
  });
  assert.deepEqual(
    current.result.records.map((r) => r.length),
    [4, 4, 4, 2],
  );
  assert.equal(current.result.memberIds.length, 14);
  assert.deepEqual(
    current.result.records[0].map((r) => r.values),
    [
      ['0007', 'warehouse=W1;batch=B01', 10, 'EA', 0, 60000, 'V-0007-W1-B01'],
      ['0007', 'warehouse=W1;batch=B02', 10, 'EA', 0, 40000, 'V-0007-W1-B02'],
      ['0007', 'warehouse=W2;batch=B01', 10, 'EA', 0, 50000, 'V-0007-W2-B01'],
      ['0008', 'warehouse=W1;batch=B00', 0, 'EA', 0, 0, 'V-0008-W1-B00'],
    ],
  );
  assert.deepEqual(
    current.result.comparisons.map((c) => [
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
  const restored = await restoreStock(await saveStock(state));
  assert.deepEqual(restored.result, current.result);
  assert.deepEqual(
    restored.state.files.map((f) => f.sha256),
    state.files.map((f) => f.sha256),
  );
  const workbook = await exportStock(restored.state, restored.result);
  const output = path.join(temporary, 'baseline-workpaper.xlsx');
  await writeFile(output, new Uint8Array(workbook));
  const independent = JSON.parse(
    run('check_control_export.py', [
      '--workbook',
      output,
      '--case-dir',
      path.join(corpusRoot, 'cases', 'INV1A-P01'),
    ]),
  ) as { pass: boolean };
  assert.equal(
    independent.pass,
    true,
    'independent checks cover financial cells and source evidence',
  );
  // Mutate the real synthetic exported XML; the financial checker must fail
  // for its stated invariant, not an XML error, timeout or missing dependency.
  const faults = [
    ['money', 2, 'I2', '59999', 'RECORD_VALUE', false],
    ['fraction', 2, 'I2', '60000.009', 'NONINTEGER_NUMBER', false],
    ['row-citation', 2, 'C2', '3', 'RECORD_CITATION', false],
    ['source-bytes', 14, 'H2', 'AAAA', 'ORIGINAL_BYTES', true],
    ['summary-scope', 1, 'B9', 'Synthetic alien scope', 'SUMMARY_SCOPE', true],
    ['context', 1, 'B7', '[]', 'CONTEXT', true],
  ] as const;
  for (const [name, sheet, address, value, reason, isText] of faults) {
    const archive = await JSZip.loadAsync(workbook);
    const part = `xl/worksheets/sheet${sheet}.xml`;
    const xml = await archive.file(part)!.async('string');
    const pattern = new RegExp(`<c r="${address}"[^>]*>.*?<\\/c>`);
    assert.ok(
      pattern.test(xml),
      `${name}: real exported financial/evidence cell exists`,
    );
    const cell = isText
      ? `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`
      : `<c r="${address}"><v>${value}</v></c>`;
    archive.file(part, xml.replace(pattern, cell));
    const mutant = path.join(temporary, `control-${name}.xlsx`);
    await writeFile(
      mutant,
      await archive.generateAsync({ type: 'uint8array' }),
    );
    const rejected = spawnSync(
      python,
      [
        '-B',
        path.join(suite, 'check_control_export.py'),
        '--workbook',
        mutant,
        '--case-dir',
        path.join(corpusRoot, 'cases', 'INV1A-P01'),
      ],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.equal(rejected.error, undefined, `${name}: no runner failure`);
    assert.equal(rejected.signal, null, `${name}: no termination or timeout`);
    assert.equal(
      rejected.status,
      1,
      `${name}: financial/evidence assertion rejected output`,
    );
    assert.match(rejected.stderr, /AssertionError/);
    assert.match(rejected.stderr, new RegExp(reason));
  }
});

void test('INV-1A revealed sections now prove every monetary value, dimension, policy binding and original field citation in CSV and XLSX', async () => {
  for (const id of ['INV1A-P02', 'INV1A-P03']) {
    const original = await input(id);
    const current = await replayStock(original);
    const expected = observed.cases.find((c) => c.id === id)!;
    const r = current.result;
    assert.equal(r.financial, 'ready', id);
    assert.equal(r.review, 'needs-review');
    assert.deepEqual(r.totals, expected.totals);
    assert.deepEqual(
      r.records.map((rows) => rows.length),
      [4, 4, 4, 2],
    );
    assert.deepEqual(
      r.records[0].map((record) => record.values),
      expected.sources[0].records.map((record) => [
        record.raw['Item ID'],
        record.raw['Item dimensions'],
        record.quantityUnits,
        record.raw['Unit'],
        Number(record.raw['Quantity precision']),
        record.postedValueMinor,
        record.raw['Valuation reference'],
      ]),
    );
    assert.deepEqual(
      r.comparisons.map((c) => [
        c.account,
        c.dimensions,
        c.registerMinor,
        c.debitMinor,
        c.creditMinor,
        c.glMinor,
        c.differenceMinor,
      ]),
      [
        ['INV-1', 'branch=01', 100000, 100000, 0, 100000, 0],
        ['INV-1', 'branch=02', 50000, 50000, 0, 50000, 0],
      ],
    );
    assert.deepEqual(
      r.records[0].map((record) => record.row),
      [14, 24, 34, 44],
    );
    assert.equal(r.memberIds.length, 63);
    assert.equal(r.inventory.length, 67);
    const evidence = r.sectionEvidence!;
    assert.equal(evidence.family, STOCK_SECTION_FAMILY);
    assert.equal(evidence.sourceHash, expected.sources[0].sha256);
    assert.deepEqual(
      evidence.sections.map((section) => [section.startRow, section.endRow]),
      [
        [14, 23],
        [24, 33],
        [34, 43],
        [44, 53],
      ],
    );
    for (const [index, section] of evidence.sections.entries()) {
      assert.equal(section.recordId, r.records[0][index].id);
      assert.deepEqual(
        Object.keys(section.fields).sort(),
        Object.keys(expected.sources[0].records[index].citations).sort(),
      );
      for (const [field, actual] of Object.entries(section.fields)) {
        const citation = expected.sources[0].records[index].citations[field];
        assert.deepEqual(actual, {
          sourceHash: expected.sources[0].sha256,
          sheet: 0,
          sheetName: current.state.files[0].sheets[0].name,
          row: citation.row,
          column: citation.column,
          raw: citation.raw,
        });
        assert.equal(
          current.state.files[0].sheets[0].rows[actual.row - 1][
            actual.column - 1
          ],
          actual.raw,
        );
      }
      for (const boundary of Object.values(section.boundaries))
        assert.equal(
          current.state.files[0].sheets[0].rows[boundary.row - 1][
            boundary.column - 1
          ],
          boundary.raw,
        );
    }
    for (const [index, key] of STOCK_FIELDS.entries()) {
      const actual = evidence.scope[key]!;
      assert.equal(actual.row, index + 2);
      assert.equal(actual.column, 3);
      assert.equal(actual.raw, scope[key]);
      assert.equal(actual.sourceHash, current.state.files[0].sha256);
    }
    const restored = await restoreStock(await saveStock(current.state));
    assert.deepEqual(restored.result, r);
    assert.deepEqual(
      restored.state.files.map((f) => f.original),
      original.files.map((f) => f.original),
    );
    assert.deepEqual(
      restored.state.files.map((f) => f.sha256),
      expected.sources.map((f) => f.sha256),
    );
  }
});

void test('INV-1A revealed native matrix proves literal fields, exact column ownership, separate physical members and unchanged original sources', async () => {
  const original = await input('INV1A-P04');
  const current = await replayStock(original);
  const expected = observed.cases.find((c) => c.id === 'INV1A-P04')!;
  const r = current.result;
  assert.equal(r.financial, 'ready');
  assert.equal(r.review, 'needs-review');
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.totals, expected.totals);
  assert.deepEqual(
    r.records.map((records) => records.length),
    [4, 4, 4, 2],
  );
  assert.deepEqual(
    r.records[0].map((record) => record.values),
    expected.sources[0].records.map((record) => [
      record.raw['Item ID'],
      record.raw['Item dimensions'],
      record.quantityUnits,
      record.raw['Unit'],
      Number(record.raw['Quantity precision']),
      record.postedValueMinor,
      record.raw['Valuation reference'],
    ]),
  );
  assert.deepEqual(
    r.comparisons.map((comparison) => [
      comparison.account,
      comparison.dimensions,
      comparison.registerMinor,
      comparison.glMinor,
      comparison.differenceMinor,
    ]),
    [
      ['INV-1', 'branch=01', 100000, 100000, 0],
      ['INV-1', 'branch=02', 50000, 50000, 0],
    ],
  );
  assert.deepEqual(
    r.records[0].map((record) => [record.row, record.column]),
    [
      [15, 2],
      [15, 3],
      [15, 4],
      [15, 5],
    ],
  );
  assert.deepEqual(
    r.records[0].map((record) => JSON.parse(record.id)),
    [2, 3, 4, 5].map((column) => [
      STOCK_VERSION,
      0,
      expected.sources[0].sha256,
      0,
      15,
      column,
    ]),
  );
  assert.equal(r.memberIds.length, 31);
  assert.equal(r.inventory.length, 35);
  assert.equal(r.memberIds.filter((id) => JSON.parse(id)[1] === 0).length, 21);
  for (const id of r.memberIds) assert.equal(JSON.parse(id).length, 5);
  const evidence = r.matrixEvidence!;
  assert.equal(r.sectionEvidence, undefined);
  assert.equal(evidence.family, STOCK_MATRIX_FAMILY);
  assert.equal(evidence.sourceHash, expected.sources[0].sha256);
  assert.equal(evidence.bands.length, 1);
  const band = evidence.bands[0];
  assert.equal(band.header.row, 14);
  assert.equal(band.header.column, 1);
  assert.equal(band.header.raw, 'Field');
  assert.equal(band.completedRolesAtRow, 21);
  assert.equal(band.boundary!.kind, 'report-end');
  assert.deepEqual(band.boundary!.citation, evidence.reportEnd);
  assert.equal(evidence.reportEnd!.row, 22);
  for (const [index, record] of band.records.entries()) {
    assert.equal(record.recordId, r.records[0][index].id);
    assert.equal(record.column, index + 2);
    assert.equal(record.axis.row, 14);
    assert.equal(record.axis.column, index + 2);
    assert.deepEqual(record.anchor, record.fields['Item ID'].value);
    assert.deepEqual(Object.keys(record.fields), STOCK_VALUES[0]);
    for (const [field, pair] of Object.entries(record.fields)) {
      const citation = expected.sources[0].records[index].citations[field];
      assert.deepEqual(pair.value, {
        sourceHash: expected.sources[0].sha256,
        sheet: 0,
        sheetName: current.state.files[0].sheets[0].name,
        row: citation.row,
        column: citation.column,
        raw: citation.raw,
      });
      assert.equal(pair.value.column, record.column);
      assert.equal(pair.role.row, pair.value.row);
      assert.equal(pair.role.column, 1);
      assert.equal(pair.role.raw, field);
      for (const actual of [
        pair.value,
        pair.role,
        record.axis,
        record.anchor,
      ]) {
        assert.equal(actual.sourceHash, current.state.files[0].sha256);
        assert.equal(
          current.state.files[0].sheets[0].rows[actual.row - 1][
            actual.column - 1
          ],
          actual.raw,
        );
      }
    }
  }
  for (const [index, key] of STOCK_FIELDS.entries()) {
    assert.equal(evidence.scope[key]!.row, index + 2);
    assert.equal(evidence.scope[key]!.column, 3);
    assert.equal(evidence.scope[key]!.raw, scope[key]);
    assert.equal(evidence.scope[key]!.sourceHash, expected.sources[0].sha256);
  }
  const restored = await restoreStock(await saveStock(current.state));
  assert.deepEqual(restored.result, r);
  assert.deepEqual(
    restored.state.files.map((file) => file.original),
    original.files.map((file) => file.original),
  );
  assert.deepEqual(
    restored.state.files.map((file) => file.sha256),
    expected.sources.map((file) => file.sha256),
  );
});

void test('INV-1A frozen negative sections cannot gain authority; swapped dimensions remain missing despite equal source totals', async () => {
  const required: Record<string, string> = {
    'INV1A-N01': 'MISSING_SECTION_FIELD',
    'INV1A-N02': 'ORPHAN_COMPONENT',
    'INV1A-N03': 'MISSING_COMPONENT',
    'INV1A-N04': 'DUPLICATE_COMPONENT',
    'INV1A-N06': 'SCOPE_CONFLICT',
    'INV1A-N07': 'CONTROL_MISMATCH',
    'INV1A-N08': 'DUPLICATE_MATRIX_FIELD',
  };
  for (const entry of corpus.cases.filter((c) => c.id.startsWith('INV1A-N'))) {
    const current = await replayStock(await input(entry.id));
    const expected = observed.cases.find((c) => c.id === entry.id)!;
    assert.equal(current.result.financial, expected.financial, entry.id);
    assert.equal(current.result.review, 'needs-review');
    if (entry.id === 'INV1A-N05') {
      assert.deepEqual(current.result.issues, []);
      assert.equal(
        current.result.missing.filter((key) => key.startsWith('evidence:'))
          .length,
        2,
      );
      assert.deepEqual(current.result.totals, {
        registerMinor: 60000,
        glMinor: 150000,
      });
    } else {
      assert.equal(current.result.totals, null);
      assert.ok(
        current.result.issues.some(
          (issue) => issue.code === required[entry.id],
        ),
        entry.id,
      );
      for (const c of current.result.comparisons)
        for (const k of [
          'registerMinor',
          'debitMinor',
          'creditMinor',
          'glMinor',
          'differenceMinor',
        ] as const)
          assert.equal(c[k], null);
    }
    assert.equal(
      current.result.inventory.length,
      current.state.files.reduce((n, f) => n + f.sheets[0].rows.length, 0),
    );
  }
  for (const id of ['INV1A-P02', 'INV1A-N05']) {
    const legacy = await replayStock(await input(id, true));
    assert.equal(legacy.result.financial, 'source-error');
    assert.equal(legacy.result.totals, null);
  }
  const legacyNative = await input('INV1A-P03', true);
  await assert.rejects(() => replayStock(legacyNative), /STOCK_SOURCE/);
});
