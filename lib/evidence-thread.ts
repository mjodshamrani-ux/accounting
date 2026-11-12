import type { AllocationResult } from './reconciliation/allocation.ts';
import type { ArResult } from './reconciliation/ar.ts';
import type { ArScopeDetailsReading } from './reconciliation/ar-scope-details.ts';
import type { BankResult } from './reconciliation/bank.ts';
import type { ClearingResult } from './reconciliation/clearing.ts';
import type { BalanceField, GlTbResult } from './reconciliation/gl-tb.ts';
import type { GlsResult } from './reconciliation/gl-tb-sections.ts';
import type { ImbResult } from './reconciliation/inventory-movement-bridge.ts';
import type {
  PlrReading,
  PlrResult,
} from './reconciliation/payroll-long-register.ts';
import type { FinancialResult } from './reconciliation/tb-financial.ts';
import type { IntercompanyResult } from './reconciliation/intercompany.ts';
import type { GatewayResult } from './reconciliation/payment-gateway.ts';
import type { Comparison, SourceFile } from './reconciliation/types.ts';
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

/** An account of the GL sections and TB pages comparison (GLT-1c): the row
 * that opens each GL section the engine read for it, then each TB row it
 * read for it, in the engine's order. The result keeps those rows, not their
 * cells: the cells drawn are the texts the reader read at that row of the
 * file the panel holds, and only when that file is the one the result was
 * computed from (the same fingerprint). Otherwise the row is drawn by its
 * place alone. The engine names no header for these cells, since a section
 * row opens its section and a TB page names its columns in a row the result
 * does not keep; each cell keeps its column. */
export function glTbSectionsThread(
  result: GlsResult,
  files: readonly (SourceFile | null)[],
  index: number,
): Thread {
  const account = result.accounts[index];
  if (!account) return [];
  const line = (source: number, row: number): ThreadSource => {
    const read = result.sources[source],
      file = files[source],
      sheet = file?.sha256 === read.hash ? file.sheets[0] : undefined,
      cells = sheet?.rows[row - 1];
    return {
      source,
      role: read.role,
      name: read.name,
      sheet: sheet?.name ?? null,
      place: { row },
      cells: cells
        ? cells.map((text, n) => ({ column: n + 1, field: '', text }))
        : null,
    };
  };
  return [
    ...account.sections.map((s) => line(0, s.row)),
    ...account.rows.map((r) => line(1, r.row)),
  ];
}

// The role of the long payroll register, named here and not imported, so
// that the projection loads no reader.
const LONG_REGISTER: PlrReading['role'] = 'long-register';

/** An employee of the long payroll register (PAY-1c): each row the engine
 * read one of the employee's lines from, in the engine's order. The engine
 * reads the register's bytes with its own reader and keeps those rows, not
 * their cells, and the panel holds only the bytes. Each row is drawn by its
 * place alone, and nothing here reads the bytes again. */
export function payrollRegisterThread(
  result: PlrResult,
  index: number,
): Thread {
  const employee = result.employees[index];
  if (!employee) return [];
  return employee.rows.map((row) => ({
    source: 0,
    role: LONG_REGISTER,
    name: result.file.name,
    sheet: null,
    place: { row },
    cells: null,
  }));
}

/** The rows the engine names in one file of the inventory movement bridge
 * (INV-2c), by their place. The engine reads both files' bytes with its own
 * reader and keeps rows, not cells, and the panel holds only the bytes. Each
 * row is drawn by its place alone, and nothing here reads the bytes again.
 * The file's name and role are those the result keeps for it. */
function movementBridgeRows(
  result: ImbResult,
  source: 0 | 1,
  rows: readonly number[] | undefined,
): Thread {
  const file = result.files[source];
  if (!rows || !file) return [];
  return rows.map((at) => ({
    source,
    role: file.role,
    name: file.name,
    sheet: null,
    place: { row: at },
    cells: null,
  }));
}

/** A position of the movement bridge, one item and its dimensions: each
 * register row the engine placed under it, in the order of the file. */
export function movementPositionThread(
  result: ImbResult,
  index: number,
): Thread {
  return movementBridgeRows(result, 0, result.positions[index]?.rows);
}

/** A GL account of the movement bridge: each row of the GL summary the
 * engine read for it, in the order of the file. The register side of the
 * account is summed from positions, which the result does not list under the
 * account, so their rows are not drawn here; each position opens its own. An
 * account the GL summary does not carry opens nothing. */
