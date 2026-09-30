import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] ?? '.');
const out = path.resolve(process.argv[3] ?? 'work/typed-documents');
await mkdir(out, { recursive: true });
const load = (name) =>
  import(pathToFileURL(path.join(root, 'lib/reconciliation', name + '.ts')));
const { readFile: read, exportWorkbook } = await load('io');
const { selectImportMapping } = await load('import-selection');
const { reconcileSupplierStatement } = await load('supplier-reconciliation');
const { saveSession, restoreSession } = await load('session');
const { ENGINE_VERSION } = await load('types');
const contract = JSON.parse(
  await readFile('audit/typed-document/contract.json', 'utf8'),
);
const buffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const source = async (name) =>
  read(name, buffer(await readFile('audit/typed-document/frozen/' + name)));
const observations = [];
for (const kind of ['proven', 'conflict']) {
  const files = [
    await source('supplier-typed-' + kind + '.xlsx'),
    await source('ledger-typed.csv'),
  ];
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  );
  const input = { files, mappings, scope: contract.scope };
  const result = reconcileSupplierStatement(input).result;
  const session = await saveSession({
    ...input,
    decisions: [],
    rejected: [],
    events: [],
    review: { name: '', notes: '', checked: false },
  });
  const restored = await restoreSession(session);
  const summarize = (r) => ({
    approved: r.cases
      .filter((c) => c.status === 'Matched')
      .map((c) => ({
        supplierRows: c.supplierMembers.map((t) => t.row),
        ledgerRows: c.ledgerMembers.map((t) => t.row),
        amountMinor: c.supplierTotal,
        rule: c.matchingRule,
      })),
    supplierMovements: r.supplier.transactions.map((t) => ({
      row: t.row,
      ref: t.reference,
      type: t.documentType,
      amountMinor: t.amount,
    })),
    supplierRowFates: [
      ...r.supplier.transactions,
      ...r.supplier.errors,
      ...r.supplier.excluded,
    ]
      .map((t) => t.row)
      .filter((r) => r > 0)
      .sort((a, b) => a - b),
    fullReconciliation: r.balanceComparable,
  });
  for (const [suffix, r, f] of [
    ['direct', result, files],
    ['restored', restored.result, restored.files],
  ]) {
    await writeFile(
      path.join(out, kind + '-' + suffix + '.xlsx'),
      new Uint8Array(
        await exportWorkbook(r, f, { name: '', notes: '', checked: false }),
      ),
    );
  }
  observations.push({
    kind,
    sourceHashes: files.map((f) => f.sha256),
    direct: summarize(result),
    restored: summarize(restored.result),
  });
}
const report = {
  engine: ENGINE_VERSION,
  sourceRoot: root,
  observedAtUtc: new Date().toISOString(),
  basis:
    'New development sources with manual frozen contract; no holdout claim',
  observations,
};
await writeFile(
  path.join(out, 'observations.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
