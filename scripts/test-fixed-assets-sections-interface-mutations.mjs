// FA-1c interface mutations: each planted defect in how the fixed assets
// workspace shows the sections review is built into a private copy of the
// application, and the sections browser acceptance
// (scripts/fixed-assets-sections-browser.mjs, against that build) must fail
// with an assertion. A survivor is behaviour no check holds.
//   node scripts/test-fixed-assets-sections-interface-mutations.mjs
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
  process.env.FA_SECTIONS_INTERFACE_MUTATION_DIR ??
  join(root, 'work/fixed-assets-sections-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const acceptance = 'scripts/fixed-assets-sections-browser.mjs';
const PANEL = 'components/fixed-assets-sections-panel.tsx';
const COPY = 'lib/i18n/fixed-assets-sections.ts';
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
    'review-without-reading-confirmation',
    PANEL,
    'const ready = files.every((f) => f?.confirmed) && scopeConfirmed;',
    'const ready = files.every((f) => !!f) && scopeConfirmed;',
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
    'scope: { ...scope, confirmed: true } as AssetSectionsScope,',
    'scope: { ...scope, confirmed: false } as unknown as AssetSectionsScope,',
  ],
  [
    'refusal-code-replaced',
    PANEL,
    'data-fas-refused={refused}',
    'data-fas-refused="SOURCE"',
  ],
  [
    'refusal-heading-without-code',
    PANEL,
    '              <bdi>{refused}</bdi>)',
    '              <bdi></bdi>)',
  ],
  [
    'refusal-shown-as-failure',
    PANEL,
    'if (!code || !Object.hasOwn(copy.refusals, code)) throw failure;',
    'throw failure;',
  ],
  [
    'two-decimals-always',
    PANEL,
    'const decimals = result?.decimals ?? 2;',
    'const decimals = 2;',
  ],
  [
    'negative-sign-dropped',
    PANEL,
    '  return value < 0 ? `-${text}` : text;',
    '  return text;',
  ],
  [
    'gl-shown-as-register',
    PANEL,
    '                amount(a.register),\n                amount(a.gl),\n',
    '                amount(a.register),\n                amount(a.register),\n',
  ],
  [
    'no-member-shown-as-one',
    PANEL,
    'String(a.members.length),',
    'String(a.members.length || 1),',
  ],
  [
    'every-account-consistent',
    PANEL,
    '                copy.status[a.status],\n                coded(a.codes),\n              ])}\n              marks={result.accounts',
    '                copy.status.consistent,\n                coded(a.codes),\n              ])}\n              marks={result.accounts',
  ],
  [
    'codes-without-code',
    PANEL,
    "? codes.map((c) => `${copy.codes[c] ?? c} (${c})`).join('; ')",
    "? codes.map((c) => `${copy.codes[c] ?? c}`).join('; ')",
  ],
  [
    'run-codes-hidden',
    PANEL,
    '{result.run.length > 0 && (',
    '{false && (',
  ],
  [
    'unmapped-hidden',
    PANEL,
    '{result.unmapped.length > 0 && (',
    '{false && (',
  ],
  [
    'unplaced-hidden',
    PANEL,
    '{result.unplaced.length > 0 && (',
    '{false && (',
  ],
  [
    'section-end-row-as-start',
    PANEL,
    's[1] === null ? copy.none : String(s[1]),',
    's[1] === null ? copy.none : String(s[0]),',
  ],
  [
    'excluded-section-shown-held',
    PANEL,
    'copy.status[s[5]],',
    "copy.status[s[5] === 'excluded' ? 'held' : s[5]],",
  ],
  [
    'carrying-derived',
    PANEL,
    'amount(a.amounts.carrying),',
    'amount(\n                  a.amounts.cost === null || a.amounts.depreciation === null\n                    ? null\n                    : a.amounts.cost - a.amounts.depreciation,\n                ),',
  ],
  [
    'unread-rows-dropped',
    PANEL,
    '                  ...a.unread,\n',
    '',
  ],
  [
    'valuation-hidden',
    PANEL,
    'a.valuation ?? copy.none,',
    'copy.none,',
  ],
  ['assets-pager-unmarked', PANEL, 'pager="assets"', 'pager="asset-list"'],
  [
    'summary-sections-as-assets',
    PANEL,
    '                result.sections.length,\n                result.assets.length,\n              ])}',
    '                result.assets.length,\n                result.assets.length,\n              ])}',
  ],
  [
    'blank-rows-uncounted',
    PANEL,
    'data-fas-inventory={JSON.stringify(result.inventory.register)}',
    'data-fas-inventory={JSON.stringify({\n                ...result.inventory.register,\n                blank: 0,\n              })}',
  ],
  [
    'arabic-code-in-english',
    COPY,
    "    MAP_CLASS: 'صف خريطة بفئة حساب أخرى',",
    "    MAP_CLASS: 'A map row of another account class',",
  ],
  // Added on 30 October with the Arabic pass over every story and the
  // refusal words: none is caught by F15 in Arabic or by the code in
  // brackets alone.
  [
    'refusal-words-dropped',
    PANEL,
    '{copy.refused}: {copy.refusals[refused] ?? refused} (',
    '{copy.refused}: {refused} (',
  ],
  [
    'arabic-refusal-word-english',
    COPY,
    "    SOURCE: 'تعذرت قراءة ملف لقطة CSV',",
    "    SOURCE: 'A file could not be read as a CSV snapshot',",
  ],
  [
    'arabic-code-word-of-another',
    COPY,
    "    TOTAL_MISMATCH: 'مجموع قسم ليس مجموع صفوفه',",
    "    TOTAL_MISMATCH: 'مجموع قسم لا يُقرأ أو لا يمكن فحصه',",
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
        FA_SECTIONS_DIST: join(tree, 'dist'),
        FA_SECTIONS_BROWSER_DIR: join(tree, 'work/browser'),
        // Stop at the first story that differs, by the same assertion.
        FA_SECTIONS_FAIL_FAST: '1',
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
