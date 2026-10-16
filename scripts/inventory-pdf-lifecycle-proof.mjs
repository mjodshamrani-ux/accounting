// Genuine Node structured-clone Worker boundary, learned sealed originals.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import { STOCK_PDF_LIFECYCLE_VERSION } from '../lib/reconciliation/inventory-pdf-request.ts';
import {
  pdfLifecycleFixture,
  g3Contract,
  pdfDecision,
} from '../tests/helpers/inventory-pdf-lifecycle-fixture.ts';
const root = path.resolve(import.meta.dirname, '..');
const output =
  process.env.INV_PDF_LIFECYCLE_PROOF_DIR ??
  path.join(root, 'work/inventory-pdf-lifecycle');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-')),
  fixture = await pdfLifecycleFixture();
await cp(fixture.root, path.join(out, 'sources'), { recursive: true });
class Port {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  worker = new Worker(
    new URL('../tests/helpers/bank-wd-worker.mjs', import.meta.url),
  );
  constructor() {
    this.worker.on('message', (data) => this.onmessage?.({ data }));
    this.worker.on('error', (e) => this.onerror?.({ message: e.message }));
  }
  postMessage(message) {
    this.worker.postMessage(message);
  }
  terminate() {
    void this.worker.terminate();
  }
}
const port = new Port(),
  client = createWorkerClient(() => port, 60000);
const proof = { version: STOCK_PDF_LIFECYCLE_VERSION, cases: {} };
const serialize = (v) => ({
  ...v,
  state: {
    ...v.state,
    files: v.state.files.map((f) => ({
      name: f.name,
      sha256: f.sha256,
      data: Buffer.from(f.original).toString('base64'),
    })),
  },
});
try {
  for (const code of [
    ...g3Contract.ready,
    ...g3Contract.difference,
    ...g3Contract.missing,
    ...Object.keys(g3Contract.sourceErrors),
  ]) {
    const s = await fixture.input(code),
      phases = {};
    const capture = async (phase) => {
      const value = await client.request('stock-pdf-reconcile', s);
      const saved = await client.request('stock-pdf-save', s);
      const restored = await client.request('stock-pdf-restore', {
        buffer: saved,
      });
      assert.deepEqual(restored, value);
      phases[phase] = {
        value: serialize(value),
        restored: serialize(restored),
        session: JSON.parse(new TextDecoder().decode(saved)),
      };
      return value;
    };
    await capture('unreviewed');
    if (g3Contract.ready.includes(code)) {
      s.completeness = {
        confirmed: true,
        reference: 'Synthetic completeness review',
        note: 'All original pages reviewed',
      };
      let r = await capture('complete');
      for (const [i, [type, phase]] of [
        ['accept', 'accepted'],
        ['undo', 'undone'],
        ['reject', 'rejected'],
        ['undo', 'reopened'],
      ].entries()) {
        const e = pdfDecision(r, type, 'decision-' + i);
        e.note = 'All supplied scope reviewed';
        s.events.push(e);
        r = await capture(phase);
      }
    }
    proof.cases['INV1F-' + code] = phases;
  }
} finally {
  port.terminate();
  await fixture.close();
}
const file = path.join(out, 'results.json');
await writeFile(file, JSON.stringify(proof));
const checker = path.join(
  root,
  'audit/inventory-pdf-lifecycle/check_lifecycle.py',
);
const run = (input) =>
  spawnSync(
    process.env.PYTHON ?? 'python3',
    ['-B', checker, '--root', path.join(out, 'sources'), '--result', input],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  );
