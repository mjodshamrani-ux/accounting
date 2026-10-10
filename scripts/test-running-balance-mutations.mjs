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
  process.env.RUNNING_MUTATION_REPORT_DIR || '../evidence/running-mutations',
);
const core = 'lib/reconciliation/running-balance.ts';
const session = 'lib/reconciliation/running-balance-session.ts';
const tests = [
  'tests/running-balance-classifier.test.ts',
  'tests/running-balance-session.test.ts',
  'tests/running-balance-authority.test.ts',
  'tests/running-balance-native-regression.test.ts',
];
const mutations = [
  {
    name: 'infer-movement-from-provided-balance-difference',
    file: core,
    changes: [
      [
        /const debit = amount\(v\[4\], rn\),\s*credit = amount\(v\[5\], rn\),\s*balance = amount\(v\[6\], rn, true\);/,
        `let debit = amount(v[4], rn), credit = amount(v[5], rn);\nconst balance = amount(v[6], rn, true);\nif (last !== null && balance !== null) { const delta = balance - last; debit = delta > 0n ? delta : 0n; credit = delta < 0n ? -delta : 0n; }`,
      ],
    ],
  },
  {
    name: 'trust-closing-net-and-ignore-steps-gross-count-sequence',
    file: core,
    changes: [
      [
        /\) => \{\s*review\.diagnostics\.push\(\{/,
        ") => { if (['STEP','TOTAL','COUNT','SEQUENCE'].includes(code)) return;\nreview.diagnostics.push({",
      ],
    ],
  },
  {
    name: 'drop-zero-movements',
    file: core,
    changes: [
      [
        /const proofs = HEADER\.map\(\(_, c\) => evidence\(rn, c \+ 1\)\);/,
        'if (debit === 0n && credit === 0n) continue;\nconst proofs = HEADER.map((_, c) => evidence(rn, c + 1));',
      ],
    ],
  },
  {
    name: 'sort-source-movements-by-date',
    file: core,
    changes: [
      [
        /for \(; index < page\.length; index\+\+\) \{/,
        `for (let j = index; j < page.length;) { if (/^[1-9][0-9]*$/.test(page[j].values[0])) { let k = j; while (k < page.length && /^[1-9][0-9]*$/.test(page[k].values[0])) k++; page.splice(j, k-j, ...page.slice(j,k).sort((a,b) => a.values[1].localeCompare(b.values[1]))); j=k; } else j++; }\nfor (; index < page.length; index++) {`,
      ],
    ],
  },
  {
    name: 'repair-physical-pages-by-sorting-markers',
    file: core,
    changes: [
      [
        /for \(let pi = 0; pi < pages\.length; pi\+\+\) \{/,
        `pages.sort((a,b) => Number(a[6].values[0].match(/Page: ([0-9]+)/)?.[1]) - Number(b[6].values[0].match(/Page: ([0-9]+)/)?.[1]));\nfor (let pi = 0; pi < pages.length; pi++) {`,
      ],
    ],
  },
  {
    name: 'count-carried-balance-again-as-turnover',
    file: core,
    changes: [
      [
        /carried = amount\(v\[6\], rn, true\);/,
        'carried = amount(v[6], rn, true);\ngrossDebit += carried ?? 0n;',
      ],
    ],
  },
  {
    name: 'reset-account-balance-at-new-invoice',
    file: core,
    changes: [
      [
        /if \(parent\) \{\s*row\.kind = 'parent';/,
        "if (parent) { last = opening; lastProof = openingProof;\nrow.kind = 'parent';",
      ],
    ],
  },
  {
    name: 'ignore-errors-on-final-page',
    file: core,
    changes: [
      [
        /\) => \{\s*review\.diagnostics\.push\(\{/,
        ') => { if (row && review.rows[row-1]?.page === source.pdf?.pages) return;\nreview.diagnostics.push({',
      ],
    ],
  },
  {
    name: 'replace-previous-provided-balance-with-computed',
    file: core,
    changes: [[/last = balance;/, 'last = computed;']],
  },
  {
    name: 'borrow-live-authority-for-cloned-or-historical-receipt',
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
    name: 'reuse-consumed-receipt',
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
const digest = (b) => createHash('sha256').update(b).digest('hex');
const boundFiles = [
  core,
  session,
  ...tests,
  'tests/running-balance-test-helper.ts',
];
const hashes = Object.fromEntries(
  await Promise.all(
    boundFiles.map(async (file) => [
      file,
      digest(await readFile(join(root, file))),
    ]),
  ),
);
await mkdir(output, { recursive: true });
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', '--test-reporter=tap', ...tests],
    {
      cwd,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        RUNNING_SESSION_REPORT_DIR: join(cwd, 'work/running-mutation-session'),
      },
    },
  );
function summary(result) {
  const text = (result.stdout || '') + (result.stderr || '');
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message || null,
    assertionFailure: /\bERR_ASSERTION\b/.test(text),
    failedTests: [...text.matchAll(/^not ok [0-9]+ - (.+)$/gm)].map(
      (m) => m[1],
    ),
  };
}
const baseline = run(root);
await writeFile(
  join(output, 'baseline.log'),
  (baseline.stdout || '') + (baseline.stderr || ''),
);
const report = {
  sourceHashes: hashes,
  syntheticOnly: true,
  baseline: summary(baseline),
  mutations: [],
  passed: false,
};
if (completedSuccessfully(baseline)) {
  for (const mutant of mutations) {
    const tree = await createPrivateTree();
    try {
      await cp(join(root, 'lib'), join(tree, 'lib'), { recursive: true });
      await mkdir(join(tree, 'tests'), { recursive: true });
      for (const file of [...tests, 'tests/running-balance-test-helper.ts'])
        await cp(join(root, file), join(tree, file));
      await cp(
        join(root, 'audit/running-balance'),
        join(tree, 'audit/running-balance'),
        { recursive: true },
      );
      await cp(join(root, 'package.json'), join(tree, 'package.json'));
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      let text = await readFile(join(tree, mutant.file), 'utf8');
      for (const [pattern, replacement] of mutant.changes) {
        const count = [...text.matchAll(new RegExp(pattern.source, 'g'))]
          .length;
        if (count !== 1)
          throw Error(`Mutation anchor matched ${count} times: ${mutant.name}`);
        text = text.replace(pattern, replacement);
      }
      await writeFile(join(tree, mutant.file), text);
      const execution = run(tree);
      const killed = isAssertionKill(execution);
      await writeFile(
        join(output, `${mutant.name}.log`),
        (execution.stdout || '') + (execution.stderr || ''),
      );
      report.mutations.push({
        name: mutant.name,
        file: mutant.file,
        killed,
        ...summary(execution),
      });
      console.log(
        `${mutant.name}: ${killed ? 'assertion kill' : 'not an assertion kill'}`,
      );
    } catch (error) {
      report.mutations.push({
        name: mutant.name,
        killed: false,
        infrastructureError: String(error),
      });
    } finally {
      await removePrivateTree(tree);
    }
  }
}
function assertUnchanged(file, hash) {
  return readFile(join(root, file)).then((bytes) => {
    if (digest(bytes) !== hash)
      throw Error(`Source changed during mutation run: ${file}`);
  });
}
await Promise.all(
  Object.entries(hashes).map(([file, hash]) => assertUnchanged(file, hash)),
);
report.passed =
  completedSuccessfully(baseline) &&
  report.mutations.length === mutations.length &&
  report.mutations.every((m) => m.killed && m.failedTests.length > 0);
await writeFile(
  join(output, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
if (!report.passed) process.exitCode = 1;
