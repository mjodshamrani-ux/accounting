// WF-1 TOL-1 T2: a declared tolerance through the session and the workbook,
// on the sealed foundation (audit/bank-tolerance-foundation). Each story's
// actions are applied in order as bank-tolerance-proof applies them. Then:
//   - a story the expectation refuses is refused by save and export too,
//     with the same rule;
//   - otherwise the period with its closing sheet (labels in Arabic for every
//     other story) and the period alone are each saved, the policy found in
//     the session file exactly when declared, restored and held equal to the
//     replay; in the sheet session, the policy changed by one minor unit
//     must refuse the session when a decision is bound to it, and removed
//     must too, or give the period without a policy when none is;
//   - both workbooks are written and handed to the independent checker
//     (audit/bank-tolerance-foundation/check_export.py) with its self-test.
// A failure is recorded and asserted at the end, not thrown.
// BANK_TOLERANCE_SUITE names another sealed package of the same schema (a
// holdout); the checker's self-test then alters every workbook written, so
// that no choice of workbooks made before the run decides what it covers.
//   node --experimental-strip-types scripts/bank-tolerance-lifecycle.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const foundation = path.join(root, 'audit/bank-tolerance-foundation');
const suite = process.env.BANK_TOLERANCE_SUITE
  ? path.join(root, process.env.BANK_TOLERANCE_SUITE)
  : foundation;
const frozen = path.join(suite, 'frozen');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const message = (error) =>
  error instanceof Error ? error.message : String(error);
const lifecycle = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const { replayBankStatement, replaySheetStatement, sameStatementData } = {
  ...lifecycle,
  ...(await import(
    path.join(root, 'lib/reconciliation/bank-statement-request.ts')
  )),
};
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
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) =>
  JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));
const refusal = (error) => {
  const m = /^BANK_STATEMENT_([A-Z_]+)(?:: ([A-Z_]+))?/u.exec(message(error));
  return m ? (m[2] ? `${m[1]}:${m[2]}` : m[1]) : `error: ${message(error)}`;
};
const doc = (b) => JSON.parse(new TextDecoder().decode(b));
const encoded = (d) => new TextEncoder().encode(JSON.stringify(d)).buffer;
const out = process.env.BANK_TOLERANCE_LIFECYCLE_DIR ?? path.join(root, 'work');
await mkdir(out, { recursive: true });
const dir = await mkdtemp(path.join(out, 'bank-tolerance-lifecycle-'));

