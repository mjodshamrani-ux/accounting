// Before-implementation capacity record. PDF rejection is a gap, not a success.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/inventory-pdf-foundation');
const outRoot =
  process.env.INV_PDF_BASELINE_DIR ??
  path.join(root, 'work/inventory-pdf-baseline');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, 'run-')),
  sources = path.join(out, 'sources');
const python = (script, args) =>
  execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, script), ...args],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
  );
python('generate.py', ['--output-dir', sources, '--include-scope-controls']);
const truth = JSON.parse(
  python('oracle.py', ['--root', sources, '--geometry']),
);
const corpus = JSON.parse(
  await readFile(path.join(sources, 'corpus.json'), 'utf8'),
);
const manifest = JSON.parse(
  await readFile(path.join(suite, 'INPUT-MANIFEST.v2.json'), 'utf8'),
);
const sha = (b) => createHash('sha256').update(b).digest('hex');
assert.equal(corpus.cases.length, 20);
assert.equal(manifest.files.length, 81);
for (const e of manifest.files) {
  const b = await readFile(path.join(sources, e.path));
  assert.equal(b.length, e.bytes, e.path);
  assert.equal(sha(b), e.sha256, e.path);
}
const { readStockFile, replayStock, saveStock, restoreStock, exportStock } =
  await import(path.join(root, 'lib/reconciliation/inventory-register-io.ts'));
