// WF-1 REPORT-1 R4: the product on the sealed holdout
// audit/bank-sheet-holdout-r4, recorded as it comes. For each story, from
// the current period's two files and the previous session file the story
// brings, the sheet state is built as the accountant builds it, action by
// action, as scripts/bank-sheet-lifecycle-proof.mjs builds the foundation's:
// the book balance into the sheet inputs, each decision on the case holding
// exactly its members, each sign-off with the fingerprint the replay gives at
// that moment. Then:
//   1. the replayed sheet against the sealed EXPECTED.json field by field:
//      the previous verdict, the refusal or the status, currency, period,
//      both balances, every item of every section with every field, the
//      adjusted balances, the difference, the language and each sign-off's
//      standing;
//   2. the session saved and restored to the same result, and refused by the
//      plain and roll restores;
//   3. every workbook judged by audit/bank-sheet-foundation/check_export.py
//      against the sealed package, never against the product.
// A refusal or an error is recorded, not thrown: an action the product
// refuses ends that story's record there. With --record=<file> the outcome is
// written to the holdout's results/ as that run's record; with
// --assert=<file> it must equal that record.
//   node --experimental-strip-types scripts/bank-sheet-holdout.mjs [--record=run-1.json | --assert=run-1.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// BANK_SHEET_HOLDOUT_SUITE: another sealed sheet package, to try this runner
// on the foundation without reading the holdout.
const suite = path.resolve(root, process.env.BANK_SHEET_HOLDOUT_SUITE ?? 'audit/bank-sheet-holdout-r4');
const frozen = path.join(suite, 'frozen');
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const L = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const month = (period) => MONTHS[Number(period.start.slice(5, 7)) - 1];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
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

/** The replayed sheet in the oracle's terms. */
function asOracle(result) {
  const previous = result.roll ? (result.roll.previous.status === 'refused' ? result.roll.previous.code : 'accepted') : 'none';
  const { outcome } = result.sheet;
  if (outcome.refusal) return { previous, refusal: outcome.refusal };
  const s = outcome.sheet;
  const standing = (x) => x && { name: x.name, date: x.date, valid: x.valid };
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
            item: `${month(i.period)}:${i.id}`, side: i.side, id: i.id, period: month(i.period), page: i.page, row: i.row,
            date: i.date, direction: i.direction, amount: i.amount, reference: i.reference, origin: i.origin,
            reason: i.reason, age: i.age, source: i.source,
          })),
        },
      ]),
    ),
    adjustedBank: s.adjustedBank,
    adjustedBook: s.adjustedBook,
    difference: s.difference,
    language: result.sheet.language,
    signoffs: { prepared: standing(result.sheet.prepared), reviewed: standing(result.sheet.reviewed) },
  };
}

