// UX-3 decision platform in the source-reading reviews: each planted defect
// (a sentence that hides what a decision waits for, a closed button that no
// longer says why, a decision that leaves the focus on the page) is built
// into a private copy of the application, and the browser check of that
// review must fail with an assertion against that build. The supplier
// review sections are checked by their own browser checks, the other
// reviews by scripts/review-platform-browser.mjs, one review at a time. A
// survivor is behaviour no check holds. The section checks run in the
// native Chrome that MIZAN_CHROMIUM names, as the build job runs them.
//   MIZAN_CHROMIUM=/usr/bin/google-chrome node scripts/test-review-platform-interface-mutations.mjs
import assert from 'node:assert/strict';
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
// Without it the section checks fail before any review, so the baseline
// fails with no reason in the report; say it here instead.
assert.ok(
  process.env.MIZAN_CHROMIUM,
  'Set MIZAN_CHROMIUM to the native Chrome the section checks run in',
);
const output =
  process.env.REVIEW_PLATFORM_INTERFACE_MUTATION_DIR ??
  join(root, 'work/review-platform-interface-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const KIT = 'components/decision-platform.tsx';
const OVERLAP = 'components/invoice-overlap-review.tsx';
const PAGE = 'app/page.tsx';
const TRANSACTION = 'components/transaction-review.tsx';
const PDF = 'components/pdf-review.tsx';
// Each review's browser check, as the gate runs it against a built copy:
// the arguments, and where its own records go.
const acceptances = {
  overlap: [
    '--experimental-strip-types',
    'scripts/supplier-main-overlap-browser.mjs',
    '--skip-pending-allocation',
  ],
  split: ['scripts/split-section-browser.mjs'],
  running: [
    '--experimental-strip-types',
    'scripts/running-balance-browser.mjs',
  ],
  multiline: ['scripts/multiline-source-review-browser-test.mjs'],
  sections: [
    '--experimental-strip-types',
    'scripts/section-families-browser.mjs',
  ],
  review: ['--experimental-strip-types', 'scripts/review-platform-browser.mjs'],
};
const mutations = [
  {
    id: 'overlap-commit-hint-says-open',
    file: OVERLAP,
    from: '<ReviewHint id={hint} needs={commitNeeds} opens={t.commit} />',
    to: '<ReviewHint id={hint} needs={[]} opens={t.commit} />',
    acceptance: 'overlap',
  },
  {
    id: 'overlap-commit-undescribed',
    file: OVERLAP,
    from: '                      type="button"\n                      aria-describedby={`${hint} ${blockedWhy}`}\n                      disabled={\n                        active ||\n                        !!mainReview?.blockedReason ||\n                        !current.snapshot.search.searchComplete',
    to: '                      type="button"\n                      disabled={\n                        active ||\n                        !!mainReview?.blockedReason ||\n                        !current.snapshot.search.searchComplete',
    acceptance: 'overlap',
  },
  {
    id: 'overlap-commit-focus-nowhere',
    file: OVERLAP,
    from: '}, () => settle(`${hint}-receipt`, title))',
    to: '}, () => undefined)',
    acceptance: 'overlap',
  },
  {
    id: 'overlap-exports-unexplained',
    file: OVERLAP,
    from: '            closed={!current.state.receipts.length}',
    to: '            closed={false}',
    acceptance: 'overlap',
  },
  {
    id: 'focus-fallback-ignored',
    file: KIT,
    from: '(target.fallback ? document.getElementById(target.fallback) : null);',
    to: 'null;',
    acceptance: 'overlap',
  },
  {
    id: 'split-focus-nowhere',
    file: 'components/split-section-review.tsx',
    from: '      settle(next ? receiptLine : rejectedLine);',
    to: "      settle('');",
    acceptance: 'split',
  },
  {
    id: 'running-reading-unexplained',
    file: 'components/running-balance-review.tsx',
    from: '            closed={!!inspectWait}',
    to: '            closed={false}',
    acceptance: 'running',
  },
  {
    id: 'multiline-focus-nowhere',
    file: 'components/multiline-source-review.tsx',
    from: '    refresh();\n    settle(stateLine);\n  }',
    to: '    refresh();\n  }',
    acceptance: 'multiline',
  },
  {
    id: 'multiline-applying-unexplained',
    file: 'components/multiline-source-review.tsx',
    from: "                closed={\n                  !['approved', 'applying', 'applied'].includes(view.phase)\n                }",
    to: '                closed={false}',
    acceptance: 'multiline',
  },
  {
    id: 'derived-focus-nowhere',
    file: 'components/section-derived-review.tsx',
    from: '        if (result.receipt) settle(receiptLine);',
    to: "        if (result.receipt) settle('');",
    acceptance: 'sections',
  },
  {
    id: 'transaction-hint-skips-the-reason',
    file: TRANSACTION,
    from: '  const hintKey = !note.trim()',
    to: '  const hintKey = false',
    acceptance: 'review',
    only: 'transaction',
  },
  {
    id: 'transaction-decision-focus-lost',
    file: PAGE,
    from: '        if (decided) returnToCase(decided, caseRows(r, tab, query));\n        else setPage(0);',
    to: '        setPage(0);',
    acceptance: 'review',
    only: 'transaction',
  },
  {
    id: 'transaction-close-focus-lost',
    file: PAGE,
    from: "                            returnToCase(selected, rows);\n                            setSelected('');",
    to: "                            setSelected('');",
    acceptance: 'review',
    only: 'transaction',
  },
  {
    id: 'transaction-review-line-unfocused',
    file: TRANSACTION,
    from: "                setNote('');\n                settle(reviewLine);",
    to: "                setNote('');",
    acceptance: 'review',
    only: 'transaction',
  },
  {
    id: 'pdf-previous-undescribed',
    file: PDF,
    from: '                aria-describedby={pageLine}\n                disabled={page <= 1}',
    to: '                disabled={page <= 1}',
    acceptance: 'review',
    only: 'pdf',
  },
  {
    id: 'pdf-jump-names-the-wrong-step',
    file: PDF,
    from: '              validPage\n                ? r.jumpWaits.other\n                : r.jumpWaits.number(file.pdf!.pages)',
    to: '              r.jumpWaits.other',
    acceptance: 'review',
    only: 'pdf',
  },
  {
    id: 'pdf-boundaries-unexplained',
    file: PDF,
    from: '              closed={!pending}',
    to: '              closed={false}',
    acceptance: 'review',
    only: 'pdf',
  },
  {
    id: 'value-focus-nowhere',
    file: 'components/visual-cell-review.tsx',
    from: '          onConfirm(wordId);\n          settle(stateLine);',
    to: '          onConfirm(wordId);',
    acceptance: 'review',
    only: 'values',
  },
  {
    id: 'value-reason-hidden',
    file: 'components/visual-cell-review.tsx',
    from: '        closed={!cell}',
    to: '        closed={false}',
    acceptance: 'review',
    only: 'values',
  },
  {
    id: 'crop-reason-hidden',
    file: 'components/visual-crop-picker.tsx',
    from: '                closed={!box}',
    to: '                closed={false}',
    acceptance: 'review',
    only: 'ranges',
  },
  {
    id: 'range-check-names-the-wrong-step',
    file: 'components/visual-table-review.tsx',
    from: '              counts.unclassified\n                ? v.coverageWaits.unclassified',
    to: '              false\n                ? v.coverageWaits.unclassified',
    acceptance: 'review',
    only: 'table',
  },
  {
    id: 'exclusion-focus-nowhere',
    file: 'components/visual-table-review.tsx',
    from: "        if (action === 'exclusion') settle(`${rowState}-${row}`);\n",
    to: '',
    acceptance: 'review',
    only: 'table',
  },
  {
    id: 'transfer-forgets-the-confirmation',
    file: 'components/visual-accounting-review.tsx',
    from: '    ...(checked ? [] : [{ confirmation: v.confirm }]),\n',
    to: '',
    acceptance: 'review',
    only: 'transfer',
  },
  {
    id: 'effort-start-unexplained',
    file: 'components/visual-review-effort.tsx',
    from: '            closed={!sample}',
    to: '            closed={false}',
    acceptance: 'review',
    only: 'effort',
  },
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
const scripts = [
  ...new Set(
    Object.values(acceptances).map((a) =>
      a.find((x) => x.startsWith('scripts/')),
    ),
  ),
];
const files = [...new Set(mutations.map((m) => m.file)), ...scripts];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const options = (cwd) => ({
  cwd,
  encoding: 'utf8',
  timeout: 900000,
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
// The review's browser check, from the repository with its fixtures, against
// the private copy's build; its records go under this run.
const check = (tree, name, records, only) =>
  spawnSync(process.execPath, acceptances[name], {
    ...options(root),
    env: {
      ...process.env,
      MIZAN_DIST_DIR: join(tree, 'dist'),
      MIZAN_PROOF_DIR: join(records, 'overlap'),
      P4_BROWSER_REPORT_DIR: join(records, 'split'),
      RUNNING_BROWSER_REPORT_DIR: join(records, 'running'),
      MIZAN_SECTION_PROOF_DIR: join(records, 'sections'),
      ...(only ? { REVIEW_PLATFORM_ONLY: only } : {}),
    },
  });
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
async function privateTree() {
  const tree = await createPrivateTree();
  for (const name of buildInputs)
    await cp(join(root, name), join(tree, name), { recursive: true });
  await symlink(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  return tree;
}
const report = {
  baselinePassed: false,
  baseline: {},
  mutations: [],
  passed: false,
};
{
  // Every review's check passes on the unchanged build.
  const tree = await privateTree();
  try {
    const failed = build(tree);
    if (failed) await log('baseline-build', failed);
    else
      for (const name of Object.keys(acceptances)) {
        const r = check(tree, name, join(out, 'baseline'));
        await log('baseline-' + name, r);
        report.baseline[name] = completedSuccessfully(r);
      }
    report.baselinePassed =
      !failed &&
      Object.keys(acceptances).every((name) => report.baseline[name]);
  } finally {
    await removePrivateTree(tree);
  }
}
if (report.baselinePassed)
  for (const { id, file, from, to, acceptance, only } of mutations) {
    const tree = await privateTree();
    try {
      const target = join(tree, file);
      const text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const failed = build(tree);
      const result = failed
        ? { ...failed, buildFailed: true }
        : check(tree, acceptance, join(out, id), only);
      await log(id, result);
      report.mutations.push({
        id,
        file,
        acceptance,
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
        acceptance,
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
      baseline: report.baseline,
      killed: report.mutations.filter((r) => r.killed).length,
      total: mutations.length,
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
