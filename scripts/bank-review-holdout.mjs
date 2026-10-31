// WF-1 REVIEW-1 R3: the product on the sealed holdout
// audit/bank-review-holdout-r3, recorded as it comes. For each story the
// period is replayed by the lifecycle from its two files, and the story's
// actions are taken as the accountant takes them, as
// scripts/bank-review-proof.mjs takes the foundation's: a group decision on
// the group holding the named member, as the single decisions groupDecisions
// gives; a single decision or an undo on the case holding exactly its
// members; a corrected cashbook. Then:
//   1. the queue before, the decisions, the refusal, the statuses, the counts
//      and the queue after, against the sealed EXPECTED.json field by field;
//   2. the session saved and restored to the same result;
//   3. every workbook judged by audit/bank-review-foundation/check_export.py
//      against the sealed package, each on its own, never against the
//      product.
// A refusal or an error is recorded, not thrown. With --record=<file> the
// outcome is written to the holdout's results/ as that run's record; with
// --assert=<file> it must equal that record.
//   node --experimental-strip-types scripts/bank-review-holdout.mjs [--record=run-1.json | --assert=run-1.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// BANK_REVIEW_HOLDOUT_SUITE: another sealed review package, to try this
// runner on the foundation without reading the holdout.
const suite = path.resolve(root, process.env.BANK_REVIEW_HOLDOUT_SUITE ?? 'audit/bank-review-holdout-r3');
const frozen = path.join(suite, 'frozen');
const checker = path.join(root, 'audit/bank-review-foundation/check_export.py');
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const L = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));
const { statementDecision } = await import(path.join(root, 'lib/reconciliation/bank-statement-view.ts'));
const { reviewQueue, groupDecisions } = await import(path.join(root, 'lib/reconciliation/bank-review-queue.ts'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const NOTE = 'synthetic holdout decision';
const AT = '2028-07-01T09:00:00.000Z';
const STATUS = { 'matched-accepted': 'accepted', rejected: 'rejected', 'needs-review': 'needs-review' };
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sameIds = (a, b) => JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
      : v;
assert.deepEqual(canonical({ b: [{ y: 1, x: 2 }], a: 1 }), canonical({ a: 1, b: [{ x: 2, y: 1 }] }));
assert.notDeepEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }));
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const message = (error) => (error instanceof Error ? error.message : String(error));
const plain = (x) => JSON.parse(JSON.stringify(x));

