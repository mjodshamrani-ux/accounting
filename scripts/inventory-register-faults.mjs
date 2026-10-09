import { fileURLToPath } from 'node:url';
import { runSpecializedFaults } from './specialized-faults.mjs';
const engine = 'lib/reconciliation/inventory-register.ts',
  io = 'lib/reconciliation/inventory-register-io.ts';
const tests = [
  'tests/inventory-register.test.ts',
  'tests/inventory-register-io.test.ts',
  'tests/inventory-register-calendar.test.ts',
];
const faults = [
  [
    'permit-gregorian-year-zero',
    engine,
    "    value.slice(0, 4) === '0000' ||\n",
    '',
  ],
  [
    'quantity-invents-value',
    engine,
    'v[5] = scaled(v[5] as string, decimals);',
    'v[5] = v[2];',
  ],
  [
    'drop-zero-gl',
    engine,
    'const v = gl.values,',
    'if (gl.values[3] === 0 && gl.values[4] === 0) continue;\n    const v = gl.values,',
  ],
  [
    'mask-opposite-differences',
    engine,
    'result.comparisons.some((r) => r.differenceMinor !== 0)',
    'result.totals?.registerMinor !== result.totals?.glMinor',
  ],
  [
    'lose-malformed-member',
    engine,
    'if (index > 0 && !blank) result.memberIds.push(id);',
    'if (index > 0 && !blank && raw.length === header.length) result.memberIds.push(id);',
  ],
  [
    'blocked-null-to-zero',
    engine,
    'result.totals = null;',
    'result.totals = { registerMinor: 0, glMinor: 0 };',
  ],
  [
    'allow-foreign-unposted-scope',
    engine,
    "if (s.currencyBasis !== 'functional' || s.postingStatus !== 'posted')\n    fail('SCOPE');",
    '// scope admissibility removed',
  ],
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
  'lose-malformed-member': [
    {
      file: 'tests/inventory-register-io.test.ts',
      name: 'Declared comma grammar retains malformed semicolon physical members and read/reconcile worker envelopes fail closed',
    },
  ],
  'permit-gregorian-year-zero': [
    {
      file: 'tests/inventory-register-calendar.test.ts',
      name: 'inventory public IO rejects Gregorian year zero in scope, evidence and event; year 0001 and 9999 retain whole decision/session/export',
    },
  ],
  'allow-foreign-unposted-scope': [
    {
      file: 'tests/inventory-register.test.ts',
      name: 'Independent scope, role and capacity boundaries reject before authority or event clone',
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
      message: 'STOCK_EVENT_CAPACITY',
      operator: 'doesNotReject',
      origin: {
        file: 'lib/reconciliation/inventory-register.ts',
        function: 'fail',
      },
    },
  ],
};
await runSpecializedFaults({
  root: fileURLToPath(new URL('../', import.meta.url)),
  domain: 'inventory-register',
  out: process.argv[2] ?? '../specialized-fault-evidence/inventory-register',
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
            ? 'tests/inventory-register-io.test.ts'
            : 'tests/inventory-register.test.ts',
          name: name.startsWith('alias-')
            ? 'Snapshots all4 original bytes and all metadata before first await; original hashes and forged cached money cannot authorize results'
            : '41 pre-engine CSV Decimal truths preserve separate quantity/value, comparisons, all cells, physical inventory and malformed members',
        },
      ]
    ).map((test) => ({
      ...test,
      allowedDomainErrors: domainErrors[name] ?? [],
    })),
  })),
});
