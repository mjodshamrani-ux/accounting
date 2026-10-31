// INV-2c interface mutations: each planted defect in how the inventory
// workspace's movement bridges section takes the two files and the scope,
// keeps or shows a result is built into a private copy of the application,
// and the section's browser acceptance
// (scripts/inventory-movement-bridge-browser.mjs, against that build) must
// fail with an assertion. A survivor is behaviour no browser check holds.
//   node scripts/test-inventory-movement-bridge-interface-mutations.mjs
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
  process.env.IMB_INTERFACE_MUTATION_DIR ??
  join(root, 'work/inventory-movement-bridge-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/inventory-movement-bridge-browser.mjs';
const PANEL = 'components/inventory-movement-bridge-panel.tsx';
const mutations = [
  [
    'file-confirmation-not-required',
    PANEL,
    'const ready = files.every((f) => f?.confirmed) && scopeConfirmed;',
    'const ready = files.every((f) => f) && scopeConfirmed;',
  ],
  [
    'new-file-keeps-result',
    PANEL,
    '                        place(i, picked);\n                        invalidate();\n',
    '                        place(i, picked);\n',
  ],
  [
    'register-sent-as-gl',
    PANEL,
    '{ name: gl.name, original: gl.original, sha256: gl.sha256 },',
    '{ name: gl.name, original: register.original, sha256: register.sha256 },',
  ],
  [
    'scope-change-keeps-result',
    PANEL,
    '                    dir="auto"\n                    data-imb-scope={k}\n                    onChange={(e) => {\n                      setScope({ ...scope, [k]: e.target.value });\n                      setScopeConfirmed(false);\n                      invalidate();\n',
    '                    dir="auto"\n                    data-imb-scope={k}\n                    onChange={(e) => {\n                      setScope({ ...scope, [k]: e.target.value });\n',
  ],
  [
    'negative-choice-keeps-result',
    PANEL,
    '                  <select\n                    value={scope[k]}\n                    data-imb-scope={k}\n                    onChange={(e) => {\n                      setScope({ ...scope, [k]: e.target.value });\n                      setScopeConfirmed(false);\n                      invalidate();\n',
    '                  <select\n                    value={scope[k]}\n                    data-imb-scope={k}\n                    onChange={(e) => {\n                      setScope({ ...scope, [k]: e.target.value });\n',
  ],
  [
    'negative-choice-not-sent',
    PANEL,
    'scope: { confirmed: true, fields: { ...scope } },',
    "scope: { confirmed: true, fields: { ...scope, 'Negative balances': 'allowed' } },",
  ],
  [
    'status-always-judged',
    PANEL,
    "data-imb-status={result.refused ? 'refused' : 'judged'}",
    'data-imb-status="judged"',
  ],
  [
    'refusal-always-scope',
    PANEL,
    'data-imb-refused={result.refused}',
    'data-imb-refused="SCOPE"',
  ],
  [
    'verdict-always-english',
    PANEL,
    '<h3 data-imb-verdict>{copy.judged}</h3>',
    '<h3 data-imb-verdict>{inventoryMovementBridgeCopy.en.judged}</h3>',
  ],
  [
    'run-codes-not-shown',
    PANEL,
    '{result.run.length > 0 && (',
    '{false && result.run.length > 0 && (',
  ],
  [
    'position-status-of-the-first',
    PANEL,
    "'data-imb-position-status': p.status,",
    "'data-imb-position-status': result.positions[0].status,",
  ],
  [
    'position-codes-shown-partly',
    PANEL,
    "'data-imb-position-codes': p.codes.join(' '),",
    "'data-imb-position-codes': p.codes.slice(0, 1).join(' '),",
  ],
  [
    'inflow-column-shows-outflows',
    PANEL,
    'pair(p.flows && flowSum(p.flows, IMB_INFLOWS)),',
    'pair(p.flows && flowSum(p.flows, IMB_OUTFLOWS)),',
  ],
  [
    'printed-closing-shows-computed',
    PANEL,
    'pair(p.closing),',
    'pair(p.computed),',
  ],
  [
    'quantity-with-value-decimals',
    PANEL,
    '<Quantity scaled={scaled} precision={3} />',
    '<Quantity scaled={scaled} precision={decimals} />',
  ],
  [
    'flows-not-shown',
    PANEL,
    '{result.positions.some((p) => p.flows) && (',
    '{false && result.positions.some((p) => p.flows) && (',
  ],
  [
    'lines-not-shown',
    PANEL,
    '{result.positions.some((p) => p.lines) && (',
    '{false && result.positions.some((p) => p.lines) && (',
  ],
  [
    'line-under-the-first-position',
    PANEL,
    "'data-imb-line': JSON.stringify([p.key, l.id]),",
    "'data-imb-line': JSON.stringify([result.positions[0].key, l.id]),",
  ],
  [
    'account-status-of-the-first',
    PANEL,
    "'data-imb-account-status': a.status,",
    "'data-imb-account-status': result.accounts[0].status,",
  ],
  [
    'account-codes-shown-partly',
    PANEL,
    "'data-imb-account-codes': a.codes.join(' '),",
    "'data-imb-account-codes': a.codes.slice(0, 1).join(' '),",
  ],
  ['difference-shows-gl', PANEL, 'side(a.difference),', 'side(a.gl),'],
  [
    'excluded-not-shown',
    PANEL,
    "['excluded', result.excluded, copy.excluded],",
    "['excluded', [], copy.excluded],",
  ],
  [
    'dated-shows-excluded',
    PANEL,
    "['dated', result.datedOutside, copy.dated],",
    "['dated', result.excluded, copy.dated],",
  ],
  [
    'unseen-not-shown',
    PANEL,
    '{result.unseenOrigins.length > 0 && (',
    '{false && result.unseenOrigins.length > 0 && (',
  ],
  [
    'repeated-not-shown',
    PANEL,
    '{result.repeatedHeaders.length > 0 && (',
    '{false && result.repeatedHeaders.length > 0 && (',
  ],
  [
    'unplaced-not-shown',
    PANEL,
    '{result.unplaced.length > 0 && (',
    '{false && result.unplaced.length > 0 && (',
  ],
  ['totals-never-shown', PANEL, '{result.totals ? (', '{false ? ('],
  [
    'transferred-shows-opening',
    PANEL,
    'amount(result.totals![k])',
    "amount(result.totals![k === 'transferred' ? 'opening' : k])",
  ],
  [
    'decimals-fixed-at-two',
    PANEL,
    'const decimals = result?.decimals ?? 2;',
    'const decimals = 2;',
  ],
  [
    // The bridge's amounts, kept as integer strings, take their sign from
    // the shared formatter.
    'minus-sign-dropped',
    'lib/amount-text.ts',
    "return `${negative ? '-' : ''}${whole}",
    'return `${whole}',
  ],
  [
    'every-page-shows-the-first',
    PANEL,
    'rows.slice(safe * 50, safe * 50 + 50)',
    'rows.slice(0, 50)',
  ],
  [
    'last-page-unreachable',
    PANEL,
    'disabled={safe + 1 >= pages}',
    'disabled={safe + 2 >= pages}',
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
        IMB_DIST: join(tree, 'dist'),
        IMB_BROWSER_DIR: join(tree, 'work/browser'),
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
