// UX-10(b) code mutations: each planted defect in a private copy of the
// evidence thread projection (lib/evidence-thread.ts) must make its unit
// tests fail with an assertion (DEV-22). A survivor is a link or a cell the
// tests would let the drawer show wrongly.
//   node scripts/test-evidence-thread-mutations.mjs
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createPrivateTree,
  removePrivateTree,
  completedSuccessfully,
  describeRun,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.EVIDENCE_THREAD_MUTATION_DIR ??
  join(root, 'work/evidence-thread-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/evidence-thread.test.ts'];
const THREAD = 'lib/evidence-thread.ts';
// What the tests read: the projection and the engines it reads results of,
// the frozen synthetic cases and the loaders that run them.
const copied = [
  'lib',
  ...tests,
  'tests/helpers',
  'audit/fixed-assets',
  'audit/fixed-assets-long',
  'audit/payroll',
  'audit/reconciliation-sheet',
  'package.json',
];
const mutations = [
  [
    "gl-source-wrong",
    THREAD,
    "const GL = 3,",
    "const GL = 2,",
  ],
  [
    "gl-row-shifted",
    THREAD,
    "[GL, comparison.glRow],\n    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** A payroll",
    "[GL, comparison.glRow + 1],\n    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** A payroll",
  ],
  [
    "asset-register-rows-dropped",
    THREAD,
    "    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** A payroll",
    "  ]);\n}\n\n/** A payroll",
  ],
  [
    "payroll-register-rows-dropped",
    THREAD,
    "    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** The payroll",
    "  ]);\n}\n\n/** The payroll",
  ],
  [
    "cells-any-source",
    THREAD,
    ".filter((c) => c.source === source && c.row === row)",
    ".filter((c) => c.row === row)",
  ],
  [
    "cells-wrong-row",
    THREAD,
    ".filter((c) => c.source === source && c.row === row)",
    ".filter((c) => c.source === source && c.row === row + 1)",
  ],
  [
    "cells-first-dropped",
    THREAD,
    ".map(({ column, field, text }) => ({ column, field, text })),\n  }));",
    ".slice(1).map(({ column, field, text }) => ({ column, field, text })),\n  }));",
  ],
  [
    "label-of-first-source",
    THREAD,
    "name: labels[source]?.name ?? '',",
    "name: labels[0]?.name ?? '',",
  ],
  [
    "role-shifted",
    THREAD,
    "role: roles[source],",
    "role: roles[(source + 1) % roles.length],",
  ],
  [
    "bank-source-side-zero",
    THREAD,
    "const source = result.sources[record.side];",
    "const source = result.sources[0];",
  ],
  [
    "bank-text-is-field",
    THREAD,
    "      cells: record.traces.map(({ column, field, text }) => ({\n        column,\n        field,\n        text,\n      })),",
    "      cells: record.traces.map(({ column, field }) => ({\n        column,\n        field,\n        text: field,\n      })),",
  ],
  [
    "allocation-row-wrong",
    THREAD,
    "place: { row: item.row },",
    "place: { row: item.row + 1 },",
  ],
  [
    "payroll-bank-source-wrong",
    THREAD,
    "  BANK = 4;",
    "  BANK = 3;",
  ],
  [
    "unknown-comparison-not-empty",
    THREAD,
    "  const comparison = result.comparisons[index];\n  if (!comparison) return [];\n  return familySources(result.cells, ASSET_ROLES",
    "  const comparison = result.comparisons[index] ?? result.comparisons[0];\n  if (!comparison) return [];\n  return familySources(result.cells, ASSET_ROLES",
  ],
];
const files = [THREAD, ...tests];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    {
      cwd,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
if (!report.baselinePassed)
  process.stderr.write(describeRun('baseline', baseline, 'failed'));
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of copied)
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const target = join(tree, file);
      const text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const result = run(tree);
      await log(id, result);
      const killed = isAssertionKill(result);
      if (!killed)
        process.stderr.write(describeRun(id, result, 'was not caught'));
      report.mutations.push({
        id,
        file,
        killed,
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      report.mutations.push({
        id,
        file,
        killed: false,
        infrastructureError: error.message,
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
for (const [p, hash] of Object.entries(before))
  if (digest(await readFile(join(root, p))) !== hash)
    throw Error('Mutation touched source');
report.passed =
  report.baselinePassed &&
  report.mutations.length === mutations.length &&
  report.mutations.every((r) => r.killed);
await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      out,
      baselinePassed: report.baselinePassed,
      killed: report.mutations.filter((r) => r.killed).length,
      total: mutations.length,
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
