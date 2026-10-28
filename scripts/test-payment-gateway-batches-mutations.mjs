// PG-1b code mutations: each planted defect in a private copy of
// payment-gateway-batches-1 (payment-gateway-batches.ts), its replay from
// bytes (payment-gateway-batches-io.ts), or since PG-1c the worker protocol
// and the page's binding for it, must make its tests fail with an
// assertion. A survivor is a guard nothing holds.
//   node scripts/test-payment-gateway-batches-mutations.mjs
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
  process.env.PG_BATCHES_MUTATION_DIR ??
  join(root, 'work/payment-gateway-batches-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
const tests = [
  'tests/payment-gateway-batches.test.ts',
  'tests/payment-gateway-batches-protocol.test.ts',
  'tests/payment-gateway-batches-binding.test.ts',
];
const support = ['tests/helpers'];
const ENGINE = 'lib/reconciliation/payment-gateway-batches.ts';
const IO = 'lib/reconciliation/payment-gateway-batches-io.ts';
const PROTOCOL = 'lib/reconciliation/protocol.ts';
const CLIENT = 'lib/reconciliation/worker-client.ts';
const mutations = [
  [
    'reading-family-unchecked',
    ENGINE,
    '        r.family !== PG_BATCHES_VERSION ||\n',
    '        false ||\n',
  ],
  [
    'reading-role-order-unchecked',
    ENGINE,
    '        r.role !== PG_BATCHES_ROLES[i] ||\n',
    '        false ||\n',
  ],
  [
    'scope-unconfirmed-read',
    ENGINE,
    '    scope.confirmed !== true\n  )',
    '    false\n  )',
  ],
  [
    'scope-identities-unchecked',
    ENGINE,
    "    identity(scope[k], () => refuseGatewayBatches('SCOPE'));",
    '    void k;',
  ],
  [
    'scope-unknown-currency',
    ENGINE,
    '  if (!Object.hasOwn(PG_BATCHES_PLACES, scope.currency as string))',
    '  if (false)',
  ],
  [
    'scope-as-of-before-end',
    ENGINE,
    'start <= end && end <= asOf',
    'start <= end',
  ],
  ['calendar-any-day-of-month', ENGINE, 'd <= days[month - 1]', 'd <= 31'],
  [
    'leap-every-fourth-year',
    ENGINE,
    '(y % 100 !== 0 || y % 400 === 0)',
    'true',
  ],
  ['no-leap-day', ENGINE, 'leap ? 29 : 28', '28'],
  [
    'header-length-unchecked',
    ENGINE,
    '    head.length !== want.length ||\n',
    '    false ||\n',
  ],
  [
    'trailing-blank-headers-kept',
    ENGINE,
    '  while (head.length && !head[head.length - 1]) head.pop();\n',
    '',
  ],
  [
    'headers-not-trimmed',
    ENGINE,
    '(sheet.rows[0] ?? []).map(strip)',
    '(sheet.rows[0] ?? []).map((v) => v)',
  ],
  [
    'hidden-header-row-read',
    ENGINE,
    "if (flagged.has(1)) refuseGatewayBatches('COLUMNS');",
    "if (false) refuseGatewayBatches('COLUMNS');",
  ],
  [
    'hidden-rows-read',
    ENGINE,
    'new Set<number>([...sheet.hiddenRows, ...sheet.formulaRows])',
    'new Set<number>([...sheet.formulaRows])',
  ],
  ['cell-issues-ignored', ENGINE, '  cells(sheet.cellIssues);\n', ''],
  ['cell-notes-ignored', ENGINE, '  cells(sheet.cellNotes);\n', ''],
  [
    'reference-issues-ignored',
    ENGINE,
    '  cells(sheet.referenceIssues, identities);\n',
    '',
  ],
  [
    'reference-issues-everywhere',
    ENGINE,
    '(!only || only.includes(c - 1))',
    'true',
  ],
  [
    'blank-marked-row-skipped',
    ENGINE,
    "        if (flagged.has(row)) fail('CELL');\n        continue;",
    '        continue;',
  ],
  [
    'extra-cells-ignored',
    ENGINE,
    "if (values.slice(width).some((v) => strip(v))) fail('COLUMNS');",
    "if (false) fail('COLUMNS');",
  ],
  [
    'row-account-unchecked',
    ENGINE,
    "        strip(cell(bank ? 'Bank account' : 'Merchant account')) !==\n          (bank ? scope.bankAccount : scope.merchantAccount) ||\n",
    '',
  ],
  [
    'row-currency-unchecked',
    ENGINE,
    "        strip(cell('Currency')) !== scope.currency\n",
    '        false\n',
  ],
  [
    'kind-unchecked',
    ENGINE,
    "if (kind !== 'sale' && kind !== 'refund') fail('KIND');",
    "if (false) fail('KIND');",
  ],
  [
    'period-open-before',
    ENGINE,
    "if (d < low || d > high) fail('PERIOD');",
    "if (d > high) fail('PERIOD');",
  ],
  [
    'value-date-to-period-end',
    ENGINE,
    "day(cell('Value date'), scope.start, scope.asOf)",
    "day(cell('Value date'), scope.start, scope.end)",
  ],
  [
    'places-unchecked',
    ENGINE,
    "if (!m || (m[2] ?? '').length > places) return fail('AMOUNT');",
    "if (!m) return fail('AMOUNT');",
  ],
  [
    'amount-ceiling-unchecked',
    ENGINE,
    "  if (n > 10n ** 14n) fail('AMOUNT');\n",
    '',
  ],
  ['arabic-digits-unread', ENGINE, '.exec(digits(raw))', '.exec(raw)'],
  [
    'strip-is-trim',
    ENGINE,
    "const strip = (v: string) => v.replace(ends, '');",
    'const strip = (v: string) => v.trim();',
  ],
  [
    'padded-id-read',
    ENGINE,
    '    v !== strip(v) ||\n    length(v) > 500 ||',
    '    length(v) > 500 ||',
  ],
  [
    'controls-in-id-read',
    ENGINE,
    "    CONTROL.test(v) ||\n    '=+@-'",
    "    false ||\n    '=+@-'",
  ],
  [
    'leading-sign-id-read',
    ENGINE,
    "    '=+@-'.includes(v[0]) ||\n",
    '    false ||\n',
  ],
  [
    'excel-error-id-read',
    ENGINE,
    '    EXCEL_ERROR.test(v)\n  )',
    '    false\n  )',
  ],
  [
    'empty-reference-read',
    ENGINE,
    "if (!v || v !== strip(v) || length(v) > 2000 || CONTROL.test(v)) fail('TEXT');",
    "if (v !== strip(v) || length(v) > 2000 || CONTROL.test(v)) fail('TEXT');",
  ],
  [
    'controls-in-reference-read',
    ENGINE,
    "length(v) > 2000 || CONTROL.test(v)) fail('TEXT');",
    "length(v) > 2000) fail('TEXT');",
  ],
  [
    'duplicates-kept',
    ENGINE,
    'if (count.get(e[key])! > 1) bad.add(e.row);',
    'if (count.get(e[key])! > 2) bad.add(e.row);',
  ],
  [
    'payout-credited-twice-read',
    ENGINE,
    "side === 4 ? ['id', 'payout'] : ['id']",
    "['id']",
  ],
  [
    'line-key-payout-only',
    ENGINE,
    'id: JSON.stringify([payout, batch]),',
    'id: payout,',
  ],
  [
    'lines-not-members',
    ENGINE,
    'for (const side of [0, 1, 3])',
    'for (const side of [0, 1])',
  ],
  [
    'members-unchecked',
    ENGINE,
    '      if (!known.has(e.batch as string))',
    '      if (false)',
  ],
  [
    'refunds-as-sales',
    ENGINE,
    "members.get(t.batch)![t.kind === 'sale' ? 'sales' : 'refunds'].push(t);",
    'members.get(t.batch)!.sales.push(t);',
  ],
  [
    'sales-unchecked',
    ENGINE,
    "if (components.sales !== s.gross) reasons.push('SALES');",
    "if (false) reasons.push('SALES');",
  ],
  [
    'refunds-unchecked',
    ENGINE,
    "if (components.refunds !== s.refunds) reasons.push('REFUNDS');",
    "if (false) reasons.push('REFUNDS');",
  ],
  [
    'fees-unchecked',
    ENGINE,
    "if (components.fees !== s.fees) reasons.push('FEES');",
    "if (false) reasons.push('FEES');",
  ],
  [
    'net-arithmetic-unchecked',
    ENGINE,
    "if (s.gross - s.refunds - s.fees !== s.net) reasons.push('NET');",
    "if (false) reasons.push('NET');",
  ],
  [
    'paid-short-unchecked',
    ENGINE,
    "if (paid < s.net) reasons.push('PAID_SHORT');",
    "if (false) reasons.push('PAID_SHORT');",
  ],
  [
    'paid-over-unchecked',
    ENGINE,
    "if (paid > s.net) reasons.push('PAID_OVER');",
    "if (false) reasons.push('PAID_OVER');",
  ],
  [
    'payout-review-not-carried',
    ENGINE,
    "if (its.some((p) => statusOf.get(p) === 'review')) reasons.push('PAYOUT');",
    "if (false) reasons.push('PAYOUT');",
  ],
  [
    'credit-amount-unchecked',
    ENGINE,
    "else if (c.amount !== amount) reasons.push('CREDIT');",
    "else if (false) reasons.push('CREDIT');",
  ],
  [
    'missing-credit-called-credit',
    ENGINE,
    "if (!c) reasons.push('NOT_DEPOSITED');",
    "if (!c) reasons.push('CREDIT');",
  ],
  ['late-credit-consistent', ENGINE, ': c!.valueDate > end', ': false'],
  [
    'batch-in-transit-ignored',
    ENGINE,
    ": its.some((p) => statusOf.get(p) === 'in-transit')",
    ': false',
  ],
  [
    'unlinked-credits-dropped',
    ENGINE,
    '.filter((c) => !linesOf.has(c.payout))',
    '.filter(() => false)',
  ],
  [
    'total-rounded',
    ENGINE,
    "  if (sum > BigInt(Number.MAX_SAFE_INTEGER))\n    refuseGatewayBatches('TOTAL_LIMIT');\n",
    '',
  ],
  [
    'ceiling-one-row-more',
    ENGINE,
    'export const PG_BATCHES_ROW_LIMIT = 20030;',
    'export const PG_BATCHES_ROW_LIMIT = 20031;',
  ],
  [
    'bom-kept',
    IO,
    "new TextDecoder('utf-8', { fatal: true })",
    "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })",
  ],
  [
    'nul-read',
    IO,
    "  if (text.includes('\\u0000')) refuseGatewayBatches('SOURCE');\n",
    '',
  ],
  [
    'blank-line-one-cell',
    IO,
    'rows.push(touched ? [...row, cell] : []);',
    'rows.push([...row, cell]);',
  ],
  [
    'quote-inside-field-read',
    IO,
    "if (cell || closed) refuseGatewayBatches('SOURCE');",
    "if (closed) refuseGatewayBatches('SOURCE');",
  ],
  [
    'text-after-quote-read',
    IO,
    "      if (closed) refuseGatewayBatches('SOURCE');\n      cell += c;",
    '      cell += c;',
  ],
  [
    'unclosed-quote-read',
    IO,
    "  if (quoted) refuseGatewayBatches('SOURCE');\n",
    '',
  ],
  [
    'xlsx-ceiling-is-source',
    IO,
    'sheetCeilings.includes(String((error as Error).message))',
    'false',
  ],
  [
    'hash-unchecked',
    IO,
    "if (file.sha256 !== s.sha256) refuseGatewayBatches('SOURCE_HASH');",
    "if (false) refuseGatewayBatches('SOURCE_HASH');",
  ],
  [
    'scope-after-files',
    IO,
    '  gatewayBatchesPlaces(metadata.readings, metadata.scope);\n',
    '',
  ],
  [
    'columns-after-all-files',
    IO,
    '    gatewayBatchesColumns(file.sheets[0], side);\n',
    '',
  ],
  [
    'protocol-bytes-unchecked',
    PROTOCOL,
    "          if (given[at] !== asked[at]) throw new Error('invalid');",
    "          if (false) throw new Error('invalid');",
  ],
  [
    'protocol-review-not-recomputed',
    PROTOCOL,
    '          reviewGatewayBatches(value.state as unknown as GatewayBatchesInput),\n        ) !== JSON.stringify(value.result)',
    '          value.result,\n        ) !== JSON.stringify(value.result)',
  ],
  [
    'protocol-scope-unchecked',
    PROTOCOL,
    "        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)\n      )\n        throw new Error('invalid');\n      // The five gateway",
    "        false\n      )\n        throw new Error('invalid');\n      // The five gateway",
  ],
  [
    'protocol-file-order-unchecked',
    PROTOCOL,
    '          returned.name !== requested.name ||\n',
    '          false ||\n',
  ],
  [
    'client-review-not-compared',
    CLIENT,
    '              JSON.stringify(theirs.result) !== JSON.stringify(own.result)',
    '              false',
  ],
  [
    'client-bytes-unchecked',
    CLIENT,
    '                left.some((v, at) => v !== right[at])',
    '                false',
  ],
  [
    'csv-cells-uncapped',
    IO,
    "      if (row.length === 99) refuseGatewayBatches('ROWS');\n",
    '',
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
