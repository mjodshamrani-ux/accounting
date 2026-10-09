import ExcelJS from 'exceljs';
import { readFile } from './io.ts';
import { MAX_FILE_BYTES, type SourceFile } from './types.ts';
import {
  ALLOCATION_VERSION,
  ALLOCATION_SCOPE_FIELDS,
  reconcileAllocation,
  type AllocationInput,
  type AllocationResult,
  type AllocationLink,
} from './allocation.ts';
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function bytes(v: unknown): asserts v is ArrayBuffer {
  if (
    !(v instanceof ArrayBuffer) ||
    !v.byteLength ||
    v.byteLength > MAX_FILE_BYTES
  )
    throw new Error('ALLOCATION_SOURCE');
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
    throw new Error('ALLOCATION_SESSION');
  const buffer = Uint8Array.from(atob(v), (c) => c.charCodeAt(0)).buffer;
  bytes(buffer);
  if (encode(buffer) !== v) throw new Error('ALLOCATION_SESSION');
  return buffer;
}
function boundedJson(value: unknown, limit: number): string {
  let budget = 0, nodes = 0;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number) {
    if (++nodes > 4_000_000 || depth > 12) throw Error('ALLOCATION_INPUT_BUDGET');
    if (typeof item === 'string') budget += item.length * 6 + 2;
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null || item === undefined) budget += 24;
    else if (typeof item === 'object') {
      if (seen.has(item)) throw Error('ALLOCATION_INPUT_BUDGET');
      seen.add(item);
      if (Array.isArray(item)) {
        if (item.length > 60000) throw Error('ALLOCATION_INPUT_BUDGET');
        for (const child of item) visit(child, depth + 1);
      } else {
        const entries = Object.entries(item);
        if (entries.length > 32) throw Error('ALLOCATION_INPUT_BUDGET');
        for (const [key, child] of entries) { budget += key.length * 6 + 4; visit(child, depth + 1); }
      }
      seen.delete(item);
    } else throw Error('ALLOCATION_INPUT_BUDGET');
    if (budget > limit) throw Error('ALLOCATION_INPUT_BUDGET');
  }
  visit(value, 0);
  return JSON.stringify(value);
}
function captureAllocationInput(input: AllocationInput, signal?: AbortSignal) {
  if (signal?.aborted) throw Error('ALLOCATION_CANCELLED');
  if (
    !plain(input) ||
    Object.keys(input).sort().join('|') !== 'events|files|readings|scope' ||
    !Array.isArray(input.files) ||
    input.files.length !== 3
  )
    throw new Error('ALLOCATION_INPUT');
  for (const source of input.files) {
    if (
      !plain(source) ||
      source.kind !== undefined ||
      typeof source.name !== 'string' ||
      source.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(source.name)
    )
      throw new Error('ALLOCATION_SOURCE');
    bytes(source.original);
  }
  if (!Array.isArray(input.readings) || input.readings.length !== 3 ||
      !Array.isArray(input.events) || input.events.length > 1000 ||
      input.events.some((event) => event.type === 'allocate' && (!Array.isArray(event.links) || event.links.length > 100)))
    throw Error('ALLOCATION_INPUT_BUDGET');
  const contextStamp = (value: AllocationInput) => boundedJson([
    value.files.map((f) => [f.name, f.kind, f.sha256, f.original?.byteLength]),
    value.readings, value.scope, value.events,
  ], 48 * 1024 * 1024);
  const initial = contextStamp(input);
  // Own the complete decision context before the first asynchronous native read.
  // A caller edit must never mix fresh decisions with an older source snapshot.
  // Cached sheets are never authority and are deliberately not copied. Native
  // replay owns only the bounded original bytes and decision metadata.
  const nativeOnly = (f: SourceFile): SourceFile => ({
    name: f.name, kind: f.kind, sha256: f.sha256, original: f.original, sheets: [],
  });
  const owned: AllocationInput = structuredClone({
    files: [nativeOnly(input.files[0]), nativeOnly(input.files[1]), nativeOnly(input.files[2])],
    readings: input.readings, scope: input.scope, events: input.events,
  });
  const assertCurrent = () => {
    if (signal?.aborted) throw Error('ALLOCATION_CANCELLED');
    if (contextStamp(input) !== initial) throw Error('ALLOCATION_INPUT_CHANGED');
    for (const [index, source] of input.files.entries()) {
      bytes(source.original);
      const current = new Uint8Array(source.original),
        captured = new Uint8Array(owned.files[index].original!);
      if (current.length !== captured.length || current.some((v, i) => v !== captured[i]))
        throw Error('ALLOCATION_INPUT_CHANGED');
    }
  };
  assertCurrent();
  return { owned, assertCurrent };
}
async function replayCapturedAllocation({ owned, assertCurrent }: ReturnType<typeof captureAllocationInput>) {
  const files = [];
  for (const source of owned.files) {
    if (!source.original) throw new Error('ALLOCATION_NATIVE_SOURCE');
    const file = await readFile(source.name, source.original);
    assertCurrent();
    if (file.sha256 !== source.sha256)
      throw new Error('ALLOCATION_SOURCE_HASH');
    files.push(file);
  }
  const state: AllocationInput = {
    files: files as AllocationInput['files'],
    readings: owned.readings,
    scope: owned.scope,
    events: owned.events,
  };
  const result = reconcileAllocation(state);
  assertCurrent();
  return { state, result };
}
export async function replayAllocation(input: AllocationInput, signal?: AbortSignal) {
  return replayCapturedAllocation(captureAllocationInput(input, signal));
}
export async function saveAllocation(
  input: AllocationInput,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const captured = captureAllocationInput(input, signal);
  const { state } = await replayCapturedAllocation(captured);
  const session = new TextEncoder().encode(
    JSON.stringify({
      format: 'tarasuf-allocation-session',
      version: ALLOCATION_VERSION,
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
  if (session.byteLength > 48 * 1024 * 1024)
    throw new Error('ALLOCATION_SESSION');
  await restoreAllocation(session);
  captured.assertCurrent();
  return session;
}
export async function restoreAllocation(session: ArrayBuffer) {
  if (
    !(session instanceof ArrayBuffer) ||
    !session.byteLength ||
    session.byteLength > 48 * 1024 * 1024
  )
    throw new Error('ALLOCATION_SESSION');
  const p = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(session),
  );
  if (
    !plain(p) ||
    Object.keys(p).sort().join('|') !==
      'events|files|format|readings|scope|version' ||
    p.format !== 'tarasuf-allocation-session' ||
    p.version !== ALLOCATION_VERSION ||
    !Array.isArray(p.files) ||
    p.files.length !== 3
  )
    throw new Error('ALLOCATION_SESSION');
  const files = [];
  for (const f of p.files) {
    if (
      !plain(f) ||
      Object.keys(f).sort().join('|') !== 'data|name|sha256' ||
      typeof f.name !== 'string' ||
      f.name.length > 255 ||
      !/\.(csv|xlsx)$/i.test(f.name)
    )
      throw new Error('ALLOCATION_SESSION');
    const file = await readFile(f.name, decode(f.data));
    if (file.sha256 !== f.sha256) throw new Error('ALLOCATION_SOURCE_HASH');
    files.push(file);
  }
  return replayAllocation({
    files: files as AllocationInput['files'],
    readings: p.readings as AllocationInput['readings'],
    scope: p.scope as AllocationInput['scope'],
    events: p.events as AllocationInput['events'],
  });
}

/** All decisions, including undone ones, retain separate link and evidence rows. */
export async function exportAllocation(
  input: AllocationInput,
  expected: AllocationResult,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const captured = captureAllocationInput(input, signal);
  const expectedStamp = boundedJson(expected, 192 * 1024 * 1024);
  const { state, result } = await replayCapturedAllocation(captured);
  if (boundedJson(expected, 192 * 1024 * 1024) !== expectedStamp)
    throw Error('ALLOCATION_EXPECTED_CHANGED');
  if (JSON.stringify(result) !== JSON.stringify(expected))
    throw new Error('ALLOCATION_STALE_RESULT');
  const book = new ExcelJS.Workbook();
  book.creator = 'Tarasuf';
  function table(name: string, header: string[], rows: (string | number)[][]) {
    if (
      rows.some((r) =>
        r.some(
          (v) =>
            typeof v === 'string' &&
            (v.length > 32767 ||
              Array.from(v).some((c) => {
                const n = c.codePointAt(0)!;
                return (
                  n <= 8 ||
                  n === 11 ||
                  n === 12 ||
                  (n >= 14 && n <= 31) ||
                  n === 65534 ||
                  n === 65535
                );
              })),
        ),
      )
    )
      throw new Error('ALLOCATION_EXPORT_CELL');
    const s = book.addWorksheet(name);
    s.addRow(header);
    s.addRows(rows);
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
      ['Domain', 'payment-allocation'],
      ['Version', result.version],
      ['Status', result.status],
      ['Decimals', result.decimals],
      ...ALLOCATION_SCOPE_FIELDS.map((k) => [k, result.scope[k]]),
      ['Confirmed', String(result.scope.confirmed)],
      ['Context', result.context],
      [
        'Claim',
        'Proposed allocation against declared pre-allocation capacities; no ERP posting or source authenticity assurance',
      ],
    ],
  );
  const balanceById = new Map(result.balances.map((b) => [b.id, b]));
  table(
    'Value ledger',
    [
      'ID',
      'Side',
      'Source row',
      'Own reference',
      'Date',
      'Original minor units',
      'Available minor units',
      'Allocated minor units',
      'Remaining minor units',
    ],
    result.items.map((i) => {
      const b = balanceById.get(i.id)!;
      return [
        i.id,
        i.side,
        i.row,
        i.reference,
        i.date,
        b.original,
        b.available,
        b.allocated,
        b.remaining,
      ];
    }),
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
    result.items.flatMap((i) =>
      i.traces.map((t) => [
        i.id,
        i.side,
        i.row,
        t.field,
        t.column,
        t.text,
        t.amount,
      ]),
    ),
  );
  table(
    'Remittance evidence',
    [
      'ID',
      'Source row',
      'Own reference',
      'Payment reference',
      'Invoice reference',
      'Amount minor units',
      'Source column',
      'Original text',
    ],
    result.proofs.map((p) => [
      p.id,
      p.row,
      p.reference,
      p.payment,
      p.invoice,
      p.amount,
      p.column,
      p.text,
    ]),
  );
  const linkHeader = [
    'Decision',
    'Index',
    'Payment ID',
    'Invoice ID',
    'Amount minor units',
    'Basis',
    'Basis reference',
    'Reason',
    'Proof ID',
  ];
  const linkRows = (decision: string, links: AllocationLink[]) =>
    links.map((l, i) => [
      decision,
      i,
      l.paymentId,
      l.invoiceId,
      l.amount,
      l.basis.kind,
      l.basis.reference,
      l.basis.reason,
      l.basis.proofId,
    ]);
  table(
    'Decision links',
    linkHeader,
    result.events.flatMap((e) =>
      e.type === 'allocate' ? linkRows(e.id, e.links) : [],
    ),
  );
  table(
    'Active links',
    linkHeader,
    result.activeDecisions.flatMap((id) => {
      const e = result.events.find((e) => e.id === id)!;
      return e.type === 'allocate' ? linkRows(id, e.links) : [];
    }),
  );
  table(
    'Events',
    [
      'ID',
      'Type',
      'UTC device time',
      'Context',
      'Note',
      'Undo target',
      'Active',
    ],
    result.events.map((e) => [
      e.id,
      e.type,
      e.at,
      e.context,
      e.note,
      e.type === 'undo' ? e.target : '',
      String(result.activeDecisions.includes(e.id)),
    ]),
  );
  table(
    'Inventory',
    ['Side', 'Source row', 'Kind', 'Error', 'Raw values JSON'],
    result.inventory.map((i) => [
      i.side,
      i.row,
      i.kind,
      i.error ?? '',
      JSON.stringify(i.values),
    ]),
  );
  table(
    'Reading',
    ['Side', 'Field', 'Value'],
    state.readings.flatMap((r, side) =>
      Object.entries(r).map(([k, v]) => [side, k, String(v)]),
    ),
  );
  const sources: (string | number)[][] = [];
  state.files.forEach((f, side) => {
    const raw = encode(f.original!);
    for (let i = 0; i < raw.length; i += 30000)
      sources.push([
        side,
        state.readings[side].role,
        f.name,
        f.sha256!,
        f.sheets[state.readings[side].sheet].name,
        i / 30000 + 1,
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
  const output = new Uint8Array(await book.xlsx.writeBuffer()).buffer;
  captured.assertCurrent();
  if (boundedJson(expected, 192 * 1024 * 1024) !== expectedStamp)
    throw Error('ALLOCATION_EXPECTED_CHANGED');
  return output;
}
