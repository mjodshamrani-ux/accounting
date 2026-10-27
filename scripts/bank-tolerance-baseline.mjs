// WF-1 TOL-1 foundation: the product as it is, on the sealed tolerance
// stories (audit/bank-tolerance-foundation), first run after the seal. For
// each story it records:
//   1. whether the lifecycle takes a state that carries the story's policy
//      (a `tolerance` member), or refuses it;
//   2. the period replayed from its two files, the story's decisions applied
//      to the cases holding exactly their members, under the product's own
//      context (it has no policy): every case with its number, members,
//      reason and status, against EXPECTED.json; and for each case the
//      expectation tolerates, the product's reason and status;
//   3. the sheet the product builds with the declared book balance: its
//      status and difference, against the sealed sheet's status,
//      difference, tolerated sum and unexplained rest.
// A refusal or an error is recorded, not thrown. With --record=<file> the
// outcome is written to the package's results/; with --assert=<file> it must
// equal that record.
//   node --experimental-strip-types scripts/bank-tolerance-baseline.mjs [--record=<file> | --assert=<file>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-tolerance-foundation');
const frozen = path.join(suite, 'frozen');
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const message = (error) =>
  error instanceof Error ? error.message : String(error);
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const { replayBankStatement } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);
const { reconciliationSheet, bookBalance } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-sheet.ts')
);

// The seal first.
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
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sameIds = (a, b) =>
  JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));

const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = {};
  stories[story.id] = record;
  const period = story.periods[0];
  const statement = await bytes(`${period.id}-statement.pdf`);
  const cashbook = await bytes(`${period.id}-cashbook.csv`);
  const state = {
    version: 'bank-statement-lifecycle-1',
    files: [
      {
        name: `${period.id}-statement.pdf`,
        sha256: sha(statement),
        original: statement,
      },
      {
        name: `${period.id}-cashbook.csv`,
        sha256: sha(cashbook),
        original: cashbook,
      },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
  };
  const policy = [...story.actions].reverse().find((a) => a.policy)?.policy;
  // 1. A state that carries the policy.
  if (policy) {
    try {
      await replayBankStatement({ ...state, tolerance: policy });
      record.policy = 'taken';
    } catch (error) {
      record.policy = `refused: ${message(error).split(':')[0]}`;
    }
  } else record.policy = 'none';
  // 2. The period, then the story's decisions on the cases holding exactly
  // their members.
  let result;
  try {
    ({ result } = await replayBankStatement(state));
  } catch (error) {
    record.error = message(error);
    continue;
  }
  const decisions = [];
  for (const [i, a] of story.actions.filter((x) => !x.policy).entries()) {
    const [type, d] = a.reject ? ['reject', a.reject] : ['undo', a.undo];
    const found = result.cases.filter(
      (c) =>
        sameIds(c.statement, d.statement) && sameIds(c.cashbook, d.cashbook),
    );
    if (found.length !== 1) {
      record.decisionError = `no single case holds ${[...d.statement, ...d.cashbook].join(' ')}`;
      break;
    }
    decisions.push({
      id: `D${i + 1}`,
      type,
      context: result.context,
      at: '2026-12-31T09:00:00.000Z',
      case: found[0].id,
      statement: [...found[0].statement],
      cashbook: [...found[0].cashbook],
      note: 'synthetic foundation decision',
    });
  }
  if (decisions.length && !record.decisionError)
    try {
      ({ result } = await replayBankStatement({ ...state, decisions }));
      record.decisions = decisions.length;
    } catch (error) {
      record.decisionError = message(error);
    }
  record.refused = want.refused ?? null;
  const cases = result.cases.map((c) => ({
    id: c.id,
    kind: c.kind,
    reason: c.reason,
    statement: [...c.statement],
    cashbook: [...c.cashbook],
    status: STATUS[c.status] ?? c.status,
  }));
  if (!want.refused) {
    const wanted = new Map(want.cases.map((c) => [c.id, c]));
    record.casesSameMembers =
      cases.every((c) => {
        const w = wanted.get(c.id);
        return (
          w &&
          sameIds(w.statement, c.statement) &&
          sameIds(w.cashbook, c.cashbook)
        );
      }) && cases.length === want.cases.length;
    record.casesAsExpected = cases.filter((c) => {
      const w = wanted.get(c.id);
      return (
        w && w.kind === c.kind && w.reason === c.reason && w.status === c.status
      );
    }).length;
    record.cases = cases.length;
    record.toleratedExpected = want.cases
      .filter((c) => c.status === 'matched-tolerated')
      .map((c) => {
        const got = cases.find((x) => x.id === c.id);
        return [c.id, got?.reason ?? null, got?.status ?? null];
      });
  }
  // 3. The sheet with the declared book balance.
  try {
    const outcome = reconciliationSheet(result, bookBalance(story.book));
    record.sheet = outcome.refusal
      ? { refusal: outcome.refusal }
      : { status: outcome.sheet.status, difference: outcome.sheet.difference };
  } catch (error) {
    record.sheet = { error: message(error) };
  }
  if (want.sheet)
    record.expectedSheet = {
      status: want.sheet.status,
      difference: want.sheet.difference,
      tolerated: want.sheet.tolerated,
      unexplained: want.sheet.unexplained,
    };
  record.equal =
    !want.refused &&
    record.casesSameMembers &&
    record.casesAsExpected === record.cases &&
    !record.decisionError &&
    record.sheet?.status === want.sheet?.status &&
    record.sheet?.difference === want.sheet?.difference;
}

const all = Object.values(stories);
const summary = {
  stories: facts.stories.length,
  equal: all.filter((r) => r.equal).length,
  policyTaken: all.filter((r) => r.policy === 'taken').length,
  policyRefused: all.filter((r) => r.policy?.startsWith('refused')).length,
  refusalsExpected: all.filter((r) => r.refused).length,
  toleratedExpected: all.reduce(
    (t, r) => t + (r.toleratedExpected?.length ?? 0),
    0,
  ),
  toleratedByProduct: all.reduce(
    (t, r) =>
      t +
      (r.toleratedExpected ?? []).filter((x) => x[2] === 'matched-tolerated')
        .length,
    0,
  ),
  sameMembers: all.filter((r) => r.casesSameMembers).length,
  errors: all.filter((r) => r.error || r.decisionError).length,
};
const report = { holdout: path.relative(root, suite), summary, stories };
const record = option('record');
if (record) {
  await mkdir(path.join(suite, 'results'), { recursive: true });
  await writeFile(
    path.join(suite, 'results', record),
    `${JSON.stringify(report, null, 1)}\n`,
  );
}
const against = option('assert');
if (against)
  assert.deepEqual(
    canonical(report),
    canonical(await json(path.join(suite, 'results', against))),
    `the run differs from results/${against}`,
  );
console.log(JSON.stringify(summary));
