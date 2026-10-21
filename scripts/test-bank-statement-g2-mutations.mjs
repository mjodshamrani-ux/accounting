// BNK-PDF-1 G2 code mutations: each planted defect in a private copy of the
// matching engine must make the G2 tests or the 10,000-case differential
// comparison with the oracle fail with an assertion. A survivor is a rule
// nothing holds.
//   node scripts/test-bank-statement-g2-mutations.mjs
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
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.BNK_G2_MUTATION_DIR ??
  join(root, 'work/bank-statement-g2-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/bank-statement-match.test.ts'];
const differential = 'scripts/bank-statement-g2-differential.mjs';
const ENGINE = 'lib/reconciliation/bank-statement-match.ts';
const mutations = [
  [
    'auto-shared-reference',
    ENGINE,
    'if (s.length === 1 && c.length === 1) {',
    'if (s.length >= 1 && c.length >= 1) {',
  ],
  ['no-direction-check', ENGINE, 'x.direction !== y.direction', 'false'],
  ['no-amount-check', ENGINE, 'x.amount !== y.amount', 'false'],
  [
    'window-off-by-one',
    ENGINE,
    ': days(x.date, y.date) > window',
    ': days(x.date, y.date) > window + 1',
  ],
  [
    'reference-case-folded',
    ENGINE,
    'const ref = r.reference.trim();',
    'const ref = r.reference.trim().toUpperCase();',
  ],
  [
    'reference-untrimmed',
    ENGINE,
    'const ref = r.reference.trim();',
    'const ref = r.reference;',
  ],
  [
    'ambiguous-as-suggestion',
    ENGINE,
    "component.size === 2\n          ? 'amount-date-suggestion'",
    "true\n          ? 'amount-date-suggestion'",
  ],
  [
    'pool-opposite-direction',
    ENGINE,
    '`${s.direction}|${s.amount}`',
    "`${s.direction === 'in' ? 'out' : 'in'}|${s.amount}`",
  ],
  [
    'pool-no-window',
    ENGINE,
    'if (days(s.date, c.date) <= window) link(',
    'if (true) link(',
  ],
  ['held-ignored', ENGINE, "if (completeness === 'unproven')", 'if (false)'],
  [
    'confirmed-any-closing',
    ENGINE,
    'options.confirmedClosing === ownClosing;',
    'true;',
  ],
  [
    'period-assumed',
    ENGINE,
    'const period = reading.period ?? options.period ?? null;',
    "const period = reading.period ?? options.period ?? { start: '0000-01-01', end: '9999-12-31' };",
  ],
  [
    'timing-after-only',
    ENGINE,
    'r.valueDate < period.start || r.valueDate > period.end',
    'r.valueDate > period.end',
  ],
  [
    'cashbook-repeated-voucher',
    ENGINE,
    'if (!voucher || vouchers.has(voucher))',
    'if (!voucher)',
  ],
  [
    'cashbook-both-columns',
    ENGINE,
    'if (receipt > 0 === payment > 0)',
    'if (receipt === 0 && payment === 0)',
  ],
  [
    'cashbook-decimals',
    ENGINE,
    '\\\\.(\\\\d{${decimals}})',
    '\\\\.(\\\\d{${decimals},})',
  ],
  ['statement-ids-shifted', ENGINE, 'id: `S${i + 1}`,', 'id: `S${i}`,'],
];
const files = [
  ...new Set(mutations.map(([, file]) => file)),
  ...tests,
  differential,
];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) => {
  const options = {
    cwd,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  };
  // BNK_G2_DIFFERENTIAL_ONLY=1 measures the differential comparison alone.
  if (!process.env.BNK_G2_DIFFERENTIAL_ONLY) {
    const unit = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--test', ...tests],
      options,
    );
    if (!completedSuccessfully(unit)) return unit;
  }
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', differential],
    {
      ...options,
      env: {
        ...process.env,
        BNK_G2_DIFFERENTIAL_DIR: join(cwd, 'work/differential'),
      },
    },
  );
};
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        ...tests,
        differential,
        'audit/bank-statement-foundation',
        'package.json',
      ])
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
      report.mutations.push({
        id,
        file,
        killed: isAssertionKill(result),
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
