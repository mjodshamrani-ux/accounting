import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

const root = resolve(import.meta.dirname, '..');
const suite = join(root, 'audit/inventory-transposed-register');
const output = join(
  resolve(
    process.env.INV_MATRIX_PROOF_DIR ||
      join(root, 'work/inventory-transposed-register-proof'),
  ),
  `attempt-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`,
);
await mkdir(output, { recursive: true });
const sources = join(output, 'sources');
const python = process.env.PYTHON || 'python3';
const run = (file, args) =>
  execFileSync(python, ['-B', join(suite, file), ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 20 * 1024 * 1024,
  });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const tracked = [
  'lib/reconciliation/inventory-register.ts',
  'lib/reconciliation/inventory-register-io.ts',
  'lib/reconciliation/inventory-transposed-register.ts',
  'audit/inventory-transposed-register/generate.py',
  'audit/inventory-transposed-register/oracle.py',
  'audit/inventory-transposed-register/check_export.py',
  'audit/inventory-transposed-register/INPUT-MANIFEST.json',
  'scripts/inventory-transposed-register-proof.mjs',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (file) => [file, sha(await readFile(join(root, file)))]),
  ),
);
const report = {
  schema: 'tarasuf-inv1c-financial-proof/1',
  syntheticOnly: true,
  sourceHashes,
  financialStories: 1,
  cases: [],
  exports: [],
  passed: false,
};
const scope = {
  entity: 'Synthetic INV1C Owner',
  inventoryLedger: 'STOCK-MATRIX',
  glLedger: 'GL-MATRIX',
  currency: 'KWD',
  currencyBasis: 'functional',
  postingStatus: 'posted',
  postingLayer: 'Current',
  asOf: '2026-10-31',
  chartVersion: 'CHART-MX',
  mapVersion: 'MAP-MX',
  valuationPolicyVersion: 'SUPPLIED-MX',
  inventoryAccountSetVersion: 'INV-MX',
  confirmed: true,
};
try {
  run('generate.py', ['--output-dir', sources]);
  const inputManifest = JSON.parse(
    await readFile(join(suite, 'INPUT-MANIFEST.json'), 'utf8'),
  );
  async function files(directory) {
    return (
      await Promise.all(
        (
          await readdir(directory, { withFileTypes: true })
        ).map(async (entry) =>
          entry.isDirectory()
            ? files(join(directory, entry.name))
            : [join(directory, entry.name)],
        ),
      )
    ).flat();
  }
  assert.equal((await files(sources)).length, inputManifest.files.length);
  for (const source of inputManifest.files) {
    const value = await readFile(join(sources, source.path));
    assert.equal(value.byteLength, source.bytes, source.path);
    assert.equal(sha(value), source.sha256, source.path);
  }
  report.immutableInputs = {
    count: inputManifest.files.length,
    manifestSHA256:
      sourceHashes['audit/inventory-transposed-register/INPUT-MANIFEST.json'],
    matched: true,
  };
  const index = JSON.parse(
    await readFile(join(sources, 'corpus.json'), 'utf8'),
  );
  const truth = JSON.parse(run('oracle.py', ['--root', sources]));
  await writeFile(
    join(output, 'independent-observations.json'),
    JSON.stringify(truth, null, 2) + '\n',
  );
  async function input(entry) {
    const originals = [];
    for (const file of entry.files)
      originals.push(
        await readStockFile(
          basename(file),
          new Uint8Array(await readFile(join(sources, file))).buffer,
        ),
      );
    return {
      files: originals,
      scope: { ...scope },
      readings: STOCK_ROLES.map((role, source) => ({
        sheet: 0,
        role,
        family:
          source === 0 ? 'inventory-transposed-register-1' : STOCK_VERSION,
        confirmed: true,
      })),
      completeness: { confirmed: false, reference: '', note: '' },
      events: [],
    };
  }
  async function exportAndCheck(id, kind, value, mode = '') {
    const name = id + '-' + kind + '.xlsx';
    const file = join(output, name);
    await writeFile(
      file,
      new Uint8Array(await exportStock(value.state, value.result)),
    );
    const checked = JSON.parse(
      run('check_export.py', [
        '--workbook',
        file,
        '--case-dir',
        join(sources, 'cases', id),
        ...(mode ? ['--' + mode] : []),
      ]),
    );
    assert.equal(checked.pass, true, name);
    report.exports.push({
      id,
      kind,
      file: name,
      sha256: sha(await readFile(file)),
      checker: checked,
    });
  }
  for (const entry of index.cases) {
    const expected = truth.cases.find((value) => value.id === entry.id);
    const current = await replayStock(await input(entry));
    assert.equal(current.result.financial, expected.financial, entry.id);
    assert.equal(current.result.review, 'needs-review');
    if (expected.financial === 'source-error') {
      assert.equal(current.result.totals, null);
      assert.ok(current.result.issues.length > 0);
      assert.ok(
        current.result.comparisons.every((comparison) =>
          Object.entries(comparison)
            .filter(([key]) => key.endsWith('Minor'))
            .every(([, value]) => value === null),
        ),
      );
    }
    assert.deepEqual(
      current.result.totals,
      expected.totals,
      entry.id + ':money',
    );
    const session = await saveStock(current.state);
    await writeFile(
      join(output, entry.id + '.tarasuf-inventory'),
      new Uint8Array(session),
    );
    const restored = await restoreStock(session);
    assert.deepEqual(restored.result, current.result);
    for (let source = 0; source < 4; source++)
      assert.deepEqual(
        restored.state.files[source].original,
        current.state.files[source].original,
      );
    report.cases.push({
      id: entry.id,
      financial: current.result.financial,
      status: current.result.status,
      originals: current.state.files.map((file) => file.sha256),
      recordCounts: current.result.records.map((rows) => rows.length),
      memberCount: current.result.memberIds.length,
      totals: current.result.totals,
      restored: true,
    });
    await writeFile(
      join(output, entry.id + '-observed.json'),
      JSON.stringify(current.result, null, 2) + '\n',
    );
    if (entry.id.startsWith('INV1C-P')) {
      assert.deepEqual(current.result.totals, {
        registerMinor: 667134,
        glMinor: 667134,
      });
      await exportAndCheck(entry.id, 'direct', current);
      await exportAndCheck(entry.id, 'restored', restored);
    }
    if (['INV1C-N01', 'INV1C-N02'].includes(entry.id)) {
      await exportAndCheck(entry.id, 'direct', current);
      await exportAndCheck(entry.id, 'restored', restored);
    }
    if (['INV1C-P01', 'INV1C-P04'].includes(entry.id)) {
      const state = current.state;
      state.completeness = {
        confirmed: true,
        reference: 'INV1C synthetic whole scope',
        note: 'Synthetic matrix attestation only',
      };
      const complete = await replayStock(state);
      state.events = [
        {
          id: 'INV1C-ACCEPT',
          type: 'accept',
          memberIds: complete.result.memberIds,
          context: complete.result.context,
          at: '2026-11-01T00:00:00.000Z',
          reference: 'INV1C synthetic approval',
          note: 'Synthetic matrix review only',
        },
      ];
      const accepted = await restoreStock(await saveStock(state));
      assert.equal(accepted.result.status, 'consistent-with-evidence');
      await exportAndCheck(entry.id, 'accepted', accepted, 'accepted');
      state.events.push({
        ...state.events[0],
        id: 'INV1C-UNDO',
        type: 'undo',
        at: '2026-11-01T00:00:01.000Z',
      });
      const undone = await restoreStock(await saveStock(state));
      assert.equal(undone.result.status, 'needs-review');
      await exportAndCheck(entry.id, 'undone', undone, 'undone');
    }
  }
  assert.equal(report.cases.length, 14);
  assert.equal(report.exports.length, 20);
  for (const [file, digest] of Object.entries(sourceHashes))
    assert.equal(
      sha(await readFile(join(root, file))),
      digest,
      'Source changed during proof: ' + file,
    );
  report.passed = true;
} catch (error) {
  report.failure = {
    name: error.name,
    message: error.message,
    code: error.code || null,
  };
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, 'RESULTS.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      cases: report.cases.length,
      independentlyCheckedExports: report.exports.length,
      report: join(output, 'RESULTS.json'),
      failure: report.failure || null,
    }),
  );
}