const { readFile: readGeneric } = await import(
  path.join(root, 'lib/reconciliation/io.ts')
);
const { STOCK_VERSION, STOCK_ROLES } = await import(
  path.join(root, 'lib/reconciliation/inventory-register.ts')
);
const tracked = [
  'lib/reconciliation/inventory-register.ts',
  'lib/reconciliation/inventory-register-io.ts',
  'lib/reconciliation/inventory-section-native.ts',
  'audit/inventory-column-hierarchy/contract.json',
];
const before = await Promise.all(
  tracked.map(async (p) => [p, sha(await readFile(path.join(root, p)))]),
);
const report = {
  sourceHashes: Object.fromEntries(before),
  schema: 'tarasuf-inv1f-baseline/1',
  productEnabled: false,
  stories: 1,
  pdfLayoutFamilies: 2,
  pdfPositivePresentations: 4,
  pdfSources: 19,
  pdfSourceErrors: 12,
  pdfFinancialPositiveCapacity: { eligible: 4, completed: 0 },
  originals: 80,
  sealedFiles: 81,
  currentProduct: [],
  genericReads: [],
  csvControl: null,
};
for (const e of corpus.cases) {
  const expectation = truth.cases.find((c) => c.id === e.id);
  assert.ok(expectation);
  if (e.id !== 'INV1F-P00') {
    const raw = await readFile(path.join(sources, e.files[0]));
    let reason;
    try {
      await readStockFile('register.pdf', Uint8Array.from(raw).buffer);
    } catch (error) {
      reason = error.message;
    }
    assert.equal(reason, 'STOCK_SOURCE', e.id);
    report.currentProduct.push({
      id: e.id,
      stage: 'stock-read',
      error: reason,
      sourceFinancial: expectation.financial,
    });
    if (['INV1F-P01', 'INV1F-P02', 'INV1F-P03', 'INV1F-P04'].includes(e.id))
      for (const auto of [false, true]) {
        const f = await readGeneric(
          'register.pdf',
          Uint8Array.from(raw).buffer,
          undefined,
          auto,
        );
        assert.equal(f.sha256, sha(raw));
        assert.deepEqual(Buffer.from(f.original), raw);
        const physical = truth.geometry[e.id].flatMap((page, pn) =>
          page.map((line) => ({
            page: pn + 1,
            text: line.map((t) => t.raw).join(''),
          })),
        );
        if (!auto) {
          assert.equal(f.sheets[0].rows.length, physical.length, e.id);
          for (const [i, row] of f.sheets[0].rows.entries()) {
            assert.equal(
              row.join('').replace(/\s/g, ''),
              physical[i].text.replace(/\s/g, ''),
              e.id + ':raw:' + i,
            );
            assert.equal(
              f.sheets[0].rowPages[String(i + 1)],
              physical[i].page,
              e.id + ':page:' + i,
            );
          }
        }
        report.genericReads.push({
          id: e.id,
          auto,
          pages: f.pdf.pages,
          rows: f.sheets[0].rows.length,
          cuts: f.pdf.cuts,
          issueRows: Object.keys(f.sheets[0].rowIssues ?? {}).length,
          rawAndPagesVerified: !auto,
        });
      }
    continue;
  }
  const files = await Promise.all(
    e.files.map(async (p) => {
      const b = await readFile(path.join(sources, p));
      return readStockFile(path.basename(p), Uint8Array.from(b).buffer);
    }),
  );
  const scope = Object.fromEntries(
    [
      'entity',
      'inventoryLedger',
      'glLedger',
      'currency',
      'currencyBasis',
      'postingStatus',
      'postingLayer',
      'asOf',
      'chartVersion',
      'mapVersion',
      'valuationPolicyVersion',
      'inventoryAccountSetVersion',
    ].map((k, i) => [
      k,
      expectation.scope[
        [
          'Entity',
          'Inventory ledger',
          'GL ledger',
          'Currency',
          'Currency basis',
          'Posting status',
          'Posting layer',
          'As of',
          'Chart version',
          'Map version',
          'Valuation policy version',
          'Inventory account set version',
        ][i]
      ],
    ]),
  );
  const input = {
    files,
    readings: STOCK_ROLES.map((role) => ({
      role,
      sheet: 0,
      family: STOCK_VERSION,
      confirmed: true,
    })),
    scope: { ...scope, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
  const value = await replayStock(input);
  const r = value.result;
  assert.equal(r.financial, 'ready');
  assert.equal(r.review, 'needs-review');
  assert.deepEqual(r.totals, expectation.totals);
  assert.deepEqual(
    r.records[0].map((r) => r.values),
    expectation.facts.map((f) => f.values),
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
    expectation.comparisons,
  );
  for (const link of expectation.links) {
    const m = r.records[1].find((r) => r.values[0] === link.mapping);
    const p = r.records[2].find((r) => r.values[0] === link.policy);
    assert.ok(m && p);
    assert.deepEqual(m.values.slice(1, 3), link.key);
    assert.deepEqual(m.values.slice(3, 5), link.account);
    assert.deepEqual(p.values.slice(1, 3), link.key);
    assert.equal(m.values[5], p.values[0]);
    assert.equal(m.row, link.mappingRow);
    assert.equal(p.row, link.policyRow);
    const gl = r.records[3].find((g) => g.row === link.glRow);
    assert.ok(gl);
    assert.deepEqual(gl.values.slice(0, 2), link.account);
  }
  for (const [source, records] of r.records.entries())
    for (const row of records)
      assert.deepEqual(JSON.parse(row.id), [
        STOCK_VERSION,
        source,
        files[source].sha256,
        0,
        row.row,
      ]);
  assert.equal(new Set(r.memberIds).size, r.memberIds.length);
  assert.equal(r.memberIds.length, 28);
  assert.deepEqual(
    r.memberIds,
    r.records.flat().map((record) => record.id),
  );
  const restored = await restoreStock(await saveStock(value.state));
  assert.deepEqual(restored.result, r);
  const b = await exportStock(restored.state, restored.result);
  const control = path.join(out, 'CSV-CONTROL.xlsx');
  await writeFile(control, Buffer.from(b));
  const checked = JSON.parse(
    python('check_control.py', [control, path.join(sources, e.id)]),
  );
  assert.equal(checked.passed, true);
  const cases = [
    ['valid-rewrite', null, null],
    [
      'quantity',
      (w) => {
        w.getWorksheet('Register').getCell('F2').value = 1251;
      },
      'RECORD_VALUES',
    ],
    [
      'same-total-money-swap',
      (w) => {
        const s = w.getWorksheet('Register');
        [s.getCell('I2').value, s.getCell('I3').value] = [
          s.getCell('I3').value,
          s.getCell('I2').value,
        ];
      },
      'RECORD_VALUES',
    ],
    [
      'dimension',
      (w) => {
        w.getWorksheet('Register').getCell('E2').value =
          'warehouse=SOUTH;batch=LOT-X';
      },
      'RECORD_VALUES',
    ],
    [
      'foreign-policy',
      (w) => {
        w.getWorksheet('Mapping').getCell('I2').value = 'POL-F-1';
      },
      'RECORD_VALUES',
    ],
    [
      'original-substitution',
      (w) => {
        w.getWorksheet('Sources').getCell('H2').value =
          Buffer.from('foreign').toString('base64');
      },
      'SOURCE_BYTES',
    ],
  ];
  const outputControls = [];
  for (const [name, edit, reason] of cases) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(b);
    if (edit) edit(workbook);
    const candidate = path.join(out, name + '.xlsx');
    await writeFile(
      candidate,
      new Uint8Array(await workbook.xlsx.writeBuffer()),
    );
    const result = spawnSync(
      process.env.PYTHON ?? 'python3',
      [
        '-B',
        path.join(suite, 'check_control.py'),
        candidate,
        path.join(sources, e.id),
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    if (reason) {
      assert.equal(result.status, 1, name + result.stderr);
      assert.ok(
        result.stderr.includes('AssertionError') &&
          result.stderr.includes(reason),
        name + result.stderr,
      );
    } else assert.equal(result.status, 0, result.stderr);
    outputControls.push({
      name,
      expected: reason ?? 'accepted',
      assertionVerified: true,
    });
  }
  report.exportControls = outputControls;

  report.csvControl = {
    financial: r.financial,
    totals: r.totals,
    records: 7,
    links: 7,
    physicalMembers: 28,
    restoreExact: true,
    workpaper: 'CSV-CONTROL.xlsx',
    independentExport: true,
  };
}
assert.deepEqual(
  await Promise.all(
    tracked.map(async (p) => [p, sha(await readFile(path.join(root, p)))]),
  ),
  before,
);
await writeFile(
  path.join(out, 'SOURCE-TRUTH.json'),
  JSON.stringify(truth, null, 2) + '\n',
);
await writeFile(
  path.join(out, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ out, ...report }));
