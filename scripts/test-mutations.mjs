// Deliberate accounting faults must be caught by assertion failures in the real
// regression suite. Every mutant runs in a disposable copy; source is untouched.
import {
  mkdtemp,
  cp,
  symlink,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const tests = [
  'tests/core.test.ts',
  'tests/pdf-stream-integrity.test.ts',
  'tests/visual-boundary.test.ts',
  'tests/reliability.test.ts',
  'tests/assistant-adversarial.test.ts',
  'tests/supplier-layouts.test.ts',
  'tests/excel-import-regression.test.ts',
  'tests/import-selection.test.ts',
  'tests/pdf-adversarial.test.ts',
  'tests/ordinary-statements.test.ts',
  'tests/simplicity-safety.test.ts',
  'tests/statement-direction.test.ts',
  'tests/xlsx-namespaces.test.ts',
  'tests/pdf-column-suggestions.test.ts',
  'tests/layout-inference-audit.test.ts',
  'tests/xlsx-diversity-audit.test.ts',
  'tests/pdf-diversity-audit.test.ts',
  'tests/matching-diversity-audit.test.ts',
  'tests/ai-evidence-boundary.test.ts',
  'tests/import-proposals.test.ts',
  'tests/local-ai-context.test.ts',
  'tests/reliability-import-045.test.ts',
  'tests/reliability-core-045.test.ts',
  'tests/reliability-scope-045.test.ts',
  'tests/reliability-groups-046.test.ts',
  'tests/template-session-046.test.ts',
  'tests/input-readiness-046.test.ts',
  'tests/format-choice-provenance-047.test.ts',
  'tests/ambiguity-gate-acceptance-047.test.ts',
  'tests/hard-cases.test.ts',
];
const mutations = [
  {
    // Removing the guard must not look like a passing candidate.
    name: '047-accept-unanswered-format-ambiguity',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        "      if (\n        assessment.status === 'ambiguous' &&",
        "      if (\n        false &&\n        assessment.status === 'ambiguous' &&",
      ],
    ],
  },
  {
    // Nor must a guard that throws something other than its own refusal: an
    // unrelated fault is a defect, and must never be credited as protection.
    name: '047-ambiguity-guard-throws-unrelated-error',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        '        throw new InputReadinessError(\n          `${file.name}: صيغة ${fieldLabel(field)} تحتمل',
        '        throw new TypeError(\n          `${file.name}: صيغة ${fieldLabel(field)} تحتمل',
      ],
    ],
  },
  {
    // A choice must stay bound to the reading it was given for.
    name: '047-reuse-format-choice-across-context',
    file: 'lib/reconciliation/input-readiness.ts',
    changes: [
      [
        "  if (!choice || typeof choice !== 'object') return false;",
        '  return true;',
      ],
    ],
  },
  {
    name: '046-disable-all-supported-groups',
    file: 'lib/reconciliation/cases.ts',
    changes: [
      [
        'const complete = !supplier.errors.length && !ledger.errors.length;',
        'const complete = false;',
      ],
    ],
  },
  {
    name: '046-accept-payment-groups-without-explicit-identity',
    file: 'lib/reconciliation/cases.ts',
    changes: [['? !!paymentIdentity', '? true']],
  },
  {
    name: 'hard-t01-read-any-label-ending-in-invoice',
    file: 'lib/reconciliation/transaction-references.ts',
    changes: [
      [
        '/^(?:(?:ap |tax |vendor |supplier |purchase )?(?:invoice|invoice line)',
        '/(?:(?:ap |tax |vendor |supplier |purchase )?(?:invoice|invoice line)',
      ],
    ],
  },
  {
    name: 'hard-g08-accept-payment-parts-beyond-the-date-window',
    file: 'lib/reconciliation/cases.ts',
    changes: [['groupSpan <= scope.dateWindow', 'true']],
  },
  {
    name: 'hard-g08-accept-any-group-across-dates',
    file: 'lib/reconciliation/cases.ts',
    changes: [['sameGroupDate ||', 'true ||']],
  },
  {
    name: '045-ignore-declared-aging-report',
    file: 'lib/reconciliation/report-scope.ts',
    changes: [[/if\s*\(title\)/, 'if (false)']],
  },
  {
    name: '045-skip-generic-account-scope-evidence',
    file: 'lib/reconciliation/report-scope.ts',
    changes: [
      [
        /export function collectGenericAccounts\([\s\S]*?\)\s*\{/,
        '$&\n  return; // deliberate loss of source account evidence',
      ],
    ],
  },
  {
    name: '045-allow-a-second-sheetdata-to-drop-earlier-rows',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [['if (sheetDataSeen)', 'if (false)']],
  },
  {
    name: '045-concatenate-conflicting-xlsx-cell-payloads',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [
      [
        /if\s*\(\s*cell\.hasInline\s*\|\|\s*cell\.hasValue\s*\|\|\s*cell\.hasFormula\s*\|\|\s*cell\.type !== 'inlineStr'\s*\)/,
        'if (false)',
      ],
    ],
  },
  {
    name: 'accept-a-partial-pdf-operator-stream',
    file: 'lib/reconciliation/pdf.ts',
    changes: [
      [
        'await streamGuard.assertComplete();',
        '/* deliberately skip completeness */',
      ],
    ],
  },
  {
    name: 'allow-visual-drafts-into-accounting',
    file: 'lib/reconciliation/source-boundary.ts',
    changes: [["source.kind === 'visual-draft'", 'false']],
  },
  {
    name: 'reuse-an-ai-column-proposal-after-settings-change',
    file: 'lib/reconciliation/import-proposals.ts',
    changes: [['input.baseline !== context.baseline', 'false']],
  },
  {
    name: 'trust-stale-case-member-evidence',
    file: 'lib/reconciliation/assistant.ts',
    changes: [['!sameTransactionEvidence(t, member)', 'false']],
  },
  {
    name: 'allow-ai-proposals-outside-the-evidence-window',
    file: 'lib/reconciliation/local-ai.ts',
    changes: [
      ['suppliedIds && proposed.some((id) => !suppliedIds.has(id))', 'false'],
    ],
  },
  {
    name: 'skip-an-earlier-table-for-a-richer-later-header',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'const firstTable = headerRows.findIndex(',
        'const firstTable = -1; const ignoredFirstTable = headerRows.findIndex(',
      ],
    ],
  },
  {
    name: 'ignore-known-document-evidence-conflicts',
    file: 'lib/reconciliation/core.ts',
    changes: [
      ['if (identityConflicts(s, l).length) continue;', 'if (false) continue;'],
    ],
  },
  {
    name: 'accept-duplicate-posting-lines-as-a-group',
    file: 'lib/reconciliation/cases.ts',
    changes: [['!duplicatePosting &&', 'true &&']],
  },
  {
    name: 'ignore-xlsx-overwritten-cell-addresses',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [['if (address && seenCells.has(address))', 'if (false)']],
  },
  {
    name: 'silently-round-original-xlsx-numeric-lexemes',
    file: 'lib/reconciliation/xlsx-namespaces.ts',
    changes: [[/if\s*\(inspected\.numericIssues\.length\)/, 'if (false)']],
  },
  {
    name: 'ignore-pdf-overlap-between-separate-baselines',
    file: 'lib/reconciliation/pdf.ts',
    changes: [['if (overlapRows.has(lineIndex))', 'if (false)']],
  },
  {
    name: 'reject-supported-multisheet-workpapers',
    file: 'lib/reconciliation/types.ts',
    changes: [
      ['export const MAX_SHEETS = 40;', 'export const MAX_SHEETS = 12;'],
    ],
  },
  {
    name: 'reject-unused-helper-formulas',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (!sheet.cellIssues && formulaRows.has(rn))',
        'if (formulaRows.has(rn))',
      ],
    ],
  },
  {
    name: 'treat-pdf-table-edges-as-filled-area',
    file: 'lib/reconciliation/pdf.ts',
    changes: [['if (overlaps === false) continue;', 'if (false) continue;']],
  },
  {
    name: 'count-total-rows-as-transactions',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (labelCell === first) return labelCell.value;',
        'if (labelCell === first) return undefined;',
      ],
    ],
  },
  {
    name: 'drop-classified-rows-without-a-reason',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        `reason: \`صف إجمالي أو رصيد — استُبعد تلقائيًا («\${label.trim()}»)\`,`,
        "reason: '',",
      ],
    ],
  },
  {
    name: 'accept-a-timestamp-as-a-read-issue',
    file: 'lib/reconciliation/io.ts',
    changes: [
      [
        'const note = (row: number, column: number, message: string) => {\n      (cellNotes[`${row}:${column}`] ??= []).push(message);',
        'const note = (row: number, column: number, message: string) => {\n      (cellIssues[`${row}:${column}`] ??= []).push(message);',
      ],
    ],
  },
  {
    name: 'automatically-match-with-unread-potential-duplicates',
    file: 'lib/reconciliation/core.ts',
    changes: [['!completeReading ||', 'false ||']],
  },
  {
    name: 'classify-any-summary-word-as-a-nontransaction',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        /const label = structuralSummaryLabel\([\s\S]*?\);/,
        'const label = row.find(value => summaryLabel.test(value.trim()));',
      ],
    ],
  },
  {
    name: 'ignore-date-and-reference-in-reordered-summary-rows',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        /if\s*\(\s*\(date && date !== labelCell\.value\)\s*\|\|\s*references\.some\(\(?value\)?\s*=>\s*value !== labelCell\.value\)\s*\)\s*return;/,
        'if (false) return;',
      ],
    ],
  },
  {
    name: 'prove-direction-from-a-single-movement',
    file: 'lib/reconciliation/statement-direction.ts',
    changes: [['nonzeroSteps < 2', 'nonzeroSteps < 1']],
  },
  {
    name: 'reverse-proven-ap-direction',
    file: 'lib/reconciliation/statement-direction.ts',
    changes: [['delta === -net ? -1', 'delta === -net ? 1']],
  },
  {
    name: 'ignore-contradictory-closing-footer-in-direction-proof',
    file: 'lib/reconciliation/statement-direction.ts',
    changes: [['footerAmounts[0] !== previousBalance', 'false']],
  },
  {
    name: 'reverse-source-sign',
    file: 'lib/reconciliation/core.ts',
    changes: [
      ['amount *= mapping.multiplier;', 'amount *= -mapping.multiplier;'],
    ],
  },
  {
    name: 'fuzzy-reference-auto-match',
    file: 'lib/reconciliation/core.ts',
    changes: [
      [
        'if (s.reference.trim() !== l.reference.trim()) continue;',
        'if (false) continue;',
      ],
    ],
  },
  {
    name: 'ignore-date-window',
    file: 'lib/reconciliation/core.ts',
    changes: [['if (days <= scope.dateWindow)', 'if (true)']],
  },
  {
    name: 'ignore-reference-duplicates',
    file: 'lib/reconciliation/core.ts',
    changes: [
      ['refA.get(s.normalizedReference)?.length !== 1', 'false'],
      ['refB.get(s.normalizedReference)?.length !== 1', 'false'],
    ],
  },
  {
    name: 'allow-unconfirmed-coverage',
    file: 'lib/reconciliation/core.ts',
    changes: [
      ['arithmeticValid && scope.coverageConfirmed', 'arithmeticValid && true'],
    ],
  },
  {
    name: 'promote-ai-hypothesis',
    file: 'lib/reconciliation/assistant.ts',
    changes: [
      ["status: 'needs-review' as const", "status: 'confirmed' as const"],
    ],
  },
  {
    name: 'corrupt-exported-amount',
    file: 'lib/reconciliation/io.ts',
    changes: [['t.amount / 10 ** dp,', '(t.amount + 1) / 10 ** dp,']],
  },
];

