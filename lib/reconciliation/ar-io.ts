import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { validateExportText, excelExportText } from './export-text.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { AR_VERSION, reconcileAr, type ArInput, type ArResult } from './ar.ts';
function sourceBytes(value: unknown): asserts value is ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    !value.byteLength ||
    value.byteLength > MAX_FILE_BYTES
  )
    throw new Error('AR_SOURCE');
}
export async function replayAr(input: ArInput) {
  if (!input || !Array.isArray(input.files) || input.files.length !== 2)
    throw new Error('AR_INPUT');
  const files = [];
  for (const source of input.files) {
    if (
      !source ||
      typeof source.name !== 'string' ||
      source.name.length > 255 ||
      source.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(source.name)
    )
      throw new Error('AR_SOURCE');
    sourceBytes(source.original);
    const file = await readFile(source.name, source.original);
    if (file.sha256 !== source.sha256) throw new Error('AR_SOURCE_HASH');
    files.push(file);
  }
  const state: ArInput = {
    files: files as ArInput['files'],
    readings: input.readings,
    scope: input.scope,
    events: input.events,
  };
  return { state, result: reconcileAr(state) };
}
const encode = (buffer: ArrayBuffer) => {
  let text = '';
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
  return btoa(text);
};
function decode(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new Error('AR_SESSION');
  const buffer = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
  sourceBytes(buffer);
  if (encode(buffer) !== value) throw new Error('AR_SESSION');
  return buffer;
}
export async function saveAr(input: ArInput): Promise<ArrayBuffer> {
  const { state } = await replayAr(input);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-ar-session',
      version: AR_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original!),
      })),
      readings: state.readings,
      scope: state.scope,
      events: state.events,
    }),
  ).buffer;
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('AR_SESSION');
  await restoreAr(bytes);
  return bytes;
}
export async function restoreAr(bytes: ArrayBuffer) {
  if (
    !(bytes instanceof ArrayBuffer) ||
    !bytes.byteLength ||
    bytes.byteLength > 32 * 1024 * 1024
  )
    throw new Error('AR_SESSION');
  const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    Object.keys(p).sort().join('|') !==
      'events|files|format|readings|scope|version' ||
    p.format !== 'tarasuf-ar-session' ||
    p.version !== AR_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 2
  )
    throw new Error('AR_SESSION');
  const files = [];
  for (const saved of p.files) {
    if (
      !saved ||
      typeof saved !== 'object' ||
      Array.isArray(saved) ||
      Object.keys(saved).sort().join('|') !== 'data|name|sha256' ||
      typeof saved.name !== 'string' ||
      saved.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(saved.name)
    )
      throw new Error('AR_SESSION');
    const file = await readFile(saved.name, decode(saved.data));
    if (file.sha256 !== saved.sha256) throw new Error('AR_SOURCE_HASH');
    files.push(file);
  }
  const state: ArInput = {
    files: files as ArInput['files'],
    readings: p.readings,
    scope: p.scope,
    events: p.events,
  };
  return { state, result: reconcileAr(state) };
}
export async function exportAr(
  input: ArInput,
  expected: ArResult,
): Promise<ArrayBuffer> {
  const { state, result } = await replayAr(input);
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error('AR_STALE_RESULT');
  const tables: {
    name: string;
    header: string[];
    values: (string | number)[][];
    formatted: boolean;
  }[] = [];
  const table = (
    name: string,
    header: string[],
    values: (string | number)[][],
    formatted = true,
  ) => {
    tables.push({ name, header, values, formatted });
  };
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'customer-ar-document-comparison'],
      ['Version', AR_VERSION],
      ['Perspective', 'seller-receivable'],
      ['Amount basis', 'original-movement'],
      ...Object.entries(result.scope)
        .filter(([k]) => k !== 'confirmed')
        .map(([k, v]) => [k, String(v)]),
      ['Decimals', result.decimals],
      ['Valid movements', result.rows.length],
      [
        'Reading errors',
        result.inventory.filter((i) => i.kind === 'error').length,
      ],
      [
        'Matched document pairs',
        result.cases.filter((c) => c.status === 'matched').length,
      ],
      ['Ledger total minor units', result.totals[0]],
      ['Statement total minor units', result.totals[1]],
      [
        'Economic coverage',
        'Not independently verified. Document comparison is not receipt allocation, balance reconciliation or proof of completeness.',
      ],
    ],
  );
  const owner = new Map(
    result.cases.flatMap((c) => c.ids.map((id) => [id, c] as const)),
  );
  table(
    'Movements',
    [
      'Movement ID',
      'Side',
      'Source row',
      'Posting ID',
      'Document type',
      'Own document number',
      'Posting date',
      'Amount minor units',
      'Related invoice',
      'Description',
      'Case ID',
      'Status',
      'Basis',
      'Related evidence JSON',
    ],
    result.rows.map((r) => [
      r.id,
      r.side,
      r.row,
      r.posting,
      r.kind,
      r.document,
      r.date,
      r.amount,
      r.related,
      r.description,
      owner.get(r.id)!.id,
      owner.get(r.id)!.status,
      owner.get(r.id)!.basis,
      JSON.stringify(r.relatedEvidence),
    ]),
  );
  table(
    'Cases',
    [
      'Case ID',
      'Document type',
      'Own document number',
      'Status',
      'Basis',
      'Reason',
      'Member count',
      'Note',
    ],
    result.cases.map((c) => [
      c.id,
      c.kind,
      c.document,
      c.status,
      c.basis,
      c.reason,
      c.ids.length,
      c.note,
    ]),
  );
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  table(
    'Membership',
    ['Case ID', 'Movement ID', 'Side', 'Source row'],
    result.cases.flatMap((c) =>
      c.ids.map((id) => [c.id, id, byId.get(id)!.side, byId.get(id)!.row]),
    ),
  );
  for (const side of [0, 1] as const) {
    const inventory = result.inventory.filter((i) => i.side === side),
      width = Math.max(...inventory.map((i) => i.values.length));
    table(
      side === 0 ? 'Ledger inventory' : 'Statement inventory',
      [
        'Source row',
        'Kind',
        'Error',
        ...Array.from({ length: width }, (_, i) => `Original column ${i + 1}`),
      ],
      inventory.map((i) => [i.row, i.kind, i.error ?? '', ...i.values]),
    );
  }
  table(
    'Reading',
    ['Side', 'Field', 'Value'],
    result.readings.flatMap((r, side) =>
      Object.entries(r).map(([k, v]) => [side, k, String(v)]),
    ),
  );
  table(
    'Decisions',
    [
      'Sequence',
      'Context',
      'Action',
      'Members JSON',
      'Note',
      'Recorded at UTC',
    ],
    state.events.map((e, i) => [
      i + 1,
      e.context,
      e.action,
      JSON.stringify(e.ids),
      e.note,
      e.at,
    ]),
  );
  // Excel cells have a 32k text limit; split original bytes rather than silently truncating.
  const sourceHeaders = [
    'Side',
    'Role',
    'Source name',
    'Source SHA-256',
    'Sheet',
    'Chunk',
    'Original bytes base64',
  ];
  const sourceRows: (string | number)[][] = [];
  result.sources.forEach((s, side) => {
    const raw = encode(state.files[side].original!);
    for (let start = 0, chunk = 1; start < raw.length; start += 30000, chunk++)
      sourceRows.push([
        side,
        s.role,
        s.name,
        s.hash,
        s.sheet,
        chunk,
        raw.slice(start, start + 30000),
      ]);
  });
  table('Sources', sourceHeaders, sourceRows, false);
  // Notes and source names do not pass through native-cell validation. Verify
  // every exported string before allocating a workbook; never let ExcelJS
  // silently strip characters from the review trail.
  for (const { header, values } of tables)
    for (const row of [header, ...values])
      for (const value of row) validateExportText(value, 'AR_EXPORT_CELL');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tarasuf';
  for (const { name, header, values, formatted } of tables) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(header.map(excelExportText));
    sheet.addRows(values.map((row) => row.map(excelExportText)));
    if (formatted) {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((c) => {
        c.width = 24;
      });
    }
  }
  return new Uint8Array(
    (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array,
  ).buffer;
}
