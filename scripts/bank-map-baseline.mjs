// WF-1 MAP-1 foundation: the product as it is, on the sealed map stories
// (audit/bank-map-foundation), first run after the seal. The product reads a
// cashbook only in its declared headers and has no column map, so for every
// cashbook a story reads it records:
//   1. what the lifecycle makes of the file as it is, with the period's
//      sealed statement: its refusal code and row, or its cases;
//   2. what the sealed expectation says the contract makes of it: read, a
//      misfit, a refused choice, or a reading refused at a row;
//   3. for every reading the expectation settles, the lifecycle on the
//      period's declared twin: whether its cases equal the expected cases,
//      which shows whether reading the columns is all that is missing.
// And it records each import and export as an action with no path in the
// product as it was. A refusal or an error is recorded, not thrown.
// With --record=<file> the outcome is written to the package's results/; with
// --assert=<file> it must equal that record.
//   node --experimental-strip-types scripts/bank-map-baseline.mjs [--record=<file> | --assert=<file>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-map-foundation');
const frozen = path.join(suite, 'frozen');
const option = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const { replayBankStatement } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-lifecycle.ts')
);

// The seal first, the sealed files the stories name included.
const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const [name, entry] of Object.entries(manifest.files))
  assert.equal(
    sha(await readFile(path.join(frozen, name))),
    entry.sha256,
    name,
  );
for (const [name, digest] of Object.entries(manifest.external))
  assert.equal(
    sha(await readFile(path.join(root, 'audit', name))),
    digest,
    name,
  );
const facts = await json(path.join(frozen, 'stories.json'));
const expected = (await json(path.join(frozen, 'EXPECTED.json'))).stories;
const read = async (p) => Uint8Array.from(await readFile(p)).buffer;
const message = (error) =>
  error instanceof Error ? error.message : String(error);
const code = (text) => /^(BANK_[A-Z_]+?)(?::|$)/u.exec(text)?.[1] ?? text;
const row = (text) => Number(/row (\d+)/u.exec(text)?.[1] ?? NaN);

async function lifecycle(action, cashbookPath, cashbookName) {
  const source = path.join(root, 'audit', action.source, 'frozen');
  const statement = await read(
    path.join(source, `${action.period}-statement.pdf`),
  );
  const cashbook = await read(cashbookPath);
  try {
    const { result } = await replayBankStatement({
      version: 'bank-statement-lifecycle-1',
      files: [
        {
          name: `${action.period}-statement.pdf`,
          sha256: sha(statement),
          original: statement,
        },
        { name: cashbookName, sha256: sha(cashbook), original: cashbook },
      ],
      scope: { currency: null, period: null, confirmedClosing: null },
      decisions: [],
    });
    return {
      held: result.status === 'held',
      cases: result.cases.map((c) => ({
        id: c.id,
        kind: c.kind,
        reason: c.reason,
        statement: c.statement,
        cashbook: c.cashbook,
        status: c.status,
      })),
    };
  } catch (error) {
    const text = message(error);
    return { refused: { code: code(text), row: row(text) }, message: text };
  }
}

/** What the sealed expectation says of one read: read, misfit, invalid, or
 * refused at a row. */
function contract(outcome) {
  if (outcome.invalid) return { outcome: 'invalid', code: outcome.invalid };
  if (outcome.fit && !outcome.fit.fits)
    return {
      outcome: 'misfit',
      problems: outcome.fit.problems.map((p) => p.role ?? p.kind),
    };
  if (outcome.reading.refused)
    return {
      outcome: 'refused',
      code: `BANK_CASHBOOK_${outcome.reading.refused.code}`,
      row: outcome.reading.refused.row,
    };
  return { outcome: 'read', entries: outcome.reading.entries.length };
}

// The lifecycle names two statuses as the sealed ROLL-1 oracle does not.
const STATUS = {
  'matched-automatic': 'matched',
  'matched-accepted': 'accepted',
};
const fields = (c) =>
  JSON.stringify([
    c.id,
    c.kind,
    c.reason,
    STATUS[c.status] ?? c.status,
    c.statement,
    c.cashbook,
  ]);
const sameCases = (a, b) =>
  a.length === b.length && a.every((c, i) => fields(c) === fields(b[i]));

const stories = {};
const summary = {
  reads: 0,
  productRead: 0,
  productRefusals: {},
  contractRead: 0,
  twinEqual: 0,
  twinSettled: 0,
  imports: 0,
  exports: 0,
};
for (const story of facts.stories) {
  const out = [];
  stories[story.id] = out;
  for (const [k, action] of story.actions.entries()) {
    const want = expected[story.id][k];
    if (action.do === 'import' || action.do === 'export') {
      summary[`${action.do}s`]++;
      out.push({
        do: action.do,
        file: action.file ?? action.map,
        product: 'no map format in the product',
      });
      continue;
    }
    summary.reads++;
    const file = action.twin
      ? path.join(root, 'audit', action.source, 'frozen', action.file)
      : path.join(frozen, action.file);
    const product = await lifecycle(action, file, action.as ?? action.file);
    const entry = {
      do: 'read',
      by: action.by,
      file: action.file,
      contract: contract(want),
    };
    if (product.refused) {
      entry.product = { refused: product.refused };
      summary.productRefusals[product.refused.code] =
        (summary.productRefusals[product.refused.code] ?? 0) + 1;
    } else {
      summary.productRead++;
      entry.product = {
        held: product.held,
        casesEqualExpected: want.period
          ? sameCases(product.cases, want.period.cases)
          : null,
      };
    }
    if (entry.contract.outcome === 'read') summary.contractRead++;
    // The engine on the declared twin, for a reading the contract settles.
    if (want.period) {
      const twin = path.join(
        root,
        'audit',
        action.source,
        'frozen',
        `${action.period}-cashbook.csv`,
      );
      const settled = await lifecycle(
        action,
        twin,
        `${action.period}-cashbook.csv`,
      );
      entry.twin = settled.refused
        ? { refused: settled.refused }
        : { casesEqualExpected: sameCases(settled.cases, want.period.cases) };
      summary.twinSettled++;
      if (entry.twin.casesEqualExpected) summary.twinEqual++;
    }
    out.push(entry);
  }
}
const outcome = { suite: 'bank-map-foundation', stories, summary };
const record = option('record'),
  check = option('assert');
if (record)
  await writeFile(
    path.join(suite, 'results', record),
    `${JSON.stringify(outcome, null, 1)}\n`,
  );
if (check)
  assert.deepEqual(outcome, await json(path.join(suite, 'results', check)));
console.log(JSON.stringify(summary, null, 1));
