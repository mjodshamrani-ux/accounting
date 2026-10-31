// AR-1 PDF A2: the AR engine compares each sealed customer statement PDF with
// its ledger exactly as the sealed expectations say. The product reads only the
// bytes of the PDF and the ledger CSV; EXPECTED.json was written by the
// independent oracle and sealed before any product run (5f32c8c).
// Compared per story: the status, every error with its place, the sections
// with their scope, pages, line counts and which one is compared, the lines
// out of scope, and every case with its reason and its members on both sides.
// Then, across all stories: no automatic match the expectations do not have.
//   node --experimental-strip-types scripts/ar-statement-match-proof.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const frozen = path.join(root, 'audit/ar-statement-foundation/frozen');
const { readNativePdfWordSource } = await import(
  path.join(root, 'lib/reconciliation/pdf.ts')
);
const { readArStatementPdf } = await import(
  path.join(root, 'lib/reconciliation/ar-statement-pdf.ts')
);
const { reconcileArStatement } = await import(
  path.join(root, 'lib/reconciliation/ar.ts')
);
const { readArFile } = await import(
  path.join(root, 'lib/reconciliation/ar-source.ts')
);

const facts = JSON.parse(
  await readFile(path.join(frozen, 'stories.json'), 'utf8'),
);
const expected = JSON.parse(
  await readFile(path.join(frozen, 'EXPECTED.json'), 'utf8'),
).stories;
const bytes = async (name) =>
  Uint8Array.from(await readFile(path.join(frozen, name))).buffer;
// The ledger columns as the accountant confirms them, by their headers.
const ledgerReading = (header) => {
  const at = (name) => {
    const i = header.indexOf(name);
    assert.ok(i >= 0, `ledger header ${name}`);
    return i;
  };
  return {
    sheet: 0,
    header: 0,
    posting: at('Posting ID'),
    kind: at('Document type'),
    document: at('Own document number'),
    date: at('Posting date'),
    amount: at('Original signed amount'),
    entity: at('Entity'),
    ledger: at('Ledger'),
    customer: at('Customer'),
    account: at('Account'),
    currency: at('Currency'),
    related: at('Related invoice'),
    description: at('Description'),
    role: 'company-ar-ledger',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: true,
  };
};

