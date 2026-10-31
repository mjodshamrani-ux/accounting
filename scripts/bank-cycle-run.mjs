// WF-1 cycle: the product on the sealed cycle foundation
// (audit/bank-cycle-foundation), two consecutive months per story on the
// library path, recorded as it comes. The seal is checked first
// (check_seal.py). Each story's steps are taken in order as the accountant
// takes them:
//   - open: the month's statement and ledger, the ledger read by columns
//     chosen by hand (chooseCashbookColumns, saved as a named map when the
//     story saves one), or by a saved map (its file text parsed back) when
//     it fits (cashbookMapProblems), or by hand again when it does not; in
//     the second month, the session the product saved for the first month
//     as the previous session file, its bytes as the product wrote them;
//   - policy: the declared tolerance into the state;
//   - group: the review queue's group holding exactly the story's cases,
//     decided by groupDecisions; accept or reject: the one case holding
//     exactly the story's members, carried items named by their period;
//   - book, language, prepare, review: the sheet inputs, each sign-off with
//     the fingerprint the replay gives at that moment;
//   - save: the product's session (saveAnyStatement), kept for the next
//     month, restored to the same result, and its workbook written.
// At each save the replayed result is put in the oracle's terms and held to
// the sealed EXPECTED.json key by key, and to the corrected expectation when
// the suite has one (correction-1/: the sealed oracle cited the ledger's
// entries at their rows in the declared CSV; check.py there holds that it
// differs in those rows alone). How the ledger was read (by hand or
// map, the map's name, the name saved) is what the run did; the misfit, the
// columns, the rows above the header, the columns left unread and the number
// of entries are the product's. The queue is the product's queue of the same
// month replayed without its decisions. The items a month leaves outstanding
// are the product's own carriedItems of the saved result, then the carried
// items its roll keeps. A sheet without a policy carries no tolerance
// section; it is compared as the oracle states it (no tolerated difference,
// the difference unexplained) and the run counts the sheets whose section is
// present exactly when a policy is declared. The workbooks are written, not
// judged: the cycle has no independent workbook checker of its own.
// A refusal or an error is recorded, not thrown: an action the product
// refuses, or an error, ends that story's record there. With --record=<file>
// the outcome is written to the suite's results/; with --assert=<file> it
// must equal that record.
//   node --experimental-strip-types scripts/bank-cycle-run.mjs [--record=run-1.json | --assert=run-1.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  asOracle,
  byText,
  canonical,
  month,
  plain,
  same,
} from './bank-cycle-terms.mjs';

const root = path.resolve(import.meta.dirname, '..');
// BANK_CYCLE_SUITE: another sealed cycle package of the same schema.
const suite = path.resolve(
  root,
  process.env.BANK_CYCLE_SUITE ?? 'audit/bank-cycle-foundation',
);
const frozen = path.join(suite, 'frozen');
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');

