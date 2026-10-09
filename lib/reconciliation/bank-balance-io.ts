import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { assertBankNativeDisplay } from './bank-native-display.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { replayBank, saveBank, restoreBank, exportBank } from './bank-io.ts';
import {
  BANK_BALANCE_VERSION,
  BANK_BALANCE_CLAIM,
  reconcileBankBalances,
  type BankBalanceInput,
  type BankBalanceResult,
} from './bank-balance.ts';
const SESSION_LIMIT = 64 * 1024 * 1024;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw new Error('BALANCE_SOURCE');
}
function encode(buffer: ArrayBuffer) {
  let text = '';
  for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
  return btoa(text);
}
function decode(v: unknown, max = MAX_FILE_BYTES) {
  if (
    typeof v !== 'string' ||
    v.length > Math.ceil(max / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
  )
    throw new Error('BALANCE_SESSION');
  const buffer = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(buffer, max);
  if (encode(buffer) !== v) throw new Error('BALANCE_SESSION');
  return buffer;
}
function source(v: unknown): asserts v is BankBalanceInput['files'][0] {
  if (
    !plain(v) ||
    v.kind !== undefined ||
    typeof v.name !== 'string' ||
    v.name.length > 255 ||
    !/\.(csv|xlsx)$/i.test(v.name)
  )
    throw new Error('BALANCE_SOURCE');
  bytes(v.original);
}
export async function replayBankBalances(input: BankBalanceInput) {
  if (
    !plain(input) ||
    !keys(input, ['bank', 'files', 'readings', 'coverage']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 2
  )
    throw new Error('BALANCE_INPUT');
  const { state: bank } = await replayBank(input.bank),
    files = [];
  for (const original of input.files) {
    source(original);
    const file = await readFile(original.name, original.original!);
    if (file.sha256 !== original.sha256) throw new Error('BALANCE_SOURCE_HASH');
    files.push(file);
  }
  for (const file of [...bank.files, ...files])
    await assertBankNativeDisplay(file);
  const state: BankBalanceInput = {
    bank,
    files: files as BankBalanceInput['files'],
    readings: input.readings,
    coverage: input.coverage,
  };
  return { state, result: reconcileBankBalances(state) };
}
export async function saveBankBalances(input: BankBalanceInput) {
  const { state } = await replayBankBalances(input);
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-bank-balance-session',
      version: BANK_BALANCE_VERSION,
      bank: encode(await saveBank(state.bank)),
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original!),
      })),
      readings: state.readings,
      coverage: state.coverage,
    }),
  ).buffer;
  bytes(session, SESSION_LIMIT);
  await restoreBankBalances(session);
  return session;
}
export async function restoreBankBalances(session: ArrayBuffer) {
  bytes(session, SESSION_LIMIT);
  const p: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(session),
  );
  if (
    !plain(p) ||
    !keys(p, ['format', 'version', 'bank', 'files', 'readings', 'coverage']) ||
    p.format !== 'tarasuf-bank-balance-session' ||
    p.version !== BANK_BALANCE_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 2
  )
    throw new Error('BALANCE_SESSION');
  const { state: bank } = await restoreBank(decode(p.bank, 32 * 1024 * 1024)),
    files = [];
  for (const original of p.files) {
    if (
      !plain(original) ||
      !keys(original, ['name', 'sha256', 'data']) ||
      typeof original.name !== 'string' ||
      original.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(original.name)
    )
      throw new Error('BALANCE_SESSION');
    const file = await readFile(original.name, decode(original.data));
    if (file.sha256 !== original.sha256) throw new Error('BALANCE_SOURCE_HASH');
    files.push(file);
  }
  for (const file of [...bank.files, ...files])
    await assertBankNativeDisplay(file);
  const state: BankBalanceInput = {
    bank,
    files: files as BankBalanceInput['files'],
    readings: p.readings as BankBalanceInput['readings'],
    coverage: p.coverage as BankBalanceInput['coverage'],
  };
  return { state, result: reconcileBankBalances(state) };
}
export async function exportBankBalances(
  input: BankBalanceInput,
  expected: BankBalanceResult,
) {
  const { state, result } = await replayBankBalances(input);
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error('BALANCE_STALE_EXPORT');
  const book = new ExcelJS.Workbook();
  function table(name: string, headers: string[], rows: (string | number)[][]) {
    const sheet = book.addWorksheet(name);
    for (const row of [headers, ...rows]) {
      for (const v of row) {
        const text = String(v);
        if (
          text.length > 32767 ||
          Array.from(text).some((character) => {
            const code = character.codePointAt(0)!;
            return (
              (code < 32 && ![9, 10, 13].includes(code)) ||
              (code >= 0xd800 && code <= 0xdfff) ||
              code === 0xfffe ||
              code === 0xffff
            );
          })
        )
          throw new Error('BALANCE_EXPORT_CELL');
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
      ['Domain', 'bank-balance-evidence'],
      ['Version', BANK_BALANCE_VERSION],
      ['Context', result.context],
      ['Status', result.status],
      ['Claim', BANK_BALANCE_CLAIM],
      ['Entity', result.scope.entity],
      ['Ledger', result.scope.ledger],
      ['Bank account', result.scope.account],
      ['Currency', result.scope.currency],
      ['Period start', result.scope.start],
      ['Period end', result.scope.end],
      ['Decimals', result.decimals],
      ['Basis', result.coverage.basis],
      ['Boundary', result.coverage.boundary],
      ['Opening as of', result.coverage.openingAsOf],
      ['Closing as of', result.coverage.closingAsOf],
      ['Confirmed', String(result.coverage.confirmed)],
      ['Movement context', result.bank.context],
      ['Movement status', result.bank.status],
    ],
  );
  table(
    'Balances',
    [
      'ID',
      'Side',
      'Source row',
      'Own reference',
      'Kind',
      'As of',
      'Amount minor units',
    ],
    result.records.map((r) => [
      r.id,
      r.side,
      r.row,
      r.reference,
      r.kind,
      r.asOf,
      r.amount,
    ]),
  );
  table(
    'Cell evidence',
    ['ID', 'Side', 'Source row', 'Field', 'Source column', 'Original text'],
    result.records.flatMap((r) =>
      r.cells.map((c) => [r.id, r.side, r.row, c.field, c.column, c.text]),
    ),
  );
  table(
    'Components',
    ['Side', 'Component', 'Amount minor units', 'Present'],
    result.components.flatMap((c) =>
      (['opening', 'movement', 'closing', 'residual'] as const).map((kind) => [
        c.side,
        kind,
        c[kind] ?? '',
        String(c[kind] !== null),
      ]),
    ),
  );
  table(
    'Component members',
    ['Side', 'Component', 'Member ID'],
    result.components.flatMap((c) => [
      ...c.openingIds.map((id) => [c.side, 'opening', id]),
      ...c.movementIds.map((id) => [c.side, 'movement', id]),
      ...c.closingIds.map((id) => [c.side, 'closing', id]),
    ]),
  );
  table(
    'Differences',
    ['Component', 'Bank less cash minor units', 'Present'],
    (['opening', 'closing'] as const).map((kind) => [
      kind,
      result.differences[kind] ?? '',
      String(result.differences[kind] !== null),
    ]),
  );
  table(
    'Missing',
    ['Side', 'Kind'],
    result.missing.map((r) => [r.side, r.kind]),
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
    result.readings.map((r, s) => [
      s,
      r.sheet,
      r.role,
      r.family,
      r.perspective,
      String(r.confirmed),
    ]),
  );
  table(
    'Sources',
    ['Side', 'Name', 'SHA256', 'Chunk index', 'Base64'],
    state.files.flatMap((f, s) => {
      const encoded = encode(f.original!);
      const rows = [];
      for (let i = 0; i < encoded.length; i += 30000)
        rows.push([
          s,
          f.name,
          f.sha256!,
          i / 30000,
          encoded.slice(i, i + 30000),
        ]);
      return rows;
    }),
  );
  // The independent B1 workpaper retains every original movement, timing item,
  // case, event and source. Its auditor can verify it without trusting B2 output.
  const encoded = encode(await exportBank(state.bank, result.bank));
  const chunks = [];
  for (let i = 0; i < encoded.length; i += 30000)
    chunks.push([i / 30000, encoded.slice(i, i + 30000)]);
  table('Movement workpaper', ['Chunk index', 'Base64'], chunks);
  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer).buffer;
}
