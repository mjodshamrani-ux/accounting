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
    process.env.INV_SECTION_MUTATION_DIR ||
      join(root, 'work/inventory-section-components-mutations'),
  ),
  `attempt-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`,
);
const engine = 'lib/reconciliation/inventory-register.ts';
const parser = 'lib/reconciliation/inventory-section-components.ts';
const core = 'tests/inventory-section-components-core.test.ts';
const io = 'tests/inventory-section-components-io.test.ts';
const edit = (file, find, replacement) => ({ file, find, replacement });
const mutations = [
  {
    name: 'collapse-item-dimensions-in-mapping-key',
    explanation:
      'Collapse item and mapping keys to Item ID and lose the warehouse/batch membership proof.',
    edits: [
      edit(
        engine,
        'const itemKey = (v: (string | number)[]) => compound(v.slice(0, 2));',
        'const itemKey = (v: (string | number)[]) => compound(v.slice(0, 1));',
      ),
      edit(
        engine,
        'const key = compound(row.values.slice(1, 3));',
        'const key = compound(row.values.slice(1, 2));',
      ),
    ],
  },
  {
    name: 'manufacture-missing-quantity-from-precision-zero',
    explanation:
      'Invent Quantity=0 with a precision-cell citation when the supplied quantity component is absent; money and GL can still balance.',
    edits: [
      edit(
        parser,
        'const current = section;',
        "const current = section;\nif (!current.fields['Quantity'] && current.fields['Quantity precision']) current.fields['Quantity'] = { ...current.fields['Quantity precision'], raw: '0' };",
      ),
    ],
  },
  {
    name: 'ignore-conflicting-section-subtotal',
    explanation:
      'Ignore a wrong local control total even when the unchanged grand total still balances.',
    edits: [
      edit(
        parser,
        "problem(current.subtotal.row, 'CONTROL_MISMATCH');",
        'void current.subtotal;',
      ),
    ],
  },
  {
    name: 'wrong-source-hash-on-all-section-citations',
    explanation:
      'Keep correct financial money while disowning every cited original source hash.',
    edits: [
      edit(parser, 'sourceHash: file.sha256!,', "sourceHash: '0'.repeat(64),"),
    ],
  },
  {
    name: 'delete-item-dimension-source-citation',
    explanation:
      'Project correct dimensions into records but delete the cell proof that binds those dimensions to their section.',
    edits: [
      edit(
        parser,
        'fields: current.fields,',
        "fields: Object.fromEntries(Object.entries(current.fields).filter(([key]) => key !== 'Item dimensions')),",
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
  'audit/inventory-section-components/INPUT-MANIFEST.json',
  'scripts/test-inventory-section-components-mutations.mjs',
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
  schema: 'tarasuf-inv1b-semantic-mutations/1',
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
        join(root, 'audit/inventory-section-components'),
        join(tree, 'audit/inventory-section-components'),
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
