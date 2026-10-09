import {readPayrollFile,replayPayroll,savePayroll,restorePayroll,exportPayroll} from './payroll-io.ts';
import {readAssetFile,replayAsset,saveAsset,restoreAsset,exportAsset} from './fixed-assets-io.ts';
import { readStockFile, replayStock, saveStock, restoreStock, exportStock } from './inventory-register-io.ts';
import { replayGateway, saveGateway, restoreGateway, exportGateway } from './payment-gateway-io.ts';
import { readGatewayFile } from './payment-gateway-source.ts';
import { replayIntercompany, saveIntercompany, restoreIntercompany, exportIntercompany } from './intercompany-io.ts';
import { readIntercompanyFile } from './intercompany-source.ts';
import { replayFinancialPosition, saveFinancialPosition, restoreFinancialPosition, exportFinancialPosition } from './tb-financial-io.ts';
import {
  replayBankAdjustments,
  saveBankAdjustments,
  restoreBankAdjustments,
  exportBankAdjustments,
} from './bank-adjustment-io.ts';
import { replayBank, saveBank, restoreBank, exportBank } from './bank-io.ts';
import {
  replayAllocation,
  saveAllocation,
  restoreAllocation,
  exportAllocation,
} from './allocation-io.ts';
import { replayGlTb, saveGlTb, restoreGlTb, exportGlTb } from './gl-tb-io.ts';
import { replayAr, saveAr, restoreAr, exportAr } from './ar-io.ts';
import { assertInputFormats } from './input-readiness.ts';
import { saveSession, restoreSession } from './session.ts';
import { readFile, exportWorkbook, replayNativeHeaderSource } from './io.ts';
import { normalizeSource } from './core.ts';
import { reconcileSupplierStatement } from './supplier-reconciliation.ts';
import { ENGINE_VERSION } from './types.ts';
import { WORKER_CHANNEL, isRequest } from './protocol.ts';
import { ImportDiagnosticError } from './import-diagnostics.ts';
import { isInputReadinessRejection } from './input-readiness.ts';
import { replayReviewedVisualSource } from './visual-accounting-source.ts';
import {
  replayClearing,
  saveClearing,
  restoreClearing,
  exportClearing,
} from './clearing-io.ts';
self.onmessage = async (event: MessageEvent) => {
  const input: unknown = event.data;
  if (!isRequest(input)) return;
  const { id, action, payload } = event.data;
  const reply = { channel: WORKER_CHANNEL, id, action };
  // Durations only: no source content, persistence, or network telemetry.
  const timings: Record<string, number> = {};
  let started = performance.now();
  const measured = (stage: string) => {
    const now = performance.now();
    timings[stage] = now - started;
    started = now;
  };
  try {
    let value: unknown;
    if (action === 'ready') value = { ready: true, engine: ENGINE_VERSION };
    else if (action === 'bank-adjustment-reconcile')
      value = await replayBankAdjustments(payload);
    else if (action === 'bank-adjustment-save')
      value = await saveBankAdjustments(payload);
    else if (action === 'bank-adjustment-restore')
      value = await restoreBankAdjustments(payload.buffer);
    else if (action === 'bank-adjustment-export')
      value = await exportBankAdjustments(payload.state, payload.result);
    else if (action === 'bank-reconcile') value = await replayBank(payload);
    else if (action === 'bank-save') value = await saveBank(payload);
    else if (action === 'bank-restore')
      value = await restoreBank(payload.buffer);
    else if (action === 'bank-export')
      value = await exportBank(payload.state, payload.result);
    else if (action === 'allocation-reconcile')
      value = await replayAllocation(payload);
    else if (action === 'allocation-save')
      value = await saveAllocation(payload);
    else if (action === 'allocation-restore')
      value = await restoreAllocation(payload.buffer);
    else if (action === 'allocation-export')
      value = await exportAllocation(payload.state, payload.result);
    else if (action === 'gateway-read') value = await readGatewayFile(payload.name,payload.buffer);
    else if (action === 'payroll-read') value = await readPayrollFile(payload.name,payload.buffer);
    else if (action === 'payroll-reconcile') value = await replayPayroll(payload);
    else if (action === 'payroll-save') value = await savePayroll(payload);
    else if (action === 'payroll-restore') value = await restorePayroll(payload.buffer);
    else if (action === 'payroll-export') value = await exportPayroll(payload.state,payload.result);
    else if (action === 'asset-read') value = await readAssetFile(payload.name,payload.buffer);
    else if (action === 'asset-reconcile') value = await replayAsset(payload);
    else if (action === 'asset-save') value = await saveAsset(payload);
    else if (action === 'asset-restore') value = await restoreAsset(payload.buffer);
    else if (action === 'asset-export') value = await exportAsset(payload.state,payload.result);
    else if (action === 'stock-read') value = await readStockFile(payload.name,payload.buffer);
    else if (action === 'stock-reconcile') value = await replayStock(payload);
    else if (action === 'stock-save') value = await saveStock(payload);
    else if (action === 'stock-restore') value = await restoreStock(payload.buffer);
    else if (action === 'stock-export') value = await exportStock(payload.state,payload.result);
    else if (action === 'gateway-reconcile') value = await replayGateway(payload);
    else if (action === 'gateway-save') value = await saveGateway(payload);
    else if (action === 'gateway-restore') value = await restoreGateway(payload.buffer);
    else if (action === 'gateway-export') value = await exportGateway(payload.state,payload.result);
    else if (action === 'intercompany-read') value = await readIntercompanyFile(payload.name, payload.buffer);
    else if (action === 'intercompany-reconcile') value = await replayIntercompany(payload);
    else if (action === 'intercompany-save') value = await saveIntercompany(payload);
    else if (action === 'intercompany-restore') value = await restoreIntercompany(payload.buffer);
    else if (action === 'intercompany-export') value = await exportIntercompany(payload.state, payload.result);
    else if (action === 'tb-financial-reconcile') value = await replayFinancialPosition(payload);
    else if (action === 'tb-financial-save') value = await saveFinancialPosition(payload);
    else if (action === 'tb-financial-restore') value = await restoreFinancialPosition(payload.buffer);
    else if (action === 'tb-financial-export') value = await exportFinancialPosition(payload.state, payload.result);
    else if (action === 'gl-tb-reconcile') value = await replayGlTb(payload);
    else if (action === 'gl-tb-save') value = await saveGlTb(payload);
    else if (action === 'gl-tb-restore')
      value = await restoreGlTb(payload.buffer);
    else if (action === 'gl-tb-export')
      value = await exportGlTb(payload.state, payload.result);
    else if (action === 'ar-reconcile') value = await replayAr(payload);
    else if (action === 'ar-save') value = await saveAr(payload);
    else if (action === 'ar-restore') value = await restoreAr(payload.buffer);
    else if (action === 'ar-export')
      value = await exportAr(payload.state, payload.result);
    else if (action === 'clearing-reconcile')
      value = await replayClearing(payload);
    else if (action === 'clearing-save') value = await saveClearing(payload);
    else if (action === 'clearing-restore')
      value = await restoreClearing(payload.buffer);
    else if (action === 'clearing-export')
      value = await exportClearing(payload.state, payload.result);
    else if (action === 'save-session') {
      payload.files = [
        await replayReviewedVisualSource(payload.files[0]),
        await replayReviewedVisualSource(payload.files[1]),
      ];
      value = await saveSession(payload);
    } else if (action === 'restore-session')
      value = await restoreSession(payload.buffer);
    else if (action === 'read')
      value = await readFile(
        payload.name,
        payload.buffer,
        payload.pdfCuts,
        payload.autoPdfColumns === true,
        (progress) =>
          self.postMessage({ ...reply, kind: 'progress', progress }),
      );
    else if (action === 'reconcile') {
      payload.files = [
        await replayNativeHeaderSource(payload.files[0]),
        await replayNativeHeaderSource(payload.files[1]),
      ];
      // The shared source boundary checks formats and directions first.
      const { a, b, result } = reconcileSupplierStatement(payload, measured);
      value = { a, b, result };
    } else if (action === 'compare') {
      payload.files = [
        await replayNativeHeaderSource(payload.files[0]),
        await replayNativeHeaderSource(payload.files[1]),
      ];
      value = reconcileSupplierStatement(payload).result;
    } else if (action === 'normalize')
      value = normalizeSource(
        await replayNativeHeaderSource(payload.file),
        payload.mapping,
        payload.scope,
        payload.side,
      );
    else if (action === 'export') {
      payload.files = [
        await replayReviewedVisualSource(payload.files[0]),
        await replayReviewedVisualSource(payload.files[1]),
      ];
      assertInputFormats(
        payload.files,
        [payload.result.supplier.mapping, payload.result.ledger.mapping],
        payload.result.scope,
      );
      value = await exportWorkbook(
        payload.result,
        payload.files,
        payload.review,
        (stage, milliseconds) => {
          timings[stage] = milliseconds;
        },
      );
    } else throw new Error('عملية غير معروفة');
    if (value instanceof ArrayBuffer)
      self.postMessage(
        { ...reply, ok: true, value, timings },
        { transfer: [value] },
      );
    else self.postMessage({ ...reply, ok: true, value, timings });
  } catch (error) {
    self.postMessage({
      ...reply,
      ok: false,
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : 'تعذر إكمال العملية محليًا',
      ...(error instanceof ImportDiagnosticError
        ? { diagnosis: error.diagnosis }
        : {}),
      // The refusal reason crosses the boundary, so a caller can tell a guarded
      // stop from a crash without parsing a message.
      ...(isInputReadinessRejection(error)
        ? { readiness: error.readiness }
        : {}),
    });
  }
};
