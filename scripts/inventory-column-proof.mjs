import { checkColumnExportControls } from './inventory-column-export-controls.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
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
} from '../lib/reconciliation/inventory-register.ts';
import { STOCK_COLUMN_FAMILY } from '../lib/reconciliation/inventory-column-hierarchy.ts';
const root = path.resolve(import.meta.dirname, '..'),
  suite = path.join(root, 'audit/inventory-column-hierarchy'),
  outRoot =
    process.env.INV_COLUMN_PROOF_DIR ??
    path.join(root, 'work/inventory-column-proof');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, 'run-')),
  sources = path.join(out, 'sources');
const python = (file, args) =>
  execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, file), ...args],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
  );
python('generate.py', [
  '--output-dir',
  sources,
  '--include-layout-controls',
  '--negative-layout-controls',
]);
const corpus = JSON.parse(
    await readFile(path.join(sources, 'corpus.json'), 'utf8'),
  ),
  truth = JSON.parse(python('oracle.py', ['--root', sources]));
const report = {
  out,
  cases: [],
  exports: [],
  passed: false,
  exportControls: [],
};
const tracked = [
  'lib/reconciliation/inventory-column-hierarchy.ts',
  'lib/reconciliation/inventory-section-native.ts',
  'lib/reconciliation/inventory-register.ts',
  'lib/reconciliation/inventory-register-io.ts',
  'lib/reconciliation/inventory-column-evidence.ts',
  'scripts/inventory-column-proof.mjs',
  'scripts/inventory-column-export-controls.mjs',
  'audit/inventory-column-hierarchy/contract.json',
  'audit/inventory-column-hierarchy/generate.py',
  'audit/inventory-column-hierarchy/oracle.py',
  'audit/inventory-column-hierarchy/INPUT-MANIFEST.v3.json',
  'audit/inventory-column-hierarchy/check_export.py',
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sourceHashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (p) => [p, sha(await readFile(path.join(root, p)))]),
  ),
);
report.sourceHashes = sourceHashes;
const sealed = JSON.parse(
  await readFile(path.join(suite, 'INPUT-MANIFEST.v3.json'), 'utf8'),
);
for (const entry of sealed.files) {
  const b = await readFile(path.join(sources, entry.path));
  assert.equal(b.length, entry.bytes);
  assert.equal(sha(b), entry.sha256);
}
const fields = [
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
];
const scopeValues = [
  'Synthetic INV1E Owner',
  'STOCK-COLUMN',
  'GL-COLUMN',
  'KWD',
  'functional',
  'posted',
  'Current',
  '2026-10-31',
  'CHART-E',
  'MAP-E',
  'SUPPLIED-E',
  'SET-E',
];
try {
  for (const c of corpus.cases.filter((c) => /^INV1E-[CD]/.test(c.id))) {
    const files = await Promise.all(
      c.files.map(async (p) =>
        readStockFile(
          path.basename(p),
          Uint8Array.from(await readFile(path.join(sources, p))).buffer,
        ),
      ),
    );
    const state = {
      files,
      scope: {
        ...Object.fromEntries(fields.map((k, i) => [k, scopeValues[i]])),
        confirmed: true,
      },
      readings: STOCK_ROLES.map((role, i) => ({
        role,
        sheet: 0,
        family: i === 0 ? STOCK_COLUMN_FAMILY : STOCK_VERSION,
        confirmed: true,
      })),
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    };
    const checked = await replayStock(state),
      t = truth.cases.find((x) => x.id === c.id);
    assert.equal(checked.result.financial, t.financial, c.id);
    report.cases.push({ id: c.id, financial: t.financial });
    if (t.financial === 'source-error')
      assert.equal(checked.result.totals, null);
    else {
      assert.deepEqual(checked.result.totals, t.totals);
      assert.deepEqual(
        checked.result.records[0].map((r) => r.values),
        t.facts.map((r) => r.values),
      );
    }
    const modes = ['pending'];
    if (['INV1E-C01', 'INV1E-C04'].includes(c.id))
      modes.push('accepted', 'undone');
    for (const mode of modes) {
      let s = structuredClone(checked.state);
      if (mode !== 'pending') {
        s.completeness = {
          confirmed: true,
          reference: 'SYN-INV1E',
          note: 'Synthetic source coverage',
        };
        const base = await replayStock(s);
        const event = {
          id: 'INV1E-ACCEPT',
          type: 'accept',
          context: base.result.context,
          memberIds: base.result.memberIds,
          at: '2026-11-01T00:00:00.000Z',
          reference: 'SYN',
          note: 'Synthetic review',
        };
        s = base.state;
        s.events = [event];
        if (mode === 'undone')
          s.events.push({
            ...event,
            id: 'INV1E-UNDO',
            type: 'undo',
            at: '2026-11-01T00:01:00.000Z',
          });
      }
      const current = await replayStock(s),
        restored = await restoreStock(await saveStock(current.state));
      assert.deepEqual(restored.result, current.result);
      for (const [suffix, value] of Object.entries({
        direct: current,
        restored,
      })) {
        const p = path.join(out, c.id + '-' + mode + '-' + suffix + '.xlsx');
        await writeFile(
          p,
          new Uint8Array(await exportStock(value.state, value.result)),
        );
        const receipt = JSON.parse(
          python('check_export.py', [
            '--workbook',
            p,
            '--case-dir',
            path.join(sources, c.id),
            '--mode',
            mode,
          ]),
        );
        assert.equal(receipt.pass_, true);
        report.exports.push({ file: path.basename(p), receipt });
      }
    }
  }
  for (const [p, hash] of Object.entries(sourceHashes))
    assert.equal(sha(await readFile(path.join(root, p))), hash);
  report.exportControls = await checkColumnExportControls(out, sources);
  assert.equal(report.cases.length, 20);
  assert.equal(report.exports.length, 48);
  report.passed = true;
} finally {
  await writeFile(
    path.join(out, 'RESULTS.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(JSON.stringify(report));
