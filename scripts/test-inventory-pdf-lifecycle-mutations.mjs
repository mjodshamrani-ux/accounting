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
  process.env.INV_PDF_LIFECYCLE_MUTATION_DIR ??
  join(root, 'work/inventory-pdf-lifecycle-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const request = 'lib/reconciliation/inventory-pdf-request.ts',
  io = 'lib/reconciliation/inventory-pdf-lifecycle.ts',
  core = 'lib/reconciliation/inventory-register.ts',
  test = 'tests/inventory-pdf-lifecycle.test.ts';
const mutations = [
  [
    'skip-dense-decision-members',
    core,
    '!denseStockList(e.memberIds)',
    'false',
  ],
  [
    'borrow-caller-original',
    request,
    'original: f.original.slice(0)',
    'original: f.original',
  ],
  [
    'ignore-declared-digest',
    core,
    'if (lifecycle && sha256 !== lifecycle.files[index].sha256)',
    'if (false)',
  ],
  [
    'reuse-g3-context',
    core,
    'lifecycle ? STOCK_PDF_LIFECYCLE_VERSION : STOCK_VERSION,',
    'STOCK_VERSION,',
  ],
  [
    'discard-decisions',
    core,
    'events: lifecycle?.events ?? [],',
    'events: [],',
  ],
  [
    'accept-unreviewed-completeness',
    core,
    "(result.financial !== 'ready' || !completeness.confirmed)",
    "(result.financial !== 'ready')",
  ],
  [
    'skip-worker-response-binding',
    io,
    'if (!sameStockPdfData(captured, expected))',
    'if (false)',
  ],
  [
    'skip-saved-session-binding',
    io,
    'if (!sameStockPdfData(restored, expected))',
    'if (false)',
  ],
  [
    'borrow-reply-evidence',
    io,
    'result: snapshotStockPdfTransport(value.result),',
    'result: value.result,',
  ],
  [
    'allow-foreign-member',
    core,
    '!event.memberIds.every((id) => physicalIds.has(id))',
    'false',
  ],
  [
    'accept-session-cache',
    io,
    '!pdfKeys(parsed, [',
    'false && !pdfKeys(parsed, [',
  ],
];
const tracked = [...new Set([...mutations.map((m) => m[1]), test])],
  sha = (b) => createHash('sha256').update(b).digest('hex');
const hashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (p) => [p, sha(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '--test', test], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
const baseline = run(root);
await writeFile(join(out, 'baseline.log'), baseline.stdout + baseline.stderr);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
if (report.baselinePassed)
  for (const [id, target, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of [
        'lib',
        'audit/inventory-pdf-foundation',
        'audit/inventory-pdf-accounting',
        'audit/inventory-register',
        'tests/helpers/inventory-pdf-lifecycle-fixture.ts',
        'tests/helpers/bank-wd-worker.mjs',
        test,
        'package.json',
      ])
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
      const file = join(tree, target),
        source = await readFile(file, 'utf8');
      if (source.split(from).length !== 2)
        throw Error('Mutation anchor drift: ' + id);
      await writeFile(file, source.replace(from, to));
      const r = run(tree);
      await writeFile(join(out, id + '.log'), r.stdout + r.stderr);
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
for (const [p, hash] of Object.entries(hashes))
  if (sha(await readFile(join(root, p))) !== hash)
    throw Error('Mutation touched source');
report.passed =
  report.baselinePassed &&
  report.mutations.length === mutations.length &&
  report.mutations.every((m) => m.killed);
await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, ...report }, null, 2));
if (!report.passed) process.exitCode = 1;
