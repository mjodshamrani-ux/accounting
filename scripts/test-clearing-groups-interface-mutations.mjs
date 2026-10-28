// CLR-1c interface mutations: each planted defect in how the clearing
// workspace shows the clearing groups is built into a private copy of the
// application, and the groups browser acceptance
// (scripts/clearing-groups-browser.mjs, against that build) must fail with an
// assertion. A survivor is behaviour no check holds.
//   node scripts/test-clearing-groups-interface-mutations.mjs
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
  process.env.CLR_GROUPS_INTERFACE_MUTATION_DIR ??
  join(root, 'work/clearing-groups-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/clearing-groups-browser.mjs';
const PANEL = 'components/clearing-groups-panel.tsx';
const WORKSPACE = 'components/clearing-workspace.tsx';
const COPY = 'lib/i18n/clearing-groups.ts';
const mutations = [
  [
    'stale-result-kept',
    WORKSPACE,
    'key={JSON.stringify([file.sha256, reading, scope])}',
    'key={JSON.stringify([file.sha256, reading])}',
  ],
  [
    'shown-without-confirmation',
    WORKSPACE,
    'disabled={busy || !scope.confirmed}\n            run={perform}',
    'disabled={busy}\n            run={perform}',
  ],
  [
    'reasons-without-their-code',
    PANEL,
    '                            {copy.reasons[code]} ({code})\n',
    '                            {copy.reasons[code]}\n',
  ],
  [
    'first-reason-only',
    PANEL,
    '                        g.reasons,\n',
    '                        g.reasons.slice(0, 1),\n',
  ],
  [
    'held-by-lines-not-shown',
    PANEL,
    'g.connected.map((c) => [c.row, c.code]),',
    '[],',
  ],
  [
    'duplicates-not-shown',
    PANEL,
    '                        g.duplicates,\n                      ])}',
    '                        [],\n                      ])}',
  ],
  [
    'members-without-posting-number',
    PANEL,
    '                          m.posting,\n                          m.amount,',
    "                          '',\n                          m.amount,",
  ],
  [
    'every-basis-reference',
    PANEL,
    '                          m.basis,\n',
    "                          'REFERENCE',\n",
  ],
  [
    'net-not-shown',
    PANEL,
    '                        g.net,\n',
    '                        0,\n',
  ],
  [
    'every-group-cleared',
    PANEL,
    '                        g.status,\n',
    "                        'cleared',\n",
  ],
  [
    'isolation-flipped',
    PANEL,
    '                          f.isolated,\n',
    '                          !f.isolated,\n',
  ],
  ['groups-pager-unmarked', PANEL, 'name="groups"', 'name="group-list"'],
  ['faulty-pager-unmarked', PANEL, 'name="faulty"', 'name="faulty-lines"'],
  [
    'reason-counts-of-one-dropped',
    PANEL,
    '.filter(([, n]) => n)',
    '.filter(([, n]) => n > 1)',
  ],
  [
    'summary-cleared-as-all',
    PANEL,
    "            data-groups-summary={JSON.stringify([\n              result.groups.length,\n              result.groups.filter((g) => g.status === 'cleared').length,",
    '            data-groups-summary={JSON.stringify([\n              result.groups.length,\n              result.groups.length,',
  ],
  [
    'blank-lines-not-shown',
    PANEL,
    '{result.blank.length > 0 && (',
    '{false && (',
  ],
  [
    'refusal-code-replaced',
    PANEL,
    'data-groups-refused={refused}',
    'data-groups-refused="SOURCE"',
  ],
  [
    'arabic-reason-in-english',
    COPY,
    "    CONNECTED_ERROR: 'سطر معيب يسمي هذا المرجع أو رقم قيد عضو فيها',",
    "    CONNECTED_ERROR: 'A faulty line names this reference',",
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
        CLR_GROUPS_DIST: join(tree, 'dist'),
        CLR_GROUPS_BROWSER_DIR: join(tree, 'work/browser'),
        // Stop at the first story that differs, by the same assertion.
        CLR_GROUPS_FAIL_FAST: '1',
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
