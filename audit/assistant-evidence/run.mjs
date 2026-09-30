import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] ?? '.'),
  out = path.resolve(process.argv[3] ?? 'work/assistant-evidence');
await mkdir(out, { recursive: true });
const load = (n) =>
  import(pathToFileURL(path.join(root, 'lib/reconciliation', n + '.ts')));
const { readFile: read, exportWorkbook } = await load('io');
const { selectImportMapping } = await load('import-selection');
const { reconcileSupplierStatement } = await load('supplier-reconciliation');
const { saveSession, restoreSession } = await load('session');
const { explainResult, resolveQuestionReferences } = await load('assistant');
const { ENGINE_VERSION } = await load('types');
const contractBytes = await readFile('audit/assistant-evidence/contract.json'),
  contract = JSON.parse(contractBytes);
const observations = [];
for (const c of contract.cases) {
  const files = await Promise.all(
    ['supplier', 'ledger'].map(async (side) => {
      const name = c.id + '-' + side + '.csv',
        b = await readFile('audit/assistant-evidence/frozen/' + name);
      return read(
        name,
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      );
    }),
  );
  const mappings = files.map(
    (f, i) => selectImportMapping(f, i ? 'ledger' : 'supplier').mapping,
  );
  if (c.referenceColumn !== undefined)
    for (const m of mappings) m.reference = c.referenceColumn;
  if (c.externalBalances)
    for (const [i, m] of mappings.entries()) {
      const b = c.externalBalances;
      m.opening = i ? b.ledgerOpening : b.supplierOpening;
      m.closing = i ? b.ledgerClosing : b.supplierClosing;
      m.periodStart = b.periodStart;
    }
  const input = { files, mappings, scope: contract.scope },
    r = reconcileSupplierStatement(input).result;
  const restored = await restoreSession(
    await saveSession({
      ...input,
      decisions: [],
      rejected: [],
      events: [],
      review: { name: '', notes: '', checked: false },
    }),
  );
  const before = JSON.stringify(r),
    answer = explainResult(r, c.question),
    again = explainResult(restored.result, c.question),
    lookup = resolveQuestionReferences(r, c.question);
  const probes = [];
  if (c.id === 'balanced-variance')
    for (const [name, question, alter] of [
      [
        'invented-case-total',
        'Explain INV-P5-730',
        (x) => {
          x.cases[0] = { ...x.cases[0], supplierTotal: 9999900 };
        },
      ],
      [
        'invented-bridge',
        'Why is there a balance difference?',
        (x) => {
          x.bridge = { ...x.bridge, delta: 9999900 };
        },
      ],
      [
        'invented-count',
        'What checks were completed?',
        (x) => {
          x.caseCounts = { ...x.caseCounts, autoMatchedCases: 9999 };
        },
      ],
      [
        'display-member-drift',
        'Explain INV-P5-730',
        (x) => {
          x.cases[0].supplierMembers = x.cases[0].supplierMembers.map((t) => ({
            ...t,
            amount: 9999900,
            amountMinor: 9999900,
          }));
        },
      ],
    ]) {
      const x = structuredClone(r);
      alter(x);
      const a = explainResult(x, question);
      probes.push({
        name,
        question,
        passed: a.kind === 'unsupported' && a.sourceIds.length === 0,
        answer: a,
      });
    }
  const passed =
    (lookup?.length ?? -1) === c.lookupCount &&
    answer.kind === c.answerKind &&
    JSON.stringify(answer) === JSON.stringify(again) &&
    JSON.stringify(r) === before &&
    r.caseCounts.autoMatchedCases === c.approved &&
    probes.every((p) => p.passed);
  for (const [suffix, result, sources] of [
    ['direct', r, files],
    ['restored', restored.result, restored.files],
  ])
    await writeFile(
      path.join(out, c.id + '-' + suffix + '.xlsx'),
      new Uint8Array(
        await exportWorkbook(result, sources, {
          name: '',
          notes: '',
          checked: false,
        }),
      ),
    );
  observations.push({
    id: c.id,
    passed,
    sourceHashes: files.map((f) => f.sha256),
    mappings,
    approved: r.caseCounts.autoMatchedCases,
    lookupIds: lookup?.map((t) => t.id) ?? null,
    answer,
    restoredAnswer: again,
    probes,
  });
}
const report = {
  engine: ENGINE_VERSION,
  contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
  observedAtUtc: new Date().toISOString(),
  passed: observations.filter((x) => x.passed).length,
  total: observations.length,
  observations,
};
await writeFile(
  path.join(out, 'observations.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    engine: ENGINE_VERSION,
    passed: report.passed,
    total: report.total,
    cases: observations.map((x) => ({
      id: x.id,
      passed: x.passed,
      kind: x.answer.kind,
      lookup: x.lookupIds,
      probes: x.probes.map((p) => ({ name: p.name, passed: p.passed })),
    })),
  }),
);
if (process.env.REQUIRE_P5_PASS === '1' && report.passed !== report.total)
  process.exitCode = 1;
