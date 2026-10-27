// WF-1 REPORT-1 foundation: the product as it is, on the sealed sheet
// stories (audit/bank-sheet-foundation), first run after the seal. For each
// story it records:
//   1. the current period replayed by the lifecycle (with the previous
//      session file when the story brings one), with the story's decisions
//      applied to the cases holding exactly their members: status, whether
//      the statement is held, the previous verdict;
//   2. the items a sheet would list, as the product's result names them: its
//      outstanding items (unmatched, or left by a rejected case), the members
//      of cases awaiting a decision, and the carried items still outstanding
//      with their age; against the sealed sheet's items, by key, section,
//      origin, reason, age and amount;
//   3. the sheet itself: whether the lifecycle takes a book balance, whether
//      its workbook holds a reconciliation sheet, and what its summary claims.
// A refusal or an error is recorded, not thrown. With --record=<file> the
// outcome is written to the package's results/; with --assert=<file> it must
// equal that record.
//   node --experimental-strip-types scripts/bank-sheet-baseline.mjs [--record=<file> | --assert=<file>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-sheet-foundation');
const frozen = path.join(suite, 'frozen');
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const { default: ExcelJS } = await import('exceljs');
const {
  replayBankStatement,
  replayRolledStatement,
  exportBankStatement,
  exportRolledStatement,
} = await import(path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts'));

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const month = (period) => MONTHS[Number(period.start.slice(5, 7)) - 1];
const message = (error) => (error instanceof Error ? error.message : String(error));
const SECTION = {
  'cashbook:in': 'bookReceiptsNotOnStatement',
  'cashbook:out': 'bookPaymentsNotOnStatement',
  'statement:in': 'statementDepositsNotInBook',
  'statement:out': 'statementWithdrawalsNotInBook',
};
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (list) => [...list].sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));

/** The items a sheet would list, as the product's result names them. */
function listed(result) {
  const now = month(result.match.statement.period);
  const movements = new Map(result.match.movements.map((m) => [m.id, m]));
  const entries = new Map(result.match.cashbook.map((c) => [c.id, c]));
  const byId = new Map(result.cases.map((c) => [c.id, c]));
  const carried = new Map((result.roll?.carried ?? []).map((c) => [c.key, c]));
  const named = (c) => `${month(c.period)}:${c.id}`;
  const out = [];
  const current = (side, id, origin, reason) => {
    const x = side === 'statement' ? movements.get(id) : entries.get(id);
    out.push({ item: `${now}:${id}`, section: SECTION[`${side}:${x.direction}`], origin, reason, age: null, amount: x.amount });
  };
  for (const o of result.outstanding)
    current(o.side, o.id, o.origin === 'unmatched' ? 'unmatched' : 'rejected', o.origin === 'unmatched' ? null : byId.get(o.origin).reason);
  for (const c of result.cases.filter((k) => k.status === 'needs-review')) {
    for (const id of c.statement) current('statement', id, 'pending', c.reason);
    for (const id of c.cashbook) current('cashbook', id, 'pending', c.reason);
    for (const key of c.carried ?? []) {
      const x = carried.get(key);
      out.push({ item: named(x), section: SECTION[`${x.side}:${x.direction}`], origin: 'pending', reason: c.reason, age: x.age + 1, amount: x.amount });
    }
  }
  for (const x of result.roll?.outstanding ?? []) {
    const rejected = result.cases.find((c) => c.status === 'rejected' && (c.carried ?? []).includes(x.key));
    out.push({
      item: named(x),
      section: SECTION[`${x.side}:${x.direction}`],
      origin: rejected ? 'rejected' : 'carried',
      reason: rejected ? rejected.reason : null,
      age: x.age,
      amount: x.amount,
    });
  }
  return sorted(out);
}

/** The sealed sheet's items in the same terms. */
function sheetItems(want) {
  return sorted(
    Object.entries(want.sections).flatMap(([section, s]) =>
      s.items.map((i) => ({ item: i.item, section, origin: i.origin, reason: i.reason, age: i.age, amount: i.amount })),
    ),
  );
}

async function workbook(buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const names = book.worksheets.map((s) => s.name);
  const summary = book.getWorksheet('Summary');
  let claim = '';
  summary?.eachRow((row) => {
    const value = row.getCell(2).value;
    if (row.getCell(1).value === 'Claim') claim = typeof value === 'string' ? value : JSON.stringify(value);
  });
  return { sheets: names, claim };
}

