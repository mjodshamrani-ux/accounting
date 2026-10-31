// WF-1 ROLL-1 W4: the product on the sealed holdout audit/bank-roll-holdout-w4,
// recorded as it comes. For each story, from the current period's two files
// and the previous session file the story brings:
//   1. the period as the lifecycle replays it (replayRolledStatement, or
//      replayBankStatement without a previous session), against the sealed
//      EXPECTED.json field by field, as scripts/bank-roll-proof.mjs compares
//      the foundation: the previous verdict, every carried item with its
//      provenance, every carried case, what stays carried, the withheld
//      items and the period's own matching; and whether any carried or
//      withheld item is paired automatically;
//   2. where the previous period is accepted and the period equals the
//      oracle: every carried case decided as the contract lets an accountant
//      decide it (the two reasons it names accepted, every other rejected),
//      the decided period against what the contract's rule derives from
//      EXPECTED.json, the session saved and restored to the same result;
//   3. the workpaper of every story with a previous session, undecided and
//      decided, judged by audit/bank-roll-foundation/check_export.py against
//      the sealed package, never against the product.
// A refusal or an error is recorded, not thrown. With --record=<file> the
// outcome is written to the holdout's results/ as that run's record; with
// --assert=<file> it must equal that record.
//   node --experimental-strip-types scripts/bank-roll-holdout.mjs [--record=run-1.json | --assert=run-1.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// BANK_ROLL_HOLDOUT_SUITE: another sealed roll package, to try this runner
// on the foundation without reading the holdout.
const suite = path.resolve(root, process.env.BANK_ROLL_HOLDOUT_SUITE ?? 'audit/bank-roll-holdout-w4');
const frozen = path.join(suite, 'frozen');
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const {
  replayBankStatement,
  replayRolledStatement,
  saveRolledStatement,
  restoreRolledStatement,
  exportRolledStatement,
} = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const contract = await json(path.join(root, 'audit/bank-roll-foundation/contract.json'));
const acceptable = Object.entries({ ...contract.clearing.byReference, ...contract.clearing.byAmount })
  .filter(([, text]) => /may accept it/u.test(text))
  .map(([reason]) => reason);
assert.equal(acceptable.length, 2);
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const month = (period) => MONTHS[Number(period.start.slice(5, 7)) - 1];
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
      : v;
assert.deepEqual(canonical({ b: [{ y: 1, x: 2 }], a: 1 }), canonical({ a: 1, b: [{ x: 2, y: 1 }] }));
assert.notDeepEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }));
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The period as the oracle names it. */
function outcomeOf(result) {
  const carriedCases = result.cases.filter((c) => c.kind === 'carried');
  const roll = result.roll;
  const now = month(result.match.statement.period ?? { start: '0000-00' });
  const name = (c) => `${month(c.period)}:${c.id}`;
  const named = new Map((roll?.carried ?? []).map((c) => [c.key, name(c)]));
  return {
    previous: roll ? (roll.previous.status === 'refused' ? roll.previous.code : roll.previous.status) : 'none',
    carried: (roll?.carried ?? []).map((c) => ({
      item: name(c),
      period: month(c.period),
      side: c.side,
      id: c.id,
      ...(c.side === 'statement' ? { page: c.page } : { row: c.row }),
      date: c.date,
      direction: c.direction,
      amount: c.amount,
      reference: c.reference,
      origin: c.origin,
      age: c.age,
      source: c.source,
      session: c.session,
    })),
    cases: carriedCases.map((c) => ({
      reason: c.reason,
      carried: c.carried.map((k) => named.get(k)),
      current: [...c.statement, ...c.cashbook].map((id) => `${now}:${id}`),
    })),
    stillCarried: (roll?.outstanding ?? []).map((c) => ({ item: name(c), age: c.age })),
    withheld: [...(roll?.withheld.statement ?? []), ...(roll?.withheld.cashbook ?? [])].map((id) => `${now}:${id}`).sort(),
    ...(result.match.held
      ? { currentHeld: true }
      : {
          own: {
            auto: result.match.auto.length,
            review: result.match.review.map((g) => g.reason),
            statementOnly: result.match.statementOnly.length,
            cashbookOnly: result.match.cashbookOnly.length,
          },
        }),
  };
}

