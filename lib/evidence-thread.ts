import type { AllocationResult } from './reconciliation/allocation.ts';
import type { BankResult } from './reconciliation/bank.ts';
import {
  ASSET_ROLES,
  type AssetResult,
} from './reconciliation/fixed-assets.ts';
import {
  PAYROLL_ROLES,
  type PayrollResult,
} from './reconciliation/payroll.ts';

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
