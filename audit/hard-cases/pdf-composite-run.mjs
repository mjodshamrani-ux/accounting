// Runs the composite PDF cases: prints each statement to PDF with Chromium,
// checks the file independently (pdfminer.six text per page, plus a pdf.js
// raster sample of chosen pages), then reads it with the product, unaided and
// after declared assistance, and judges the result against the case contract.
//   MIZAN_CHROMIUM=... PYTHONPATH=work/pyvendor \
//   node --experimental-strip-types audit/hard-cases/pdf-composite-run.mjs \
//     --seeds 1 --engine-root . --out work/hard/pdfc/run [--samples]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import {
  PATTERNS,
  PDF_COMPOSITE_VERSION,
  VARIANTS,
  compositeCase,
} from './pdf-composite.mjs';

const { values: args } = parseArgs({
  options: {
    seeds: { type: 'string', default: '1' },
    'engine-root': { type: 'string', default: '.' },
    out: { type: 'string', default: 'work/hard/pdfc/run' },
    samples: { type: 'boolean', default: false },
    pattern: { type: 'string', default: '' },
  },
});
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(args['engine-root']);
const load = (m) => import(pathToFileURL(resolve(root, 'lib/reconciliation', m)).href);
const { readFile } = await load('io.ts');
const { selectImportMapping } = await load('import-selection.ts');
const { reconcileSupplierStatement } = await load('supplier-reconciliation.ts');
const { engineCatalog } = await import(
  pathToFileURL(resolve(root, 'lib/i18n/engine-catalog.ts')).href
);
const knownPatterns = Object.keys(engineCatalog).map(
  (k) =>
    new RegExp(
      k
        .split('${…}')
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*?'),
    ),
);
const knownMessage = (m) => {
  const text = String(m).replace(/^[^:\n]{1,120}\.(?:csv|xlsx|pdf):\s*/i, '');
  return knownPatterns.some((p) => p.test(text));
};
const git = (cwd, ...c) => spawnSync('git', c, { cwd, encoding: 'utf8' }).stdout.trim();
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
mkdirSync(args.out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.MIZAN_CHROMIUM });
const page = await browser.newPage();
const printPdf = async (html) => {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.pdf({ landscape: true, format: 'A4', printBackground: true });
};
// Raster samples: pdf.js (from unpdf) draws the PDF bytes on a canvas.
const pdfjs = readFileSync(resolve(here, '../../node_modules/unpdf/dist/pdfjs.mjs'));
const raster = await browser.newPage({ viewport: { width: 1300, height: 950 } });
let current = null;
await raster.route('http://local/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/pdfjs.mjs') return route.fulfill({ body: pdfjs, contentType: 'text/javascript' });
  if (path === '/doc.pdf') return route.fulfill({ body: current, contentType: 'application/pdf' });
  return route.fulfill({ body: '<!doctype html><canvas id="c"></canvas>', contentType: 'text/html' });
});
const sample = async (bytes, pageNo, pngPath) => {
  current = bytes;
  await raster.goto('http://local/index.html');
  await raster.evaluate(async (n) => {
    const lib = await import('http://local/pdfjs.mjs');
    const data = new Uint8Array(await (await fetch('http://local/doc.pdf')).arrayBuffer());
    const doc = await lib.getDocument({ data }).promise;
    const p = await doc.getPage(Math.min(n, doc.numPages));
    const viewport = p.getViewport({ scale: 1.2 });
    const canvas = document.getElementById('c');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }, pageNo);
  writeFileSync(pngPath, await raster.locator('#c').screenshot());
};

