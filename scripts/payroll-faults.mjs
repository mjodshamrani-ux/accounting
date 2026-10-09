import { fileURLToPath } from 'node:url';
import { runSpecializedFaults } from './specialized-faults.mjs';
const engine = 'lib/reconciliation/payroll.ts',
  io = 'lib/reconciliation/payroll-io.ts';
const tests = ['tests/payroll.test.ts', 'tests/payroll-io.test.ts'];
const faults = [
  [
    'gross-read-from-net',
    engine,
    "gross = scaled(get('Gross'), decimals)",
    "gross = scaled(get('Net'), decimals)",
  ],
  ['net-equation-ignored', engine, "fail('NET_EQUATION');", 'void 0;'],
  [
    'phase-ignored',
    engine,
    "if (phase !== PAYROLL_PHASES[i]) fail('PHASE');",
    '// phase removed',
  ],
  [
    'negative-normal-flipped',
    engine,
    "PAYROLL_SIGNS[i] === 'debit-positive'\n                ? debit - credit\n                : credit - debit,",
    "Math.abs(PAYROLL_SIGNS[i] === 'debit-positive' ? debit - credit : credit - debit),",
  ],
  [
    'net-masks-seven-components',
    engine,
    'result.comparisons.some((c) => c.difference !== 0)',
    "result.totals?.register.net !== result.totals?.gl['net-payable']",
  ],
  [
    'bank-difference-ignored',
    engine,
    'result.bankComparison.difference !== 0',
    'false',
  ],
  ['bank-scope-ignored', engine, "fail('BANK_SCOPE');", 'void 0;'],
  [
    'bank-cardinality-ignored',
    engine,
    "problem(4, 0, 'BANK_CARDINALITY');",
    'void 0;',
  ],
  [
    'clearing-account-identity-ignored',
    engine,
    "absent('net-liability-account', 1, cm[0].row, 'net-clearing');",
    'void 0;',
  ],
  [
    'zero-gl-account-lost',
    engine,
    "if (!assigned.length) absent('unmapped-gl', 3, g.row, g.component);",
    '// coverage removed',
  ],
  [
    'malformed-member-lost',
    engine,
    '  result.financial =',
    '  result.memberIds = result.records.flatMap(rows => rows.map(row => row.memberId));\n  result.financial =',
  ],
  [
    'blocked-bank-null-zero',
    engine,
    '  result.financial =',
    '  if (result.issues.length) result.bankComparison.difference = 0;\n  result.financial =',
  ],
  [
    'foreign-scope-admitted',
    engine,
    "if (s.currencyBasis !== 'functional' || s.postingStatus !== 'posted')\n    fail('SCOPE');",
    '// scope removed',
  ],
  ['year-zero-admitted', engine, "    value.slice(0, 4) === '0000' ||\n", ''],
  [
    'alias-original-before-await',
    io,
    'original: f.original!.slice(0),',
    'original: f.original!,',
  ],
  [
    'alias-metadata-before-await',
    io,
    'const metadata = structuredClone({',
    'const metadata = ({',
  ],
];
const specific = {
  'year-zero-admitted': [
    {
      file: 'tests/payroll.test.ts',
      name: 'payroll calendar, metadata, currency and event budgets reject before cloning; year zero cannot reach acceptance',
    },
  ],
  'foreign-scope-admitted': [
    {
      file: 'tests/payroll.test.ts',
      name: 'payroll calendar, metadata, currency and event budgets reject before cloning; year zero cannot reach acceptance',
    },
  ],
};
// Exact, fault-scoped domain exceptions at the owned snapshot assertion.
// Matching text alone is insufficient: the reporter also pins throwing origin,
// native Error identity, assertion operator and a complete leaf cause graph.
const domainErrors = {
  'alias-original-before-await': [
    {
      message:
        'النص يحتوي محارف تحكم أو ترميز Unicode غير صالح لملف Excel. صحح المصدر؛ لن تُحذف هذه المحارف تلقائيًا.',
      operator: 'doesNotReject',
      origin: {
        file: 'lib/reconciliation/io.ts',
        function: 'validateCellText',
      },
    },
  ],
  'alias-metadata-before-await': [
    {
      message: 'PAYROLL_READING',
      operator: 'doesNotReject',
      origin: { file: 'lib/reconciliation/payroll.ts', function: 'fail' },
    },
  ],
  'year-zero-admitted': [
    {
      message: 'PAYROLL_SCOPE_DATES',
      operator: 'throws',
      origin: { file: 'lib/reconciliation/payroll.ts', function: 'fail' },
    },
  ],
};
await runSpecializedFaults({
  root: fileURLToPath(new URL('../', import.meta.url)),
  domain: 'payroll',
  out: process.argv[2] ?? '../specialized-fault-evidence/payroll',
  tests,
  faults: faults.map(([name, file, needle, replacement]) => ({
    name,
    file,
    needle,
    replacement,
    expectedTests: (
      specific[name] ?? [
        {
          file: name.startsWith('alias-')
            ? 'tests/payroll-io.test.ts'
            : 'tests/payroll.test.ts',
          name: name.startsWith('alias-')
            ? 'payroll read, replay, save and export capture all source bytes and metadata before the first asynchronous digest'
            : '100 pre-engine payroll Decimal truths preserve every component, equation, account, missing, raw cell and malformed member',
        },
      ]
    ).map((test) => ({
      ...test,
      allowedDomainErrors: domainErrors[name] ?? [],
    })),
  })),
});
