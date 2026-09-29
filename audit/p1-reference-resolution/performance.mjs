// Synthetic repeated-document benchmark through the production file reader
// and reconciliation entry. Local timings, not a browser/device SLA.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { readFile } from '../../lib/reconciliation/io.ts';
import { reconcileSupplierStatement } from '../../lib/reconciliation/supplier-reconciliation.ts';
import { selectImportMapping } from '../../lib/reconciliation/import-selection.ts';
import { ENGINE_VERSION } from '../../lib/reconciliation/types.ts';
const out = process.argv[2];
if (!out) throw new Error('Supply a new JSON output path');
const samples = [];
for (const size of [1000, 5000, 20000]) {
  const header = 'Date,Document No,Reference,Type,Amount';
  const rows = Array.from({ length: size }, (_, i) =>
    `2026-07-09,INV-8170,PART-${String(i + 1).padStart(6, '0')},Invoice,100.00`,
  );
  const start = performance.now();
  const encode = (text) => new TextEncoder().encode(text).buffer;
  const files = [
    await readFile('synthetic-supplier.csv', encode([header, ...rows].join('\n'))),
    await readFile('synthetic-ledger.csv', encode([header, ...rows.toReversed()].join('\n') + '\n')),
  ];
  const readMs = performance.now() - start;
  const mappings = files.map((f, i) => ({
    ...selectImportMapping(f, i ? 'ledger' : 'supplier').mapping, reference: 2,
  }));
  const beforeMatch = performance.now();
  const { result } = reconcileSupplierStatement({ files, mappings, scope: {
    supplier: 'Synthetic supplier', entity: 'Synthetic buyer', account: 'AP',
    currency: 'SAR', decimals: 2, cutoff: '2026-07-31', dateWindow: 2,
    confirmed: true, coverageConfirmed: false,
  }});
  const reconcileMs = performance.now() - beforeMatch;
  assert.equal(result.matches.length, size);
  assert.equal(result.cases.length, size);
  assert.equal(result.supplier.errors.length + result.ledger.errors.length, 0);
  const members = result.cases.flatMap((c) => {
    assert.equal(c.supplierMembers[0].chosenReference, c.ledgerMembers[0].chosenReference);
    assert.equal(c.variance, 0);
    return c.sourceTrace.map((t) => t.sourceRowId);
  });
  assert.equal(new Set(members).size, size * 2);
  samples.push({ rowsPerSource: size, matchedPairs: result.matches.length,
    readMs: Math.round(readMs), normalizeAndReconcileMs: Math.round(reconcileMs),
    rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) });
}
const report = { kind: 'Synthetic local timing, explicit reference selection; excludes export and browser rendering',
  engine: ENGINE_VERSION, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  cpu: os.cpus()[0].model, node: process.version, samples };
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
