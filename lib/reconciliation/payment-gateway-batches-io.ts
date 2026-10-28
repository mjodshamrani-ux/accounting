import { readFile } from './io.ts';
import {
  PG_BATCHES_ROLES,
  PG_BATCHES_ROW_LIMIT,
  gatewayBatchesColumns,
  gatewayBatchesPlaces,
  refuseGatewayBatches,
  reviewGatewayBatches,
  type GatewayBatchesInput,
} from './payment-gateway-batches.ts';
import { MAX_FILE_BYTES, type SourceFile } from './types.ts';

/** The reader's own XLSX ceilings, by their exact messages: a row address
 * past MAX_ROWS lines and the header (a row address that is not a number
 * gives the same message), and more rows, columns or cells in one sheet than
 * it reads. */
const sheetCeilings = [
  'إحداثيات صف Excel غير صالحة أو تتجاوز حد الصفوف',
  'الورقة تتجاوز حدود الصفوف أو الأعمدة',
];

export type GatewayBatchesSnapshot = {
  name: string;
  sha256: string;
  original: ArrayBuffer;
};
export type GatewayBatchesReplayInput = Omit<GatewayBatchesInput, 'files'> & {
  files: GatewayBatchesSnapshot[];
};

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const hex = async (bytes: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');

/** Comma CSV as the contract reads it: UTF-8, where the decoder drops one
 * leading byte order mark and keeps any other, a blank physical line is a row
 * with no cells, and a quoted field may hold commas, quotes and line breaks. A stray or unclosed quote is SOURCE, not
 * repaired, and the reader's ceiling is ROWS. No delimiter is inferred. */
export function gatewayBatchesCSV(original: ArrayBuffer): string[][] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(original);
  } catch {
    return refuseGatewayBatches('SOURCE');
  }
  if (text.includes('\u0000')) refuseGatewayBatches('SOURCE');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false,
    touched = false;
  const finish = () => {
    rows.push(touched ? [...row, cell] : []);
    if (rows.length > PG_BATCHES_ROW_LIMIT) refuseGatewayBatches('ROWS');
    row = [];
    cell = '';
    closed = false;
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
      continue;
    }
    if (c === '"') {
      if (cell || closed) refuseGatewayBatches('SOURCE');
      quoted = true;
      touched = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
      closed = false;
      touched = true;
    } else if (c === '\r' || c === '\n') {
      finish();
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      if (closed) refuseGatewayBatches('SOURCE');
      cell += c;
      touched = true;
    }
  }
  if (quoted) refuseGatewayBatches('SOURCE');
  if (touched) finish();
  return rows;
}

/** One file from its own bytes: CSV by the contract's grammar, XLSX by the
 * product reader, which marks hidden rows, formulas and cell issues. */
export async function readGatewayBatchesFile(
  name: string,
  original: ArrayBuffer,
): Promise<SourceFile> {
  if (!/\.(csv|xlsx)$/i.test(name) || original.byteLength > MAX_FILE_BYTES)
    refuseGatewayBatches('SOURCE');
  const snapshot = original.slice(0);
  if (/\.csv$/i.test(name))
    return {
      name,
      original: snapshot.slice(0),
      sha256: await hex(snapshot),
      sheets: [
        {
          name: 'CSV',
          rows: gatewayBatchesCSV(snapshot),
          formulaRows: [],
          hiddenRows: [],
        },
      ],
    };
  try {
    return await readFile(name, snapshot, undefined, false, undefined, 32767);
  } catch (error) {
    return refuseGatewayBatches(
      sheetCeilings.includes(String((error as Error).message))
        ? 'ROWS'
        : 'SOURCE',
    );
  }
}

/** Trust native bytes, never caller-supplied parsed sheets. The refusals
 * keep the contract's order: READING and SCOPE, then each file in role
 * order, read (SOURCE, ROWS) and then its headers (COLUMNS). */
export async function replayGatewayBatches(input: GatewayBatchesReplayInput) {
  if (
    !plain(input) ||
    !Array.isArray(input.files) ||
    input.files.length !== PG_BATCHES_ROLES.length
  )
    refuseGatewayBatches('SOURCE');
  const snapshots = input.files.map((f) => {
    if (
      !plain(f) ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      typeof f.sha256 !== 'string' ||
      !(f.original instanceof ArrayBuffer)
    )
      refuseGatewayBatches('SOURCE');
    return { name: f.name, sha256: f.sha256, original: f.original.slice(0) };
  });
  let metadata: Pick<GatewayBatchesInput, 'readings' | 'scope'>;
  try {
    metadata = structuredClone({
      readings: input.readings,
      scope: input.scope,
    });
  } catch {
    return refuseGatewayBatches('READING');
  }
  gatewayBatchesPlaces(metadata.readings, metadata.scope);
  const files: SourceFile[] = [];
  for (const [side, s] of snapshots.entries()) {
    const file = await readGatewayBatchesFile(s.name, s.original);
    if (file.sha256 !== s.sha256) refuseGatewayBatches('SOURCE_HASH');
    if (file.sheets[0].rows.length > PG_BATCHES_ROW_LIMIT)
      refuseGatewayBatches('ROWS');
    gatewayBatchesColumns(file.sheets[0], side);
    files.push(file);
  }
  const state: GatewayBatchesInput = { files, ...metadata };
  return { state, result: reviewGatewayBatches(state) };
}
