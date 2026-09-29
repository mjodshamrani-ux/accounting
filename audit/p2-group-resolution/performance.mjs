// Synthetic production CSV -> verified normalization -> comparison. No UI or
// Excel timing and no claim about every machine or a field-work accuracy rate.
import assert from 'node:assert/strict';
import { readFile as fsRead, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { readFile } from '../../lib/reconciliation/io.ts';
import { reconcileSupplierStatement } from '../../lib/reconciliation/supplier-reconciliation.ts';
import { defaultMapping, ENGINE_VERSION } from '../../lib/reconciliation/types.ts';

const out = process.argv[2];
assert.ok(out, 'Pass a new JSON result path');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { revision, engine: ENGINE_VERSION, runAt: new Date().toISOString(), runtime: process.version, cpu: os.cpus()[0].model, platform: os.platform(), scope: 'Synthetic CSV read and engine comparison only; UI/export excluded; no field accuracy claim', scenarios: [] };
const scope = { supplier: 'Synthetic supplier', entity: 'Synthetic company', account: 'AP', currency: 'SAR', decimals: 2, cutoff: '2026-07-31', dateWindow: 2, confirmed: true, coverageConfirmed: false };
const mapping = { ...defaultMapping(), date: 0, reference: 1, amount: 2, currencyColumn: 7, description: 8 };
for (const mode of ['ten-thousand-complete-groups', 'twenty-thousand-normalized-collisions']) {
  const content = ['supplier', 'ledger'].map((side) => {
    const lines = ['Date,Document No,Amount,Type,Bank Reference,Receipt No,Voucher No,Currency,Description'];
    for (let i = 0; i < 20000; i++) {
      const group = Math.floor(i / 2);
      const bank = mode === 'ten-thousand-complete-groups' ? `BANK-P2-${group}` : 'BANK' + Array.from({ length: 15 }, (_, bit) => `${(i >> bit) & 1 ? '-' : ''}${bit % 10}`).join('');
      const amount = mode === 'ten-thousand-complete-groups' ? (side === 'supplier' ? ['-40', '-60'] : ['-25', '-75'])[i % 2] : '-1';
      lines.push(`2026-07-15,DOC-${side}-${i},${amount},Payment,${bank},,VOUCHER-${side}-${i},SAR,Synthetic part`);
    }
    return new TextEncoder().encode(lines.join('\n')).buffer;
  });
  const begin = performance.now();
  const files = await Promise.all(content.map((bytes, i) => readFile(`${i ? 'ledger' : 'supplier'}.csv`, bytes)));
  const readMs = performance.now() - begin;
  const stages = {};
  let previous = performance.now();
  const { result } = reconcileSupplierStatement({ files, mappings: [mapping, mapping], scope }, (stage) => {
    const now = performance.now(); stages[stage] = now - previous; previous = now;
  });
  assert.equal(result.supplier.errors.length + result.ledger.errors.length, 0);
  const ids = result.cases.flatMap((c) => c.sourceTrace.map((t) => t.sourceRowId));
  assert.equal(ids.length, 40000); assert.equal(new Set(ids).size, 40000);
  if (mode === 'ten-thousand-complete-groups') {
    assert.equal(result.matches.length, 10000);
    assert.ok(result.cases.every((c) => c.classification === 'EXACT_MANY_TO_MANY' && c.status === 'Matched' && c.supplierTotal === -10000 && c.ledgerTotal === -10000 && new Set([...c.supplierMembers, ...c.ledgerMembers].map((t) => t.bankReference)).size === 1));
  } else {
    assert.equal(result.matches.length, 0);
    assert.equal(result.cases.length, 1);
    assert.equal(result.cases[0].matchingRule, 'PAYMENT_IDENTITY_COMPONENT_REVIEW_V1');
  }
  report.scenarios.push({ mode, sourceRowsPerSide: 20000, readMs, ...stages, elapsedMs: performance.now() - begin, maxRssMiB: process.resourceUsage().maxRSS / 1024, rssMiB: process.memoryUsage().rss / 1048576, approvedGroups: result.matches.length, accountedSourceRows: ids.length, sourceHashes: content.map((b) => createHash('sha256').update(new Uint8Array(b)).digest('hex')) });
}
try { await fsRead(out); throw Error('Refusing to overwrite an existing result'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
