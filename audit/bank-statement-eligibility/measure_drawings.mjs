// G22: drawings.py against the reader's drawing, clip and background tests,
// as the reader is and with each of the three rules about them off, on every
// sealed statement and on the planted pages of plant_drawings.py. Each rule
// is switched off in a private copy of lib/ by the same change as the
// ablation script (bank-statement-ablation-rules.mjs). The reader stops a
// statement at the first page a test refuses; drawings.py names, for each
// page, the first refusal of these tests. Same: the reader stops with one of
// these tests on the page where the tool's first refusal is, of the same
// kind; or the reader reads the statement and the tool refuses nothing. A
// statement the reader stops for another reason is compared on the pages
// before; a page the tool cannot judge (turned, not modelled, a font without
// ascent and descent) leaves the rest not comparable. The product reads
// sealed packages and planted files only, never a holdout draft (DEV-61).
// drawings.py needs pymupdf and fontTools on PYTHONPATH.
//   node --experimental-strip-types audit/bank-statement-eligibility/measure_drawings.mjs [--out f.json | --assert f.json]
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
// The reader's messages for these tests, as drawings.py names them.
const KINDS = {
  clip: 'يحتوي PDF نصًا مقصوصًا أو طريقة قص غير مدعومة',
  covers: 'يغطي أحد رسوم PDF نصًا تحته',
  drawing: 'يتداخل أحد رسوم PDF مع النص وقد يغطي رقمًا',
  bounds: 'قد يغطي أحد رسوم PDF النص، وتعذر التحقق من حدود الرسم',
  stroke: 'إعدادات حدود أحد رسوم PDF غير صالحة',
};
// The rule switched off for each configuration of drawings.py.
const OFF = {
  today: undefined,
  noInkDrawing: 'drawing by ink',
  noGlyphDrawings: 'drawings by glyph boxes',
  noRectangleReturn: 'rectangle traced back to its start',
};
const python = (script, rest) => {
  const run = spawnSync('python3', ['-B', join(import.meta.dirname, script), ...rest], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (run.status !== 0) throw Error(`${script}: ${run.stderr}`);
  return run.stdout;
};
const temps = [];
async function reader(rule) {
  if (!rule) return (await import('../../lib/reconciliation/pdf.ts')).readNativePdfWordSource;
  const tree = mkdtempSync(join(tmpdir(), 'drawings-measure-'));
  temps.push(tree);
  cpSync(join(root, 'lib'), join(tree, 'lib'), { recursive: true });
  cpSync(join(root, 'package.json'), join(tree, 'package.json'));
  symlinkSync(join(root, 'node_modules'), join(tree, 'node_modules'), 'dir');
  const [, , mutant, file, from, to] = rules.find((r) => r[0] === rule);
  const target = join(tree, file);
  const text = readFileSync(target, 'utf8');
  assert.equal(text.split(from).length, 2, `anchor drift: ${mutant}`);
  writeFileSync(target, text.replace(from, to));
  return (await import(pathToFileURL(join(tree, 'lib/reconciliation/pdf.ts')).href)).readNativePdfWordSource;
}
async function product(read, file) {
  const b = readFileSync(file);
  try {
    await read(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    return { read: true };
  } catch (error) {
    const message = String(error.message ?? error);
    const page = Number(/صفحة PDF (\d+)/u.exec(message)?.[1] ?? 0) || null;
    const kind = Object.keys(KINDS).find((k) => message.includes(KINDS[k])) ?? 'other';
    return { page, kind, ...(kind === 'other' ? { message: message.slice(0, 100) } : {}) };
  }
}
// The tool's first refusal and the first page it cannot judge, 1-based.
function tool(pages, config) {
  let refused = null,
    blind = null;
  for (const [k, p] of pages.entries()) {
    const v = p[config];
    if (p.rotated || p.unmodelled || v === 'unprovable') {
      blind = k + 1;
      break;
    }
    if (v) {
      refused = { page: k + 1, kind: v.kind };
      break;
    }
  }
  return { refused, blind };
}
function same(t, p) {
  if (p.read) return t.refused ? false : t.blind ? null : true;
  if (t.blind && (!t.refused || t.blind <= t.refused.page) && t.blind <= (p.page ?? Infinity)) return null;
  if (p.kind !== 'other') return t.refused?.page === p.page && t.refused?.kind === p.kind;
  if (!t.refused) return true;
  return t.refused.page < (p.page ?? Infinity) ? false : null;
}
async function compare(readers, files, key) {
  const checked = JSON.parse(python('drawings.py', files));
  const out = [];
  for (const file of files) {
    const row = { [key]: key === 'file' ? relative(root, file) : file.split('/').pop().replace(/\.pdf$/, '') };
    for (const config of Object.keys(OFF)) {
      const t = tool(checked[file], config);
      const p = await product(readers[config], file);
      row[config] = { tool: t.refused, ...(t.blind ? { toolBlind: t.blind } : {}), reader: p, same: same(t, p) };
    }
    out.push(row);
  }
  return out;
}
const temp = mkdtempSync(join(tmpdir(), 'drawings-plants-'));
temps.push(temp);
try {
  const readers = {};
  for (const [config, rule] of Object.entries(OFF)) readers[config] = await reader(rule);
  python('plant_drawings.py', [temp]);
  const sealed = globSync(join(root, 'audit/bank-statement-*/frozen/*-statement.pdf')).sort();
  const planted = globSync(join(temp, '*.pdf')).sort();
  const report = {
    schema: 'tarasuf-bnk-pdf1-drawings-check/1',
    question:
      "Does drawings.py find where the reader's drawing, clip and background tests stop a statement, as the reader is and with each rule about them off?",
    sealed: await compare(readers, sealed, 'file'),
    planted: await compare(readers, planted, 'case'),
  };
  const all = [...report.sealed, ...report.planted];
  const name = (r) => r.file ?? r.case;
  report.summary = Object.fromEntries(
    Object.keys(OFF).map((config) => [
      config,
      {
        same: `${all.filter((r) => r[config].same).length}/${all.filter((r) => r[config].same !== null).length}`,
        differ: all.filter((r) => r[config].same === false).map(name),
        notComparable: all.filter((r) => r[config].same === null).map(name),
        stoppedByTheseTests: all.filter((r) => KINDS[r[config].reader.kind]).map((r) => `${name(r)} ${r[config].reader.kind}`),
      },
    ]),
  );
  const text = `${JSON.stringify(report, null, 1)}\n`;
  if (flag('--out')) writeFileSync(flag('--out'), text);
  if (flag('--assert')) {
    const recorded = JSON.parse(readFileSync(flag('--assert'), 'utf8'));
    if (!isDeepStrictEqual(recorded, report)) {
      console.error(text);
      throw Error(`drawings.py no longer reads as recorded in ${flag('--assert')}`);
    }
  }
  console.log(JSON.stringify(report.summary));
} finally {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
}
