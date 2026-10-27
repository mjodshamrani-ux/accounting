// AR-1 PDF before-support record. The product refusing a customer statement
// PDF is the gap this plan closes, not a success. Checks the frozen seal,
// then records, for each sealed statement, where the AR path stops and what
// the shared PDF readers make of the file:
// - the AR workspace offers only CSV and XLSX;
// - the AR source reader refuses the file by its name (AR_SOURCE);
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
assert.ok(workspace.includes('accept=".csv,.xlsx"'));
assert.ok(!/accept="[^"]*pdf/i.test(workspace));

const load = (m) => import(path.join(root, m));
const { readArFile } = await load('lib/reconciliation/ar-source.ts');
const { readFile: readSource } = await load('lib/reconciliation/io.ts');
const { readNativePdfSource } = await load('lib/reconciliation/pdf.ts');
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
  stories.push({
    id,
    sealedOutcome: judged.status,
    arWorkspace: 'csv-xlsx-only',
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
  });
}
for (const s of stories) assert.equal(s.arSource, 'AR_SOURCE', s.id);

const record = {
  schema: 'tarasuf-ar-pdf1-baseline/1',
  productEnabled: false,
  proposedFamily: 'ar-statement-pdf-1',
  positiveCapacity: {
    eligible: stories.filter((s) => s.sealedOutcome !== 'source-error').length,
    completed: 0,
  },
  stories,
};
const text = `${JSON.stringify(record, null, 1)}\n`;
if (args.out) await writeFile(args.out, text);
if (args.assert) {
  assert.deepEqual(record, await json(args.assert));
  console.log(`matches the record ${path.relative(root, args.assert)}`);
} else process.stdout.write(text);
