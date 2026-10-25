// G19: columns.py's reading of each statement by its column headers against
// the reader's own, on every sealed statement and on the planted statements
// of test_eligibility.py (plant_columns.py), with columns.py's pieces built
// by items.py (since G19) and, for the comparison, by the MuPDF model of G13
// to G18. The reader runs from a private copy of lib/ in a temporary folder
// with its earlier guards switched off, as G13 measured it
// (results/g13-reader-earlier-guards-off.diff): the reading-issue gate of
// readBankStatementPdf and the guard on drawings over text, so that its
// reading by columns is reached; its image and rotation guards stay on, and
// a statement they stop is recorded as not comparable. Same: both stop at the
// same code, page and line, or both read the statement. And the rules
// columns.py counts against the rules the product's recorded ablations show
// it needed. The product reads
// sealed packages and planted files only (DEV-61). columns.py needs pymupdf
// on PYTHONPATH.
//   node --experimental-strip-types audit/bank-statement-eligibility/measure_columns.mjs [--out f.json | --assert f.json]
import { cpSync, globSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const python = (script, rest) => {
  const run = spawnSync('python3', ['-B', join(import.meta.dirname, script), ...rest], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (run.status !== 0) throw Error(`${script}: ${run.stderr}`);
  return run.stdout;
};
const temp = mkdtemp();
function mkdtemp() {
  return mkdtempSync(join(tmpdir(), 'columns-measure-'));
}
// The private reader: lib/ copied, two guards off, each edit applied once.
cpSync(join(root, 'lib'), join(temp, 'lib'), { recursive: true });
symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
const edit = (file, from, to, count) => {
  const path = join(temp, 'lib/reconciliation', file);
  const text = readFileSync(path, 'utf8');
  const found = text.match(from)?.length ?? 0;
  if (found !== count) throw Error(`${file}: ${found} of the ${count} guards it edits`);
  writeFileSync(path, text.replace(from, to));
};
edit('bank-statement-native.ts', /^ {2}if \(source\.readingIssues\.length\)$/gmu, '  if (false)', 1);
edit('pdf.ts', /throw new Error\(\s*'يتداخل أحد رسوم PDF مع النص وقد يغطي رقمًا\.[^']*',\s*\);/gu, 'void 0;', 2);
const { readNativePdfWordSource } = await import(join(temp, 'lib/reconciliation/pdf.ts'));
const { readBankStatementPdf, BankStatementReadError } = await import(
  join(temp, 'lib/reconciliation/bank-statement-native.ts')
);
async function reader(file) {
  const b = readFileSync(file);
  try {
    const reading = readBankStatementPdf(
      await readNativePdfWordSource(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
    );
    return { read: reading.status };
  } catch (error) {
    if (error instanceof BankStatementReadError) return { code: error.code, page: error.page, line: error.line };
    return { stopped: String(error.message ?? error).slice(0, 120) };
  }
}
const same = (tool, theirs) =>
  theirs.stopped
    ? null
    : tool === null
      ? 'read' in theirs
      : tool.code === theirs.code && tool.page === theirs.page && tool.line === theirs.line;
const stopOf = (s) => (s ? { code: s.code, page: s.page, line: s.line } : null);
async function compare(files, key) {
  const items = JSON.parse(python('columns.py', files));
  const mupdf = JSON.parse(python('columns.py', ['--mupdf', ...files]));
  const out = [];
  for (const file of files) {
    const theirs = await reader(file);
    out.push({
      [key]: key === 'file' ? relative(root, file) : file.split('/').pop().replace(/\.pdf$/, ''),
      reader: theirs,
      tool: stopOf(items[file].stop),
      same: same(items[file].stop, theirs),
      exercised: items[file].exercised,
      mupdfModel: { tool: stopOf(mupdf[file].stop), same: same(mupdf[file].stop, theirs), exercised: mupdf[file].exercised },
    });
  }
  return out;
}
try {
  python('plant_columns.py', [join(temp, 'planted')]);
  const sealed = globSync(join(root, 'audit/bank-statement-*/frozen/*-statement.pdf')).sort();
  const planted = globSync(join(temp, 'planted', '*.pdf')).sort();
  const report = {
    schema: 'tarasuf-bnk-pdf1-columns-vs-reader/2',
    what: "columns.py against the guarded reader's reading by columns, the reader with its earlier guards off as in G13; tool: columns.py on items.py's items; mupdfModel: on the MuPDF model of G13 to G18.",
    sealed: await compare(sealed, 'file'),
    planted: await compare(planted, 'case'),
  };
  // The rules the product needed, by its own ablations (each rule switched off
  // in a private copy, scripts/bank-statement-holdout-ablation.mjs), against
  // the rules columns.py counts for the statements those runs completed or
  // held: a statement the product loses without a rule must count it, and
  // one it keeps must not.
  const RULES = { 'DR after its amount': 'drAfterAmount', 'date runs joined': 'dateRuns' };
  const rows = Object.fromEntries(report.sealed.map((r) => [r.file, r]));
  const checks = [];
  for (const file of globSync(join(root, 'audit/bank-statement-holdout-*/results/diagnostic-ablation-*.json')).sort()) {
    const ablation = JSON.parse(readFileSync(file, 'utf8'));
    const pkg = relative(root, file).split('/')[1];
    const kept = [...ablation.plain.positivesCompleted, ...(ablation.plain.heldCorrectly ?? [])];
    for (const a of ablation.ablations.filter((x) => x.rule in RULES)) {
      const lost = new Set([...a.lostPositives, ...(a.lostHeld ?? [])]);
      for (const id of kept) {
        const r = rows[`audit/${pkg}/frozen/${id}-statement.pdf`];
        const key = RULES[a.rule];
        checks.push({
          record: relative(root, file),
          rule: a.rule,
          statement: id,
          productNeeds: lost.has(id),
          counts: (r.exercised[key] ?? 0) > 0,
          countsMupdfModel: (r.mupdfModel.exercised[key] ?? 0) > 0,
        });
      }
    }
  }
  report.ablations = checks;
  const count = (rows, get) => `${rows.filter((r) => get(r) === true).length}/${rows.filter((r) => get(r) !== null).length}`;
  const all = [...report.sealed, ...report.planted];
  report.summary = {
    sealed: report.sealed.length,
    planted: report.planted.length,
    same: count(all, (r) => r.same),
    sameMupdfModel: count(all, (r) => r.mupdfModel.same),
    notComparable: all.filter((r) => r.same === null).map((r) => r.file ?? r.case),
    differ: all.filter((r) => r.same === false).map((r) => r.file ?? r.case),
    differMupdfModel: all.filter((r) => r.mupdfModel.same === false).map((r) => r.file ?? r.case),
    rulesAsAblations: `${checks.filter((c) => c.counts === c.productNeeds).length}/${checks.length}`,
    rulesAsAblationsMupdfModel: `${checks.filter((c) => c.countsMupdfModel === c.productNeeds).length}/${checks.length}`,
  };
  const text = `${JSON.stringify(report, null, 1)}\n`;
  if (flag('--out')) writeFileSync(flag('--out'), text);
  if (flag('--assert')) {
    const recorded = JSON.parse(readFileSync(flag('--assert'), 'utf8'));
    if (!isDeepStrictEqual(recorded, report)) {
      console.error(text);
      throw Error(`columns.py no longer reads as recorded in ${flag('--assert')}`);
    }
  }
  console.log(JSON.stringify(report.summary));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
