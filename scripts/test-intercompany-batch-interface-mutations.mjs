// IC-1c interface mutations: each planted defect in how the intercompany
// workspace's batch section takes files, sends roles, keeps or shows a result
// is built into a private copy of the application, and the batch browser
// acceptance (scripts/intercompany-batch-browser.mjs, against that build) must
// fail with an assertion. A survivor is behaviour no browser check holds.
//   node scripts/test-intercompany-batch-interface-mutations.mjs
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
  process.env.IC_BATCH_INTERFACE_MUTATION_DIR ??
  join(root, 'work/intercompany-batch-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/intercompany-batch-browser.mjs';
const PANEL = 'components/intercompany-batch-panel.tsx';
const mutations = [
  [
    'relation-file-sent-as-ledger',
    PANEL,
    "              ? 'relation-members'\n",
    "              ? 'entity-ledger'\n",
  ],
  [
    'new-file-keeps-result',
    PANEL,
    '                set({ file, confirmed: false });\n                invalidate();\n',
    '                set({ file, confirmed: false });\n',
  ],
  [
    'confirmation-not-required',
    PANEL,
    '    !!declaration?.confirmed &&\n    !!relations?.confirmed &&\n',
    '    !!declaration &&\n    !!relations &&\n',
  ],
  [
    'ledgers-last-only',
    PANEL,
    '                      setLedgers(files);\n',
    '                      setLedgers(files.slice(-1));\n',
  ],
  [
    'codes-not-shown',
    PANEL,
    "      data-ic-batch-codes={batch.codes.join(' ')}\n",
    '      data-ic-batch-codes=""\n',
  ],
  [
    'relation-shows-batch-status',
    PANEL,
    '          copy.relationStatus[r.status],\n',
    '          copy.relationStatus[batch.status],\n',
  ],
  [
    'members-swapped',
    PANEL,
    "          r.members.A.join(', '),\n          r.members.B.join(', '),\n",
    "          r.members.B.join(', '),\n          r.members.A.join(', '),\n",
  ],
  [
    'residual-two-decimals',
    PANEL,
    '          amount(r.residual, batch.decimals),\n',
    '          amount(r.residual, 2),\n',
  ],
  [
    'unassigned-not-shown',
    PANEL,
    '            {result.unassigned.length > 0 && (\n',
    '            {false && result.unassigned.length > 0 && (\n',
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
        IC_BATCH_DIST: join(tree, 'dist'),
        IC_BATCH_BROWSER_DIR: join(tree, 'work/browser'),
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
