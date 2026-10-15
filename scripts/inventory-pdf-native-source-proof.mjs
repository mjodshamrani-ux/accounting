// G1 proves source geometry and its checker; it does not activate stock PDF.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readNativePdfSource } from '../lib/reconciliation/pdf.ts';

const root = path.resolve(import.meta.dirname, '..');
const output =
  process.env.INV_PDF_NATIVE_PROOF_DIR ??
  path.join(root, 'work/inventory-pdf-native-source');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const sources = path.join(out, 'sources');
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
  readings[c.id] = await readNativePdfSource(Uint8Array.from(b).buffer);
}
const readingsPath = path.join(out, 'readings.json');
await writeFile(readingsPath, JSON.stringify(readings));
const checker = path.join(
  root,
  'audit/inventory-pdf-native-source/check_reading.py',
);
const verify = (file) =>
  spawnSync(python, ['-B', checker, '--root', sources, '--readings', file], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
const clean = verify(readingsPath);
assert.equal(clean.status, 0, clean.stderr);
const report = JSON.parse(clean.stdout);
const token = (r, text, page = 0) =>
  r['INV1F-P02'].pages[page].tokens.find((t) => t.text === text);
const faults = [
  [
    'money-swap-same-total',
    (r) => {
      const a = token(r, '410.125'),
        b = token(r, '189.875');
      assert.ok(a && b);
      [a.text, b.text] = [b.text, a.text];
      [a.glyphText, b.glyphText] = [b.glyphText, a.glyphText];
    },
  ],
  [
    'quantity',
    (r) => {
      token(r, '1.250').text = '1.200';
    },
  ],
  [
    'dimension',
    (r) => {
      token(r, 'NORTH').text = 'SOUTH';
    },
  ],
  [
    'foreign-source-hash',
    (r) => {
      r['INV1F-P02'].sha256 = r['INV1F-P03'].sha256;
    },
  ],
  [
    'drop-last-page',
    (r) => {
      r['INV1F-P02'].pages.pop();
    },
  ],
  [
    'foreign-page',
    (r) => {
      r['INV1F-P02'].pages[1].page = 1;
    },
  ],
  [
    'wrong-position',
    (r) => {
      token(r, '410.125').x += 1;
    },
  ],
  [
    'duplicate-item',
    (r) => {
      const p = r['INV1F-P02'].pages[0];
      p.tokens[1].item = p.tokens[0].item;
    },
  ],
];
report.checkerFaults = [];
for (const [id, alter] of faults) {
  const changed = structuredClone(readings);
  alter(changed);
  const file = path.join(out, id + '.json');
  await writeFile(file, JSON.stringify(changed));
  const result = verify(file);
  assert.equal(result.status, 1, id + ': ' + result.stderr);
  assert.match(result.stderr, /AssertionError:/, id);
  report.checkerFaults.push({ id, detectedByAssertion: true });
}
// A harmless reserialization must pass, otherwise refusal is not a useful oracle.
const rewritten = path.join(out, 'rewritten.json');
await writeFile(rewritten, JSON.stringify(readings, null, 2));
const good = verify(rewritten);
assert.equal(good.status, 0, good.stderr);
report.validRewriteAccepted = true;
await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, ...report }, null, 2));
