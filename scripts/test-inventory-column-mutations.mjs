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
    process.env.INV_COLUMN_MUTATION_DIR ||
      join(root, 'work/inventory-column-hierarchy-mutations'),
  ),
  `attempt-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`,
);
const engine = 'lib/reconciliation/inventory-register.ts';
const parser = 'lib/reconciliation/inventory-column-hierarchy.ts';
const core = 'tests/inventory-column-hierarchy.test.ts';
const io = 'tests/inventory-column-native.test.ts';
const mutations = [
  {
    name: 'foreign-parent-column-same-text',
    explanation: 'foreign-parent-column-same-text',
    edits: [
      {
        file: 'lib/reconciliation/inventory-column-hierarchy.ts',
        find: 'value: cite(p.parent, anchor)',
        replacement: 'value: cite(p.parent, c === 2 ? c + 1 : anchor)',
      },
    ],
  },
  {
    name: 'lose-duplicate-zero',
    explanation: 'lose-duplicate-zero',
    edits: [
      {
        file: 'lib/reconciliation/inventory-column-hierarchy.ts',
        find: 'if (group.length > 1)',
        replacement: 'if (group.length > 1 && false)',
      },
    ],
  },
  {
    name: 'ignore-orphan-separator-zero',
    explanation: 'ignore-orphan-separator-zero',
    edits: [
      {
        file: 'lib/reconciliation/inventory-column-hierarchy.ts',
        find: "problem(p.parent, 'ORPHAN_MATRIX_COLUMN', c)",
        replacement: 'void c',
      },
    ],
  },
  {
    name: 'foreign-panel-boundary',
    explanation: 'foreign-panel-boundary',
    edits: [
      {
        file: 'lib/reconciliation/inventory-column-hierarchy.ts',
        find: 'panelEnd: cite(end, 1)',
        replacement: 'panelEnd: cite(end + 1, 1)',
      },
    ],
  },
  {
    name: 'erase-original-covered-zero',
    explanation: 'erase-original-covered-zero',
    edits: [
      {
        file: 'lib/reconciliation/inventory-section-native.ts',
        find: "original.value !== ''",
        replacement: "(original.value !== '' && original.value !== '0')",
      },
    ],
  },
  {
    name: 'ignore-logical-budget',
    explanation: 'ignore-logical-budget',
    edits: [
      {
        file: 'lib/reconciliation/inventory-column-hierarchy.ts',
        find: 'assertInventoryMatrixLogicalBudget(file, budget)',
        replacement: 'assertInventoryMatrixLogicalBudget(file, MAX_ROWS)',
      },
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
  'audit/inventory-column-hierarchy/INPUT-MANIFEST.v3.json',
  'scripts/test-inventory-column-mutations.mjs',
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
  schema: 'tarasuf-inv1e-semantic-mutations/1',
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
      for (const file of [core, io, 'tests/inventory-column-fixture.ts'])
        await cp(join(root, file), join(tree, file));
      await mkdir(join(tree, 'audit'), { recursive: true });
      await cp(
        join(root, 'audit/inventory-column-hierarchy'),
        join(tree, 'audit/inventory-column-hierarchy'),
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
