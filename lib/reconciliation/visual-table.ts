/** An inventory of one manually delimited image table. Coverage is a recorded
 * human attestation, not OCR completeness or financial approval. */
import {
  assertVisualReview,
  restoreVisualReview,
  visualRegions,
  isVisualLiteral,
  type VisualReview,
  type VisualCell,
} from './visual-review.ts';
import {
  digest,
  VisualEvidenceError,
  VISUAL_EVIDENCE_LIMITS,
} from './visual-png.ts';

export type TableRole =
  | 'reference'
  | 'date'
  | 'amount'
  | 'balance'
  | 'currency';
export type TableGrid = Readonly<{
  region: VisualCell['region'];
  rowCuts: readonly number[];
  columnCuts: readonly number[];
  roles: readonly TableRole[];
}>;
type Receipt = Readonly<{ fingerprint: string; checkedAt: string }>;
export type TableRow = Readonly<{
  id: string;
  disposition: 'unclassified' | 'movement' | 'non-movement' | 'unreadable';
  note: string;
  cells: readonly (string | null)[];
  review: Receipt | null;
}>;
export type VisualTable = Readonly<{
  kind: 'visual-table';
  version: 1;
  status: 'table-evidence-only';
  image: VisualReview;
  revision: string;
  grid: TableGrid;
  rows: readonly TableRow[];
  coverage: Receipt | null;
}>;
export const VISUAL_TABLE_LIMITS = Object.freeze({ rows: 200, columns: 8 });
const roles = ['reference', 'date', 'amount', 'balance', 'currency'];
const dispositions = ['unclassified', 'movement', 'non-movement', 'unreadable'];
const accepted = new WeakSet<object>();
const reject = (): never => {
  throw new VisualEvidenceError('record');
};
const hash = (value: unknown) =>
  digest(new TextEncoder().encode(JSON.stringify(value)));
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).length === keys.length &&
  keys.every((k) => {
    const d = Object.getOwnPropertyDescriptor(v, k);
    return d?.enumerable && 'value' in d;
  });
const dense = (v: unknown, limit: number): v is unknown[] =>
  Array.isArray(v) &&
  Object.getPrototypeOf(v) === Array.prototype &&
  v.length <= limit &&
  Reflect.ownKeys(v).length === v.length + 1 &&
  Array.from({ length: v.length }, (_, i) =>
    Object.getOwnPropertyDescriptor(v, String(i)),
  ).every((d) => d?.enumerable && 'value' in d);
const time = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
function assertTable(v: VisualTable) {
  if (!accepted.has(v)) reject();
}
function freeze(value: VisualTable): VisualTable {
  Object.freeze(value.grid.region);
  Object.freeze(value.grid.rowCuts);
  Object.freeze(value.grid.columnCuts);
  Object.freeze(value.grid.roles);
  Object.freeze(value.grid);
  value.rows.forEach((r) => {
    Object.freeze(r.cells);
    if (r.review) Object.freeze(r.review);
    Object.freeze(r);
  });
  Object.freeze(value.rows);
  if (value.coverage) Object.freeze(value.coverage);
  Object.freeze(value);
  accepted.add(value);
  return value;
}
function gridCopy(image: VisualReview, input: TableGrid): TableGrid {
  if (
    !shape(input, ['region', 'rowCuts', 'columnCuts', 'roles']) ||
    !shape(input.region, ['x0', 'y0', 'x1', 'y1']) ||
    !dense(input.rowCuts, VISUAL_TABLE_LIMITS.rows + 1) ||
    !dense(input.columnCuts, VISUAL_TABLE_LIMITS.columns + 1) ||
    !dense(input.roles, VISUAL_TABLE_LIMITS.columns)
  )
    return reject();
  const box = { ...input.region },
    page = image.draft.pages[0];
  if (
    !Object.values(box).every(Number.isSafeInteger) ||
    box.x0 < 0 ||
    box.y0 < 0 ||
    box.x1 > page.width ||
    box.y1 > page.height ||
    box.x0 >= box.x1 ||
    box.y0 >= box.y1
  )
    return reject();
  const cuts = (values: readonly number[], start: number, end: number) =>
    values.length >= 2 &&
    values[0] === start &&
    values.at(-1) === end &&
    values.every(
      (v, i) => Number.isSafeInteger(v) && (!i || v > values[i - 1]),
    );
  if (
    !cuts(input.rowCuts, box.y0, box.y1) ||
    !cuts(input.columnCuts, box.x0, box.x1) ||
    input.roles.length !== input.columnCuts.length - 1 ||
    input.roles.some((r) => !roles.includes(r)) ||
    new Set(input.roles).size !== input.roles.length ||
    !input.roles.includes('amount')
  )
    return reject();
  return {
    region: box,
    rowCuts: [...input.rowCuts],
    columnCuts: [...input.columnCuts],
    roles: [...input.roles],
  };
}
export async function createVisualTable(
  image: VisualReview,
  input: TableGrid,
): Promise<VisualTable> {
  assertVisualReview(image);
  const grid = gridCopy(image, input);
  const revision = await hash(['tarasuf-visual-table-v1', image, grid]);
  return freeze({
    kind: 'visual-table',
    version: 1,
    status: 'table-evidence-only',
    image,
    revision,
    grid,
    rows: grid.rowCuts.slice(1).map((_, i) => ({
      id: `row:${i + 1}`,
      disposition: 'unclassified',
      note: '',
      cells: grid.roles.map(() => null),
      review: null,
    })),
    coverage: null,
  });
}
export function tableRowBox(
  value: VisualTable,
  index: number,
): VisualCell['region'] {
  assertTable(value);
  if (!Number.isInteger(index) || index < 0 || index >= value.rows.length)
    return reject();
  return {
    x0: value.grid.region.x0,
    x1: value.grid.region.x1,
    y0: value.grid.rowCuts[index],
    y1: value.grid.rowCuts[index + 1],
  };
}
/** Only explicitly reviewed manual crops wholly inside their own cell. Word
 * context crops can span neighboring values and cannot be table assignments. */
