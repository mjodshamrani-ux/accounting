// UX-7(c) interface mutations: each planted defect in the three supplier
// acts (shown with another type, under it or on its papers; following one
// another after a pick or not at all; the pressed act and its sentence; the
// final state when paused; waiting off screen; records leaving the table or
// jumping; the state before the move or never; the sentences keeping one
// place; the relation in one act only; hidden buttons taking the focus) is
// built into a private copy of the application, and the acts check
// (scripts/stage-acts-browser.mjs, against that build) must fail with an
// assertion. It passes on the unmutated build first. A survivor is behaviour
// no browser check holds. The words themselves are held by the honesty test
// and its own copy mutations (scripts/test-stage-acts-copy-mutations.mjs).
//   node scripts/test-stage-acts-interface-mutations.mjs
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
  process.env.STAGE_ACTS_MUTATION_DIR ??
  join(root, 'work/stage-acts-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/stage-acts-browser.mjs';
const SCENE = 'components/document-scene.tsx';
const STYLE = 'app/document-scene.css';
const mutations = [
  [
    'acts-on-every-type',
    SCENE,
    "const playing = shown === 'supplier' ? acts.acts[act] : undefined;",
    'const playing = acts.acts[act];',
  ],
  [
    'acts-under-another-type',
    SCENE,
    "if (candidate === 'supplier')",
    "if (candidate === 'supplier' || candidate === 'ar')",
  ],
  [
    'a-picked-act-still-gives-way',
    SCENE,
    "event.animationName !== 'document-scene-act-clock' || !autoplay",
    "event.animationName !== 'document-scene-act-clock'",
  ],
  [
    'acts-do-not-follow',
    SCENE,
    'setAct((index) => (index + 1) % acts.acts.length);',
    'setAct((index) => index);',
  ],
  [
    'the-first-stays-pressed',
    SCENE,
    'aria-pressed={index === act}',
    'aria-pressed={index === 0}',
  ],
  [
    'the-first-sentence-stays',
    SCENE,
    "data-current={index === act ? 'true' : 'false'}",
    "data-current={index === 0 ? 'true' : 'false'}",
  ],
  [
    'paused-shows-the-start',
    SCENE,
    "data-act-final={motionAllowed ? 'false' : 'true'}",
    'data-act-final="false"',
  ],
  [
    'acts-run-off-screen',
    STYLE,
    `  animation: document-scene-act-clock 7200ms linear both;
  animation-play-state: paused;`,
    `  animation: document-scene-act-clock 7200ms linear both;
  animation-play-state: running;`,
  ],
  [
    'a-record-leaves-the-table',
    SCENE,
    "{ y: 196, text: 'PAY-63', dy: -52 },",
    "{ y: 196, text: 'PAY-63', dy: -120 },",
  ],
  [
    'a-record-jumps',
    STYLE,
    'animation: document-scene-ink-move 7200ms cubic-bezier(0.45, 0, 0.55, 1) both;',
    'animation: document-scene-ink-move 7200ms steps(1) both;',
  ],
  [
    'the-state-before-the-move',
    STYLE,
    `  0%,
  55% {
    opacity: 0;
  }
  63%,
  100% {
    opacity: 1;
  }`,
    `  0%,
  5% {
    opacity: 0;
  }
  13%,
  100% {
    opacity: 1;
  }`,
  ],
  [
    'the-state-never-shows',
    STYLE,
    `  63%,
  100% {
    opacity: 1;
  }`,
    `  63%,
  100% {
    opacity: 0;
  }`,
  ],
  [
    'the-sentences-stack',
    STYLE,
    `.document-scene__act-line {
  grid-area: 1 / 1;`,
    `.document-scene__act-line {`,
  ],
  ['the-relation-in-every-act', SCENE, "{playing.id === 'names' && (", '{('],
  [
    'seen-by-the-whole-scene',
    SCENE,
    `    const target =
      element.current?.querySelector('.document-scene__stage') ??
      element.current;`,
    `    const target = element.current;`,
  ],
  [
    'hidden-buttons-take-the-focus',
    STYLE,
    `.document-scene__source-list[data-current='false'] {
  visibility: hidden;
}`,
    `.document-scene__source-list[data-current='false'] {
  visibility: visible;
}`,
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
  spawnSync(process.execPath, ['--experimental-strip-types', acceptance], {
    ...options(root),
    env: {
      ...process.env,
      STAGE_ACTS_DIST: join(tree, 'dist'),
      STAGE_ACTS_DIR: join(tree, 'work/stage-acts'),
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
