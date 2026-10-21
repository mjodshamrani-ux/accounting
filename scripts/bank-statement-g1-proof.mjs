// BNK-PDF-1 G1 proof: the native statement reader against the sealed facts.
// For each of the sixteen frozen statements, read from the PDF bytes alone,
// every printed line must equal the facts line for line (kind, dates,
// reference, amounts, balances; descriptions and continuation text after
// NFKC and whitespace normalisation), and the statement-level outcome must
// equal the independent oracle's EXPECTED.json. BS01's statement CSV and XLSX
// must carry the same movements. The facts come from stories.mjs and must
// match the seal; nothing from the reader decides what is expected.
//   node --experimental-strip-types scripts/bank-statement-g1-proof.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suite = path.join(root, 'audit/bank-statement-foundation');
const frozen = path.join(suite, 'frozen');
const outDir =
  process.env.BNK_G1_PROOF_DIR ?? path.join(root, 'work/bank-statement-g1');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

const manifest = await json(path.join(frozen, 'INPUT-MANIFEST.json'));
for (const e of manifest.files) {
  const b = await readFile(path.join(frozen, e.file));
  assert.equal(sha(b), e.sha256, e.file);
}
const { factsJson } = await import(path.join(suite, 'stories.mjs'));
const factsText = factsJson();
assert.equal(
  sha(factsText),
  manifest.facts.sha256,
  'facts differ from the seal',
);
const facts = JSON.parse(factsText);
const expected = await json(path.join(frozen, 'EXPECTED.json'));

const { readNativePdfWordSource } = await import(
  path.join(root, 'lib/reconciliation/pdf.ts')
);
const { readFile: readSource } = await import(
  path.join(root, 'lib/reconciliation/io.ts')
);
const { readBankStatementPdf, readBankStatementTable } = await import(
  path.join(root, 'lib/reconciliation/bank-statement-native.ts')
);

const words = (s) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const minor = (s) => Math.round(Number(s) * 100);
const report = { statements: [], tables: [], lines: 0, values: 0 };
for (const story of facts.stories) {
  const id = story.id;
  const bytes = await readFile(path.join(frozen, `${id}-statement.pdf`));
  const source = await readNativePdfWordSource(Uint8Array.from(bytes).buffer);
  assert.equal(source.sha256, sha(bytes), id);
  const reading = readBankStatementPdf(source);
  const want = expected.stories.find((s) => s.id === id);
  // Statement level, against the independent oracle.
  assert.equal(reading.status, want.statement, `${id} status`);
  assert.equal(reading.pages.length, want.printedPages, `${id} pages`);
  const movements = reading.lines.filter((l) => l.kind === 'movement');
  assert.equal(movements.length, want.movements, `${id} movements`);
  const kinds = {};
  for (const l of reading.lines)
    if (l.kind !== 'movement') kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(kinds).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    want.nonMovementLines,
    `${id} non-movement lines`,
  );
  // The oracle states these for every statement whose pages are complete.
  if (want.statement !== 'incomplete-pages') {
    assert.equal(reading.opening, minor(want.opening), `${id} opening`);
    assert.equal(reading.closing, minor(want.closing), `${id} closing`);
    assert.equal(reading.withdrawals, minor(want.withdrawals), `${id} W`);
    assert.equal(reading.deposits, minor(want.deposits), `${id} D`);
  }
  assert.equal(reading.currency, facts.currency, `${id} currency`);
  assert.deepEqual(reading.period, facts.period, `${id} period`);
  assert.equal(reading.layout, story.layout, `${id} layout`);
  // Page numbers as printed, in physical order.
  assert.deepEqual(
    reading.pages.map((p) => [p.page, p.number, p.of]),
    story.statement.pages.map((p, i) => [i + 1, p.number, p.of]),
    `${id} page numbers`,
  );
  // Line by line against the facts.
  const printed = story.statement.pages.flatMap((p, i) =>
    p.lines.map((l) => ({ ...l, page: i + 1 })),
  );
  assert.equal(reading.lines.length, printed.length, `${id} line count`);
  for (const [i, got] of reading.lines.entries()) {
    const fact = printed[i];
    const where = `${id} line ${i + 1} (${fact.kind}${fact.key ? ' ' + fact.key : ''})`;
    assert.equal(got.kind, fact.kind, where);
    assert.equal(got.page, fact.page, where);
    assert.ok(got.items.length > 0, `${where}: no citation`);
    const items = new Set(source.pages[got.page - 1].tokens.map((t) => t.item));
    assert.ok(
      got.items.every((n) => items.has(n)),
      `${where}: cites an item outside its page`,
    );
    const fields =
      fact.kind === 'movement'
        ? ['date', 'valueDate', 'reference', 'withdrawal', 'deposit', 'balance']
        : fact.kind === 'totals' || fact.kind === 'page-totals'
          ? ['withdrawal', 'deposit']
          : fact.kind === 'continuation'
            ? []
            : ['balance'];
    for (const f of fields) {
      assert.equal(got[f], fact[f], `${where} ${f}`);
      report.values++;
    }
    if (fact.kind === 'movement') {
      assert.equal(words(got.description), words(fact.description), where);
      report.values++;
    }
    if (fact.kind === 'continuation') {
      assert.equal(words(got.text), words(fact.text), where);
      report.values++;
    }
    report.lines++;
  }
  report.statements.push({
    id,
    pages: reading.pages.length,
    lines: reading.lines.length,
    movements: movements.length,
    status: reading.status,
    reason: reading.reason ?? null,
  });
}

// BS01 as a table: the same movements, but no closing balance printed, so
// completeness cannot be proved from the file alone.
const bs01 = facts.stories.find((s) => s.id === 'BS01');
const pdfMovements = bs01.statement.pages
  .flatMap((p) => p.lines)
  .filter((l) => l.kind === 'movement');
for (const name of ['BS01-statement.csv', 'BS01-statement.xlsx']) {
  const bytes = await readFile(path.join(frozen, name));
  const file = await readSource(name, Uint8Array.from(bytes).buffer);
  const table = readBankStatementTable(file, 'SAR');
  const moves = table.lines.filter((l) => l.kind === 'movement');
  assert.equal(moves.length, pdfMovements.length, name);
  for (const [i, m] of moves.entries())
    for (const f of [
      'date',
      'valueDate',
      'reference',
      'withdrawal',
      'deposit',
      'balance',
    ])
      assert.equal(m[f], pdfMovements[i][f], `${name} row ${i + 3} ${f}`);
  assert.equal(
    table.opening,
    bs01.statement.pages[0].lines[0].balance,
    `${name} opening`,
  );
  assert.equal(table.status, 'completeness-unproven', name);
  report.tables.push({
    file: name,
    movements: moves.length,
    status: table.status,
  });
}

assert.equal(report.statements.length, 16);
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'proof.json'),
  `${JSON.stringify(report, null, 1)}\n`,
);
console.log(
  JSON.stringify({
    statements: report.statements.length,
    pages: report.statements.reduce((n, s) => n + s.pages, 0),
    lines: report.lines,
    values: report.values,
    verified: report.statements.filter((s) => s.status === 'verified').length,
    held: report.statements
      .filter((s) => s.status !== 'verified')
      .map((s) => `${s.id}:${s.status}`),
    tables: report.tables,
    out: path.relative(root, outDir),
  }),
);
