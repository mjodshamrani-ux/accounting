// BNK-PDF-1 before-activation record. The product refusing a real bank
// statement is the gap this plan closes, not a success. Checks the frozen
// seal, then records where the current bank path stops for each statement as
// the bank issues it: every PDF at the bank engine's source check, and BS01
// as CSV and XLSX at the bank engine's required columns.
//   node --experimental-strip-types scripts/bank-statement-baseline.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-statement-foundation');
const frozen = path.join(suite, 'frozen');
const outDir =
  process.env.BNK_PDF_BASELINE_DIR ??
  path.join(root, 'work/bank-statement-baseline');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const e of manifest.files) {
  const b = await readFile(path.join(frozen, e.file));
  assert.equal(b.length, e.bytes, e.file);
  assert.equal(sha(b), e.sha256, e.file);
}
const { factsJson } = await import(path.join(suite, 'stories.mjs'));
assert.equal(
  sha(factsJson()),
  manifest.facts.sha256,
  'facts differ from the seal',
);
const expected = await json(path.join(frozen, 'EXPECTED.json'));
const verify = await json(path.join(frozen, 'VERIFY.json'));
assert.equal(verify.ok, true);

const { readFile: readSource } = await import(
  path.join(root, 'lib/reconciliation/io.ts')
);
const { reconcileBank, BANK_VERSION, BANK_WD_FAMILY, BANK_ROLES } =
  await import(path.join(root, 'lib/reconciliation/bank.ts'));
const tracked = [
  'lib/reconciliation/bank.ts',
  'lib/reconciliation/io.ts',
  'components/bank-workspace.tsx',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (p) => [p, sha(await readFile(path.join(root, p)))]),
  ),
);

// The workspace offers and accepts only CSV and XLSX for both sides.
const workspace = await readFile(
  path.join(root, 'components/bank-workspace.tsx'),
  'utf8',
);
assert.ok(workspace.includes('!/\\.(csv|xlsx)$/i.test(blob.name)'));
assert.ok(workspace.includes('accept=".csv,.xlsx"'));
assert.ok(!/accept="[^"]*pdf/i.test(workspace));
// The engine itself refuses any source not named .csv or .xlsx.
const engine = await readFile(
  path.join(root, 'lib/reconciliation/bank.ts'),
  'utf8',
);
assert.ok(engine.includes('!/\\.(csv|xlsx)$/i.test(file.name)'));

const read = async (name) =>
  readSource(
    name,
    Uint8Array.from(await readFile(path.join(frozen, name))).buffer,
  );
const scope = (id) => ({
  entity: 'Synthetic Trading Co',
  ledger: 'Main cashbook',
  account: `SA00 0000 0000 00${id.slice(2)}4417`,
  currency: 'SAR',
  start: '2026-07-01',
  end: '2026-07-31',
  confirmed: true,
});
async function attempt(id, statement, cashbook, family) {
  const files = [await read(statement), await read(cashbook)];
  try {
    reconcileBank({
      files,
      readings: BANK_ROLES.map((role) => ({
        role,
        sheet: 0,
        family,
        perspective: 'company-cash',
        confirmed: true,
      })),
      scope: scope(id),
      events: [],
    });
    return { error: null };
  } catch (error) {
    return { error: error.message };
  }
}

const report = {
  schema: 'tarasuf-bnk-pdf1-baseline/1',
  productEnabled: false,
  proposedFamily: 'bank-statement-native-1',
  sourceHashes,
  factsSha256: manifest.facts.sha256,
  workspaceIntake: 'csv and xlsx only, both sides',
  statementPositiveCapacity: {
    eligible: expected.stories.filter((s) => s.statement === 'verified').length,
    completed: 0,
  },
  heldStatements: expected.stories
    .filter((s) => s.statement !== 'verified')
    .map((s) => ({ id: s.id, statement: s.statement })),
  currentProduct: [],
  history: [
    {
      release: '0.4.57',
      stage: 'pdf-read',
      result: 'all 16 statement PDFs refused at page 2 as clipped text',
      record: 'docs/audits/BNK-PDF-1-FOUNDATION.ar.md',
    },
  ],
};
// Until G1 the guarded reader refused all sixteen PDFs at page 2 as clipped
// text (0.4.57): the first heading's padded text box crossed Chromium's page
// clip although its glyphs render whole. G1 tests the clip by glyph ink, so
// the files now read; the bank path then stops at the engine, which accepts
// only sources named .csv or .xlsx. The earlier refusal is kept below as
// history, not re-run.
for (const s of expected.stories) {
  const pdf = await read(`${s.id}-statement.pdf`);
  assert.equal(pdf.pdf.pages, s.printedPages, s.id);
  for (const family of [BANK_VERSION, BANK_WD_FAMILY]) {
    const { error } = await attempt(
      s.id,
      `${s.id}-statement.pdf`,
      `${s.id}-cashbook.csv`,
      family,
    );
    assert.equal(error, 'BANK_SOURCE', `${s.id} ${family}`);
    report.currentProduct.push({
      id: s.id,
      statement: 'pdf',
      stage: 'bank-reconcile',
      family,
      error,
      sourceStatement: s.statement,
    });
  }
  if (s.id !== 'BS01') continue;
  for (const [statement, cashbook] of [
    ['BS01-statement.csv', 'BS01-cashbook.csv'],
    ['BS01-statement.xlsx', 'BS01-cashbook.xlsx'],
  ])
    for (const family of [BANK_VERSION, BANK_WD_FAMILY]) {
      const { error } = await attempt(s.id, statement, cashbook, family);
      assert.equal(error, 'BANK_COLUMNS', `${statement} ${family}`);
      report.currentProduct.push({
        id: s.id,
        statement: path.extname(statement).slice(1),
        stage: 'bank-reconcile',
        family,
        error,
        sourceStatement: s.statement,
      });
    }
}
assert.equal(report.statementPositiveCapacity.eligible, 14);
assert.equal(report.currentProduct.length, 36);

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'baseline.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log(
  JSON.stringify({
    eligible: report.statementPositiveCapacity.eligible,
    completed: 0,
    refusals: Object.fromEntries(
      [...new Set(report.currentProduct.map((r) => r.error))].map((e) => [
        e,
        report.currentProduct.filter((r) => r.error === e).length,
      ]),
    ),
    out: path.relative(root, outDir),
  }),
);
