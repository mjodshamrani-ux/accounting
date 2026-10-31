import {
  BANK_STATEMENT_EXPORT_LIMIT,
  BANK_STATEMENT_LIFECYCLE_VERSION,
  BANK_STATEMENT_ROLL_VERSION,
  BANK_STATEMENT_SESSION_LIMIT,
  BANK_STATEMENT_SHEET_VERSION,
} from './bank-statement-request.ts';
import {
  STOCK_PDF_LIFECYCLE_VERSION,
  STOCK_PDF_SESSION_LIMIT,
  STOCK_PDF_EXPORT_LIMIT,
} from './inventory-pdf-request.ts';
import { reconcilePayroll, type PayrollInput } from './payroll.ts';
import { reconcileGlTb, type GlTbInput } from './gl-tb.ts';
import { reconcileAsset, type AssetInput } from './fixed-assets.ts';
import { reconcileStock, type StockInput } from './inventory-register.ts';
import { reconcileGateway, type GatewayInput } from './payment-gateway.ts';
import {
  reconcileIntercompany,
  type IntercompanyInput,
} from './intercompany.ts';
import {
  IC_BATCH_VERSION,
  reconcileIntercompanyBatches,
  type IntercompanyBatchInput,
} from './intercompany-batch.ts';
import {
  reconcileFinancialPosition,
  type FinancialInput,
} from './tb-financial.ts';
import {
  GLS_VERSION,
  reconcileGlTbSections,
  type GlsInput,
} from './gl-tb-sections.ts';
import {
  FINH_VERSION,
  reconcileFinancialHierarchy,
  type FinHInput,
} from './tb-financial-hierarchy.ts';
import {
  PLR_VERSION,
  reconcileLongRegister,
  type PlrInput,
} from './payroll-long-register.ts';
import {
  IMB_VERSION,
  reconcileMovementBridge,
  type ImbInput,
} from './inventory-movement-bridge.ts';
import {
  CLEARING_GROUPS_VERSION,
  groupClearing,
  type ClearingGroupsInput,
} from './clearing-groups.ts';
import {
  ENGINE_VERSION,
  MAX_ROWS,
  MAX_SHEETS,
  MAX_FILE_BYTES,
} from './types.ts';
import {
  ALLOCATION_ADVICE_VERSION,
  reviewAllocationAdvice,
} from './allocation-advice.ts';
import type { AllocationResult } from './allocation.ts';
import {
  PG_BATCHES_ROLES,
  PG_BATCHES_VERSION,
  reviewGatewayBatches,
  type GatewayBatchesInput,
} from './payment-gateway-batches.ts';
import {
  FA_SECTIONS_ROLES,
  reviewAssetSections,
  type AssetSectionsInput,
} from './fixed-assets-sections.ts';
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
  'bank-statement-reconcile',
  'bank-statement-save',
  'bank-statement-restore',
  'bank-statement-export',
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
  'stock-pdf-reconcile',
  'stock-pdf-save',
  'stock-pdf-restore',
  'stock-pdf-export',
  'stock-pdf-read',
  'stock-pdf-ask',
  'stock-read',
  'stock-reconcile',
  'stock-save',
  'stock-restore',
  'stock-export',
  'stock-links-export',
  'gateway-reconcile',
  'gateway-save',
  'gateway-restore',
  'gateway-export',
  'intercompany-read',
  'intercompany-reconcile',
  'intercompany-save',
  'intercompany-restore',
  'intercompany-export',
  'intercompany-batch-reconcile',
  'tb-financial-reconcile',
  'tb-financial-save',
  'tb-financial-restore',
  'tb-financial-export',
  'gl-tb-reconcile',
  'gl-tb-save',
  'gl-tb-restore',
  'gl-tb-export',
  'gl-tb-sections-reconcile',
  'tb-financial-hierarchy-reconcile',
  'payroll-long-register-reconcile',
  'inventory-movement-bridge-reconcile',
  'clearing-groups-reconcile',
  'allocation-advice-review',
  'payment-gateway-batches-reconcile',
  'fixed-assets-sections-review',
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
    (!(
      typeof value.action === 'string' &&
      (value.action.startsWith('ar-') ||
        value.action.startsWith('stock-pdf-') ||
        value.action.startsWith('bank-statement-'))
    ) ||
      Object.keys(value).sort().join('|') === 'action|channel|id|payload') &&
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
  // Async original replay and exact equality are enforced by the client binding.
  // This synchronous transport check never treats the returned PDF cache as truth.
  if (action === 'stock-pdf-save' || action === 'stock-pdf-export') {
    if (
      !(value instanceof ArrayBuffer) ||
      !value.byteLength ||
      value.byteLength >
        (action === 'stock-pdf-save'
          ? STOCK_PDF_SESSION_LIMIT
          : STOCK_PDF_EXPORT_LIMIT)
    )
      throw Error('STOCK_PDF_ENVELOPE');
  }
  if (action === 'stock-pdf-reconcile' || action === 'stock-pdf-restore') {
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join('|') !== 'result|state|version' ||
      value.version !== STOCK_PDF_LIFECYCLE_VERSION ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.state.version !== STOCK_PDF_LIFECYCLE_VERSION ||
      value.result.version !== 'inventory-posted-register-gl-1' ||
      typeof value.result.context !== 'string' ||
      !isRecord(value.result.pdfEvidence)
    )
      throw Error('STOCK_PDF_ENVELOPE');
  }
  // The client binding replays the captured originals and installs only its
  // own result; this checks the transport shape alone.
  if (action === 'bank-statement-save' || action === 'bank-statement-export') {
    if (
      !(value instanceof ArrayBuffer) ||
      !value.byteLength ||
      value.byteLength >
        (action === 'bank-statement-save'
          ? BANK_STATEMENT_SESSION_LIMIT
          : BANK_STATEMENT_EXPORT_LIMIT)
    )
      throw Error('BANK_STATEMENT_ENVELOPE');
  }
  if (
    action === 'bank-statement-reconcile' ||
    action === 'bank-statement-restore'
  ) {
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join('|') !== 'result|state' ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      ![
        BANK_STATEMENT_LIFECYCLE_VERSION,
        BANK_STATEMENT_ROLL_VERSION,
        BANK_STATEMENT_SHEET_VERSION,
      ].includes(
        value.state.version as string,
      ) ||
      value.result.version !== value.state.version ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 2 ||
      value.state.files.some(
        (file) =>
          !isRecord(file) ||
          !(file.original instanceof ArrayBuffer) ||
          !file.original.byteLength ||
          file.original.byteLength > MAX_FILE_BYTES,
      )
    )
      throw Error('BANK_STATEMENT_ENVELOPE');
  }
  if (action === 'ar-save' || action === 'ar-export') {
    if (
      !(value instanceof ArrayBuffer) ||
      !value.byteLength ||
      value.byteLength > (action === 'ar-save' ? 32 : 96) * 1024 * 1024
    )
      throw Error('AR_WORKER_ENVELOPE');
  }
  if (action === 'ar-reconcile' || action === 'ar-restore') {
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join('|') !== 'result|state' ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      !['ar-limited-1', 'ar-scope-details-1', 'ar-statement-pdf-1'].includes(
        value.result.version as string,
      ) ||
      typeof value.result.context !== 'string' ||
      value.result.context.length > 65536 ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 2 ||
      !Array.isArray(value.state.readings) ||
      value.state.readings.length !== 2 ||
      !Array.isArray(value.state.events) ||
      value.state.events.length > 1000 ||
      !Array.isArray(value.result.rows) ||
      value.result.rows.length > 2 * MAX_ROWS ||
      !Array.isArray(value.result.inventory) ||
      value.result.inventory.length > 2 * (MAX_ROWS + 30) ||
      !Array.isArray(value.result.cases) ||
      value.result.cases.length > 2 * MAX_ROWS
    )
      throw Error('AR_WORKER_ENVELOPE');
    for (const file of value.state.files as unknown[]) {
      // A printed statement carries its reading, not a table; the client
      // binding replays both from the originals.
      if (!isRecord(file)) throw Error('AR_WORKER_ENVELOPE');
      if (file.kind !== 'ar-statement-pdf') assertSourceFile(file);
      if (
        !(file.original instanceof ArrayBuffer) ||
        !file.original.byteLength ||
        file.original.byteLength > MAX_FILE_BYTES ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256)
      )
        throw Error('AR_WORKER_ENVELOPE');
    }
  }
  if (
    action === 'ready' &&
    (!isRecord(value) ||
      value.ready !== true ||
      value.engine !== ENGINE_VERSION)
  )
    throw new Error('إصدار قارئ الملفات لا يطابق إصدار الصفحة. أعد فتح الموقع.');
  if (action === 'gl-tb-save' || action === 'gl-tb-export') {
    if (
      !(value instanceof ArrayBuffer) ||
      !value.byteLength ||
      value.byteLength > (action === 'gl-tb-save' ? 32 : 96) * 1024 * 1024
    )
      throw new Error('GL_TB_ENVELOPE');
  }
  if (action === 'gl-tb-reconcile' || action === 'gl-tb-restore') {
    try {
      if (
        !isRecord(value) ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        !Array.isArray(value.state.files) ||
        value.state.files.length !== 2
      )
        throw new Error('invalid');
      for (const file of value.state.files) {
        assertSourceFile(file);
        if (
          !(file.original instanceof ArrayBuffer) ||
          !file.original.byteLength ||
          file.original.byteLength > 8 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
        )
          throw new Error('invalid');
      }
      if (
        JSON.stringify(reconcileGlTb(value.state as unknown as GlTbInput)) !==
        JSON.stringify(value.result)
      )
        throw new Error('invalid');
      if (action === 'gl-tb-reconcile') {
        if (
          !isRecord(payload) ||
          !Array.isArray(payload.files) ||
          payload.files.length !== 2 ||
          JSON.stringify(value.state.readings) !==
            JSON.stringify(payload.readings) ||
          JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
        )
          throw new Error('invalid');
        for (const [side, source] of value.state.files.entries()) {
          const supplied = payload.files[side];
          if (
            !isRecord(supplied) ||
            source.name !== supplied.name ||
            source.sha256 !== supplied.sha256 ||
            !(supplied.original instanceof ArrayBuffer) ||
            supplied.original.byteLength !== source.original!.byteLength
          )
            throw new Error('invalid');
          const suppliedBytes = new Uint8Array(supplied.original);
          if (
            new Uint8Array(source.original!).some(
              (byte, index) => byte !== suppliedBytes[index],
            )
          )
            throw new Error('invalid');
        }
      }
    } catch {
      throw new Error('GL_TB_ENVELOPE');
    }
  }
  if (
    action === 'gateway-save' ||
    action === 'payroll-save' ||
    action === 'payroll-export' ||
    action === 'asset-save' ||
    action === 'asset-export' ||
    action === 'stock-save' ||
    action === 'stock-export' ||
    action === 'stock-links-export' ||
    action === 'gateway-export' ||
    action === 'intercompany-save' ||
    action === 'intercompany-export' ||
    action === 'tb-financial-save' ||
    action === 'tb-financial-export' ||
    action === 'bank-adjustment-save' ||
    action === 'bank-adjustment-export' ||
    action === 'bank-save' ||
    action === 'bank-export'
  ) {
    if (
      !(value instanceof ArrayBuffer) ||
      !value.byteLength ||
      value.byteLength > 96 * 1024 * 1024
    )
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
  }
  if (action === 'bank-reconcile' || action === 'bank-restore') {
    if (
      !isRecord(value) ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.result.version !== 'bank-cash-movements-1' ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.result.records) ||
      !Array.isArray(value.result.cases) ||
      !Array.isArray(value.result.events) ||
      !Array.isArray(value.state.files) ||
      value.state.files.length !== 2
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
  if (action === 'intercompany-batch-reconcile') {
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join('|') !== 'result|state' ||
      !isRecord(value.state) ||
      !isRecord(value.result) ||
      value.result.version !== IC_BATCH_VERSION ||
      typeof value.result.context !== 'string' ||
      !Array.isArray(value.state.files) ||
      !Array.isArray(value.result.batches)
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
    // Recompute every batch from the returned sources before installation, as
    // for the single pair. Not source authenticity or an accounting approval.
    try {
      if (
        JSON.stringify(
          reconcileIntercompanyBatches(
            value.state as unknown as IntercompanyBatchInput,
          ),
        ) !== JSON.stringify(value.result)
      )
        throw Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'gl-tb-sections-reconcile') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        value.result.version !== GLS_VERSION ||
        !Array.isArray(value.state.files) ||
        value.state.files.length !== 2 ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        payload.files.length !== 2 ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The result must belong to the sources this request sent, byte for byte.
      for (const [side, source] of value.state.files.entries()) {
        assertSourceFile(source);
        const supplied = payload.files[side];
        if (
          !(source.original instanceof ArrayBuffer) ||
          !/^[a-f0-9]{64}$/.test(source.sha256 ?? '') ||
          !isRecord(supplied) ||
          source.name !== supplied.name ||
          source.sha256 !== supplied.sha256 ||
          !(supplied.original instanceof ArrayBuffer) ||
          supplied.original.byteLength !== source.original.byteLength
        )
          throw new Error('invalid');
        const suppliedBytes = new Uint8Array(supplied.original);
        if (
          new Uint8Array(source.original).some(
            (byte, index) => byte !== suppliedBytes[index],
          )
        )
          throw new Error('invalid');
      }
      // Recompute every account from the returned sources before installation.
      // Not source authenticity or an accounting approval.
      if (
        JSON.stringify(
          reconcileGlTbSections(value.state as unknown as GlsInput),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'tb-financial-hierarchy-reconcile') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        value.result.version !== FINH_VERSION ||
        !Array.isArray(value.state.files) ||
        value.state.files.length !== 4 ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        payload.files.length !== 4 ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The result must belong to the four files this request sent, byte for byte.
      const sent = payload.files as unknown[];
      const files = value.state.files.map((source: unknown, i: number) => {
        const supplied = sent[i];
        if (
          !isRecord(source) ||
          !isRecord(supplied) ||
          typeof source.name !== 'string' ||
          source.name !== supplied.name ||
          typeof source.sha256 !== 'string' ||
          source.sha256 !== supplied.sha256 ||
          !(source.original instanceof ArrayBuffer) ||
          !(supplied.original instanceof ArrayBuffer) ||
          supplied.original.byteLength !== source.original.byteLength
        )
          throw new Error('invalid');
        const original = new Uint8Array(supplied.original),
          bytes = new Uint8Array(source.original);
        if (bytes.some((byte, index) => byte !== original[index]))
          throw new Error('invalid');
        return { name: source.name, sha256: source.sha256, bytes };
      });
      // Compute the statement again from those bytes before installation.
      // Not source authenticity or an accounting approval.
      if (
        JSON.stringify(
          reconcileFinancialHierarchy({
            files: files as FinHInput['files'],
            readings: value.state.readings as FinHInput['readings'],
            scope: value.state.scope as FinHInput['scope'],
          }),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'payroll-long-register-reconcile') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        value.result.version !== PLR_VERSION ||
        !Array.isArray(value.state.files) ||
        value.state.files.length !== 1 ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        payload.files.length !== 1 ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The result must belong to the register this request sent, byte for byte.
      const source: unknown = value.state.files[0],
        supplied: unknown = (payload.files as unknown[])[0];
      if (
        !isRecord(source) ||
        !isRecord(supplied) ||
        typeof source.name !== 'string' ||
        source.name !== supplied.name ||
        typeof source.sha256 !== 'string' ||
        source.sha256 !== supplied.sha256 ||
        !(source.original instanceof ArrayBuffer) ||
        !(supplied.original instanceof ArrayBuffer) ||
        supplied.original.byteLength !== source.original.byteLength
      )
        throw new Error('invalid');
      const original = new Uint8Array(supplied.original),
        bytes = new Uint8Array(source.original);
      if (bytes.some((byte, index) => byte !== original[index]))
        throw new Error('invalid');
      // Compute every employee again from those bytes before installation.
      // Not source authenticity, a payment proof or an accounting approval.
      if (
        JSON.stringify(
          reconcileLongRegister({
            files: [{ name: source.name, sha256: source.sha256, bytes }],
            readings: value.state.readings as PlrInput['readings'],
            scope: value.state.scope as PlrInput['scope'],
          }),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'inventory-movement-bridge-reconcile') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        value.result.version !== IMB_VERSION ||
        !Array.isArray(value.state.files) ||
        value.state.files.length !== 2 ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        payload.files.length !== 2 ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The result must belong to the register and GL summary this request
      // sent, each byte for byte.
      const files = (value.state.files as unknown[]).map((source, i) => {
        const supplied: unknown = (payload.files as unknown[])[i];
        if (
          !isRecord(source) ||
          !isRecord(supplied) ||
          typeof source.name !== 'string' ||
          source.name !== supplied.name ||
          typeof source.sha256 !== 'string' ||
          source.sha256 !== supplied.sha256 ||
          !(source.original instanceof ArrayBuffer) ||
          !(supplied.original instanceof ArrayBuffer) ||
          supplied.original.byteLength !== source.original.byteLength
        )
          throw new Error('invalid');
        const original = new Uint8Array(supplied.original),
          bytes = new Uint8Array(source.original);
        if (bytes.some((byte, index) => byte !== original[index]))
          throw new Error('invalid');
        return { name: source.name, sha256: source.sha256, bytes };
      });
      // Compute every position and account again from those bytes before
      // installation. Not source authenticity, a count or an approval.
      if (
        JSON.stringify(
          reconcileMovementBridge({
            files: [files[0], files[1]],
            readings: value.state.readings as ImbInput['readings'],
            scope: value.state.scope as ImbInput['scope'],
          }),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'clearing-groups-reconcile') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        value.result.version !== CLEARING_GROUPS_VERSION ||
        !isRecord(payload) ||
        !isRecord(payload.file) ||
        JSON.stringify(value.state.reading) !==
          JSON.stringify(payload.reading) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The result must belong to the extract this request sent, byte for
      // byte, under its name and hash.
      const source = value.state.file,
        supplied = payload.file;
      assertSourceFile(source);
      if (
        source.name !== supplied.name ||
        typeof source.sha256 !== 'string' ||
        source.sha256 !== supplied.sha256 ||
        !(source.original instanceof ArrayBuffer) ||
        !(supplied.original instanceof ArrayBuffer) ||
        !source.original.byteLength ||
        source.original.byteLength > MAX_FILE_BYTES ||
        supplied.original.byteLength !== source.original.byteLength
      )
        throw new Error('invalid');
      const original = new Uint8Array(supplied.original),
        bytes = new Uint8Array(source.original);
      if (bytes.some((byte, index) => byte !== original[index]))
        throw new Error('invalid');
      // Compute every group again before installation; the client binding
      // reads the bytes again for the sheet itself. Not an approval.
      if (
        JSON.stringify(
          groupClearing(value.state as unknown as ClearingGroupsInput),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'allocation-advice-review') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|review|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        !isRecord(value.review) ||
        value.review.version !== ALLOCATION_ADVICE_VERSION ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        !Array.isArray(value.state.files) ||
        payload.files.length !== 3 ||
        value.state.files.length !== 3 ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope) ||
        JSON.stringify(value.state.events) !== JSON.stringify(payload.events)
      )
        throw new Error('invalid');
      // Each of the three snapshots must be the one this request sent, byte
      // for byte, under its name and hash.
      for (const [side, snapshot] of value.state.files.entries()) {
        const sent = payload.files[side] as Record<string, unknown>;
        assertSourceFile(snapshot);
        if (
          !isRecord(sent) ||
          snapshot.name !== sent.name ||
          typeof snapshot.sha256 !== 'string' ||
          snapshot.sha256 !== sent.sha256 ||
          !(snapshot.original instanceof ArrayBuffer) ||
          !(sent.original instanceof ArrayBuffer) ||
          !snapshot.original.byteLength ||
          snapshot.original.byteLength > MAX_FILE_BYTES ||
          sent.original.byteLength !== snapshot.original.byteLength
        )
          throw new Error('invalid');
        const mine = new Uint8Array(sent.original),
          theirs = new Uint8Array(snapshot.original);
        if (theirs.some((byte, at) => byte !== mine[at]))
          throw new Error('invalid');
      }
      // The review must follow from the family result it carries; the client
      // binding replays the family from the bytes. Not an approval.
      if (
        JSON.stringify(
          reviewAllocationAdvice(value.result as unknown as AllocationResult),
        ) !== JSON.stringify(value.review)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'payment-gateway-batches-reconcile') {
    try {
      const roles = PG_BATCHES_ROLES.length;
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        value.result.version !== PG_BATCHES_VERSION ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        !Array.isArray(value.state.files) ||
        payload.files.length !== roles ||
        value.state.files.length !== roles ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The five gateway and bank files must be the ones this request sent,
      // byte for byte, under their names and hashes.
      const sentFiles: unknown[] = payload.files;
      value.state.files.forEach((returned: unknown, side: number) => {
        const requested = sentFiles[side];
        assertSourceFile(returned);
        if (
          !isRecord(requested) ||
          returned.name !== requested.name ||
          typeof returned.sha256 !== 'string' ||
          returned.sha256 !== requested.sha256 ||
          !(returned.original instanceof ArrayBuffer) ||
          !(requested.original instanceof ArrayBuffer) ||
          returned.original.byteLength > MAX_FILE_BYTES ||
          requested.original.byteLength !== returned.original.byteLength
        )
          throw new Error('invalid');
        const asked = new Uint8Array(requested.original),
          given = new Uint8Array(returned.original);
        for (let at = 0; at < given.length; at++)
          if (given[at] !== asked[at]) throw new Error('invalid');
      });
      // Review every batch, payout and credit again from the sheets carried;
      // the client binding reads the bytes again. Not an approval.
      if (
        JSON.stringify(
          reviewGatewayBatches(value.state as unknown as GatewayBatchesInput),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'fixed-assets-sections-review') {
    try {
      const roles = FA_SECTIONS_ROLES.length;
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        !isRecord(payload) ||
        !Array.isArray(payload.files) ||
        !Array.isArray(value.state.files) ||
        payload.files.length !== roles ||
        value.state.files.length !== roles ||
        JSON.stringify(value.state.readings) !==
          JSON.stringify(payload.readings) ||
        JSON.stringify(value.state.scope) !== JSON.stringify(payload.scope)
      )
        throw new Error('invalid');
      // The register, the category map and the GL balances must be the files
      // this request sent, byte for byte, under their names and hashes.
      const sentFiles: unknown[] = payload.files;
      value.state.files.forEach((returned: unknown, side: number) => {
        const requested = sentFiles[side];
        assertSourceFile(returned);
        if (
          !isRecord(requested) ||
          requested.name !== returned.name ||
          typeof returned.sha256 !== 'string' ||
          returned.sha256 !== requested.sha256 ||
          !(returned.original instanceof ArrayBuffer) ||
          !(requested.original instanceof ArrayBuffer) ||
          returned.original.byteLength > MAX_FILE_BYTES ||
          requested.original.byteLength !== returned.original.byteLength
        )
          throw new Error('invalid');
        const sent = new Uint8Array(requested.original),
          back = new Uint8Array(returned.original);
        for (let at = 0; at < back.length; at++)
          if (back[at] !== sent[at]) throw new Error('invalid');
      });
      // Review every section, asset and account again from the sheets
      // carried; the client binding reads the bytes again. Not an approval.
      if (
        JSON.stringify(
          reviewAssetSections(value.state as unknown as AssetSectionsInput),
        ) !== JSON.stringify(value.result)
      )
        throw new Error('invalid');
    } catch {
      throw new Error('استجابة المعالجة المحلية غير مكتملة. أعد اختيار الملف.');
    }
  }
  if (action === 'gateway-reconcile' || action === 'gateway-restore') {
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join('|') !== 'result|state' ||
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
        !file.original.byteLength ||
        file.original.byteLength > MAX_FILE_BYTES ||
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
    try {
      if (
        !isRecord(value) ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        JSON.stringify(
          reconcilePayroll(value.state as unknown as PayrollInput),
        ) !== JSON.stringify(value.result)
      )
        throw Error('PAYROLL_ENVELOPE');
    } catch {
      throw Error('PAYROLL_ENVELOPE');
    }
  }
  if (action === 'asset-reconcile' || action === 'asset-restore') {
    try {
      if (
        !isRecord(value) ||
        Object.keys(value).sort().join('|') !== 'result|state' ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        JSON.stringify(reconcileAsset(value.state as unknown as AssetInput)) !==
          JSON.stringify(value.result)
      )
        throw Error('ASSET_ENVELOPE');
    } catch {
      throw Error('ASSET_ENVELOPE');
    }
  }
  if (action === 'stock-reconcile' || action === 'stock-restore') {
    try {
      if (
        !isRecord(value) ||
        !isRecord(value.state) ||
        !isRecord(value.result) ||
        JSON.stringify(reconcileStock(value.state as unknown as StockInput)) !==
          JSON.stringify(value.result)
      )
        throw Error('STOCK_ENVELOPE');
    } catch {
      throw Error('STOCK_ENVELOPE');
    }
  }
  if (
    action === 'read' ||
    action === 'intercompany-read' ||
    action === 'gateway-read' ||
    action === 'stock-read' ||
    action === 'asset-read' ||
    action === 'payroll-read'
  ) {
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
