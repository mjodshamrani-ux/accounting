// WF-1 ROLL-1 W2: the lifecycle of a period that carries, on the sealed
// stories of audit/bank-roll-foundation whose previous period is carried.
// For each, from the current period's two files and the previous session file:
//   1. replay, and decide every carried case: accept the two reasons the
//      contract lets an accountant accept, reject the others;
//   2. check the outcome against what the contract's "afterwards" rule
//      derives from the sealed EXPECTED.json, not from the product: an
//      accepted case clears its carried item and its current members, a
//      rejected one leaves both outstanding, the carried item one period
//      older; the period is reviewed;
//   3. save the session, restore it, and require the same result, with the
//      previous session file kept byte for byte;
//   4. require that a decision taken in another context, or on another
//      previous file, is refused.
//   node --experimental-strip-types scripts/bank-roll-lifecycle-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/bank-roll-foundation/frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const {
  replayRolledStatement,
  saveRolledStatement,
  restoreRolledStatement,
  statementSessionParts,
} = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));
const { CARRIED_ACCEPTABLE } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-roll.ts')
);

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const contract = await json(path.join(root, 'audit/bank-roll-foundation/contract.json'));
// The two reasons the contract lets an accountant accept, read from it.
const acceptable = Object.entries({ ...contract.clearing.byReference, ...contract.clearing.byAmount })
  .filter(([, text]) => /may accept it/u.test(text))
  .map(([reason]) => reason)
  .sort();
assert.deepEqual(acceptable, [...CARRIED_ACCEPTABLE].sort((a, b) => a.localeCompare(b)), 'the product accepts what the contract names');
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = { '06': 'JUN', '07': 'JUL', '08': 'AUG', '09': 'SEP' };
const month = (period) => MONTHS[period.start.slice(5, 7)];
const decision = (c, type, context, id) => ({
  id,
  type,
  context,
  at: '2026-10-27T00:00:00.000Z',
  case: c.id,
  statement: [...c.statement],
  cashbook: [...c.cashbook],
  note: 'synthetic proof decision',
});

const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  if (want.previous !== 'accepted') continue;
  const current = story.periods.at(-1);
  const statement = await bytes(`${current.id}-statement.pdf`);
  const cashbook = await bytes(`${current.id}-cashbook.csv`);
  const previous = await bytes(`${story.id}-previous-session.json`);
  const state = {
    version: 'bank-statement-roll-1',
    files: [
      { name: `${current.id}-statement.pdf`, sha256: sha(statement), original: statement },
      { name: `${current.id}-cashbook.csv`, sha256: sha(cashbook), original: cashbook },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
    previous: { name: `${story.id}-previous-session.json`, sha256: sha(previous), original: previous },
  };
  const first = (await replayRolledStatement(state)).result;
  const now = month(first.match.statement.period);
  const carried = first.cases.filter((c) => c.kind === 'carried');
  assert.equal(carried.length, want.cases.length, story.id);
  const decisions = carried.map((c, i) =>
    decision(c, CARRIED_ACCEPTABLE.includes(c.reason) ? 'accept' : 'reject', first.context, `D${i + 1}`),
  );
  const decided = { ...state, decisions };
  const { result } = await replayRolledStatement(decided);

  // What the contract derives from EXPECTED.json.
  const name = (k) => {
    const c = want.carried.find((x) => `${x.side === 'statement' ? 'S' : 'C'}:${x.id}` === k.split('@')[0]);
    return c.item;
  };
  const accepted = want.cases.filter((c) => acceptable.includes(c.reason));
  const rejected = want.cases.filter((c) => !acceptable.includes(c.reason));
  const withheld = new Set(want.withheld);
  const ownLeft =
    want.own.statementOnly +
    want.own.cashbookOnly -
    accepted.reduce((n, c) => n + c.current.length, 0) +
    rejected.reduce((n, c) => n + c.current.filter((m) => withheld.has(m)).length, 0);
  const carriedLeft = [
    ...want.stillCarried,
    ...rejected.flatMap((c) =>
      c.carried.map((item) => ({ item, age: want.carried.find((x) => x.item === item).age + 1 })),
    ),
  ].sort((a, b) => a.item.localeCompare(b.item));
  const got = {
    status: result.status,
    ownLeft: result.outstanding.length,
    rejectedMembersLeft: result.outstanding
      .filter((o) => o.origin !== 'unmatched')
      .map((o) => `${now}:${o.id}`)
      .sort(),
    carriedLeft: result.roll.outstanding
      .map((c) => ({ item: name(c.key), age: c.age }))
      .sort((a, b) => a.item.localeCompare(b.item)),
  };
  assert.deepEqual(
    got,
    {
      status: 'reviewed',
      ownLeft,
      rejectedMembersLeft: rejected.flatMap((c) => c.current).sort(),
      carriedLeft,
    },
    `${story.id}: the decided period differs from the contract's rule on EXPECTED.json`,
  );

  // Saved and restored, the same; the previous file byte for byte.
  const saved = await saveRolledStatement(decided);
  const parts = statementSessionParts(saved);
  assert.equal(sha(parts.previous.original), sha(previous), story.id);
  assert.deepEqual(await restoreRolledStatement(saved), await replayRolledStatement(decided), story.id);

  // A decision is bound to its context, the previous file included (R6).
  if (decisions.length) {
    const respaced = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(previous)), null, 1),
    ).buffer;
    const other = {
      ...decided,
      previous: { name: 'respaced.json', sha256: sha(respaced), original: respaced },
    };
    await assert.rejects(replayRolledStatement(other), /BANK_STATEMENT_DECISION/u, story.id);
  }
  stories[story.id] = {
    accepted: accepted.length,
    rejected: rejected.length,
    outstanding: got.ownLeft,
    carriedLeft: got.carriedLeft.length,
    sessionBytes: saved.byteLength,
  };
}

const ids = Object.keys(stories);
const summary = {
  stories: ids.length,
  decided: ids.reduce((n, id) => n + stories[id].accepted + stories[id].rejected, 0),
  accepted: ids.reduce((n, id) => n + stories[id].accepted, 0),
  rejected: ids.reduce((n, id) => n + stories[id].rejected, 0),
  savedAndRestored: ids.length,
  largestSessionBytes: Math.max(...ids.map((id) => stories[id].sessionBytes)),
};
const out = process.env.BANK_ROLL_LIFECYCLE_DIR ?? path.join(root, 'work/bank-roll-lifecycle');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'lifecycle.json'), `${JSON.stringify({ summary, stories }, null, 1)}\n`);
console.log(JSON.stringify(summary));