const out = process.env.BANK_ROLL_HOLDOUT_DIR ?? path.join(root, 'work/bank-roll-holdout');
await mkdir(out, { recursive: true });
const exports = [];
const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = { equal: false };
  stories[story.id] = record;
  const current = story.periods.at(-1);
  const statement = await bytes(`${current.id}-statement.pdf`);
  const cashbook = await bytes(`${current.id}-cashbook.csv`);
  const own = {
    version: 'bank-statement-lifecycle-1',
    files: [
      { name: `${current.id}-statement.pdf`, sha256: sha(statement), original: statement },
      { name: `${current.id}-cashbook.csv`, sha256: sha(cashbook), original: cashbook },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
  };
  const sessionName = `${story.id}-previous-session.json`;
  const previous = story.previous ? await bytes(sessionName) : null;
  const state = previous
    ? { ...own, version: 'bank-statement-roll-1', previous: { name: sessionName, sha256: sha(previous), original: previous } }
    : own;
  let result;
  try {
    ({ result } = await (previous ? replayRolledStatement(state) : replayBankStatement(state)));
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    continue;
  }
  const outcome = outcomeOf(result);
  record.equal = same(outcome, want);
  record.differences = Object.keys({ ...outcome, ...want }).filter((k) => !same(outcome[k], want[k]));
  if (!record.equal) record.outcome = outcome;
  // Nothing carried or withheld in an automatic pair; no carried case decided.
  const paired = new Set(result.match.auto.flatMap((a) => [`S:${a.statement}`, `C:${a.cashbook}`]));
  const carriedCases = result.cases.filter((c) => c.kind === 'carried');
  record.automaticWithCarried = carriedCases
    .flatMap((c) => [...c.statement.map((s) => `S:${s}`), ...c.cashbook.map((v) => `C:${v}`)])
    .filter((k) => paired.has(k)).length;
  record.automaticWithWithheld = [
    ...(result.roll?.withheld.statement ?? []).map((s) => `S:${s}`),
    ...(result.roll?.withheld.cashbook ?? []).map((v) => `C:${v}`),
  ].filter((k) => paired.has(k)).length;
  record.carriedCasesNotAwaiting = carriedCases.filter((c) => c.status !== 'needs-review').length;
  if (!previous) continue;
  const exported = async (input, r, decided) => {
    const file = path.join(out, `${story.id}-${decided ? 'decided' : 'undecided'}.xlsx`);
    try {
      await writeFile(file, new Uint8Array(await exportRolledStatement(input, r)));
      exports.push({ story: story.id, path: file, decided });
    } catch (error) {
      record[decided ? 'decidedExportError' : 'exportError'] = error instanceof Error ? error.message : String(error);
    }
  };
  await exported(state, result, false);
  if (!record.equal || want.previous !== 'accepted' || !carriedCases.length) continue;

  // The scenario: decide every carried case as the contract allows.
  const now = month(result.match.statement.period);
  const decisions = carriedCases.map((c, i) => ({
    id: `D${i + 1}`,
    type: acceptable.includes(c.reason) ? 'accept' : 'reject',
    context: result.context,
    at: '2027-02-01T00:00:00.000Z',
    case: c.id,
    statement: [...c.statement],
    cashbook: [...c.cashbook],
    note: 'synthetic holdout decision',
  }));
  const decided = { ...state, decisions };
  let after;
  try {
    ({ result: after } = await replayRolledStatement(decided));
  } catch (error) {
    record.decisionError = error instanceof Error ? error.message : String(error);
    continue;
  }
  const accepted = want.cases.filter((c) => acceptable.includes(c.reason));
  const rejected = want.cases.filter((c) => !acceptable.includes(c.reason));
  const withheld = new Set(want.withheld);
  const derived = {
    status: 'reviewed',
    ownLeft:
      want.own.statementOnly +
      want.own.cashbookOnly -
      accepted.reduce((n, c) => n + c.current.length, 0) +
      rejected.reduce((n, c) => n + c.current.filter((m) => withheld.has(m)).length, 0),
    rejectedMembersLeft: rejected.flatMap((c) => c.current).sort(),
    carriedLeft: [
      ...want.stillCarried,
      ...rejected.flatMap((c) => c.carried.map((item) => ({ item, age: want.carried.find((x) => x.item === item).age + 1 }))),
    ].sort((a, b) => a.item.localeCompare(b.item)),
  };
  const name = (c) => `${month(c.period)}:${c.id}`;
  const got = {
    status: after.status,
    ownLeft: after.outstanding.length,
    rejectedMembersLeft: after.outstanding.filter((o) => o.origin !== 'unmatched').map((o) => `${now}:${o.id}`).sort(),
    carriedLeft: after.roll.outstanding.map((c) => ({ item: name(c), age: c.age })).sort((a, b) => a.item.localeCompare(b.item)),
  };
  record.decided = { accepted: accepted.length, rejected: rejected.length, equal: same(got, derived) };
  if (!record.decided.equal) record.decided.got = got;
  try {
    const saved = await saveRolledStatement(decided);
    record.savedAndRestored = same(await restoreRolledStatement(saved), await replayRolledStatement(decided));
  } catch (error) {
    record.saveError = error instanceof Error ? error.message : String(error);
  }
  await exported(decided, after, true);
}

// The workpapers, held against the sealed package by the independent checker.
const check = spawnSync(
  process.env.PYTHON ?? 'python3',
  ['-B', path.join(root, 'audit/bank-roll-foundation/check_export.py')],
  { input: JSON.stringify({ frozen, exports }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
const workpapers = {
  exported: exports.length,
  accepted: check.status === 0 ? JSON.parse(check.stdout).checked : 0,
  ...(check.status === 0 ? {} : { failure: `${check.stdout}${check.stderr}`.trim().split('\n').at(-1) }),
};

const ids = Object.keys(stories);
const count = (f) => ids.filter((id) => f(stories[id], expected[id])).length;
const summary = {
  stories: ids.length,
  equalToExpected: count((r) => r.equal),
  refusedByProduct: count((r) => r.error),
  previousVerdictEqual: count((r) => !r.error && (r.equal || !r.differences.includes('previous'))),
  carriedCasesExpected: ids.reduce((n, id) => n + expected[id].cases.length, 0),
  storiesWithCarriedCasesEqual: count((r, w) => w.cases.length > 0 && !r.error && (r.equal || !r.differences.includes('cases'))),
  automaticWithCarried: ids.reduce((n, id) => n + (stories[id].automaticWithCarried ?? 0), 0),
  automaticWithWithheld: ids.reduce((n, id) => n + (stories[id].automaticWithWithheld ?? 0), 0),
  carriedCasesNotAwaiting: ids.reduce((n, id) => n + (stories[id].carriedCasesNotAwaiting ?? 0), 0),
  decidedStories: count((r) => r.decided),
  decidedEqualToContract: count((r) => r.decided?.equal),
  savedAndRestored: count((r) => r.savedAndRestored),
  workpapers,
};
const report = { holdout: path.relative(root, suite), summary, stories };
await writeFile(path.join(out, 'holdout.json'), `${JSON.stringify(report, null, 1)}\n`);
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
