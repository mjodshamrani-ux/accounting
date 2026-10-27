// WF-1 TOL-1 T3 interface mutations: each planted defect in how the bank
// workspace takes, sends, keeps or shows a declared tolerance is built into a
// private copy of the application, and the tolerance browser acceptance
// (scripts/bank-tolerance-browser.mjs, against that build) must fail with an
// assertion. A survivor is behaviour no browser check holds.
//   node scripts/test-bank-tolerance-interface-mutations.mjs
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  process.env.BANK_TOLERANCE_INTERFACE_MUTATION_DIR ??
  join(root, 'work/bank-tolerance-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/bank-tolerance-browser.mjs';
const CMP = 'components/bank-statement-workspace.tsx';
const VIEW = 'lib/reconciliation/bank-statement-view.ts';
const mutations = [
  // What is sent and kept.
  [
    'policy-never-sent',
    CMP,
    '    return policy ? { ...chosen, tolerance: policy } : chosen;',
    '    return chosen;',
  ],
  ['new-period-keeps-policy', CMP, '    setTolerance(null);\n', ''],
  [
    'restored-policy-dropped',
    CMP,
    '    setTolerance(v.state.tolerance ?? null);',
    '    setTolerance(null);',
  ],
  [
    'restored-form-not-shown',
    CMP,
    '      toleranceFormOf(v.state.tolerance, v.result.reading.decimals),',
    '      toleranceFormOf(null, v.result.reading.decimals),',
  ],
  [
    'remove-keeps-policy',
    CMP,
    'onClick={() => void s.applyTolerance(null)}',
    'onClick={() => void s.applyTolerance(r.tolerance?.policy ?? null)}',
  ],
  // What is offered.
  [
    'invalid-policy-offered',
    CMP,
    "            disabled={typeof typed === 'string'}",
    '            disabled={false}',
  ],
  [
    'policy-open-after-a-decision',
    CMP,
    '<fieldset disabled={locked || bound}>',
    '<fieldset disabled={locked}>',
  ],
  ['blank-reason-taken', VIEW, '    !note.trim() ||\n', ''],
  // What is shown.
  ['refused-rule-hidden', CMP, '      {rule && (', '      {false && ('],
  [
    'exceeded-shown-as-tolerated',
    CMP,
    "            r.tolerance.exceeded ? 'exceeded' : 'tolerated'\n",
    "            'tolerated'\n",
  ],
  [
    'rejected-counted-as-tolerated',
    CMP,
    't.counts(tolerated, r.tolerance.eligible.length)',
    't.counts(r.tolerance.eligible.length, r.tolerance.eligible.length)',
  ],
  [
    'tolerated-cases-hidden',
    CMP,
    "      {r.cases.some((k) => k.kind === 'tolerated') && (",
    '      {false && (',
  ],
  [
    'difference-shows-the-statement-amount',
    CMP,
    '{format(k.amounts?.difference)}',
    '{format(k.amounts?.statement)}',
  ],
  [
    'unexplained-shows-the-difference',
    CMP,
    "[h.tolerance.unexplained, amount(sheet.unexplained!), '']",
    "[h.tolerance.unexplained, amount(sheet.difference), '']",
  ],
  [
    'effect-shows-the-difference',
    CMP,
    '                amount(d.effect),',
    '                amount(d.amounts.difference),',
  ],
  [
    'refused-rule-unread',
    VIEW,
    '  return TOLERANCE_RULES.find((r) => r === rule) ?? null;',
    '  return null;',
  ],
];
const buildInputs = [
  'app',
  'components',
  'hooks',
  'lib',
  'public',
  'styles',
  'scripts',
  'index.html',
  'main.tsx',
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'components.json',
];
// The application also bundles demonstration fixtures from audit/; copy the
// directories its source imports, found by reading that source.
const auditDirs = new Set();
for (const dir of ['app', 'components', 'hooks', 'lib'])
  for (const entry of await readdir(join(root, dir), {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile() && /\.(tsx?|mjs)$/.test(entry.name))
      for (const m of (
        await readFile(join(entry.parentPath, entry.name), 'utf8')
      ).matchAll(/['"](?:\.\.\/)+audit\/([^/'"]+)\//g))
        auditDirs.add(`audit/${m[1]}`);
buildInputs.push(...[...auditDirs].sort((a, b) => a.localeCompare(b)));
const files = [...new Set(mutations.map(([, file]) => file)), acceptance];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const options = (cwd) => ({
  cwd,
  encoding: 'utf8',
  timeout: 600000,
  maxBuffer: 64 * 1024 * 1024,
});
function build(tree) {
  for (const step of [
    ['scripts/prepare-native-pdf.mjs'],
    ['scripts/prepare-ocr-assets.mjs'],
    ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner'],
    ['scripts/harden-build.mjs'],
  ]) {
    const r = spawnSync(process.execPath, step, options(tree));
    if (!completedSuccessfully(r)) return r;
  }
  return null;
}
const run = (tree) => {
  const failed = build(tree);
  if (failed) return { ...failed, buildFailed: true };
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', acceptance],
    {
      ...options(root),
      env: {
        ...process.env,
        BANK_TOLERANCE_DIST: join(tree, 'dist'),
        BANK_TOLERANCE_BROWSER_DIR: join(tree, 'work/browser'),
      },
    },
  );
};
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
async function privateTree() {
  const tree = await createPrivateTree();
  for (const name of buildInputs)
    await cp(join(root, name), join(tree, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  return tree;
}
const report = { baselinePassed: false, mutations: [], passed: false };
{
  const tree = await privateTree();
  try {
    const baseline = run(tree);
    await log('baseline', baseline);
    report.baselinePassed = completedSuccessfully(baseline);
  } finally {
    await removePrivateTree(tree);
  }
}
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await privateTree();
    try {
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
        // A mutant that does not build is not a caught behaviour.
        killed: !result.buildFailed && isAssertionKill(result),
        buildFailed: !!result.buildFailed,
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
