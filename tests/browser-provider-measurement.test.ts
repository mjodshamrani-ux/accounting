import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BrowserProviderController } from '../audit/local-provider/browser-v1/controller.mjs';
import { validateDeviceReport, validateFrozenDeviceReport } from '../audit/local-provider/device-measurement-v1/schema.mjs';

function fixture() {
  const workers: Array<{
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: (() => void) | null;
    sent: Array<{ id: number }>;
    terminated: number;
    postMessage: (message: { id: number }) => void;
    terminate: () => void;
  }> = [];
  const controller = new BrowserProviderController(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      sent: [] as Array<{ id: number }>,
      terminated: 0,
      postMessage(message: { id: number }) { this.sent.push(message); },
      terminate() { this.terminated++; },
    };
    workers.push(worker);
    return worker;
  });
  return { controller, workers };
}

void test('actual worker ownership: cancel terminates and rejects late replies across replacement', async () => {
  const { controller, workers } = fixture();
  const first = controller.request('infer', {}, 1000);
  const oldReply = workers[0].onmessage!;
  const firstId = workers[0].sent[0].id;
  controller.cancel();
  assert.deepEqual(await first, { status: 'fallback', reason: 'cancelled', error: null });
  assert.equal(workers[0].terminated, 1);
  const replacement = controller.request('load', {}, 1000);
  oldReply({ data: { id: firstId, type: 'result', value: 'stale' } });
  assert.equal(controller.staleReplies, 1);
  assert.notEqual(controller.active, null);
  workers[1].onmessage!({ data: { id: workers[1].sent[0].id, type: 'result', value: 'fresh' } });
  assert.deepEqual(await replacement, { status: 'ok', value: 'fresh' });
  controller.cancel('cleanup');
});

void test('hard deadline terminates computation and clears request', async () => {
  const { controller, workers } = fixture();
  const result = await controller.request('infer', {}, 5);
  assert.equal(result.status, 'fallback');
  assert.equal('reason' in result && result.reason, 'deadline');
  assert.equal(workers[0].terminated, 1);
  assert.equal(controller.active, null);
  assert.equal(controller.worker, null);
  assert.throws(() => controller.request('load', {}, 0), /deadline/);
});

void test('asset/runtime errors and unavailable worker fall back without proposal output', async () => {
  const { controller, workers } = fixture();
  const pending = controller.request('load', {}, 1000);
  workers[0].onmessage!({ data: { id: workers[0].sent[0].id, type: 'error', error: 'Missing local config' } });
  assert.deepEqual(await pending, { status: 'fallback', reason: 'runtime-unavailable', error: 'Missing local config' });
  assert.equal(workers[0].terminated, 1);
  const unavailable = new BrowserProviderController(() => { throw new Error('No workers'); });
  const result = await unavailable.request('load', {}, 1000);
  assert.equal('reason' in result && result.reason, 'worker-unavailable');
  assert.equal(unavailable.active, null);
});

function validReport() {
  const measured = JSON.parse(readFileSync('audit/local-provider/device-measurement-v1/host-run-3/observations.json', 'utf8'));
  return {
    version: 'p5-browser-device-measurement-v1', productEnabled: false, developmentOnly: true,
    semanticAcceptance: false, synthetic: true, physicalWeakDeviceEvidence: false, runtimeSmokePassed: false,
    startedAt: '2026-10-08T00:00:00Z', completedAt: '2026-10-08T00:00:01Z', errors: [],
    freezeSha256: 'a'.repeat(64), host: { ramBytes: 8 * 1024 ** 3 },
    browser: { version: 'Chrome test' }, backend: 'wasm', threadProfile: { requested: 4 },
    model: measured.model,
    assets: measured.assets,
    runtime: measured.runtime,
    memory: { method: 'CDP SystemInfo.getProcessInfo owned Chrome PIDs + complete ps RSS sum',
      samples: [], gaps: [], peakBytes: null, limitBytes: 6 * 1024 ** 3, intervalMs: 500, limitExceeded: false },
    network: { requests: [], osAirGap: false },
    load: { status: 'fallback', reason: 'runtime-unavailable', wallMs: 1 }, cases: [],
  };
}

void test('device schema preserves the physical evidence boundary and complete-memory method', () => {
  assert.deepEqual(validateDeviceReport(validReport()), []);
  assert.ok(validateDeviceReport({ ...validReport(), physicalWeakDeviceEvidence: true }).includes('physical weak-device evidence'));
  assert.ok(validateDeviceReport({ ...validReport(), physicalWeakDeviceEvidence: true,
    deviceEvidence: { physical: true, throttled: true, deviceId: 'fast-host', classificationBasis: 'CPU throttled' },
  }).includes('physical weak-device evidence'));
  assert.ok(validateDeviceReport({ ...validReport(), network: { requests: [], osAirGap: true } }).includes('network boundary'));
  assert.ok(validateDeviceReport({ ...validReport(), memory: { method: 'renderer heap', samples: [], gaps: [] } }).includes('memory method'));
});

