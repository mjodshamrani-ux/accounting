// WF-1 REPORT-1 R1 code mutations: each planted defect in a private copy of
// the sheet engine (bank-statement-sheet.ts) must make its unit tests or the
// proof against the sealed EXPECTED.json fail with an assertion. A survivor
// is a rule nothing holds.
//   node scripts/test-bank-sheet-mutations.mjs
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
  process.env.BANK_SHEET_MUTATION_DIR ??
  join(root, 'work/bank-sheet-mutations');
await mkdir(output, { recursive: true });
const out = await mkdtemp(join(output, 'run-'));
// BANK_SHEET_PROOF_ONLY=1 measures the proof alone, without the unit tests.
const tests = process.env.BANK_SHEET_PROOF_ONLY
  ? []
  : ['tests/bank-statement-sheet.test.ts'];
const proofs = ['scripts/bank-sheet-proof.mjs'];
const SHEET = 'lib/reconciliation/bank-statement-sheet.ts';
const mutations = [
  // Refusals and their order.
  [
    'held-status-ignored',
    SHEET,
    "result.status === 'held' ||\n    match.held ||",
    'match.held ||',
  ],
  [
    'refused-previous-ignored',
    SHEET,
    "  if (result.roll?.previous.status === 'refused')\n    return { refusal: 'SHEET_PREVIOUS_REFUSED' };\n",
    '',
  ],
  [
    'book-before-held',
    SHEET,
    "  if (reading.format !== 'pdf') fail('FORMAT');\n",
    "  if (reading.format !== 'pdf') fail('FORMAT');\n  if (book === null) return { refusal: 'SHEET_NO_BOOK_BALANCE' };\n",
  ],
  [
    'book-not-validated',
    SHEET,
    'const declared = bookBalance(book);',
    'const declared = book;',
  ],
  [
    'note-controls-admitted',
    SHEET,
    '/[\\p{Cc}\\p{Cf}]/u.test(v.note)',
    'false',
  ],
  // Origins.
  [
    'rejected-as-unmatched',
    SHEET,
    "o.origin === 'unmatched' ? 'unmatched' : 'rejected',",
    "'unmatched',",
  ],
  [
    'pending-not-listed',
    SHEET,
    "const pending = result.cases.filter((c) => c.status === 'needs-review');",
    'const pending = [] as typeof result.cases;',
  ],
  [
    'unmatched-kept-over-pending',
    SHEET,
    'current.set(`${side}:${id}`, {',
    'if (!current.has(`${side}:${id}`)) current.set(`${side}:${id}`, {',
  ],
  [
    'pending-carried-age-not-advanced',
    SHEET,
    "items.push(old(key, 'pending', c.id, carried.get(key)!.age + 1));",
    "items.push(old(key, 'pending', c.id, carried.get(key)!.age));",
  ],
  [
    'rejected-carried-as-carried',
    SHEET,
    "old(x.key, rejected ? 'rejected' : 'carried', rejected?.id ?? null, x.age),",
    "old(x.key, 'carried', null, x.age),",
  ],
  [
    'still-carried-dropped',
    SHEET,
    'for (const x of result.roll?.outstanding ?? []) {',
    "for (const x of [] as NonNullable<typeof result.roll>['outstanding']) {",
  ],
  // Arithmetic and status.
  [
    'opposite-items-netted',
    SHEET,
    '  const sections = Object.fromEntries(',
    '  for (const a of [...items]) {\n    const b = items.find((x) => x !== a && items.includes(a) && x.side === a.side && x.amount === a.amount && x.direction !== a.direction);\n    if (b) items.splice(items.indexOf(a), 1), items.splice(items.indexOf(b), 1);\n  }\n  const sections = Object.fromEntries(',
  ],
  [
    'bank-side-reversed',
    SHEET,
    'reading.closing +\n    sections.bookReceiptsNotOnStatement.total -\n    sections.bookPaymentsNotOnStatement.total;',
    'reading.closing -\n    sections.bookReceiptsNotOnStatement.total +\n    sections.bookPaymentsNotOnStatement.total;',
  ],
  [
    'book-side-reversed',
    SHEET,
    'declared.balance +\n    sections.statementDepositsNotInBook.total -\n    sections.statementWithdrawalsNotInBook.total;',
    'declared.balance -\n    sections.statementDepositsNotInBook.total +\n    sections.statementWithdrawalsNotInBook.total;',
  ],
  [
    'difference-reversed',
    SHEET,
    'const difference = adjustedBank - adjustedBook;',
    'const difference = adjustedBook - adjustedBank;',
  ],
  [
    'bank-from-opening',
    SHEET,
    'reading.closing +\n    sections.bookReceiptsNotOnStatement.total',
    '(reading.opening ?? 0) +\n    sections.bookReceiptsNotOnStatement.total',
  ],
  [
    'draft-ignored',
    SHEET,
    "status: items.some((i) => i.origin === 'pending')",
    'status: false',
  ],
  [
    'one-unit-tolerated',
    SHEET,
    ': difference === 0',
    ': Math.abs(difference) <= 1',
  ],
  [
    'statement-order-ignored',
    SHEET,
    "item.side === 'statement' ? Number(item.id.slice(1)) : (item.row ?? 0),",
    "item.side === 'statement' ? 0 : (item.row ?? 0),",
  ],
  // The sign-off fingerprint.
  [
    'fingerprint-without-items',
    SHEET,
    'JSON.stringify(canonical(sheet))',
    'JSON.stringify(canonical({ ...sheet, sections: null }))',
  ],
  [
    'fingerprint-key-order',
    SHEET,
    'Object.keys(v)\n            .sort()\n',
    'Object.keys(v)\n',
  ],
];
const files = [...new Set(mutations.map(([, file]) => file)), ...tests, ...proofs];
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
  for (const proof of proofs) {
    last = spawnSync(process.execPath, ['--experimental-strip-types', proof], {
      ...options,
      env: {
        ...process.env,
      },
    });
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
        ...proofs,
        'audit/bank-sheet-foundation',
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