const scope = {
  supplier: 'S',
  entity: 'E',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const squash = (t) => t.normalize('NFKC').replace(/\s+/g, '');
const hasArabic = (t) => /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(t);

const cases = [];
for (const seed of args.seeds.split(',').flatMap((x) => {
  const [a, b] = x.split('-').map(Number);
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
}))
  for (const pattern of PATTERNS.filter((p) => !args.pattern || p === args.pattern))
    for (const variant of VARIANTS) cases.push(compositeCase(pattern, variant, seed));

// 1. Print every statement.
const files = [];
for (const c of cases) {
  const bytes = await printPdf(c.html);
  const path = resolve(args.out, `${c.id}.pdf`);
  writeFileSync(path, bytes);
  files.push({ c, bytes, path });
}
// 2. Independent reading with pdfminer.
const verify = JSON.parse(
  execFileSync('python3', [resolve(here, 'pdf_verify.py'), ...files.map((f) => f.path)], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }),
);

const results = [];
for (const { c, bytes, path } of files) {
  const pages = verify[path].pages;
  const all = squash(pages.join('\n'));
  const independent = {
    pages: pages.length,
    arabicShown: hasArabic(pages.join('')),
    missingValues: c.independent.cellValues.filter((v) => !all.includes(squash(v))),
    pageCountOk: c.independent.pageCount ? pages.length === c.independent.pageCount : true,
    splitAcrossPages: null,
  };
  if (c.independent.splitAcross) {
    const k = pages.findIndex((p) => squash(p).includes(squash(c.independent.splitAcross.ref)));
    independent.splitAcrossPages =
      k >= 0 && k + 1 < pages.length && /continued line/.test(pages[k + 1]) && /continued line/.test(pages[k]);
  }
  independent.ok =
    !independent.missingValues.length &&
    independent.pageCountOk &&
    (!c.independent.expectArabic || independent.arabicShown) &&
    (c.independent.splitAcross ? independent.splitAcrossPages === true : true);
  if (args.samples && c.seed === Number(args.seeds.split(',')[0].split('-')[0])) {
    await sample(bytes, 1, resolve(args.out, `${c.id}-p1.png`));
    if (['CROSSPAGE', 'MISSINGPAGE', 'REPEAT'].includes(c.pattern))
      await sample(bytes, 2, resolve(args.out, `${c.id}-p2.png`));
  }
  // 3. The product.
  const record = { id: c.id, pattern: c.pattern, variant: c.variant, seed: c.seed, independent, runs: {} };
  const ledgerFile = await readFile('ledger.csv', new TextEncoder().encode(c.ledgerCsv).buffer);
  let supplierFile;
  try {
    supplierFile = await readFile(`${c.id}.pdf`, buffer(bytes), undefined, true);
  } catch (e) {
    // Refused while reading the PDF, before any reading could be chosen.
    for (const assist of ['none', 'declared'])
      record.runs[assist] = { assistance: [], ...judge(c, null, String(e?.message ?? e).slice(0, 200)) };
    results.push(record);
    console.log(`${c.id.padEnd(34)} independent ${independent.ok ? 'ok ' : 'BAD'} | read refused: ${record.runs.none.verdict}`);
    continue;
  }
  for (const assist of ['none', 'declared']) {
    const assistance = [];
    const supplierMapping = { ...selectImportMapping(supplierFile, 'supplier').mapping };
    const ledgerMapping = { ...selectImportMapping(ledgerFile, 'ledger').mapping };
    if (assist === 'declared') {
      supplierMapping.pdfReviewed = true;
      assistance.push({ side: 'supplier', kind: 'pdfReviewed', simulated: true });
      const header = supplierFile.sheets[0].rows[supplierMapping.header] ?? [];
      const wanted =
        c.contract.referenceHeader ??
        (c.pattern === 'ARABIC' ? 'رقم الفاتورة' : c.pattern === 'SPLIT2D' ? 'Reference' : 'Invoice No');
      const col = header.findIndex((h) => squash(String(h)) === squash(wanted));
      if (col >= 0 && supplierMapping.reference !== col) {
        assistance.push({ side: 'supplier', kind: 'columns', fields: ['reference'], header: wanted });
        supplierMapping.reference = col;
      }
      const lcol = ledgerFile.sheets[0].rows[ledgerMapping.header].indexOf('Reference');
      if (ledgerMapping.reference !== lcol) {
        assistance.push({ side: 'ledger', kind: 'columns', fields: ['reference'] });
        ledgerMapping.reference = lcol;
      }
    }
    let result, stopped = null;
    try {
      result = reconcileSupplierStatement({
        files: [supplierFile, ledgerFile],
        mappings: [supplierMapping, ledgerMapping],
        scope,
      }).result;
    } catch (e) {
      stopped = String(e?.message ?? e).slice(0, 200);
    }
    record.runs[assist] = { assistance, ...judge(c, result, stopped) };
  }
  results.push(record);
  console.log(
    `${c.id.padEnd(34)} independent ${independent.ok ? 'ok ' : 'BAD'} | unaided ${record.runs.none.verdict.padEnd(22)} | declared ${record.runs.declared.verdict}`,
  );
}
await browser.close();

