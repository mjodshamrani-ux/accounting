// WF-1 REVIEW-1 foundation: the product as it is, on the sealed review
// stories (audit/bank-review-foundation), first run after the seal. For each
// story it records:
//   1. the period replayed by the lifecycle: whether the statement is held;
//   2. the review cases needing a decision, by case number, reason and exact
//      members, against the cases of the sealed queue;
//   3. the order the product lists them in (its review table shows the
//      result's case order) against the contract's queue order;
//   4. the sealed decisions, one per case as a group decision records them
//      (Q3), taken one by one through the lifecycle as single decisions: the
//      statuses they leave against the sealed statuses, and, after a
//      corrected cashbook, the refusal; and how many decision actions that
//      took against the story's own actions with a queue.
// A refusal or an error is recorded, not thrown. With --record=<file> the
// outcome is written to the package's results/; with --assert=<file> it must
// equal that record.
//   node --experimental-strip-types scripts/bank-review-baseline.mjs [--record=<file> | --assert=<file>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-review-foundation');
const frozen = path.join(suite, 'frozen');
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const { replayBankStatement } = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const message = (error) => (error instanceof Error ? error.message : String(error));
const STATUS = { 'matched-accepted': 'accepted', rejected: 'rejected', 'needs-review': 'needs-review' };
const byCase = (a, b) => Number(a.case.slice(1)) - Number(b.case.slice(1));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const key = (c) => JSON.stringify([c.case, c.reason, [...c.statement].sort(byText), [...c.cashbook].sort(byText)]);

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

const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = {};
  stories[story.id] = record;
  const period = story.periods.at(-1).id;
  const statement = await bytes(`${period}-statement.pdf`);
  const cashbook = await bytes(`${period}-cashbook.csv`);
  let result;
  try {
    ({ result } = await replayBankStatement(state(period, `${period}-cashbook.csv`, statement, cashbook, [])));
  } catch (error) {
    record.error = message(error);
    continue;
  }
  record.held = result.status === 'held';

  // The cases needing a decision, against the sealed queue.
  const open = result.cases
    .filter((c) => c.kind === 'review' && c.status === 'needs-review')
    .map((c) => ({ case: c.id, reason: c.reason, statement: c.statement, cashbook: c.cashbook }));
  const sealed = want.queue.flatMap((g) => g.cases.map((c) => ({ ...c, reason: g.reason })));
  const got = new Set(open.map(key));
  const wanted = new Set(sealed.map(key));
  record.cases = {
    expected: sealed.length,
    product: open.length,
    equal: got.size === wanted.size && [...got].every((k) => wanted.has(k)),
    missing: [...sealed].sort(byCase).filter((c) => !got.has(key(c))).map((c) => c.case),
    extra: open.filter((c) => !wanted.has(key(c))).map((c) => c.case),
  };
  record.order = {
    product: open.map((c) => c.case),
    contract: sealed.map((c) => c.case),
  };
  record.order.equal = JSON.stringify(record.order.product) === JSON.stringify(record.order.contract);

  // The sealed decisions, one by one, as single decisions.
  const members = new Map(result.cases.map((c) => [c.id, c]));
  const decisions = [];
  for (const [type, id] of want.decisions) {
    const c = members.get(id);
    if (!c) {
      record.decisionError = `no case ${id}`;
      break;
    }
    decisions.push({
      id: `D${decisions.length + 1}`,
      type,
      context: result.context,
      at: '2026-12-01T09:00:00.000Z',
      case: c.id,
      statement: [...c.statement],
      cashbook: [...c.cashbook],
      note: 'synthetic foundation decision',
    });
  }
  const own = story.actions.filter((a) => !a.replace).length;
  record.actions = { product: decisions.length, withQueue: own };
  if (record.decisionError) continue;
  const replaced = story.actions.some((a) => a.replace);
  const name = replaced ? `${period}-cashbook-corrected.csv` : `${period}-cashbook.csv`;
  try {
    ({ result } = await replayBankStatement(
      state(period, name, statement, replaced ? await bytes(name) : cashbook, decisions),
    ));
    record.refusal = null;
  } catch (error) {
    record.refusal = message(error);
    continue;
  }
  const statuses = Object.fromEntries(
    result.cases.filter((c) => c.kind === 'review').map((c) => [c.id, STATUS[c.status] ?? c.status]),
  );
  // By case, whatever the order of the keys.
  const sortedKeys = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => byText(a, b)));
  record.statusesEqual = sortedKeys(statuses) === sortedKeys(want.statuses);
}

const ids = Object.keys(stories);
const count = (f) => ids.filter((id) => f(stories[id], expected[id])).length;
const total = (f) => ids.reduce((n, id) => n + (f(stories[id]) ?? 0), 0);
const summary = {
  stories: ids.length,
  replayed: count((r) => !r.error),
  heldAgrees: count((r, w) => !r.error && r.held === w.held),
  casesEqual: `${count((r) => r.cases?.equal)}/${count((r) => r.cases)}`,
  casesNeedingDecision: total((r) => r.cases?.product),
  // Over the stories with two or more cases to order.
  orderEqualsContract: `${count((r) => r.order?.equal && r.order.contract.length > 1)}/${count((r) => r.order && r.order.contract.length > 1)}`,
  storiesWithDecisions: count((r) => r.actions?.product),
  // Over the stories whose decisions were taken and kept.
  statusesEqual: `${count((r) => r.statusesEqual && r.actions?.product)}/${count((r) => r.statusesEqual !== undefined && r.actions?.product)}`,
  refusalAgrees: count((r, w) => r.refusal !== undefined && (r.refusal ?? null) === (w.refusal ?? null)),
  decisionActions: { product: total((r) => r.actions?.product), withQueue: total((r) => r.actions?.withQueue) },
};
const outcome = {
  schema: 'tarasuf-wf1-review1-baseline/1',
  inputManifestSha256: sha(await readFile(path.join(frozen, 'INPUT-MANIFEST.json'))),
  summary,
  stories,
};
console.log(JSON.stringify(summary));
const record = option('record');
if (record) {
  const commit = process.env.BANK_REVIEW_COMMIT ?? 'unknown';
  await writeFile(
    path.join(suite, 'results', record),
    `${JSON.stringify(
      {
        run: {
          name: 'baseline',
          productCommit: commit,
          date: new Date().toISOString().slice(0, 10),
          asItCame: true,
          command: 'node --experimental-strip-types scripts/bank-review-baseline.mjs',
          note: 'First product run on the REVIEW-1 foundation, after the seal. The product lists review cases by case number and decides them one by one.',
        },
        ...outcome,
      },
      null,
      1,
    )}\n`,
  );
}
if (option('assert')) {
  const { run, ...recorded } = await json(path.resolve(suite, 'results', option('assert')));
  assert.ok(run, 'the record names its run');
  assert.deepEqual(JSON.parse(JSON.stringify(outcome)), recorded, 'the outcome differs from the record');
}