const summary = [];
let falseApprovals = 0;
let missedApprovals = 0;
for (const story of facts.stories) {
  const id = story.id;
  const want = expected[id];
  const reading = readArStatementPdf(
    await readNativePdfWordSource(await bytes(`${id}-statement.pdf`)),
  );
  const ledger = await readArFile(
    `${id}-ledger.csv`,
    await bytes(`${id}-ledger.csv`),
  );
  const got = reconcileArStatement({
    files: [
      ledger,
      {
        kind: 'ar-statement-pdf',
        name: `${id}-statement.pdf`,
        sha256: reading.sha256,
        reading,
      },
    ],
    readings: [
      ledgerReading(ledger.sheets[0].rows[0]),
      {
        family: 'ar-statement-pdf-1',
        role: 'company-issued-customer-statement',
        perspective: 'seller-receivable',
        basis: 'original-movement',
        confirmed: true,
      },
    ],
    scope: { ...story.scope, confirmed: true },
    events: [],
  });

  // Every printed line is in the inventory, once, in printed order.
  const printed = got.inventory.filter((i) => i.side === 1);
  assert.deepEqual(
    printed.map((i) => [i.pdf.page, i.pdf.line]),
    reading.lines.map((l) => [l.page, l.line]),
    `${id} statement inventory`,
  );

  assert.equal(got.status, want.status, `${id} status`);
  assert.deepEqual(
    [...new Set(got.sourceIssues.map((i) => i.code))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    want.errorCodes,
    `${id} error codes`,
  );
  const placeOf = new Map(
    got.inventory.map((i) => [
      i.inventoryId,
      i.side === 1 ? [i.pdf.page, i.pdf.line] : i.row,
    ]),
  );
  for (const e of want.errors) {
    const issues = got.sourceIssues.filter((i) => i.code === e.code);
    assert.equal(issues.length > 0, true, `${id} ${e.code} reported`);
    const places = issues.flatMap((i) =>
      i.inventoryIds.map((ref) => placeOf.get(ref)),
    );
    if (e.code === 'AR_PDF_SCOPE_REPEATED')
      // The first page of each section that carries the confirmed scope.
      assert.deepEqual(
        places.map((p) => p[0]),
        e.where,
        `${id} ${e.code} place`,
      );
    else if (e.where === null)
      assert.deepEqual(places, [], `${id} ${e.code} place`);
    else
      assert.deepEqual(
        places.filter((p) => Array.isArray(p) && p[0] === e.where[0] && p[1] === e.where[1]),
        [e.where],
        `${id} ${e.code} place`,
      );
  }

  assert.deepEqual(
    got.statement.sections.map((s) => ({
      compared: s.compared,
      lines: s.lines,
      pages: s.pages,
      scope: s.scope,
    })),
    want.sections,
    `${id} sections`,
  );
  assert.equal(
    got.statement.outOfScopeLines,
    want.outOfScopeLines,
    `${id} lines out of scope`,
  );

  const rowById = new Map(got.rows.map((r) => [r.id, r]));
  const cases = got.cases
    .filter((c) => c.kind !== 'scope')
    .map((c) => {
      const members = c.ids.map((m) => rowById.get(m));
      return {
        document: c.document,
        kind: c.kind,
        ledger: members.filter((r) => r.side === 0).map((r) => r.posting),
        reason: c.reason,
        statement: members
          .filter((r) => r.side === 1)
          .map((r) => [r.pdf.page, r.pdf.line]),
      };
    })
    .sort((a, b) =>
      a.kind === b.kind
        ? a.document < b.document
          ? -1
          : 1
        : a.kind < b.kind
          ? -1
          : 1,
    );
  const key = (c) => JSON.stringify(c);
  const wanted = new Set(
    want.cases.filter((c) => c.reason === 'exact-own-document').map(key),
  );
  const matched = cases.filter((c) => c.reason === 'exact-own-document');
  falseApprovals += matched.filter((c) => !wanted.has(key(c))).length;
  missedApprovals += [...wanted].filter(
    (k) => !matched.some((c) => key(c) === k),
  ).length;
  assert.deepEqual(cases, want.cases, `${id} cases`);
  assert.equal(
    got.cases.filter((c) => c.status === 'matched').length,
    want.matched,
    `${id} matched`,
  );
  const review = {};
  for (const c of got.cases)
    if (c.kind !== 'scope' && !['exact-own-document', 'source-errors'].includes(c.reason))
      review[c.reason] = (review[c.reason] ?? 0) + 1;
  assert.deepEqual(review, want.review, `${id} review`);
  // Nothing outside the compared section is a member.
  const compared = got.statement.compared;
  for (const r of got.rows.filter((row) => row.side === 1)) {
    const line = reading.lines.find(
      (l) => l.page === r.pdf.page && l.line === r.pdf.line,
    );
    assert.equal(line.section, compared, `${id} member outside the compared section`);
  }

  summary.push({
    id,
    status: got.status,
    errors: want.errorCodes,
    cases: cases.length,
    matched: want.matched,
    outOfScopeLines: got.statement.outOfScopeLines,
  });
}
assert.equal(falseApprovals, 0, 'automatic matches the expectations do not have');
assert.equal(missedApprovals, 0, 'expected matches the product did not make');
console.log(
  JSON.stringify({
    stories: summary.length,
    cases: summary.reduce((n, s) => n + s.cases, 0),
    matched: summary.reduce((n, s) => n + s.matched, 0),
    falseApprovals,
    missedApprovals,
    summary,
  }),
);
