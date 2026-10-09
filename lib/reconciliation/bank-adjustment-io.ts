import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { assertBankNativeDisplay } from './bank-native-display.ts';
import { MAX_FILE_BYTES } from './types.ts';
import {
  replayBankBalances,
  saveBankBalances,
  restoreBankBalances,
  exportBankBalances,
} from './bank-balance-io.ts';
import { exportBank } from './bank-io.ts';
import {
  ADJUSTMENT_VERSION,
  ADJUSTMENT_SESSION_LIMIT,
  reconcileBankAdjustments,
  type BankAdjustmentInput,
  type BankAdjustmentResult,
} from './bank-adjustment.ts';
export { ADJUSTMENT_SESSION_LIMIT } from './bank-adjustment.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('ADJUSTMENT_SOURCE');
}
function encode(v: ArrayBuffer) {
  let s = '';
  for (const n of new Uint8Array(v)) s += String.fromCharCode(n);
  return btoa(s);
}
function decode(v: unknown, max = MAX_FILE_BYTES) {
  if (
    typeof v !== 'string' ||
    v.length > Math.ceil(max / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
  )
    throw Error('ADJUSTMENT_SESSION');
  const data = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(data, max);
  if (encode(data) !== v) throw Error('ADJUSTMENT_SESSION');
  return data;
}
export async function replayBankAdjustments(input: BankAdjustmentInput) {
  if (
    !plain(input) ||
    !keys(input, ['balance', 'files', 'readings', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2
  )
    throw Error('ADJUSTMENT_INPUT');
  const { state: balance } = await replayBankBalances(input.balance),
    files = [];
  for (const old of input.files) {
    if (
      !plain(old) ||
      old.kind !== undefined ||
      typeof old.name !== 'string' ||
      old.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(old.name)
    )
      throw Error('ADJUSTMENT_SOURCE');
    bytes(old.original);
    const file = await readFile(old.name, old.original);
    if (file.sha256 !== old.sha256) throw Error('ADJUSTMENT_SOURCE_HASH');
    files.push(file);
  }
  for (const file of files) await assertBankNativeDisplay(file);
  const state: BankAdjustmentInput = {
    balance,
    files: files as BankAdjustmentInput['files'],
    readings: input.readings,
    completeness: input.completeness,
    events: input.events,
  };
  return { state, result: reconcileBankAdjustments(state) };
}
export async function saveBankAdjustments(input: BankAdjustmentInput) {
  const { state } = await replayBankAdjustments(input),
    data = new TextEncoder().encode(
      JSON.stringify({
        format: 'tarasuf-bank-adjustment-session',
        version: ADJUSTMENT_VERSION,
        balance: encode(await saveBankBalances(state.balance)),
        files: state.files.map((f) => ({
          name: f.name,
          sha256: f.sha256,
          data: encode(f.original!),
        })),
        readings: state.readings,
        completeness: state.completeness,
        events: state.events,
      }),
    ).buffer;
  bytes(data, ADJUSTMENT_SESSION_LIMIT);
  await restoreBankAdjustments(data);
  return data;
}
export async function restoreBankAdjustments(data: ArrayBuffer) {
  bytes(data, ADJUSTMENT_SESSION_LIMIT);
  const p: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(data),
  );
  if (
    !plain(p) ||
    !keys(p, [
      'format',
      'version',
      'balance',
      'files',
      'readings',
      'completeness',
      'events',
    ]) ||
    p.format !== 'tarasuf-bank-adjustment-session' ||
    p.version !== ADJUSTMENT_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 2
  )
    throw Error('ADJUSTMENT_SESSION');
  const { state: balance } = await restoreBankBalances(
      decode(p.balance, 64 * 1024 * 1024),
    ),
    files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      !keys(f, ['name', 'sha256', 'data']) ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw Error('ADJUSTMENT_SESSION');
    const source = await readFile(f.name, decode(f.data));
    if (source.sha256 !== f.sha256) throw Error('ADJUSTMENT_SOURCE_HASH');
    files.push(source);
  }
  for (const file of files) await assertBankNativeDisplay(file);
  const state: BankAdjustmentInput = {
    balance,
    files: files as BankAdjustmentInput['files'],
    readings: p.readings as BankAdjustmentInput['readings'],
    completeness: p.completeness as BankAdjustmentInput['completeness'],
    events: p.events as BankAdjustmentInput['events'],
  };
  return { state, result: reconcileBankAdjustments(state) };
}
export async function exportBankAdjustments(
  input: BankAdjustmentInput,
  expected: BankAdjustmentResult,
) {
  const { state, result: r } = await replayBankAdjustments(input);
  if (JSON.stringify(r) !== JSON.stringify(expected))
    throw Error('ADJUSTMENT_STALE_EXPORT');
  const book = new ExcelJS.Workbook();
  function table(name: string, headers: string[], rows: (string | number)[][]) {
    const sheet = book.addWorksheet(name);
    for (const row of [headers, ...rows]) {
      for (const v of row) {
        const s = String(v);
        if (
          s.length > 32767 ||
          Array.from(s).some((c) => {
            const n = c.codePointAt(0)!;
            return (
              (n < 32 && ![9, 10, 13].includes(n)) ||
              (n >= 0xd800 && n <= 0xdfff) ||
              n === 0xfffe ||
              n === 0xffff
            );
          })
        )
          throw Error('ADJUSTMENT_EXPORT_CELL');
      }
      sheet.addRow(row);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.columns = headers.map(() => ({ width: 24 }));
  }
  table(
    'Summary',
    ['Property', 'Value'],
    [
      ['Domain', 'bank-adjustment-ledger'],
      ['Version', r.version],
      ['Context', r.context],
      ['Status', r.status],
      ['Claim', r.claim],
      ...Object.entries(r.balance.scope).map(([k, v]) => [k, String(v)]),
      ['Decimals', r.balance.decimals],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness note', r.completeness.note],
      ['Balance context', r.balance.context],
      ['Balance status', r.balance.status],
      ['Movement status', r.balance.bank.status],
    ],
  );
  table(
    'Endpoints',
    [
      'Point',
      'Raw bank',
      'Raw cashbook',
      'Bank adjustment',
      'Cashbook adjustment',
      'Adjusted bank',
      'Adjusted cashbook',
      'Difference',
    ],
    r.endpoints.map((e) => [
      e.point,
      ...[
        e.rawBank,
        e.rawCash,
        e.bankAdjustment,
        e.cashAdjustment,
        e.adjustedBank,
        e.adjustedCash,
        e.difference,
      ].map((v) => v ?? ''),
    ]),
  );
  table(
    'Items',
    [
      'ID',
      'Source row',
      'Item reference',
      'Point',
      'Adjust side',
      'Evidence reference',
      'Amount minor units',
      'Explanation',
    ],
    r.items.map((i) => [
      i.id,
      i.row,
      i.reference,
      i.point,
      i.side,
      i.proofReference,
      i.amount,
      i.explanation,
    ]),
  );
  table(
    'Proofs',
    [
      'ID',
      'Source row',
      'Evidence reference',
      'Lifecycle',
      'Kind',
      'Source side',
      'Record reference',
      'Movement date',
      'Value date',
      'Document reference',
      'Signed minor units',
    ],
    r.proofs.map((p) => [
      p.id,
      p.row,
      p.reference,
      p.lifecycle,
      p.kind,
      p.side,
      p.recordReference,
      p.movementDate,
      p.valueDate,
      p.document,
      p.amount,
    ]),
  );
  table(
    'Cell evidence',
    ['Source', 'ID', 'Source row', 'Field', 'Source column', 'Original text'],
    [
      ...r.items.map((i) => ({ source: 0, ...i })),
      ...r.proofs.map((i) => ({ source: 1, ...i })),
    ].flatMap((i) =>
      i.cells.map((c) => [i.source, i.id, i.row, c.field, c.column, c.text]),
    ),
  );
  table(
    'Inventory',
    ['Source', 'ID', 'Source row', 'Kind', 'Error', 'Original cells'],
    r.inventory.map((i) => [
      i.source,
      i.id,
      i.row,
      i.kind,
      i.error ?? '',
      JSON.stringify(i.values),
    ]),
  );
  table(
    'Lifecycles',
    ['ID', 'Lifecycle reference', 'Status'],
    r.lifecycles.map((l) => [l.id, l.reference, l.status]),
  );
  table(
    'Lifecycle members',
    ['Lifecycle', 'Type', 'Member ID'],
    r.lifecycles.flatMap((l) => [
      ...l.itemIds.map((id) => [l.id, 'item', id]),
      ...l.proofIds.map((id) => [l.id, 'proof', id]),
      ...l.movementIds.map((id) => [l.id, 'movement', id]),
    ]),
  );
  table(
    'Events',
    [
      'Index',
      'ID',
      'Type',
      'Context',
      'Device UTC',
      'Evidence reference',
      'Reason',
    ],
    r.events.map((e, i) => [
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
    ['Decision', 'Item ID'],
    r.events.flatMap((e) => e.itemIds.map((id) => [e.id, id])),
  );
  table(
    'Reading',
    ['Source', 'Sheet index', 'Role', 'Family', 'Perspective', 'Confirmed'],
    r.readings.map((p, i) => [
      i,
      p.sheet,
      p.role,
      p.family,
      p.perspective,
      String(p.confirmed),
    ]),
  );
  table(
    'Unresolved movements',
    ['Case ID'],
    r.unresolved.map((id) => [id]),
  );
  function chunks(v: ArrayBuffer) {
    const s = encode(v),
      rows: (string | number)[][] = [];
    for (let i = 0; i < s.length; i += 30000)
      rows.push([i / 30000, s.slice(i, i + 30000)]);
    return rows;
  }
  table(
    'Sources',
    ['Source', 'Name', 'SHA256', 'Chunk index', 'Base64'],
    state.files.flatMap((f, i) =>
      chunks(f.original!).map((c) => [i, f.name, f.sha256!, ...c]),
    ),
  );
  const balanceBytes = await exportBankBalances(state.balance, r.balance),
    movementBytes = await exportBank(state.balance.bank, r.balance.bank);
  table('Balance workpaper', ['Chunk index', 'Base64'], chunks(balanceBytes));
  // Directly readable evidence tables supplement the full replayable child bytes.
  async function visible(data: ArrayBuffer, prefix: string, names?: string[]) {
    const child = new ExcelJS.Workbook();
    await child.xlsx.load(data);
    for (const s of child.worksheets) {
      if (names && !names.includes(s.name)) continue;
      const rows: (string | number)[][] = [];
      s.eachRow((row) => {
        const values = row.values as ExcelJS.CellValue[];
        const cells = Array.from({ length: s.columnCount }, (_, i) => {
          const v = values[i + 1] ?? '';
          if (typeof v !== 'string' && typeof v !== 'number')
            throw Error('ADJUSTMENT_EXPORT_CELL');
          return v;
        });
        rows.push(cells);
      });
      table(`${prefix} ${s.name}`, rows[0].map(String), rows.slice(1));
    }
  }
  await visible(balanceBytes, 'B2', [
    'Balances',
    'Cell evidence',
    'Components',
    'Component members',
    'Differences',
    'Missing',
    'Inventory',
  ]);
  await visible(movementBytes, 'B1');
  const buffer: unknown = await book.xlsx.writeBuffer();
  if (buffer instanceof ArrayBuffer) return buffer.slice(0);
  if (ArrayBuffer.isView(buffer))
    return Uint8Array.from(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    ).buffer;
  throw Error('ADJUSTMENT_EXPORT_BUFFER');
}
