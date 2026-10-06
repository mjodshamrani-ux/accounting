import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  CLEARING_VERSION,
  reconcileClearing,
  type ClearingInput,
  type ClearingResult,
} from './clearing.ts';

function buffer(value: unknown): asserts value is ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    !value.byteLength ||
    value.byteLength > MAX_FILE_BYTES
  )
    throw new Error('CLEARING_SOURCE');
}
/** Trust native bytes, never caller-supplied parsed sheets or cached results. */
export async function replayClearing(input: ClearingInput) {
  if (
    !input ||
    !input.file ||
    typeof input.file.name !== 'string' ||
    input.file.name.length > 255 ||
    input.file.kind !== undefined ||
    !/\.(csv|xlsx)$/i.test(input.file.name)
  )
    throw new Error('CLEARING_SOURCE');
  buffer(input.file.original);
  const file = await readFile(input.file.name, input.file.original);
  if (file.sha256 !== input.file.sha256)
    throw new Error('CLEARING_SOURCE_HASH');
  const state = {
    file,
    reading: input.reading,
    scope: input.scope,
    events: input.events,
  };
  return { state, result: reconcileClearing(state) };
}
const encode = (bytes: ArrayBuffer) => {
  let value = '';
  for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte);
  return btoa(value);
};
const decode = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error('CLEARING_SESSION');
  const bytes = Uint8Array.from(atob(value), (char) =>
    char.charCodeAt(0),
  ).buffer;
  buffer(bytes);
  if (encode(bytes) !== value) throw new Error('CLEARING_SESSION');
  return bytes;
};
export async function saveClearing(input: ClearingInput): Promise<ArrayBuffer> {
  const { state } = await replayClearing(input);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-clearing-session',
      version: CLEARING_VERSION,
      file: {
        name: state.file.name,
        sha256: state.file.sha256,
        data: encode(state.file.original!),
      },
      reading: state.reading,
      scope: state.scope,
      events: state.events,
    }),
  ).buffer;
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('CLEARING_SESSION');
  await restoreClearing(bytes);
  return bytes;
}
export async function restoreClearing(bytes: ArrayBuffer) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 16 * 1024 * 1024)
    throw new Error('CLEARING_SESSION');
  const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    Object.keys(p).sort().join('|') !==
      ['format', 'version', 'file', 'reading', 'scope', 'events']
        .sort()
        .join('|') ||
    p.format !== 'tarasuf-clearing-session' ||
    p.version !== CLEARING_VERSION ||
    !p.file ||
    Object.keys(p.file).sort().join('|') !== 'data|name|sha256' ||
    typeof p.file.name !== 'string' ||
    p.file.name.length > 255 ||
    !/\.(csv|xlsx)$/i.test(p.file.name)
  )
    throw new Error('CLEARING_SESSION');
  const file = await readFile(p.file.name, decode(p.file.data));
  if (file.sha256 !== p.file.sha256) throw new Error('CLEARING_SOURCE_HASH');
  const state: ClearingInput = {
    file,
    reading: p.reading,
    scope: p.scope,
    events: p.events,
  };
  return { state, result: reconcileClearing(state) };
}
export async function exportClearing(
  input: ClearingInput,
  expected: ClearingResult,
): Promise<ArrayBuffer> {
  const { state, result } = await replayClearing(input);
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error('CLEARING_STALE_RESULT');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tarasuf';
  const table = (
    name: string,
    header: string[],
    values: (string | number)[][],
  ) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(header);
    sheet.addRows(values);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
    return sheet;
  };
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'single-account-clearing'],
      ['Version', CLEARING_VERSION],
      ['Source SHA-256', result.sourceHash],
      ['Source name', state.file.name],
      ['Sheet', result.sheet],
      ['Entity (user declared)', result.scope.entity],
      ['Ledger (user declared)', result.scope.ledger],
      ['Account', result.scope.account],
      ['Currency', result.scope.currency],
      ['Start', result.scope.start],
      ['End', result.scope.end],
      ['Decimals', result.decimals],
      ['Valid movement count', result.rows.length],
      [
        'Error count',
        result.inventory.filter((row) => row.kind === 'error').length,
      ],
      [
        'Cleared movement count',
        result.cases
          .filter((c) => c.status === 'cleared')
          .reduce((n, c) => n + c.ids.length, 0),
      ],
      ['Total minor units', result.total],
      [
        'Economic coverage',
        'Not independently verified; clearing of movements is not proof that the account period is complete.',
      ],
    ],
  );
  const rowById = new Map(result.rows.map((row) => [row.id, row]));
  const owner = new Map(
    result.cases.flatMap((c) => c.ids.map((id) => [id, c] as const)),
  );
  table(
    'Movements',
    [
      'ID',
      'Source row',
      'Posting ID',
      'Clearing reference',
      'Date',
      'Amount minor units',
      'Description',
      'Case ID',
      'Status',
      'Basis',
    ],
    result.rows.map((row) => [
      row.id,
      row.row,
      row.posting,
      row.reference,
      row.date,
      row.amount,
      row.description,
      owner.get(row.id)!.id,
      owner.get(row.id)!.status,
      owner.get(row.id)!.basis,
    ]),
  );
  table(
    'Cases',
    [
      'Case ID',
      'Status',
      'Basis',
      'Reason',
      'Clearing reference',
      'Net minor units',
      'Member count',
      'Note',
    ],
    result.cases.map((c) => [
      c.id,
      c.status,
      c.basis,
      c.reason,
      c.reference,
      c.net,
      c.ids.length,
      c.note,
    ]),
  );
  table(
    'Membership',
    ['Case ID', 'Movement ID', 'Source row'],
    result.cases.flatMap((c) =>
      c.ids.map((id) => [c.id, id, rowById.get(id)!.row]),
    ),
  );
  const width = Math.max(
    ...state.file.sheets[state.reading.sheet].rows.map((row) => row.length),
  );
  table(
    'Source inventory',
    [
      'Source row',
      'Kind',
      'Error',
      ...Array.from({ length: width }, (_, i) => `Original column ${i + 1}`),
    ],
    result.inventory.map((row) => [
      row.row,
      row.kind,
      row.error ?? '',
      ...row.values,
    ]),
  );
  table(
    'Reading',
    ['Field', 'Value'],
    Object.entries(result.reading).map(([key, value]) => [key, value]),
  );
  table(
    'Decisions',
    ['Sequence', 'Action', 'Context', 'Members', 'Note'],
    state.events.map((event, i) => [
      i + 1,
      event.action,
      event.context,
      event.ids.join('\n'),
      event.note,
    ]),
  );
  const bytes = await workbook.xlsx.writeBuffer({
    useSharedStrings: true,
    zip: { compression: 'DEFLATE', compressionOptions: { level: 3 } },
  });
  return new Uint8Array(bytes as unknown as Uint8Array).buffer;
}