export function tableCellCandidates(
  value: VisualTable,
  row: number,
  column: number,
) {
  const box = tableRowBox(value, row);
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    column >= value.grid.roles.length
  )
    return reject();
  const role =
    value.grid.roles[column] === 'balance'
      ? 'amount'
      : value.grid.roles[column];
  return visualRegions(value.image).filter(
    (c) =>
      c.review &&
      c.role === role &&
      c.region.x0 >= value.grid.columnCuts[column] &&
      c.region.x1 <= value.grid.columnCuts[column + 1] &&
      c.region.y0 >= box.y0 &&
      c.region.y1 <= box.y1,
  );
}
export function editVisualTableRow(
  value: VisualTable,
  index: number,
  input: Omit<TableRow, 'id' | 'review'>,
): VisualTable {
  assertTable(value);
  tableRowBox(value, index);
  if (
    !shape(input, ['disposition', 'note', 'cells']) ||
    !dispositions.includes(input.disposition) ||
    typeof input.note !== 'string' ||
    input.note.length > 512 ||
    (input.note !== '' && !isVisualLiteral(input.note)) ||
    !dense(input.cells, VISUAL_TABLE_LIMITS.columns) ||
    input.cells.length !== value.grid.roles.length ||
    input.cells.some((c) => c !== null && typeof c !== 'string')
  )
    return reject();
  if (
    (input.disposition === 'unreadable' ||
      input.disposition === 'non-movement') &&
    !input.note.trim()
  )
    return reject();
  // Excluded rows may retain reviewed labels and values as evidence. The
  // accounting boundary, not this review receipt, decides whether a printed
  // structural label proves that the row is not a competing movement.
  if (
    input.disposition !== 'movement' &&
    input.disposition !== 'non-movement' &&
    input.cells.some((c) => c !== null)
  )
    return reject();
  const used = new Set(
    value.rows
      .filter((_, i) => i !== index)
      .flatMap((r) => r.cells.filter((c) => c !== null)),
  );
  input.cells.forEach((id, col) => {
    if (
      id !== null &&
      (used.has(id) ||
        !tableCellCandidates(value, index, col).some((c) => c.id === id))
    )
      reject();
    if (id !== null) used.add(id);
  });
  const row: TableRow = {
    id: value.rows[index].id,
    disposition: input.disposition,
    note: input.note,
    cells: [...input.cells],
    review: null,
  };
  return freeze({
    ...value,
    rows: value.rows.map((r, i) => (i === index ? row : r)),
    coverage: null,
  });
}
const rowHash = (value: VisualTable, row: TableRow) =>
  hash([
    'tarasuf-table-exclusion-v1',
    value.revision,
    row.id,
    row.disposition,
    row.note,
    row.cells,
  ]);
const coverageHash = (value: VisualTable) =>
  hash(['tarasuf-table-coverage-v1', value.revision, value.rows]);
