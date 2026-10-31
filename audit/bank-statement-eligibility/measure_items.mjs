// G18: items.py against the product's own PDF.js items and its reading,
// on every sealed statement and on the planted pages of plant_items.py.
// For each page: the product's text items with text (pdf.ts asks PDF.js for
// them with disableNormalization) against items.py's, by place, width,
// height and characters; and the lines the reader refuses for overlapping
// text (readNativePdfWordSource) against the lines items.py finds; and,
// as a diagnostic, how many of the items columns.py's MuPDF model has. A
// statement the reader stops before it lays its pages out is recorded with
// its reason. The product reads sealed packages and planted files only,
// never a holdout draft (DEV-61). items.py needs pymupdf on PYTHONPATH.
//   node --experimental-strip-types audit/bank-statement-eligibility/measure_items.mjs [--out f.json | --assert f.json]
// --assert fails when today's comparison differs from the recorded one.
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { getNativePDFJS } from '../../lib/reconciliation/pdfjs-native.ts';
import { readNativePdfWordSource } from '../../lib/reconciliation/pdf.ts';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OVERLAP = 'توجد نصوص متداخلة، لذلك لا يمكن التحقق من صحة القراءة.';
const python = (script, rest) => {
  const run = spawnSync('python3', ['-B', join(import.meta.dirname, script), ...rest], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (run.status !== 0) throw Error(`${script}: ${run.stderr}`);
  return run.stdout;
};
const { getDocument } = await getNativePDFJS();
async function productItems(file) {
  const task = getDocument({
    data: new Uint8Array(readFileSync(file)),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
    useWasm: false,
    stopAtErrors: true,
    enableXfa: false,
  });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const text = await (await doc.getPage(p)).getTextContent({ disableNormalization: true });
    pages.push(text.items.filter((i) => 'str' in i && i.str.trim()).map((i) => [i.str, i.transform[4], i.transform[5], i.width, i.height]));
  }
  await task.destroy();
  return pages;
}
async function productLines(file) {
  const b = readFileSync(file);
  try {
    const source = await readNativePdfWordSource(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    return { lines: source.readingIssues.filter((i) => i.reasons.includes(OVERLAP)).map((i) => [i.page, i.line]) };
  } catch (error) {
    return { stopped: String(error.message ?? error).slice(0, 120) };
  }
}
const chars = (s) => [...s.replace(/\s/gu, '')].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('');
const same = (a, b) =>
  a.length === b.length &&
  a.every((x, k) => chars(x[0]) === chars(b[k][0]) && [1, 2, 3, 4].every((j) => Math.abs(x[j] - b[k][j]) < 0.01));
async function compare(files, key) {
  const tool = JSON.parse(python('items.py', files));
  const out = [];
  for (const file of files) {
    const theirs = await productItems(file);
    const pages = tool[file];
    const unmodelled = pages.filter((p) => p.unmodelled).map((p) => p.unmodelled);
    const items = theirs.reduce((t, p) => t + p.length, 0);
    const equalPages = pages.filter((p, k) => p.items && same(p.items, theirs[k])).length;
    const mine = pages.flatMap((p, k) => (p.overlap ?? []).map((o) => [k + 1, o.line]));
    const reader = await productLines(file);
    out.push({
      [key]: key === 'file' ? relative(root, file) : file.split('/').pop().replace(/\.pdf$/, ''),
      pages: pages.length,
      items,
      itemsEqual: equalPages === pages.length && theirs.length === pages.length,
      // How many of these items columns.py's MuPDF model has a piece of.
      columnsModelEqual: pages.reduce((t, p) => t + (p.columnsEqual ?? 0), 0),
      ...(unmodelled.length ? { unmodelled } : {}),
      overlapLines: mine,
      ...(reader.stopped ? { readerStopped: reader.stopped } : { readerLines: reader.lines }),
      agree: reader.stopped ? null : isDeepStrictEqual(mine, reader.lines),
    });
  }
  return out;
}
const temp = mkdtempSync(join(tmpdir(), 'items-measure-'));
try {
  python('plant_items.py', [temp]);
  const sealed = globSync(join(root, 'audit/bank-statement-*/frozen/*-statement.pdf')).sort();
  const planted = globSync(join(temp, '*.pdf')).sort();
  const report = {
    schema: 'tarasuf-bnk-pdf1-items-check/1',
    question: "Does items.py build the reader's PDF.js items, and find the lines the reader refuses for overlapping text?",
    sealed: await compare(sealed, 'file'),
    planted: await compare(planted, 'case'),
  };
  const all = [...report.sealed, ...report.planted];
  report.summary = {
    sealed: report.sealed.length,
    sealedItems: report.sealed.reduce((t, r) => t + r.items, 0),
    sealedItemsColumnsModelHas: report.sealed.reduce((t, r) => t + r.columnsModelEqual, 0),
    itemsEqual: `${all.filter((r) => r.itemsEqual).length}/${all.length}`,
    verdictsAgree: `${all.filter((r) => r.agree).length}/${all.filter((r) => r.agree !== null).length}`,
    readerStoppedFirst: all.filter((r) => r.readerStopped).map((r) => r.file ?? r.case),
    overlapFoundByItems: all.filter((r) => r.overlapLines.length).map((r) => r.file ?? r.case),
  };
  const text = `${JSON.stringify(report, null, 1)}\n`;
  if (flag('--out')) writeFileSync(flag('--out'), text);
  if (flag('--assert')) {
    const recorded = JSON.parse(readFileSync(flag('--assert'), 'utf8'));
    if (!isDeepStrictEqual(recorded, report)) {
      console.error(text);
      throw Error(`items.py no longer reads as recorded in ${flag('--assert')}`);
    }
  }
  console.log(JSON.stringify(report.summary));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
