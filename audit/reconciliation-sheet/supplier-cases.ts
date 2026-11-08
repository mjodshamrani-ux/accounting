// The synthetic supplier cases the reconciliation sheet is checked on
// (UX-6(b), docs/audits/UX-6-RECONCILIATION-SHEET.ar.md section 16): the
// page's example, as it builds it in memory and as read from its own CSV
// bytes; the same with the balances' coverage confirmed, with a closing
// balance its movements do not explain, with a manual link, an undone
// automatic match and a recorded review, with an empty scope, in a
// three-decimal currency, and long; and the frozen partial-reading cases of
// audit/partial-reconciliation/frozen that complete a comparison. Each is
// the result the worker returns, the files it was computed from and the
// review the page sends with the export. Synthetic data only.
import { readFile as fsRead } from 'node:fs/promises';
import {
  demoFiles,
  demoMappings,
  demoScope,
} from '../../lib/reconciliation/demo.ts';
import { readFile } from '../../lib/reconciliation/io.ts';
import { reconcileSupplierStatement } from '../../lib/reconciliation/supplier-reconciliation.ts';
import type {
  AuditEvent,
  Comparison,
  Decision,
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';

export type SupplierReview = {
  checked: boolean;
  name: string;
  notes: string;
  events: AuditEvent[];
};
export type SupplierCase = {
  name: string;
  result: Comparison;
  files: [SourceFile, SourceFile];
  review: SupplierReview;
};

const frozen = new URL('../partial-reconciliation/frozen/', import.meta.url);

const csv = (rows: string[][]) =>
  rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(','),
    )
    .join('\n') + '\n';
const bytes = (text: string) => {
  const data = new TextEncoder().encode(text);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const read = async (name: string, rows: string[][]) =>
  readFile(name, bytes(csv(rows)));

function run(
  name: string,
  files: [SourceFile, SourceFile],
  mappings: readonly Mapping[],
  scope: Scope,
  events: AuditEvent[],
  decisions: Decision[] = [],
  rejected: string[] = [],
): SupplierCase {
  const { result } = reconcileSupplierStatement({
    files,
    mappings: structuredClone(mappings) as [Mapping, Mapping],
    scope,
    decisions,
    rejected,
  });
  return {
    name,
    result,
    files,
    review: { checked: false, name: '', notes: '', events },
  };
}

const at = (minute: number) =>
  `2026-09-01T09:${String(minute).padStart(2, '0')}:00.000Z`;
const compared = (minute: number): AuditEvent => ({
  time: at(minute),
  action: 'compare',
  ids: [],
  note: 'Synthetic run of the comparison',
});

export async function supplierCases(): Promise<SupplierCase[]> {
  const confirmed: Scope = { ...demoScope, confirmed: true };
  const fromBytes = async () =>
    (await Promise.all(
      demoFiles.map((f) => read(f.name, f.sheets[0].rows)),
    )) as [SourceFile, SourceFile];
  const cases: SupplierCase[] = [
    run(
      'supplier-example',
      structuredClone(demoFiles),
      demoMappings,
      confirmed,
      [compared(0)],
    ),
    run(
      'supplier-example-bytes',
      await fromBytes(),
      demoMappings,
      { ...confirmed, coverageConfirmed: true },
      [compared(0)],
    ),
  ];
  // A manual link of two equal amounts the engine left apart, an automatic
  // match undone, and a review recorded on an item that stays unmatched,
  // each with the reason the reviewer gave, after the first comparison.
  const decided = await fromBytes();
  const first = run('', decided, demoMappings, confirmed, []).result;
  const byRef = (side: 'supplier' | 'ledger', reference: string) =>
    first[side].transactions.find((t) => t.reference === reference)!.id;
  const link: Decision = {
    supplierId: byRef('supplier', 'INV-001'),
    ledgerId: byRef('ledger', 'INV001'),
    note: 'Synthetic: the same invoice, its number written without the dash',
  };
  const undone = `${byRef('supplier', 'PAY-101')}|${byRef('ledger', 'PAY-101')}`;
  cases.push(
    run(
      'supplier-decided',
      decided,
      demoMappings,
      confirmed,
      [
        compared(0),
        {
          time: at(5),
          action: 'link',
          ids: [link.supplierId, link.ledgerId],
          note: link.note,
        },
        {
          time: at(9),
          action: 'unlink',
          ids: undone.split('|'),
          note: 'Synthetic: the payment advice names another invoice',
        },
        {
          time: at(12),
          action: 'review',
          ids: [byRef('supplier', 'CN-010')],
          note: 'Synthetic: credit note asked from the supplier',
        },
      ],
      [link],
      [undone],
    ),
    // Coverage confirmed, but the statement's closing balance does not
    // follow from its opening and movements: no bridge is computed.
    run(
      'supplier-balance-unproven',
      await fromBytes(),
      demoMappings.map((m, side) => (side ? m : { ...m, closing: '45000' })),
      { ...confirmed, coverageConfirmed: true },
      [compared(0)],
    ),
    run(
      'supplier-blank-scope',
      await fromBytes(),
      demoMappings,
      { ...confirmed, supplier: '', entity: '', account: '' },
      [compared(0)],
    ),
    // Three decimals, read from files with no currency column.
    run(
      'supplier-three-decimals',
      await fromBytes(),
      demoMappings.map((m) => ({ ...m, currencyColumn: -1 })),
      { ...confirmed, currency: 'KWD', decimals: 3 },
      [compared(0)],
    ),
  );
  // Long: forty invoices on each side under references the other does not
  // hold, and one payment both hold.
  const header = demoFiles[0].sheets[0].rows[0];
  const long = (side: 'S' | 'L') => [
    header,
    ...Array.from({ length: 40 }, (_, i) => [
      `2026-08-${String(1 + (i % 28)).padStart(2, '0')}`,
      `${side}-INV-${String(i + 1).padStart(3, '0')}`,
      `Synthetic invoice ${i + 1}`,
      String(100 + i * 10),
      'SAR',
    ]),
    ['2026-08-30', 'PAY-900', 'Synthetic payment', '-500', 'SAR'],
  ];
  cases.push(
    run(
      'supplier-long',
      [
        await read('supplier-long.csv', long('S')),
        await read('ledger-long.csv', long('L')),
      ],
      demoMappings.map((m) => ({ ...m, opening: '', closing: '' })),
      confirmed,
      [compared(0)],
    ),
  );
  // The frozen partial-reading cases that complete a comparison as they are
  // read: every one whose kind is partial and that asks no date question.
  const contracts = JSON.parse(
    await fsRead(new URL('contracts.json', frozen), 'utf8'),
  ) as {
    scope: Scope;
    cases: {
      id: string;
      kind: string;
      dateChoice?: unknown;
      scope?: Scope;
      supplier: { file: string; mapping: Mapping; cuts?: unknown };
      ledger: { file: string; mapping: Mapping; cuts?: unknown };
    }[];
  };
  for (const c of contracts.cases) {
    if (c.kind !== 'partial' || c.dateChoice) continue;
    const files = (await Promise.all(
      [c.supplier, c.ledger].map(async (d) => {
        const data = new Uint8Array(await fsRead(new URL(d.file, frozen)));
        return readFile(
          d.file.split('/').at(-1)!,
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          d.cuts as never,
        );
      }),
    )) as [SourceFile, SourceFile];
    cases.push(
      run(
        `supplier-partial-${c.id}`,
        files,
        [c.supplier.mapping, c.ledger.mapping],
        structuredClone(c.scope ?? contracts.scope),
        [compared(0)],
      ),
    );
  }
  return cases;
}
