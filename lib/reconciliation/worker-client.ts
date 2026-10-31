import { snapshotStockPdfRequest } from './inventory-pdf-request.ts';
import { snapshotBankStatementRequest } from './bank-statement-request.ts';
import { validateStockPdfWorkerResponse } from './inventory-pdf-lifecycle.ts';
import { snapshotStockRequest } from './inventory-register-request.ts';
import {
  assertStockWorkerReply,
  validateStockWorkerResponse,
} from './inventory-register-worker-binding.ts';
import { snapshotAsset } from './fixed-assets-envelope.ts';
import { snapshotGatewayRequest } from './payment-gateway-worker-binding.ts';
import { snapshotArRequest, assertArWorkerReply } from './ar-worker-binding.ts';
import { MAX_FILE_BYTES } from './types.ts';
import type { AssetInput } from './fixed-assets.ts';
import { WORKER_CHANNEL, isRecord, validateWorkerValue } from './protocol.ts';
import { isNextProcessingProgress } from './processing-progress.ts';
import type { ProcessingProgress } from './processing-progress.ts';
import {
  ImportDiagnosticError,
  isImportDiagnosis,
} from './import-diagnostics.ts';
export type WorkerPort = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
const isPdfRead = (action: string, payload: unknown) =>
  action === 'read' &&
  isRecord(payload) &&
  typeof payload.name === 'string' &&
  /\.pdf$/i.test(payload.name);

