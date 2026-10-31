// G21: rows.py against the reader's test of adjacent rows, in its three
// forms, on every sealed statement and on the planted pages of plant_rows.py.
// The plain reader judges by glyph boxes, else ink, else metrics (rows.py's
// glyph form); with the ablation's 'rows by glyph boxes' off it judges by
// ink, else metrics (ink); with 'rows by ink' off, by metrics alone (metric).
// Each rule is switched off in a private copy of lib/ by the same change as
// the ablation script (bank-statement-ablation-rules.mjs). For each statement
// and form, the lines the reader refuses for adjacent rows
// (readNativePdfWordSource) against the lines rows.py finds. A statement the
// reader stops before it lays its pages out is recorded with its reason. The
// product reads sealed packages and planted files only, never a holdout
// draft (DEV-61). rows.py needs pymupdf and fontTools on PYTHONPATH.
//   node --experimental-strip-types audit/bank-statement-eligibility/measure_rows.mjs [--out f.json | --assert f.json]
// --assert fails when today's comparison differs from the recorded one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { rules } from '../../scripts/bank-statement-ablation-rules.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ROWS = 'تتداخل نصوص من صفوف متجاورة، لذلك لا يمكن التحقق من صحة القراءة.';
// The reader stops on a style without usable ascent and descent (glyphBounds).
const METRICS = 'تعذر التحقق من حدود حروف PDF';
const FORMS = ['metric', 'ink', 'glyph'];
// The rule switched off for each earlier form.
const OFF = { metric: 'rows by ink', ink: 'rows by glyph boxes' };
const python = (script, rest) => {
  const run = spawnSync('python3', ['-B', join(import.meta.dirname, script), ...rest], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (run.status !== 0) throw Error(`${script}: ${run.stderr}`);
  return run.stdout;
};
const temps = [];
async function reader(form) {
  if (!OFF[form]) return (await import('../../lib/reconciliation/pdf.ts')).readNativePdfWordSource;
  const tree = mkdtempSync(join(tmpdir(), 'rows-measure-'));
  temps.push(tree);
  cpSync(join(root, 'lib'), join(tree, 'lib'), { recursive: true });
  cpSync(join(root, 'package.json'), join(tree, 'package.json'));
  symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  const [, , mutant, file, from, to] = rules.find((r) => r[0] === OFF[form]);
  const target = join(tree, file);
  const text = readFileSync(target, 'utf8');
  assert.equal(text.split(from).length, 2, `anchor drift: ${mutant}`);
  writeFileSync(target, text.replace(from, to));
  return (await import(pathToFileURL(join(tree, 'lib/reconciliation/pdf.ts')).href)).readNativePdfWordSource;
}
async function productLines(read, file) {
  const b = readFileSync(file);
  try {
    const source = await read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    return { lines: source.readingIssues.filter((i) => i.reasons.includes(ROWS)).map((i) => [i.page, i.line]) };
  } catch (error) {
    return { stopped: String(error.message ?? error).slice(0, 120) };
  }
}
async function compare(readers, files, key) {
  const tool = JSON.parse(python('rows.py', files));
  const out = [];
  for (const file of files) {
    const pages = tool[file];
    const unmodelled = pages.filter((p) => p.unmodelled).map((p) => p.unmodelled);
    const row = {
      [key]: key === 'file' ? relative(root, file) : file.split('/').pop().replace(/\.pdf$/, ''),
      ...(unmodelled.length ? { unmodelled } : {}),
    };
    for (const form of FORMS) {
      const unprovable = pages.some((p) => p[form] === 'unprovable');
      const mine = pages.flatMap((p, k) => (Array.isArray(p[form]) ? p[form].map((line) => [k + 1, line]) : []));
      const theirs = await productLines(readers[form], file);
      row[form] = {
        ...(unprovable ? { unprovable } : {}),
        tool: mine,
        ...(theirs.stopped ? { readerStopped: theirs.stopped } : { reader: theirs.lines }),
        // A reader that stops on another check (a rotated page, a drawing
        // over text, an image) never reaches this test: nothing to compare.
        agree: theirs.stopped
          ? theirs.stopped.includes(METRICS)
            ? unprovable
            : null
          : !unprovable && !unmodelled.length && isDeepStrictEqual(mine, theirs.lines),
      };
    }
    out.push(row);
  }
  return out;
}
const temp = mkdtempSync(join(tmpdir(), 'rows-plants-'));
temps.push(temp);
try {
  const readers = {};
  for (const form of FORMS) readers[form] = await reader(form);
  python('plant_rows.py', [temp]);
  const sealed = globSync(join(root, 'audit/bank-statement-*/frozen/*-statement.pdf')).sort();
  const planted = globSync(join(temp, '*.pdf')).sort();
  const report = {
    schema: 'tarasuf-bnk-pdf1-rows-check/1',
    question:
      "Does rows.py find the lines the reader refuses for adjacent rows, judged by glyph boxes, by ink, and by the fonts' ascent and descent?",
    sealed: await compare(readers, sealed, 'file'),
    planted: await compare(readers, planted, 'case'),
  };
  const all = [...report.sealed, ...report.planted];
  const name = (r) => r.file ?? r.case;
  report.summary = Object.fromEntries(
    FORMS.map((form) => [
      form,
      {
        agree: `${all.filter((r) => r[form].agree).length}/${all.filter((r) => r[form].agree !== null).length}`,
        disagree: all.filter((r) => r[form].agree === false).map(name),
        refusedByReader: all.filter((r) => r[form].reader?.length).map(name),
        readerStopped: all.filter((r) => r[form].readerStopped).map(name),
      },
    ]),
  );
  const text = `${JSON.stringify(report, null, 1)}\n`;
  if (flag('--out')) writeFileSync(flag('--out'), text);
  if (flag('--assert')) {
    const recorded = JSON.parse(readFileSync(flag('--assert'), 'utf8'));
    if (!isDeepStrictEqual(recorded, report)) {
      console.error(text);
      throw Error(`rows.py no longer reads as recorded in ${flag('--assert')}`);
    }
  }
  console.log(JSON.stringify(report.summary));
} finally {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
}
