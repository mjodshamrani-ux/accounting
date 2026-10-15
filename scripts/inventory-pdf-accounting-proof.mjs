import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  compareInventoryPdfSources,
  STOCK_FIELDS,
} from '../lib/reconciliation/inventory-register.ts';

const root = path.resolve(import.meta.dirname, '..');
const output =
  process.env.INV_PDF_ACCOUNTING_PROOF_DIR ??
  path.join(root, 'work/inventory-pdf-accounting');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-')),
  sources = path.join(out, 'sources');
const python = process.env.PYTHON ?? 'python3';
const foundation = path.join(root, 'audit/inventory-pdf-foundation');
execFileSync(
  python,
  [
    '-B',
    path.join(foundation, 'generate.py'),
    '--output-dir',
    sources,
    '--include-scope-controls',
  ],
  { timeout: 30000 },
);
const manifest = JSON.parse(
  await readFile(path.join(foundation, 'INPUT-MANIFEST.v2.json'), 'utf8'),
);
assert.equal(manifest.files.length, 81);
for (const e of manifest.files) {
  const b = await readFile(path.join(sources, e.path));
  assert.equal(b.length, e.bytes, e.path);
  assert.equal(createHash('sha256').update(b).digest('hex'), e.sha256, e.path);
}
const corpus = JSON.parse(
  await readFile(path.join(sources, 'corpus.json'), 'utf8'),
);
const readings = {};
for (const c of corpus.cases) {
  if (c.id === 'INV1F-P00') continue;
  const files = await Promise.all(
    c.files.map(async (p) => ({
      name: path.basename(p),
      original: Uint8Array.from(await readFile(path.join(sources, p))).buffer,
    })),
  );
  const values = [
    'Synthetic INV1F Owner',
    'STOCK-PDF',
    'GL-PDF',
    'KWD',
    'functional',
    'posted',
    'Current',
    '2026-10-31',
    'CHART-F',
    'MAP-F',
    'SUPPLIED-F',
    'SET-F',
  ];
  const scope = Object.fromEntries([
    ...STOCK_FIELDS.map((k, i) => [k, values[i]]),
    ['confirmed', true],
  ]);
  const comparison = await compareInventoryPdfSources({ files, scope });
  assert.equal(comparison.version, 'inventory-pdf-original-comparison-1');
  assert.equal(comparison.sources.length, 4);
  for (const [i, source] of comparison.sources.entries()) {
    assert.notEqual(source.original, files[i].original);
    assert.deepEqual(
      Buffer.from(source.original),
      Buffer.from(files[i].original),
    );
    assert.equal(
      source.sha256,
      createHash('sha256')
        .update(new Uint8Array(files[i].original))
        .digest('hex'),
    );
  }
  readings[c.id] = comparison.result;
}
const checker = path.join(
  root,
  'audit/inventory-pdf-accounting/check_result.py',
);
const verify = (file) =>
  spawnSync(python, ['-B', checker, '--root', sources, '--results', file], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
const file = path.join(out, 'readings.json');
await writeFile(file, JSON.stringify(readings));
const good = verify(file);
assert.equal(good.status, 0, good.stderr);
const report = JSON.parse(good.stdout);
const faults = [
  [
    'boolean-zero',
    (r) => {
      r['INV1F-P02'].records[0].find((r) => r.values[0] === '00').values[2] =
        false;
    },
  ],
  [
    'boolean-membership',
    (r) => {
      r['INV1F-N05'].pdfEvidence.links.find((l) => !l.supported).supported = 0;
    },
  ],
  [
    'money',
    (r) => {
      r['INV1F-P02'].records[0][0].values[5] = 189875;
    },
  ],
  [
    'quantity',
    (r) => {
      r['INV1F-P02'].records[0][0].values[2] = 125;
    },
  ],
  [
    'unit',
    (r) => {
      r['INV1F-P02'].records[0].find((r) => r.values[3] === 'G').values[3] =
        'KG';
    },
  ],
  [
    'leading-zero',
    (r) => {
      r['INV1F-P02'].records[0][0].values[0] = '8';
    },
  ],
  [
    'zero-hidden',
    (r) => {
      r['INV1F-P02'].records[0].splice(
        r['INV1F-P02'].records[0].findIndex((r) => r.values[0] === '00'),
        1,
      );
    },
  ],
  [
    'foreign-link',
    (r) => {
      const l = r['INV1F-P02'].pdfEvidence.links;
      l[0].mappingIds = l[1].mappingIds;
    },
  ],
  [
    'foreign-policy',
    (r) => {
      const l = r['INV1F-P02'].pdfEvidence.links;
      l[0].policyIds = l[1].policyIds;
    },
  ],
  [
    'foreign-gl',
    (r) => {
      const l = r['INV1F-P02'].pdfEvidence.links;
      l[0].glIds = l[1].glIds;
    },
  ],
  [
    'wrong-dimension',
    (r) => {
      r['INV1F-P02'].records[0][0].values[1] = 'warehouse=SOUTH;batch=LOT-X';
    },
  ],
  [
    'equal-total-false-ready',
    (r) => {
      r['INV1F-N04'].financial = 'ready';
    },
  ],
  [
    'hidden-total-error',
    (r) => {
      r['INV1F-N09'].totals = { registerMinor: 1285750, glMinor: 1285750 };
    },
  ],
  [
    'literal-space',
    (r) => {
      r['INV1F-P02'].pdfEvidence.literals.find(
        (l) => l.text === 'Synthetic INV1F Owner',
      ).text = 'Synthetic  INV1F Owner';
    },
  ],
  [
    'literal-offset',
    (r) => {
      r['INV1F-P02'].pdfEvidence.literals[0].start++;
    },
  ],
  [
    'glyph-space',
    (r) => {
      const t = r['INV1F-P02'].pdfEvidence.reading.source.pages[0].literals;
      t.text = t.text.replace('Synthetic INV1F Owner', 'Synthetic  INV1FOwner');
    },
  ],
  [
    'foreign-role-same-text',
    (r) => {
      const rows = r['INV1F-P01'].pdfEvidence.reading.records;
      rows.find((e) => e.page === 2).fields['Posted value'].role =
        structuredClone(rows[0].fields['Posted value'].role);
    },
  ],
  [
    'drop-unresolved',
    (r) => {
      const rows = r['INV1F-N07'].pdfEvidence.reading.inventory;
      rows.splice(
        rows.findIndex((e) => e.kind === 'unresolved'),
        1,
      );
    },
  ],
  [
    'false-approval',
    (r) => {
      r['INV1F-P02'].review = 'accepted';
    },
  ],
];
report.checkerFaults = [];
for (const [id, alter] of faults) {
  const changed = structuredClone(readings);
  alter(changed);
  assert.notEqual(
    JSON.stringify(changed),
    JSON.stringify(readings),
    id + ': mutation must change evidence',
  );
  const target = path.join(out, id + '.json');
  await writeFile(target, JSON.stringify(changed));
  const checked = verify(target);
  assert.equal(checked.status, 1, id + ': ' + checked.stderr);
  assert.match(checked.stderr, /AssertionError:/, id);
  report.checkerFaults.push({ id, detectedByAssertion: true });
}
const rewritten = path.join(out, 'valid-rewrite.json');
await writeFile(rewritten, JSON.stringify(readings, null, 2));
const accepted = verify(rewritten);
assert.equal(accepted.status, 0, accepted.stderr);
report.validRewriteAccepted = true;
await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, ...report }, null, 2));
