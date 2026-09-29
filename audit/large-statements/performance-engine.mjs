// Synthetic engine workloads only: no PDF parsing, browser, export or bank
// correctness claim. Shared fixture facts also drive conservation tests.
import { cpus, platform, arch } from 'node:os';
import { pathToFileURL } from 'node:url';
import { compare, normalizeSource } from '../../lib/reconciliation/core.ts';
import {
  defaultMapping,
  ENGINE_VERSION,
} from '../../lib/reconciliation/types.ts';

export const scope = {
  supplier: 'Synthetic large supplier',
  entity: 'Synthetic buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  amount: 3,
  description: 7,
  currencyColumn: 8,
};
export function sourcePair(a, b) {
  return [a, b].map((rows, i) =>
    normalizeSource(
      {
        name: `${i ? 'ledger' : 'supplier'}-synthetic.csv`,
        sheets: [
          {
            name: 'Data',
            formulaRows: [],
            hiddenRows: [],
            rows: [
              [
                'Date',
                'Document No',
                'Reference',
                'Amount',
                'Type',
                'Bank Reference',
                'Receipt No',
                'Description',
                'Currency',
              ],
              ...rows.map((r) => [
                '2026-07-15',
                r.document ?? 'PAY-LARGE-1',
                r.chosen ?? 'PAY-LARGE-1',
                r.amount,
                r.type ?? 'Payment',
                r.bank ?? '',
                '',
                '',
                'SAR',
              ]),
            ],
          },
        ],
      },
      mapping,
      scope,
      i ? 'ledger' : 'supplier',
    ),
  );
}
export function oversizedRows(size) {
  return Array.from({ length: size }, (_, i) => ({
    amount: String(-(i + 1)),
    bank: 'BANK-LARGE-1',
  }));
}
export function mixedRows(size) {
  if (size % 4)
    throw Error('The mixed workload requires a multiple of four rows');
  const a = [],
    b = [];
  for (let i = 0; i < size / 4; i++) {
    const row = (document, chosen, amount) => ({
      document,
      chosen,
      amount,
      type: 'Invoice',
    });
    a.push(
      row(`DOC-${i}`, 'A', '1'),
      row(`DOC-${i}`, 'B', '2'),
      row(`SUP-${i}`, 'C', '3'),
      row(`SUP-${i}`, 'D', '4'),
    );
    b.push(
      row(`DOC-${i}`, 'A', '1'),
      row(`DOC-${i}`, 'B', '2.01'),
      row(`LED-${i}`, 'C', '3'),
      row(`LED-${i}`, 'D', '4'),
    );
  }
  return [a, b];
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode =
    process.argv.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'oversized';
  const size = Number(
    process.argv.find((a) => a.startsWith('--size='))?.slice(7) ?? 20000,
  );
  if (
    !Number.isSafeInteger(size) ||
    size < 4 ||
    size > 20000 ||
    !['oversized', 'mixed'].includes(mode)
  )
    throw Error('Use --mode=oversized|mixed --size=4..20000');
  const started = performance.now();
  const rows =
    mode === 'mixed'
      ? mixedRows(size)
      : [oversizedRows(size), oversizedRows(size)];
  const [a, b] = sourcePair(...rows);
  const normalized = performance.now();
  const rejected =
    mode === 'oversized'
      ? [`${a.transactions.at(-1).id}|${b.transactions.at(-1).id}`]
      : [];
  const result = compare(a, b, scope, [], rejected);
  const completed = performance.now();
  const ids = result.cases.flatMap((c) =>
    c.sourceTrace.map((t) => t.sourceRowId),
  );
  if (ids.length !== 2 * size || new Set(ids).size !== ids.length)
    throw Error('Source-row conservation failed');
  console.log(
    JSON.stringify(
      {
        engine: ENGINE_VERSION,
        runAt: new Date().toISOString(),
        mode,
        sourceRowsPerSide: size,
        scope:
          'Synthetic normalization and comparison only; parsing, UI, session and export excluded; observational timings, not an SLA',
        hardware: {
          cpu: cpus()[0]?.model,
          platform: platform(),
          arch: arch(),
          runtime: process.version,
        },
        normalizePairMs: normalized - started,
        matchingMs: completed - normalized,
        elapsedMs: completed - started,
        maxRssMiB: process.resourceUsage().maxRSS / 1024,
        rssMiB: process.memoryUsage().rss / 1024 ** 2,
        approvedCases: result.caseCounts.autoMatchedCases,
        reviewCases: result.caseCounts.needsReviewCases,
        accountedSourceRows: ids.length,
        ambiguousRows: result.ambiguousIds.length,
        rejectedEdges: rejected.length,
        sourceErrors: a.errors.length + b.errors.length,
      },
      null,
      2,
    ),
  );
}
