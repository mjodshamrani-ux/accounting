import {reconcilePayroll,type PayrollInput} from './payroll.ts';
import {reconcileAsset,type AssetInput} from './fixed-assets.ts';
import { reconcileStock, type StockInput } from './inventory-register.ts';
import { reconcileGateway, type GatewayInput } from './payment-gateway.ts';
import { reconcileIntercompany, type IntercompanyInput } from './intercompany.ts';
import {
  reconcileFinancialPosition,
  type FinancialInput,
} from './tb-financial.ts';
import { ENGINE_VERSION, MAX_ROWS, MAX_SHEETS } from './types.ts';
import type { SourceFile } from './types.ts';
import {
  registerNativeHeaderSource,
  validHeaderGeometry,
} from './header-view.ts';
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
  'clearing-reconcile',
  'clearing-save',
  'clearing-restore',
  'clearing-export',
  'ar-reconcile',
  'ar-save',
  'ar-restore',
  'ar-export',
  'bank-adjustment-reconcile',
  'bank-adjustment-save',
  'bank-adjustment-restore',
  'bank-adjustment-export',
  'bank-reconcile',
  'bank-save',
  'bank-restore',
  'bank-export',
  'allocation-reconcile',
  'allocation-save',
  'allocation-restore',
  'allocation-export',
  'gateway-read',
  'payroll-read',
  'payroll-reconcile',
  'payroll-save',
  'payroll-restore',
  'payroll-export',
  'asset-read',
  'asset-reconcile',
  'asset-save',
  'asset-restore',
  'asset-export',
  'stock-read',
  'stock-reconcile',
  'stock-save',
  'stock-restore',
  'stock-export',
  'gateway-reconcile',
  'gateway-save',
  'gateway-restore',
  'gateway-export',
  'intercompany-read',
  'intercompany-reconcile',
  'intercompany-save',
  'intercompany-restore',
  'intercompany-export',
  'tb-financial-reconcile',
  'tb-financial-save',
  'tb-financial-restore',
  'tb-financial-export',
  'gl-tb-reconcile',
  'gl-tb-save',
  'gl-tb-restore',
  'gl-tb-export',
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
        !Array.isArray(sheet.hiddenRows) ||
        !validHeaderGeometry(sheet as SourceFile['sheets'][number]),
    )
  )
    throw new Error(
      'لم يُرجع قارئ الملفات جدولًا صالحًا، وأُعيد تجهيزه. أعد اختيار الملف.',
    );
}
export function validateWorkerValue(
  action: string,
  value: unknown,
  payload: unknown,
) {
  if (value === undefined || value === null)
    throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
  if (
    action === 'ready' &&
    (!isRecord(value) ||
      value.ready !== true ||
      value.engine !== ENGINE_VERSION)
  )
    throw new Error('إصدار قارئ الملفات لا يطابق إصدار الصفحة. أعد فتح الموقع.');
  if (
    action === 'gateway-save' ||
    action === 'payroll-save' || action === 'payroll-export' ||
    action === 'asset-save' || action === 'asset-export' ||
    action === 'stock-save' || action === 'stock-export' ||
    action === 'gateway-export' ||
    action === 'intercompany-save' ||
    action === 'intercompany-export' ||
    action === 'tb-financial-save' ||
    action === 'tb-financial-export' ||
    action === 'bank-adjustment-save' ||
    action === 'bank-adjustment-export'
  ) {
    if (
      !(value instanceof ArrayBuffer) ||
      !value.byteLength ||
      value.byteLength > 96 * 1024 * 1024
    )
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
  }
  if (
    action === 'bank-adjustment-reconcile' ||
    action === 'bank-adjustment-restore'
  ) {
    if (
      !isRecord(value) ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.result.version !== 'bank-adjustment-ledger-1' ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.result.endpoints) ||
      value.result.endpoints.length !== 2 ||
      !Array.isArray(value.result.events) ||
      !Array.isArray(value.result.lifecycles) ||
      !isRecord(value.state.balance) ||
      !isRecord(value.state.balance.bank) ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 2 ||
      !Array.isArray(value.state.balance.files) ||
      value.state.balance.files.length !== 2 ||
      !Array.isArray(value.state.balance.bank.files) ||
      value.state.balance.bank.files.length !== 2
    )
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    for (const file of [
      ...value.state.files,
      ...value.state.balance.files,
      ...value.state.balance.bank.files,
    ]) {
      assertSourceFile(file);
      if (
        !(file.original instanceof ArrayBuffer) ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
      )
        throw new Error(
          'استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.',
        );
    }
  }
  if (
    action === 'tb-financial-reconcile' ||
    action === 'tb-financial-restore'
  ) {
    if (
      !isRecord(value) ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.result.version !== 'tb-financial-position-1' ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 4 ||
      !Array.isArray(value.result.lines) ||
      !Array.isArray(value.result.events) ||
      !Array.isArray(value.result.inventory) ||
      !Array.isArray(value.result.issues) ||
      !Array.isArray(value.result.missing)
    )
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    for (const file of value.state.files) {
      assertSourceFile(file);
      if (
        !(file.original instanceof ArrayBuffer) ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
      )
        throw new Error(
          'استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.',
        );
    }
    // Independently rebuild the envelope from the returned bounded source
    // inventory before installation. Public actions still reread original bytes
    // in IO; this guard is not source authenticity or an accounting approval.
    try {
      if (
        JSON.stringify(
          reconcileFinancialPosition(value.state as unknown as FinancialInput),
        ) !== JSON.stringify(value.result)
      )
        throw Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (
    action === 'intercompany-reconcile' ||
    action === 'intercompany-restore'
  ) {
    if (
      !isRecord(value) ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.result.version !== 'intercompany-ledger-1' ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 4 ||
      !Array.isArray(value.result.pairs) ||
      !Array.isArray(value.result.events) ||
      !Array.isArray(value.result.inventory) ||
      !Array.isArray(value.result.issues) ||
      !Array.isArray(value.result.missing)
    )
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    for (const file of value.state.files) {
      assertSourceFile(file);
      if (
        !(file.original instanceof ArrayBuffer) ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
      )
        throw new Error(
          'استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.',
        );
    }
    // Independently rebuild the envelope from the returned bounded source
    // inventory before installation. Public actions still reread original bytes
    // in IO; this guard is not source authenticity or an accounting approval.
    try {
      if (
        JSON.stringify(
          reconcileIntercompany(value.state as unknown as IntercompanyInput),
        ) !== JSON.stringify(value.result)
      )
        throw Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (
    action === 'gateway-reconcile' ||
    action === 'gateway-restore'
  ) {
    if (
      !isRecord(value) ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.result.version !== 'payment-gateway-batch-1' ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 4 ||
      !Array.isArray(value.result.records) ||
      !Array.isArray(value.result.events) ||
      !Array.isArray(value.result.inventory) ||
      !Array.isArray(value.result.issues) ||
      !Array.isArray(value.result.missing)
    )
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    for (const file of value.state.files) {
      assertSourceFile(file);
      if (
        !(file.original instanceof ArrayBuffer) ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
      )
        throw new Error(
          'استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.',
        );
    }
    // Independently rebuild the envelope from the returned bounded source
    // inventory before installation. Public actions still reread original bytes
    // in IO; this guard is not source authenticity or an accounting approval.
    try {
      if (
        JSON.stringify(
          reconcileGateway(value.state as unknown as GatewayInput),
        ) !== JSON.stringify(value.result)
      )
        throw Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'payroll-reconcile' || action === 'payroll-restore') {
    try { if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.result) || JSON.stringify(reconcilePayroll(value.state as unknown as PayrollInput)) !== JSON.stringify(value.result)) throw Error('PAYROLL_ENVELOPE'); }
    catch { throw Error('PAYROLL_ENVELOPE'); }
  }
  if (action === 'asset-reconcile' || action === 'asset-restore') {
    try { if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.result) || JSON.stringify(reconcileAsset(value.state as unknown as AssetInput)) !== JSON.stringify(value.result)) throw Error('ASSET_ENVELOPE'); }
    catch { throw Error('ASSET_ENVELOPE'); }
  }
  if (action === 'stock-reconcile' || action === 'stock-restore') {
    try { if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.result) || JSON.stringify(reconcileStock(value.state as unknown as StockInput)) !== JSON.stringify(value.result)) throw Error('STOCK_ENVELOPE'); }
    catch { throw Error('STOCK_ENVELOPE'); }
  }
  if (action === 'read' || action === 'intercompany-read' || action === 'gateway-read' || action === 'stock-read' || action === 'asset-read' || action === 'payroll-read') {
    assertSourceFile(value);
    if (
      !isRecord(payload) ||
      value.name !== payload.name ||
      !(value.original instanceof ArrayBuffer) ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')
    )
      throw new Error(
        'استجابة قارئ الملفات لا تطابق الملف المرفوع. أعد اختيار الملف.',
      );
    registerNativeHeaderSource(value);
  }
  if (
    action === 'restore-session' &&
    isRecord(value) &&
    Array.isArray(value.files)
  ) {
    for (const file of value.files) {
      assertSourceFile(file);
      registerNativeHeaderSource(file);
    }
  }
}
