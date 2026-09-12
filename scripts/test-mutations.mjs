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
  'tests/reliability.test.ts',
  'tests/assistant-adversarial.test.ts',
  'tests/supplier-layouts.test.ts',
  'tests/excel-import-regression.test.ts',
  'tests/import-selection.test.ts',
  'tests/pdf-adversarial.test.ts',
];
const mutations = [
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
    changes: [['scope.coverageConfirmed &&', 'true &&']],
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
for (const mutation of mutations) {
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
      if (source.split(before).length !== 2)
        throw Error(`Stale or non-unique mutation anchor: ${mutation.name}`);
      source = source.replace(before, after);
    }
    await writeFile(file, source);
    const result = execute(scratch);
    const assertionFailure =
      result.status !== 0 &&
      result.status !== null &&
      result.stdout.includes('ERR_ASSERTION');
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
      total: mutations.length,
      mutations: report,
    },
    null,
    2,
  ),
);
