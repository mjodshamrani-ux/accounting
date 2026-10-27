// WF-1 REPORT-1 R2: the closing sheet through the lifecycle, on the sealed
// foundation (audit/bank-sheet-foundation). For each story a state of the
// proposed bank-reconciliation-sheet-1 format is built as the accountant
// would build it, action by action: the book balance entered into the sheet
// inputs, each decision recorded on the case holding exactly its members,
// each sign-off stored with the fingerprint the replay gives at that moment.
// Then:
//   1. the replayed sheet against EXPECTED.json field by field, with the
//      standing of each sign-off;
//   2. saved and restored to the same result; the plain lifecycle and roll
//      restores refuse the sheet session rather than drop its inputs;
//   3. exported, and every workbook judged by
//      audit/bank-sheet-foundation/check_export.py against the sealed package,
//      with its self-test of planted alterations;
//   4. a sign-off with another fingerprint is void;
//   5. a sheet session read as the previous period of a period that carries
//      (P7): T23's December from a November sheet session gives the sealed
//      December sheet.
//   node --experimental-strip-types scripts/bank-sheet-lifecycle-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-sheet-foundation');
const frozen = path.join(suite, 'frozen');
const out = process.env.BANK_SHEET_LIFECYCLE_DIR ?? path.join(root, 'work/bank-sheet-lifecycle');
await mkdir(out, { recursive: true });
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const L = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const month = (period) => MONTHS[Number(period.start.slice(5, 7)) - 1];
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

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

/** The story's actions, in order, as the accountant takes them. */
async function build(story) {
  let state = await initial(story);
  for (const action of story.sheet) {
    if (action.book) state = { ...state, sheet: { ...state.sheet, book: action.book } };
    else if (action.decide) {
      const { result } = await L.replaySheetStatement(state);
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
            id: `D${state.decisions.length + 1}`, type: d.type, context: result.context, at: '2026-12-01T09:00:00.000Z',
            case: found[0].id, statement: [...found[0].statement], cashbook: [...found[0].cashbook], note: 'synthetic foundation decision',
          },
        ],
      };
    } else {
      const kind = action.prepare ? 'prepared' : 'reviewed';
      const { result } = await L.replaySheetStatement(state);
      assert.ok(result.sheet.fingerprint, `${story.id}: ${kind} on a refused sheet`);
      state = { ...state, sheet: { ...state.sheet, [kind]: { ...(action.prepare ?? action.review), fingerprint: result.sheet.fingerprint } } };
    }
  }
  return state;
}

const summary = { stories: 0, equalToExpected: 0, savedAndRestored: 0, plainRestoreRefused: 0, workbooks: 0, differing: [] };
const exports = [];
let comparisonChecked = false;
for (const story of facts.stories) {
  summary.stories += 1;
  const state = await build(story);
  const { result } = await L.replaySheetStatement(state);
  assert.equal(result.version, 'bank-reconciliation-sheet-1');
  const got = asOracle(result);
  if (same(got, expected[story.id])) summary.equalToExpected += 1;
  else summary.differing.push(story.id);
  if (!comparisonChecked && !got.refusal && got.signoffs.prepared) {
    assert.ok(!same({ ...got, signoffs: { ...got.signoffs, prepared: { ...got.signoffs.prepared, valid: !got.signoffs.prepared.valid } } }, expected[story.id]), 'a changed standing must differ');
    comparisonChecked = true;
  }
  const saved = await L.saveAnyStatement(state);
  const back = await L.restoreAnyStatement(saved);
  if (same(JSON.parse(JSON.stringify(back.result)), JSON.parse(JSON.stringify(result)))) summary.savedAndRestored += 1;
  let refused = 0;
  for (const restore of [L.restoreBankStatement, L.restoreRolledStatement])
    await restore(saved).then(() => {}, (e) => (refused += /BANK_STATEMENT_SESSION/u.test(e.message) ? 1 : 0));
  if (refused === 2) summary.plainRestoreRefused += 1;
  const file = path.join(out, `${story.id}-sheet.xlsx`);
  await writeFile(file, new Uint8Array(await L.exportAnyStatement(back.state, back.result)));
  exports.push({ story: story.id, path: file });
}
assert.ok(comparisonChecked, 'the comparison was checked');

// A sign-off given on another sheet is void.
{
  const story = facts.stories.find((s) => s.id === 'T02');
  const state = await build(story);
  const { result } = await L.replaySheetStatement({ ...state, sheet: { ...state.sheet, prepared: { ...state.sheet.prepared, fingerprint: '0'.repeat(64) } } });
  assert.equal(result.sheet.prepared.valid, false, 'a sign-off with another fingerprint is void');
  assert.equal(result.sheet.reviewed.valid, true);
  summary.foreignSignoffVoid = true;
}

// P7: a November sheet session as December's previous period.
{
  const story = facts.stories.find((s) => s.id === 'T23');
  const chain = await bytes('T23-previous-session.json');
  const parts = L.statementSessionParts(chain);
  assert.ok(parts.previous && !parts.sheet, 'the sealed November session carries October');
  const november = await L.saveAnyStatement({
    ...parts.state,
    version: 'bank-reconciliation-sheet-1',
    previous: parts.previous,
    sheet: { book: { balance: 0, note: 'any balance: the next period does not read it' }, language: 'en', prepared: null, reviewed: null },
  });
  const state = await build(story);
  const { result } = await L.replaySheetStatement({
    ...state,
    previous: { name: 'T23-NOV-sheet-session.json', sha256: sha(november), original: november },
  });
  const got = asOracle(result);
  assert.equal(got.previous, 'accepted', 'a sheet session is read as a previous period');
  for (const key of ['status', 'sections', 'difference'])
    assert.deepEqual(got[key], expected.T23[key], `T23 ${key} from a sheet session`);
  summary.sheetSessionAsPrevious = true;
}

const check = spawnSync(process.env.PYTHON ?? 'python3', ['-B', path.join(suite, 'check_export.py')], {
  input: JSON.stringify({ frozen, exports, selfTest: ['T02', 'T04', 'T12', 'T20'] }),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(check.status, 0, `check_export.py: ${check.stdout}${check.stderr}`);
const report = JSON.parse(check.stdout);
summary.workbooks = report.checked;
summary.selfTest = Object.keys(report.selfTest).length;
console.log(JSON.stringify(summary));
assert.deepEqual(summary.differing, [], `stories differing from EXPECTED.json: ${summary.differing.join(' ')}`);
assert.equal(summary.savedAndRestored, summary.stories);
assert.equal(summary.plainRestoreRefused, summary.stories);
assert.equal(summary.workbooks, summary.stories);
