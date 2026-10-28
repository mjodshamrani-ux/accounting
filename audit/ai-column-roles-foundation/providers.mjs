// AI-1b: fake providers through the column role adapter on the sealed AI-1a
// statements, scored by the sealed measure (score.mjs) with correction 1.
// No model, download or connection: each provider is a function here.
//
//   node --experimental-strip-types audit/ai-column-roles-foundation/providers.mjs --provider=oracle [--out file] [--assert file]
//
// - abstain: names nothing. It must cost what the engine alone costs.
// - oracle: knows the sealed truth, names every decidable unset role right
//   and abstains in K5. It is the most any provider could save here: the
//   ceiling, not a model's result.
// - near-miss: names the column beside the right one (or the next free one),
//   citing its heading, and guesses in K5. Every name it gives is wrong; the
//   adapter refuses those that collide with a role already set, and G3 must
//   refuse the provider.
// For each story the accountant has set the true heading row and mode (both
// counted by the measure) and the panel shows the assistant; the provider is
// asked through askColumnRoles, and only roles the adapter lets through
// count as proposed. A reviewer applies those that are right and rejects the
// others. G5 is the sealed one: the comparison with the final, true mapping.
// Beside it, for information only, the comparison if every proposal that
// passed were applied unreviewed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assisted, gates } from './score.mjs';
import { FROZEN, judged, prepared, unsafe } from './measure.mjs';
import { CORRECTION, storyRecord, summaryOf } from './correction-1/measure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { askColumnRoles } = await import(
  pathToFileURL(resolve(root, 'lib/reconciliation/column-role-proposals.ts')).href
);

const heading = (r, column) => ({ row: r.columns[column].header.row, column: r.columns[column].header.column });
const reply = (r, proposals) => ({
  schemaVersion: 1,
  taskKind: 'column-role',
  requestId: r.requestId,
  contextRevision: r.contextRevision,
  proposals,
});
export const PROVIDERS = {
  abstain: () => async (r) => reply(r, r.allowed.map((field) => ({ field, reason: 'no-evidence' }))),
  oracle: (truth, decidable) => async (r) =>
    reply(
      r,
      r.allowed.map((field) =>
        !decidable
          ? { field, reason: 'ambiguous' }
          : truth.columns[field] >= 0
            ? { field, column: truth.columns[field], reason: 'heading-names-role', evidence: [heading(r, truth.columns[field])] }
            : { field, reason: 'no-evidence' },
      ),
    ),
  'near-miss': (truth) => async (r) => {
    const used = new Set();
    return reply(
      r,
      r.allowed.flatMap((field) => {
        const right = truth.columns[field];
        if (right < 0) return [{ field, reason: 'no-evidence' }];
        const wrong = [right + 1, right - 1, ...r.columns.map((_, i) => i)].find(
          (c) => c >= 0 && c < r.columns.length && c !== right && !used.has(c),
        );
        if (wrong === undefined) return [{ field, reason: 'ambiguous' }];
        used.add(wrong);
        return [{ field, column: wrong, reason: 'heading-names-role', evidence: [heading(r, wrong)] }];
      }),
    );
  },
};

const git = (...c) => spawnSync('git', c, { cwd: root, encoding: 'utf8' }).stdout.trim();

export async function measureProvider(name, frozen = FROZEN) {
  const make = PROVIDERS[name];
  if (!make) throw new Error(`no provider ${name}`);
  const oracle = JSON.parse(readFileSync(resolve(frozen, 'expected.json'), 'utf8'));
  const records = [];
  for (const expected of oracle.stories) {
    const { record, story, mapping, truth, after, scope } = await storyRecord(expected, frozen);
    if (!record.readable) {
      records.push(record);
      continue;
    }
    const proposals = {};
    let adapter = null;
    let applied = null;
    if (record.asked) {
      const asked = { ...after, mode: truth.mode };
      const result = await askColumnRoles(story.pdf, asked, make(truth, expected.decidable), {
        requestId: `ai1b-${expected.id}`,
      });
      adapter = result.status === 'answered'
        ? { status: result.status, fields: result.fields.map((f) => ({ field: f.field, status: f.status,
            ...(f.status === 'abstained' ? { reason: f.reason } : { column: f.column }),
            ...(f.status === 'rejected' ? { code: f.code } : {}) })) }
        : { status: result.status, code: result.code ?? null };
      if (result.status === 'answered') {
        for (const f of result.fields)
          if (f.status !== 'abstained') proposals[f.field] = { column: f.column, passed: f.status === 'proposed' };
        if (Object.keys(result.patch).length) {
          const verdict = judged(expected, story.pdf, story.ledger,
            prepared(story.pdf, { ...asked, ...result.patch }, scope), scope);
          applied = { verdict: verdict.verdict, unsafe: unsafe(verdict), counts: verdict.counts };
        }
      }
    }
    records.push({
      ...record,
      adapter,
      assisted: assisted(truth, mapping, after, proposals, expected.decidable),
      appliedUnreviewed: applied,
    });
  }
  const readable = records.filter((r) => r.readable);
  return {
    provider: name,
    correction: CORRECTION,
    commit: git('rev-parse', 'HEAD'),
    summary: { ...summaryOf(records), withProvider: gates(readable) },
    stories: records,
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: { provider: { type: 'string' }, out: { type: 'string' }, assert: { type: 'string' } },
  });
  const report = await measureProvider(args.provider);
  for (const r of report.stories)
    if (r.readable)
      console.log(r.id, r.class, JSON.stringify(r.assisted), r.adapter ? r.adapter.status : 'not asked',
        r.appliedUnreviewed ? `applied unreviewed: ${r.appliedUnreviewed.verdict}${r.appliedUnreviewed.unsafe ? ' UNSAFE' : ''}` : '');
  console.log(JSON.stringify(report.summary.withProvider));
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1) + '\n');
  if (args.assert) {
    const want = JSON.parse(readFileSync(args.assert, 'utf8'));
    const strip = (r) => JSON.stringify({ provider: r.provider, summary: r.summary, stories: r.stories });
    if (strip(want) !== strip(report)) {
      console.error('the run differs from', args.assert);
      process.exit(1);
    }
    console.log('the run equals', args.assert);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
