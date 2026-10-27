// AR-1 PDF product record. Checks the frozen seal, then records, for each
// sealed statement, what the product does with it:
// - the AR workspace: the ledger stays CSV or XLSX; since A4 the statement may
//   be the printed PDF (results/baseline-5f32c8c.json kept the before-support
//   record, CSV and XLSX only, as history);
// - the AR table reader still refuses the file by its name (AR_SOURCE); the
//   statement goes through the statement path instead;
// - the statement path from the original bytes (A3): status, matched pairs
//   and error codes, against the sealed expectation;
// - the guarded native PDF reader: pages and reading issues;
// - the general PDF reading other workspaces use: lines, proposed columns.
// --out writes the record; --assert compares a run with a recorded one.
//   node --experimental-strip-types scripts/ar-statement-baseline.mjs [--out file] [--assert file]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/ar-statement-foundation');
const frozen = path.join(suite, 'frozen');
const { values: args } = parseArgs({
  options: { out: { type: 'string' }, assert: { type: 'string' } },
});
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files)) {
  const bytes = await readFile(path.join(frozen, name));
  assert.equal(bytes.length, entry.bytes, name);
  assert.equal(sha(bytes), entry.sha256, name);
}
const expected = await json(path.join(frozen, 'EXPECTED.json'));
const verify = await json(path.join(frozen, 'VERIFY.json'));
assert.equal(verify.passed, true);

const workspace = await readFile(
  path.join(root, 'components/ar-workspace.tsx'),
  'utf8',
);
// Only the statement side offers PDF.
assert.ok(
  workspace.includes("accept={side === 1 ? '.csv,.xlsx,.pdf' : '.csv,.xlsx'}"),
);
assert.ok(!/accept="[^"]*pdf/i.test(workspace));

const load = (m) => import(path.join(root, m));
const { readArFile } = await load('lib/reconciliation/ar-source.ts');
const { readFile: readSource } = await load('lib/reconciliation/io.ts');
const { readNativePdfSource } = await load('lib/reconciliation/pdf.ts');
const { replayAr } = await load('lib/reconciliation/ar-io.ts');
const facts = await json(path.join(frozen, 'stories.json'));
const ledgerReading = (header) => ({
  sheet: 0,
  header: 0,
  ...Object.fromEntries(
    [
      ['posting', 'Posting ID'],
      ['kind', 'Document type'],
      ['document', 'Own document number'],
      ['date', 'Posting date'],
      ['amount', 'Original signed amount'],
      ['entity', 'Entity'],
      ['ledger', 'Ledger'],
      ['customer', 'Customer'],
      ['account', 'Account'],
      ['currency', 'Currency'],
      ['related', 'Related invoice'],
      ['description', 'Description'],
    ].map(([key, name]) => [key, header.indexOf(name)]),
  ),
  role: 'company-ar-ledger',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
});
const buffer = async (name) =>
  Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const failure = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    return String(error?.message ?? error).slice(0, 160);
  }
};

const stories = [];
for (const [id, judged] of Object.entries(expected.stories)) {
  const name = `${id}-statement.pdf`;
  const bytes = await buffer(name);
  const arSource = await failure(() => readArFile(name, bytes));
  // The same bytes under a CSV name pass the name check, so the refusal
  // above is the name, not the bytes.
  const asCsv = await failure(() => readArFile(`${id}-statement.csv`, bytes));
  let native;
  const nativeError = await failure(async () => {
    native = await readNativePdfSource(await buffer(name));
  });
  let general;
  const generalError = await failure(async () => {
    general = await readSource(name, await buffer(name), undefined, true);
  });
  const sheet = general?.sheets[0];
  const ledgerBytes = await buffer(`${id}-ledger.csv`);
  const { result } = await replayAr({
    files: [
      { name: `${id}-ledger.csv`, sha256: sha(Buffer.from(ledgerBytes)), original: ledgerBytes },
      { name, sha256: sha(Buffer.from(bytes)), original: await buffer(name) },
    ],
    readings: [
      ledgerReading((await readArFile(`${id}-ledger.csv`, ledgerBytes.slice(0))).sheets[0].rows[0]),
      {
        family: 'ar-statement-pdf-1',
        role: 'company-issued-customer-statement',
        perspective: 'seller-receivable',
        basis: 'original-movement',
        confirmed: true,
      },
    ],
    scope: { ...facts.stories.find((s) => s.id === id).scope, confirmed: true },
    events: [],
  });
  const statementPath = {
    status: result.status,
    matched: result.cases.filter((c) => c.status === 'matched').length,
    errorCodes: [...new Set(result.sourceIssues.map((i) => i.code))].sort(
      (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    ),
  };
  stories.push({
    id,
    sealedOutcome: judged.status,
    arWorkspace: 'ledger csv-xlsx; statement csv-xlsx-pdf',
    arSource,
    sameBytesNamedCsv: asCsv,
    nativeReader: nativeError
      ? { error: nativeError }
      : {
          pages: native.pages.length,
          readingIssues: native.readingIssues.length,
        },
    generalReading: generalError
      ? { error: generalError }
      : {
          lines: sheet.rows.length,
          proposedColumns: general.pdf?.autoColumns ? general.pdf.cuts.length + 1 : 0,
          linesWithIssues: Object.keys(sheet.rowIssues ?? {}).length,
        },
    statementPath,
    asSealed:
      statementPath.status === judged.status &&
      statementPath.matched === judged.matched &&
      JSON.stringify(statementPath.errorCodes) === JSON.stringify(judged.errorCodes),
  });
}
for (const s of stories) assert.equal(s.arSource, 'AR_SOURCE', s.id);

const positive = stories.filter((s) => s.sealedOutcome !== 'source-error');
const record = {
  schema: 'tarasuf-ar-pdf1-baseline/2',
  productEnabled: true,
  family: 'ar-statement-pdf-1',
  enabledIn: 'AR-1 PDF A4, candidate 0.4.58',
  positiveCapacity: {
    eligible: positive.length,
    completed: positive.filter((s) => s.asSealed).length,
  },
  heldAsSealed: stories.filter(
    (s) => s.sealedOutcome === 'source-error' && s.asSealed,
  ).length,
  stories,
};
const text = `${JSON.stringify(record, null, 1)}\n`;
if (args.out) await writeFile(args.out, text);
if (args.assert) {
  assert.deepEqual(record, await json(args.assert));
  console.log(`matches the record ${path.relative(root, args.assert)}`);
} else process.stdout.write(text);
