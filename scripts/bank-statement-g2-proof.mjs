// BNK-PDF-1 G2 proof: statement matching against the independent oracle.
// Each of the sixteen frozen statements is read from its PDF bytes (G1) and
// matched against its cashbook file; the result, mapped to the foundation's
// keys by printed order and voucher, must equal EXPECTED.json exactly: the
// automatic pairs, every review group with its reason, both outstanding
// sides, timing, and the held statements. BS01's CSV and XLSX statement must
// stay held until a confirmed closing balance equal to its own, and then give
// the PDF's result. Nothing here comes from the engine under test.
//   node --experimental-strip-types scripts/bank-statement-g2-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-statement-foundation');
const frozen = path.join(suite, 'frozen');
const outDir =
  process.env.BNK_G2_PROOF_DIR ?? path.join(root, 'work/bank-statement-g2');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const e of manifest.files)
  assert.equal(
    sha(await readFile(path.join(frozen, e.file))),
    e.sha256,
    e.file,
  );
const { factsJson } = await import(path.join(suite, 'stories.mjs'));
const factsText = factsJson();
assert.equal(
  sha(factsText),
  manifest.facts.sha256,
  'facts differ from the seal',
);
const facts = JSON.parse(factsText);
const expected = await json(path.join(frozen, 'EXPECTED.json'));
const contract = await json(path.join(suite, 'contract.json'));

const { readNativePdfWordSource } = await import(
  path.join(root, 'lib/reconciliation/pdf.ts')
);
const { readFile: readSource } = await import(
  path.join(root, 'lib/reconciliation/io.ts')
);
const { readBankStatementPdf, readBankStatementTable } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-native.ts')
);
const {
  matchBankStatement,
  readBankCashbookTable,
  STATEMENT_DATE_WINDOW_DAYS,
} = await import(path.join(root, 'lib/reconciliation/bank-statement-match.ts'));
assert.equal(STATEMENT_DATE_WINDOW_DAYS, contract.matching.dateWindowDays);

const source = async (name) =>
  readSource(
    name,
    Uint8Array.from(await readFile(path.join(frozen, name))).buffer,
  );
const sortedPairs = (pairs) =>
  pairs.map((p) => p.join('|')).sort((a, b) => (a < b ? -1 : 1));
const sorted = (xs) => [...xs].sort((a, b) => (a < b ? -1 : 1));
const sortedGroups = (groups) =>
  sorted(
    groups.map(
      (g) =>
        `${sorted(g.bank).join(',')}/${sorted(g.cash).join(',')}/${g.reason}`,
    ),
  );

/** The engine's result in the foundation's keys. */
function inKeys(result, story) {
  const statementKeys = story.statement.pages
    .flatMap((p) => p.lines)
    .filter((l) => l.kind === 'movement')
    .map((l) => l.key);
  assert.equal(result.movements.length, statementKeys.length, story.id);
  const s = (id) => statementKeys[Number(id.slice(1)) - 1];
  const voucher = new Map(story.cashbook.map((r) => [r.voucher, r.key]));
  const c = (id) => voucher.get(id);
  return {
    auto: result.auto.map((a) => [s(a.statement), c(a.cashbook)]),
    review: result.review.map((g) => ({
      bank: g.statement.map(s),
      cash: g.cashbook.map(c),
      reason: g.reason,
    })),
    bankOnly: result.statementOnly.map(s),
    cashOnly: result.cashbookOnly.map(c),
    timing: result.timing.map(s),
  };
}
function sameAsExpected(result, story, want, label) {
  if (want.statement !== 'verified') {
    assert.ok(result.held, `${label}: must be held`);
    assert.deepEqual(
      { bank: result.held.statement, cash: result.held.cashbook },
      want.held,
      `${label} held counts`,
    );
    for (const k of [
      'auto',
      'review',
      'statementOnly',
      'cashbookOnly',
      'timing',
    ])
      assert.deepEqual(result[k], [], `${label} ${k} while held`);
    return { held: true };
  }
  assert.equal(result.held, undefined, `${label}: ${result.held?.reason}`);
  const got = inKeys(result, story);
  assert.deepEqual(
    sortedPairs(got.auto),
    sortedPairs(want.auto),
    `${label} auto`,
  );
  assert.deepEqual(
    sortedGroups(got.review),
    sortedGroups(want.review),
    `${label} review`,
  );
  for (const k of ['bankOnly', 'cashOnly', 'timing'])
    assert.deepEqual(sorted(got[k]), sorted(want[k]), `${label} ${k}`);
  // Every automatic pair is one the story's author intended.
  const intended = new Set(story.intent.auto.map((p) => p.join('|')));
  assert.ok(
    got.auto.every((p) => intended.has(p.join('|'))),
    `${label}: an automatic pair the story does not intend`,
  );
  return {
    auto: got.auto.length,
    review: got.review.map((g) => g.reason),
    bankOnly: got.bankOnly.length,
    cashOnly: got.cashOnly.length,
    timing: got.timing.length,
  };
}

