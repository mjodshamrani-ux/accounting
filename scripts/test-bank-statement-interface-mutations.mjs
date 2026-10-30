// BNK-PDF-1 G5 interface mutations: each planted defect in the bank
// statement interface, its wiring into the bank workspace or the page-sized
// PDF reading on the main thread is built into a private copy
// of the application, and the browser acceptance (quick mode, against that
// build) must fail with an assertion. A survivor is behaviour no browser
// check holds.
//   node scripts/test-bank-statement-interface-mutations.mjs
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
  process.env.BNK_INTERFACE_MUTATION_DIR ??
  join(root, 'work/bank-statement-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/bank-statement-workspace-browser.mjs';
const CMP = 'components/bank-statement-workspace.tsx';
const BANK = 'components/bank-workspace.tsx';
const PDF = 'lib/reconciliation/pdf.ts';
const mutations = [
  [
    'accept-without-reason',
    CMP,
    'disabled={locked || !can.accept}',
    'disabled={locked}',
  ],
  [
    'accept-sends-reject',
    CMP,
    "onClick={() => void s.decide(k, 'accept')}",
    "onClick={() => void s.decide(k, 'reject')}",
  ],
  [
    'decision-drops-earlier-ones',
    CMP,
    'state([...result.decisions, decision]),',
    'state([decision]),',
  ],
  [
    'table-period-dropped',
    CMP,
    'period: start && end ? { start, end } : null,',
    'period: null,',
  ],
  [
    'table-closing-dropped',
    CMP,
    'confirmedClosing: closingMinor,',
    'confirmedClosing: null,',
  ],
  [
    'new-file-keeps-result',
    CMP,
    '      setBusy(false);\n      invalidate();\n',
    '      setBusy(false);\n',
  ],
  [
    'held-shows-engine-reason',
    CMP,
    '{c.held[held.kind]} {held.detail && heldText(held.detail)}',
    '{r.match.held.reason} {held.detail && heldText(held.detail)}',
  ],
  // The held detail in the reader's own words and minor units, and the
  // reader's detail no longer one click away.
  [
    'held-detail-as-written',
    CMP,
    '{c.held[held.kind]} {held.detail && heldText(held.detail)}',
    '{c.held[held.kind]} {held.detail}',
  ],
  [
    'held-raw-detail-dropped',
    CMP,
    '<code>{held.detail}</code>',
    '<code>{c.heldRaw}</code>',
  ],
  [
    'save-without-decisions',
    CMP,
    "'bank-statement-save',\n            state(result.decisions),",
    "'bank-statement-save',\n            state([]),",
  ],
  [
    'export-without-decisions',
    CMP,
    '{ state: state(result.decisions), result }',
    '{ state: state([]), result }',
  ],
  [
    'outstanding-origin-unlabelled',
    CMP,
    "o.origin === 'unmatched' ? c.unmatched : c.rejectedIn(o.origin)",
    'c.unmatched',
  ],
  [
    'status-label-fixed',
    CMP,
    'c.caseStatus[k.status],',
    "c.caseStatus['needs-review'],",
  ],
  [
    'automatic-table-shows-every-case',
    CMP,
    "items={r.cases.filter((k) => k.kind === 'automatic')}",
    'items={r.cases}',
  ],
  ['cancel-hidden', CMP, '{s.busy && (', '{false && ('],
  [
    'statement-session-restored-as-movements',
    BANK,
    "if (bankSessionFormat(buffer) === 'statement') {",
    'if (false) {',
  ],
  [
    'statement-path-by-default',
    BANK,
    "useState<'movements' | 'statement'>('movements')",
    "useState<'movements' | 'statement'>('statement')",
  ],
  ['pages-read-without-turns', PDF, '      await yieldBetweenPages?.();\n', ''],
  // The client re-reading its originals on every decision is not planted
  // here: read in page-sized turns, it lengthens the decision without a long
  // task, so no budget can see it. The G5 node gate holds it by counting
  // reads (scripts/test-bank-statement-g5-mutations.mjs).
];
// Everything `pnpm build` reads; the acceptance and the frozen statements are
// used from the reviewed tree, against the private build.
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
        BNK_G4_DIST: join(tree, 'dist'),
        BNK_G4_BROWSER_QUICK: '1',
        BNK_G4_BROWSER_DIR: join(tree, 'work/browser'),
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
