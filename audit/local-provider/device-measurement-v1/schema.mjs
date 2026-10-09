import contract from '../browser-v1/contract.json' with { type: 'json' };
import modelManifest from '../proposal-v2/qwen25-model.json' with { type: 'json' };

/** Raw runtime reports cannot assert physical weak-device classification. */
export function validateDeviceReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return ['report object'];
  const errors = [];
  const positive = (n) => Number.isSafeInteger(n) && n > 0;
  const duration = (n) => Number.isFinite(n) && n >= 0;
  const hash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  const timestamp = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
  if (report.version !== 'p5-browser-device-measurement-v1') errors.push('version');
  if (report.productEnabled !== false || report.developmentOnly !== true) errors.push('development boundary');
  if (report.semanticAcceptance !== false || report.synthetic !== true) errors.push('runtime smoke boundary');
  if (!hash(report.freezeSha256)) errors.push('freeze hash');
  if (!positive(report.host?.ramBytes)) errors.push('host RAM');
  if (typeof report.browser?.version !== 'string' || !report.browser.version || report.backend !== 'wasm' || !positive(report.threadProfile?.requested)) errors.push('runtime profile');
  if (typeof report.model?.id !== 'string' || !report.model.id ||
    typeof report.model?.revision !== 'string' || !/^[a-f0-9]{40}$/.test(report.model.revision) ||
    report.model?.dtype !== 'q8' || !positive(report.model?.totalBytes)) errors.push('model pins');
  if (report.model?.id !== modelManifest.model || report.model?.revision !== modelManifest.revision ||
    report.model?.dtype !== modelManifest.dtype || report.model?.totalBytes !== modelManifest.totalBytes ||
    report.runtime?.transformers !== contract.runtimeVersion || typeof report.runtime?.onnxruntimeWeb !== 'string' ||
    !report.runtime.onnxruntimeWeb) errors.push('pinned model/runtime');
  if (!Array.isArray(report.assets) || !report.assets.length || report.assets.some((a) =>
    a?.verified !== true || !hash(a?.sha256) || !positive(a?.bytes) || typeof a?.path !== 'string' || !a.path) ||
    new Set(report.assets.map((a) => a?.path)).size !== report.assets.length ||
    report.assets.reduce((sum, a) => sum + a?.bytes, 0) !== report.model?.totalBytes) errors.push('assets');
  if (Array.isArray(report.assets) && (report.assets.length !== modelManifest.files.length ||
    modelManifest.files.some((pin) => !report.assets.some((a) => a?.path === pin.path &&
      a?.bytes === pin.bytes && a?.sha256 === pin.sha256 && a?.verified === true)))) errors.push('pinned assets');
  if (report.memory?.method !== 'CDP SystemInfo.getProcessInfo owned Chrome PIDs + complete ps RSS sum') errors.push('memory method');
  if (!Array.isArray(report.memory?.samples) || !Array.isArray(report.memory?.gaps) ||
    !positive(report.memory?.limitBytes) || !positive(report.memory?.intervalMs) ||
    typeof report.memory?.limitExceeded !== 'boolean') errors.push('memory evidence');
  else {
    if (report.memory.samples.some((s) => !positive(s?.bytes) || !timestamp(s.at) ||
      typeof s.stage !== 'string' || !Array.isArray(s.pids) || !s.pids.length ||
      s.pids.some((p) => !positive(p)) || new Set(s.pids).size !== s.pids.length) ||
      report.memory.gaps.some((g) => !timestamp(g?.at) || typeof g.error !== 'string' || !g.error)) errors.push('memory samples');
    const peak = report.memory.samples.length ? Math.max(...report.memory.samples.map((s) => s?.bytes)) : null;
    if (report.memory.peakBytes !== peak || report.memory.limitExceeded !==
      (report.memory.samples.some((s) => s?.bytes > report.memory.limitBytes))) errors.push('memory peak');
  }
  if (!Array.isArray(report.network?.requests) || report.network?.osAirGap !== false ||
    report.network.requests.some((r) => typeof r?.url !== 'string' || !r.url ||
      typeof r.method !== 'string' || typeof r.allowed !== 'boolean')) errors.push('network boundary');
  if (report.physicalWeakDeviceEvidence !== false) errors.push('physical weak-device evidence');
  if (typeof report.runtimeSmokePassed !== 'boolean') errors.push('runtime success type');
  if (!Array.isArray(report.errors) || report.errors.some((e) => typeof e !== 'string')) errors.push('errors');
  if (!timestamp(report.startedAt) || !timestamp(report.completedAt) ||
    Date.parse(report.completedAt) < Date.parse(report.startedAt)) errors.push('measurement timestamps');
  const result = (r) => r && ((r.status === 'fallback' && typeof r.reason === 'string' && r.reason.length > 0) ||
    (r.status === 'ok' && r.value && typeof r.value === 'object'));
  if (!Array.isArray(report.cases) || report.cases.some((c) => typeof c?.id !== 'string' || !c.id ||
    !hash(c.inputSha256) || !hash(c.expectedSha256) || c.semanticScored !== false || !result(c) || !duration(c.wallMs) ||
    (c.status === 'ok' && (!duration(c.value.elapsedMs) || !positive(c.value.inputTokens) ||
      !positive(c.value.generatedTokens) || !Array.isArray(c.value.generatedTokenIds) ||
      c.value.generatedTokens > contract.maxNewTokens ||
      c.value.generatedTokenIds.length !== c.value.generatedTokens ||
      c.value.generatedTokenIds.some((t) => !Number.isSafeInteger(t) || t < 0) || typeof c.value.raw !== 'string')))) errors.push('cases');
  if (report.runtimeSmokePassed === true && (!Array.isArray(report.cases) ||
    report.cases.length !== contract.cases.length || contract.cases.some((id, index) => report.cases[index]?.id !== id))) errors.push('frozen case set');
  if (report.load) {
    if (!result(report.load) || !duration(report.load.wallMs) ||
      (report.load.status === 'ok' && (!duration(report.load.value.loadMs) || report.load.value.backend !== 'wasm' ||
      report.load.value.threads !== report.threadProfile?.requested || report.load.value.crossOriginIsolated !== true))) errors.push('load');
  } else if (!Array.isArray(report.errors) || !report.errors.length) errors.push('missing load or failure');
  if (report.runtimeSmokePassed === true && (report.load?.status !== 'ok' || !Array.isArray(report.cases) || !report.cases.length ||
    report.cases.some((c) => c?.status !== 'ok') || !report.memory?.samples?.length || report.memory.limitExceeded ||
    report.probes?.cancellation?.generationObserved !== true || report.probes.cancellation.terminatedWorkers !== 1 ||
    report.probes.cancellation.result?.reason !== 'cancelled' || report.probes.cancellation.active !== false ||
    report.probes.cancellation.workerPresent !== false || report.probes?.missingAsset?.status !== 'fallback' ||
    report.probes?.unavailable?.status !== 'fallback' || report.probes?.staleReply?.accepted !== false ||
    !Array.isArray(report.network?.requests) || report.network.requests.some((r) => !r?.allowed) ||
    !Array.isArray(report.errors) || report.errors.length > 0)) errors.push('success gate');
  if (report.runtimeSmokePassed === true && Array.isArray(report.network?.requests)) {
    let origin;
    const paths = new Set();
    for (const request of report.network.requests) {
      try {
        const url = new URL(request?.url);
        origin ||= url.origin;
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin || url.search ||
          request?.method !== 'GET' || request?.allowed !== true) errors.push('successful network requests');
        paths.add(url.pathname);
      } catch { errors.push('successful network requests'); }
    }
    if (!paths.has(`/models/${modelManifest.model}/onnx/model_quantized.onnx`) ||
      !paths.has('/runtime/transformers.min.js') || !paths.has('/runtime/ort-wasm-simd-threaded.asyncify.wasm')) errors.push('network load evidence');
  }
  return errors;
}

/** Bind observations to the actual pre-inference budget instead of report claims. */
export function validateFrozenDeviceReport(report, freeze) {
  const errors = validateDeviceReport(report);
  const frozenContract = freeze?.contract;
  if (!frozenContract || typeof frozenContract !== 'object') return [...errors, 'frozen contract'];
  if (report?.memory?.limitBytes !== frozenContract.rssLimitBytes ||
    report?.memory?.intervalMs !== frozenContract.memorySampleIntervalMs ||
    report?.threadProfile?.requested !== frozenContract.threads) errors.push('frozen memory/thread budget');
  if (Array.isArray(report?.cases) && report.cases.some((c) => c?.status === 'ok' &&
    (!Number.isSafeInteger(frozenContract.maxNewTokens) || frozenContract.maxNewTokens <= 0 ||
    c.value?.generatedTokens > frozenContract.maxNewTokens || c.value?.elapsedMs > frozenContract.caseDeadlineMs))) errors.push('frozen generation budget');
  if (report?.load?.status === 'ok' && report.load.value?.loadMs > frozenContract.loadDeadlineMs) errors.push('frozen load budget');
  return errors;
}