/** The contract's verdict for one run. */
function judge(c, result, stopped) {
  const out = { verdict: '', findings: [], counts: { misreads: 0, lost: 0, falseApprovals: 0, wrongMembers: 0, missed: 0 } };
  if (stopped) {
    // A catalogued product refusal names a reading problem for the accountant:
    // safe, but the case is not solved. Anything else is an internal error.
    out.stopped = stopped;
    out.verdict = knownMessage(stopped) ? 'stopped-flagged' : 'fail-crash';
    return out;
  }
  const key = new Map();
  const truthBy = (rows, side) => {
    const txs = side === 'supplier' ? result.supplier.transactions : result.ledger.transactions;
    const used = new Set();
    for (const t of txs) {
      const hit = rows.find((r) => !used.has(r.key) && r.minor === t.amount && r.date === t.date);
      if (!hit) {
        out.counts.misreads++;
        out.findings.push(`${side} row read as ${t.date} ${t.amount} ${t.reference} matches nothing written`);
        continue;
      }
      used.add(hit.key);
      key.set(t.id, hit.key);
    }
    return used;
  };
  // Rows as the file shows them: a missing page's rows are absent, a doubled
  // page's rows appear twice.
  const shown = c.shownRows.map((r, i) => ({ ...r, key: c.shownRows.indexOf(r) === i ? r.key : `${r.key}'` }));
  const usedS = truthBy(shown, 'supplier');
  truthBy(c.ledgerRows, 'ledger');
  const errors = result.supplier.errors.filter((e) => e.row > 0).length;
  out.counts.lost = Math.max(0, shown.length - usedS.size - errors);
  const txByKey = new Map(
    [...result.supplier.transactions].filter((t) => key.has(t.id)).map((t) => [key.get(t.id), t]),
  );
  const matched = result.cases
    .filter((x) => x.status === 'Matched')
    .map((x) => ({
      a: x.supplierMembers.map((t) => key.get(t.id) ?? t.id).sort(),
      b: x.ledgerMembers.map((t) => key.get(t.id) ?? t.id).sort(),
    }));
  const same = (g, m) => JSON.stringify([[...g.a].sort(), [...g.b].sort()]) === JSON.stringify([m.a, m.b]);
  for (const g of c.approved) if (!matched.some((m) => same(g, m))) out.counts.missed++;
  for (const m of matched)
    if (!c.approved.some((g) => same(g, m))) {
      if (c.approved.some((g) => g.a.some((k) => m.a.includes(k)))) out.counts.wrongMembers++;
      else out.counts.falseApprovals++;
      out.findings.push(`unexpected approval ${m.a.join('+')} | ${m.b.join('+')}`);
    }
  const text = (keys) =>
    result.cases
      .filter((x) => x.supplierMembers.some((t) => keys.includes(key.get(t.id))))
      .flatMap((x) => [x.status, ...x.evidence, ...[...x.supplierMembers, ...x.ledgerMembers].flatMap((t) => t.referenceEvidenceIssues ?? [])])
      .join('\n');
  const unsafe = out.counts.falseApprovals || out.counts.wrongMembers || out.counts.misreads;
  const k = c.contract;
  if (unsafe) out.verdict = 'fail-unsafe';
  else if (k.kind === 'solve' || k.kind === 'read') {
    out.verdict = !out.counts.missed && !out.counts.lost ? 'pass' : 'fail-missed';
    for (const r of k.retained ?? []) {
      const t = txByKey.get(r.key);
      const kept =
        r.field === 'batch'
          ? t?.retainedEvidence?.some((e) => e.field === 'batch' && e.value === r.value && e.header === r.header)
          : t?.[r.field] === r.value;
      if (!kept) {
        out.verdict = 'fail-evidence-lost';
        out.findings.push(`not kept: ${r.key} ${r.field} ${r.value}`);
      }
    }
  } else if (k.kind === 'refuse')
    out.verdict = !out.counts.missed ? 'pass' : 'fail-controls-missed';
  else if (k.kind === 'surface') {
    const t = text(k.keys);
    out.verdict = out.counts.missed
      ? 'fail-controls-missed'
      : /Needs Review/.test(t) && new RegExp(k.signal).test(t)
        ? 'pass'
        : 'fail-signal-missing';
  } else if (k.kind === 'read-or-flag') {
    // Read whole and matched, or flagged and left unapproved; a fragment
    // taken silently as the reference is a misread.
    const t = txByKey.get(k.keys[0]);
    const truth = c.supplierRows.find((r) => r.key === k.keys[0]);
    const flagged = !t || !!t.referenceEvidenceIssues?.length || errors > 0;
    if (t && t.reference !== truth.ref && !t.referenceEvidenceIssues?.length) {
      out.verdict = 'fail-silent-misread';
      out.findings.push(`reference read as ${t.reference} for ${truth.ref}`);
    } else if (out.counts.lost) out.verdict = 'fail-row-lost';
    else if (t && t.reference === truth.ref) out.verdict = out.counts.missed ? 'fail-missed' : 'pass';
    else out.verdict = flagged ? 'pass-flagged' : 'fail-missed';
  } else if (k.kind === 'incomplete') {
    const verified = result.supplier.balanceArithmeticStatus === 'BALANCE_ARITHMETIC_VERIFIED';
    out.verdict = verified ? 'fail-claims-complete' : out.counts.missed ? 'fail-missed' : 'pass';
    out.balanceStatus = result.supplier.balanceArithmeticStatus ?? null;
  }
  return out;
}

const tally = (assist) =>
  Object.fromEntries(
    [...new Set(results.map((r) => r.runs[assist].verdict))].sort().map((v) => [v, results.filter((r) => r.runs[assist].verdict === v).length]),
  );
const summary = {
  version: PDF_COMPOSITE_VERSION,
  provenance: {
    engine: { root: args['engine-root'], commit: git(root, 'rev-parse', 'HEAD'), engineFilesModified: !!git(root, 'status', '--porcelain', '--', 'lib') },
    harness: { commit: git(here, 'rev-parse', 'HEAD'), generatorSha256: sha(resolve(here, 'pdf-composite.mjs')), runnerSha256: sha(resolve(here, 'pdf-composite-run.mjs')) },
    producer: `Chromium ${browser.version?.() ?? ''} page.pdf, DejaVu Sans`,
    independentReader: 'pdfminer.six (Python), not the product reader',
  },
  seeds: args.seeds,
  cases: results.length,
  independentOk: results.filter((r) => r.independent.ok).length,
  unaided: tally('none'),
  declared: tally('declared'),
  results,
};
writeFileSync(resolve(args.out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ cases: summary.cases, independentOk: summary.independentOk, unaided: summary.unaided, declared: summary.declared }));
