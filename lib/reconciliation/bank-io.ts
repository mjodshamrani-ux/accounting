import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { assertBankNativeDisplay } from './bank-native-display.ts';
import { validateExportText, excelExportText } from './export-text.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  BANK_VERSION,
  BANK_SCOPE_FIELDS,
  reconcileBank,
  type BankInput,
  type BankResult,
} from './bank.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function bytes(v: unknown): asserts v is ArrayBuffer {
  if (
    !(v instanceof ArrayBuffer) ||
    !v.byteLength ||
    v.byteLength > MAX_FILE_BYTES
  )
    throw new Error('BANK_SOURCE');
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
    throw new Error('BANK_SESSION');
  const buffer = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(buffer);
  if (encode(buffer) !== v) throw new Error('BANK_SESSION');
  return buffer;
}
export async function replayBank(input: BankInput) {
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'events|files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 2
  )
    throw new Error('BANK_INPUT');
  const files = [];
  for (const source of input.files) {
    if (
      !plain(source) ||
      source.kind !== undefined ||
      typeof source.name !== 'string' ||
      source.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(source.name)
    )
      throw new Error('BANK_SOURCE');
    bytes(source.original);
    const file = await readFile(source.name, source.original);
    if (file.sha256 !== source.sha256) throw new Error('BANK_SOURCE_HASH');
    await assertBankNativeDisplay(file);
    files.push(file);
  }
  const state: BankInput = {
    files: files as BankInput['files'],
    readings: input.readings,
    scope: input.scope,
    events: input.events,
  };
  return { state, result: reconcileBank(state) };
}
export async function saveBank(input: BankInput): Promise<ArrayBuffer> {
  const { state } = await replayBank(input);
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-bank-session',
      version: BANK_VERSION,
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
  if (session.byteLength > 32 * 1024 * 1024) throw new Error('BANK_SESSION');
  await restoreBank(session);
  return session;
}
export async function restoreBank(session: ArrayBuffer) {
  if (
    !(session instanceof ArrayBuffer) ||
    !session.byteLength ||
    session.byteLength > 32 * 1024 * 1024
  )
    throw new Error('BANK_SESSION');
  const p = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(session),
  );
  if (
    !plain(p) ||
    Object.keys(p).sort().join('|') !==
      'events|files|format|readings|scope|version' ||
    p.format !== 'tarasuf-bank-session' ||
    p.version !== BANK_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 2
  )
    throw new Error('BANK_SESSION');
  const files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      Object.keys(f).sort().join('|') !== 'data|name|sha256' ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw new Error('BANK_SESSION');
    const file = await readFile(f.name, decode(f.data));
    if (file.sha256 !== f.sha256) throw new Error('BANK_SOURCE_HASH');
    files.push(file);
  }
  return replayBank({
    files: files as BankInput['files'],
    readings: p.readings as BankInput['readings'],
    scope: p.scope as BankInput['scope'],
    events: p.events as BankInput['events'],
  });
}

