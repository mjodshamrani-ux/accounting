// UX-6(d) interface mutations: each planted defect in how the page lays the
// reconciliation sheet out for print, prints it alone, composes it for the
// result and the language shown, or waits for it before printing, is built
// into a private copy of the application, and the print check
// (scripts/reconciliation-sheet-print-browser.mjs, against that build) must
// fail with an assertion. A survivor is behaviour no browser check holds.
//   node scripts/test-sheet-print-interface-mutations.mjs
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
  process.env.SHEET_PRINT_MUTATION_DIR ??
  join(root, 'work/sheet-print-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/reconciliation-sheet-print-browser.mjs';
const PAPER = 'lib/reconciliation/sheet-print.ts';
const VIEW = 'components/reconciliation-sheet-print.tsx';
const STYLE = 'components/reconciliation-sheet-print.css';
const GLTB = 'components/gl-tb-workspace.tsx';
const CLEARING = 'components/clearing-workspace.tsx';
const AR = 'components/ar-workspace.tsx';
const BANK = 'components/bank-workspace.tsx';
const ALLOCATION = 'components/allocation-workspace.tsx';
const mutations = [
  [
    'group-loses-its-last-row',
    PAPER,
    'rows: sheet.rows.slice(i, last + 1).map((cells) => printRow(cells, n)),',
    'rows: sheet.rows.slice(i, last).map((cells) => printRow(cells, n)),',
  ],
  [
    'blank-rows-not-drawn',
    VIEW,
    `              ) : (
                <tr key={r} data-sheet-blank="">
                  <td colSpan={paper.widths.length}>{''}</td>
                </tr>
              ),`,
    `              ) : null,`,
  ],
  [
    'amount-without-thousands',
    PAPER,
    ".replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');",
    ';',
  ],
  [
    'amount-in-minor-units',
    PAPER,
    'text: sheetAmountText(cell.minor, cell.decimals),',
    'text: String(cell.minor),',
  ],
  [
    'fingerprint-cut',
    VIEW,
    "{cell.style === 'hash' ? <bdi dir=\"ltr\">{cell.text}</bdi> : cell.text}",
    "{cell.style === 'hash' ? <bdi dir=\"ltr\">{cell.text.slice(0, 16)}</bdi> : cell.text}",
  ],
  [
    'prints-before-composed',
    VIEW,
    'if (!(await pending.current)) return;',
    '',
  ],
  [
    'drawn-on-the-screen',
    STYLE,
    '.sheet-print {\n  display: none;\n}',
    '.sheet-print {\n  display: block;\n}',
  ],
  [
    'whole-page-prints',
    STYLE,
    'display: none !important;',
    'display: revert;',
  ],
  [
    'kept-rows-split',
    STYLE,
    'break-inside: avoid;',
    'break-inside: auto;',
  ],
  // The table is in the page only while the page prints (DEV-105).
  [
    'kept-in-the-page',
    VIEW,
    '() => (printing && sheet ? sheetPrint(sheet) : null),',
    '() => (sheet ? sheetPrint(sheet) : null),',
  ],
  [
    'left-after-printing',
    VIEW,
    'const after = () => setPrinting(false);',
    'const after = () => {};',
  ],
  [
    'drawn-too-late',
    VIEW,
    'flushSync(() => setPrinting(true));',
    'setPrinting(true);',
  ],
  [
    'sheet-outlives-its-composition',
    VIEW,
    'composed && composed.result === result && composed.language === language',
    'composed',
  ],
  [
    'language-not-followed',
    GLTB,
    'useSheetPrint(result, lang, composeSheet)',
    "useSheetPrint(result, 'en', composeSheet)",
  ],
  // The case workspaces compose from the state and result the export sends.
  [
    'clearing-sheet-without-its-decisions',
    CLEARING,
    '{ state: { file, reading, scope, events }, result }',
    '{ state: { file, reading, scope, events: [] }, result }',
  ],
  [
    'ar-language-not-followed',
    AR,
    'useSheetPrint(printed, lang, composeSheet)',
    "useSheetPrint(printed, 'ar', composeSheet)",
  ],
  [
    'bank-table-left-out',
    BANK,
    '<SheetPrint sheet={paper.sheet} />',
    '',
  ],
  [
    'allocation-command-left-out',
    ALLOCATION,
    `            <Button disabled={busy} onClick={paper.print}>
              {sheetPrintCopy[lang].print}
            </Button>
`,
    '',
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
        RECONCILIATION_SHEET_PRINT_DIST: join(tree, 'dist'),
        RECONCILIATION_SHEET_PRINT_DIR: join(tree, 'work/print-browser'),
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
