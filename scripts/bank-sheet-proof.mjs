// WF-1 REPORT-1 R1: the sheet engine (bank-statement-sheet.ts) on the sealed
// foundation (audit/bank-sheet-foundation), against EXPECTED.json field by
// field. For each story the period is replayed by the lifecycle, with the
// story's actions applied in order as the accountant would: the book balance
// declared, each decision on the case holding exactly its members, and each
// sign-off bound to the fingerprint of the sheet as it stood then. The sheet
// of the final state is compared with the oracle's: refusal, status, bank and
// book balances, every item in every section with every field, totals,
// adjusted balances, difference, and whether each sign-off still holds.
//   node --experimental-strip-types scripts/bank-sheet-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/bank-sheet-foundation/frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const { replayBankStatement, replayRolledStatement } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const { reconciliationSheet, sheetFingerprint } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-sheet.ts')
);

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const month = (period) => MONTHS[Number(period.start.slice(5, 7)) - 1];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The engine's sheet in the oracle's terms. */
function asOracle(outcome, previous) {
  if (outcome.refusal) return { previous, refusal: outcome.refusal };
  const s = outcome.sheet;
  return {
    previous,
    refusal: null,
    status: s.status,
    currency: s.currency,
    period: s.period,
    bank: s.bank,
    book: s.book,
    sections: Object.fromEntries(
      Object.entries(s.sections).map(([name, x]) => [
        name,
        {
          total: x.total,
          items: x.items.map((i) => ({
            item: `${month(i.period)}:${i.id}`,
            side: i.side,
            id: i.id,
            period: month(i.period),
            page: i.page,
            row: i.row,
            date: i.date,
            direction: i.direction,
            amount: i.amount,
            reference: i.reference,
            origin: i.origin,
            reason: i.reason,
            age: i.age,
            source: i.source,
          })),
        },
      ]),
    ),
    adjustedBank: s.adjustedBank,
    adjustedBook: s.adjustedBook,
    difference: s.difference,
  };
}

let equal = 0;
let compared = false;
const differing = [];
const counts = { sheets: 0, refusals: 0, items: 0, signoffs: 0 };
for (const story of facts.stories) {
  const want = expected[story.id];
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
  const previousFile = story.previous ? await bytes(sessionName) : null;
  let state = previousFile
    ? { ...own, version: 'bank-statement-roll-1', previous: { name: sessionName, sha256: sha(previousFile), original: previousFile } }
    : own;
  const replay = previousFile ? replayRolledStatement : replayBankStatement;
  let { result } = await replay(state);
  let book = null;
  const signed = {};
  for (const action of story.sheet) {
    if (action.book) book = action.book;
    else if (action.decide) {
      const d = action.decide;
      const now = month(result.match.statement.period);
      const names = new Map((result.roll?.carried ?? []).map((c) => [c.key, `${month(c.period)}:${c.id}`]));
      const members = (c) =>
        [...c.statement.map((s) => `${now}:${s}`), ...c.cashbook.map((v) => `${now}:${v}`), ...(c.carried ?? []).map((k) => names.get(k))].sort(byText);
      const wanted = [...d.statement.map((s) => `${now}:${s}`), ...d.cashbook.map((v) => `${now}:${v}`), ...d.carried].sort(byText);
      const found = result.cases.filter((c) => c.kind !== 'automatic' && JSON.stringify(members(c)) === JSON.stringify(wanted));
      assert.equal(found.length, 1, `${story.id}: one case holds ${wanted.join(' ')}`);
      state = {
        ...state,
        decisions: [
          ...state.decisions,
          {
            id: `D${state.decisions.length + 1}`,
            type: d.type,
            context: result.context,
            at: '2026-12-01T09:00:00.000Z',
            case: found[0].id,
            statement: [...found[0].statement],
            cashbook: [...found[0].cashbook],
            note: 'synthetic foundation decision',
          },
        ],
      };
      ({ result } = await replay(state));
    } else {
      const kind = action.prepare ? 'prepared' : 'reviewed';
      const outcome = reconciliationSheet(result, book);
      assert.equal(outcome.refusal, null, `${story.id}: ${kind} on a refused sheet`);
      signed[kind] = { ...(action.prepare ?? action.review), fingerprint: await sheetFingerprint(outcome.sheet) };
    }
  }
  const previous = result.roll ? (result.roll.previous.status === 'refused' ? result.roll.previous.code : 'accepted') : 'none';
  const outcome = reconciliationSheet(result, book);
  const got = asOracle(outcome, previous);
  if (!outcome.refusal) {
    const now = await sheetFingerprint(outcome.sheet);
    got.language = story.language;
    got.signoffs = Object.fromEntries(
      ['prepared', 'reviewed'].map((k) => [
        k,
        signed[k] ? { name: signed[k].name, date: signed[k].date, valid: signed[k].fingerprint === now } : null,
      ]),
    );
    counts.sheets += 1;
    counts.items += Object.values(outcome.sheet.sections).reduce((n, x) => n + x.items.length, 0);
    counts.signoffs += Object.keys(signed).length;
  } else counts.refusals += 1;
  if (isDeepEqual(got, want)) equal += 1;
  else differing.push(story.id);
  // The comparison itself: one changed field must be a difference.
  if (!outcome.refusal && counts.items && !compared) {
    const changed = structuredClone(got);
    const section = Object.values(changed.sections).find((x) => x.items.length);
    section.items[0].source = 'f'.repeat(64);
    assert.ok(!isDeepEqual(changed, want), 'a changed item must differ');
    compared = true;
  }
}
assert.ok(compared, 'the comparison was checked');

function isDeepEqual(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

const summary = { stories: facts.stories.length, equalToExpected: equal, ...counts, differing };
console.log(JSON.stringify(summary));
assert.deepEqual(differing, [], `stories differing from EXPECTED.json: ${differing.join(' ')}`);
