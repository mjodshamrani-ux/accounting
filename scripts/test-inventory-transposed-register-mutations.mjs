import assert from 'node:assert/strict';
import { cp, symlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  completedSuccessfully,
  isAssertionKill,
  createPrivateTree,
  removePrivateTree,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(
  resolve(
    process.env.INV_MATRIX_MUTATION_DIR ||
      join(root, 'work/inventory-transposed-register-mutations'),
  ),
  `attempt-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`,
);
const engine = 'lib/reconciliation/inventory-register.ts';
const parser = 'lib/reconciliation/inventory-transposed-register.ts';
const core = 'tests/inventory-transposed-register-core.test.ts';
const io = 'tests/inventory-transposed-register-io.test.ts';
const edit = (file, find, replacement) => ({ file, find, replacement });
const mutations = [
  {
    name: 'drop-original-column-from-matrix-logical-id',
    explanation:
      'Collapse distinct facts sharing the same Item-ID role row into one logical identity.',
    edits: [
      edit(
        engine,
        'JSON.stringify([STOCK_VERSION, source, f.sha256, 0, row, column]);',
        'JSON.stringify([STOCK_VERSION, source, f.sha256, 0, row]);',
      ),
    ],
  },
  {
    name: 'borrow-first-column-item-anchor',
    explanation:
      'Correct Item-ID text from another original column is not the original owning cell.',
    edits: [
      edit(
        parser,
        "anchor: fields['Item ID'].value,",
        'anchor: cite(itemRow, current.columns[0].column),',
      ),
    ],
  },
  {
    name: 'borrow-axis-key-from-first-band',
    explanation:
      'Reuse a presentation key from another completed band while retaining correct financial values.',
    edits: [
      edit(
        parser,
        'axis: axis.key,',
        'axis: output.evidence.bands[0].columns[0].key,',
      ),
    ],
  },
  {
    name: 'allow-global-item-dimension-duplicates-between-bands',
    explanation:
      'Pretend the same item/dimension key in two individually valid bands is distinct because of layout.',
    edits: [
      edit(
        parser,
        'const key = JSON.stringify(identity);',
        'const key = JSON.stringify([current.evidenceIndex, ...identity]);',
      ),
    ],
  },
  {
    name: 'ignore-zero-in-anonymous-matrix-separator',
    explanation:
      'Treat a supplied native zero without an axis identity as an empty separator and silently drop it.',
    edits: [
      edit(
        parser,
        "if (!active.has(column) && raw[column - 1] !== '')",
        "if (!active.has(column) && raw[column - 1] !== '' && raw[column - 1] !== '0')",
      ),
    ],
  },
  {
    name: 'erase-role-label-evidence-with-correct-value-retained',
    explanation:
      'Correct numbers alone do not prove the field meaning; remove the original role-label cell ownership.',
    edits: [
      edit(
        parser,
        'return [role, { value: cite(row, column), role: cite(row, 1) }];',
        'return [role, { value: cite(row, column), role: cite(row, column) }];',
      ),
    ],
  },
];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const tracked = [
  engine,
  parser,
  'lib/reconciliation/inventory-register-io.ts',
  core,
  io,
  'audit/inventory-transposed-register/INPUT-MANIFEST.json',
  'scripts/test-inventory-transposed-register-mutations.mjs',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (file) => [file, sha(await readFile(join(root, file)))]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', '--test-reporter=tap', core, io],
    { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 12 * 1024 * 1024 },
  );
const summary = (result) => {
  const log = (result.stdout || '') + (result.stderr || '');
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message || null,
    assertionFailure: /\bERR_ASSERTION\b/.test(log),
    failedTests: [...log.matchAll(/^\s*not ok [0-9]+ - (.+)$/gm)].map(
      (match) => match[1],
    ),
  };
};
await mkdir(output, { recursive: true });
const baseline = run(root);
await writeFile(
  join(output, 'baseline.log'),
  (baseline.stdout || '') + (baseline.stderr || ''),
);
const report = {
  schema: 'tarasuf-inv1c-semantic-mutations/1',
  syntheticOnly: true,
  sourceHashes,
  baseline: summary(baseline),
  mutations: [],
  passed: false,
};
if (completedSuccessfully(baseline)) {
  for (const mutation of mutations) {
    const tree = await createPrivateTree();
    try {
      await cp(join(root, 'lib'), join(tree, 'lib'), { recursive: true });
      await mkdir(join(tree, 'tests'), { recursive: true });
      for (const file of [core, io])
        await cp(join(root, file), join(tree, file));
      await mkdir(join(tree, 'audit'), { recursive: true });
      await cp(
        join(root, 'audit/inventory-transposed-register'),
        join(tree, 'audit/inventory-transposed-register'),
        { recursive: true },
      );
      await cp(join(root, 'package.json'), join(tree, 'package.json'));
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      for (const change of mutation.edits) {
        const file = join(tree, change.file);
        const source = await readFile(file, 'utf8');
        assert.equal(
          source.split(change.find).length - 1,
          1,
          mutation.name + ':exact anchor count',
        );
        await writeFile(file, source.replace(change.find, change.replacement));
      }
      const execution = run(tree);
      const killed = isAssertionKill(execution);
      await writeFile(
        join(output, mutation.name + '.log'),
        (execution.stdout || '') + (execution.stderr || ''),
      );
      report.mutations.push({
        name: mutation.name,
        explanation: mutation.explanation,
        killed,
        ...summary(execution),
      });
      console.log(
        mutation.name +
          ': ' +
          (killed ? 'assertion kill' : 'not an assertion kill'),
      );
    } catch (error) {
      report.mutations.push({
        name: mutation.name,
        killed: false,
        infrastructureError: String(error),
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
}
for (const [file, digest] of Object.entries(sourceHashes))
  assert.equal(
    sha(await readFile(join(root, file))),
    digest,
    'Source changed during mutations: ' + file,
  );
report.passed =
  completedSuccessfully(baseline) &&
  report.mutations.length === mutations.length &&
  report.mutations.every(
    (mutation) => mutation.killed && mutation.failedTests.length > 0,
  );
await writeFile(
  join(output, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    passed: report.passed,
    mutations: report.mutations.length,
    report: join(output, 'RESULTS.json'),
  }),
);
if (!report.passed) process.exitCode = 1;