const baseline = run(file);
await writeFile(
  path.join(out, 'baseline.log'),
  baseline.stdout + baseline.stderr,
);
assert.equal(baseline.status, 0, baseline.stderr);
const checks = {
  out,
  baseline: JSON.parse(baseline.stdout),
  faults: [],
  passed: false,
};
const faults = [
  [
    'numeric-session-confirmation',
    (p) => {
      p.cases['INV1F-P02'].accepted.session.scope.confirmed = 1;
    },
  ],
  [
    'accepted-without-decision',
    (p) => {
      p.cases['INV1F-P02'].unreviewed.value.result.review = 'accepted';
    },
  ],
  [
    'stale-context-version',
    (p) => {
      const r = p.cases['INV1F-P02'].accepted.value.result;
      const c = JSON.parse(r.context);
      c[0] = 'inventory-posted-register-gl-1';
      r.context = JSON.stringify(c);
    },
  ],
  [
    'foreign-original',
    (p) => {
      const e = p.cases['INV1F-P02'].accepted;
      e.value.state.files[0] =
        p.cases['INV1F-P03'].accepted.value.state.files[0];
      e.session.files[0] = e.value.state.files[0];
    },
  ],
  [
    'dropped-decision-member',
    (p) => {
      p.cases['INV1F-P02'].accepted.value.state.events[0].memberIds.pop();
    },
  ],
  [
    'foreign-decision-context',
    (p) => {
      p.cases['INV1F-P02'].accepted.value.state.events[0].context = 'foreign';
    },
  ],
  [
    'unproved-completeness',
    (p) => {
      p.cases['INV1F-P02'].accepted.value.state.completeness.confirmed = false;
    },
  ],
  [
    'changed-last-page-glyph',
    (p) => {
      const pages =
        p.cases['INV1F-P04'].unreviewed.value.result.pdfEvidence.reading.source
          .pages;
      pages.at(-1).literals.text = 'FORGED';
    },
  ],
  [
    'same-total-wrong-quantity',
    (p) => {
      p.cases['INV1F-P02'].unreviewed.value.result.records[0][0].values[2]++;
    },
  ],
  [
    'foreign-map-owner',
    (p) => {
      const l = p.cases['INV1F-P02'].unreviewed.value.result.pdfEvidence.links;
      l[0].mappingIds = l[1].mappingIds;
    },
  ],
  [
    'false-clean-difference',
    (p) => {
      p.cases['INV1F-N04'].unreviewed.value.result.financial = 'ready';
    },
  ],
  [
    'old-session-version',
    (p) => {
      p.cases['INV1F-P02'].unreviewed.session.version = 'old';
    },
  ],
  [
    'cache-in-session',
    (p) => {
      p.cases['INV1F-P02'].unreviewed.session.result = {
        status: 'consistent-with-evidence',
      };
    },
  ],
  [
    'lost-undo',
    (p) => {
      p.cases['INV1F-P02'].undone.value.state.events.pop();
    },
  ],
  [
    'lost-review-phase',
    (p) => {
      delete p.cases['INV1F-P02'].reopened;
    },
  ],
  [
    'omitted-positive',
    (p) => {
      delete p.cases['INV1F-P04'];
    },
  ],
];
for (const [id, change] of faults) {
  const p = structuredClone(proof);
  change(p);
  // Keep the response/replay/session representations consistent where possible.
  // The independent source/decision assertions must detect the semantic fault.
  for (const phases of Object.values(p.cases))
    for (const e of Object.values(phases)) {
      e.value.result.events = structuredClone(e.value.state.events);
      e.session.events = structuredClone(e.value.state.events);
      e.value.result.completeness = structuredClone(e.value.state.completeness);
      e.session.completeness = structuredClone(e.value.state.completeness);
      e.restored = structuredClone(e.value);
    }
  assert.notEqual(
    JSON.stringify(p),
    JSON.stringify(proof),
    'No-op fault ' + id,
  );
  const f = path.join(out, 'fault-' + id + '.json');
  await writeFile(f, JSON.stringify(p));
  const r = run(f);
  await writeFile(path.join(out, 'fault-' + id + '.log'), r.stdout + r.stderr);
  const killed = r.status !== 0 && /AssertionError:/.test(r.stderr) && !r.error;
  checks.faults.push({ id, killed });
  assert.ok(killed, id + ': ' + r.stderr);
}
// Semantic JSON rewrite must still pass: byte layout is not original authority.
const rewritten = path.join(out, 'rewritten.json');
await writeFile(rewritten, JSON.stringify(proof, null, 1));
const rewrite = run(rewritten);
assert.equal(rewrite.status, 0, rewrite.stderr);
checks.rewriteAccepted = true;
checks.passed = true;
await writeFile(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
