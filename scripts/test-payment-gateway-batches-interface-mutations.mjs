// PG-1c interface mutations: each planted defect in how the payment gateway
// workspace shows the batches and deposits review is built into a private
// copy of the application, and the batches browser acceptance
// (scripts/payment-gateway-batches-browser.mjs, against that build) must fail
// with an assertion. A survivor is behaviour no check holds.
//   node scripts/test-payment-gateway-batches-interface-mutations.mjs
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
  process.env.PG_BATCHES_INTERFACE_MUTATION_DIR ??
  join(root, 'work/payment-gateway-batches-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/payment-gateway-batches-browser.mjs';
const PANEL = 'components/payment-gateway-batches-panel.tsx';
const COPY = 'lib/i18n/payment-gateway-batches.ts';
const mutations = [
  [
    'stale-review-kept-on-new-file',
    PANEL,
    '                            all.map((v, i) => (i === side ? next : v)),\n                          );\n                          invalidate();\n',
    '                            all.map((v, i) => (i === side ? next : v)),\n                          );\n',
  ],
  [
    'new-file-arrives-confirmed',
    PANEL,
    '                            sha256,\n                            confirmed: false,\n',
    '                            sha256,\n                            confirmed: true,\n',
  ],
  [
    'scope-confirmation-kept-on-change',
    PANEL,
    '                    setScope({ ...scope, [k]: e.target.value });\n                    setScopeConfirmed(false);\n',
    '                    setScope({ ...scope, [k]: e.target.value });\n',
  ],
  [
    'review-without-scope-confirmation',
    PANEL,
    'const ready = files.every((f) => f?.confirmed) && scopeConfirmed;',
    'const ready = files.every((f) => f?.confirmed);',
  ],
  [
    'scope-sent-unconfirmed',
    PANEL,
    'scope: { ...scope, confirmed: true } as GatewayBatchesScope,',
    'scope: { ...scope, confirmed: false } as unknown as GatewayBatchesScope,',
  ],
  [
    'refusal-code-replaced',
    PANEL,
    'data-pgb-refused={refusal}',
    'data-pgb-refused="SOURCE"',
  ],
  [
    'refusal-heading-without-code',
    PANEL,
    '              <bdi>{refusal}</bdi>)',
    '              <bdi></bdi>)',
  ],
  [
    'refusal-shown-as-failure',
    PANEL,
    'if (!code || !Object.hasOwn(copy.refusals, code)) throw failure;',
    'throw failure;',
  ],
  [
    'row-errors-hidden',
    PANEL,
    '            {result?.refused && (',
    '            {false && (',
  ],
  [
    'sales-members-and-row-swapped',
    PANEL,
    'pair(b.components.sales, b.settlement.gross),',
    'pair(b.settlement.gross, b.components.sales),',
  ],
  [
    'refund-members-from-sales',
    PANEL,
    'pair(b.components.refunds, b.settlement.refunds),',
    'pair(b.components.sales - b.components.sales, b.settlement.refunds),',
  ],
  [
    'paid-shown-as-net',
    PANEL,
    '                amount(b.settlement.net),\n                amount(b.paid),\n',
    '                amount(b.settlement.net),\n                amount(b.settlement.net),\n',
  ],
  [
    'first-payout-only',
    PANEL,
    'b.payouts.length ? b.payouts.join(copy.list) : copy.none,',
    'b.payouts.length ? b.payouts[0] : copy.none,',
  ],
  [
    'sale-rows-not-shown',
    PANEL,
    '                rowList(b.sales),\n',
    '                copy.none,\n',
  ],
  [
    'every-batch-consistent',
    PANEL,
    '                copy.status[b.status],\n',
    '                copy.status.consistent,\n',
  ],
  [
    'reasons-without-code',
    PANEL,
    "? codes.map((c) => `${copy.reasons[c] ?? c} (${c})`).join('; ')",
    "? codes.map((c) => `${copy.reasons[c] ?? c}`).join('; ')",
  ],
  [
    'bank-credit-shown-as-lines',
    PANEL,
    'p.credit ? amount(p.credit.amount) : copy.none,',
    'p.credit ? amount(p.amount) : copy.none,',
  ],
  [
    'in-transit-payout-shown-consistent',
    PANEL,
    '                copy.status[p.status],\n',
    "                copy.status[p.status === 'in-transit' ? 'consistent' : p.status],\n",
  ],
  [
    'unlinked-credits-hidden',
    PANEL,
    '{result.credits.length > 0 && (',
    '{false && (',
  ],
  ['batches-pager-unmarked', PANEL, 'pager="batches"', 'pager="batch-list"'],
  [
    'reason-counts-of-one-dropped',
    PANEL,
    '.filter(([, n]) => n)',
    '.filter(([, n]) => n > 1)',
  ],
  [
    'summary-payouts-as-credits',
    PANEL,
    '                result.payouts.length,\n                result.credits.length,\n              ])}',
    '                result.credits.length,\n                result.credits.length,\n              ])}',
  ],
  [
    'arabic-reason-in-english',
    COPY,
    "    NOT_DEPOSITED: 'لا إيداع بنكي يسمي الإيداع حتى تاريخ «كما في»',",
    "    NOT_DEPOSITED: 'No bank credit names the payout by the as-of date',",
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
        PG_BATCHES_DIST: join(tree, 'dist'),
        PG_BATCHES_BROWSER_DIR: join(tree, 'work/browser'),
        // Stop at the first story that differs, by the same assertion.
        PG_BATCHES_FAIL_FAST: '1',
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
