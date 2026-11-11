// UX-7(b) interface mutations: each planted defect in the type stage (the
// roles the papers wear, their reading order and formats, one record in the
// middle, the type named under the stage, the room kept for the longest type,
// the turn that waits for the stage and keeps its budget, and the scene's own
// geometry) is built into a private copy of the application, and the type
// stage check (scripts/type-stage-browser.mjs, against that build) must fail
// with an assertion. It passes on the unmutated build first. A survivor is
// behaviour no browser check holds.
//   node scripts/test-type-stage-interface-mutations.mjs
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
  process.env.TYPE_STAGE_MUTATION_DIR ??
  join(root, 'work/type-stage-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/type-stage-browser.mjs';
const SCENE = 'components/document-scene.tsx';
const STYLE = 'app/document-scene.css';
const ROLES = 'lib/i18n/type-stage.ts';
const PAGE = 'app/page.tsx';
const mutations = [
  [
    'papers-keep-the-supplier-roles',
    SCENE,
    'role={roleOf(lang, shown, kind)}',
    "role={roleOf(lang, 'supplier', kind)}",
  ],
  [
    'intro-not-told-the-type',
    PAGE,
    `            primaryHeading={showLanding}
            domain={domain}`,
    `            primaryHeading={showLanding}`,
  ],
  [
    'reading-order-not-mirrored',
    SCENE,
    "(kind === 'supplier') === (dir === 'ltr') ? 'left' : 'right'",
    "kind === 'supplier' ? 'left' : 'right'",
  ],
  [
    'one-record-not-in-the-middle',
    SCENE,
    'centred={roles.length === 1}',
    'centred={false}',
  ],
  [
    'paper-without-a-role-shown',
    STYLE,
    `.document-scene__slot[data-absent='true'] {
  visibility: hidden;
}`,
    `.document-scene__slot[data-absent='true'] {
  visibility: visible;
}`,
  ],
  [
    'chip-says-fixed-formats',
    SCENE,
    '{acceptFormats(role?.accept)}',
    "{'XLSX'}",
  ],
  [
    'sources-stay-on-the-supplier',
    SCENE,
    'const current = candidate === domain;',
    "const current = candidate === 'supplier';",
  ],
  [
    'role-named-otherwise',
    ROLES,
    "{ name: 'دفتر النقدية', accept: both },",
    "{ name: 'دفتر الصندوق', accept: both },",
  ],
  [
    'room-of-the-longest-not-kept',
    STYLE,
    `.document-scene__source-list[data-current='false'] {
  visibility: hidden;
}`,
    `.document-scene__source-list[data-current='false'] {
  display: none;
}`,
  ],
  [
    'turns-while-off-screen',
    SCENE,
    `    if (!running) return;
`,
    '',
  ],
  [
    'waits-although-paused',
    SCENE,
    'const motionAllowed = !paused && !reducedMotion;',
    'const motionAllowed = !reducedMotion;',
  ],
  [
    'waits-although-reduced',
    SCENE,
    'const motionAllowed = !paused && !reducedMotion;',
    'const motionAllowed = !paused;',
  ],
  [
    'turn-over-its-budget',
    SCENE,
    'const TURN_IN = 360;',
    'const TURN_IN = 600;',
  ],
  [
    'turn-leaves-the-stage',
    SCENE,
    'perspective(900px) rotateY(',
    'perspective(90px) rotateY(',
  ],
  [
    'long-name-too-large',
    STYLE,
    `.document-scene__paper-title[data-size='xs'] {
  font-size: calc(100cqw * 11 / 196);
}`,
    `.document-scene__paper-title[data-size='xs'] {
  font-size: calc(100cqw * 16 / 196);
}`,
  ],
  ['name-over-the-mark', STYLE, 'top: 17.316%;', 'top: 10%;'],
  [
    'paper-leaps',
    STYLE,
    'transform: translateY(-3.2468%);',
    'transform: translateY(-30%);',
  ],
  // Inside the stage but at once: the rise in one step, the scan in one
  // step, and a rise whose cycle ends 2.5 units away from where it began,
  // under the step allowed between two samples.
  [
    'paper-jumps',
    STYLE,
    'animation: document-scene-rise 9s cubic-bezier(0.45, 0, 0.55, 1) infinite;',
    'animation: document-scene-rise 9s steps(1) infinite;',
  ],
  [
    'scan-jumps',
    STYLE,
    `animation: document-scene-paper-scan 8.5s cubic-bezier(0.45, 0, 0.55, 1)
    infinite;`,
    `animation: document-scene-paper-scan 8.5s steps(1)
    infinite;`,
  ],
  [
    'cycle-does-not-close',
    STYLE,
    `  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3.2468%);`,
    `  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-0.9%);
  }
  50% {
    transform: translateY(-3.2468%);`,
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
      TYPE_STAGE_DIST: join(tree, 'dist'),
      TYPE_STAGE_DIR: join(tree, 'work/type-stage'),
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
