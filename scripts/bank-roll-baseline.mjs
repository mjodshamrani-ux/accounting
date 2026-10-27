// WF-1 ROLL-1 foundation: the product as it is, on the sealed two- and
// three-period stories (audit/bank-roll-foundation), first run after the seal.
// For each story it records:
//   1. the previous-period session the story brings, restored by the product
//      (restoreBankStatement): whether it restores, its status, and the
//      outstanding items it lists, named <MONTH>:<id>; and, where the oracle
//      accepts that session, whether those items equal the items the oracle
//      derives for carrying;
//   2. the current period replayed from its two files, as today: status,
//      automatic pairs, review reasons, statement-only and cashbook-only;
//   3. carrying: the product has no input for a previous session on this
//      path, so every carried case the oracle expects is missing.
// With --assert=<results file> it fails unless the outcome equals the record.
//   node --experimental-strip-types scripts/bank-roll-baseline.mjs [--assert=<file>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-roll-foundation');
const frozen = path.join(suite, 'frozen');
const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const { restoreBankStatement, replayBankStatement } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);

// The seal first.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(sha(await readFile(path.join(frozen, name))), entry.sha256, name);
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const bytes = async (name) => Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
const MONTHS = { '06': 'JUN', '07': 'JUL', '08': 'AUG', '09': 'SEP' };
const named = (result) => {
  const month = MONTHS[result.match.statement.period.start.slice(5, 7)];
  return result.outstanding.map((o) => `${month}:${o.id}`);
};
const code = (error) => /BANK_STATEMENT_[A-Z_]+/u.exec(String(error?.message ?? error))?.[0] ?? String(error);

const stories = {};
for (const story of facts.stories) {
  const want = expected[story.id];
  const record = {};
  const sessionName = `${story.id}-previous-session.json`;
  if (story.previous) {
    try {
      const { result } = await restoreBankStatement(await bytes(sessionName));
      record.previous = { restored: true, status: result.status, outstanding: named(result) };
      if (want.previous === 'accepted')
        record.previous.equalsOracleCarried =
          JSON.stringify(record.previous.outstanding) === JSON.stringify(want.carried.map((c) => c.item));
    } catch (error) {
      record.previous = { restored: false, refused: code(error) };
    }
  } else record.previous = null;
  const current = story.periods.at(-1);
  const statement = await bytes(`${current.id}-statement.pdf`);
  const cashbook = await bytes(`${current.id}-cashbook.csv`);
  const { result } = await replayBankStatement({
    version: 'bank-statement-lifecycle-1',
    files: [
      { name: `${current.id}-statement.pdf`, sha256: sha(new Uint8Array(statement)), original: statement },
      { name: `${current.id}-cashbook.csv`, sha256: sha(new Uint8Array(cashbook)), original: cashbook },
    ],
    scope: { currency: null, period: null, confirmedClosing: null },
    decisions: [],
  });
  record.current = {
    status: result.status,
    automatic: result.match.auto.length,
    review: result.match.review.map((g) => g.reason),
    statementOnly: result.match.statementOnly.length,
    cashbookOnly: result.match.cashbookOnly.length,
  };
  record.carry = { supported: false, expectedCases: want.cases.length, made: 0 };
  stories[story.id] = record;
}

const ids = Object.keys(stories);
const sessions = ids.filter((id) => stories[id].previous);
const outcome = {
  schema: 'tarasuf-wf1-roll1-baseline/1',
  inputManifestSha256: sha(await readFile(path.join(frozen, 'INPUT-MANIFEST.json'))),
  summary: {
    stories: ids.length,
    previousSessionsRestored: `${sessions.filter((id) => stories[id].previous.restored).length}/${sessions.length}`,
    outstandingEqualsOracle: `${ids.filter((id) => stories[id].previous?.equalsOracleCarried).length}/${ids.filter((id) => stories[id].previous && 'equalsOracleCarried' in stories[id].previous).length}`,
    carriedCasesMade: `0/${ids.reduce((n, id) => n + stories[id].carry.expectedCases, 0)}`,
  },
  stories,
};
const out = process.env.BANK_ROLL_BASELINE_DIR ?? path.join(root, 'work/bank-roll-baseline');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'baseline.json'), `${JSON.stringify(outcome, null, 1)}\n`);
console.log(JSON.stringify(outcome.summary));
if (option('assert')) {
  const { run, ...recorded } = await json(path.resolve(root, option('assert')));
  assert.ok(run, 'the record names its run');
  assert.deepEqual(JSON.parse(JSON.stringify(outcome)), recorded, 'the outcome differs from the record');
}
