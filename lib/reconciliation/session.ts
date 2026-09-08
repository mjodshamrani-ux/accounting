import { ENGINE_VERSION, MAX_FILE_BYTES } from './types.ts';
import type {
  SourceFile,
  Mapping,
  Scope,
  Decision,
  AuditEvent,
} from './types.ts';
import { readFile } from './io.ts';
import { compare, normalizeSource } from './core.ts';
export type SessionState = {
  files: [SourceFile, SourceFile];
  mappings: [Mapping, Mapping];
  scope: Scope;
  decisions: Decision[];
  rejected: string[];
  events: AuditEvent[];
  review: { name: string; notes: string; checked: boolean };
};
const encode = (b: ArrayBuffer) => {
  let s = '';
  for (const byte of new Uint8Array(b)) s += String.fromCharCode(byte);
  return btoa(s);
};
const decode = (s: string) => {
  if (
    s.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(s)
  )
    throw new Error('حجم أو ترميز مصدر الجلسة غير صالح');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
};
const demoBytes = (file: SourceFile) =>
  new TextEncoder().encode(
    file.sheets[0].rows
      .map((row) => row.map((c) => '"' + c.replace(/"/g, '""') + '"').join(','))
      .join('\n'),
  ).buffer;
export async function saveSession(state: SessionState): Promise<ArrayBuffer> {
  if (state.events.length > 2000)
    throw new Error('سجل الجلسة كبير؛ صدّر ورقة العمل');
  const files = await Promise.all(
    state.files.map(async (f) => {
      const original = f.original ?? demoBytes(f);
      const name = f.original
        ? f.name
        : f.name.replace(/\.[^.]+$/, '') + '.csv';
      const checked = await readFile(name, original, f.pdf?.cuts);
      return {
        name,
        sha256: checked.sha256,
        data: encode(original),
        ...(f.pdf ? { pdfCuts: f.pdf.cuts } : {}),
      };
    }),
  );
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'mizan-session',
      version: 1,
      engine: ENGINE_VERSION,
      files,
      mappings: state.mappings,
      scope: state.scope,
      decisions: state.decisions,
      rejected: state.rejected,
      events: state.events,
      review: state.review,
    }),
  ).buffer;
  if (bytes.byteLength > 30 * 1024 * 1024)
    throw new Error('حجم الجلسة يتجاوز 30 MB');
  // A session must be restorable and independently recomputable before it can be saved.
  await restoreSession(bytes);
  return bytes;
}
export async function restoreSession(bytes: ArrayBuffer) {
  if (bytes.byteLength > 30 * 1024 * 1024)
    throw new Error('حجم الجلسة يتجاوز 30 MB');
  const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !p ||
    p.format !== 'mizan-session' ||
    p.version !== 1 ||
    p.engine !== ENGINE_VERSION
  )
    throw new Error('إصدار الجلسة غير متوافق؛ استخدم ملفات المصدر الأصلية');
  if (
    !Array.isArray(p.files) ||
    p.files.length !== 2 ||
    !Array.isArray(p.mappings) ||
    p.mappings.length !== 2 ||
    !Array.isArray(p.decisions) ||
    p.decisions.length > 20000 ||
    !Array.isArray(p.rejected) ||
    p.rejected.length > 20000 ||
    !p.rejected.every((x: unknown) => typeof x === 'string') ||
    !Array.isArray(p.events) ||
    p.events.length > 2000
  )
    throw new Error('بنية الجلسة غير صالحة');
  const files = (await Promise.all(
    p.files.map(
      async (f: {
        name: unknown;
        data: unknown;
        sha256: unknown;
        pdfCuts?: number[];
      }) => {
        if (
          typeof f.name !== 'string' ||
          f.name.length > 255 ||
          typeof f.data !== 'string' ||
          typeof f.sha256 !== 'string'
        )
          throw new Error('مصدر الجلسة غير صالح');
        const read = await readFile(f.name, decode(f.data), f.pdfCuts);
        if (read.sha256 !== f.sha256)
          throw new Error('بصمة مصدر الجلسة غير مطابقة');
        return read;
      },
    ),
  )) as [SourceFile, SourceFile];
  if (
    !p.review ||
    typeof p.review.name !== 'string' ||
    p.review.name.length > 200 ||
    typeof p.review.notes !== 'string' ||
    p.review.notes.length > 3000
  )
    throw new Error('مراجعة الجلسة غير صالحة');
  const result = compare(
    normalizeSource(files[0], p.mappings[0], p.scope, 'supplier'),
    normalizeSource(files[1], p.mappings[1], p.scope, 'ledger'),
    p.scope,
    p.decisions,
    p.rejected,
  );
  const ids = new Set(
    [...result.supplier.transactions, ...result.ledger.transactions].map(
      (t) => t.id,
    ),
  );
  for (const e of p.events)
    if (
      !e ||
      !['compare', 'link', 'unlink', 'review'].includes(e.action) ||
      typeof e.time !== 'string' ||
      !Number.isFinite(Date.parse(e.time)) ||
      typeof e.note !== 'string' ||
      e.note.length > 1000 ||
      !Array.isArray(e.ids) ||
      !e.ids.every((id: unknown) => typeof id === 'string' && ids.has(id))
    )
      throw new Error('حدث مراجعة غير صالح');
  return {
    files,
    mappings: p.mappings as [Mapping, Mapping],
    scope: p.scope as Scope,
    decisions: p.decisions as Decision[],
    rejected: p.rejected as string[],
    events: p.events as AuditEvent[],
    review: { name: p.review.name, notes: p.review.notes, checked: false },
    result,
  };
}
