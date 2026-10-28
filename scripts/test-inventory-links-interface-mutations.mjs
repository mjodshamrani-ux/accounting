// INV-3c interface mutations: each planted defect in how the inventory
// workspace shows the register links, or in the links workbook it downloads,
// is built into a private copy of the application, and the links browser
// acceptance (scripts/inventory-links-browser.mjs, against that build, with
// the independent workbook reader) must fail with an assertion. A survivor is
// behaviour no check holds.
//   node scripts/test-inventory-links-interface-mutations.mjs
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
  process.env.INV_LINKS_INTERFACE_MUTATION_DIR ??
  join(root, 'work/inventory-links-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/inventory-links-browser.mjs';
const PANEL = 'components/inventory-register-workspace.tsx';
const IO = 'lib/reconciliation/inventory-register-io.ts';
const COPY = 'lib/i18n/inventory-register.ts';
const mutations = [
  [
    'unlinked-rows-not-shown',
    PANEL,
    "{result.links.some((l) => l.status === 'unlinked') ? (",
    '{false ? (',
  ],
  [
    'first-reason-only',
    PANEL,
    "'data-stock-unlinked-reasons': l.reasons.join(' '),",
    "'data-stock-unlinked-reasons': l.reasons.slice(0, 1).join(' '),",
  ],
  [
    'reasons-without-their-code',
    PANEL,
    '.map((c) => `${copy.linkReasons[c]} (${c})`)',
    '.map((c) => `${copy.linkReasons[c]}`)',
  ],
  [
    'mapping-rows-not-shown',
    PANEL,
    "'data-stock-unlinked-related': JSON.stringify([\n                          l.mappings.map((m) => m.row),",
    "'data-stock-unlinked-related': JSON.stringify([\n                          [],",
  ],
  [
    'linked-count-of-every-row',
    PANEL,
    "data-stock-linked={\n                result.links.filter((l) => l.status === 'linked').length\n              }",
    'data-stock-linked={result.links.length}',
  ],
  [
    'other-unlinked-not-shown',
    PANEL,
    '{result.unlinked.length > 0 && (',
    '{false && (',
  ],
  [
    'other-reason-always-no-register',
    PANEL,
    "                        u.key.join('|'),\n                        u.reason,",
    "                        u.key.join('|'),\n                        'NO_REGISTER',",
  ],
  [
    'every-page-shows-the-first-marks',
    PANEL,
    '<tr key={i} {...marks?.[safe * 50 + i]}>',
    '<tr key={i} {...marks?.[i]}>',
  ],
  [
    'pager-unmarked',
    PANEL,
    '<div className="gl-tb-actions" data-stock-pager={pager}>',
    '<div className="gl-tb-actions">',
  ],
  [
    'links-button-exports-evidence',
    PANEL,
    "'stock-links-export',",
    "'stock-export',",
  ],
  [
    'workbook-every-row-linked',
    IO,
    '        v.status,\n        v.reasons.join(',
    "        'linked',\n        v.reasons.join(",
  ],
  [
    'workbook-reasons-comma-joined',
    IO,
    "        v.reasons.join(' '),",
    "        v.reasons.join(','),",
  ],
  [
    'workbook-item-as-number',
    IO,
    '        v.item,\n',
    '        Number(v.item) || v.item,\n',
  ],
  [
    'workbook-gl-members-dropped',
    IO,
    '        ...v.gl.map((g) => [',
    '        ...[].map((g) => [',
  ],
  [
    'workbook-account-dimensions-dropped',
    IO,
    '        v.key[1] ?? null,',
    '        null,',
  ],
  [
    'workbook-linked-count-of-every-row',
    IO,
    "        ['Linked', linked],",
    "        ['Linked', r.links.length],",
  ],
  [
    'arabic-reason-in-english',
    COPY,
    "    NO_MAPPING: 'لا خريطة تسمي هذا الصنف وأبعاده',",
    "    NO_MAPPING: 'No mapping names this item and dimensions',",
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
        INV_LINKS_DIST: join(tree, 'dist'),
        INV_LINKS_BROWSER_DIR: join(tree, 'work/browser'),
        // Stop at the first story that differs: a mutant that makes every
        // export slow must fail by assertion, not by the runner's timeout.
        INV_LINKS_FAIL_FAST: '1',
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
