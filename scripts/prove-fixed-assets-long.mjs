// Produces actual worker lifecycle evidence from accepted frozen originals.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  assetLongFixture,
  assetLongRoot,
} from '../tests/helpers/fixed-assets-long-fixtures.ts';
import { AssetLongPort } from '../tests/helpers/fixed-assets-long-port.ts';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { ASSET_VERSION } from '../lib/reconciliation/fixed-assets.ts';
const root = resolve(
  process.env.ASSET_LONG_REPORT_DIR ||
    process.env.ASSET_LONG_PROOF_DIR ||
    'work/fixed-assets-long-proof',
);
const out = join(
  root,
  `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
await mkdir(out, { recursive: true });
const ports = [],
  client = createWorkerClient(() => {
    const p = new AssetLongPort();
    ports.push(p);
    return p;
  });
const oracle = JSON.parse(
  await readFile(
    new URL('accepted-oracle-results.json', assetLongRoot),
    'utf8',
  ),
);
const report = {
  syntheticOnly: true,
  actualNodeWorker: true,
  browserRun: false,
  productResultUsedForExpected: false,
  acceptedOracle: 'audit/fixed-assets-long/accepted-oracle-results.json',
  entries: [],
  blocked: [],
  invalidations: [],
  passed: false,
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function persist(name, state, truthCase, phase) {
  const folder = join(out, name);
  await mkdir(folder, { recursive: true });
  for (let i = 0; i < 4; i++)
    await writeFile(
      join(folder, `source-${i}.csv`),
      new Uint8Array(state.files[i].original),
    );
  // Only scope is a compute input. Frozen assertions are compared afterwards.
  await writeFile(
    join(folder, 'case.json'),
    JSON.stringify({ scope: state.scope }, null, 2) + '\n',
  );
  const direct = await client.request('asset-reconcile', state);
  const session = await client.request('asset-save', state);
  const restored = await client.request('asset-restore', { buffer: session });
  assert.deepEqual(restored.result, direct.result);
  const directExport = await client.request('asset-export', {
    state: direct.state,
    result: direct.result,
  });
  const restoredExport = await client.request('asset-export', {
    state: restored.state,
    result: restored.result,
  });
  for (const [file, bytes] of [
    ['session.json', session],
    ['direct.xlsx', directExport],
    ['restored.xlsx', restoredExport],
  ])
    await writeFile(join(folder, file), new Uint8Array(bytes));
  for (const [file, value] of [
    ['direct-result.json', direct.result],
    ['restored-result.json', restored.result],
  ])
    await writeFile(join(folder, file), JSON.stringify(value, null, 2) + '\n');
  const artifacts = {};
  for (const file of [
    'source-0.csv',
    'source-1.csv',
    'source-2.csv',
    'source-3.csv',
    'case.json',
    'session.json',
    'direct.xlsx',
    'restored.xlsx',
    'direct-result.json',
    'restored-result.json',
  ]) {
    const bytes = await readFile(join(folder, file));
    artifacts[file] = { bytes: bytes.length, sha256: digest(bytes) };
  }
  report.entries.push({
    folder: name,
    truthCase,
    phase,
    financial: direct.result.financial,
    review: direct.result.review,
    status: direct.result.status,
    context: direct.result.context,
    memberIds: direct.result.memberIds,
    events: direct.result.events,
    artifacts,
  });
  return direct;
}
function review(state, result, type, id) {
  state.events.push({
    id,
    type,
    context: result.context,
    memberIds: [...result.memberIds],
    at: '2026-10-10T00:00:00.000Z',
    reference: 'SYN-REVIEW',
    note: 'Synthetic full original physical scope',
  });
}
try {
  for (const truth of oracle.cases) {
    const state = await assetLongFixture(truth.case);
    const direct = await persist(truth.case, state, truth.case, 'unreviewed');
    assert.equal(direct.result.financial, truth.result.financial, truth.case);
    assert.deepEqual(direct.result.totals, truth.result.totals, truth.case);
  }
  for (const name of [
    '01-two-assets-separated',
    '10-all-zero-members-retained',
    '29-missing-zero-mapping',
    '42-malformed-last-row-width',
    '39-net-equal-component-differences',
    '20-blank-amount-not-zero',
  ]) {
    const state = await assetLongFixture(name);
    state.completeness = {
      confirmed: true,
      reference: 'SYN-COMPLETE',
      note: 'Synthetic selected account scope',
    };
    let direct = await persist(`${name}--complete`, state, name, 'complete');
    if (direct.result.financial === 'ready') {
      review(state, direct.result, 'accept', 'SYN-A');
      direct = await persist(`${name}--accept`, state, name, 'accept');
      assert.equal(direct.result.review, 'accepted');
      review(state, direct.result, 'undo', 'SYN-U');
      direct = await persist(`${name}--undo`, state, name, 'undo');
      assert.equal(direct.result.review, 'needs-review');
    } else {
      const invalid = structuredClone(state);
      review(invalid, direct.result, 'accept', 'SYN-BLOCK');
      await assert.rejects(
        client.request('asset-reconcile', invalid),
        /EVENT_ACCEPT/,
      );
      report.blocked.push({
        truthCase: name,
        action: 'accept',
        expected: 'ASSET_EVENT_ACCEPT',
      });
    }
    review(state, direct.result, 'reject', 'SYN-R');
    direct = await persist(`${name}--reject`, state, name, 'reject');
    assert.equal(direct.result.review, 'rejected');
  }
  const state = await assetLongFixture();
  state.completeness = {
    confirmed: true,
    reference: 'SYN-COMPLETE',
    note: 'Synthetic selected account scope',
  };
  const initial = await client.request('asset-reconcile', state);
  review(state, initial.result, 'accept', 'SYN-A');
  for (const change of ['family', 'completeness', 'scope', 'source-hash']) {
    const changed = structuredClone(state);
    if (change === 'family') changed.readings[0].family = ASSET_VERSION;
    if (change === 'completeness')
      changed.completeness.note = 'Synthetic revised confirmation';
    if (change === 'scope') changed.scope.postingLayer = 'other';
    if (change === 'source-hash') {
      const original = new TextEncoder().encode(
        new TextDecoder().decode(changed.files[0].original) + '\n',
      ).buffer;
      changed.files[0] = await client.request('asset-read', {
        name: 'changed-0.csv',
        buffer: original,
      });
    }
    await assert.rejects(client.request('asset-reconcile', changed), /EVENT/);
    changed.events = [];
    const fresh = await client.request('asset-reconcile', changed);
    assert.notEqual(fresh.result.context, initial.result.context);
    assert.equal(fresh.result.review, 'needs-review');
    if (change !== 'family')
      await persist(
        `invalidation--${change}`,
        changed,
        '01-two-assets-separated',
        `invalidation-${change}`,
      );
    report.invalidations.push({
      change,
      oldContext: initial.result.context,
      newContext: fresh.result.context,
      review: fresh.result.review,
      oldDecisionRejected: true,
    });
  }
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  ports.forEach((p) => p.terminate());
  await writeFile(
    join(out, 'REPORT.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  const reportBytes = await readFile(join(out, 'REPORT.json'));
  await writeFile(
    join(root, 'LAST-ATTEMPT.json'),
    JSON.stringify(
      {
        attempt: basename(out),
        reportSha256: digest(reportBytes),
        passed: report.passed,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      entries: report.entries.length,
      blocked: report.blocked.length,
      invalidations: report.invalidations.length,
    }),
  );
}
