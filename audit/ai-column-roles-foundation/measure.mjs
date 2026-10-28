// Runs the product on the sealed AI-1a statements and counts what the
// accountant must still set in the column panel (score.mjs), then judges a
// comparison run with the sealed judge.
//
//   node --experimental-strip-types audit/ai-column-roles-foundation/measure.mjs [--frozen dir] [--out file] [--assert file]
//
// For each story, as the supplier workspace does it (app/page.tsx):
// - the statement PDF is read with its columns proposed, the ledger CSV as
//   an export, and the product selects each mapping (selectImportMapping);
// - the workspace then applies the date and number formats suggestFormats
//   proves and the sign inferStatementDirection proves, until the mapping
//   settles (as the S3 runner run2.mjs does);
// - if the product's heading row is not the true one, the accountant sets
//   it, and the panel infers the roles again from that row (inferMapping
//   with the row), which is what a proposal would start from;
// - whether the product would ask a local model at all: it builds a
//   proposal context only when a role is unset (buildImportProposalContext).
// The engine-alone burden is score.mjs's `alone`. The declared run sets
// the true mapping and the reviewed PDF reading (pdfReviewed), and the
// sealed judge says whether the set can be reconciled once the roles are
// right. This runner names no provider: the engine alone is its subject.
// The provider runs of AI-1b use its exports and score.mjs, unchanged.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { judge, selfTest as judgeSelfTest } from './judge.mjs';
import { CLASSES, FIELDS, MEASURE_VERSION, alone, gates, selfTest as scoreSelfTest, truthOf } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const load = (m) => import(pathToFileURL(resolve(root, m)).href);
const { readFile } = await load('lib/reconciliation/io.ts');
const { inferMapping } = await load('lib/reconciliation/core.ts');
const { selectImportMapping } = await load('lib/reconciliation/import-selection.ts');
const { reconcileSupplierStatement } = await load('lib/reconciliation/supplier-reconciliation.ts');
const { headerLabels } = await load('lib/reconciliation/header-view.ts');
const { buildImportProposalContext } = await load('lib/reconciliation/import-proposals.ts');
const { suggestFormats } = await load('lib/reconciliation/format-inference.ts');
const { inferStatementDirection } = await load('lib/reconciliation/statement-direction.ts');
const { engineCatalog } = await load('lib/i18n/engine-catalog.ts');
const { ENGINE_VERSION } = await load('lib/reconciliation/types.ts');

export const FROZEN = resolve(here, 'frozen');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const buffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const patterns = Object.keys(engineCatalog).map(
  (k) => new RegExp(k.split('${…}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*?')),
);
export const known = (m) => {
  const text = String(m).replace(/^[^:\n]{1,120}\.(?:csv|xlsx|pdf):\s*/i, '');
  return patterns.some((p) => p.test(text));
};

export function scopeOf(expected) {
  const s = expected.scope;
  return { supplier: s.supplier, entity: s.entity, account: s.account, currency: s.currency, decimals: s.decimals,
    cutoff: s.cutoff, dateWindow: s.dateWindow, confirmed: true, coverageConfirmed: false };
}

/** The mapping after the workspace's own preparation: proven formats and a
 * proven direction, applied until nothing changes (app/page.tsx). */
