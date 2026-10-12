import ExcelJS from 'exceljs';
import { readArFile } from './ar-source.ts';
import { validateExportText, excelExportText } from './export-text.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  AR_VERSION,
  reconcileAr,
  isArScopeReading,
  type ArInput,
  type ArResult,
} from './ar.ts';
export const AR_MAX_EXPORT_BYTES = 96 * 1024 * 1024;
const AR_MAX_SESSION_BYTES = 32 * 1024 * 1024;
const AR_SCOPE_DETAILS_VERSION = 'ar-scope-details-1';

function sourceBytes(value: unknown): asserts value is ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    !value.byteLength ||
    value.byteLength > MAX_FILE_BYTES
  )
    throw new Error('AR_SOURCE');
}
// Capture authoritative request data synchronously: all readers below await.
// Parsed rows and cached source metadata never authorize a save or export.
function snapshot(input: ArInput): ArInput {
  if (
    !input ||
    !Array.isArray(input.files) ||
    input.files.length !== 2 ||
    !Array.isArray(input.readings) ||
    input.readings.length !== 2 ||
    !Array.isArray(input.events) ||
    input.events.length > 1000
  )
    throw new Error('AR_INPUT');
  const files = input.files.map((source) => {
    if (
      !source ||
      typeof source.name !== 'string' ||
      source.name.length > 255 ||
      source.kind !== undefined ||
      !/\.(csv|xlsx)$/i.test(source.name)
    )
      throw new Error('AR_SOURCE');
    sourceBytes(source.original);
    return {
      name: source.name,
      sha256: source.sha256,
      original: source.original.slice(0),
    };
  });
  return {
    files: files as ArInput['files'],
    readings: structuredClone(input.readings),
    scope: structuredClone(input.scope),
    events: structuredClone(input.events),
  };
}
export async function replayAr(input: ArInput) {
  const captured = snapshot(input);
  const files = [];
  for (const [side, source] of captured.files.entries()) {
    const file = await readArFile(
      source.name,
      source.original!,
      captured.readings[side],
    );
    if (file.sha256 !== source.sha256) throw new Error('AR_SOURCE_HASH');
    files.push(file);
  }
  const state: ArInput = { ...captured, files: files as ArInput['files'] };
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
  const { state, result } = await replayAr(input);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-ar-session',
      version: result.version,
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
  if (bytes.byteLength > AR_MAX_SESSION_BYTES) throw new Error('AR_SESSION');
  await restoreAr(bytes);
  return bytes;
}
export async function restoreAr(bytes: ArrayBuffer) {
  if (
    !(bytes instanceof ArrayBuffer) ||
    !bytes.byteLength ||
    bytes.byteLength > AR_MAX_SESSION_BYTES
  )
    throw new Error('AR_SESSION');
  // The caller may mutate its buffer while source parsing is pending.
  const captured = bytes.slice(0);
  const p = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(captured),
  );
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    Object.keys(p).sort().join('|') !==
      'events|files|format|readings|scope|version' ||
    p.format !== 'tarasuf-ar-session' ||
    ![AR_VERSION, AR_SCOPE_DETAILS_VERSION].includes(p.version) ||
    !Array.isArray(p.files) ||
    p.files.length !== 2
  )
    throw new Error('AR_SESSION');
  const familyVersion =
    Array.isArray(p.readings) &&
    p.readings.some(
      (r: unknown) =>
        !!r &&
        typeof r === 'object' &&
        'family' in r &&
        r.family === AR_SCOPE_DETAILS_VERSION,
    )
      ? AR_SCOPE_DETAILS_VERSION
      : AR_VERSION;
  if (p.version !== familyVersion) throw new Error('AR_SESSION');
  const files = [];
  for (const [side, saved] of p.files.entries()) {
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
    const file = await readArFile(
      saved.name,
      decode(saved.data),
      p.readings?.[side],
    );
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
  const capturedExpected = structuredClone(expected);
  const { state, result } = await replayAr(input);
  if (JSON.stringify(result) !== JSON.stringify(capturedExpected))
    throw new Error('AR_STALE_RESULT');
  const extended = result.version === AR_SCOPE_DETAILS_VERSION;
  // Diagnostic references are global. Serialize once and bound their repeated
  // case-cell footprint before building tables; error-heavy sources must never
  // allocate quadratic strings or silently truncate the independent trail.
  const diagnostics = extended
    ? {
        issues: JSON.stringify(result.sourceIssues ?? []),
        refs: JSON.stringify(result.errorInventoryRefs ?? []),
        scopes: JSON.stringify(result.sourceScopes ?? []),
      }
    : undefined;
  if (
    diagnostics &&
    (Object.values(diagnostics).some((text) => text.length > 32767) ||
      diagnostics.refs.length *
        result.cases.filter((c) => c.reason === 'source-errors').length >
        8 * 1024 * 1024)
  )
    throw new Error('AR_EXPORT_EVIDENCE_LIMIT');
  const tables: {
    name: string;
    header: string[];
    values: (string | number | null)[][];
    formatted: boolean;
  }[] = [];
  const table = (
    name: string,
    header: string[],
    values: (string | number | null)[][],
    formatted = true,
  ) => {
    tables.push({ name, header, values, formatted });
  };
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'customer-ar-document-comparison'],
      ['Version', result.version],
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
      ...(extended
        ? [
            ['Receipt allocations', JSON.stringify(result.receiptAllocations)],
            [
              'Financial completeness asserted',
              String(result.financialCompletenessAsserted),
            ],
            ['Ledger total available', String(result.totals[0] !== null)],
            ['Statement total available', String(result.totals[1] !== null)],
            ['Source issues JSON', diagnostics!.issues],
            ['Error inventory refs JSON', diagnostics!.refs],
            ['Source scopes JSON', diagnostics!.scopes],
          ]
        : []),
    ],
  );
  const owner = new Map(
    result.cases.flatMap((c) => c.ids.map((id) => [id, c] as const)),
  );
  const inventoryByRow = new Map(
    result.inventory.map((i) => [`${i.side}:${i.row}`, i]),
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
      ...(extended
        ? [
            'Source family',
            'Original signed amount raw',
            'Open balance raw',
            'Open balance role',
            'Parent scope ID',
            'Parent cell JSON',
            'Inherited source cells JSON',
            'Line span JSON',
          ]
        : []),
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
      ...(extended
        ? [
            isArScopeReading(result.readings[r.side])
              ? AR_SCOPE_DETAILS_VERSION
              : AR_VERSION,
            r.originalRaw ?? '',
            r.openBalanceRaw ?? '',
            r.openBalanceRole ?? '',
            r.parentScopeId ?? '',
            r.parentCell ? JSON.stringify(r.parentCell) : '',
            r.inheritedSourceCells
              ? JSON.stringify(r.inheritedSourceCells)
              : '',
            inventoryByRow.get(`${r.side}:${r.row}`)?.lineSpan
              ? JSON.stringify(
                  inventoryByRow.get(`${r.side}:${r.row}`)!.lineSpan,
                )
              : '',
          ]
        : []),
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
      ...(extended ? ['Error inventory refs JSON'] : []),
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
      ...(extended
        ? [c.reason === 'source-errors' ? diagnostics!.refs : '[]']
        : []),
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
      width = Math.max(0, ...inventory.map((i) => i.values.length));
    table(
      side === 0 ? 'Ledger inventory' : 'Statement inventory',
      [
        'Source row',
        'Kind',
        'Error',
        ...Array.from({ length: width }, (_, i) => `Original column ${i + 1}`),
        ...(extended
          ? ['Inventory ID', 'Classification', 'Errors JSON', 'Line span JSON']
          : []),
      ],
      inventory.map((i) => [
        i.row,
        i.kind,
        i.error ?? '',
        ...i.values,
        ...(extended
          ? Array.from({ length: width - i.values.length }, () => '')
          : []),
        ...(extended
          ? [
              i.inventoryId ?? '',
              i.classification ?? '',
              JSON.stringify(i.errors ?? []),
              i.lineSpan ? JSON.stringify(i.lineSpan) : '',
            ]
          : []),
      ]),
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
  const sourceRows: (string | number | null)[][] = [];
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
      for (const value of row)
        if (value !== null) validateExportText(value, 'AR_EXPORT_CELL');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tarasuf';
  for (const { name, header, values, formatted } of tables) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(header.map(excelExportText));
    sheet.addRows(
      values.map((row) =>
        row.map((value) => (value === null ? null : excelExportText(value))),
      ),
    );
    if (formatted) {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((c) => {
        c.width = 24;
      });
    }
  }
  const bytes = new Uint8Array(
    (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array,
  ).buffer;
  if (!bytes.byteLength || bytes.byteLength > AR_MAX_EXPORT_BYTES)
    throw new Error('AR_EXPORT');
  return bytes;
}
