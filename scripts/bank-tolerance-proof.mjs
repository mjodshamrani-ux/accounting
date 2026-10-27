// WF-1 TOL-1 T1: a declared tolerance in the library (bank-statement-tolerance.ts
// through the lifecycle and the sheet) on the sealed foundation
// (audit/bank-tolerance-foundation), against EXPECTED.json field by field.
// Each story's actions are applied in order as the accountant would: a policy
// declared, or a decision on the case holding exactly its members, taken in
// the context of the result in force at that moment. The period is then
// replayed with its closing sheet and the declared book balance, and compared
// with the oracle: the refusal; every case with its number, kind, reason,
// members, status and, when tolerated, its amounts; the sum that exceeded
// perPeriod; the outstanding items with their origin; and the sheet with its
// sections, adjusted balances, difference, tolerated differences, tolerated sum,
// unexplained rest and status. Without a policy the product's sheet carries no
// tolerance fields (the contract keeps its form), so nothing tolerated and an
// unexplained rest equal to the difference are what it is compared with.
// The measure the contract names is reported: cases awaiting a decision on
// the same stories with and without the policy.
//   node --experimental-strip-types scripts/bank-tolerance-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/bank-tolerance-foundation/frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const message = (error) =>
  error instanceof Error ? error.message : String(error);
const { replayBankStatement, replaySheetStatement } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const { statementDecision } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-view.ts')
);

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) =>
  Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const NOTE = 'synthetic foundation decision';
const AT = '2026-12-31T09:00:00.000Z';
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const SIDE = { statement: 'S', cashbook: 'C' };
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) =>
  JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));

/** A refusal in the oracle's terms. */
const refusal = (error) => {
  const m = /^BANK_STATEMENT_([A-Z_]+)(?:: ([A-Z_]+))?/u.exec(message(error));
  if (!m) throw error;
  return m[2] ? `${m[1]}:${m[2]}` : m[1];
};

