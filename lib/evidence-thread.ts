import type { AllocationResult } from './reconciliation/allocation.ts';
import type { ArResult } from './reconciliation/ar.ts';
import type { ArScopeDetailsReading } from './reconciliation/ar-scope-details.ts';
import type { BankResult } from './reconciliation/bank.ts';
import type { ClearingResult } from './reconciliation/clearing.ts';
import type { BalanceField, GlTbResult } from './reconciliation/gl-tb.ts';
import type { FinancialResult } from './reconciliation/tb-financial.ts';
import {
  ASSET_ROLES,
  type AssetResult,
} from './reconciliation/fixed-assets.ts';
import {
  PAYROLL_ROLES,
  type PayrollResult,
} from './reconciliation/payroll.ts';
import {
  STOCK_ROLES,
  type StockRecordRef,
  type StockResult,
} from './reconciliation/inventory-register.ts';

/**
 * The evidence thread (UX-10): for one row of a result, the source records
 * the engine result names for it, each with its place and the cells the
 * reader recorded for it. Nothing is read again, parsed or matched here: a
 * link the result does not name is not drawn, no amount is computed, and the
 * cells are the reader's own texts. A source whose cell texts the result does
 * not keep has `cells: null`. The design record is
 * docs/audits/UX-10-EVIDENCE-THREAD.ar.md.
 */

/** One cell as the reader recorded it: its column (from 1), the header the
 * engine gave it, and the original text. */
export type ThreadCell = { column: number; field: string; text: string };

/** Where a record sits in its source: a row (from 1, the header row being 1
 * where the source has one), or a page and line of a printed statement. */
export type ThreadPlace = { row: number } | { page: number; line: number };

export type ThreadSource = {
  /** The source's index among the result's sources, as the engine numbers
   * them. */
  source: number;
  /** The engine's name for the source's role. */
  role: string;
  name: string;
  sheet: string | null;
  place: ThreadPlace;
  cells: ThreadCell[] | null;
};

/** The thread of one row; empty when the result names no source for it. */
export type Thread = ThreadSource[];

/** A source's file name and sheet, for results that do not carry them; the
 * caller passes those of the files the result was computed from. */
export type ThreadLabel = { name: string; sheet: string | null };

/** A bank movement: the row it was read from and its traced cells. */
export function bankThread(result: BankResult, id: string): Thread {
  const record = result.records.find((r) => r.id === id);
  if (!record) return [];
  const source = result.sources[record.side];
  return [
    {
      source: record.side,
      role: source.role,
      name: source.name,
      sheet: source.sheet,
      place: { row: record.row },
      cells: record.traces.map(({ column, field, text }) => ({
        column,
        field,
        text,
      })),
    },
  ];
}

/** An allocation item: the row it was read from and its traced cells. */
export function allocationThread(result: AllocationResult, id: string): Thread {
  const item = result.items.find((i) => i.id === id);
  if (!item) return [];
  const source = result.sources[item.side];
  return [
    {
      source: item.side,
      role: source.role,
      name: source.name,
      sheet: source.sheet,
      place: { row: item.row },
      cells: item.traces.map(({ column, field, text }) => ({
        column,
        field,
        text,
      })),
    },
  ];
}

type FamilyCells = {
  source: number;
  row: number;
  column: number;
  field: string;
  text: string;
}[];

/** The rows a family result names, each with the cells the result keeps for
 * it, in the order given. */
function familySources(
  cells: FamilyCells,
  roles: readonly string[],
  labels: readonly ThreadLabel[],
  rows: [source: number, row: number][],
): Thread {
  return rows.map(([source, row]) => ({
    source,
    role: roles[source],
    name: labels[source]?.name ?? '',
    sheet: labels[source]?.sheet ?? null,
    place: { row },
    cells: cells
      .filter((c) => c.source === source && c.row === row)
      .map(({ column, field, text }) => ({ column, field, text })),
  }));
}

const GL = 3,
  REGISTER = 0,
  BANK = 4;

