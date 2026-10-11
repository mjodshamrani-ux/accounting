import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PG_ROLES,
  PG_VERSION,
  PG_SIGNED_VERSION,
} from '../lib/reconciliation/payment-gateway.ts';
import { readGatewayFile } from '../lib/reconciliation/payment-gateway-source.ts';
import {
  replayGateway,
  saveGateway,
  restoreGateway,
  exportGateway,
} from '../lib/reconciliation/payment-gateway-io.ts';
import { finishedGateway } from '../audit/payment-gateway/fixtures.ts';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(
  process.env.PG_SIGNED_PROOF_DIR || 'work/payment-gateway-signed/proof',
);
const corpus = path.join(root, 'audit/payment-gateway-signed');
const truths = JSON.parse(
  await readFile(path.join(corpus, 'handcrafted_truths.json'), 'utf8'),
);
await mkdir(output, { recursive: true });
const artifacts = [],
  checks = [];
async function input(name) {
  const dir = path.join(corpus, 'fixtures', name),
    bundle = JSON.parse(await readFile(path.join(dir, 'bundle.json'), 'utf8'));
  const files = await Promise.all(
    bundle.files.map(async (name) =>
      readGatewayFile(
        name,
        Uint8Array.from(await readFile(path.join(dir, name))).buffer,
      ),
    ),
  );
  return {
    files,
    readings: PG_ROLES.map((role, i) => ({
      role,
      family: bundle.readings[i],
      sheet: 0,
      confirmed: true,
    })),
    scope: { ...bundle.scope, confirmed: true },
    completeness: { confirmed: false, reference: '', note: '' },
    events: [],
  };
}
function review(result, type) {
  return {
    id: `${type}-${result.events.length + 1}`,
    type,
    batchId: result.scope.batchId,
    memberIds: [...result.memberIds],
    context: result.context,
    at: '2026-10-11T13:00:00.000Z',
    reference: 'Synthetic independent evidence review',
    note: 'Synthetic full inventory; not field evidence',
  };
}
async function emit(state, name, phase) {
  const fresh = await replayGateway(state);
  const saved = await saveGateway(fresh.state),
    restored = await restoreGateway(saved);
  assert.deepEqual(
    restored.result,
    fresh.result,
    'session round-trip preserves evidence and review',
  );
  if (truths[name]) {
    assert.equal(fresh.result.financial, truths[name].financial);
    assert.deepEqual(fresh.result.totals, truths[name].totalsMinor);
    assert.deepEqual(fresh.result.residuals, truths[name].residualsMinor);
  }
  const workbook = `${name}-${phase}.xlsx`,
    session = `${name}-${phase}.json`;
  await writeFile(path.join(output, session), new Uint8Array(saved));
  await writeFile(
    path.join(output, workbook),
    new Uint8Array(await exportGateway(restored.state, restored.result)),
  );
  artifacts.push({ workbook, session, case: name, phase });
  checks.push({
    case: name,
    phase,
    financial: fresh.result.financial,
    review: fresh.result.review,
    members: fresh.result.memberIds.length,
    records: fresh.result.records.map((rows) => rows.length),
    passed: true,
  });
  return fresh;
}
for (const [name, truth] of Object.entries(truths).filter(
  ([, truth]) =>
    ['ready', 'difference'].includes(truth.financial) &&
    !truth.formatEquivalentTo,
)) {
  let checked = await emit(await input(name), name, 'pending');
  if (truth.financial === 'ready') {
    checked.state.completeness = {
      confirmed: true,
      reference: 'Synthetic whole-batch attestation',
      note: 'Synthetic supplied inventory; not field evidence',
    };
    checked = await replayGateway(checked.state);
    checked.state.events.push(review(checked.result, 'accept'));
    checked = await emit(checked.state, name, 'accepted');
    assert.equal(checked.result.status, 'consistent-with-evidence');
    checked.state.events.push(review(checked.result, 'undo'));
    checked = await emit(checked.state, name, 'undo');
    assert.equal(checked.result.review, 'needs-review');
  }
  checked.state.events.push(review(checked.result, 'reject'));
  checked = await emit(checked.state, name, 'rejected');
  assert.equal(checked.result.review, 'rejected');
  await emit(
    (await restoreGateway(await saveGateway(checked.state))).state,
    name,
    'restored',
  );
}
for (const name of [
  'negative-sale-negative',
  'negative-sale-negative-zero',
  'negative-duplicate-transaction-even-invalid',
  'negative-canonical-header-signed-reading',
  'negative-multiple-payout',
  'missing-positive-fee-detail',
]) {
  const checked = await emit(await input(name), name, 'source-review');
  checked.state.events.push(review(checked.result, 'reject'));
  await emit(checked.state, name, 'rejected');
}
const canonical = await finishedGateway('pending');
await emit(canonical.state, 'canonical-pending', 'pending');
canonical.state.events.push(review(canonical.result, 'accept'));
const accepted = await emit(canonical.state, 'canonical-pending', 'accepted');
assert.ok(accepted.result.records[0].every((record) => !record.signedAmount));
assert.equal(accepted.result.readings[0].family, PG_VERSION);
const nativeDir = path.join(root, 'work/payment-gateway-signed/exports');
const native = JSON.parse(
  await readFile(path.join(nativeDir, 'index.json'), 'utf8'),
);
for (const [i, entry] of native.artifacts.entries()) {
  const stem = `unit-supported-${i}`;
  await copyFile(
    path.join(nativeDir, entry.workbook),
    path.join(output, stem + '.xlsx'),
  );
  await copyFile(
    path.join(nativeDir, entry.session),
    path.join(output, stem + '.json'),
  );
  artifacts.push({
    ...entry,
    workbook: stem + '.xlsx',
    session: stem + '.json',
  });
}
const index = {
  stage: 'LOCAL_PRODUCT_PROOF',
  synthetic: true,
  fieldOriginals: 0,
  family: PG_SIGNED_VERSION,
  artifacts,
  checks,
  passed: true,
};
await writeFile(
  path.join(output, 'evidence-index.json'),
  JSON.stringify(index, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    passed: true,
    productArtifactPairs: artifacts.length,
    lifecycleChecks: checks.length,
    nativeRepresentationPairs: native.artifacts.length,
    output,
  }),
);
