import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readInventoryPdfRegister } from '../lib/reconciliation/inventory-pdf-register.ts';

const root = path.resolve(import.meta.dirname, '..');
const output =
  process.env.INV_PDF_FIELDS_PROOF_DIR ??
  path.join(root, 'work/inventory-pdf-local-fields');
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
  const b = await readFile(path.join(sources, c.files[0]));
  readings[c.id] = await readInventoryPdfRegister(Uint8Array.from(b).buffer);
}
const checker = path.join(
  root,
  'audit/inventory-pdf-local-fields/check_reading.py',
);
const verify = (file) =>
  spawnSync(python, ['-B', checker, '--root', sources, '--readings', file], {
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
    'erase-gap-uncertainty',
    (r) => {
      const span = r['INV1F-P02'].scope.Entity.value;
      assert.equal(span.textAssembly, 'gap-presentation');
      span.textAssembly = 'adjacent-native-items';
      span.gaps = [];
    },
  ],
  [
    'money',
    (r) => {
      r['INV1F-P02'].records[0].fields['Posted value'].value.text = '189.875';
    },
  ],
  [
    'quantity',
    (r) => {
      r['INV1F-P02'].records[0].fields.Quantity.value.text = '1.200';
    },
  ],
  [
    'foreign-role-same-label',
    (r) => {
      const rows = r['INV1F-P01'].records;
      rows.find((e) => e.page === 2).fields['Posted value'].role =
        structuredClone(rows[0].fields['Posted value'].role);
    },
  ],
  [
    'foreign-parent-same-text',
    (r) => {
      const rows = r['INV1F-P03'].records;
      rows.find((e) => e.fields['Item ID'].value.text === '00').parent =
        structuredClone(rows[0].parent);
    },
  ],
  [
    'drop-unresolved-line',
    (r) => {
      const rows = r['INV1F-N07'].inventory;
      rows.splice(
        rows.findIndex((e) => e.kind === 'unresolved'),
        1,
      );
    },
  ],
  [
    'foreign-continuation-prior',
    (r) => {
      r['INV1F-P03'].records.find(
        (e) => e.incomingContinuation,
      ).incomingContinuation.prior = structuredClone(
        r['INV1F-P04'].records[0].outgoingContinuation,
      );
    },
  ],
  [
    'false-approval',
    (r) => {
      r['INV1F-P02'].financialApproval = true;
    },
  ],
  [
    'repair-wrong-total',
    (r) => {
      r['INV1F-N09'].pageControls[1].total.value.text = '189.875';
    },
  ],
];
report.checkerFaults = [];
for (const [id, alter] of faults) {
  const changed = structuredClone(readings);
  alter(changed);
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