export function prepared(file, mapping, scope) {
  let current = { ...mapping };
  for (let round = 0; round < 6; round++) {
    const next = { ...current };
    const proof = file.visual ? undefined : inferStatementDirection(file, current, scope.decimals);
    if (proof) Object.assign(next, { multiplier: proof.multiplier, directionEvidence: proof });
    else delete next.directionEvidence;
    const patch = suggestFormats(file, next, scope.decimals).patch;
    for (const field of ['dateFormat', 'numberFormat']) {
      if (field === 'numberFormat' && !scope.currency) continue;
      if (patch[field] && patch[field] !== next[field]) next[field] = patch[field];
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    current = next;
  }
  throw new Error('the workspace preparation does not settle');
}

export async function readStory(expected, frozen = FROZEN) {
  const pdfBytes = readFileSync(resolve(frozen, `${expected.id}-statement.pdf`));
  const ledgerBytes = readFileSync(resolve(frozen, `${expected.id}-ledger.csv`));
  const pdf = await readFile(`${expected.id}-statement.pdf`, buffer(pdfBytes), undefined, true);
  const ledger = await readFile(`${expected.id}-ledger.csv`, buffer(ledgerBytes));
  return { pdf, ledger, pdfSha256: sha(pdfBytes) };
}

const roles = (m) => Object.fromEntries([['header', m.header], ['mode', m.mode], ...FIELDS.map((f) => [f, m[f]])]);

/** The product's reading of one story's columns and what the panel shows
 * once the heading row is right. */
export function columnsOf(expected, pdf, scope) {
  const mapping = prepared(pdf, selectImportMapping(pdf, 'supplier').mapping, scope);
  const sheet = pdf.sheets[mapping.sheet] ?? pdf.sheets[0];
  const sheetIndex = pdf.sheets.indexOf(sheet);
  const rows = sheet.rows.slice(0, 100).map((_, i) => [...headerLabels(sheet, i)]);
  const truth = truthOf(expected, rows);
  if (!truth) return { mapping, truth: null, sheetIndex };
  const after =
    mapping.header === truth.header && mapping.sheet === sheetIndex
      ? mapping
      : prepared(pdf, inferMapping(pdf, sheetIndex, truth.header), scope);
  return { mapping, truth, after, sheetIndex };
}

/** The workspace's condition for showing the import assistant. */
export const assistantShown = (m) =>
  m.date < 0 || (m.mode === 'signed' ? m.amount < 0 : m.debit < 0 || m.credit < 0) || m.reference < 0;

/** A comparison with the given statement mapping, the PDF reading declared
 * reviewed, judged by the sealed judge. */
export function judged(expected, pdf, ledger, mapping, scope) {
  let run;
  try {
    const ledgerMapping = prepared(ledger, selectImportMapping(ledger, 'ledger').mapping, scope);
    run = { result: reconcileSupplierStatement({ files: [pdf, ledger],
      mappings: [{ ...mapping, pdfReviewed: true }, ledgerMapping], scope }).result };
  } catch (e) {
    run = { stopped: e?.message ?? String(e) };
  }
  return judge(expected, run, known);
}

/** What the judge counts unsafe: a misread, a line in another currency
 * read as riyals, a lost row or a wrong approval. */
export const unsafe = (verdict) =>
  ['misreads', 'currencyMisreads', 'lost', 'wrongApprovals'].some((k) => verdict.counts[k] > 0);

/** The true mapping on the true heading row, prepared as the workspace
 * prepares any mapping. */
export function trueMapping(pdf, after, truth, scope) {
  return prepared(pdf, { ...after, ...truth.columns, mode: truth.mode }, scope);
}

const git = (...c) => spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();

async function main() {
  const { values: args } = parseArgs({
    options: { frozen: { type: 'string', default: FROZEN }, out: { type: 'string' }, assert: { type: 'string' } },
  });
  const frozen = resolve(args.frozen);
  // The judge's self-test throws on a failure and returns the cases it saw;
  // the measure's returns its failures.
  const judgeCases = judgeSelfTest().length;
  if (scoreSelfTest().length) throw new Error('the measure fails its self-test');
  const manifestBytes = readFileSync(resolve(frozen, 'INPUT-MANIFEST.json'));
  const oracle = JSON.parse(readFileSync(resolve(frozen, 'expected.json'), 'utf8'));
  const records = [];
  for (const expected of oracle.stories) {
    const scope = scopeOf(expected);
    const { pdf, ledger, pdfSha256 } = await readStory(expected, frozen);
    const { mapping, truth, after } = columnsOf(expected, pdf, scope);
    const record = { id: expected.id, class: expected.class, language: expected.language,
      producer: expected.producer, product: roles(mapping) };
    if (!truth) {
      record.readable = false;
      records.push(record);
      console.log(expected.id, expected.class, 'headings not read as one row');
      continue;
    }
    // The panel shows the assistant only when a required role is unset
    // (app/page.tsx: missingColumns or no reference column); only then can
    // a provider be asked, from the context the product builds.
    const asked = assistantShown(after) && !!buildImportProposalContext(pdf, after);
    const declared = judged(expected, pdf, ledger, trueMapping(pdf, after, truth, scope), scope);
    Object.assign(record, {
      readable: true,
      truth: { header: truth.header, mode: truth.mode, ...truth.columns },
      afterHeader: roles(after),
      alone: alone(truth, mapping, after),
      asked,
      unresolved: FIELDS.filter((f) => after[f] === -1),
      declared: { verdict: declared.verdict, counts: declared.counts, stopped: declared.stopped ?? null,
        findings: declared.findings.slice(0, 3) },
      unsafe: unsafe(declared),
      pdfSha256,
    });
    records.push(record);
    const a = record.alone;
    console.log(expected.id, expected.class, `header ${a.header} mode ${a.mode} picks ${a.picks}`,
      JSON.stringify(a.wrong), '| asked', record.asked, JSON.stringify(record.unresolved), '| declared',
      declared.verdict, declared.stopped ?? '');
  }
  const readable = records.filter((r) => r.readable);
  const summary = {
    stories: records.length,
    unreadable: records.filter((r) => !r.readable).map((r) => r.id),
    byClass: Object.fromEntries(CLASSES.map((c) => {
      const rs = readable.filter((r) => r.class === c);
      const n = (k) => rs.reduce((s, r) => s + r.alone[k], 0);
      return [c, { stories: rs.length, header: n('header'), mode: n('mode'), picks: n('picks'),
        asked: rs.filter((r) => r.asked).length, declaredComplete: rs.filter((r) => r.declared.verdict === 'complete').length }];
    })),
    engineAlone: gates(readable.map((r) => ({ ...r, assisted: null }))),
  };
  const report = {
    measure: MEASURE_VERSION,
    engineVersion: ENGINE_VERSION,
    commit: git('rev-parse', 'HEAD'),
    engineFilesModified: !!git('status', '--porcelain', '--', 'lib'),
    manifestSha256: sha(manifestBytes),
    judgeSelfTest: judgeCases,
    provider: null,
    summary,
    stories: records,
  };
  console.log(JSON.stringify(summary));
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1) + '\n');
  if (args.assert) {
    const want = JSON.parse(readFileSync(args.assert, 'utf8'));
    const strip = (r) => JSON.stringify({ summary: r.summary, stories: r.stories, manifest: r.manifestSha256 });
    if (strip(want) !== strip(report)) {
      console.error('the run differs from', args.assert);
      process.exit(1);
    }
    console.log('the run equals', args.assert);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
