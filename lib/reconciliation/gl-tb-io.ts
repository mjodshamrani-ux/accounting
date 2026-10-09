import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { validateExportText, excelExportText } from './export-text.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  GL_TB_VERSION,
  GL_SCOPE_FIELDS,
  BALANCE_FIELDS,
  reconcileGlTb,
  type GlTbInput,
  type GlTbResult,
} from './gl-tb.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function bytes(v: unknown): asserts v is ArrayBuffer {
  if (
    !(v instanceof ArrayBuffer) ||
    !v.byteLength ||
    v.byteLength > MAX_FILE_BYTES
  )
    throw new Error('GL_TB_SOURCE');
}
function encode(buffer: ArrayBuffer) {
  let text = '';
  for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
  return btoa(text);
}
function decode(v: unknown) {
  if (
    typeof v !== 'string' ||
    v.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
  )
    throw new Error('GL_TB_SESSION');
  const buffer = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(buffer);
  if (encode(buffer) !== v) throw new Error('GL_TB_SESSION');
  return buffer;
}
export async function replayGlTb(input: GlTbInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 2
  )
    throw new Error('GL_TB_INPUT');
  const files = [];
  for (const source of input.files) {
    if (
      !plain(source) ||
      source.kind !== undefined ||
      typeof source.name !== 'string' ||
      source.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(source.name)
    )
      throw new Error('GL_TB_SOURCE');
    bytes(source.original);
    const file = await readFile(source.name, source.original);
    if (file.sha256 !== source.sha256) throw new Error('GL_TB_SOURCE_HASH');
    files.push(file);
  }
  const state: GlTbInput = {
    files: files as GlTbInput['files'],
    readings: input.readings,
    scope: input.scope,
  };
  return { state, result: reconcileGlTb(state) };
}
export async function saveGlTb(input: GlTbInput): Promise<ArrayBuffer> {
  const { state } = await replayGlTb(input);
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-gl-tb-session',
      version: GL_TB_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original!),
      })),
      readings: state.readings,
      scope: state.scope,
    }),
  ).buffer;
  if (session.byteLength > 32 * 1024 * 1024) throw new Error('GL_TB_SESSION');
  await restoreGlTb(session);
  return session;
}
export async function restoreGlTb(session: ArrayBuffer) {
  if (
    !(session instanceof ArrayBuffer) ||
    !session.byteLength ||
    session.byteLength > 32 * 1024 * 1024
  )
    throw new Error('GL_TB_SESSION');
  const p = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(session),
  );
  if (
    !plain(p) ||
    Object.keys(p).sort().join('|') !== 'files|format|readings|scope|version' ||
    p.format !== 'tarasuf-gl-tb-session' ||
    p.version !== GL_TB_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 2
  )
    throw new Error('GL_TB_SESSION');
  const files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      Object.keys(f).sort().join('|') !== 'data|name|sha256' ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw new Error('GL_TB_SESSION');
    const file = await readFile(f.name, decode(f.data));
    if (file.sha256 !== f.sha256) throw new Error('GL_TB_SOURCE_HASH');
    files.push(file);
  }
  return replayGlTb({
    files: files as GlTbInput['files'],
    readings: p.readings as GlTbInput['readings'],
    scope: p.scope as GlTbInput['scope'],
  });
}
export async function exportGlTb(
  input: GlTbInput,
  expected: GlTbResult,
): Promise<ArrayBuffer> {
  const { state, result } = await replayGlTb(input);
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error('GL_TB_STALE_RESULT');
  const book = new ExcelJS.Workbook();
  book.creator = 'Tarasuf';
  function table(name: string, header: string[], rows: (string | number)[][]) {
    for (const row of [header, ...rows])
      for (const value of row) validateExportText(value, 'GL_TB_EXPORT_CELL');
    const s = book.addWorksheet(name);
    s.addRow(header.map(excelExportText));
    s.addRows(rows.map((row) => row.map(excelExportText)));
    s.views = [{ state: 'frozen', ySplit: 1 }];
    s.getRow(1).font = { bold: true };
    s.columns.forEach((c) => {
      c.width = 24;
    });
  }
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'gl-trial-balance-consistency'],
      ['Version', result.version],
      ['Status', result.status],
      ['Decimals', result.decimals],
      ...GL_SCOPE_FIELDS.map((k) => [k, result.scope[k]]),
      ['Confirmed', String(result.scope.confirmed)],
      ['GL bridge minor units', result.glBridge ?? 'missing'],
      ['TB bridge minor units', result.tbBridge ?? 'missing'],
      ['Missing', JSON.stringify(result.missing)],
      ['Context', result.context],
      [
        'Reading errors',
        result.inventory.filter((i) => i.kind === 'error').length,
      ],
      ['Valid records', result.rows.length],
      [
        'Claim',
        'Internal consistency in the declared scope; source authenticity and economic completeness unverified',
      ],
    ],
  );
  table(
    'Balances',
    ['Component', 'GL minor units', 'TB minor units', 'Difference minor units'],
    BALANCE_FIELDS.map((f) => [
      f,
      result.gl?.[f] ?? 'missing',
      result.tb?.[f] ?? 'missing',
      result.differences?.[f] ?? 'missing',
    ]),
  );
  table(
    'Records',
    [
      'ID',
      'Side',
      'Source row',
      'Record ID',
      'Kind',
      'Posting date',
      'Amounts minor units JSON',
    ],
    result.rows.map((r) => [
      r.id,
      r.side,
      r.row,
      r.record,
      r.kind,
      r.date,
      JSON.stringify(r.amounts),
    ]),
  );
  table(
    'Cell evidence',
    [
      'ID',
      'Side',
      'Source row',
      'Field',
      'Source column',
      'Original text',
      'Amount minor units',
    ],
    result.rows.flatMap((r) =>
      r.trace.map((t) => [
        r.id,
        r.side,
        r.row,
        t.field,
        t.column,
        t.text,
        t.amount,
      ]),
    ),
  );
  table(
    'Component evidence',
    ['Side', 'Component', 'Total minor units'],
    result.components.map((c) => [c.side, c.field, c.amount]),
  );
  table(
    'Component members',
    ['Side', 'Component', 'Record ID', 'Source column'],
    result.components.flatMap((c) =>
      c.cells.map((cell) => [c.side, c.field, cell.id, cell.column]),
    ),
  );
  for (const side of [0, 1] as const) {
    const inventory = result.inventory.filter((i) => i.side === side),
      width = Math.max(0, ...inventory.map((i) => i.values.length));
    table(
      side === 0 ? 'GL inventory' : 'TB inventory',
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
  const sources: (string | number)[][] = [];
  result.sources.forEach((s, side) => {
    const raw = encode(state.files[side].original!);
    for (let i = 0, chunk = 1; i < raw.length; i += 30000, chunk++)
      sources.push([
        side,
        s.role,
        s.name,
        s.hash,
        s.sheet,
        chunk,
        raw.slice(i, i + 30000),
      ]);
  });
  table(
    'Sources',
    [
      'Side',
      'Role',
      'Source name',
      'Source SHA-256',
      'Sheet',
      'Chunk',
      'Original bytes base64',
    ],
    sources,
  );
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
