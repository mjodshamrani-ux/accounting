// The engine-alone run of the sealed measure with correction 1 to its truth
// rule (truth.mjs): a heading row repeated on a later page is the first.
// Everything else is the sealed runner's own export, unchanged: the
// workspace preparation, the reading, the declared comparison and the judge
// (../measure.mjs), the actions and the gates (../score.mjs).
//
//   node --experimental-strip-types audit/ai-column-roles-foundation/correction-1/measure.mjs [--out file] [--assert file]
//
// ../results/baseline-1.json, the first run by the sealed runner, stays as
// it came.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { selfTest as judgeSelfTest } from '../judge.mjs';
import { CLASSES, FIELDS, MEASURE_VERSION, alone, gates, selfTest as scoreSelfTest } from '../score.mjs';
import { FROZEN, assistantShown, judged, prepared, readStory, scopeOf, trueMapping, unsafe } from '../measure.mjs';
import { selfTest as truthSelfTest, truthOf } from './truth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const load = (m) => import(pathToFileURL(resolve(root, m)).href);
const { inferMapping } = await load('lib/reconciliation/core.ts');
const { selectImportMapping } = await load('lib/reconciliation/import-selection.ts');
const { headerLabels } = await load('lib/reconciliation/header-view.ts');
const { buildImportProposalContext } = await load('lib/reconciliation/import-proposals.ts');
const { ENGINE_VERSION } = await load('lib/reconciliation/types.ts');

export const CORRECTION = 'correction-1: a heading row repeated on a later page';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const roles = (m) => Object.fromEntries([['header', m.header], ['mode', m.mode], ...FIELDS.map((f) => [f, m[f]])]);

/** As the sealed columnsOf, with the corrected truth rule. */
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

/** One story's engine-alone record, as the sealed runner writes it. */
export async function storyRecord(expected, frozen = FROZEN) {
  const scope = scopeOf(expected);
  const story = await readStory(expected, frozen);
  const { pdf, ledger, pdfSha256 } = story;
  const { mapping, truth, after } = columnsOf(expected, pdf, scope);
  const record = { id: expected.id, class: expected.class, language: expected.language,
    producer: expected.producer, product: roles(mapping) };
  if (!truth) return { record: { ...record, readable: false }, story };
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
  return { record, story, mapping, truth, after, scope };
}

export function summaryOf(records) {
  const readable = records.filter((r) => r.readable);
  return {
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
}

const git = (...c) => spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();

async function main() {
  const { values: args } = parseArgs({ options: { out: { type: 'string' }, assert: { type: 'string' } } });
  const judgeCases = judgeSelfTest().length;
  if (scoreSelfTest().length || truthSelfTest().length) throw new Error('the measure or its correction fails its self-test');
  const manifestBytes = readFileSync(resolve(FROZEN, 'INPUT-MANIFEST.json'));
  const oracle = JSON.parse(readFileSync(resolve(FROZEN, 'expected.json'), 'utf8'));
  const records = [];
  for (const expected of oracle.stories) {
    const { record } = await storyRecord(expected);
    records.push(record);
    if (!record.readable) console.log(record.id, record.class, 'headings not read as one row');
    else console.log(record.id, record.class, JSON.stringify(record.alone), '| asked', record.asked, '| declared',
      record.declared.verdict);
  }
  const summary = summaryOf(records);
  const report = {
    measure: MEASURE_VERSION,
    correction: CORRECTION,
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
