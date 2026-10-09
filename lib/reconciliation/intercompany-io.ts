import ExcelJS from 'exceljs';
import { readIntercompanyFile } from './intercompany-source.ts';
import { MAX_FILE_BYTES } from './types.ts';
import { assertIntercompanyNative } from './intercompany-native.ts';
import {
  IC_VERSION,
  IC_SESSION_LIMIT,
  IC_SCOPE_FIELDS,
  reconcileIntercompany,
  type IntercompanyInput,
  type IntercompanyResult,
} from './intercompany.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: object, wanted: string[]) =>
  Object.keys(v).sort().join('|') === [...wanted].sort().join('|');
function bytes(v: unknown, max = MAX_FILE_BYTES): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || !v.byteLength || v.byteLength > max)
    throw Error('IC_SOURCE');
}
function encode(v: ArrayBuffer) {
  let s = '';
  for (const n of new Uint8Array(v)) s += String.fromCharCode(n);
  return btoa(s);
}
function decode(v: unknown) {
  if (
    typeof v !== 'string' ||
    v.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
  )
    throw Error('IC_SESSION');
  const b = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(b);
  if (encode(b) !== v) throw Error('IC_SESSION');
  return b;
}
export async function replayIntercompany(input: IntercompanyInput) {
  if (
    !plain(input) ||
    !keys(input, ['files', 'readings', 'scope', 'completeness', 'events']) ||
    !Array.isArray(input.files) ||
    input.files.length !== 4
  )
    throw Error('IC_INPUT');
  // Take every original and decision-defining field synchronously. The caller
  // must not be able to alter a later source or review context while hashing an
  // earlier original. Cached parsed rows are deliberately excluded.
  const snapshots = input.files.map((old) => {
    if (
      !plain(old) ||
      old.kind !== undefined ||
      typeof old.name !== 'string' ||
      old.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(old.name)
    )
      throw Error('IC_SOURCE');
    bytes(old.original);
    return {
      name: old.name,
      sha256: old.sha256,
      original: old.original.slice(0),
    };
  });
  const metadata = structuredClone({
    readings: input.readings,
    scope: input.scope,
    completeness: input.completeness,
    events: input.events,
  });
  const files = [];
  for (const old of snapshots) {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', old.original)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== old.sha256) throw Error('IC_SOURCE_HASH');
    const file = await readIntercompanyFile(old.name, old.original);
    if (file.sha256 !== old.sha256) throw Error('IC_SOURCE_HASH');
    files.push(file);
  }
  const state: IntercompanyInput = {
    files: files as IntercompanyInput['files'],
    ...metadata,
  };
  const result = reconcileIntercompany(state);
  for (let i = 0; i < files.length; i++)
    await assertIntercompanyNative(files[i], i, result.decimals);
  for (const file of files) {
    const after = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', file.original!)),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('');
    if (after !== file.sha256) throw Error('IC_SOURCE_HASH');
  }
  return { state, result };
}
export async function saveIntercompany(input: IntercompanyInput) {
  const { state } = await replayIntercompany(input);
  const data = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-intercompany-session',
      version: IC_VERSION,
      files: state.files.map((f) => ({
        name: f.name,
        sha256: f.sha256,
        data: encode(f.original!),
      })),
      readings: state.readings,
      scope: state.scope,
      completeness: state.completeness,
      events: state.events,
    }),
  ).buffer;
  bytes(data, IC_SESSION_LIMIT);
  await restoreIntercompany(data);
  return data;
}
export async function restoreIntercompany(data: ArrayBuffer) {
  bytes(data, IC_SESSION_LIMIT);
  const p: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(data),
  );
  if (
    !plain(p) ||
    !keys(p, [
      'format',
      'version',
      'files',
      'readings',
      'scope',
      'completeness',
      'events',
    ]) ||
    p.format !== 'tarasuf-intercompany-session' ||
    p.version !== IC_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 4
  )
    throw Error('IC_SESSION');
  const files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      !keys(f, ['name', 'sha256', 'data']) ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw Error('IC_SESSION');
    const file = await readIntercompanyFile(f.name, decode(f.data));
    if (file.sha256 !== f.sha256) throw Error('IC_SOURCE_HASH');
    files.push(file);
  }
  return replayIntercompany({
    files: files as IntercompanyInput['files'],
    readings: p.readings as IntercompanyInput['readings'],
    scope: p.scope as IntercompanyInput['scope'],
    completeness: p.completeness as IntercompanyInput['completeness'],
    events: p.events as IntercompanyInput['events'],
  });
}
type Value = string | number | null;
type Table = { name: string; headers: string[]; rows: Value[][] };
export async function exportIntercompany(
  input: IntercompanyInput,
  expected: IntercompanyResult,
) {
  const { state, result: r } = await replayIntercompany(input);
  if (JSON.stringify(r) !== JSON.stringify(expected))
    throw Error('IC_STALE_EXPORT');
  // Check cardinality before constructing expanded tables, then every actual
  // value before allocating ExcelJS. Evidence must never be silently truncated.
  const counts = [
    r.cells.length,
    r.inventory.length,
    r.pairs.reduce((n, p) => n + p.members.length, 0),
    r.events.reduce((n, e) => n + e.memberIds.length, 0),
  ];
  if (counts.some((n) => n + 1 > 1_048_576)) throw Error('IC_EXPORT_ROWS');
  const tables: Table[] = [];
  function table(name: string, headers: string[], rows: Value[][]) {
    tables.push({ name, headers, rows });
  }
  table(
    'Summary',
    ['Field', 'Value'],
    [
      ['Domain', 'intercompany-ledger'],
      ['Version', r.version],
      ['Claim', r.claim],
      ['Status', r.status],
      ['Decimals', r.decimals],
      ['Context', r.context],
      ...IC_SCOPE_FIELDS.map((k) => [k, r.scope[k]] as Value[]),
      ['Scope confirmed', String(r.scope.confirmed)],
      ['Completeness confirmed', String(r.completeness.confirmed)],
      ['Completeness reference', r.completeness.reference],
      ['Completeness reason', r.completeness.note],
    ],
  );
  for (const [side, entries] of [
    ['Left', r.left],
    ['Right', r.right],
  ] as const)
    table(
      `${side} entries`,
      [
        'Record ID',
        'Source row',
        'Transaction ID',
        'Counterparty transaction ID',
        'Account',
        'Dimensions',
        'Posting date',
        'Debit',
        'Credit',
        'Net',
      ],
      entries.map((e) => [
        e.id,
        e.row,
        e.transactionId,
        e.counterpartyTransactionId,
        e.account,
        e.dimensions,
        e.date,
        e.debit,
        e.credit,
        e.net,
      ]),
    );
  table(
    'Relations',
    [
      'Record ID',
      'Source row',
      'Relation ID',
      'Left ID',
      'Right ID',
      'Left account',
      'Left dimensions',
      'Right account',
      'Right dimensions',
      'Left posting date',
      'Right posting date',
      'Valid from',
      'Valid to',
      'Reference',
    ],
    r.relations.map((e) => [
      e.id,
      e.row,
      e.relationId,
      e.leftId,
      e.rightId,
      e.accountA,
      e.dimensionsA,
      e.accountB,
      e.dimensionsB,
      e.dateA,
      e.dateB,
      e.validFrom,
      e.validTo,
      e.reference,
    ]),
  );
  table(
    'Timing',
    [
      'Record ID',
      'Source row',
      'Evidence ID',
      'Side',
      'Transaction ID',
      'Counterparty transaction ID',
      'Counterparty posting date',
      'Expected counterparty amount',
      'Reference',
    ],
    r.timing.map((e) => [
      e.id,
      e.row,
      e.evidenceId,
      e.side,
      e.transactionId,
      e.counterpartyTransactionId,
      e.date,
      e.amount,
      e.reference,
    ]),
  );
  table(
    'Pairs',
    [
      'Relation ID',
      'Relation record ID',
      'Left record ID',
      'Right record ID',
      'Left net',
      'Right net',
      'Residual',
      'Status',
      'Review',
    ],
    r.pairs.map((p) => [
      p.relationId,
      p.relationRecord,
      p.left?.id ?? null,
      p.right?.id ?? null,
      p.left?.net ?? null,
      p.right?.net ?? null,
      p.residual,
      p.status,
      p.review,
    ]),
  );
  table(
    'Pair members',
    [
      'Relation ID',
      'Side',
      'Record ID',
      'Transaction ID',
      'Counterparty transaction ID',
      'Debit',
      'Credit',
      'Net',
    ],
    r.pairs.flatMap((p) =>
      p.members.map((e) => [
        p.relationId,
        e.side,
        e.id,
        e.transactionId,
        e.counterpartyTransactionId,
        e.debit,
        e.credit,
        e.net,
      ]),
    ),
  );
  table(
    'Totals',
    ['Side', 'Debit', 'Credit', 'Net'],
    r.totals
      ? r.totals.map((t, i) => [
          i === 0 ? 'left' : 'right',
          t.debit,
          t.credit,
          t.net,
        ])
      : [],
  );
  table(
    'Missing',
    ['Kind', 'Key'],
    r.missing.map((m) => [m.kind, m.key]),
  );
  table(
    'Issues',
    ['Code', 'Source', 'Source row', 'Key', 'Related'],
    r.issues.map((i) => [i.code, i.source, i.row, i.key, i.related]),
  );
  table(
    'Cell evidence',
    [
      'Source',
      'Hash',
      'Sheet',
      'Sheet name',
      'Source row',
      'Column',
      'Header',
      'Value',
    ],
    r.cells.map((c) => [
      c.source,
      r.sources[c.source].hash,
      0,
      r.sources[c.source].sheet,
      c.row,
      c.column,
      c.field,
      c.text,
    ]),
  );
  table(
    'Inventory',
    ['Source', 'Hash', 'Source row', 'Kind', 'Errors'],
    r.inventory.map((i) => [
      i.source,
      r.sources[i.source].hash,
      i.row,
      i.kind,
      i.errors.join('|'),
    ]),
  );
  table(
    'Reading',
    ['Source', 'Sheet', 'Role', 'Family', 'Confirmed'],
    r.readings.map((v, i) => [
      i,
      v.sheet,
      v.role,
      v.family,
      String(v.confirmed),
    ]),
  );
  table(
    'Events',
    [
      'Sequence',
      'Event ID',
      'Type',
      'Relation ID',
      'UTC time',
      'Reference',
      'Note',
      'Context',
    ],
    r.events.map((e, i) => [
      i + 1,
      e.id,
      e.type,
      e.relationId,
      e.at,
      e.reference,
      e.note,
      e.context,
    ]),
  );
  table(
    'Event members',
    ['Sequence', 'Event ID', 'Record ID'],
    r.events.flatMap((e, i) => e.memberIds.map((id) => [i + 1, e.id, id])),
  );
  table(
    'Sources',
    ['Source', 'Name', 'Hash', 'Chunk', 'Original base64'],
    state.files.flatMap((f, i) => {
      const data = encode(f.original!);
      const rows: Value[][] = [];
      for (let offset = 0; offset < data.length; offset += 30000)
        rows.push([
          i,
          f.name,
          f.sha256!,
          offset / 30000,
          data.slice(offset, offset + 30000),
        ]);
      return rows;
    }),
  );
  for (const t of tables) {
    if (t.rows.length + 1 > 1_048_576) throw Error('IC_EXPORT_ROWS');
    for (const row of [t.headers, ...t.rows])
      for (const v of row) {
        if (typeof v === 'number' && !Number.isSafeInteger(v))
          throw Error('IC_EXPORT_CELL');
        if (
          typeof v === 'string' &&
          (v.length > 32767 ||
            Array.from(v).some((c) => {
              const n = c.codePointAt(0)!;
              return (
                (n < 32 && ![9, 10, 13].includes(n)) ||
                (n >= 0xd800 && n <= 0xdfff) ||
                n === 0xfffe ||
                n === 0xffff
              );
            }))
        )
          throw Error('IC_EXPORT_CELL');
      }
  }
  const book = new ExcelJS.Workbook();
  for (const t of tables) {
    const sheet = book.addWorksheet(t.name);
    sheet.addRow(t.headers);
    for (const row of t.rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = t.headers.map(() => ({ width: 24 }));
  }
  const data = await book.xlsx.writeBuffer();
  return Uint8Array.from(new Uint8Array(data)).buffer;
}
