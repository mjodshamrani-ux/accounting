// Records a known, unsupported structure against existing contracts. This is
// a before-implementation baseline, never evidence of product-family support.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  STOCK_VERSION,
  STOCK_ROLES,
  STOCK_SECTION_FAMILY,
  STOCK_MATRIX_FAMILY,
  STOCK_HIERARCHY_FAMILY,
} from '../lib/reconciliation/inventory-register.ts';
import {
  readStockFile,
  replayStock,
} from '../lib/reconciliation/inventory-register-io.ts';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/inventory-column-hierarchy');
const outRoot =
  process.env.INV_COLUMN_BASELINE_DIR ??
  path.join(root, 'work/inventory-column-baseline');
await mkdir(outRoot, { recursive: true });
const out = await mkdtemp(path.join(outRoot, 'run-'));
const sources = path.join(out, 'sources');
const python = (file, args) =>
  execFileSync(
    process.env.PYTHON ?? 'python3',
    ['-B', path.join(suite, file), ...args],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
  );
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
python('generate.py', [
  '--output-dir',
  sources,
  '--include-layout-controls',
  '--negative-layout-controls',
]);
const corpus = JSON.parse(await readFile(path.join(sources, 'corpus.json')));
const truth = JSON.parse(python('oracle.py', ['--root', sources]));
await writeFile(
  path.join(out, 'SOURCE-TRUTH.json'),
  JSON.stringify(truth, null, 2) + '\n',
);
const sealed = JSON.parse(
  await readFile(path.join(suite, 'INPUT-MANIFEST.v3.json')),
);
assert.equal(sealed.files.length, 161);
assert.equal(corpus.cases.length, 40);
for (const entry of sealed.files) {
  const bytes = await readFile(path.join(sources, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(sha(bytes), entry.sha256, entry.path);
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
const labels = [
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
];
const report = {
  sourceContract: 'tarasuf-inv1e-source-foundation/1',
  productEnabled: false,
  stories: 1,
  independentPositivePresentations: 4,
  negativeCases: 16,
  layoutCurrencyControls: 4,
  negativeCurrencyControls: 16,
  sourceFiles: 160,
  sourceFactCasesChecked: 0,
  currentProduct: [],
  passed: false,
};
const tracked = [
  'lib/reconciliation/inventory-register.ts',
  'lib/reconciliation/inventory-register-io.ts',
  'lib/reconciliation/inventory-section-native.ts',
  'lib/reconciliation/inventory-section-components.ts',
  'lib/reconciliation/inventory-transposed-register.ts',
  'lib/reconciliation/inventory-hierarchy-sections.ts',
  'audit/inventory-column-hierarchy/contract.json',
  'audit/inventory-column-hierarchy/generate.py',
  'audit/inventory-column-hierarchy/oracle.py',
  'audit/inventory-column-hierarchy/INPUT-MANIFEST.json',
  'audit/inventory-column-hierarchy/INPUT-MANIFEST.v2.json',
  'audit/inventory-column-hierarchy/INPUT-MANIFEST.v3.json',
];
const hashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (p) => [p, sha(await readFile(path.join(root, p)))]),
  ),
);
report.sourceHashes = hashes;
try {
  for (const entry of corpus.cases) {
    const expected = truth.cases.find((c) => c.id === entry.id);
    assert.ok(expected);
    const files = await Promise.all(
      entry.files.map(async (name) => {
        const bytes = await readFile(path.join(sources, name));
        const file = await readStockFile(
          path.basename(name),
          Uint8Array.from(bytes).buffer,
        );
        assert.equal(file.sha256, sha(bytes));
        assert.deepEqual(Buffer.from(file.original), bytes);
        return file;
      }),
    );
    // A shared-reader success must preserve financial lexemes and source
    // ownership. It still does not activate a financial family.
    if (expected.facts.length) {
      const raw = (citation, source = 0) => {
        const [row, column, text] = citation;
        assert.equal(files[source].sheets[0].rows[row - 1]?.[column - 1], text);
        return text;
      };
      for (const fact of expected.facts) {
        for (const pair of Object.values(fact.fields)) {
          raw(pair.value);
          raw(pair.role);
        }
        const parent = raw(fact.parent),
          batch = raw(fact.batch);
        raw(fact.axis);
        const kind =
          files[0].sheets[0].rows[fact.parent[0] - 1][0].toLowerCase();
        assert.equal(kind + '=' + parent + ';batch=' + batch, fact.values[1]);
        assert.equal(
          files[0].sheets[0].rows[fact.panelEnd - 1][0],
          'End panel',
        );
        if (fact.merge) {
          const merge = files[0].sheets[0].xlsxHeaders?.merges.find(
            (m) =>
              m.top === fact.parent[0] &&
              m.left === fact.parent[1] &&
              m.left <= fact.column &&
              fact.column <= m.right,
          );
          assert.ok(merge, entry.id + ':parent-merge');
          assert.equal(merge.bottom, merge.top);
          assert.equal(merge.text, parent);
        }
      }
      for (const link of expected.links) {
        for (const [source, row, field, value] of [
          [1, link.mappingRow, 'Mapping ID', link.mapping],
          [1, link.mappingRow, 'Item ID', link.key[0]],
          [1, link.mappingRow, 'Item dimensions', link.key[1]],
          [2, link.policyRow, 'Evidence ID', link.policy],
          [2, link.policyRow, 'Item ID', link.key[0]],
          [2, link.policyRow, 'Item dimensions', link.key[1]],
        ]) {
          const column = files[source].sheets[0].rows[0].indexOf(field) + 1;
          assert.ok(column > 0);
          raw([row, column, value], source);
        }
      }
      for (const gl of expected.glEvidence)
        for (const citation of Object.values(gl)) raw(citation, 3);
      report.sourceFactCasesChecked++;
    }
    // Positive source scope is fixed independently in the oracle. Negative
    // malformed cases use that same source scope; no product inference here.
    const sourceScope = truth.cases.find(
      (c) =>
        c.id === (/^INV1E-[CD]/.test(entry.id) ? 'INV1E-C01' : 'INV1E-P01'),
    ).scope;
    for (const family of [
      STOCK_VERSION,
      STOCK_SECTION_FAMILY,
      STOCK_MATRIX_FAMILY,
      STOCK_HIERARCHY_FAMILY,
    ]) {
      let response;
      try {
        const checked = await replayStock({
          files,
          readings: STOCK_ROLES.map((role, i) => ({
            role,
            sheet: 0,
            family: i === 0 ? family : STOCK_VERSION,
            confirmed: true,
          })),
          scope: {
            ...Object.fromEntries(
              fields.map((field, i) => [field, sourceScope[labels[i]]]),
            ),
            confirmed: true,
          },
          completeness: { confirmed: false, reference: '', note: '' },
          events: [],
        });
        assert.equal(
          checked.result.financial,
          'source-error',
          entry.id + ':' + family,
        );
        assert.equal(checked.result.totals, null);
        assert.ok(checked.result.issues.length > 0);
        response = {
          financial: checked.result.financial,
          issues: [...new Set(checked.result.issues.map((i) => i.code))],
        };
      } catch (error) {
        // Runtime/type/assertion failures are not safe financial rejection.
        const expectedRejection =
          sourceScope.Currency === 'BHD'
            ? /^STOCK_CURRENCY$/
            : /^STOCK_(?:SOURCE|READING)$/;
        if (!(error instanceof Error) || !expectedRejection.test(error.message))
          throw error;
        response = { rejected: error.message };
      }
      report.currentProduct.push({
        id: entry.id,
        family,
        independentlyExpected: expected.financial,
        ...response,
      });
      for (let i = 0; i < files.length; i++) {
        const bytes = await readFile(path.join(sources, entry.files[i]));
        assert.deepEqual(Buffer.from(files[i].original), bytes);
        assert.equal(files[i].sha256, sha(bytes));
      }
    }
  }
  assert.equal(report.currentProduct.length, 160);
  assert.equal(report.sourceFactCasesChecked, 16);
  assert.equal(
    report.currentProduct.filter((x) => x.rejected === 'STOCK_CURRENCY').length,
    80,
  );
  assert.equal(
    report.currentProduct.filter(
      (x) =>
        x.id.startsWith('INV1E-C') &&
        (x.financial === 'source-error' || x.rejected === 'STOCK_SOURCE'),
    ).length,
    16,
  );
  assert.equal(
    report.currentProduct.filter(
      (x) =>
        x.id.startsWith('INV1E-D') &&
        (x.financial === 'source-error' || x.rejected === 'STOCK_SOURCE'),
    ).length,
    64,
  );
  for (const p of tracked)
    assert.equal(sha(await readFile(path.join(root, p))), hashes[p], p);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await writeFile(
    path.join(out, 'BASELINE.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      evaluations: report.currentProduct.length,
      productEnabled: false,
    }),
  );
}
