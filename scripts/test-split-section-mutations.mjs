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
  process.env.P4_MUTATION_REPORT_DIR ??
    join(root, '../evidence/split-section-mutations'),
);
const tests = [
  'tests/split-section-classifier.test.ts',
  'tests/split-section-session.test.ts',
];
const core = 'lib/reconciliation/split-section.ts';
const session = 'lib/reconciliation/split-section-session.ts';
const mutations = [
  {
    name: 'flip-debit-and-credit-literals',
    file: core,
    changes: [
      [/debit: v\[3\],\s*credit: v\[4\],/, 'debit: v[4], credit: v[3],'],
    ],
  },
  {
    name: 'drop-explicit-zero-movement',
    file: core,
    changes: [
      [
        /if \(d > 0n && c > 0n\) refuse\('SPLIT_DOUBLE_AMOUNT', ri\);/,
        "if (d === 0n && c === 0n) continue;\n          if (d > 0n && c > 0n) refuse('SPLIT_DOUBLE_AMOUNT', ri);",
      ],
    ],
  },
  {
    name: 'ignore-late-component-total',
    file: core,
    changes: [
      [
        /if \(d !== expectedD \|\| c !== expectedC\) refuse\(code, ri\);/,
        'void code;',
      ],
    ],
  },
  {
    name: 'count-carry-again-as-money',
    file: core,
    changes: [
      [
        /if \(d !== expectedD \|\| c !== expectedC\) refuse\(code, ri\);/,
        "if (d !== expectedD || c !== expectedC) refuse(code, ri);\n          if (text === 'Carried forward' || text === 'Brought forward') { grossDebit += d; grossCredit += c; }",
      ],
    ],
  },
  {
    name: 'merge-two-original-sections',
    file: core,
    changes: [[/active = parent\[1\];/, 'active = active ?? parent[1];']],
  },
  {
    name: 'accept-stale-real-receipt',
    file: session,
    changes: [
      [/receipt !== this\.#receipt\s*\|\|/, 'false ||'],
      [/ownership\.generation !== this\.#generation\s*\|\|/, 'false ||'],
      [/this\.#state !== 'reviewed'\s*\|\|/, 'false ||'],
    ],
  },
  {
    name: 'accept-cloned-live-receipt',
    file: session,
    changes: [
      [
        /this\.#owned\.get\(receipt\)/,
        'this.#owned.get(this.#receipt ?? receipt)',
      ],
      [/receipt !== this\.#receipt\s*\|\|/, 'false ||'],
    ],
  },
  {
    name: 'reuse-consumed-real-receipt',
    file: session,
    changes: [
      [
        /\/\/ Consume before snapshot\/hash\/native awaits, including failing applications\.\s*this\.#invalidate\(\);/,
        '// Mutant deliberately leaves the receipt live.',
      ],
      [/this\.#state !== 'reviewed'\s*\|\|/, 'false ||'],
    ],
  },
];
const digest = (text) => createHash('sha256').update(text).digest('hex');
const sourceHashes = Object.fromEntries(
  await Promise.all(
    [core, session, ...tests].map(async (file) => [
      file,
      digest(await readFile(join(root, file))),
    ]),
  ),
);
await mkdir(output, { recursive: true });
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    {
      cwd,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, P4_REPORT_DIR: '', P4_MUTATION_REPORT_DIR: '' },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
function summary(result) {
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    assertionFailure: /\bERR_ASSERTION\b/.test(
      (result.stdout ?? '') + (result.stderr ?? ''),
    ),
  };
}
const baseline = run(root);
await writeFile(
  join(output, 'baseline.log'),
  (baseline.stdout ?? '') + (baseline.stderr ?? ''),
);
const result = {
  version: 'split-section-directed-mutations-v1',
  runtime: process.execPath,
  sourceHashes,
  tests,
  baseline: summary(baseline),
  mutations: [],
  passed: false,
};
if (!completedSuccessfully(baseline)) {
  await writeFile(
    join(output, 'RESULTS.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.error(
    'Split mutation baseline failed; no assertion kill was counted.',
  );
  process.exitCode = 1;
} else {
  for (const mutant of mutations) {
    const tree = await createPrivateTree();
    try {
      await cp(join(root, 'lib'), join(tree, 'lib'), { recursive: true });
      await mkdir(join(tree, 'tests'), { recursive: true });
      for (const test of tests) await cp(join(root, test), join(tree, test));
      await cp(
        join(root, 'audit/split-section'),
        join(tree, 'audit/split-section'),
        { recursive: true },
      );
      await cp(join(root, 'package.json'), join(tree, 'package.json'));
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const file = join(tree, mutant.file);
      let text = await readFile(file, 'utf8');
      for (const [pattern, replacement] of mutant.changes) {
        const matches = [...text.matchAll(new RegExp(pattern.source, 'g'))];
        if (matches.length !== 1)
          throw Error(
            `Mutation anchor matched ${matches.length} times: ${mutant.name}`,
          );
        text = text.replace(pattern, replacement);
      }
      await writeFile(file, text);
      const execution = run(tree);
      const killed = isAssertionKill(execution);
      await writeFile(
        join(output, `${mutant.name}.log`),
        (execution.stdout ?? '') + (execution.stderr ?? ''),
      );
      result.mutations.push({
        name: mutant.name,
        file: mutant.file,
        killed,
        ...summary(execution),
      });
      console.log(
        `${mutant.name}: ${killed ? 'assertion kill' : 'not an assertion kill'}`,
      );
    } catch (error) {
      result.mutations.push({
        name: mutant.name,
        file: mutant.file,
        killed: false,
        infrastructureError: error.message,
      });
      console.error(`${mutant.name}: ${error.message}`);
    } finally {
      await removePrivateTree(tree);
    }
  }
  for (const [file, hash] of Object.entries(sourceHashes)) {
    if (digest(await readFile(join(root, file))) !== hash)
      throw Error(`Source changed during mutation run: ${file}`);
  }
  result.passed =
    result.mutations.length === mutations.length &&
    result.mutations.every((m) => m.killed);
  await writeFile(
    join(output, 'RESULTS.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  if (!result.passed) process.exitCode = 1;
}
