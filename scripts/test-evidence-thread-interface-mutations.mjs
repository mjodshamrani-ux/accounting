// UX-10(c) interface mutations: each planted defect in the evidence thread
// (the drawer's place over the page, its side, width and height, its motion
// and reduced motion, Escape, its named region and focused heading, the way
// back that closes it on the movement's own page, the marked row, the way in
// that names its movement and says the drawer is open, what closes it, and
// what it says of the source) is built into a private copy of the
// application, and the evidence thread check
// (scripts/evidence-thread-browser.mjs, against that build) must fail with an
// assertion. It passes on the unmutated build first. A survivor is behaviour
// no browser check holds.
//
// Not planted: the drawer's motion outside its reduced-motion guard. The
// page's own rule (app/globals.css) sets every animation to none under
// reduced motion, so that mutant draws the same page; it survived its first
// run as an equivalent mutant (docs/audits/UX-10-EVIDENCE-THREAD.ar.md §9).
// Nor the shared hook's return to the row's page: the comparison tables of
// the asset and payroll examples hold one page, so no check can see it there
// (the bank's own way back to its page is planted above).
//   node scripts/test-evidence-thread-interface-mutations.mjs
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
  describeRun,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.EVIDENCE_THREAD_MUTATION_DIR ??
  join(root, 'work/evidence-thread-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/evidence-thread-browser.mjs';
const DRAWER = 'components/evidence-drawer.tsx';
const STYLE = 'components/evidence-drawer.css';
const BANK = 'components/bank-workspace.tsx';
const ASSETS = 'components/fixed-assets-workspace.tsx';
const PAYROLL = 'components/payroll-workspace.tsx';
const HOOK = 'hooks/use-evidence-thread.ts';
const mutations = [
  [
    'drawer-in-the-page',
    STYLE,
    `  position: fixed;
  z-index: 35;`,
    `  position: static;
  z-index: 35;`,
  ],
  [
    'drawer-at-the-start',
    STYLE,
    `  inset-inline-end: 0;
  inline-size: 420px;`,
    `  inset-inline-start: 0;
  inline-size: 420px;`,
  ],
  ['drawer-too-wide', STYLE, 'inline-size: 420px;', 'inline-size: 640px;'],
  ['sheet-too-tall', STYLE, 'max-block-size: 70vh;', 'max-block-size: 90vh;'],
  [
    'sheet-covers-the-page',
    STYLE,
    '    scroll-padding-block-end: 70vh;',
    '    scroll-padding-block-end: 0;',
  ],
  [
    'motion-too-slow',
    STYLE,
    'animation: evidence-drawer-in 160ms ease-out;',
    'animation: evidence-drawer-in 600ms ease-out;',
  ],
  [
    'escape-ignored',
    DRAWER,
    `    element?.addEventListener('keydown', escape);
`,
    '',
  ],
  [
    'region-unnamed',
    DRAWER,
    `      aria-labelledby={\`\${id}-heading\`}
`,
    '',
  ],
  [
    'heading-not-focusable',
    DRAWER,
    'ref={headingRef} tabIndex={-1}',
    'ref={headingRef}',
  ],
  [
    'another-row-named',
    DRAWER,
    '<dd data-thread-row={s.place.row}>{s.place.row}</dd>',
    '<dd data-thread-row={s.place.row}>{s.place.row - 1}</dd>',
  ],
  [
    'header-for-text',
    DRAWER,
    `              c.column,
              c.text,`,
    `              c.column,
              c.field,`,
  ],
  [
    'focus-stays-on-the-row',
    BANK,
    `    setFocusRequest({ to: 'evidence', id: record });
`,
    '',
  ],
  [
    'way-back-keeps-it-open',
    BANK,
    `    setFocusRequest({ to: 'row', id: evidenceId });
    setEvidenceId('');`,
    `    setFocusRequest({ to: 'row', id: evidenceId });`,
  ],
  [
    'way-back-keeps-the-page',
    BANK,
    `    setPages((p) => ({ ...p, movements: pageOfRow(index) }));
    setFocusRequest({ to: 'row', id: evidenceId });`,
    `    setFocusRequest({ to: 'row', id: evidenceId });`,
  ],
  [
    'row-not-marked',
    BANK,
    "                      ? { 'data-thread-open': '' }",
    '                      ? undefined',
  ],
  [
    'way-in-unnamed',
    BANK,
    `                        {' · '}
                        {r.reference}`,
    '',
  ],
  [
    'open-not-said',
    BANK,
    `                      aria-expanded={evidenceId === r.id}
`,
    '',
  ],
  [
    'drawer-not-named',
    BANK,
    '                        evidenceId === r.id ? drawerId : undefined',
    '                        undefined',
  ],
  [
    'type-change-keeps-it',
    BANK,
    `    if (!movementsShown) setEvidenceId('');
`,
    '',
  ],
  [
    'new-result-keeps-it',
    BANK,
    `    setResult(v.result);
    setPages({});
    setBankId('');
    setCashId('');
    setEvidenceId('');`,
    `    setResult(v.result);
    setPages({});
    setBankId('');
    setCashId('');`,
  ],
  [
    'amount-left-out',
    BANK,
    `                    amount={amount(evidence.signed)}
`,
    '',
  ],
  [
    'thread-of-another-movement',
    BANK,
    'thread={bankThread(result, evidence.id)}',
    'thread={bankThread(result, result.records[0].id)}',
  ],
  // UX-10(d): the fixed assets and the payroll, through the shared hook.
  [
    'asset-thread-of-the-first-comparison',
    ASSETS,
    `                    opened.at,
`,
    `                    0,
`,
  ],
  [
    'asset-roles-all-register',
    ASSETS,
    'role={(s) => copy.roles[s.source]}',
    'role={() => copy.roles[0]}',
  ],
  [
    'asset-difference-figure-left-out',
    ASSETS,
    '[copy.comparisons[5], opened.row.difference],',
    '[copy.comparisons[5], opened.row.register],',
  ],
  [
    'payroll-bank-rows-left-out',
    PAYROLL,
    'thread={payrollBankThread(result, labels)}',
    'thread={[]}',
  ],
  [
    'payroll-thread-of-the-first-comparison',
    PAYROLL,
    'thread={payrollThread(result, labels, thread.open.at)}',
    'thread={payrollThread(result, labels, 0)}',
  ],
  [
    'hook-keeps-it-on-type-change',
    HOOK,
    `    setSeen({ shown, result });
    setOpen(null);`,
    `    setSeen({ shown, result });`,
  ],
  [
    'hook-way-back-keeps-it-open',
    HOOK,
    `      setFocus({ ...open, to: 'row' });
      setOpen(null);`,
    `      setFocus({ ...open, to: 'row' });`,
  ],
  [
    'hook-focus-stays',
    HOOK,
    '    element?.focus({ preventScroll: true });',
    '',
  ],
  [
    'hook-drawer-not-named',
    HOOK,
    "'aria-controls': isOpen(table, at) ? id : undefined,",
    "'aria-controls': undefined,",
  ],
  [
    'hook-row-not-marked',
    HOOK,
    "isOpen(table, at) ? { 'data-thread-open': '' } : undefined,",
    'undefined,',
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
      EVIDENCE_THREAD_DIST: join(tree, 'dist'),
      EVIDENCE_THREAD_DIR: join(tree, 'work/evidence-thread'),
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
    if (!report.baselinePassed)
      process.stderr.write(describeRun('baseline', baseline, 'failed'));
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
      // A mutant that does not build is not a caught behaviour.
      const killed = !result.buildFailed && isAssertionKill(result);
      if (!killed)
        process.stderr.write(describeRun(id, result, 'was not caught'));
      report.mutations.push({
        id,
        file,
        killed,
        buildFailed: !!result.buildFailed,
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
      });
    } catch (error) {
      process.stderr.write(`${id} did not run: ${error.stack}\n`);
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