/** The deadline covers the entire request, including sequential source re-reads. */
export function workerRequestTimeout(action: string, payload: unknown) {
  const rereadsPdf =
    (action === 'save-session' || action === 'export') &&
    isRecord(payload) &&
    Array.isArray(payload.files) &&
    payload.files.some(
      (file) =>
        isRecord(file) &&
        typeof file.name === 'string' &&
        /\.pdf$/i.test(file.name),
    );
  return action.startsWith('stock-pdf-') ||
    action.startsWith('bank-statement-') ||
    isPdfRead(action, payload) ||
    action === 'restore-session' ||
    rereadsPdf
    ? 180000
    : 45000;
}
export function createWorkerClient(
  create: () => WorkerPort,
  timeoutMs?: number,
) {
  let serial = 0,
    cached: WorkerPort | null = null,
    inUse = false;
  let preparation: Promise<unknown> | null = null;
  function request<T>(
    action: string,
    payload: unknown,
    signal?: AbortSignal,
    onProgress?: (progress: ProcessingProgress) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('أُلغيت العملية'));
      if (inUse) return reject(new Error('انتظر انتهاء العملية الحالية'));
      if (action.startsWith('ar-')) {
        try {
          payload = snapshotArRequest(action, payload);
        } catch (error) {
          return reject(error);
        }
      }
      if (action.startsWith('gateway-')) {
        try {
          payload = snapshotGatewayRequest(action, payload);
        } catch (error) {
          return reject(error);
        }
      }
      if (action.startsWith('stock-')) {
        try {
          payload = action.startsWith('stock-pdf-')
            ? snapshotStockPdfRequest(action, payload)
            : snapshotStockRequest(action, payload);
        } catch (error) {
          return reject(error);
        }
      }
      // Capture the requested originals and context before validation can yield.
      if (action.startsWith('gl-tb-')) {
        try {
          payload = structuredClone(payload);
        } catch (error) {
          return reject(error);
        }
      }
      // The clearing extract, its reading and scope, the same way.
      if (action.startsWith('clearing-groups-')) {
        try {
          payload = structuredClone(payload);
        } catch (error) {
          return reject(error);
        }
      }
      // The three allocation snapshots, their readings, scope and events.
      if (action === 'allocation-advice-review') {
        try {
          payload = structuredClone(payload);
        } catch (error) {
          return reject(error);
        }
      }
      // The five gateway batch snapshots, their readings and scope.
      if (action === 'payment-gateway-batches-reconcile') {
        try {
          payload = structuredClone(payload);
        } catch (error) {
          return reject(error);
        }
      }
      // The three asset section snapshots, their readings and scope.
      if (action === 'fixed-assets-sections-review') {
        try {
          payload = structuredClone(payload);
        } catch (error) {
          return reject(error);
        }
      }
      // Capture the statement originals, scope and decisions synchronously.
      if (action.startsWith('bank-statement-')) {
        try {
          payload = snapshotBankStatementRequest(action, payload);
        } catch (error) {
          return reject(error);
        }
      }
      // Bind bank validation to the caller's sources and context at submission.
      else if (action.startsWith('bank-')) {
        try {
          payload = structuredClone(payload);
        } catch (error) {
          return reject(error);
        }
      }
      // Capture authoritative asset sources and every choice synchronously.
      if (action.startsWith('asset-')) {
        try {
          if (action === 'asset-reconcile' || action === 'asset-save')
            payload = snapshotAsset(payload as AssetInput);
          else if (action === 'asset-export' && isRecord(payload))
            payload = {
              state: snapshotAsset(payload.state as AssetInput),
              result: structuredClone(payload.result),
            };
          else if (action === 'asset-read' || action === 'asset-restore') {
            if (
              !isRecord(payload) ||
              !(payload.buffer instanceof ArrayBuffer) ||
              !payload.buffer.byteLength ||
              payload.buffer.byteLength >
                (action === 'asset-read' ? MAX_FILE_BYTES : 64 * 1024 * 1024)
            )
              throw Error('ASSET_SOURCE');
            payload = { ...payload, buffer: payload.buffer.slice(0) };
          }
        } catch (error) {
          return reject(error);
        }
      }
      if (!cached) cached = create();
      const worker = cached,
        id = ++serial;
      inUse = true;
      let settled = false;
      let progress: ProcessingProgress | undefined;
      const finish = (terminate: boolean) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        inUse = false;
        if (terminate) {
          worker.terminate();
          cached = null;
          preparation = null;
        }
        return true;
      };
      const fail = (error: unknown) => {
        if (finish(true))
          reject(
            error instanceof Error && error.message.trim()
              ? error
              : new Error(
                  'تعذر قراءة الملف. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.',
                ),
          );
      };
      const abort = () => fail(new Error('أُلغيت العملية'));
      const deadlineMs = timeoutMs ?? workerRequestTimeout(action, payload);
      const timeout = setTimeout(
        () =>
          fail(
            new Error(
              `تجاوزت العملية مهلة ${deadlineMs / 1000} ثانية. قلل حجم الملف أو راجع بنيته.`,
            ),
          ),
        deadlineMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      worker.onmessage = async (event) => {
        if (settled) return;
        let response = event.data as unknown;
        // Library messages and delayed replies are not accounting results.
        if (
          !isRecord(response) ||
          response.channel !== WORKER_CHANNEL ||
          response.id !== id
        )
          return;
        const invalidResponse = () =>
          fail(
            new Error(
              'استجابة قارئ الملفات غير صالحة. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.',
            ),
          );
        if (action.startsWith('ar-')) {
          try {
            assertArWorkerReply(response);
            if (response.ok === true)
              validateWorkerValue(action, response.value, payload);
            response = structuredClone(response);
          } catch (error) {
            fail(error);
            return;
          }
        }
        if (action.startsWith('stock-')) {
          try {
            if (!isRecord(response)) throw Error('STOCK_WORKER_ENVELOPE');
            assertStockWorkerReply(response);
            // Copy the envelope before asynchronous original replay. Its value
            // is owned synchronously by the stock validator below.
            response = { ...response };
          } catch (error) {
            fail(error);
            return;
          }
        }
        if (!isRecord(response)) return invalidResponse();
        if (response.action !== action) return invalidResponse();
        if (
          Object.hasOwn(response, 'kind') ||
          Object.hasOwn(response, 'progress')
        ) {
          if (
            response.kind !== 'progress' ||
            !isPdfRead(action, payload) ||
            Object.keys(response).length !== 5 ||
            Object.keys(response).some(
              (key) =>
                !['channel', 'id', 'action', 'kind', 'progress'].includes(key),
            ) ||
            !isNextProcessingProgress(progress, response.progress)
          )
            return invalidResponse();
          progress = { ...response.progress };
          try {
            onProgress?.({ ...progress });
          } catch (error) {
            fail(error);
          }
          return;
        }
        if (typeof response.ok !== 'boolean')
          return fail(
            new Error(
              'استجابة قارئ الملفات غير صالحة. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.',
            ),
          );
        if (!response.ok) {
          const message =
            typeof response.error === 'string' && response.error.trim()
              ? response.error
              : 'تعذر قراءة الملف. أُعيد تجهيز القارئ لتتمكن من المحاولة مجددًا.';
          return fail(
            action === 'read' && isImportDiagnosis(response.diagnosis)
              ? new ImportDiagnosticError(message, response.diagnosis)
              : new Error(message),
          );
        }
        try {
          // Check raw transport types before replay; parsed caches remain disposable.
          if (['gl-tb-reconcile', 'gl-tb-restore'].includes(action)) {
            const value = response.value;
            if (
              !isRecord(value) ||
              !isRecord(value.state) ||
              !isRecord(value.result) ||
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
              throw Error('GL_TB_WORKER_BINDING');
          }
          if (action === 'gl-tb-reconcile' || action === 'gl-tb-restore') {
            const { replayGlTb, restoreGlTb } = await import('./gl-tb-io.ts');
            const requested =
              action === 'gl-tb-restore'
                ? await restoreGlTb((payload as { buffer: ArrayBuffer }).buffer)
                : await replayGlTb(payload as import('./gl-tb.ts').GlTbInput);
            const returned = response.value as typeof requested;
            const identity = (state: typeof requested.state) =>
              JSON.stringify({
                scope: state.scope,
                readings: state.readings,
                files: state.files.map((file) => ({
                  name: file.name,
                  kind: file.kind,
                  sha256: file.sha256,
                  originalBytes: file.original!.byteLength,
                })),
              });
            if (
              identity(returned.state) !== identity(requested.state) ||
              JSON.stringify(returned.result) !==
                JSON.stringify(requested.result)
            )
              throw Error('GL_TB_WORKER_BINDING');
            for (const [index, file] of returned.state.files.entries()) {
              const a = new Uint8Array(file.original!),
                b = new Uint8Array(requested.state.files[index].original!);
              if (
                a.length !== b.length ||
                a.some((byte, offset) => byte !== b[offset])
              )
                throw Error('GL_TB_WORKER_BINDING');
            }
            // Install only sheets re-read from this request's originals.
            response.value = requested;
          }
          if (action === 'clearing-groups-reconcile') {
            const value = response.value;
            if (
              !isRecord(value) ||
              !isRecord(value.state) ||
              !isRecord(value.result) ||
              !isRecord(value.state.file) ||
              !(value.state.file.original instanceof ArrayBuffer) ||
              !value.state.file.original.byteLength ||
              value.state.file.original.byteLength > MAX_FILE_BYTES
            )
              throw Error('CLEARING_GROUPS_WORKER_BINDING');
            const { replayClearingGroups } = await import(
              './clearing-groups-io.ts'
            );
            const recomputed = await replayClearingGroups(
              payload as import('./clearing-groups.ts').ClearingGroupsInput,
            );
            const forwarded = value as unknown as typeof recomputed;
            const fileOf = (state: typeof recomputed.state) =>
              JSON.stringify({
                reading: state.reading,
                scope: state.scope,
                name: state.file.name,
                kind: state.file.kind,
                sha256: state.file.sha256,
                originalBytes: state.file.original!.byteLength,
              });
            if (
              fileOf(forwarded.state) !== fileOf(recomputed.state) ||
              JSON.stringify(forwarded.result) !==
                JSON.stringify(recomputed.result)
            )
              throw Error('CLEARING_GROUPS_WORKER_BINDING');
            const a = new Uint8Array(forwarded.state.file.original!),
              b = new Uint8Array(recomputed.state.file.original!);
            if (
              a.length !== b.length ||
              a.some((byte, offset) => byte !== b[offset])
            )
              throw Error('CLEARING_GROUPS_WORKER_BINDING');
            // Install only the sheet re-read from this request's original.
            response.value = recomputed;
          }
          if (action === 'allocation-advice-review') {
            const reply = response.value;
            if (
              !isRecord(reply) ||
              !isRecord(reply.state) ||
              !isRecord(reply.result) ||
              !isRecord(reply.review) ||
              !Array.isArray(reply.state.files) ||
              reply.state.files.length !== 3
            )
              throw Error('ALLOCATION_ADVICE_WORKER_BINDING');
            const { replayAllocationAdvice } = await import(
              './allocation-advice-io.ts'
            );
            const fresh = await replayAllocationAdvice(
              payload as import('./allocation.ts').AllocationInput,
            );
            const sent = reply as unknown as typeof fresh;
            const sources = (snapshot: typeof fresh.state) =>
              JSON.stringify({
                readings: snapshot.readings,
                scope: snapshot.scope,
                events: snapshot.events,
                files: snapshot.files.map((f) => [
                  f.name,
                  f.kind,
                  f.sha256,
                  f.original?.byteLength,
                ]),
              });
            if (
              sources(sent.state) !== sources(fresh.state) ||
              JSON.stringify(sent.result) !== JSON.stringify(fresh.result) ||
              JSON.stringify(sent.review) !== JSON.stringify(fresh.review)
            )
              throw Error('ALLOCATION_ADVICE_WORKER_BINDING');
            for (const [side, f] of sent.state.files.entries()) {
              const x = new Uint8Array(f.original!),
                y = new Uint8Array(fresh.state.files[side].original!);
              if (x.length !== y.length || x.some((v, at) => v !== y[at]))
                throw Error('ALLOCATION_ADVICE_WORKER_BINDING');
            }
            // Install only what this page replayed from its own request.
            response.value = fresh;
          }
          if (action === 'payment-gateway-batches-reconcile') {
            const answer = response.value;
            if (
              !isRecord(answer) ||
              !isRecord(answer.state) ||
              !isRecord(answer.result) ||
              !Array.isArray(answer.state.files) ||
              answer.state.files.length !== 5
            )
              throw Error('PG_BATCHES_WORKER_BINDING');
            const { replayGatewayBatches } = await import(
              './payment-gateway-batches-io.ts'
            );
            let own: Awaited<ReturnType<typeof replayGatewayBatches>>;
            try {
              own = await replayGatewayBatches(
                payload as import('./payment-gateway-batches-io.ts').GatewayBatchesReplayInput,
              );
            } catch {
              // The worker answered where this page refuses: not this request.
              throw Error('PG_BATCHES_WORKER_BINDING');
            }
            const theirs = answer as unknown as typeof own;
            const evidence = (state: typeof own.state) =>
              JSON.stringify([
                state.readings,
                state.scope,
                state.files.map((f) => [
                  f.name,
                  f.kind,
                  f.sha256,
                  f.original?.byteLength,
                ]),
              ]);
            if (
              evidence(theirs.state) !== evidence(own.state) ||
              JSON.stringify(theirs.result) !== JSON.stringify(own.result)
            )
              throw Error('PG_BATCHES_WORKER_BINDING');
            theirs.state.files.forEach((f, side) => {
              const left = new Uint8Array(f.original!),
                right = new Uint8Array(own.state.files[side].original!);
              if (
                left.length !== right.length ||
                left.some((v, at) => v !== right[at])
              )
                throw Error('PG_BATCHES_WORKER_BINDING');
            });
            // Install only the review this page computed from its own bytes.
            response.value = own;
          }
          if (action === 'fixed-assets-sections-review') {
            const answer = response.value;
            if (
              !isRecord(answer) ||
              !isRecord(answer.state) ||
              !isRecord(answer.result) ||
              !Array.isArray(answer.state.files) ||
              answer.state.files.length !== 3
            )
              throw Error('FA_SECTIONS_WORKER_BINDING');
            const { replayAssetSections } = await import(
              './fixed-assets-sections-io.ts'
            );
            let mine: Awaited<ReturnType<typeof replayAssetSections>>;
            try {
              mine = await replayAssetSections(
                payload as import('./fixed-assets-sections-io.ts').AssetSectionsReplayInput,
              );
            } catch {
              // This page refuses what the worker reviewed: another request.
              throw Error('FA_SECTIONS_WORKER_BINDING');
            }
            const given = answer as unknown as typeof mine;
            const sources = (state: typeof mine.state) =>
              JSON.stringify([
                state.readings,
                state.scope,
                state.files.map((f) => [
                  f.name,
                  f.sha256,
                  f.original?.byteLength,
                ]),
              ]);
            if (
              sources(given.state) !== sources(mine.state) ||
              JSON.stringify(given.result) !== JSON.stringify(mine.result)
            )
              throw Error('FA_SECTIONS_WORKER_BINDING');
            given.state.files.forEach((f, side) => {
              const a = new Uint8Array(f.original!),
                b = new Uint8Array(mine.state.files[side].original!);
              if (a.length !== b.length || a.some((v, at) => v !== b[at]))
                throw Error('FA_SECTIONS_WORKER_BINDING');
            });
            // The page keeps its own review of the bytes it sent.
            response.value = mine;
          }
          if (action.startsWith('stock-')) {
            response.value = await (
              action.startsWith('stock-pdf-')
                ? validateStockPdfWorkerResponse
                : validateStockWorkerResponse
            )(action, response.value, payload);
          }
          validateWorkerValue(action, response.value, payload);
          if (action.startsWith('bank-statement-')) {
            const { validateBankStatementWorkerResponse } =
              await import('./bank-statement-lifecycle.ts');
            response.value = await validateBankStatementWorkerResponse(
              action,
              response.value,
              payload,
            );
          }
          if (action.startsWith('ar-')) {
            const { validateArWorkerResponse } =
              await import('./ar-worker-binding.ts');
            response.value = await validateArWorkerResponse(
              action,
              response.value,
              payload,
            );
          }
          if (
            [
              'bank-reconcile',
              'bank-restore',
              'bank-adjustment-reconcile',
              'bank-adjustment-restore',
            ].includes(action)
          ) {
            const value = response.value as {
              state:
                | import('./bank.ts').BankInput
                | import('./bank-adjustment.ts').BankAdjustmentInput;
              result: unknown;
            };
            const adjustment = action.startsWith('bank-adjustment-');
            const io = adjustment
              ? await import('./bank-adjustment-io.ts')
              : await import('./bank-io.ts');
            const replay =
              'replayBank' in io ? io.replayBank : io.replayBankAdjustments;
            const restore =
              'restoreBank' in io ? io.restoreBank : io.restoreBankAdjustments;
            const fresh = await replay(value.state as never);
            if (JSON.stringify(fresh.result) !== JSON.stringify(value.result))
              throw Error('BANK_WORKER_RESULT');
            // Bind the returned originals and context to this request. A valid
            // envelope from another family/session cannot replace this result.
            if (action.endsWith('-restore')) {
              const requested = await restore(
                (payload as { buffer: ArrayBuffer }).buffer,
              );
              if (
                JSON.stringify(requested.result) !==
                JSON.stringify(fresh.result)
              )
                throw Error('BANK_WORKER_BINDING');
            } else {
              const identity = (input: unknown): string =>
                JSON.stringify(input, (key, v) =>
                  key === 'sheets'
                    ? undefined
                    : v instanceof ArrayBuffer
                      ? { sourceBytes: v.byteLength }
                      : v,
                );
              if (identity(fresh.state) !== identity(payload))
                throw Error('BANK_WORKER_BINDING');
              const originals = (input: typeof value.state) =>
                'balance' in input
                  ? [
                      ...input.balance.bank.files,
                      ...input.balance.files,
                      ...input.files,
                    ]
                  : input.files;
              const returned = originals(fresh.state),
                requested = originals(payload as typeof value.state);
              for (const [index, file] of returned.entries()) {
                const a = new Uint8Array(file.original!),
                  b = new Uint8Array(requested[index].original!);
                if (
                  a.length !== b.length ||
                  a.some((byte, offset) => byte !== b[offset])
                )
                  throw Error('BANK_WORKER_BINDING');
              }
            }
            response.value = fresh;
          }
          if (action.startsWith('asset-')) {
            const { validateAssetWorkerResponse } =
              await import('./fixed-assets-io.ts');
            response.value = await validateAssetWorkerResponse(
              action,
              response.value,
              payload,
            );
          }
          if (action.startsWith('gateway-')) {
            const { validateGatewayWorkerResponse } =
              await import('./payment-gateway-worker-binding.ts');
            response.value = await validateGatewayWorkerResponse(
              action,
              response.value,
              payload,
            );
          }
          if (
            action === 'read' &&
            isRecord(response.value) &&
            response.value.kind === 'reviewed-visual-source'
          ) {
            const { replayReviewedVisualSource } =
              await import('./visual-accounting-source.ts');
            response.value = await replayReviewedVisualSource(
              response.value as import('./types.ts').SourceFile,
            );
          }
          if (
            action === 'restore-session' &&
            isRecord(response.value) &&
            Array.isArray(response.value.files)
          ) {
            const { replayReviewedVisualSource } =
              await import('./visual-accounting-source.ts');
            response.value.files = await Promise.all(
              response.value.files.map(replayReviewedVisualSource),
            );
          }
        } catch (error) {
          fail(error);
          return;
        }
        if (finish(false)) resolve(response.value as T);
      };
      worker.onerror = () =>
        fail(
          new Error(
            'توقفت المعالجة المحلية وأُعيد تجهيز القارئ. أعد اختيار الملف.',
          ),
        );
      worker.onmessageerror = () =>
        fail(new Error('تعذر استلام بيانات القارئ المحلي. أعد اختيار الملف.'));
      try {
        worker.postMessage({ channel: WORKER_CHANNEL, id, action, payload });
      } catch (error) {
        fail(error);
      }
    });
  }
  return {
    request,
    prepare: () =>
      (preparation ??= request('ready', {}).catch((error) => {
        preparation = null;
        throw error;
      })),
  };
}