void test('frozen browser contract keeps smoke scope and bounded inference separate from product acceptance', () => {
  const contract = JSON.parse(readFileSync('audit/local-provider/browser-v1/contract.json', 'utf8'));
  assert.equal(contract.developmentOnly, true);
  assert.equal(contract.productEnabled, false);
  assert.equal(contract.semanticAcceptance, false);
  assert.equal(contract.physicalWeakDeviceEvidence, false);
  assert.equal(contract.backend, 'wasm');
  assert.equal(contract.cases.length, 4);
  assert.equal(contract.rssLimitBytes, 6 * 1024 ** 3);
  assert.ok(contract.loadDeadlineMs <= 60000 && contract.caseDeadlineMs <= 60000);
});

void test('actual successful measurement validates, while corrupt critical evidence fails', () => {
  const measured = JSON.parse(readFileSync('audit/local-provider/device-measurement-v1/host-run-3/observations.json', 'utf8'));
  assert.deepEqual(validateDeviceReport(measured), []);
  assert.equal(measured.runtimeSmokePassed, true);
  assert.equal(measured.physicalWeakDeviceEvidence, false);
  for (const mutate of [
    (r: typeof measured) => { r.threadProfile.requested = 0; },
    (r: typeof measured) => { r.runtimeSmokePassed = 'true'; },
    (r: typeof measured) => { delete r.runtimeSmokePassed; },
    (r: typeof measured) => { r.assets.push(null); },
    (r: typeof measured) => { r.memory.samples.push(null); },
    (r: typeof measured) => { r.memory.gaps.push(null); },
    (r: typeof measured) => { r.cases.push(null); },
    (r: typeof measured) => { r.network.requests.push(null); },
    (r: typeof measured) => { r.errors.push('Unexpected browser error'); },
    (r: typeof measured) => { r.cases = [r.cases[0]]; },
    (r: typeof measured) => { r.network.requests = []; },
    (r: typeof measured) => { r.runtime.transformers = '999'; },
    (r: typeof measured) => { r.network.requests[0].method = 'POST'; },
    (r: typeof measured) => { r.physicalWeakDeviceEvidence = 'true'; },
    (r: typeof measured) => { r.model.revision = 'latest'; },
    (r: typeof measured) => { r.model.totalBytes = 0; },
    (r: typeof measured) => { r.assets[0].bytes++; },
    (r: typeof measured) => { r.memory.samples[0].bytes = 0; },
    (r: typeof measured) => { r.memory.samples[0].pids.push(r.memory.samples[0].pids[0]); },
    (r: typeof measured) => { r.memory.peakBytes = 0; },
    (r: typeof measured) => { r.cases[0].wallMs = -1; },
    (r: typeof measured) => { r.cases[0].value.generatedTokens++; },
    (r: typeof measured) => { r.cases[0].value.generatedTokens++; r.cases[0].value.generatedTokenIds.push(1); },
    (r: typeof measured) => { delete r.load; },
    (r: typeof measured) => { r.memory.samples = []; r.memory.peakBytes = null; },
    (r: typeof measured) => { r.completedAt = 'invalid'; },
  ]) {
    const corrupted = structuredClone(measured);
    mutate(corrupted);
    assert.ok(validateDeviceReport(corrupted).length > 0);
  }
  const failure = JSON.parse(readFileSync('audit/local-provider/device-measurement-v1/host-run-2/observations.json', 'utf8'));
  assert.deepEqual(validateDeviceReport(failure), []);
  assert.equal(failure.runtimeSmokePassed, false);
});

void test('frozen verifier rejects report budget inflation even when its own numbers are consistent', () => {
  const measured = JSON.parse(readFileSync('audit/local-provider/device-measurement-v1/host-run-3/observations.json', 'utf8'));
  const freeze = JSON.parse(readFileSync('audit/local-provider/device-measurement-v1/host-run-3/freeze.json', 'utf8'));
  assert.deepEqual(validateFrozenDeviceReport(measured, freeze), []);
  const raisedLimit = structuredClone(measured);
  raisedLimit.memory.limitBytes *= 2;
  raisedLimit.memory.limitExceeded = raisedLimit.memory.samples.some((s: { bytes: number }) => s.bytes > raisedLimit.memory.limitBytes);
  assert.ok(validateFrozenDeviceReport(raisedLimit, freeze).includes('frozen memory/thread budget'));
  const changedInterval = structuredClone(measured);
  changedInterval.memory.intervalMs *= 2;
  assert.ok(validateFrozenDeviceReport(changedInterval, freeze).includes('frozen memory/thread budget'));
  const lowerFrozenTokenBudget = structuredClone(freeze);
  lowerFrozenTokenBudget.contract.maxNewTokens = 15;
  assert.ok(validateFrozenDeviceReport(measured, lowerFrozenTokenBudget).includes('frozen generation budget'));
});