/** Source bytes and memberships are preserved in separate rows, including undone decisions. */
export async function exportBank(
  input: BankInput,
  expected: BankResult,
): Promise<ArrayBuffer> {
  const { state, result } = await replayBank(input);
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error('BANK_STALE_RESULT');
  const book = new ExcelJS.Workbook();
  book.creator = 'Tarasuf';
  function table(name: string, headers: string[], rows: (string | number)[][]) {
    for (const row of [headers, ...rows])
      for (const value of row) validateExportText(value, 'BANK_EXPORT_CELL');
    const s = book.addWorksheet(name);
    s.addRow(headers.map(excelExportText));
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
      ['Domain', 'bank-cash-movements'],
      ['Version', result.version],
      ['Status', result.status],
      ['Decimals', result.decimals],
      ...BANK_SCOPE_FIELDS.map((k) => [k, result.scope[k]]),
      ['Confirmed', String(result.scope.confirmed)],
      ['Context', result.context],
      [
        'Claim',
        'Movement comparison only; no opening/closing balance bridge, ERP posting, source authenticity or period completeness assurance',
      ],
    ],
  );
  table(
    'Movements',
    [
      'ID',
      'Side',
      'Source row',
      'Own reference',
      'Settlement',
      'Movement date',
      'Value date',
      'Cash direction',
      'Role',
      'Parent payment',
      'Reverses',
      'Policy',
      'Status',
      'Amount minor units',
      'Signed minor units',
    ],
    result.records.map((r) => [
      r.id,
      r.side,
      r.row,
      r.reference,
      r.settlement,
      r.movementDate,
      r.valueDate,
      r.direction,
      r.role,
      r.parent,
      r.reverses,
      r.policy,
      r.status,
      r.amount,
      r.signed,
    ]),
  );
  table(
    'Cell evidence',
    ['ID', 'Side', 'Source row', 'Field', 'Source column', 'Original text'],
    result.records.flatMap((r) =>
      r.traces.map((t) => [r.id, r.side, r.row, t.field, t.column, t.text]),
    ),
  );
  table(
    'Groups',
    [
      'Case ID',
      'Source identity',
      'Kind',
      'Status',
      'Reason',
      'Eligible',
      'Policy',
      'Bank minor units',
      'Cash minor units',
      'Difference minor units',
      'Timing review',
    ],
    result.cases.map((g) => [
      g.id,
      g.key,
      g.kind,
      g.status,
      g.reason,
      String(g.eligible),
      g.policy ?? '',
      g.bankMinor,
      g.cashMinor,
      g.deltaMinor,
      String(g.timingReview),
    ]),
  );
  table(
    'Group members',
    ['Case ID', 'Side', 'Member ID'],
    result.cases.flatMap((g) => [
      ...g.bankIds.map((id) => [g.id, 0, id]),
      ...g.cashIds.map((id) => [g.id, 1, id]),
    ]),
  );
  table(
    'Timing items',
    [
      'ID',
      'Side',
      'Source row',
      'Own reference',
      'Movement date',
      'Value date',
      'Outside period',
      'Valid movement',
    ],
    result.timingItems.map((t) => [
      t.id,
      t.side,
      t.row,
      t.reference,
      t.movementDate,
      t.valueDate,
      String(t.outsidePeriod),
      String(t.validMovement),
    ]),
  );
  table(
    'Events',
    [
      'Index',
      'Decision',
      'Type',
      'Context',
      'Device UTC',
      'Evidence reference',
      'Reason',
    ],
    result.events.map((e, i) => [
      i,
      e.id,
      e.type,
      e.context,
      e.at,
      e.reference,
      e.note,
    ]),
  );
  table(
    'Event members',
    ['Decision', 'Side', 'Member ID'],
    result.events.flatMap((e) => [
      ...e.bankIds.map((id) => [e.id, 0, id]),
      ...e.cashIds.map((id) => [e.id, 1, id]),
    ]),
  );
  table(
    'Inventory',
    ['ID', 'Side', 'Source row', 'Kind', 'Error', 'Original cells'],
    result.inventory.map((i) => [
      i.id,
      i.side,
      i.row,
      i.kind,
      i.error ?? '',
      JSON.stringify(i.values),
    ]),
  );
  table(
    'Reading',
    ['Side', 'Sheet index', 'Role', 'Family', 'Perspective', 'Confirmed'],
    result.readings.map((r, i) => [
      i,
      r.sheet,
      r.role,
      r.family,
      r.perspective,
      String(r.confirmed),
    ]),
  );
  const chunks: (string | number)[][] = [];
  for (const [side, f] of state.files.entries()) {
    const data = encode(f.original!);
    for (let i = 0; i < data.length; i += 30000)
      chunks.push([
        side,
        f.name,
        f.sha256!,
        i / 30000,
        data.slice(i, i + 30000),
      ]);
  }
  table('Sources', ['Side', 'Name', 'SHA256', 'Chunk index', 'Base64'], chunks);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
