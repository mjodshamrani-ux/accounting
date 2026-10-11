import {
  cp,
  symlink,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  isAssertionKill,
  completedSuccessfully,
} from './mutation-runner-support.mjs';
const root = resolve(import.meta.dirname, '..');
const parent = resolve(
  process.env.BANK_WD_MUTATION_DIR ??
    join(root, '../evidence/bank-wd-mutations'),
);
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'attempt-'));
const tests = [
  'tests/bank-withdrawal-deposit.test.ts',
  'tests/bank-withdrawal-deposit-native.test.ts',
  'tests/bank-wd-lifecycle.test.ts',
  'tests/bank-wd-worker.test.ts',
];
const mutations = [
  [
    'wd-flip-cash-sign',
    'lib/reconciliation/bank.ts',
    "signed: direction === 'inflow' ? n : -n,",
    "signed: direction === 'inflow' ? -n : n,",
  ],
  [
    'wd-treat-inactive-blank-as-stated-zero',
    'lib/reconciliation/bank.ts',
    /state: 'blank-inactive',\s*minor: null/,
    "state: 'blank-inactive', minor: 0",
  ],
  [
    'wd-collapse-written-zero-to-blank',
    'lib/reconciliation/bank.ts',
    "state: n === 0 ? 'explicit-zero-inactive' : 'active',",
    "state: n === 0 ? 'blank-inactive' : 'active',",
  ],
  [
    'wd-net-dual-positive',
    'lib/reconciliation/bank.ts',
    /Number\(deposit.state === 'active'\) !==\s*1/,
    "Number(deposit.state === 'active') < 1",
  ],
  [
    'wd-remove-negative-sign',
    'lib/reconciliation/bank.ts',
    "text.replace(/^ +| +$/g, '')",
    "text.replace(/^ +| +$/g, '').replace('-', '')",
  ],
  [
    'wd-drop-cash-cell-evidence',
    'lib/reconciliation/bank.ts',
    '...(money ? { withdrawalDeposit: money } : {}),',
    '...{},',
  ],
  [
    'wd-ignore-late-source-errors',
    'lib/reconciliation/bank.ts',
    "const sourceError = inventory.some((i) => i.kind === 'error');",
    'const sourceError = false;',
  ],
  [
    'wd-disable-strict-peer-display',
    'lib/reconciliation/bank-io.ts',
    'strictMovementDisplay,',
    'strictMovementDisplay: false,',
  ],
  [
    'wd-allow-hidden-money-precision',
    'lib/reconciliation/bank-native-display.ts',
    /if \(\s*places > options.decimals! \|\|\s*\(cell.format === '2' && places > 2\)\s*\)/,
    'if (false)',
  ],
  [
    'wd-export-only-one-cash-column',
    'lib/reconciliation/bank-io.ts',
    "(['withdrawal', 'deposit'] as const).map((field) => {",
    "(['withdrawal'] as const).map((field) => {",
  ],
  [
    'wd-bind-sheet-by-storage-number',
    'lib/reconciliation/bank-native-display.ts',
    'const sheet = worksheetSources.get(entry.name);',
    'const storage = /sheet(\\d+)\\.xml$/i.exec(entry.name); const sheet = storage ? file.sheets[Number(storage[1]) - 1] : undefined;',
  ],
  [
    'wd-ignore-worker-computed-forgery',
    'lib/reconciliation/worker-client.ts',
    'if (JSON.stringify(fresh.result) !== JSON.stringify(value.result))',
    'if (false)',
  ],
  [
    'wd-ignore-stale-export',
    'lib/reconciliation/bank-io.ts',
    'if (JSON.stringify(result) !== JSON.stringify(expected))',
    'if (false)',
  ],
];
const hash = (b) => createHash('sha256').update(b).digest('hex');
const sources = Object.fromEntries(
  await Promise.all(
    [...new Set(mutations.map((m) => m[1]))].map(async (f) => [
      f,
      hash(await readFile(join(root, f))),
    ]),
  ),
);
function run(
  cwd,
  args = [
    '--experimental-strip-types',
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    ...tests,
  ],
) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
}
const brief = (r) => ({
  exitCode: r.status,
  signal: r.signal,
  error: r.error?.message ?? null,
  assertionFailure: /\bERR_ASSERTION\b/.test(
    (r.stdout ?? '') + (r.stderr ?? ''),
  ),
  failedTests: [
    ...((r.stdout ?? '') + (r.stderr ?? '')).matchAll(/^not ok \d+ - (.+)$/gm),
  ].map((m) => m[1]),
});
const baseline = run(root);
await writeFile(
  join(output, 'baseline.log'),
  (baseline.stdout ?? '') + (baseline.stderr ?? ''),
);
const report = {
  passed: false,
  sourceHashes: sources,
  baseline: brief(baseline),
  catalogue: mutations.map((m) => ({
    name: m[0],
    file: m[1],
    before: String(m[2]),
    after: m[3],
  })),
  mutations: [],
};
await writeFile(
  join(output, 'CATALOGUE.json'),
  JSON.stringify(report.catalogue, null, 2) + '\n',
);
console.log('REPORT ' + output);
if (completedSuccessfully(baseline))
  for (const [name, file, before, after] of mutations) {
    const temp = await mkdtemp(join(tmpdir(), 'bank-wd-mutant-'));
    try {
      for (const dir of ['lib', 'tests', 'audit'])
        await cp(join(root, dir), join(temp, dir), { recursive: true });
      await cp(join(root, 'package.json'), join(temp, 'package.json'));
      await symlink(
        join(root, 'node_modules'),
        join(temp, 'node_modules'),
        'dir',
      );
      const original = await readFile(join(temp, file), 'utf8');
      const count =
        typeof before === 'string'
          ? original.split(before).length - 1
          : [...original.matchAll(new RegExp(before.source, 'g'))].length;
      if (count !== 1) throw Error(`Anchor ${name} matched ${count}`);
      const text = original.replace(before, after);
      await writeFile(join(temp, file), text);
      await writeFile(join(output, name + '.source'), text);
      const syntax = run(temp, ['--experimental-strip-types', '--check', file]);
      await writeFile(
        join(output, name + '.syntax.log'),
        (syntax.stdout ?? '') + (syntax.stderr ?? ''),
      );
      if (!completedSuccessfully(syntax)) throw Error('Mutant syntax failed');
      const result = run(temp);
      const killed = isAssertionKill(result);
      await writeFile(
        join(output, name + '.log'),
        (result.stdout ?? '') + (result.stderr ?? ''),
      );
      report.mutations.push({
        name,
        file,
        killed,
        syntaxPassed: true,
        ...brief(result),
      });
      console.log(
        name + ': ' + (killed ? 'assertion kill' : 'SURVIVED/INFRASTRUCTURE'),
      );
    } catch (error) {
      report.mutations.push({
        name,
        file,
        killed: false,
        infrastructureError: String(error),
      });
      console.log(name + ': ' + String(error));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    await writeFile(
      join(output, 'RESULTS.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
for (const [f, h] of Object.entries(sources))
  if (hash(await readFile(join(root, f))) !== h)
    throw Error('Real source changed during mutations: ' + f);
report.passed =
  completedSuccessfully(baseline) &&
  report.mutations.length === mutations.length &&
  report.mutations.every(
    (m) => m.killed && m.syntaxPassed && m.failedTests.length > 0,
  );
await writeFile(
  join(output, 'RESULTS.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    passed: report.passed,
    assertionKills: report.mutations.filter((m) => m.killed).length,
    total: mutations.length,
    output,
  }),
);
if (!report.passed) process.exitCode = 1;