export async function confirmVisualTableExclusion(
  value: VisualTable,
  index: number,
  checkedAt: string,
): Promise<VisualTable> {
  tableRowBox(value, index);
  const row = value.rows[index];
  if (
    row.disposition !== 'non-movement' ||
    !row.note.trim() ||
    !time(checkedAt)
  )
    return reject();
  const review = { fingerprint: await rowHash(value, row), checkedAt };
  return freeze({
    ...value,
    rows: value.rows.map((r, i) => (i === index ? { ...r, review } : r)),
    coverage: null,
  });
}
export function visualTableCounts(value: VisualTable) {
  assertTable(value);
  const count = {
    movements: 0,
    excluded: 0,
    unreadable: 0,
    unclassified: 0,
    missingCells: 0,
    uncheckedExclusions: 0,
    unassignedCrops: 0,
  };
  value.rows.forEach((r) => {
    if (r.disposition === 'movement') {
      count.movements++;
      count.missingCells += r.cells.filter((c) => c === null).length;
    } else if (r.disposition === 'non-movement') {
      count.excluded++;
      if (!r.review) count.uncheckedExclusions++;
    } else if (r.disposition === 'unreadable') count.unreadable++;
    else count.unclassified++;
  });
  const used = new Set(value.rows.flatMap((r) => r.cells));
  for (const crop of visualRegions(value.image)) {
    if (!crop.review || used.has(crop.id)) continue;
    const box = crop.region,
      area = value.grid.region;
    if (
      box.x0 < area.x1 &&
      box.x1 > area.x0 &&
      box.y0 < area.y1 &&
      box.y1 > area.y0
    ) {
      const excluded = value.rows.some(
        (row, i) =>
          row.disposition === 'non-movement' &&
          row.review &&
          box.x0 >= area.x0 &&
          box.x1 <= area.x1 &&
          box.y0 >= value.grid.rowCuts[i] &&
          box.y1 <= value.grid.rowCuts[i + 1],
      );
      if (!excluded) count.unassignedCrops++;
    }
  }
  return count;
}
/** This attests the selected table range and row inventory only. Unreadable
 * rows remain unresolved and are never converted into zero or excluded. */
export async function confirmVisualTableCoverage(
  value: VisualTable,
  checkedAt: string,
): Promise<VisualTable> {
  const counts = visualTableCounts(value);
  if (
    counts.unclassified ||
    counts.uncheckedExclusions ||
    counts.unassignedCrops ||
    !time(checkedAt)
  )
    return reject();
  return freeze({
    ...value,
    coverage: { fingerprint: await coverageHash(value), checkedAt },
  });
}
export async function restoreVisualTable(
  bytes: Uint8Array,
): Promise<VisualTable> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > VISUAL_EVIDENCE_LIMITS.recordBytes
  )
    throw new VisualEvidenceError('limit');
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return reject();
  }
  if (
    !shape(p, [
      'kind',
      'version',
      'status',
      'image',
      'revision',
      'grid',
      'rows',
      'coverage',
    ]) ||
    p.kind !== 'visual-table' ||
    p.version !== 1 ||
    p.status !== 'table-evidence-only' ||
    !dense(p.rows, VISUAL_TABLE_LIMITS.rows)
  )
    return reject();
  const image = await restoreVisualReview(
    new TextEncoder().encode(JSON.stringify(p.image)),
  );
  let current = await createVisualTable(image, p.grid as TableGrid);
  if (p.revision !== current.revision || p.rows.length !== current.rows.length)
    return reject();
  for (const [i, raw] of p.rows.entries()) {
    if (
      !shape(raw, ['id', 'disposition', 'note', 'cells', 'review']) ||
      raw.id !== current.rows[i].id
    )
      return reject();
    current = editVisualTableRow(current, i, {
      disposition: raw.disposition,
      note: raw.note,
      cells: raw.cells,
    } as Omit<TableRow, 'id' | 'review'>);
    if (raw.review !== null) {
      if (
        !shape(raw.review, ['fingerprint', 'checkedAt']) ||
        !time(raw.review.checkedAt) ||
        raw.review.fingerprint !== (await rowHash(current, current.rows[i]))
      )
        return reject();
      current = await confirmVisualTableExclusion(
        current,
        i,
        raw.review.checkedAt,
      );
    }
  }
  if (p.coverage !== null) {
    if (
      !shape(p.coverage, ['fingerprint', 'checkedAt']) ||
      !time(p.coverage.checkedAt) ||
      p.coverage.fingerprint !== (await coverageHash(current))
    )
      return reject();
    current = await confirmVisualTableCoverage(current, p.coverage.checkedAt);
  }
  return current;
}
export async function saveVisualTable(value: VisualTable): Promise<Uint8Array> {
  assertTable(value);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  await restoreVisualTable(bytes);
  return bytes;
}