const report = { statements: [], tables: [] };
for (const story of facts.stories) {
  const want = expected.stories.find((s) => s.id === story.id);
  const bytes = await readFile(path.join(frozen, `${story.id}-statement.pdf`));
  const reading = readBankStatementPdf(
    await readNativePdfWordSource(Uint8Array.from(bytes).buffer),
  );
  const cashbook = readBankCashbookTable(
    await source(`${story.id}-cashbook.csv`),
    reading.currency,
  );
  assert.equal(cashbook.length, want.cashbookRows, `${story.id} cashbook rows`);
  const result = matchBankStatement(reading, cashbook);
  report.statements.push({
    id: story.id,
    ...sameAsExpected(result, story, want, story.id),
  });
}

// BS01 exported as a table: held until a confirmed closing balance that
// equals its own, then the PDF's result.
const bs01 = facts.stories.find((s) => s.id === 'BS01');
const bs01Want = expected.stories.find((s) => s.id === 'BS01');
const closing = bs01.statement.pages
  .flatMap((p) => p.lines)
  .find((l) => l.kind === 'closing').balance;
for (const [statementFile, cashbookFile] of [
  ['BS01-statement.csv', 'BS01-cashbook.csv'],
  ['BS01-statement.xlsx', 'BS01-cashbook.xlsx'],
]) {
  const reading = readBankStatementTable(await source(statementFile), 'SAR');
  const cashbook = readBankCashbookTable(await source(cashbookFile), 'SAR');
  const unconfirmed = matchBankStatement(reading, cashbook, {
    period: facts.period,
  });
  assert.match(unconfirmed.held?.reason ?? '', /completeness-unproven/);
  const wrong = matchBankStatement(reading, cashbook, {
    period: facts.period,
    confirmedClosing: closing + 1,
  });
  assert.match(wrong.held?.reason ?? '', /confirmed closing/);
  const confirmed = matchBankStatement(reading, cashbook, {
    period: facts.period,
    confirmedClosing: closing,
  });
  assert.equal(confirmed.statement.completeness, 'confirmed-closing');
  report.tables.push({
    statement: statementFile,
    cashbook: cashbookFile,
    unconfirmed: 'held',
    wrongClosing: 'held',
    confirmed: sameAsExpected(confirmed, bs01, bs01Want, statementFile),
  });
}

assert.equal(report.statements.length, 16);
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'proof.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
const matched = report.statements.filter((s) => !s.held);
console.log(
  JSON.stringify({
    statements: report.statements.length,
    matched: matched.length,
    held: report.statements.filter((s) => s.held).map((s) => s.id),
    automatic: matched.reduce((n, s) => n + s.auto, 0),
    review: matched.flatMap((s) => s.review),
    statementOnly: matched.reduce((n, s) => n + s.bankOnly, 0),
    cashbookOnly: matched.reduce((n, s) => n + s.cashOnly, 0),
    timing: matched.reduce((n, s) => n + s.timing, 0),
    tables: report.tables.map(
      (t) => `${t.statement}: held, held, ${t.confirmed.auto} automatic`,
    ),
    out: path.relative(root, outDir),
  }),
);