function state(period, statement, cashbook, decisions, policy) {
  return {
    version: 'bank-statement-lifecycle-1',
    files: [
      {
        name: `${period}-statement.pdf`,
        sha256: sha(statement),
        original: statement,
      },
      {
        name: `${period}-cashbook.csv`,
        sha256: sha(cashbook),
        original: cashbook,
      },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions,
    ...(policy ? { tolerance: policy } : {}),
  };
}

/** The story judged by the product, in the oracle's terms. */
async function judge(story) {
  const period = story.periods[0].id;
  const statement = await bytes(`${period}-statement.pdf`);
  const cashbook = await bytes(`${period}-cashbook.csv`);
  const out = {
    refused: null,
    policy: null,
    cases: [],
    exceeded: null,
    outstanding: [],
    sheet: null,
  };
  let policy = null;
  const decisions = [];
  let result;
  // The actions in order: a decision is taken in the context of the result
  // in force when it is taken.
  for (const action of story.actions) {
    if (action.policy) {
      policy = action.policy;
      continue;
    }
    const [type, a] = action.reject
      ? ['reject', action.reject]
      : ['undo', action.undo];
    try {
      ({ result } = await replayBankStatement(
        state(period, statement, cashbook, [...decisions], policy),
      ));
    } catch (error) {
      return { ...out, policy, refused: refusal(error) };
    }
    const found = result.cases.filter(
      (c) => same(c.statement, a.statement) && same(c.cashbook, a.cashbook),
    );
    if (found.length !== 1) return { ...out, policy, refused: 'MEMBERS' };
    decisions.push(
      statementDecision(
        result,
        found[0],
        type,
        NOTE,
        `D${decisions.length + 1}`,
        AT,
      ),
    );
  }
  out.policy = policy;
  let sheet;
  try {
    ({ result } = await replaySheetStatement({
      ...state(period, statement, cashbook, decisions, policy),
      version: 'bank-reconciliation-sheet-1',
      previous: null,
      sheet: {
        book: story.book,
        language: 'en',
        prepared: null,
        reviewed: null,
      },
    }));
    sheet = result.sheet.outcome;
  } catch (error) {
    return { ...out, refused: refusal(error) };
  }
  const tolerance = result.tolerance ?? null;
  // The tolerance is in the result, and in the sheet, exactly when declared.
  assert.equal(!!tolerance, !!policy, `${story.id}: tolerance in the result`);
  if (tolerance)
    assert.deepEqual(tolerance.policy, policy, `${story.id}: the policy`);
  out.cases = result.cases.map((c) => ({
    id: c.id,
    kind: c.kind,
    reason: c.reason,
    statement: [...c.statement],
    cashbook: [...c.cashbook],
    status: STATUS[c.status] ?? c.status,
    ...(c.amounts ? { amounts: { ...c.amounts } } : {}),
  }));
  out.exceeded = tolerance?.exceeded
    ? { sum: tolerance.sum, cap: tolerance.policy.perPeriod }
    : null;
  out.outstanding = result.outstanding.map((o) => [
    SIDE[o.side],
    o.id,
    o.origin,
  ]);
  out.held = result.status === 'held';
  if (sheet.refusal) out.sheet = { refusal: sheet.refusal };
  else {
    const s = sheet.sheet;
    assert.equal(
      'toleratedDifferences' in s,
      !!policy,
      `${story.id}: tolerance fields in the sheet`,
    );
    out.sheet = {
      bank: s.bank.balance,
      book: s.book.balance,
      sections: Object.fromEntries(
        Object.entries(s.sections).map(([k, v]) => [
          k,
          v.items.map((i) => [i.id, i.amount]),
        ]),
      ),
      adjustedBank: s.adjustedBank,
      adjustedBook: s.adjustedBook,
      difference: s.difference,
      toleratedDifferences: (s.toleratedDifferences ?? []).map((d) => [
        d.case,
        d.effect,
      ]),
      tolerated: s.tolerated ?? 0,
      unexplained: s.unexplained ?? s.difference,
      status: s.status,
    };
  }
  return out;
}

/** The oracle's story in the same terms: its amounts without the direction
 * the oracle keeps for itself. */
function wanted(want) {
  return {
    ...want,
    cases: want.cases.map(({ amounts, ...c }) =>
      amounts
        ? {
            ...c,
            amounts: {
              statement: amounts.statement,
              cashbook: amounts.cashbook,
              difference: amounts.difference,
            },
          }
        : c,
    ),
  };
}

/** Cases awaiting a decision after the story's last action, with the policy
 * and with none. */
async function awaiting(story) {
  const period = story.periods[0].id;
  const statement = await bytes(`${period}-statement.pdf`);
  const cashbook = await bytes(`${period}-cashbook.csv`);
  const policy =
    [...story.actions].reverse().find((a) => a.policy)?.policy ?? null;
  const open = async (p) => {
    try {
      const { result } = await replayBankStatement(
        state(period, statement, cashbook, [], p),
      );
      return result.cases.filter((c) => c.status === 'needs-review').length;
    } catch {
      return null;
    }
  };
  return [await open(policy), await open(null)];
}

const failures = [];
let tolerated = 0;
let exceeded = 0;
let refused = 0;
let withPolicy = 0;
let without = 0;
for (const story of facts.stories) {
  const want = wanted(expected[story.id]);
  let got;
  try {
    got = await judge(story);
  } catch (error) {
    failures.push([story.id, 'error', message(error)]);
    continue;
  }
  for (const field of [
    'refused',
    'policy',
    'cases',
    'exceeded',
    'outstanding',
    'held',
    'sheet',
  ]) {
    if (!(field in want) && !(field in got)) continue;
    try {
      assert.deepStrictEqual(got[field], want[field]);
    } catch {
      failures.push([story.id, field]);
    }
  }
  tolerated += got.cases.filter((c) => c.status === 'matched-tolerated').length;
  exceeded += got.exceeded ? 1 : 0;
  refused += got.refused ? 1 : 0;
  const [a, b] = await awaiting(story);
  if (a !== null && !got.refused) {
    withPolicy += a;
    without += b;
  }
}
console.log(
  JSON.stringify({
    stories: facts.stories.length,
    equal: facts.stories.length - new Set(failures.map(([id]) => id)).size,
    tolerated,
    exceeded,
    refused,
    awaiting: { withPolicy, without },
    failures,
  }),
);
assert.deepEqual(
  failures,
  [],
  'the product differs from the sealed expectation',
);
