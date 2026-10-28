// ALL-1b and ALL-1c code mutations: each planted defect in a private copy of
// allocation-advice-review-1 (allocation-advice.ts and its replay), of the
// worker protocol's check of its reply, or of the page's replay of the bytes
// it sent, must make its tests fail with an assertion; allocation-snapshot-1's
// own tests run beside them. A survivor is a guard nothing holds.
//   node scripts/test-allocation-advice-mutations.mjs
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
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
  process.env.ALL_ADVICE_MUTATION_DIR ??
  join(root, 'work/allocation-advice-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/allocation-advice.test.ts',
  'tests/allocation.test.ts',
  'tests/allocation-advice-protocol.test.ts',
  'tests/allocation-advice-binding.test.ts',
];
const support = ['audit/allocation', 'tests/helpers'];
const ENGINE = 'lib/reconciliation/allocation-advice.ts';
const IO = 'lib/reconciliation/allocation-advice-io.ts';
const PROTOCOL = 'lib/reconciliation/protocol.ts';
const CLIENT = 'lib/reconciliation/worker-client.ts';
const mutations = [
  [
    'source-errors-reviewed',
    ENGINE,
    "if (result.status !== 'ready') refuseAdvice('SOURCE_ERRORS');",
    '',
  ],
  [
    'allocated-lines-still-advise',
    ENGINE,
    '    if (!used.has(p.id))\n      for (const n of at) {',
    '    if (true)\n      for (const n of at) {',
  ],
  [
    'human-links-ignored',
    ENGINE,
    ".filter((l) => l.basis.kind === 'remittance')",
    ".filter((l) => l.basis.kind !== 'remittance')",
  ],
  [
    'allocated-status-dropped',
    ENGINE,
    "if (used.has(p.id)) return { ...base, status: 'allocated', reasons: [] };",
    "if (false) return { ...base, status: 'allocated', reasons: [] };",
  ],
  [
    'payment-over-ignored',
    ENGINE,
    "if (over[0]) reasons.push('OVER_PAYMENT');",
    '',
  ],
  [
    'invoice-over-ignored',
    ENGINE,
    "if (over[1]) reasons.push('OVER_INVOICE');",
    '',
  ],
  [
    'payment-competition-ignored',
    ENGINE,
    "if (crowded[0] && !over[0]) reasons.push('COMPETES_PAYMENT');",
    '',
  ],
  [
    'invoice-competition-ignored',
    ENGINE,
    "if (crowded[1] && !over[1]) reasons.push('COMPETES_INVOICE');",
    '',
  ],
  [
    'an-over-line-also-competes',
    ENGINE,
    "if (crowded[1] && !over[1]) reasons.push('COMPETES_INVOICE');",
    "if (crowded[1]) reasons.push('COMPETES_INVOICE');",
  ],
  [
    'twin-reason-dropped',
    ENGINE,
    "if (base.twinGroup >= 0) reasons.push('TWIN');",
    '',
  ],
  [
    'over-at-equality',
    ENGINE,
    'const over = [p.amount > pay.remaining, p.amount > inv.remaining];',
    'const over = [p.amount >= pay.remaining, p.amount >= inv.remaining];',
  ],
  [
    'crowded-at-equality',
    ENGINE,
    'const crowded = [pay.excess > 0, inv.excess > 0];',
    'const crowded = [pay.advised >= pay.remaining, inv.advised >= inv.remaining];',
  ],
  [
    'capacity-from-available',
    ENGINE,
    'remaining: b.remaining,',
    'remaining: b.available,',
  ],
  [
    'excess-may-be-negative',
    ENGINE,
    'item.excess = Math.max(0, item.advised - item.remaining);',
    'item.excess = item.advised - item.remaining;',
  ],
  [
    'twins-ignore-the-amount',
    ENGINE,
    'const key = JSON.stringify([p.payment, p.invoice, p.amount]);',
    'const key = JSON.stringify([p.payment, p.invoice]);',
  ],
  [
    'twins-among-open-lines-only',
    ENGINE,
    '    if (rows) rows.push(p.row);\n    else groups.set(key, [p.row]);',
    '    if (used.has(p.id)) {\n    } else if (rows) rows.push(p.row);\n    else groups.set(key, [p.row]);',
  ],
  [
    'singletons-are-twins',
    ENGINE,
    'if (rows.length > 1) {',
    'if (rows.length > 0) {',
  ],
  [
    'twins-include-the-line',
    ENGINE,
    '.filter((row) => row !== line.row);',
    ';',
  ],
  [
    'competitors-on-every-item',
    ENGINE,
    '    if (item.excess > 0)\n',
    '    if (true)\n',
  ],
  [
    'competitor-list-includes-itself',
    ENGINE,
    'for (const row of item.open) if (row !== line.row) out.add(row);',
    'for (const row of item.open) out.add(row);',
  ],
  [
    'an-allocated-line-competes',
    ENGINE,
    "  if (line.status === 'allocated') return [];\n",
    '',
  ],
  [
    'review-status-for-fits',
    ENGINE,
    "status: reasons.length ? 'review' : 'fits',",
    "status: 'review',",
  ],
  [
    'family-code-lost',
    IO,
    "      refuseAdvice(message.slice('ALLOCATION_'.length));\n",
    '',
  ],
  [
    'ceiling-read-as-source',
    IO,
    "refuseAdvice(message === readerCeiling ? 'ROWS' : 'SOURCE');",
    "refuseAdvice('SOURCE');",
  ],
  [
    'protocol-review-not-recomputed',
    PROTOCOL,
    '        JSON.stringify(\n          reviewAllocationAdvice(value.result as unknown as AllocationResult),\n        ) !== JSON.stringify(value.review)\n',
    '        false\n',
  ],
  [
    'protocol-bytes-not-compared',
    PROTOCOL,
    'if (theirs.some((byte, at) => byte !== mine[at]))',
    'if (false)',
  ],
  [
    'protocol-decisions-not-compared',
    PROTOCOL,
    '        JSON.stringify(value.state.events) !== JSON.stringify(payload.events)\n',
    '        false\n',
  ],
  [
    'binding-result-and-review-not-compared',
    CLIENT,
    '              JSON.stringify(sent.result) !== JSON.stringify(fresh.result) ||\n              JSON.stringify(sent.review) !== JSON.stringify(fresh.review)\n',
    '              false\n',
  ],
  [
    'binding-sources-not-compared',
    CLIENT,
    '              sources(sent.state) !== sources(fresh.state) ||\n',
    '',
  ],
  [
    'binding-bytes-not-compared',
    CLIENT,
    'if (x.length !== y.length || x.some((v, at) => v !== y[at]))',
    'if (false)',
  ],
];
const files = [ENGINE, IO, PROTOCOL, CLIENT, ...tests];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) =>
  spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...tests],
    {
      cwd,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
const log = (name, r) =>
  writeFile(join(out, name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
const baseline = run(root);
await log('baseline', baseline);
const report = {
  baselinePassed: completedSuccessfully(baseline),
  mutations: [],
  passed: false,
};
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of ['lib', ...tests, ...support, 'package.json'])
        await cp(join(root, name), join(tree, name), { recursive: true });
      await symlink(
        join(root, 'node_modules'),
        join(tree, 'node_modules'),
        'dir',
      );
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
        killed: isAssertionKill(result),
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
      survivors: report.mutations
        .filter((r) => !r.killed)
        .map((r) => [r.id, r.infrastructureError ?? '']),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