// A seal that does not hold is not a finding about the product: it stops the
// run with an error, never an assertion a mutation gate would count.
const seal = spawnSync('python3', ['-B', path.join(suite, 'check_seal.py')], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (seal.status !== 0)
  throw new Error(`the seal: ${seal.stdout}${seal.stderr}`);

const L = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const map = await import(
  path.join(root, 'lib/reconciliation/bank-cashbook-map.ts')
);
const io = await import(path.join(root, 'lib/reconciliation/io.ts'));
const { groupDecisions, reviewQueue } = await import(
  path.join(root, 'lib/reconciliation/bank-review-queue.ts')
);

const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const correction = path.join(suite, 'correction-1', 'EXPECTED.json');
const corrected = await json(correction).then(
  (c) => c.stories,
  () => null,
);
const bytes = async (name) =>
  Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const message = (error) =>
  error instanceof Error ? error.message : String(error);
const NOTE = 'synthetic cycle decision';
const AT = '2029-02-01T09:00:00.000Z';

/** The month's ledger read as the step says, or why the product would not. */
async function reading(step, ledgerName, ledger, maps) {
  const file = await io.readFile(ledgerName, ledger.slice(0));
  const out = {
    by: step.ledger.by,
    map: step.ledger.map ?? null,
    misfit: null,
  };
  let choice = step.ledger;
  let columns = null;
  if (choice.by === 'map') {
    const text = maps.get(choice.map);
    if (text === undefined) return `no map saved as ${choice.map}`;
    const saved = map.mapColumns(
      map.parseCashbookMap(new TextEncoder().encode(text)),
    );
    const problems = map.cashbookMapProblems(file, saved);
    if (problems.length) {
      out.misfit = plain(problems);
      choice = step.ledger.then;
      if (!choice) return 'a saved map that does not fit, and nothing by hand';
    } else columns = saved;
  }
  if (choice.by === 'hand') {
    const chosen = map.chooseCashbookColumns(file, {
      header: choice.header,
      columns: choice.columns,
    });
    if (chosen.problems)
      return `columns by hand: ${JSON.stringify(chosen.problems)}`;
    columns = chosen.columns;
    if (choice.save) {
      maps.set(
        choice.save,
        map.serializeCashbookMap(map.namedCashbookMap(choice.save, columns)),
      );
      out.saved = choice.save;
    }
  }
  return { out, columns };
}

/** One step of the story on the month's state; a string says why the
 * product would not take it. */
async function act(current, step) {
  const { state } = current;
  if (step.policy) return { ...state, tolerance: step.policy };
  if (step.book)
    return { ...state, sheet: { ...state.sheet, book: step.book } };
  if (step.language)
    return { ...state, sheet: { ...state.sheet, language: step.language } };
  const { result } = await L.replaySheetStatement(state);
  if (step.prepare || step.review) {
    const kind = step.prepare ? 'prepared' : 'reviewed';
    if (!result.sheet.fingerprint)
      return `${kind} on a sheet without a fingerprint`;
    const who = step.prepare ?? step.review;
    return {
      ...state,
      sheet: {
        ...state.sheet,
        [kind]: {
          name: who.name,
          date: who.date,
          fingerprint: result.sheet.fingerprint,
        },
      },
    };
  }
  if (!result.match.statement.period) return 'no statement period to decide in';
  const now = month(result.match.statement.period);
  const names = new Map(
    (result.roll?.carried ?? []).map((c) => [
      c.key,
      `${month(c.period)}:${c.id}`,
    ]),
  );
  const members = (c) =>
    [
      ...c.statement.map((s) => `${now}:${s}`),
      ...c.cashbook.map((v) => `${now}:${v}`),
      ...(c.carried ?? []).map((k) => names.get(k)),
    ].sort(byText);
  const keys = (m) =>
    [
      ...m.statement.map((s) => `${now}:${s}`),
      ...m.cashbook.map((v) => `${now}:${v}`),
      ...m.carried,
    ].sort(byText);
  if (step.group) {
    const wanted = step.group.cases
      .map((m) => JSON.stringify(keys(m)))
      .sort(byText);
    const byId = new Map(result.cases.map((c) => [c.id, c]));
    const found = reviewQueue(result).filter((g) =>
      same(
        g.cases
          .map((x) => JSON.stringify(members(byId.get(x.case))))
          .sort(byText),
        wanted,
      ),
    );
    if (found.length !== 1)
      return `${found.length} groups of the queue hold ${wanted.join(' ')}`;
    const decided = groupDecisions(
      result,
      found[0].signature,
      step.group.type,
      NOTE,
      (i) => `D${state.decisions.length + i + 1}`,
      AT,
    );
    if (!decided) return `the group does not offer ${step.group.type}`;
    return { ...state, decisions: [...state.decisions, ...decided] };
  }
  const type = step.accept ? 'accept' : 'reject';
  const wanted = JSON.stringify(keys(step[type]));
  const found = result.cases.filter(
    (c) => c.kind !== 'automatic' && JSON.stringify(members(c)) === wanted,
  );
  if (found.length !== 1) return `${found.length} cases hold ${wanted}`;
  return {
    ...state,
    decisions: [
      ...state.decisions,
      {
        id: `D${state.decisions.length + 1}`,
        type,
        context: result.context,
        at: AT,
        case: found[0].id,
        statement: [...found[0].statement],
        cashbook: [...found[0].cashbook],
        note: NOTE,
      },
    ],
  };
}

const out = process.env.BANK_CYCLE_DIR ?? path.join(root, 'work/bank-cycle');
await mkdir(out, { recursive: true });
const stories = {};
const sessionHashes = { carried: 0, equal: 0 };
const toleranceSections = { sheets: 0, presentExactlyWithPolicy: 0 };
let exported = 0;
for (const story of facts.stories) {
  const record = { saves: {} };
  stories[story.id] = record;
  const periods = new Map(story.periods.map((p) => [p.id, p]));
  const maps = new Map();
  const sessions = new Map();
  let now = null;
  for (const [i, step] of story.steps.entries()) {
    const kind = Object.keys(step)[0];
    try {
      if (step.open) {
        const pid = step.open;
        const statementName = `${pid}-statement.pdf`;
        const statement = await bytes(statementName);
        const ledgerName = story.ledgers[pid].file;
        const ledger = await bytes(ledgerName);
        const read = await reading(step, ledgerName, ledger, maps);
        if (typeof read === 'string') {
          record.actionRefused = { step: i, kind, why: read };
          break;
        }
        let previous = null;
        if (step.previous) {
          const session = sessions.get(step.previous);
          if (!session) {
            record.actionRefused = {
              step: i,
              kind,
              why: `no session saved as ${step.previous}`,
            };
            break;
          }
          previous = {
            name: `${step.previous}-session.json`,
            sha256: sha(session),
            original: session.slice(0),
          };
        }
        now = {
          pid,
          period: periods.get(pid),
          read,
          state: {
            version: 'bank-reconciliation-sheet-1',
            files: [
              {
                name: statementName,
                sha256: sha(statement),
                original: statement,
              },
              {
                name: ledgerName,
                sha256: sha(ledger),
                original: ledger,
                columns: read.columns,
              },
            ],
            scope: { currency: null, period: null, confirmedClosing: null },
            decisions: [],
            previous,
            // Every story declares the sheet's language before it saves.
            sheet: {
              book: null,
              language: 'en',
              prepared: null,
              reviewed: null,
            },
          },
        };
        continue;
      }
      if (!now) {
        record.actionRefused = {
          step: i,
          kind,
          why: 'a step before any month is open',
        };
        break;
      }
      if (step.save) {
        const { state } = now;
        const { result } = await L.replaySheetStatement(state);
        const before = (
          await L.replaySheetStatement({
            ...state,
            decisions: [],
            sheet: { ...state.sheet, prepared: null, reviewed: null },
          })
        ).result;
        const got = asOracle(now.pid, now.period, result, before, now.read);
        const against = (want) => ({
          equal: same(got, want),
          differences: Object.keys({ ...got, ...want }).filter(
            (k) => !same(got[k], want?.[k]),
          ),
        });
        const save = against(expected[story.id]?.[step.save]);
        if (corrected)
          save.corrected = against(corrected[story.id]?.[step.save]);
        if (!save.equal || (corrected && !save.corrected.equal))
          save.outcome = got;
        record.saves[step.save] = save;
        for (const c of result.roll?.carried ?? []) {
          sessionHashes.carried += 1;
          if (c.session === state.previous.sha256) sessionHashes.equal += 1;
        }
        if (!result.sheet.outcome.refusal) {
          toleranceSections.sheets += 1;
          if ('tolerance' in result.sheet.outcome.sheet === !!state.tolerance)
            toleranceSections.presentExactlyWithPolicy += 1;
        }
        const session = await L.saveAnyStatement(state);
        sessions.set(step.save, session);
        const back = await L.restoreAnyStatement(session.slice(0));
        save.savedAndRestored = same(plain(back.result), plain(result));
        const file = path.join(out, `${step.save}.xlsx`);
        await writeFile(
          file,
          new Uint8Array(await L.exportAnyStatement(state, result)),
        );
        exported += 1;
        continue;
      }
      const next = await act(now, step);
      if (typeof next === 'string') {
        record.actionRefused = { step: i, kind, why: next };
        break;
      }
      now.state = next;
    } catch (error) {
      record.error = { step: i, kind, message: message(error) };
      break;
    }
  }
}

const saves = Object.values(stories).flatMap((s) => Object.values(s.saves));
const summary = {
  stories: facts.stories.length,
  savesExpected: Object.values(expected).reduce(
    (n, s) => n + Object.keys(s).length,
    0,
  ),
  saves: saves.length,
  equalToExpected: saves.filter((s) => s.equal).length,
  ...(corrected
    ? { equalToCorrected: saves.filter((s) => s.corrected.equal).length }
    : {}),
  savedAndRestored: saves.filter((s) => s.savedAndRestored).length,
  errors: Object.values(stories).filter((s) => s.error).length,
  actionsRefused: Object.values(stories).filter((s) => s.actionRefused).length,
  sessionHashes,
  toleranceSections,
  workbooksWritten: exported,
};
const report = { suite: path.relative(root, suite), summary, stories };
await writeFile(
  path.join(out, 'cycle.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log(JSON.stringify(summary));
const record = option('record');
if (record) {
  await mkdir(path.join(suite, 'results'), { recursive: true });
  await writeFile(
    path.join(suite, 'results', record),
    `${JSON.stringify(report, null, 1)}\n`,
  );
}
const against = option('assert');
if (against) {
  const recorded = await json(path.join(suite, 'results', against));
  assert.deepEqual(
    canonical(report),
    canonical(recorded),
    `the product's outcome differs from ${against}`,
  );
}
