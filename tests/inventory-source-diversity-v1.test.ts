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
  type StockInput,
} from '../lib/reconciliation/inventory-register.ts';

// Independent source producer and checker; native inventory support is not enabled.
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
  records: { raw: Record<string, string>; citations: Record<string, Cite> }[];
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
    scope,
    readings: STOCK_ROLES.map((role) => ({
      sheet: 0,
      role,
      family: STOCK_VERSION,
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

void test('INV-1A: new native structures remain explicit product gaps under the current flat-family contract', async () => {
  const section = await replayStock(await input('INV1A-P02'));
  assert.equal(section.result.financial, 'source-error');
  assert.equal(section.result.totals, null);
  assert.equal(section.result.records[0].length, 0);
  assert.equal(
    section.result.memberIds.filter((id) => JSON.parse(id)[1] === 0).length,
    53,
    'unsupported source rows are retained, not removed to manufacture a result',
  );
  for (const id of ['INV1A-P03', 'INV1A-P04'])
    await assert.rejects(() => input(id), /STOCK_SOURCE/);
  // These assertions document the baseline gap; rejecting positive files is not
  // counted as success of the target/exploratory native import capability.
});

void test('INV-1A: malformed new section sources cannot gain financial authority by selecting the old family', async () => {
  for (const entry of corpus.cases.filter((c) => c.id.startsWith('INV1A-N'))) {
    if (entry.container === 'xlsx') {
      await assert.rejects(() => input(entry.id), /STOCK_SOURCE/);
      continue;
    }
    const current = await replayStock(await input(entry.id));
    assert.equal(current.result.financial, 'source-error');
    assert.equal(current.result.totals, null);
    assert.equal(current.result.review, 'needs-review');
    assert.ok(current.result.issues.length > 0);
  }
});
