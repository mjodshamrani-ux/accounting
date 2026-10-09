import { fileURLToPath } from 'node:url';
import { runSpecializedFaults } from './specialized-faults.mjs';
const engine = 'lib/reconciliation/fixed-assets.ts',
  io = 'lib/reconciliation/fixed-assets-io.ts';
const tests = ['tests/fixed-assets.test.ts', 'tests/fixed-assets-io.test.ts'];
const faults = [
  [
    'cost-derived-from-carrying',
    engine,
    "cost = scaled(get('Cost'), decimals)",
    "cost = scaled(get('Carrying amount'), decimals)",
  ],
  [
    'carrying-equation-ignored',
    engine,
    "fail('CARRYING_EQUATION');",
    'void 0;',
  ],
  [
    'contra-negative-sign-flipped',
    engine,
    "normal: c === 'cost' ? debit - credit : credit - debit,",
    "normal: Math.abs(c === 'cost' ? debit - credit : credit - debit),",
  ],
  [
    'net-masks-component-differences',
    engine,
    'result.comparisons.some((c) => c.difference !== 0)',
    'result.totals?.register.carrying !== result.totals?.gl.carrying',
  ],
  [
    'zero-gl-account-dropped',
    engine,
    "if (!assigned.length) absent('unmapped-gl', 3, g.row, g.component);",
    '// zero/unmapped coverage removed',
  ],
  [
    'malformed-physical-member-lost',
    engine,
    '  result.financial =',
    '  result.memberIds = result.records.flatMap(rows => rows.map(row => row.memberId));\n  result.financial =',
  ],
  [
    'blocked-null-replaced-with-zero',
    engine,
    '  result.financial =',
    '  if (result.issues.length) result.totals = { register: {cost:0,depreciation:0,impairment:0,carrying:0},gl:{cost:0,depreciation:0,impairment:0,carrying:0} };\n  result.financial =',
  ],
  [
    'foreign-functional-scope-admitted',
    engine,
    "if (s.currencyBasis !== 'functional' || s.postingStatus !== 'posted')\n    fail('SCOPE');",
    '// scope admissibility removed',
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
      file: 'tests/fixed-assets.test.ts',
      name: 'asset calendar, metadata, currency and event budgets reject before cloning; year zero cannot reach acceptance',
    },
  ],
  'foreign-functional-scope-admitted': [
    {
      file: 'tests/fixed-assets.test.ts',
      name: 'asset calendar, metadata, currency and event budgets reject before cloning; year zero cannot reach acceptance',
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
      message: 'ASSET_READING',
      operator: 'doesNotReject',
      origin: { file: 'lib/reconciliation/fixed-assets.ts', function: 'fail' },
    },
  ],
};
await runSpecializedFaults({
  root: fileURLToPath(new URL('../', import.meta.url)),
  domain: 'fixed-assets',
  out: process.argv[2] ?? '../specialized-fault-evidence/fixed-assets',
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
            ? 'tests/fixed-assets-io.test.ts'
            : 'tests/fixed-assets.test.ts',
          name: name.startsWith('alias-')
            ? 'asset read, replay, save and export capture all source bytes and metadata before the first asynchronous digest'
            : '61 pre-engine asset Decimal truths preserve every component, equation, account, missing, raw cell and malformed member',
        },
      ]
    ).map((test) => ({
      ...test,
      allowedDomainErrors: domainErrors[name] ?? [],
    })),
  })),
});
