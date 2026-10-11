import { cp, symlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  completedSuccessfully,
  isAssertionKill,
  createPrivateTree,
  removePrivateTree,
} from './mutation-runner-support.mjs';
const root = resolve(import.meta.dirname, '..');
const output = resolve(
  process.env.GL_TB_VERTICAL_MUTATION_REPORT_DIR ||
    '../evidence/gl-tb-vertical-mutations',
);
const frozen = resolve(
  process.env.GL_TB_VERTICAL_FROZEN_DIR ||
    process.env.GL_TB_VERTICAL_FIXTURE_DIR ||
    join(root, 'tests/fixtures/gl-tb-vertical'),
);
const core = 'lib/reconciliation/gl-tb.ts';
const test = 'tests/gl-tb-vertical-core.test.ts';
const mutations = [
  {
    name: 'accept-native-rounding-that-hides-supplied-minor-units',
    changes: [
      [
        /assertNativeNumericPrecision\(sheet, row, column, minor, decimals\);/,
        'void minor;',
      ],
    ],
  },
  {
    name: 'drop-supplied-zero-period',
    changes: [
      [
        /rows\.push\(item\);/,
        "if (vertical && kind === 'period' && item.amounts.every((n) => n === 0)) continue;\nrows.push(item);",
      ],
    ],
  },
  {
    name: 'first-duplicate-role-wins',
    changes: [
      [
        /verticalUnits\.push\(\{ row, snapshot, role \}\);/,
        'if (verticalUnits.some((u) => u.snapshot === snapshot && u.role === role)) continue;\nverticalUnits.push({ row, snapshot, role });',
      ],
    ],
  },
  {
    name: 'swap-vertical-debit-credit',
    changes: [
      [/cell = vertical \? i % 2 : i;/, 'cell = vertical ? 1 - i % 2 : i;'],
    ],
  },
  {
    name: 'compare-only-net-components',
    changes: [
      [
        /differences && BALANCE_FIELDS\.some\(\(f\) => differences\[f\] !== 0\)/,
        "differences && ['opening', 'period', 'closing'].some((role) => differences[`${role}Debit`] !== differences[`${role}Credit`])",
      ],
    ],
  },
  {
    name: 'borrow-GL-opening-instead-of-TB-cells',
    changes: [
      [
        /cell = vertical \? i % 2 : i;/,
        'cell = vertical ? i % 2 : i;\nif (vertical && i < 2 && gl) record.amounts[cell] = gl[field];',
      ],
    ],
  },
  {
    name: 'link-six-components-to-one-fabricated-row',
    changes: [
      [
        /cells: \[\{ id: record\.id, column: record\.trace\[cell\]\.column \}\]/,
        'cells: [{ id: vertical ? tbRoles[0]!.id : record.id, column: record.trace[cell].column }]',
      ],
    ],
  },
  {
    name: 'omit-vertical-family-from-context',
    changes: [
      [
        /\[r\.sheet, r\.role, r\.family, r\.confirmed\]/,
        '[r.sheet, r.role, GL_TB_VERSION, r.confirmed]',
      ],
    ],
  },
  {
    name: 'ignore-late-source-errors',
    changes: [
      [
        /inventory\.some\(\(i\) => i\.kind === 'error'\)/,
        "inventory.some((i) => i.kind === 'error' && i.row < 5)",
      ],
    ],
  },
];
const digest = (value) => createHash('sha256').update(value).digest('hex');
const files = [core, test, 'scripts/test-gl-tb-vertical-mutations.mjs'];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [file, digest(await readFile(join(root, file)))]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', '--test-reporter=tap', test],
    {
      cwd,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GL_TB_VERTICAL_FROZEN_DIR: frozen },
    },
  );
const summary = (result) => {
  const log = (result.stdout || '') + (result.stderr || '');
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message || null,
    assertionFailure: /\bERR_ASSERTION\b/.test(log),
    failedTests: [...log.matchAll(/^\s*not ok [0-9]+ - (.+)$/gm)].map(
      (m) => m[1],
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
  syntheticOnly: true,
  sourceHashes,
  frozen,
  baseline: summary(baseline),
  mutations: [],
  passed: false,
};
if (completedSuccessfully(baseline))
  for (const mutation of mutations) {
    const tree = await createPrivateTree();
    try {
      await cp(join(root, 'lib'), join(tree, 'lib'), { recursive: true });
      await mkdir(join(tree, 'tests'), { recursive: true });
      await cp(join(root, test), join(tree, test));
      await cp(join(root, 'package.json'), join(tree, 'package.json'));
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      let content = await readFile(join(tree, core), 'utf8');
      for (const [pattern, replacement] of mutation.changes) {
        const count = [...content.matchAll(new RegExp(pattern.source, 'g'))]
          .length;
        if (count !== 1)
          throw Error(
            `Mutation anchor matched ${count} times: ${mutation.name}`,
          );
        content = content.replace(pattern, replacement);
      }
      await writeFile(join(tree, core), content);
      const execution = run(tree),
        killed = isAssertionKill(execution);
      await writeFile(
        join(output, `${mutation.name}.log`),
        (execution.stdout || '') + (execution.stderr || ''),
      );
      report.mutations.push({
        name: mutation.name,
        killed,
        ...summary(execution),
      });
      console.log(
        `${mutation.name}: ${killed ? 'assertion kill' : 'not an assertion kill'}`,
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
for (const [file, hash] of Object.entries(sourceHashes))
  if (digest(await readFile(join(root, file))) !== hash)
    throw Error(`Source changed during mutations: ${file}`);
report.passed =
  completedSuccessfully(baseline) &&
  report.mutations.length === mutations.length &&
  report.mutations.every((m) => m.killed && m.failedTests.length > 0);
await writeFile(
  join(output, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
if (!report.passed) process.exitCode = 1;
