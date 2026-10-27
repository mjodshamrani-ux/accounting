// WF-1 ROLL-1 W1: the carrying engine (lib/reconciliation/bank-statement-roll.ts)
// on the sealed two- and three-period stories of audit/bank-roll-foundation,
// against the independent oracle's EXPECTED.json, field by field:
//   - the previous session accepted, or refused with the expected code;
//   - every carried item with its provenance (period, side, id, page or row,
//     date, direction, amount, reference, origin, age, source and session
//     fingerprints);
//   - every carried case with its reason, carried items and current members;
//   - the items still carried with their age, the withheld current items,
//     and the current period's own matching;
// and that no carried item and no withheld item is ever paired automatically.
// Items are named <MONTH>:<id> as the oracle names them. It fails on any
// difference.
//   node --experimental-strip-types scripts/bank-roll-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/bank-roll-foundation/frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const { rollBankStatement } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-roll.ts')
);

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = { '06': 'JUN', '07': 'JUL', '08': 'AUG', '09': 'SEP' };
const month = (period) => MONTHS[period.start.slice(5, 7)];
/** Plain data with every object's keys sorted: key order is not a difference. */
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
      : v;
// The comparison itself must see a difference in value and none in key order.
assert.deepEqual(canonical({ b: [{ y: 1, x: 2 }], a: 1 }), canonical({ a: 1, b: [{ x: 2, y: 1 }] }));
assert.notDeepEqual(canonical({ a: [1, 2] }), canonical({ a: [2, 1] }));
assert.notDeepEqual(canonical({ a: 1 }), canonical({ a: 1, b: null }));

const stories = {};
let automaticCarried = 0;
for (const story of facts.stories) {
  const current = story.periods.at(-1);
  const statement = await bytes(`${current.id}-statement.pdf`);
  const cashbook = await bytes(`${current.id}-cashbook.csv`);
  const roll = await rollBankStatement({
    previous: story.previous ? await bytes(`${story.id}-previous-session.json`) : null,
    current: {
      version: 'bank-statement-lifecycle-1',
      files: [
        { name: `${current.id}-statement.pdf`, sha256: sha(new Uint8Array(statement)), original: statement },
        { name: `${current.id}-cashbook.csv`, sha256: sha(new Uint8Array(cashbook)), original: cashbook },
      ],
      scope: { currency: null, period: null, confirmedClosing: null },
      decisions: [],
    },
  });
  const now = month(roll.match.statement.period);
  const name = (c) => `${month(c.period)}:${c.id}`;
  const item = (c) => ({
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
  });
  const named = new Map(roll.carried.map((c) => [c.key, name(c)]));
  const outcome = {
    previous: roll.previous.status === 'refused' ? roll.previous.code : roll.previous.status,
    carried: roll.carried.map(item),
    cases: roll.cases.map((c) => ({
      reason: c.reason,
      carried: c.carried.map((k) => named.get(k)),
      current: [...c.statement, ...c.cashbook].map((id) => `${now}:${id}`),
    })),
    stillCarried: roll.still.map((c) => ({ item: name(c), age: c.age })),
    withheld: [...roll.withheld.statement, ...roll.withheld.cashbook].map((id) => `${now}:${id}`).sort(),
    ...(roll.match.held
      ? { currentHeld: true }
      : {
          own: {
            auto: roll.match.auto.length,
            review: roll.match.review.map((g) => g.reason),
            statementOnly: roll.match.statementOnly.length,
            cashbookOnly: roll.match.cashbookOnly.length,
          },
        }),
  };
  // Nothing carried or withheld is ever in an automatic pair; the current
  // movements and entries a carried case names are in no pair or group.
  const paired = new Set(roll.match.auto.flatMap((a) => [`S:${a.statement}`, `C:${a.cashbook}`]));
  const grouped = new Set(roll.match.review.flatMap((g) => [...g.statement.map((s) => `S:${s}`), ...g.cashbook.map((c) => `C:${c}`)]));
  for (const c of roll.cases)
    for (const k of [...c.statement.map((s) => `S:${s}`), ...c.cashbook.map((v) => `C:${v}`)]) {
      if (paired.has(k)) automaticCarried++;
      assert.ok(!grouped.has(k), `${story.id}: ${k} is in a carried case and an own review group`);
    }
  stories[story.id] = outcome;
  assert.deepEqual(canonical(outcome), canonical(expected[story.id]), `${story.id} differs from EXPECTED.json`);
}

const ids = Object.keys(stories);
const summary = {
  stories: `${ids.length}/${facts.stories.length} equal to EXPECTED.json`,
  previousAccepted: ids.filter((id) => stories[id].previous === 'accepted').length,
  previousRefused: ids.filter((id) => stories[id].previous.startsWith('ROLL_')).length,
  carriedItems: ids.reduce((n, id) => n + stories[id].carried.length, 0),
  carriedCases: ids.reduce((n, id) => n + stories[id].cases.length, 0),
  stillCarried: ids.reduce((n, id) => n + stories[id].stillCarried.length, 0),
  automaticWithCarried: automaticCarried,
};
assert.equal(automaticCarried, 0);
const out = process.env.BANK_ROLL_PROOF_DIR ?? path.join(root, 'work/bank-roll-proof');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'proof.json'), `${JSON.stringify({ summary, stories }, null, 1)}\n`);
console.log(JSON.stringify(summary));