const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = {};
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
  const replay = previous ? replayRolledStatement : replayBankStatement;
  let result;
  try {
    ({ result } = await replay(state));
  } catch (error) {
    record.error = message(error);
    continue;
  }
  record.previous = result.roll ? (result.roll.previous.status === 'refused' ? result.roll.previous.code : 'accepted') : 'none';
  record.held = result.status === 'held';

  // The story's decisions, each on the case holding exactly its members.
  const decide = story.sheet.filter((a) => a.decide).map((a) => a.decide);
  const now = result.match.statement.period ? month(result.match.statement.period) : null;
  const names = new Map((result.roll?.carried ?? []).map((c) => [c.key, `${month(c.period)}:${c.id}`]));
  const members = (c) =>
    [...c.statement.map((s) => `${now}:${s}`), ...c.cashbook.map((v) => `${now}:${v}`), ...(c.carried ?? []).map((k) => names.get(k))].sort(byText);
  const decisions = [];
  for (const [i, d] of decide.entries()) {
    const wanted = [...d.statement.map((s) => `${now}:${s}`), ...d.cashbook.map((v) => `${now}:${v}`), ...d.carried].sort(byText);
    const found = result.cases.filter((c) => c.kind !== 'automatic' && JSON.stringify(members(c)) === JSON.stringify(wanted));
    if (found.length !== 1) {
      record.decisionError = `no single case holds ${wanted.join(' ')}`;
      break;
    }
    decisions.push({
      id: `D${i + 1}`,
      type: d.type,
      context: result.context,
      at: '2026-12-01T09:00:00.000Z',
      case: found[0].id,
      statement: [...found[0].statement],
      cashbook: [...found[0].cashbook],
      note: 'synthetic foundation decision',
    });
  }
  const decided = { ...state, decisions };
  if (decisions.length && !record.decisionError) {
    try {
      ({ result } = await replay(decided));
      record.decisions = decisions.length;
    } catch (error) {
      record.decisionError = message(error);
    }
  }
  record.status = result.status;
  if (!want.refusal && !record.held) {
    const got = listed(result);
    const wantItems = sheetItems(want);
    const key = (i) => JSON.stringify(i);
    const g = new Set(got.map(key));
    const w = new Set(wantItems.map(key));
    record.items = {
      expected: wantItems.length,
      listed: got.length,
      equal: g.size === w.size && [...g].every((k) => w.has(k)) && got.length === wantItems.length,
      missing: wantItems.filter((i) => !g.has(key(i))),
      extra: got.filter((i) => !w.has(key(i))),
    };
  }
  try {
    const exported = await (previous ? exportRolledStatement : exportBankStatement)(decided, result);
    const book = await workbook(exported);
    record.workbook = {
      reconciliationSheet: book.sheets.some((n) => /reconcil|تسوية/iu.test(n)),
      claimsNoBalanceBridge: /no balance bridge/u.test(book.claim),
    };
  } catch (error) {
    record.exportError = message(error);
  }
}

// Whether the lifecycle takes a book balance at all: the first story's state
// with one added.
let bookInput;
{
  const story = facts.stories[0];
  const current = story.periods.at(-1);
  const statement = await bytes(`${current.id}-statement.pdf`);
  const cashbook = await bytes(`${current.id}-cashbook.csv`);
  const book = story.sheet.find((a) => a.book).book;
  try {
    const { result } = await replayBankStatement({
      version: 'bank-statement-lifecycle-1',
      files: [
        { name: `${current.id}-statement.pdf`, sha256: sha(statement), original: statement },
        { name: `${current.id}-cashbook.csv`, sha256: sha(cashbook), original: cashbook },
      ],
      scope: { currency: null, period: null, confirmedClosing: null },
      decisions: [],
      sheet: { book },
    });
    bookInput = { refused: false, kept: JSON.stringify(result).includes(String(book.balance)) };
  } catch (error) {
    bookInput = { refused: true, error: message(error) };
  }
}

const ids = Object.keys(stories);
const sheetsExpected = ids.filter((id) => !expected[id].refusal);
const count = (f) => ids.filter((id) => f(stories[id], expected[id])).length;
const summary = {
  stories: ids.length,
  sheetsExpected: sheetsExpected.length,
  refusalsExpected: ids.length - sheetsExpected.length,
  sheetsMade: 0,
  replayed: count((r) => !r.error),
  decisionsApplied: count((r) => r.decisions && !r.decisionError),
  heldAgrees: count((r, w) => !r.error && r.held === (w.refusal === 'SHEET_STATEMENT_HELD')),
  previousVerdictAgrees: count((r, w) => !r.error && r.previous === w.previous),
  itemsEqual: `${count((r) => r.items?.equal)}/${count((r) => r.items)}`,
  workbookReconciliationSheets: count((r) => r.workbook?.reconciliationSheet),
  workbooksClaimingNoBalanceBridge: `${count((r) => r.workbook?.claimsNoBalanceBridge)}/${count((r) => r.workbook)}`,
  bookBalanceInput: bookInput,
};
const outcome = {
  schema: 'tarasuf-wf1-report1-baseline/1',
  inputManifestSha256: sha(await readFile(path.join(frozen, 'INPUT-MANIFEST.json'))),
  summary,
  stories,
};
console.log(JSON.stringify(summary));
const record = option('record');
if (record) {
  const commit = process.env.BANK_SHEET_COMMIT ?? 'unknown';
  await writeFile(
    path.join(suite, 'results', record),
    `${JSON.stringify(
      {
        run: {
          name: 'baseline',
          productCommit: commit,
          date: new Date().toISOString().slice(0, 10),
          asItCame: true,
          command: 'node --experimental-strip-types scripts/bank-sheet-baseline.mjs',
          note: 'First product run on the REPORT-1 foundation, after the seal. The product has no reconciliation sheet on the bank statement path.',
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