export function movementAccountThread(
  result: ImbResult,
  index: number,
): Thread {
  return movementBridgeRows(result, 1, result.accounts[index]?.rows);
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

/** A result that keeps every row of its sources by record: each record's
 * source and row, and its cells under the headers the engine gave them. */
type Recorded = {
  sources: readonly { name: string; sheet: string; role: string }[];
  inventory: readonly { id: string; source: number; row: number }[];
  cells: readonly {
    id: string;
    column: number;
    field: string;
    text: string;
  }[];
};

/** The records named, in the order given, each its row with every cell the
 * result keeps for it. A record the result does not list draws nothing. */
function recordedSources(result: Recorded, ids: readonly string[]): Thread {
  const records = new Map(result.inventory.map((r) => [r.id, r])),
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

/** A line of the statement of financial position: the line's own row in the
 * statement, then for each member the engine put on it, in the engine's
 * order, the trial-balance account row, the mapping row that put the account
 * on this line and the evidence row that mapping cites. */
export function financialThread(
  result: FinancialResult,
  index: number,
): Thread {
  const line = result.lines[index];
  if (!line) return [];
  return recordedSources(result, [
    line.id,
    ...line.members.flatMap((m) => [
      m.accountRecord,
      m.mappingRecord,
      m.evidenceRecord,
    ]),
  ]);
}

/** An intercompany pair: the relationship row that names it, then every
 * ledger row the engine read for the transactions the relationship names,
 * from either entity, in the engine's order (a transaction written twice is
 * two rows), then the timing evidence the engine attached to the pair. */
export function intercompanyThread(
  result: IntercompanyResult,
  index: number,
): Thread {
  const pair = result.pairs[index];
  if (!pair) return [];
  return recordedSources(result, [
    pair.relationRecord,
    ...pair.members.map((m) => m.id),
    ...pair.timing.map((t) => t.id),
  ]);
}

/** The two tables of a payment gateway batch: the calculated totals, summed
 * from the transactions and the fee evidence, and the residuals, which set
 * those totals against the settlement summary and its net against the
 * payout. */
export type GatewayTable = 'totals' | 'residuals';
type GatewayRole = GatewayResult['sources'][number]['role'];
const GATEWAY_TOTALS: readonly GatewayRole[] = ['transactions', 'fee-evidence'];

/** A payment gateway batch, from one of its tables: each row the engine made
 * a member of the batch, in the engine's order, from the sources that table
 * draws on (the transactions and the fee evidence for the totals, and with
 * them the settlement summary and the payout for the residuals), with every
 * cell the result keeps for it under its header. A member is named by the
 * engine's own id, which holds its source and row. */
export function gatewayThread(
  result: GatewayResult,
  table: GatewayTable,
): Thread {
  const byRow = new Map<string, ThreadCell[]>();
  for (const { source, row, column, field, text } of result.cells) {
    const key = `${source}:${row}`,
      found = byRow.get(key) ?? [];
    found.push({ column, field, text });
    byRow.set(key, found);
  }
  return result.memberIds.flatMap((id): Thread => {
    const [, source, , , row] = JSON.parse(id) as [
      string,
      number,
      string,
      number,
      number,
    ];
    const named = result.sources[source];
    if (!named || (table === 'totals' && !GATEWAY_TOTALS.includes(named.role)))
      return [];
    return [
      {
        source,
        role: named.role,
        name: named.name,
        sheet: named.sheet,
        place: { row },
        cells: byRow.get(`${source}:${row}`) ?? [],
      },
    ];
  });
}

/** Where the supplier engine says a side's rows came from: the file's
 * SHA-256, or for a file read without one a fingerprint of the sheet's
 * cells, then the sheet. The engine's own recipe (core.ts), written here so
 * that the projection loads no engine; if the two ever part, no cells are
 * drawn, and the tests and the browser check see it. */
function supplierOrigin(file: SourceFile, sheet: number) {
  if (file.sha256) return `${file.sha256}#${sheet}`;
  const text = JSON.stringify(file.sheets[sheet]?.rows ?? []);
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `content:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}:${text.length}#${sheet}`;
}

/** A row of the supplier results: every source row the engine traced for
 * its case, in the case's order, from the supplier statement (0) or the AP
 * ledger (1). The result keeps each row's side, sheet and row, not its
 * cells: the cells drawn are the texts the reader read at that row of the
 * file the result was computed from, under the header row the reading
 * names, and only when that file is the one the result recorded for its
 * side (the same name and origin). Otherwise the row is drawn by its place
 * alone. A row is named by its transaction id. */
export function supplierThread(
  result: Comparison,
  files: readonly (SourceFile | null)[],
  id: string,
): Thread {
  const found = result.cases.find((c) =>
    c.sourceTrace.some((t) => t.sourceRowId === id),
  );
  if (!found) return [];
  const sides = [result.supplier, result.ledger];
  return found.sourceTrace.map((trace): ThreadSource => {
    const source = trace.side === 'supplier' ? 0 : 1,
      read = sides[source],
      file = files[source],
      rows =
        file &&
        file.name === read.sourceName &&
        supplierOrigin(file, read.mapping.sheet) === read.sourceOrigin
          ? file.sheets[read.mapping.sheet]?.rows
          : undefined,
      line = rows?.[trace.row - 1],
      header = rows?.[read.mapping.header] ?? [];
    return {
      source,
      role: trace.side,
      name: read.sourceName,
      sheet: trace.sheet,
      place: { row: trace.row },
      cells: line
        ? line.map((said, n) => ({
            column: n + 1,
            field: header[n] ?? '',
            text: said,
          }))
        : null,
    };
  });
}
