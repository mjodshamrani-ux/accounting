// Runs the product on the sealed S3 holdout and judges every run.
//
//   node --experimental-strip-types audit/supplier-statement-holdout-s3/run.mjs [--out file] [--assert file]
//
// For each story: the statement PDF is read as the supplier workspace reads
// it (native text, columns proposed), the ledger CSV as an export, the
// mappings are the ones the product selects, and the scope is the story's.
// Two runs:
// - unaided: nothing declared;
// - declared: the accountant declares the PDF reading reviewed
//   (pdfReviewed), as the supplier workspace asks before it compares a PDF.
// Nothing else is supplied: no column, format or reference is corrected.
// judge.mjs says what each run proves. --assert compares a new run with a
// recorded one, verdict by verdict and count by count.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { judge, outcome, selfTest } from './judge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { values: args } = parseArgs({
  options: { frozen: { type: 'string', default: resolve(here, 'frozen') }, out: { type: 'string' },
    assert: { type: 'string' } },
});
const load = (m) => import(pathToFileURL(resolve(root, m)).href);
const { readFile } = await load('lib/reconciliation/io.ts');
const { selectImportMapping } = await load('lib/reconciliation/import-selection.ts');
const { reconcileSupplierStatement } = await load('lib/reconciliation/supplier-reconciliation.ts');
const { engineCatalog } = await load('lib/i18n/engine-catalog.ts');

const patterns = Object.keys(engineCatalog).map(
  (k) => new RegExp(k.split('${…}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*?')),
);
const known = (m) => {
  const text = String(m).replace(/^[^:\n]{1,120}\.(?:csv|xlsx|pdf):\s*/i, '');
  return patterns.some((p) => p.test(text));
};
const git = (...c) => spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const buffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const judgeSelfTest = selfTest().length;
const manifestBytes = readFileSync(resolve(args.frozen, 'INPUT-MANIFEST.json'));
const oracle = JSON.parse(readFileSync(resolve(args.frozen, 'expected.json'), 'utf8'));
const results = [];
for (const expected of oracle.stories) {
  const s = expected.scope;
  const scope = { supplier: s.supplier, entity: s.entity, account: s.account, currency: s.currency,
    decimals: s.decimals, cutoff: s.cutoff, dateWindow: s.dateWindow, confirmed: true, coverageConfirmed: false };
  const record = { id: expected.id, kind: expected.kind, runs: {} };
  let pdf, ledger;
  try {
    pdf = await readFile(`${expected.id}-statement.pdf`,
      buffer(readFileSync(resolve(args.frozen, `${expected.id}-statement.pdf`))), undefined, true);
    ledger = await readFile(`${expected.id}-ledger.csv`,
      buffer(readFileSync(resolve(args.frozen, `${expected.id}-ledger.csv`))));
  } catch (e) {
    for (const mode of ['unaided', 'declared']) record.runs[mode] = judge(expected, { stopped: e?.message ?? e }, known);
    record.outcome = outcome(expected, record.runs);
    results.push(record);
    console.log(expected.id.padEnd(4), 'read refused:', record.runs.declared.verdict, record.runs.declared.stopped);
    continue;
  }
  for (const mode of ['unaided', 'declared']) {
    let run;
    try {
      const supplierMapping = { ...selectImportMapping(pdf, 'supplier').mapping };
      const ledgerMapping = { ...selectImportMapping(ledger, 'ledger').mapping };
      if (mode === 'declared') supplierMapping.pdfReviewed = true;
      run = { result: reconcileSupplierStatement({ files: [pdf, ledger], mappings: [supplierMapping, ledgerMapping],
        scope }).result };
    } catch (e) {
      run = { stopped: e?.message ?? String(e) };
    }
    record.runs[mode] = judge(expected, run, known);
  }
  record.outcome = outcome(expected, record.runs);
  results.push(record);
  const d = record.runs.declared;
  console.log(expected.id.padEnd(4), record.outcome.padEnd(6), '| unaided', record.runs.unaided.verdict.padEnd(10),
    '| declared', d.verdict.padEnd(10), JSON.stringify(d.counts), d.stopped ?? '', d.findings.slice(0, 2).join(' / '));
}
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const tally = (f) => Object.fromEntries([...new Set(results.map(f))].sort(byText).map((v) => [v, results.filter((r) => f(r) === v).length]));
const summary = {
  version: 'tarasuf-supplier-s3-run-1',
  provenance: {
    engine: { commit: git('rev-parse', 'HEAD'), engineFilesModified: !!git('status', '--porcelain', '--', 'lib') },
    holdout: { manifestSha256: sha(manifestBytes), judgeSha256: sha(readFileSync(resolve(here, 'judge.mjs'))),
      runnerSha256: sha(readFileSync(resolve(here, 'run.mjs'))) },
    node: process.version,
    judgeSelfTest,
  },
  positives: { stories: results.filter((r) => r.kind === 'positive').length,
    pass: results.filter((r) => r.kind === 'positive' && r.outcome === 'pass').length },
  reserved: { stories: results.filter((r) => r.kind === 'reserved').length,
    pass: results.filter((r) => r.kind === 'reserved' && r.outcome === 'pass').length },
  unsafeRuns: results.flatMap((r) => Object.values(r.runs)).filter((r) => r.verdict === 'unsafe').length,
  wrongApprovals: results.flatMap((r) => Object.values(r.runs)).reduce((n, r) => n + r.counts.wrongApprovals, 0),
  unaided: tally((r) => r.runs.unaided.verdict),
  declared: tally((r) => r.runs.declared.verdict),
  results,
};
console.log(JSON.stringify({ positives: summary.positives, reserved: summary.reserved, unsafeRuns: summary.unsafeRuns,
  wrongApprovals: summary.wrongApprovals, unaided: summary.unaided, declared: summary.declared }));
if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 1) + '\n');
if (args.assert) {
  const recorded = JSON.parse(readFileSync(args.assert, 'utf8'));
  const shape = (s) => JSON.stringify(s.results.map((r) => [r.id, r.outcome,
    Object.fromEntries(Object.entries(r.runs).map(([m, x]) => [m, [x.verdict, x.counts]]))]));
  if (recorded.provenance.holdout.manifestSha256 !== summary.provenance.holdout.manifestSha256)
    throw new Error('the record is of another seal');
  if (shape(recorded) !== shape(summary)) throw new Error('the run differs from the record');
  console.log('matches the record', args.assert);
}
