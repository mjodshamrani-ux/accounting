import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
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
  process.env.INV_PDF_ACCOUNTING_MUTATION_DIR ??
  join(root, 'work/inventory-pdf-accounting-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const file = 'lib/reconciliation/inventory-pdf-accounting.ts';
const test = 'tests/inventory-pdf-accounting.test.ts';
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    [
      file,
      test,
      'lib/reconciliation/inventory-register.ts',
      'lib/reconciliation/pdf-paint-order.ts',
    ].map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '--test', test], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
const mutations = [
  [
    'compressed-source-budget',
    'lib/reconciliation/inventory-register.ts',
    '(native || nativePdf ? MAX_FILE_BYTES : f.original.byteLength)',
    '(native ? MAX_FILE_BYTES : f.original.byteLength)',
  ],
  [
    'collapse-literal-whitespace',
    file,
    'const text = trace.text.slice(start, end);',
    "const text = trace.text.slice(start, end).replace(/\\s+/g, ' ');",
  ],
  [
    'discard-literal-spacing',
    file,
    'operators.some((o) => o.adjusted)',
    'false',
  ],
  [
    'trim-literal-boundaries',
    file,
    'return {\n    span,\n    text,',
    'return {\n    span,\n    text: text.trim(),',
  ],
  [
    'ignore-page-total',
    file,
    "if (declaredMinor !== actualMinor) stop('PAGE_TOTAL');",
    'void 0;',
  ],
  [
    'ignore-report-total',
    file,
    "if (declaredMinor !== actualMinor) stop('REPORT_TOTAL');",
    'void 0;',
  ],
  [
    'forget-zero',
    file,
    '      result.records.push({',
    "      if (raw['Item ID'] === '00') continue;\n      result.records.push({",
  ],
  [
    'ignore-precision',
    'lib/reconciliation/inventory-register.ts',
    "if (fraction.length > precision) fail('PRECISION');",
    'void 0;',
  ],
  [
    'ignore-policy-membership',
    'lib/reconciliation/inventory-register.ts',
    'compound(evidence[0].values.slice(1, 8)) !== compound(expected)',
    'false',
  ],
  [
    'equal-total-false-ready',
    'lib/reconciliation/inventory-register.ts',
    'differenceMinor: bounded(amount - net),',
    'differenceMinor: 0,',
  ],
  [
    'foreign-mapping-owner',
    'lib/reconciliation/inventory-register.ts',
    'mappingIds: mapping.map((m) => m.id),',
    'mappingIds: result.records[1].slice(0,1).map(m => m.id),',
  ],
  [
    'uncopied-companion',
    'lib/reconciliation/inventory-register.ts',
    'original: f.original.slice(0)',
    'original: f.original',
  ],
  [
    'erase-source-spaces',
    'lib/reconciliation/pdf-paint-order.ts',
    "if (literal) literal.trace.text = parts.join('');",
    "if (literal) literal.trace.text = parts.join('').replace(/  /g, ' ');",
  ],
];
if (report.baselinePassed)
  for (const [id, targetFile, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        'audit/inventory-pdf-foundation',
        'audit/inventory-pdf-accounting',
        'tests/helpers/pdf-rewrite-fixture.ts',
        test,
        'tests/helpers/pdf-fixture.ts',
        'package.json',
      ])
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const target = join(tree, targetFile),
        text = await readFile(target, 'utf8');
      if (text.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(target, text.replace(from, to));
      const r = run(tree);
      await log(id, r);
      report.mutations.push({
        id,
        killed: isAssertionKill(r),
        exitCode: r.status,
        signal: r.signal,
        error: r.error?.message ?? null,
      });
    } catch (e) {
      report.mutations.push({
        id,
        killed: false,
        infrastructureError: e.message,
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
console.log(JSON.stringify({ out, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