function own(period, statement, cashbook, decisions, policy) {
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
const withSheet = (state, book, language) => ({
  ...state,
  version: 'bank-reconciliation-sheet-1',
  previous: null,
  sheet: { book, language, prepared: null, reviewed: null },
});

const failures = [];
const exports = [];
const counts = {
  sessions: 0,
  restored: 0,
  workbooks: 0,
  refusedAsExpected: 0,
  tampered: 0,
};
for (const [index, story] of facts.stories.entries()) {
  const want = expected[story.id];
  const fail = (what) => failures.push([story.id, what]);
  try {
    const period = story.periods[0].id;
    const statement = await bytes(`${period}-statement.pdf`);
    const cashbook = await bytes(`${period}-cashbook.csv`);
    let policy = null;
    const decisions = [];
    let refused = null;
    for (const action of story.actions) {
      if (action.policy) {
        policy = action.policy;
        continue;
      }
      const [type, a] = action.reject
        ? ['reject', action.reject]
        : ['undo', action.undo];
      let result;
      try {
        ({ result } = await replayBankStatement(
          own(period, statement, cashbook, [...decisions], policy),
        ));
      } catch (error) {
        refused = refusal(error);
        break;
      }
      const found = result.cases.filter(
        (c) => same(c.statement, a.statement) && same(c.cashbook, a.cashbook),
      );
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
    const language = index % 2 ? 'ar' : 'en';
    const plainState = own(period, statement, cashbook, decisions, policy);
    const sheetState = withSheet(plainState, story.book, language);
    if (want.refused) {
      for (const { what, run } of [
        { what: 'save', run: () => lifecycle.saveAnyStatement(sheetState) },
        {
          what: 'save the period',
          run: () => lifecycle.saveAnyStatement(plainState),
        },
        {
          what: 'export',
          run: () => lifecycle.exportAnyStatement(sheetState, {}),
        },
      ]) {
        try {
          await run();
          fail(`${what}: not refused`);
        } catch (error) {
          if (refusal(error) !== want.refused)
            fail(`${what}: ${refusal(error)} != ${want.refused}`);
        }
      }
      if (refused !== null && refused !== want.refused)
        fail(`replay: ${refused}`);
      counts.refusedAsExpected++;
      continue;
    }
    // Each format: saved, the policy in the file exactly when declared, and
    // restored to what the replay gives.
    for (const [format, state, save, restore] of [
      [
        'sheet',
        sheetState,
        lifecycle.saveSheetStatement,
        lifecycle.restoreSheetStatement,
      ],
      [
        'period',
        plainState,
        lifecycle.saveBankStatement,
        lifecycle.restoreBankStatement,
      ],
    ]) {
      const replay = await lifecycle.replayAnyStatement(state);
      const session = await save(state);
      counts.sessions++;
      const saved = doc(session);
      if (!sameStatementData(saved.tolerance ?? null, policy))
        fail(`${format}: the policy in the session`);
      if (!sameStatementData(await restore(session), replay))
        fail(`${format}: restored differs`);
      else counts.restored++;
      if (format === 'sheet' && policy) {
        // The saved policy changed, then removed.
        for (const { change, apply } of [
          {
            change: 'perPeriod + 1',
            apply: (d) => (d.tolerance.perPeriod += 1),
          },
          { change: 'removed', apply: (d) => delete d.tolerance },
        ]) {
          const d = structuredClone(saved);
          apply(d);
          let got;
          try {
            got = (await restore(encoded(d))).result;
          } catch (error) {
            got = refusal(error);
          }
          if (decisions.length) {
            if (got !== 'DECISION')
              fail(`${change}: ${typeof got === 'string' ? got : 'restored'}`);
          } else if (typeof got === 'string') fail(`${change}: ${got}`);
          else if (change === 'removed') {
            const { result } = await replaySheetStatement(
              withSheet(
                own(period, statement, cashbook, [], null),
                story.book,
                language,
              ),
            );
            if (!sameStatementData(got, result))
              fail('removed: not the period without a policy');
          }
          counts.tampered++;
        }
      }
      const workbook = await lifecycle.exportAnyStatement(state, replay.result);
      const file = path.join(dir, `${story.id}-${format}.xlsx`);
      await writeFile(file, new Uint8Array(workbook));
      counts.workbooks++;
      exports.push({
        label: `${story.id}-${format}`,
        story: story.id,
        path: file,
        language: format === 'sheet' ? language : null,
      });
    }
  } catch (error) {
    fail(`error: ${message(error)}`);
  }
}

// The independent checker, with its self-test on the workbooks that exercise
// every alteration: a dinar period with a rejection, a period that exceeded,
// an Arabic sheet with three tolerated differences, one with an unexplained
// rest, and one with no policy.
const checker = spawnSync(
  'python3',
  ['-B', path.join(foundation, 'check_export.py')],
  {
    input: JSON.stringify({
      frozen,
      exports,
      selfTest:
        suite === foundation
          ? [
              'T07-sheet',
              'T04-sheet',
              'T19-sheet',
              'T23-sheet',
              'T08-sheet',
              'T01-period',
            ]
          : exports.map((e) => e.label),
    }),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
);
let checked = null;
if (checker.status !== 0)
  failures.push([
    'checker',
    (checker.stderr || checker.stdout).trim().slice(-2000),
  ]);
else checked = JSON.parse(checker.stdout);
console.log(
  JSON.stringify({
    stories: facts.stories.length,
    ...counts,
    checked: checked?.checked ?? 0,
    selfTest: checked ? Object.keys(checked.selfTest).length : 0,
    dir: path.relative(root, dir),
    failures,
  }),
);
assert.deepEqual(
  failures,
  [],
  'the session or workbook differs from the sealed expectation',
);
