// UX-3 decision platform interface mutations: each planted defect in the
// platform the workspaces share (the sentence under the decision buttons,
// the buttons it describes, the focus after a decision and the page that
// shows the item decided on, and the reasons of the other closed buttons)
// is built into a private copy of the application, and the decision
// platform browser acceptance (scripts/decision-platform-browser.mjs,
// against that build) must fail with an assertion. A survivor is behaviour
// no check holds.
//   node scripts/test-decision-platform-interface-mutations.mjs
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
  process.env.DECISION_PLATFORM_INTERFACE_MUTATION_DIR ??
  join(root, 'work/decision-platform-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/decision-platform-browser.mjs';
const KIT = 'components/decision-platform.tsx';
const LOGIC = 'lib/decision-platform.ts';
const COPY = 'lib/i18n/decision-platform.ts';
const mutations = [
  [
    'buttons-undescribed',
    KIT,
    '          aria-describedby={describedBy}\n',
    '',
  ],
  [
    'hint-names-one-field',
    COPY,
    '`اكتب «${reference}» و«${reason}» لتُفتح القرارات.`',
    '`اكتب «${reference}» لتُفتح القرارات.`',
  ],
  [
    'hint-hidden',
    KIT,
    '      className="decision-hint"\n      data-decision-hint={key}',
    '      className="decision-hint"\n      hidden\n      data-decision-hint={key}',
  ],
  [
    'focus-not-returned',
    KIT,
    '    element?.focus({ preventScroll: true });\n',
    '',
  ],
  [
    'pair-focus-nowhere',
    'components/intercompany-workspace.tsx',
    '        settle(headingAt(at));',
    "        settle('');",
  ],
  [
    'accept-ignores-its-block',
    LOGIC,
    '    accept: free && pending && d.acceptBlock === null,',
    '    accept: free && pending,',
  ],
  [
    'hint-ignores-the-fields',
    LOGIC,
    '  if (need) return { key: need, accept: null };',
    "  if (need && need === 'members') return { key: need, accept: null };",
  ],
  ['closed-reason-hidden', KIT, '      hidden={!closed}', '      hidden'],
  [
    'fields-undescribed',
    'components/payroll-workspace.tsx',
    '                  aria-describedby={hint}\n                  maxLength={2000}\n                  value={reference}',
    '                  maxLength={2000}\n                  value={reference}',
  ],
  // Step 3b: receivables, clearing, allocation and the bank.
  [
    'note-length-unnamed',
    KIT,
    '      {ready ? children : decisionPlatformCopy[lang].note(label, NOTE_MINIMUM)}',
    '      {children}',
  ],
  [
    'note-minimum-ignored',
    LOGIC,
    'export const noteReady = (note: string) => note.trim().length >= NOTE_MINIMUM;',
    'export const noteReady = (note: string) => note.trim().length > 0;',
  ],
  [
    'decided-pair-page-forgotten',
    'components/ar-workspace.tsx',
    '      setPage(pageOfRow(at));\n      settle(headingAt(at));',
    '      settle(headingAt(at));',
  ],
  [
    'decided-pair-focus-nowhere',
    'components/ar-workspace.tsx',
    '      setPage(pageOfRow(at));\n      settle(headingAt(at));',
    '      setPage(pageOfRow(at));',
  ],
  [
    'clearing-takes-any-selection',
    'components/clearing-workspace.tsx',
    "disabled={busy || selection !== 'ready' || !noteReady(note)}",
    'disabled={busy || selected.length < 2 || !noteReady(note)}',
  ],
  [
    'clearing-focus-nowhere',
    'components/clearing-workspace.tsx',
    '      settle(rowAt(at));',
    "      settle('');",
  ],
  [
    'decided-row-unnamed',
    'components/record-table.tsx',
    '                {...focusTarget(target?.(row, from + i))}\n',
    '',
  ],
  [
    'example-reason-hidden',
    'components/clearing-workspace.tsx',
    '              closed={!!file}',
    '              closed={false}',
  ],
  [
    'advice-wait-unnamed',
    LOGIC,
    '  const advice = !d.selected,',
    '  const advice = false,',
  ],
  [
    'allocation-focus-nowhere',
    'components/allocation-workspace.tsx',
    '        settle(`${eventEntry}-${e.id}`);',
    "        settle('');",
  ],
  [
    'bank-case-focus-nowhere',
    'components/bank-workspace.tsx',
    '      settle(caseAt(at));',
    "      settle('');",
  ],
  [
    'balance-step-hidden',
    'components/bank-adjustment-workspace.tsx',
    '          closed={!!step}',
    '          closed={false}',
  ],
  [
    'balance-lifecycle-focus-nowhere',
    'components/bank-adjustment-workspace.tsx',
    '      settle(cycleAt(at));',
    "      settle('');",
  ],
  [
    'balance-hint-ignores-the-fields',
    'components/bank-adjustment-workspace.tsx',
    "        : (need ?? 'each'),",
    "        : 'each',",
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
        DECISION_PLATFORM_DIST: join(tree, 'dist'),
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
