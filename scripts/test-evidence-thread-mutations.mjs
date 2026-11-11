// UX-10(b) code mutations: each planted defect in a private copy of the
// evidence thread projection (lib/evidence-thread.ts) must make its unit
// tests fail with an assertion (DEV-22). A survivor is a link or a cell the
// tests would let the drawer show wrongly.
//   node scripts/test-evidence-thread-mutations.mjs
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
  describeRun,
  isAssertionKill,
} from './mutation-runner-support.mjs';

const root = resolve(import.meta.dirname, '..');
const output =
  process.env.EVIDENCE_THREAD_MUTATION_DIR ??
  join(root, 'work/evidence-thread-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = ['tests/evidence-thread.test.ts'];
const THREAD = 'lib/evidence-thread.ts';
// What the tests read: the projection and the engines it reads results of,
// the frozen synthetic cases and the loaders that run them.
const copied = [
  'lib',
  ...tests,
  'tests/helpers',
  'audit/fixed-assets',
  'audit/fixed-assets-long',
  'audit/payroll',
  'audit/reconciliation-sheet',
  'audit/inventory-links-foundation/frozen',
  'audit/gl-tb/frozen',
  'audit/clearing/frozen',
  'audit/ar-limited/frozen',
  'audit/ar-scope-details/fixtures',
  'audit/tb-financial',
  'audit/intercompany',
  'package.json',
];
const mutations = [
  [
    "gl-source-wrong",
    THREAD,
    "const GL = 3,",
    "const GL = 2,",
  ],
  [
    "gl-row-shifted",
    THREAD,
    "[GL, comparison.glRow],\n    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** A payroll",
    "[GL, comparison.glRow + 1],\n    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** A payroll",
  ],
  [
    "asset-register-rows-dropped",
    THREAD,
    "    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** A payroll",
    "  ]);\n}\n\n/** A payroll",
  ],
  [
    "payroll-register-rows-dropped",
    THREAD,
    "    ...comparison.registerRows.map((row): [number, number] => [\n      REGISTER,\n      row,\n    ]),\n  ]);\n}\n\n/** The payroll",
    "  ]);\n}\n\n/** The payroll",
  ],
  [
    "cells-any-source",
    THREAD,
    ".filter((c) => c.source === source && c.row === row)",
    ".filter((c) => c.row === row)",
  ],
  [
    "cells-wrong-row",
    THREAD,
    ".filter((c) => c.source === source && c.row === row)",
    ".filter((c) => c.source === source && c.row === row + 1)",
  ],
  [
    "cells-first-dropped",
    THREAD,
    ".map(({ column, field, text }) => ({ column, field, text })),\n  }));",
    ".slice(1).map(({ column, field, text }) => ({ column, field, text })),\n  }));",
  ],
  [
    "label-of-first-source",
    THREAD,
    "    role: roles[source],\n    name: labels[source]?.name ?? '',",
    "    role: roles[source],\n    name: labels[0]?.name ?? '',",
  ],
  [
    "role-shifted",
    THREAD,
    "role: roles[source],",
    "role: roles[(source + 1) % roles.length],",
  ],
  [
    "bank-source-side-zero",
    THREAD,
    "const source = result.sources[record.side];",
    "const source = result.sources[0];",
  ],
  [
    "bank-text-is-field",
    THREAD,
    "      cells: record.traces.map(({ column, field, text }) => ({\n        column,\n        field,\n        text,\n      })),",
    "      cells: record.traces.map(({ column, field }) => ({\n        column,\n        field,\n        text: field,\n      })),",
  ],
  [
    "allocation-row-wrong",
    THREAD,
    "place: { row: item.row },",
    "place: { row: item.row + 1 },",
  ],
  [
    "payroll-bank-source-wrong",
    THREAD,
    "  BANK = 4;",
    "  BANK = 3;",
  ],
  [
    "unknown-comparison-not-empty",
    THREAD,
    "  const comparison = result.comparisons[index];\n  if (!comparison) return [];\n  return familySources(result.cells, ASSET_ROLES",
    "  const comparison = result.comparisons[index] ?? result.comparisons[0];\n  if (!comparison) return [];\n  return familySources(result.cells, ASSET_ROLES",
  ],
  [
    "stock-register-source-wrong",
    THREAD,
    "    [0, link],",
    "    [1, link],",
  ],
  [
    "stock-mappings-dropped",
    THREAD,
    "    ...link.mappings.map((m): [number, StockRecordRef] => [1, m]),\n",
    "",
  ],
  [
    "stock-evidence-as-mapping",
    THREAD,
    "...link.evidence.map((e): [number, StockRecordRef] => [2, e]),",
    "...link.evidence.map((e): [number, StockRecordRef] => [1, e]),",
  ],
  [
    "stock-gl-dropped",
    THREAD,
    "    ...link.gl.map((g): [number, StockRecordRef] => [3, g]),\n",
    "",
  ],
  [
    "stock-label-of-first-source",
    THREAD,
    "      role: STOCK_ROLES[source],\n      name: labels[source]?.name ?? '',",
    "      role: STOCK_ROLES[source],\n      name: labels[0]?.name ?? '',",
  ],
  [
    "stock-page-read-as-row",
    THREAD,
    "        ref.page === undefined\n          ? { row: ref.row }\n          : { page: ref.page, line: ref.row },",
    "        { row: ref.row },",
  ],
  [
    "stock-column-cells-kept",
    THREAD,
    "const plain = ref.page === undefined && ref.column === undefined;",
    "const plain = ref.page === undefined;",
  ],
  [
    "stock-cells-any-source",
    THREAD,
    ".filter((c) => c.source === source && c.row === ref.row)",
    ".filter((c) => c.row === ref.row)",
  ],
  [
    "stock-unknown-link-not-empty",
    THREAD,
    "const link = result.links[index];",
    "const link = result.links[index] ?? result.links[0];",
  ],
  [
    "gltb-other-components",
    THREAD,
    "    .filter((c) => c.field === field)\n",
    "    .filter((c) => c.field !== field)\n",
  ],
  [
    "gltb-tb-first",
    THREAD,
    "    .filter((c) => c.field === field)\n",
    "    .filter((c) => c.field === field)\n    .reverse()\n",
  ],
  [
    "gltb-first-cell-only",
    THREAD,
    "      c.cells.flatMap((cell) => {\n",
    "      c.cells.slice(0, 1).flatMap((cell) => {\n",
  ],
  [
    "gltb-every-traced-cell",
    THREAD,
    "              .filter((trace) => trace.column === cell.column)\n",
    "",
  ],
  [
    "gltb-file-of-the-gl",
    THREAD,
    "        const source = result.sources[c.side];\n",
    "        const source = result.sources[0];\n",
  ],
  [
    "gltb-source-index-gl",
    THREAD,
    "            source: c.side,\n",
    "            source: 0,\n",
  ],
  [
    "gltb-row-shifted",
    THREAD,
    "            place: { row: record.row },\n            cells: record.trace\n",
    "            place: { row: record.row + 1 },\n            cells: record.trace\n",
  ],
  [
    "clearing-unknown-case-not-empty",
    THREAD,
    "const found = result.cases[index];",
    "const found = result.cases[index] ?? result.cases[0];",
  ],
  [
    "clearing-other-case",
    THREAD,
    "const found = result.cases[index];",
    "const found = result.cases[index + 1];",
  ],
  [
    "clearing-first-member-only",
    THREAD,
    "  return found.ids.flatMap((id) => {\n",
    "  return found.ids.slice(0, 1).flatMap((id) => {\n",
  ],
  [
    "clearing-members-reversed",
    THREAD,
    "  return found.ids.flatMap((id) => {\n",
    "  return [...found.ids].reverse().flatMap((id) => {\n",
  ],
  [
    "clearing-row-shifted",
    THREAD,
    "        place: { row },\n        cells:\n          lines",
    "        place: { row: row + 1 },\n        cells:\n          lines",
  ],
  [
    "clearing-cells-of-next-row",
    THREAD,
    "          lines.get(row)?.map((text, i) => ({\n",
    "          lines.get(row + 1)?.map((text, i) => ({\n",
  ],
  [
    "clearing-empty-cells-dropped",
    THREAD,
    "          lines.get(row)?.map((text, i) => ({\n",
    "          lines.get(row)?.filter((text) => text).map((text, i) => ({\n",
  ],
  [
    "clearing-header-from-a-movement",
    THREAD,
    "    header = lines.get(result.reading.header + 1) ?? [];",
    "    header = lines.get(result.reading.header + 2) ?? [];",
  ],
  [
    "clearing-column-from-zero",
    THREAD,
    "            column: i + 1,\n            field: header[i] ?? '',",
    "            column: i,\n            field: header[i] ?? '',",
  ],
  [
    "clearing-header-shifted",
    THREAD,
    "            field: header[i] ?? '',",
    "            field: header[i + 1] ?? '',",
  ],
  [
    "clearing-name-is-the-sheet",
    THREAD,
    "        name,\n        sheet: result.sheet,",
    "        name: result.sheet,\n        sheet: result.sheet,",
  ],
  [
    "clearing-sheet-dropped",
    THREAD,
    "        name,\n        sheet: result.sheet,",
    "        name,\n        sheet: null,",
  ],
  [
    "ar-unknown-case-not-empty",
    THREAD,
    "const pair = result.cases[index];",
    "const pair = result.cases[index] ?? result.cases[0];",
  ],
  [
    "ar-other-case",
    THREAD,
    "const pair = result.cases[index];",
    "const pair = result.cases[index + 1];",
  ],
  [
    "ar-first-member-only",
    THREAD,
    "  return pair.ids.flatMap((id): Thread => {\n",
    "  return pair.ids.slice(0, 1).flatMap((id): Thread => {\n",
  ],
  [
    "ar-members-reversed",
    THREAD,
    "  return pair.ids.flatMap((id): Thread => {\n",
    "  return [...pair.ids].reverse().flatMap((id): Thread => {\n",
  ],
  [
    "ar-printed-line-as-a-row",
    THREAD,
    "    if (row.pdf)\n",
    "    if (row.pdf && false)\n",
  ],
  [
    "ar-page-and-line-swapped",
    THREAD,
    "          place: { page: row.pdf.page, line: row.pdf.line },\n",
    "          place: { page: row.pdf.line, line: row.pdf.page },\n",
  ],
  [
    "ar-printed-line-keeps-the-sheet",
    THREAD,
    "          sheet: null,\n          place: { page: row.pdf.page",
    "          sheet: source.sheet,\n          place: { page: row.pdf.page",
  ],
  [
    "ar-header-always-first",
    THREAD,
    "          ? reading.header + 1\n",
    "          ? 1\n",
  ],
  [
    "ar-header-of-the-other-record",
    THREAD,
    "      header = lines.get(`${row.side}:${head}`) ?? [];",
    "      header = lines.get(`${1 - row.side}:${head}`) ?? [];",
  ],
  [
    "ar-cells-of-the-other-record",
    THREAD,
    "          lines.get(`${row.side}:${row.row}`)?.map((text, at) => ({\n",
    "          lines.get(`${1 - row.side}:${row.row}`)?.map((text, at) => ({\n",
  ],
  [
    "ar-column-from-zero",
    THREAD,
    "            column: at + 1,\n",
    "            column: at,\n",
  ],
  [
    "ar-header-shifted",
    THREAD,
    "            field: header[at] ?? '',\n",
    "            field: header[at + 1] ?? '',\n",
  ],
  [
    "ar-role-of-the-ledger",
    THREAD,
    "        role: source.role,\n        name: source.name,\n        sheet: source.sheet,\n        place: { row: row.row },",
    "        role: result.sources[0].role,\n        name: source.name,\n        sheet: source.sheet,\n        place: { row: row.row },",
  ],
  [
    "ar-file-of-the-ledger",
    THREAD,
    "        role: source.role,\n        name: source.name,\n        sheet: source.sheet,\n        place: { row: row.row },",
    "        role: source.role,\n        name: result.sources[0].name,\n        sheet: source.sheet,\n        place: { row: row.row },",
  ],  [
    "fin-line-row-dropped",
    THREAD,
    "    line.id,\n    ...line.members.flatMap",
    "    ...line.members.flatMap",
  ],
  [
    "fin-account-dropped",
    THREAD,
    "      m.accountRecord,\n      m.mappingRecord,",
    "      m.mappingRecord,",
  ],
  [
    "fin-mapping-dropped",
    THREAD,
    "      m.accountRecord,\n      m.mappingRecord,\n      m.evidenceRecord,",
    "      m.accountRecord,\n      m.evidenceRecord,",
  ],
  [
    "fin-evidence-dropped",
    THREAD,
    "      m.mappingRecord,\n      m.evidenceRecord,\n    ]),",
    "      m.mappingRecord,\n    ]),",
  ],
  [
    "fin-account-evidence-swapped",
    THREAD,
    "      m.accountRecord,\n      m.mappingRecord,\n      m.evidenceRecord,",
    "      m.evidenceRecord,\n      m.mappingRecord,\n      m.accountRecord,",
  ],
  [
    "fin-first-member-only",
    THREAD,
    "    ...line.members.flatMap((m) => [",
    "    ...line.members.slice(0, 1).flatMap((m) => [",
  ],
  [
    "fin-members-reversed",
    THREAD,
    "    ...line.members.flatMap((m) => [",
    "    ...[...line.members].reverse().flatMap((m) => [",
  ],
  [
    "fin-unknown-line-opens-last",
    THREAD,
    "  const line = result.lines[index];\n  if (!line) return [];",
    "  const line = result.lines[index] ?? result.lines.at(-1);\n  if (!line) return [];",
  ],
  [
    "recorded-cells-of-the-first-record",
    THREAD,
    "        cells: cells.get(id) ?? [],",
    "        cells: cells.get(ids[0]) ?? [],",
  ],
  [
    "recorded-last-cell-only",
    THREAD,
    "    const kept = cells.get(c.id) ?? [];",
    "    const kept: ThreadCell[] = [];",
  ],
  [
    "recorded-column-from-zero",
    THREAD,
    "    kept.push({ column: c.column, field: c.field, text: c.text });",
    "    kept.push({ column: c.column - 1, field: c.field, text: c.text });",
  ],
  [
    "recorded-field-is-text",
    THREAD,
    "    kept.push({ column: c.column, field: c.field, text: c.text });",
    "    kept.push({ column: c.column, field: c.text, text: c.text });",
  ],
  [
    "recorded-source-of-the-statement",
    THREAD,
    "        source: record.source,\n        role: source.role,",
    "        source: 3,\n        role: source.role,",
  ],
  [
    "recorded-role-of-the-first-source",
    THREAD,
    "    const source = result.sources[record.source];",
    "    const source = result.sources[0];",
  ],
  [
    "recorded-row-shifted",
    THREAD,
    "        place: { row: record.row },\n        cells: cells.get(id) ?? [],",
    "        place: { row: record.row + 1 },\n        cells: cells.get(id) ?? [],",
  ],
  [
    "recorded-sheet-null",
    THREAD,
    "        sheet: source.sheet,\n        place: { row: record.row },\n        cells: cells.get(id)",
    "        sheet: null,\n        place: { row: record.row },\n        cells: cells.get(id)",
  ],
  [
    "ic-relation-dropped",
    THREAD,
    "    pair.relationRecord,\n    ...pair.members",
    "    ...pair.members",
  ],
  [
    "ic-ledger-dropped",
    THREAD,
    "    ...pair.members.map((m) => m.id),\n",
    "",
  ],
  [
    "ic-timing-dropped",
    THREAD,
    "    ...pair.timing.map((t) => t.id),\n",
    "",
  ],
  [
    "ic-relation-last",
    THREAD,
    "    pair.relationRecord,\n    ...pair.members.map((m) => m.id),\n    ...pair.timing.map((t) => t.id),",
    "    ...pair.members.map((m) => m.id),\n    ...pair.timing.map((t) => t.id),\n    pair.relationRecord,",
  ],
  [
    "ic-first-ledger-row-only",
    THREAD,
    "    ...pair.members.map((m) => m.id),",
    "    ...pair.members.slice(0, 1).map((m) => m.id),",
  ],
  [
    "ic-ledger-reversed",
    THREAD,
    "    ...pair.members.map((m) => m.id),",
    "    ...[...pair.members].reverse().map((m) => m.id),",
  ],
  [
    "ic-unknown-pair-opens-last",
    THREAD,
    "  const pair = result.pairs[index];\n  if (!pair) return [];",
    "  const pair = result.pairs[index] ?? result.pairs.at(-1);\n  if (!pair) return [];",
  ],
];
const files = [THREAD, ...tests];
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
if (!report.baselinePassed)
  process.stderr.write(describeRun('baseline', baseline, 'failed'));
if (report.baselinePassed)
  for (const [id, file, from, to] of mutations) {
    const tree = await createPrivateTree();
    try {
      for (const name of copied)
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
      const killed = isAssertionKill(result);
      if (!killed)
        process.stderr.write(describeRun(id, result, 'was not caught'));
      report.mutations.push({
        id,
        file,
        killed,
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
