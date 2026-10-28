// WF-1 MAP-1 code mutations: each planted defect in a private copy of the
// column map library (bank-cashbook-map.ts) or the mapped cashbook reading
// (readMappedBankCashbook in bank-statement-match.ts), M1, must make the unit
// tests or the proof against the sealed EXPECTED.json fail with an
// assertion. A survivor is a rule nothing holds.
//   node scripts/test-bank-map-mutations.mjs
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
  process.env.BANK_MAP_MUTATION_DIR ?? join(root, 'work/bank-map-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
// BANK_MAP_PROOF_ONLY=1 measures the proof alone, without the unit tests;
// BANK_MAP_HOLDOUT_ONLY=1 the M4 holdout's recorded first run alone.
const holdout = process.env.BANK_MAP_HOLDOUT_ONLY;
const only = process.env.BANK_MAP_PROOF_ONLY || holdout;
const tests = only
  ? []
  : [
      'tests/bank-cashbook-map.test.ts',
      'tests/bank-statement-map-lifecycle.test.ts',
    ];
const proofs = holdout
  ? [['scripts/bank-map-holdout.mjs', '--assert=run-1.json']]
  : [['scripts/bank-map-proof.mjs'], ['scripts/bank-map-lifecycle.mjs']];
// The proof reads the sealed periods where they are sealed.
const packages = holdout
  ? [
      'audit/bank-map-foundation',
      'audit/bank-map-holdout-m4',
      'audit/bank-roll-holdout-w4',
      'audit/bank-sheet-holdout-r4',
      'audit/bank-review-holdout-r3',
    ]
  : [
      'audit/bank-map-foundation',
      'audit/bank-roll-foundation',
      'audit/bank-review-foundation',
    ];
const MAP = 'lib/reconciliation/bank-cashbook-map.ts';
const READ = 'lib/reconciliation/bank-statement-match.ts';
const LIFE = 'lib/reconciliation/bank-statement-lifecycle.ts';
const REQ = 'lib/reconciliation/bank-statement-request.ts';
const mutations = [
  // The normal form of a label.
  [
    'labels-without-nfc',
    MAP,
    "  return text.normalize('NFC').replace(/\\s+/gu, ' ').trim();",
    "  return text.replace(/\\s+/gu, ' ').trim();",
  ],
  [
    'labels-trimmed-only',
    MAP,
    "  return text.normalize('NFC').replace(/\\s+/gu, ' ').trim();",
    "  return text.normalize('NFC').trim();",
  ],
  [
    'labels-without-case',
    MAP,
    "  return text.normalize('NFC').replace(/\\s+/gu, ' ').trim();",
    "  return text.normalize('NFC').replace(/\\s+/gu, ' ').trim().toLowerCase();",
  ],
  // Fit.
  [
    'fit-by-position-only',
    MAP,
    '    if (found === entry.label) continue;',
    '    continue;',
  ],
  [
    'elsewhere-on-the-header-row-only',
    MAP,
    '    for (let r = 1; r <= rows; r++)',
    '    for (let r = columns.header; r <= columns.header; r++)',
  ],
  [
    'elsewhere-beyond-thirty-rows',
    MAP,
    '  const rows = Math.min(CASHBOOK_MAP_LIMITS.header, file.sheets[0].rows.length);',
    '  const rows = file.sheets[0].rows.length;',
  ],
  ['sheets-ignored', MAP, '  if (file.sheets.length !== 1)', '  if (false)'],
  [
    'header-row-not-checked',
    MAP,
    '  if (header > file.sheets[0].rows.length)',
    '  if (false)',
  ],
  // A map's validity.
  [
    'reference-required',
    MAP,
    "  'voucher',\n  'receipts',",
    "  'voucher',\n  'reference',\n  'receipts',",
  ],
  [
    'one-column-for-two-roles',
    MAP,
    "    if (used.has(column)) refuse('MAP_COLUMN', `column ${column} twice`);",
    '',
  ],
  ['extra-keys-carried', MAP, '    !sameKeys(value, keys) ||\n', ''],
  [
    'role-entry-keys-unchecked',
    MAP,
    '    Object.values(columns).some(',
    '    false && Object.values(columns).some(',
  ],
  [
    'text-not-in-normal-form-accepted',
    MAP,
    '  normalLabel(value) === value &&\n',
    '',
  ],
  ['control-characters-accepted', MAP, '  !control(value);', '  true;'],
  [
    'no-size-limit',
    MAP,
    '  if (data.byteLength > CASHBOOK_MAP_LIMITS.bytes)',
    '  if (false)',
  ],
  ['bytes-decoded-leniently', MAP, '{ fatal: true }', '{ fatal: false }'],
  [
    'header-31-accepted',
    MAP,
    '  if (!within(value.header, CASHBOOK_MAP_LIMITS.header))',
    '  if (!within(value.header, CASHBOOK_MAP_LIMITS.header + 1))',
  ],
  // A choice by hand, and what the reading leaves out.
  [
    'labels-read-before-the-file-is-checked',
    MAP,
    '  if (problems.length) return { problems };',
    '',
  ],
  [
    'unread-lists-mapped-columns',
    MAP,
    '    if (label && !used.has(c)) unread.push({ column: c, label });',
    '    if (label) unread.push({ column: c, label });',
  ],
  [
    'above-not-counted',
    MAP,
    '  return { above: columns.header - 1, unread };',
    '  return { above: 0, unread };',
  ],
  // Saved maps.
  [
    'same-name-kept-twice',
    MAP,
    '  if (at >= 0) return maps.map((m, i) => (i === at ? checked : m));\n',
    '',
  ],
  [
    'no-limit-on-saved-maps',
    MAP,
    '  if (maps.length >= CASHBOOK_MAP_LIMITS.maps) return null;\n',
    '',
  ],
  [
    'stored-duplicates-offered',
    MAP,
    '      if (maps.some((m) => m.name === map.name)) unreadable++;\n      else maps.push(map);',
    '      maps.push(map);',
  ],
  // The mapped reading.
  [
    'misfit-read',
    READ,
    "  if (problems.length)\n    throw new CashbookReadError(\n      'MAP',",
    "  if (false)\n    throw new CashbookReadError(\n      'MAP',",
  ],
  ['header-cells-not-recorded', READ, '  recorded(header);\n', ''],
  [
    'rows-above-read',
    READ,
    '  for (const [i, cells] of sheet.rows.slice(header).entries()) {\n    const row = i + header + 1;',
    '  for (const [i, cells] of sheet.rows.slice(1).entries()) {\n    const row = i + 2;',
  ],
  [
    'unlabelled-values-read',
    READ,
    '    if (cells.some((s, k) => !labelled.has(k + 1) && s.trim()))',
    '    if (false)',
  ],
  [
    'empty-mapped-row-skipped',
    READ,
    "      throw new CashbookReadError('ROW', row, 'no value in the mapped columns');",
    '      continue;',
  ],
  [
    'typed-amount-looked-up-in-the-declared-column',
    READ,
    "    const payment = amount(payments, row, at('payments'), 'payments');",
    "    const payment = amount(payments, row, 6, 'payments');",
  ],
  [
    'reference-issues-on-every-column',
    READ,
    "        ...(role === 'voucher' || role === 'reference'",
    '        ...(true',
  ],
  [
    'precision-note-by-the-declared-letters',
    READ,
    '            numericPrecisionIssue(`${columnLetters(column)}${row}`) === issue',
    "            numericPrecisionIssue(`${'ABCDEF'[column - 1]}${row}`) === issue",
  ],
  // M2: the columns in the lifecycle and the session.
  [
    'mapped-reader-not-used',
    LIFE,
    '  const cashbook = columns\n    ? readMappedBankCashbook(cashbookSource, reading.currency, columns)\n    : readBankCashbookTable(cashbookSource, reading.currency);',
    '  const cashbook = readBankCashbookTable(cashbookSource, reading.currency);',
  ],
  [
    'context-without-columns',
    LIFE,
    '    ...(columns ? [columns] : []),\n  ]);',
    '  ]);',
  ],
  [
    'reading-reused-across-columns',
    LIFE,
    '        JSON.stringify(f.columns ?? null) ===\n          JSON.stringify(state.files[i].columns ?? null) &&\n',
    '',
  ],
  [
    'session-drops-columns',
    LIFE,
    '      version: BANK_STATEMENT_LIFECYCLE_VERSION,\n      files: state.files.map((f) => ({\n        name: f.name,\n        sha256: f.sha256,\n        data: encode(f.original),\n        ...(f.columns ? { columns: f.columns } : {}),\n',
    '      version: BANK_STATEMENT_LIFECYCLE_VERSION,\n      files: state.files.map((f) => ({\n        name: f.name,\n        sha256: f.sha256,\n        data: encode(f.original),\n',
  ],
  [
    'restore-drops-columns',
    LIFE,
    '      ...(mapped ? { columns: f.columns } : {}),\n',
    '',
  ],
  [
    'result-without-what-was-left-out',
    LIFE,
    '          ? { columns: structuredClone(f.columns), ...base.unread }',
    '          ? { columns: structuredClone(f.columns) }',
  ],
  // The same two in a period that carries (WF-1 cycle).
  [
    'carrying-context-without-columns',
    LIFE,
    '    ...(state.files[1].columns ? [state.files[1].columns] : []),\n  ]);',
    '  ]);',
  ],
  [
    'carrying-result-without-what-was-left-out',
    LIFE,
    '      ...(unread ? { unread } : {}),\n',
    '',
  ],
  [
    'mapped-reading-writable',
    LIFE,
    '  if (columns)\n    return frozen({\n',
    '  if (columns)\n    return ({\n',
  ],
  [
    'workbook-without-columns-sheet',
    LIFE,
    "  if (mapped)\n    table(\n      'Cashbook columns',",
    "  if (false)\n    table(\n      'Cashbook columns',",
  ],
  [
    'columns-on-the-statement-accepted',
    REQ,
    "    const mapped = i === 1 && statementPlain(f) && 'columns' in f;",
    "    const mapped = statementPlain(f) && 'columns' in f;",
  ],
  [
    'mapped-state-shares-bytes',
    REQ,
    '        original: f.original.slice(0),\n        columns,\n',
    '        original: f.original,\n        columns,\n',
  ],
  [
    'session-columns-unchecked',
    REQ,
    '        columns = cashbookColumnsOf(f.columns);',
    '        columns = f.columns as CashbookColumns;',
  ],
  [
    'session-columns-carry-other-keys',
    MAP,
    "  if (!plain(value) || !sameKeys(value, ['header', 'columns']))\n    return refuse(",
    '  if (!plain(value))\n    return refuse(',
  ],
];
const files = [
  ...new Set(mutations.map(([, file]) => file)),
  ...tests,
  ...proofs.map(([script]) => script),
];
const digest = (b) => createHash('sha256').update(b).digest('hex');
const before = Object.fromEntries(
  await Promise.all(
    files.map(async (p) => [p, digest(await readFile(join(root, p)))]),
  ),
);
const run = (cwd) => {
  const options = {
    cwd,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  };
  let last = null;
  if (tests.length) {
    last = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--test', ...tests],
      options,
    );
    if (!completedSuccessfully(last)) return last;
  }
  for (const [proof, ...args] of proofs) {
    last = spawnSync(
      process.execPath,
      ['--experimental-strip-types', proof, ...args],
      {
        ...options,
        env: {
          ...process.env,
          BANK_MAP_LIFECYCLE_DIR: out,
          BANK_MAP_HOLDOUT_DIR: out,
        },
      },
    );
    if (!completedSuccessfully(last)) return last;
  }
  return last;
};
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
      for (const name of [
        'lib',
        ...tests,
        ...proofs.map(([script]) => script),
        ...packages,
        'package.json',
      ])
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
      survivors: report.mutations.filter((r) => !r.killed).map((r) => r.id),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
