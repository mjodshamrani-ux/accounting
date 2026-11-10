// UX-8(b) interface mutations: each planted defect in the Latin display face
// of English headings (the face not found, the English stack back to Arial,
// English headings asking for a bold the face does not have, each heading rule
// asking for it on its own, the face reaching the Arabic page, and the face's
// name over other bytes) is built into a private copy of the application, and
// the unified workspace check (scripts/unified-workspace-browser.mjs, against
// that build) must fail with an assertion. It passes on the unmutated build
// first. A survivor is behaviour no browser check holds.
//   node scripts/test-latin-font-interface-mutations.mjs
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
  process.env.LATIN_FONT_MUTATION_DIR ??
  join(root, 'work/latin-font-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/unified-workspace-browser.mjs';
const GLOBALS = 'app/globals.css';
const LANDING = 'app/landing-details.css';
const mutations = [
  [
    'the-latin-face-is-not-found',
    GLOBALS,
    "  src: url('/fonts/dm-serif-display-latin-400-normal.woff2') format('woff2');",
    "  src: url('/fonts/dm-serif-display-latin-400-missing.woff2') format('woff2');",
  ],
  [
    'english-headings-back-to-arial',
    GLOBALS,
    "  --font-display-latin: 'DM Serif Display', Georgia, serif;",
    '  --font-display-latin: Arial, Helvetica, sans-serif;',
  ],
  [
    'english-headings-ask-for-bold',
    GLOBALS,
    '  --font-display-weight: 400;',
    '  --font-display-weight: 700;',
  ],
  [
    'the-hero-asks-for-bold',
    GLOBALS,
    `  display: block;
  font-weight: var(--font-display-weight);`,
    '  display: block;',
  ],
  [
    'a-feature-heading-asks-for-bold',
    LANDING,
    `  color: #192c48;
  font-weight: var(--font-display-weight);`,
    `  color: #192c48;
  font-weight: 700;`,
  ],
  [
    'the-latin-face-in-arabic',
    GLOBALS,
    "  --font-display: 'Thmanyah Serif Display', 'Noto Sans Arabic', serif;",
    "  --font-display: 'DM Serif Display', 'Thmanyah Serif Display', 'Noto Sans Arabic', serif;",
  ],
  [
    'the-latin-name-over-other-bytes',
    GLOBALS,
    "  src: url('/fonts/dm-serif-display-latin-400-normal.woff2') format('woff2');",
    "  src: url('/fonts/thmanyah-serif-display-bold.woff2') format('woff2');",
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
const faults = mutations;
const files = [...new Set(faults.map(([, file]) => file)), acceptance];
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
const accept = (tree) =>
  spawnSync(process.execPath, [acceptance], {
    ...options(root),
    env: {
      ...process.env,
      UNIFIED_WORKSPACE_DIST: join(tree, 'dist'),
      MIZAN_PROOF_DIR: join(tree, 'work/qa-unified-workspace'),
    },
  });
const run = (tree) => {
  const failed = build(tree);
  if (failed) return { ...failed, buildFailed: true };
  return accept(tree);
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
    // The run's records stay on the runner; a failing baseline prints the end
    // of its log, so the job log says why.
    if (!report.baselinePassed)
      process.stderr.write(
        `baseline failed (${baseline.buildFailed ? 'build, ' : ''}exit ${baseline.status}, signal ${baseline.signal}); its log ends:\n` +
          ((baseline.stdout ?? '') + (baseline.stderr ?? ''))
            .split('\n')
            .slice(-60)
            .join('\n') +
          '\n',
      );
  } finally {
    await removePrivateTree(tree);
  }
}
if (report.baselinePassed)
  for (const [id, file, from, to] of faults) {
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
