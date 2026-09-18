/** Synthetic test inventory only. No production parser or matcher is imported. */
export const GENERATOR_VERSION = 'tarasuf-independent-2.1.0';
export const DEFAULT_SEED = 0x45a71c;
export const CATEGORY_COUNTS = Object.freeze({
  clear: 2000,
  complex: 1000,
  reading: 1000,
  ambiguous: 500,
  invalid: 500,
});
export const layoutFamilies = Object.freeze({
  'dev-flat': {
    split: 'development',
    format: 'csv',
    writer: 'csv-records',
    language: 'en',
    columns: 'standard',
  },
  'dev-banner': {
    split: 'development',
    format: 'csv',
    writer: 'csv-records',
    language: 'ar',
    columns: 'reordered',
    banner: true,
  },
  'dev-workbook': {
    split: 'development',
    format: 'xlsx',
    writer: 'exceljs',
    language: 'en',
    columns: 'standard',
    banner: true,
  },
  'dev-text-page': {
    split: 'development',
    format: 'pdf',
    writer: 'pdf-text-objects',
    language: 'en',
    columns: 'standard',
    pageRows: 18,
  },
  'validation-delimited': {
    split: 'validation',
    format: 'csv',
    writer: 'csv-delimited',
    language: 'en',
    columns: 'reordered',
    delimiter: ';',
    banner: true,
  },
  'validation-workbook': {
    split: 'validation',
    format: 'xlsx',
    writer: 'exceljs',
    language: 'ar',
    columns: 'reordered',
    banner: true,
    extraSheet: true,
    repeatedHeader: true,
  },
  'validation-debit-credit': {
    split: 'validation',
    format: 'xlsx',
    writer: 'exceljs',
    language: 'en',
    columns: 'split',
    banner: true,
    blankRows: true,
  },
  'validation-text-page': {
    split: 'validation',
    format: 'pdf',
    writer: 'pdf-text-objects',
    language: 'en',
    columns: 'reordered',
    pageRows: 12,
    paintReverse: true,
  },
  // Final families use an independent OOXML producer and reserved geometry/quoting combinations.
  // Development must not materialize these before the engine freeze.
  'final-quoted': {
    split: 'final',
    format: 'csv',
    writer: 'csv-quoted',
    language: 'ar',
    columns: 'reordered',
    banner: true,
    multiline: true,
  },
  'final-ooxml': {
    split: 'final',
    format: 'xlsx',
    writer: 'ooxml-zip',
    language: 'en',
    columns: 'reordered',
    banner: true,
    extraSheet: true,
    blankRows: true,
  },
  'final-ooxml-split': {
    split: 'final',
    format: 'xlsx',
    writer: 'ooxml-zip',
    language: 'ar',
    columns: 'split',
    banner: true,
    repeatedHeader: true,
  },
  'final-fragmented-page': {
    split: 'final',
    format: 'pdf',
    writer: 'pdf-text-objects',
    language: 'en',
    columns: 'standard',
    pageRows: 9,
    paintReverse: true,
    fragments: true,
  },
});
const scenarios = {
  clear: [
    'invoices',
    'payments',
    'credit-notes',
    'mixed-movements',
    'opening-balanced',
    'long-references',
    'same-amount-distinct-references',
    'date-shift',
  ],
  complex: [
    'supplier-only',
    'ledger-only',
    'amount-variance',
    'opposite-errors',
    'opening-variance',
    'one-to-many-evidence',
    'many-to-one-evidence',
    'many-to-many',
    'partial-payment',
    'cutoff-movement',
    'report-basis-mismatch',
    'cross-account',
    'cross-currency',
  ],
  reading: [
    'offset-table',
    'arabic-numerals',
    'comma-decimals',
    'parenthesized-credits',
    'repeated-headers',
    'blank-rows',
    'multiple-sheets',
    'long-references',
    'text-formula-reference',
    'multi-page',
    'row-permutation',
  ],
  ambiguous: [
    'missing-reference',
    'numeric-generic-reference',
    'duplicate-reference',
    'sum-without-evidence',
    'normalization-collision',
    'same-reference-conflicting-types',
    'same-reference-date-conflict',
    'duplicate-accounting-entry',
    'near-equal-amount',
  ],
  invalid: [
    'corrupt-file',
    'formula-without-cache',
    'invalid-amount',
    'invalid-date',
    'wrong-currency',
    'empty-file',
    'unsupported-aging',
    'missing-amount-column',
    'wrong-total',
    'ambiguous-number',
  ],
};
// 40 explicit, independently calculated anchors, not 40 renderings of one scenario.
const foundationCategories = [
  ...Array(12).fill('clear'),
  ...Array(10).fill('complex'),
  ...Array(6).fill('reading'),
  ...Array(8).fill('ambiguous'),
  ...Array(4).fill('invalid'),
];
export function buildManifest({ seed = DEFAULT_SEED, count = 5000 } = {}) {
  if (
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 5000
  )
    throw new Error('seed/count must be safe integers; count is 1..5000');
  const full = [];
  const used = Object.fromEntries(
    Object.keys(CATEGORY_COUNTS).map((key) => [key, 0]),
  );
  for (let i = 0; i < 40; i++) {
    const category = foundationCategories[i];
    used[category]++;
    const families = Object.keys(layoutFamilies).filter(
      (id) => layoutFamilies[id].split === 'development',
    );
    full.push({
      id: `F${String(i + 1).padStart(2, '0')}`,
      index: i,
      category,
      split: 'development',
      scenario: 'manual-foundation',
      foundation: i + 1,
      seed: seed + i * 7919,
      layoutFamilyA: families[i % 4],
      layoutFamilyB: families[(i + 1) % 4],
    });
  }
  for (const [category, target] of Object.entries(CATEGORY_COUNTS)) {
    const remaining = target - used[category];
    for (let i = 0; i < remaining; i++) {
      const ratio = i / remaining;
      const split =
        ratio < 0.7 ? 'development' : ratio < 0.9 ? 'validation' : 'final';
      const families = Object.keys(layoutFamilies).filter(
        (id) => layoutFamilies[id].split === split,
      );
      const index = full.length;
      const scenario = scenarios[category][i % scenarios[category].length];
      let layoutFamilyA = families[i % 4];
      if (['formula-without-cache', 'multiple-sheets'].includes(scenario))
        layoutFamilyA = families.find(
          (family) => layoutFamilies[family].format === 'xlsx',
        );
      if (scenario === 'multi-page')
        layoutFamilyA = families.find(
          (family) => layoutFamilies[family].format === 'pdf',
        );
      if (
        scenario === 'corrupt-file' &&
        layoutFamilies[layoutFamilyA].format === 'csv'
      )
        layoutFamilyA = families.find(
          (family) => layoutFamilies[family].format === 'pdf',
        );
      full.push({
        id: `C${String(index + 1).padStart(5, '0')}`,
        index,
        category,
        split,
        scenario,
        foundation: null,
        seed: (seed + index * 7919) >>> 0,
        layoutFamilyA,
        layoutFamilyB: families[(i + 1 + (Math.floor(i / 4) % 3)) % 4],
        reservedCombination: split === 'final',
      });
    }
  }
  return full.slice(0, count);
}
export function summarizeManifest(manifest) {
  const counts = (field) =>
    manifest.reduce((out, entry) => {
      const key = entry[field];
      out[key] = (out[key] ?? 0) + 1;
      return out;
    }, {});
  return {
    generatorVersion: GENERATOR_VERSION,
    cases: manifest.length,
    categories: counts('category'),
    splits: counts('split'),
    scenarios: counts('scenario'),
    layoutFamilies: [
      ...new Set(
        manifest.flatMap((entry) => [entry.layoutFamilyA, entry.layoutFamilyB]),
      ),
    ].length,
    foundationCases: manifest.filter((entry) => entry.foundation).length,
    warning:
      'Synthetic coverage is not a market distribution; alternate renderings are not additional economic scenarios.',
  };
}
export function foundationManifest(options = {}) {
  return buildManifest({ ...options, count: 40 });
}
