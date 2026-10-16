import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { createWorkerClient } from '../lib/reconciliation/worker-client.ts';
import {
  pdfLifecycleFixture,
  g3Contract,
  pdfDecision,
} from '../tests/helpers/inventory-pdf-lifecycle-fixture.ts';
const root = path.resolve(import.meta.dirname, '..');
const output =
  process.env.INV_PDF_WORKBOOK_PROOF_DIR ??
  path.join(root, 'work/inventory-pdf-workbook');
await mkdir(output, { recursive: true });
const out = await mkdtemp(path.join(output, 'run-'));
const fixture = await pdfLifecycleFixture();
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
  postMessage(m) {
    this.worker.postMessage(m);
  }
  terminate() {
    void this.worker.terminate();
  }
}
const port = new Port(),
  client = createWorkerClient(() => port, 60000),
  results = {};
let count = 0;
try {
  for (const code of [
    ...g3Contract.ready,
    ...g3Contract.difference,
    ...g3Contract.missing,
    ...Object.keys(g3Contract.sourceErrors),
  ]) {
    const state = await fixture.input(code),
      name = 'INV1F-' + code;
    const phases = {};
    const capture = async (phase) => {
      const replay = await client.request('stock-pdf-reconcile', state);
      const bytes = await client.request('stock-pdf-export', {
        state: replay.state,
        result: replay.result,
      });
      await writeFile(
        path.join(out, name + '-' + phase + '.xlsx'),
        Buffer.from(bytes),
      );
      phases[phase] = replay.result;
      count++;
      return replay;
    };
    await capture('unreviewed');
    if (g3Contract.ready.includes(code)) {
      state.completeness = {
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
        state.events.push(pdfDecision(r, type, 'decision-' + i));
        r = await capture(phase);
      }
    }
    results[name] = phases;
  }
} finally {
  port.terminate();
  await fixture.close();
}
const result = path.join(out, 'results.json');
await writeFile(result, JSON.stringify(results));
const checker = path.join(root, 'audit/inventory-pdf-workbook/check_export.py');
const run = (extra = []) =>
  spawnSync(
    process.env.PYTHON ?? 'python3',
    [
      '-B',
      checker,
      '--root',
      path.join(out, 'sources'),
      '--result',
      result,
      '--books',
      out,
      ...extra,
    ],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  );
const baseline = run();
await writeFile(
  path.join(out, 'baseline.log'),
  baseline.stdout + baseline.stderr,
);
assert.equal(baseline.status, 0, baseline.stderr);
assert.equal(count, 39);
const report = {
  out,
  baseline: JSON.parse(baseline.stdout),
  controls: [],
  reportControls: [],
  passed: false,
};
const edits = [
  ['positive-rewrite', null],
  [
    'swap-money-same-total',
    (b) => {
      const s = b.getWorksheet('Register'),
        a = s.getCell('J2').value;
      s.getCell('J2').value = s.getCell('J3').value;
      s.getCell('J3').value = a;
    },
  ],
  [
    'wrong-quantity',
    (b) => {
      b.getWorksheet('Register').getCell('G2').value = 500;
    },
  ],
  [
    'wrong-dimension',
    (b) => {
      b.getWorksheet('Register').getCell('F2').value =
        'warehouse=SOUTH;batch=LOT-X';
    },
  ],
  [
    'wrong-reference',
    (b) => {
      b.getWorksheet('Register').getCell('K2').value = 'VAL-FOREIGN';
    },
  ],
  [
    'wrong-page',
    (b) => {
      b.getWorksheet('Register').getCell('D2').value = 77;
    },
  ],
  [
    'wrong-link',
    (b) => {
      b.getWorksheet('PDF links').getCell('C2').value = 'foreign-member';
    },
  ],
  [
    'wrong-literal',
    (b) => {
      b.getWorksheet('PDF literals').getCell('J2').value = 'substituted';
    },
  ],
  [
    'wrong-raw-zero',
    (b) => {
      const s = b.getWorksheet('PDF records');
      const row = s
        .getRows(2, s.rowCount - 1)
        .find((r) => r.getCell(6).value === '00');
      assert.ok(row);
      row.getCell(6).value = '0';
    },
  ],
  [
    'missing-original',
    (b) => {
      b.getWorksheet('Sources').getCell('H2').value = 'AAAA';
    },
  ],
  [
    'missing-evidence-part',
    (b) => {
      b.getWorksheet('PDF evidence').spliceRows(2, 1);
    },
  ],
  [
    'unearned-approval',
    (b) => {
      const s = b.getWorksheet('Summary');
      s.eachRow((r) => {
        if (r.getCell(1).value === 'Review') r.getCell(2).value = 'accepted';
      });
    },
  ],
  [
    'wrong-page-total',
    (b) => {
      b.getWorksheet('PDF controls').getCell('C2').value = 1;
    },
  ],
  [
    'formula-instead-of-text',
    (b) => {
      b.getWorksheet('Register').getCell('E2').value = {
        formula: '1+1',
        result: 2,
      };
    },
  ],
  [
    'hidden-register-row',
    (b) => {
      b.getWorksheet('Register').getRow(2).hidden = true;
    },
  ],
];
const original = await readFile(path.join(out, 'INV1F-P02-unreviewed.xlsx'));
for (const [id, edit] of edits) {
  const b = new ExcelJS.Workbook();
  await b.xlsx.load(original);
  if (edit) edit(b);
  const target = path.join(out, 'control-' + id + '.xlsx');
  await writeFile(target, Buffer.from(await b.xlsx.writeBuffer()));
  const r = run(['--single', target, '--case', 'INV1F-P02']);
  await writeFile(
    path.join(out, 'control-' + id + '.log'),
    r.stdout + r.stderr,
  );
  assert.equal(r.signal, null, id);
  assert.ok(!r.error, id);
  if (edit) {
    assert.notEqual(r.status, 0, id);
    assert.match(r.stderr, /AssertionError/, id);
  } else assert.equal(r.status, 0, r.stderr);
  report.controls.push({
    id,
    expected: edit ? 'reject' : 'accept',
    passed: true,
  });
}
for (const [id, mutate, reason] of [
  [
    'numeric-scope-confirmation',
    (r) => {
      r.scope.confirmed = 1;
    },
    'SCOPE_READINGS',
  ],
  [
    'foreign-currency',
    (r) => {
      r.scope.currency = 'USD';
    },
    'SCOPE_READINGS',
  ],
  [
    'numeric-completeness-confirmation',
    (r) => {
      r.completeness.confirmed = 1;
    },
    'COMPLETENESS',
  ],
  [
    'wrong-decimals',
    (r) => {
      r.decimals = 2;
    },
    'VERSION_DECIMALS',
  ],
]) {
  const changed = structuredClone(results);
  const r = changed['INV1F-P02'].accepted;
  mutate(r);
  const context = JSON.parse(r.context);
  context[3] = r.scope;
  context[4] = r.completeness;
  r.context = JSON.stringify(context);
  for (const event of r.events) event.context = r.context;
  const file = path.join(out, 'report-control-' + id + '.json');
  await writeFile(file, JSON.stringify(changed));
  const check = run(['--result', file]);
  await writeFile(
    path.join(out, 'report-control-' + id + '.log'),
    check.stdout + check.stderr,
  );
  assert.equal(check.signal, null, id);
  assert.ok(!check.error, id);
  assert.notEqual(check.status, 0, id);
  assert.match(check.stderr, new RegExp('AssertionError: ' + reason), id);
  report.reportControls.push({ id, rejectedByOriginalMetadata: true });
}
report.passed = true;
await writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