/** A fixed-assets comparison: the GL row it compares, then the register rows
 * the engine assigned to it. */
export function assetThread(
  result: AssetResult,
  labels: readonly ThreadLabel[],
  index: number,
): Thread {
  const comparison = result.comparisons[index];
  if (!comparison) return [];
  return familySources(result.cells, ASSET_ROLES, labels, [
    [GL, comparison.glRow],
    ...comparison.registerRows.map((row): [number, number] => [
      REGISTER,
      row,
    ]),
  ]);
}

/** A payroll comparison: the GL row it compares, then the register rows the
 * engine assigned to it. */
export function payrollThread(
  result: PayrollResult,
  labels: readonly ThreadLabel[],
  index: number,
): Thread {
  const comparison = result.comparisons[index];
  if (!comparison) return [];
  return familySources(result.cells, PAYROLL_ROLES, labels, [
    [GL, comparison.glRow],
    ...comparison.registerRows.map((row): [number, number] => [
      REGISTER,
      row,
    ]),
  ]);
}

/** The payroll register net against the bank: the bank payout rows the
 * engine names. The register side is the whole register, which this
 * comparison does not list row by row. */
export function payrollBankThread(
  result: PayrollResult,
  labels: readonly ThreadLabel[],
): Thread {
  return familySources(
    result.cells,
    PAYROLL_ROLES,
    labels,
    result.bankComparison.bankRows.map((row): [number, number] => [BANK, row]),
  );
}

/** An inventory register row the engine read as a link (INV-3): the
 * register row, then the mapping, policy evidence and GL rows the engine
 * names for it, in that order. A record read from a page, or from a column
 * of a matrix, is not one row of cells: its place is shown and its cells
 * are not, for the result does not keep them by row. */
export function stockThread(
  result: StockResult,
  labels: readonly ThreadLabel[],
  index: number,
): Thread {
  const link = result.links[index];
  if (!link) return [];
  const refs: [number, StockRecordRef][] = [
    [0, link],
    ...link.mappings.map((m): [number, StockRecordRef] => [1, m]),
    ...link.evidence.map((e): [number, StockRecordRef] => [2, e]),
    ...link.gl.map((g): [number, StockRecordRef] => [3, g]),
  ];
  return refs.map(([source, ref]) => {
    const plain = ref.page === undefined && ref.column === undefined;
    return {
      source,
      role: STOCK_ROLES[source],
      name: labels[source]?.name ?? '',
      sheet: labels[source]?.sheet ?? null,
      place:
        ref.page === undefined
          ? { row: ref.row }
          : { page: ref.page, line: ref.row },
      cells: plain
        ? result.cells
            .filter((c) => c.source === source && c.row === ref.row)
            .map(({ column, field, text }) => ({ column, field, text }))
        : null,
    };
  });
}

/** A balance component of the GL and TB comparison: each original cell the
 * engine says contributed to it, GL first and then TB, as the engine lists
 * them; each source is the row of that cell, with that cell alone. A side
 * the engine could not total names no cell, and so draws none. */
export function glTbThread(result: GlTbResult, field: BalanceField): Thread {
  const records = new Map(result.rows.map((r) => [r.id, r]));
  return result.components
    .filter((c) => c.field === field)
    .flatMap((c) =>
      c.cells.flatMap((cell) => {
        const record = records.get(cell.id);
        if (!record) return [];
        const source = result.sources[c.side];
        return [
          {
            source: c.side,
            role: source.role,
            name: source.name,
            sheet: source.sheet,
            place: { row: record.row },
            cells: record.trace
              .filter((trace) => trace.column === cell.column)
              .map(({ column, field, text }) => ({ column, field, text })),
          },
        ];
      }),
    );
}

/** A clearing case: each movement row the engine put in it, in the case's
 * order. The result keeps every row of the sheet as the reader recorded it,
 * with no header for each cell; a cell's header is the text of its column in
 * the header row the reading names. The account has one source, which the
 * engine gives no role name: the thread calls it `movements`. */
