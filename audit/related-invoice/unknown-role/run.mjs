import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(process.argv[2] ?? '.');
const out = path.resolve(process.argv[3] ?? 'work/unknown-role');
const dir = 'audit/related-invoice/unknown-role';
await mkdir(out, { recursive: true });
const load = (n) =>
  import(pathToFileURL(path.join(root, 'lib/reconciliation', n + '.ts')));
const { readFile: read, exportWorkbook } = await load('io');
const { selectImportMapping } = await load('import-selection');
const { reconcileSupplierStatement } = await load('supplier-reconciliation');
const { saveSession, restoreSession } = await load('session');
const { ENGINE_VERSION } = await load('types');
const contractBytes = await readFile(dir + '/contract.json');
const contract = JSON.parse(contractBytes);
const observations = [];
for (const ext of ['xlsx', 'csv'])
  for (const c of contract.cases) {
    const files = await Promise.all(
      ['supplier.' + ext, 'ledger.csv'].map(async (suffix) => {
        const name = c.id + '-' + suffix,
          b = await readFile(dir + '/frozen/' + name);
        return read(
          name,
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        );
      }),
    );
    const mappings = files.map(
      (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
    );
    if (c.chosenReference) for (const m of mappings) m.reference = 6;
    const input = { files, mappings, scope: contract.scope };
    const direct = reconcileSupplierStatement(input).result;
    const restored = await restoreSession(
      await saveSession({
        ...input,
        decisions: [],
        rejected: [],
        events: [],
        review: { name: '', notes: '', checked: false },
      }),
    );
    const summary = (r) => ({
      approved: r.caseCounts.autoMatchedCases,
      needsReview: r.caseCounts.needsReviewSourceRows,
      fullReconciliation: r.balanceComparable,
      movements: [r.supplier, r.ledger].map((s) =>
        s.transactions.map((t) => ({
          row: t.row,
          amount: t.amount,
          type: t.documentType,
          retained: t.retainedEvidence,
          issues: t.referenceEvidenceIssues,
          number: t.documentNumberEvidence,
        })),
      ),
      cases: r.cases,
    });
    const a = summary(direct),
      b = summary(restored.result);
    const passed =
      a.approved === c.approved &&
      JSON.stringify(a) === JSON.stringify(b) &&
      !a.fullReconciliation;
    for (const [suffix, r, f] of [
      ['direct', direct, files],
      ['restored', restored.result, restored.files],
    ])
      await writeFile(
        path.join(out, c.id + '-' + ext + '-' + suffix + '.xlsx'),
        new Uint8Array(
          await exportWorkbook(r, f, { name: '', notes: '', checked: false }),
        ),
      );
    observations.push({
      id: c.id,
      format: ext,
      sourceHashes: files.map((f) => f.sha256),
      passed,
      direct: a,
      restored: b,
    });
  }
const report = {
  engine: ENGINE_VERSION,
  contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
  observedAtUtc: new Date().toISOString(),
  passed: observations.filter((o) => o.passed).length,
  total: observations.length,
  observations,
};
await writeFile(
  path.join(out, 'observations.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    engine: report.engine,
    passed: report.passed,
    total: report.total,
    cases: observations.map((o) => ({
      id: o.id,
      format: o.format,
      approved: o.direct.approved,
      passed: o.passed,
    })),
  }),
);
if (process.env.REQUIRE_UNKNOWN_PASS === '1' && report.passed !== report.total)
  process.exitCode = 1;