const args = process.argv.slice(2);
let filter = '';
if (args.length) {
  if (args.length === 2 && args[0] === '--filter') filter = args[1];
  else if (args.length === 1 && args[0].startsWith('--filter='))
    filter = args[0].slice('--filter='.length);
  else
    throw Error(
      'Usage: node scripts/test-mutations.mjs [--filter name-substring]',
    );
  if (!filter) throw Error('Mutation filter must not be empty');
}
const selectedMutations = mutations.filter((mutation) =>
  mutation.name.includes(filter),
);
if (!selectedMutations.length) throw Error(`No mutation matches: ${filter}`);

function execute(cwd) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', '--test-reporter=tap', ...tests],
    {
      cwd,
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}
const baseline = execute(root);
if (baseline.status !== 0) {
  process.stderr.write(baseline.stdout + baseline.stderr);
  throw Error('Mutation gate requires a passing unmodified baseline');
}

const report = [];
for (const mutation of selectedMutations) {
  const scratch = await mkdtemp(join(tmpdir(), 'mizan-mutant-'));
  try {
    await Promise.all(
      ['lib', 'tests', 'package.json'].map((name) =>
        cp(join(root, name), join(scratch, name), { recursive: true }),
      ),
    );
    await symlink(
      join(root, 'node_modules'),
      join(scratch, 'node_modules'),
      'dir',
    );
    const file = join(scratch, mutation.file);
    let source = await readFile(file, 'utf8');
    for (const [before, after] of mutation.changes) {
      // Some accounting statements span multiple lines after formatting. Match
      // their syntax with a bounded regex while retaining exact uniqueness.
      const count =
        before instanceof RegExp
          ? [...source.matchAll(new RegExp(before.source, 'g'))].length
          : source.split(before).length - 1;
      if (count !== 1)
        throw Error(`Stale or non-unique mutation anchor: ${mutation.name}`);
      source = source.replace(before, after);
    }
    await writeFile(file, source);
    // A parser error is an invalid mutant, not evidence that an accounting
    // assertion detected the intended fault. Check syntax before the test run.
    const syntax = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--check', file],
      {
        cwd: scratch,
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    if (syntax.status !== 0)
      throw Error(
        `Invalid mutation syntax: ${mutation.name}\n${syntax.stdout}${syntax.stderr}`,
      );
    const result = execute(scratch);
    const assertionFailure =
      result.status !== 0 &&
      result.status !== null &&
      result.stdout.includes('ERR_ASSERTION') &&
      !/SyntaxError|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION/.test(
        result.stdout + result.stderr,
      );
    report.push({ mutation: mutation.name, detected: assertionFailure });
    if (!assertionFailure) {
      process.stderr.write(result.stdout + result.stderr);
      throw Error(
        `Fault survived or failed without an assertion: ${mutation.name}`,
      );
    }
    console.log(`Detected deliberate fault: ${mutation.name}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify(
    {
      baselinePassed: true,
      detected: report.length,
      total: selectedMutations.length,
      available: mutations.length,
      ...(filter ? { filter } : {}),
      mutations: report,
    },
    null,
    2,
  ),
);
