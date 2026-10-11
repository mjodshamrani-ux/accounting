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
  process.env.ASSET_LONG_MUTATION_DIR ??
    join(root, '../evidence/asset-long-mutations'),
);
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'attempt-'));
const tests = [
  'tests/fixed-assets-long.test.ts',
  'tests/fixed-assets-long-io.test.ts',
  'tests/fixed-assets-long-worker.test.ts',
];
const core = 'lib/reconciliation/fixed-assets.ts';
const mutations = [
  [
    'long-cell-absence-becomes-presence',
    core,
    'present,\n          text:',
    'present: true,\n          text:',
  ],
  [
    'long-normalize-original-money-text',
    core,
    'text: present ? raw[positions.Amount] : null,',
    'text: present ? String(Number(raw[positions.Amount])) : null,',
  ],
  [
    'long-drop-zero-cell-value',
    core,
    'minor,\n          component:',
    'minor: minor === 0 ? null : minor,\n          component:',
  ],
  [
    'long-drop-one-member',
    core,
    'memberIds: evidence.map((e) => e.memberId),',
    'memberIds: evidence.slice(0, 3).map((e) => e.memberId),',
  ],
  [
    'long-ignore-valuation-conflict',
    core,
    /new Set\(\s*members.map\(\(\{ raw \}\) => raw\[positions\['Valuation reference'\]\]\),\s*\).size !== 1/,
    'false',
  ],
  [
    'long-ignore-carrying-equation',
    core,
    /BigInt\(components.cost\) -\s*BigInt\(components.depreciation\) -\s*BigInt\(components.impairment\) !==\s*BigInt\(components.carrying\)/,
    'false',
  ],
  [
    'long-ignore-raw-duplicate-diagnostics',
    core,
    'problem(source, row, code);',
    'void 0;',
  ],
  [
    'long-collapse-asset-dimensions',
    core,
    "raw[positions['Asset dimensions']] ?? '',",
    "'COLLAPSED',",
  ],
  [
    'long-compare-first-row-as-component',
    core,
    'item.componentEvidence?.find((e) => e.component === component)?.row ??',
    'undefined ??',
  ],
  [
    'long-ignore-source-errors',
    core,
    'if (result.issues.length) {',
    'if (false) {',
  ],
  [
    'long-flip-account-difference',
    core,
    'Number(value - BigInt(g.normal))',
    'Number(BigInt(g.normal) - value)',
  ],
  [
    'long-ignore-stale-export',
    'lib/reconciliation/fixed-assets-io.ts',
    'if (JSON.stringify(r) !== expectedSnapshot)',
    'if (false)',
  ],
  [
    'long-ignore-worker-forgery',
    'lib/reconciliation/fixed-assets-io.ts',
    'if (JSON.stringify(fresh.result) !== JSON.stringify(value.result))',
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
    const temp = await mkdtemp(join(tmpdir(), 'asset-long-mutant-'));
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