export function clearingThread(
  result: ClearingResult,
  name: string,
  index: number,
): Thread {
  const found = result.cases[index];
  if (!found) return [];
  const rows = new Map(result.rows.map((r) => [r.id, r.row])),
    lines = new Map(result.inventory.map((i) => [i.row, i.values])),
    header = lines.get(result.reading.header + 1) ?? [];
  return found.ids.flatMap((id) => {
    const row = rows.get(id);
    if (row === undefined) return [];
    return [
      {
        source: 0,
        role: 'movements',
        name,
        sheet: result.sheet,
        place: { row },
        cells:
          lines.get(row)?.map((text, i) => ({
            column: i + 1,
            field: header[i] ?? '',
            text,
          })) ?? null,
      },
    ];
  });
}

// The reading family whose header is a detail-header row inside the sheet.
// Named here and not imported, so that the projection loads no reader.
const AR_SCOPE_DETAILS: ArScopeDetailsReading['family'] = 'ar-scope-details-1';

/** A receivables document pair or review case: each movement the engine put
 * in it, in the case's order, from either record. A movement read from a
 * sheet is its row, with every cell as the reader recorded it under the
 * header row its reading names: the first row, or the detail-header row of a
 * scope block. A line of a printed statement is its page and line, whose
 * cells the result does not keep by column. The scope cells a movement
 * inherits from its block are not drawn here: the case keeps them, with
 * their own row and column, in its source evidence. */
export function arThread(result: ArResult, index: number): Thread {
  const pair = result.cases[index];
  if (!pair) return [];
  const rows = new Map(result.rows.map((r) => [r.id, r])),
    lines = new Map(
      result.inventory.map((i) => [`${i.side}:${i.row}`, i.values]),
    );
  return pair.ids.flatMap((id): Thread => {
    const row = rows.get(id);
    if (!row) return [];
    const source = result.sources[row.side];
    if (row.pdf)
      return [
        {
          source: row.side,
          role: source.role,
          name: source.name,
          sheet: null,
          place: { page: row.pdf.page, line: row.pdf.line },
          cells: null,
        },
      ];
    const reading = result.readings[row.side],
      head =
        'family' in reading && reading.family === AR_SCOPE_DETAILS
          ? reading.header + 1
          : 1,
      header = lines.get(`${row.side}:${head}`) ?? [];
    return [
      {
        source: row.side,
        role: source.role,
        name: source.name,
        sheet: source.sheet,
        place: { row: row.row },
        cells:
          lines.get(`${row.side}:${row.row}`)?.map((text, at) => ({
            column: at + 1,
            field: header[at] ?? '',
            text,
          })) ?? null,
      },
    ];
  });
}

/** A line of the statement of financial position: the line's own row in the
 * statement, then for each member the engine put on it, in the engine's
 * order, the trial-balance account row, the mapping row that put the account
 * on this line and the evidence row that mapping cites. The result keeps
 * every row of the four sources with each cell under its header; a record
 * the result does not list draws nothing. */
export function financialThread(
  result: FinancialResult,
  index: number,
): Thread {
  const line = result.lines[index];
  if (!line) return [];
  const ids = [
      line.id,
      ...line.members.flatMap((m) => [
        m.accountRecord,
        m.mappingRecord,
        m.evidenceRecord,
      ]),
    ],
    records = new Map(result.inventory.map((r) => [r.id, r])),
    wanted = new Set(ids),
    cells = new Map<string, ThreadCell[]>();
  for (const c of result.cells) {
    if (!wanted.has(c.id)) continue;
    const kept = cells.get(c.id) ?? [];
    kept.push({ column: c.column, field: c.field, text: c.text });
    cells.set(c.id, kept);
  }
  return ids.flatMap((id): Thread => {
    const record = records.get(id);
    if (!record) return [];
    const source = result.sources[record.source];
    return [
      {
        source: record.source,
        role: source.role,
        name: source.name,
        sheet: source.sheet,
        place: { row: record.row },
        cells: cells.get(id) ?? [],
      },
    ];
  });
}