function state(period, cashbookName, statement, cashbook, decisions) {
  return {
    version: 'bank-statement-lifecycle-1',
    files: [
      { name: `${period}-statement.pdf`, sha256: sha(statement), original: statement },
      { name: cashbookName, sha256: sha(cashbook), original: cashbook },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions,
  };
}

/** The story played on the product, in the oracle's terms, with the last
 * state and result. An action the product does not offer ends the story. */
async function judge(story, record) {
  const period = story.periods.at(-1).id;
  const statement = await bytes(`${period}-statement.pdf`);
  let cashbookName = `${period}-cashbook.csv`;
  let cashbook = await bytes(cashbookName);
  let current = state(period, cashbookName, statement, cashbook, []);
  let { result } = await L.replayBankStatement(current);
  const first = reviewQueue(result);
  const out = {
    held: result.status === 'held',
    queue: plain(first),
    actions: { single: first.reduce((n, g) => n + g.cases.length, 0), grouped: first.length },
  };
  const decisions = [];
  const holding = (a) =>
    result.cases.filter((c) => c.kind === 'review' && sameIds(c.statement, a.statement) && sameIds(c.cashbook, a.cashbook));
  for (const [i, action] of story.actions.entries()) {
    const refuse = (why) => {
      record.actionRefused = { action: i, kind: Object.keys(action)[0], why };
    };
    if (action.group) {
      const a = action.group;
      const found = reviewQueue(result).filter((g) =>
        g.cases.some((c) => c.statement.includes(a.with) || c.cashbook.includes(a.with)),
      );
      if (found.length !== 1) return refuse(`no single group holds ${a.with}`), null;
      const made = groupDecisions(result, found[0].signature, a.type, NOTE, (k) => `D${decisions.length + k + 1}`, AT);
      if (!made) return refuse(`a group ${a.type} is not offered for ${found[0].signature}`), null;
      decisions.push(...made);
    } else if (action.decide || action.undo) {
      const a = action.decide ?? action.undo;
      const found = holding(a);
      if (found.length !== 1) return refuse('no single case holds the members'), null;
      decisions.push(statementDecision(result, found[0], action.decide ? a.type : 'undo', NOTE, `D${decisions.length + 1}`, AT));
    } else {
      cashbookName = `${period}-cashbook-corrected.csv`;
      cashbook = await bytes(cashbookName);
    }
    current = state(period, cashbookName, statement, cashbook, [...decisions]);
    try {
      ({ result } = await L.replayBankStatement(current));
    } catch (error) {
      if (!action.replace) return refuse(message(error)), null;
      out.refusal = message(error);
      out.decisions = decisions.map((d) => [d.type, d.case]);
      return { out, current: null, result: null };
    }
  }
  const reviews = result.cases.filter((c) => c.kind === 'review');
  out.refusal = null;
  out.decisions = decisions.map((d) => [d.type, d.case]);
  out.statuses = Object.fromEntries(reviews.map((c) => [c.id, STATUS[c.status] ?? c.status]));
  out.after = {
    accepted: reviews.filter((c) => c.status === 'matched-accepted').length,
    rejected: reviews.filter((c) => c.status === 'rejected').length,
    open: reviews.filter((c) => c.status === 'needs-review').length,
  };
  out.queueAfter = plain(reviewQueue(result));
  return { out, current, result };
}

const FIELDS = ['held', 'queue', 'actions', 'refusal', 'decisions', 'statuses', 'after', 'queueAfter'];
const base = process.env.BANK_REVIEW_HOLDOUT_DIR ?? '/tmp';
await mkdir(base, { recursive: true });
const work = await mkdtemp(path.join(base, 'bank-review-holdout-'));
const stories = {};
const exportsToCheck = [];
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = { equal: false };
  stories[story.id] = record;
  let judged;
  try {
    judged = await judge(story, record);
  } catch (error) {
    record.error = message(error);
    continue;
  }
  if (!judged) continue;
  const { out, current, result } = judged;
  const fields = FIELDS.filter((k) => k in want || k in out);
  record.differences = fields.filter((k) => !same(out[k], want[k]));
  record.equal = record.differences.length === 0;
  if (!record.equal) record.outcome = Object.fromEntries(record.differences.map((k) => [k, out[k] ?? null]));
  if (!current) continue;
  try {
    const saved = await L.saveBankStatement(current);
    const back = await L.restoreBankStatement(saved);
    record.savedAndRestored = same(plain(back.result), plain(result));
  } catch (error) {
    record.saveError = message(error);
  }
  if (result.status === 'held') continue;
  try {
    const file = path.join(work, `${story.id}.xlsx`);
    await writeFile(file, new Uint8Array(await L.exportBankStatement(current, result)));
    exportsToCheck.push({ story: story.id, path: file, cashbook: current.files[1].name });
  } catch (error) {
    record.exportError = message(error);
  }
}

// Each workbook on its own, so that one rejected does not hide the others.
const workbooks = { exported: exportsToCheck.length, accepted: 0, rejected: {} };
for (const e of exportsToCheck) {
  const one = spawnSync(process.env.PYTHON ?? 'python3', ['-B', checker], {
    input: JSON.stringify({ frozen, exports: [e] }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (one.status === 0 && JSON.parse(one.stdout).checked === 1) workbooks.accepted += 1;
  else workbooks.rejected[e.story] = `${one.stdout}${one.stderr}`.trim().split('\n').at(-1);
}
const ids = Object.keys(stories);
const count = (f) => ids.filter((id) => f(stories[id], expected[id])).length;
const summary = {
  stories: ids.length,
  equalToExpected: count((r) => r.equal),
  heldAsExpected: count((r, w) => w.held === true && r.equal),
  refusedAsExpected: count((r, w) => !!w.refusal && r.equal),
  actionsRefused: count((r) => r.actionRefused),
  savedAndRestored: count((r) => r.savedAndRestored),
  failed: count((r) => r.error),
  workbooks,
  decisionActions: {
    caseByCase: ids.reduce((n, id) => n + (expected[id].decisions?.length ?? 0), 0),
    withQueue: facts.stories.reduce((n, s) => n + s.actions.filter((a) => !a.replace).length, 0),
  },
};
const report = { holdout: path.relative(root, suite), summary, stories };
console.log(JSON.stringify(summary));
const record = option('record');
if (record) {
  await mkdir(path.join(suite, 'results'), { recursive: true });
  await writeFile(path.join(suite, 'results', record), `${JSON.stringify(report, null, 1)}\n`);
}
const against = option('assert');
if (against) {
  const recorded = await json(path.join(suite, 'results', against));
  assert.deepEqual(canonical(report), canonical(recorded), `the product's outcome differs from ${against}`);
}
