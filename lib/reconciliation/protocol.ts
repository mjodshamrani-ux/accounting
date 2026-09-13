import { ENGINE_VERSION, MAX_ROWS, MAX_SHEETS } from './types.ts';
import type { SourceFile } from './types.ts';
export const WORKER_CHANNEL = 'mizan-accounting-v1';
export const WORKER_ACTIONS = [
  'ready',
  'read',
  'save-session',
  'restore-session',
  'reconcile',
  'compare',
  'normalize',
  'export',
] as const;
export type WorkerAction = (typeof WORKER_ACTIONS)[number];
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function isRequest(value: unknown): value is {
  channel: string;
  id: number;
  action: WorkerAction;
  payload: unknown;
} {
  return (
    isRecord(value) &&
    value.channel === WORKER_CHANNEL &&
    Number.isSafeInteger(value.id) &&
    (value.id as number) > 0 &&
    WORKER_ACTIONS.includes(value.action as WorkerAction) &&
    Object.hasOwn(value, 'payload')
  );
}
export function assertSourceFile(value: unknown): asserts value is SourceFile {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.sheets) ||
    !value.sheets.length ||
    value.sheets.length > MAX_SHEETS ||
    value.sheets.some(
      (sheet) =>
        !isRecord(sheet) ||
        typeof sheet.name !== 'string' ||
        !Array.isArray(sheet.rows) ||
        sheet.rows.length > MAX_ROWS + 30 ||
        sheet.rows.some(
          (row: unknown) =>
            !Array.isArray(row) ||
            row.length > 100 ||
            row.some((cell) => typeof cell !== 'string'),
        ) ||
        !Array.isArray(sheet.formulaRows) ||
        !Array.isArray(sheet.hiddenRows),
    )
  )
    throw new Error(
      'لم يُرجع قارئ الملفات جدولًا صالحًا. أُعيد تجهيز القارئ؛ أعد اختيار الملف.',
    );
}
export function validateWorkerValue(
  action: string,
  value: unknown,
  payload: unknown,
) {
  if (value === undefined || value === null)
    throw new Error('رد المعالجة المحلية غير مكتمل؛ أعد اختيار الملف.');
  if (
    action === 'ready' &&
    (!isRecord(value) ||
      value.ready !== true ||
      value.engine !== ENGINE_VERSION)
  )
    throw new Error('إصدار قارئ الملفات لا يطابق الصفحة؛ أعد فتح الموقع.');
  if (action === 'read') {
    assertSourceFile(value);
    if (
      !isRecord(payload) ||
      value.name !== payload.name ||
      !(value.original instanceof ArrayBuffer) ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')
    )
      throw new Error(
        'رد قارئ الملفات لا يطابق المصدر المرفوع؛ أعد اختيار الملف.',
      );
  }
}
