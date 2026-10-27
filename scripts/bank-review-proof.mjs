// WF-1 REVIEW-1 R1: the review queue (bank-review-queue.ts) on the sealed
// foundation (audit/bank-review-foundation), against EXPECTED.json field by
// field. For each story the period is replayed by the lifecycle and its queue
// compared with the oracle's: every group with its signature, class,
// direction, shape, gap, cases in order with members and impact, impact,
// members and offers. Then the story's actions are applied in order as the
// accountant would: a group decision on the group holding the named member,
// as the single decisions groupDecisions gives; a single decision or an undo
// on the case holding exactly its members; a corrected cashbook. The
// decisions recorded, the refusal, the statuses, the counts and the queue
// left are compared with the oracle's.
//   node --experimental-strip-types scripts/bank-review-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/bank-review-foundation/frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const { replayBankStatement } = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));
const { statementDecision } = await import(path.join(root, 'lib/reconciliation/bank-statement-view.ts'));
const { reviewQueue, groupDecisions } = await import(path.join(root, 'lib/reconciliation/bank-review-queue.ts'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const NOTE = 'synthetic foundation decision';
const AT = '2026-12-01T09:00:00.000Z';
const STATUS = { 'matched-accepted': 'accepted', rejected: 'rejected', 'needs-review': 'needs-review' };
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) => JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));
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

/** The story judged by the product, in the oracle's terms. */
async function judge(story) {
  const period = story.periods.at(-1).id;
  const statement = await bytes(`${period}-statement.pdf`);
  let cashbookName = `${period}-cashbook.csv`;
  let cashbook = await bytes(cashbookName);
  let { result } = await replayBankStatement(state(period, cashbookName, statement, cashbook, []));
  const first = reviewQueue(result);
  const out = {
    held: result.status === 'held',
    queue: plain(first),
    actions: { single: first.reduce((n, g) => n + g.cases.length, 0), grouped: first.length },
  };
  const decisions = [];
  const next = () => `D${decisions.length + 1}`;
  const holding = (a) => {
    const found = result.cases.filter(
      (c) => c.kind === 'review' && same(c.statement, a.statement) && same(c.cashbook, a.cashbook),
    );
    if (found.length !== 1) throw new Error(`no single case holds ${a.statement.join(' ')} ${a.cashbook.join(' ')}`);
    return found[0];
  };
  for (const action of story.actions) {
    if (action.group) {
      const a = action.group;
      const found = reviewQueue(result).filter((g) =>
        g.cases.some((c) => c.statement.includes(a.with) || c.cashbook.includes(a.with)),
      );
      if (found.length !== 1) throw new Error(`no group holds ${a.with}`);
      const made = groupDecisions(result, found[0].signature, a.type, NOTE, (i) => `D${decisions.length + i + 1}`, AT);
      if (!made) throw new Error(`a group ${a.type} is not offered for ${found[0].signature}`);
      decisions.push(...made);
    } else if (action.decide) {
      decisions.push(statementDecision(result, holding(action.decide), action.decide.type, NOTE, next(), AT));
    } else if (action.undo) {
      decisions.push(statementDecision(result, holding(action.undo), 'undo', NOTE, next(), AT));
    } else if (action.replace) {
      cashbookName = `${period}-cashbook-corrected.csv`;
      cashbook = await bytes(cashbookName);
    } else throw new Error(`unknown action ${Object.keys(action).join(' ')}`);
    try {
      ({ result } = await replayBankStatement(state(period, cashbookName, statement, cashbook, [...decisions])));
    } catch (error) {
      if (!action.replace) throw error;
      out.refusal = error instanceof Error ? error.message : String(error);
      out.decisions = decisions.map((d) => [d.type, d.case]);
      return out;
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
  return out;
}

const failures = [];
let groups = 0;
let cases = 0;
let decided = 0;
for (const story of facts.stories) {
  const want = expected[story.id];
  let got;
  try {
    got = await judge(story);
  } catch (error) {
    failures.push([story.id, 'error', error instanceof Error ? error.message : String(error)]);
    continue;
  }
  groups += got.queue.length;
  cases += got.actions.single;
  decided += got.decisions.length;
  for (const field of ['held', 'queue', 'actions', 'refusal', 'decisions', 'statuses', 'after', 'queueAfter']) {
    if (!(field in want) && !(field in got)) continue;
    try {
      assert.deepStrictEqual(got[field], want[field]);
    } catch {
      failures.push([story.id, field]);
    }
  }
}
console.log(
  JSON.stringify({
    stories: facts.stories.length,
    equal: facts.stories.length - new Set(failures.map(([id]) => id)).size,
    groups,
    cases,
    decisions: decided,
    failures,
  }),
);
assert.deepEqual(failures, [], 'the queue differs from the sealed expectation');
