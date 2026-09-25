// Inputs with more than one fault, to pin down which refusal each path gives
// first. Both sources are split debit/credit statements in KWD whose sign is
// proven by a running balance, and whose three-place amounts (100.000, 25.500)
// read as fils or as thousands. So each source can carry an unanswered
// amount format, a direction claim the source does not prove, both, or
// neither.
import { readFile } from '../../lib/reconciliation/io.ts';
import { suggestFormats } from '../../lib/reconciliation/format-inference.ts';
import { formatChoice } from '../../lib/reconciliation/input-readiness.ts';
import { inferStatementDirection } from '../../lib/reconciliation/statement-direction.ts';
import { defaultMapping } from '../../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';

export const gateScope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Entity',
  account: 'GATE-1',
  currency: 'KWD',
  decimals: 3,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const rows = (reverse: boolean) => [
  [
    'Date',
    'Type',
    'Reference',
    'Debit',
    'Credit',
    reverse ? 'Running AP Balance' : 'Running Balance',
  ],
  [
    '2026-07-01',
    'Opening Balance',
    'B/F',
    reverse ? '0' : '100.000',
    reverse ? '100.000' : '0',
    '100.000',
  ],
  [
    '2026-07-02',
    'Invoice',
    'INV-100',
    reverse ? '0' : '25.500',
    reverse ? '25.500' : '0',
    '125.500',
  ],
  [
    '2026-07-03',
    'Payment',
    'PAY-100',
    reverse ? '10.250' : '0',
    reverse ? '0' : '10.250',
    '115.250',
  ],
];
const split: Mapping = {
  ...defaultMapping(),
  date: 0,
  reference: 2,
  debit: 3,
  credit: 4,
  mode: 'split',
};
const csv = (table: string[][]) =>
  new TextEncoder().encode(table.map((r) => r.join(',')).join('\n'))
    .buffer as ArrayBuffer;

export type SourceFault = 'ok' | 'format' | 'direction' | 'format+direction';
export const SOURCE_FAULTS: SourceFault[] = [
  'ok',
  'format',
  'direction',
  'format+direction',
];

/** The two sources, and a reading of each side with the requested fault. */
export async function gateOrderSources() {
  const files: [SourceFile, SourceFile] = [
    await readFile('gate-supplier.csv', csv(rows(false))),
    await readFile('gate-ledger.csv', csv(rows(true))),
  ];
  const proven = files.map((file) => {
    const proof = inferStatementDirection(file, split, gateScope.decimals)!;
    const mapping = { ...split, multiplier: proof.multiplier };
    const { status, candidates } = suggestFormats(
      file,
      mapping,
      gateScope.decimals,
    ).numberFormat;
    if (status !== 'ambiguous') throw new Error('fixture must be ambiguous');
    return {
      ...mapping,
      directionEvidence: proof,
      formatChoice: {
        numberFormat: formatChoice(
          file,
          mapping,
          'numberFormat',
          'dot',
          candidates,
          gateScope.decimals,
        ),
      },
    } as Mapping;
  }) as [Mapping, Mapping];
  const reading = (side: 0 | 1, fault: SourceFault): Mapping => {
    const mapping = structuredClone(proven[side]);
    if (fault.includes('format')) delete mapping.formatChoice;
    if (fault.includes('direction'))
      mapping.directionEvidence = {
        ...mapping.directionEvidence!,
        checkedRows: mapping.directionEvidence!.checkedRows + 1,
      };
    return mapping;
  };
  return { files, proven, reading };
}