async function initial(story) {
  const current = story.periods.at(-1);
  const statement = await bytes(`${current.id}-statement.pdf`);
  const cashbook = await bytes(`${current.id}-cashbook.csv`);
  const name = `${story.id}-previous-session.json`;
  const previous = story.previous ? await bytes(name) : null;
  return {
    version: 'bank-reconciliation-sheet-1',
    files: [
      { name: `${current.id}-statement.pdf`, sha256: sha(statement), original: statement },
      { name: `${current.id}-cashbook.csv`, sha256: sha(cashbook), original: cashbook },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
    previous: previous && { name, sha256: sha(previous), original: previous },
    sheet: { book: null, language: story.language, prepared: null, reviewed: null },
  };
}

/** One action of the story, as the accountant takes it; a string says why
 * the product would not take it. */
async function act(state, action) {
  if (action.book) return { ...state, sheet: { ...state.sheet, book: action.book } };
  const { result } = await L.replaySheetStatement(state);
  if (action.decide) {
    const d = action.decide;
    if (!result.match.statement.period) return 'no statement period to decide in';
    const now = month(result.match.statement.period);
    const names = new Map((result.roll?.carried ?? []).map((c) => [c.key, `${month(c.period)}:${c.id}`]));
    const members = (c) =>
      [...c.statement.map((s) => `${now}:${s}`), ...c.cashbook.map((v) => `${now}:${v}`), ...(c.carried ?? []).map((k) => names.get(k))].sort(byText);
    const wanted = [...d.statement.map((s) => `${now}:${s}`), ...d.cashbook.map((v) => `${now}:${v}`), ...d.carried].sort(byText);
    const found = result.cases.filter((c) => c.kind !== 'automatic' && JSON.stringify(members(c)) === JSON.stringify(wanted));
    if (found.length !== 1) return `${found.length} cases hold ${wanted.join(' ')}`;
    return {
      ...state,
      decisions: [
        ...state.decisions,
        {
          id: `D${state.decisions.length + 1}`, type: d.type, context: result.context, at: '2028-04-01T09:00:00.000Z',
          case: found[0].id, statement: [...found[0].statement], cashbook: [...found[0].cashbook], note: 'synthetic holdout decision',
        },
      ],
    };
  }
  const kind = action.prepare ? 'prepared' : 'reviewed';
  if (!result.sheet.fingerprint) return `${kind} on a sheet without a fingerprint`;
  return { ...state, sheet: { ...state.sheet, [kind]: { ...(action.prepare ?? action.review), fingerprint: result.sheet.fingerprint } } };
}

const out = process.env.BANK_SHEET_HOLDOUT_DIR ?? path.join(root, 'work/bank-sheet-holdout');
await mkdir(out, { recursive: true });
const exports = [];
const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = { equal: false };
  stories[story.id] = record;
  let state = await initial(story);
  let result;
  try {
    for (const [i, action] of story.sheet.entries()) {
      const next = await act(state, action);
      if (typeof next === 'string') {
        record.actionRefused = { action: i, kind: Object.keys(action)[0], why: next };
        break;
      }
      state = next;
    }
    if (record.actionRefused) continue;
    ({ result } = await L.replaySheetStatement(state));
  } catch (error) {
    record.error = message(error);
    continue;
  }
  const got = asOracle(result);
  record.equal = same(got, want);
  record.differences = Object.keys({ ...got, ...want }).filter((k) => !same(got[k], want[k]));
  if (!record.equal) record.outcome = got;
  try {
    const saved = await L.saveAnyStatement(state);
    const back = await L.restoreAnyStatement(saved);
    record.savedAndRestored = same(JSON.parse(JSON.stringify(back.result)), JSON.parse(JSON.stringify(result)));
    let refused = 0;
    for (const restore of [L.restoreBankStatement, L.restoreRolledStatement])
      await restore(saved).then(
        () => {},
        (e) => (refused += /BANK_STATEMENT_SESSION/u.test(message(e)) ? 1 : 0),
      );
    record.plainRestoresRefused = refused;
  } catch (error) {
    record.saveError = message(error);
  }
  const file = path.join(out, `${story.id}-sheet.xlsx`);
  try {
    await writeFile(file, new Uint8Array(await L.exportAnyStatement(state, result)));
    exports.push({ story: story.id, path: file });
  } catch (error) {
    record.exportError = message(error);
  }
}

// The workbooks, held against the sealed package by the independent checker,
// one by one, so that one rejected workbook does not hide the others.
const workbooks = { exported: exports.length, accepted: 0, rejected: {} };
for (const e of exports) {
  const check = spawnSync(process.env.PYTHON ?? 'python3', ['-B', path.join(root, 'audit/bank-sheet-foundation/check_export.py')], {
    input: JSON.stringify({ frozen, exports: [e] }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (check.status === 0 && JSON.parse(check.stdout).checked === 1) workbooks.accepted += 1;
  else workbooks.rejected[e.story] = `${check.stdout}${check.stderr}`.trim().split('\n').at(-1);
}

const ids = Object.keys(stories);
const count = (f) => ids.filter((id) => f(stories[id], expected[id])).length;
const summary = {
  stories: ids.length,
  equalToExpected: count((r) => r.equal),
  errors: count((r) => r.error),
  actionsRefused: count((r) => r.actionRefused),
  refusalsExpected: count((r, w) => w.refusal),
  refusalsEqual: count((r, w) => w.refusal && r.equal),
  sheetsExpected: count((r, w) => !w.refusal),
  sheetsEqual: count((r, w) => !w.refusal && r.equal),
  itemsExpected: ids.reduce((n, id) => n + (expected[id].refusal ? 0 : Object.values(expected[id].sections).reduce((m, s) => m + s.items.length, 0)), 0),
  signoffsExpected: ids.reduce(
    (n, id) => n + (expected[id].refusal ? 0 : ['prepared', 'reviewed'].filter((k) => expected[id].signoffs[k]).length),
    0,
  ),
  savedAndRestored: count((r) => r.savedAndRestored),
  plainRestoresRefused: count((r) => r.plainRestoresRefused === 2),
  workbooks,
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
