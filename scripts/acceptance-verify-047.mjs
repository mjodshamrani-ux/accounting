// Accounting verification for the interface acceptance round.
//
// It reads the downloaded workbook with the project's independent OOXML reader
// (JSZip + SAX + BigInt, no ExcelJS and no engine imports), so the check does
// not run through the same library that wrote the file. Amounts are parsed with
// decimalMinor, which throws on anything that is not a valid decimal, so a
// missing or unparsable amount fails instead of slipping through a numeric
// comparison.
//
// It checks what the round claims: the rows on BOTH sides, the links that must
// exist, the links that must not, and the items that must stay for review or
// without a counterpart. A count alone would pass while two links are swapped.
import {
  readOutputWorkbook,
  decimalMinor,
} from '../audit/reliability/verify-workbook.mjs';

const cell = (row, column) => row?.get(column)?.value ?? '';
const rowsOf = (sheet) =>
  [...(sheet?.rows ?? new Map()).entries()]
    .filter(([number]) => number > 1)
    .sort((a, b) => a[0] - b[0])
    .map(([, data]) => data);
/** Excel serial day -> ISO date. The reader returns raw cell text, so a date is
 * a serial number unless the exporter wrote an ISO string. */
const isoDate = (text) => {
  const raw = String(text).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw;
  const serial = Number(raw);
  const ms = Math.round((serial - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
};
const refsOf = (text) =>
  String(text)
    .split(/[\n,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
const linkKey = (supplier, ledger) =>
  JSON.stringify([[...supplier].sort(), [...ledger].sort()]);

/** @param {Uint8Array} bytes downloaded workbook
 *  @param {object} expected declared reference results for one case */
export async function verifyAcceptanceExport(bytes, expected, decimals = 2) {
  const problems = [];
  const note = (text) => problems.push(text);
  const workbook = await readOutputWorkbook(bytes);
  const sheet = (name) => workbook.sheets.get(name);

  const side = (name, want) => {
    if (!want) return;
    const found = sheet(name);
    if (!found) return note(`missing sheet ${name}`);
    const seen = rowsOf(found).map((row) => ({
      date: isoDate(cell(row, 'D')),
      reference: String(cell(row, 'E')).trim(),
      // decimalMinor throws on a blank or malformed amount rather than
      // producing NaN, so an empty cell cannot pass a tolerance comparison.
      minor: decimalMinor(cell(row, 'H'), decimals),
    }));
    if (seen.length !== want.length)
      note(`${name}: ${seen.length} rows, expected ${want.length}`);
    for (const [i, expect] of want.entries()) {
      const actual = seen[i];
      if (!actual) {
        note(`${name}: row ${i + 1} is missing`);
        continue;
      }
      if (actual.reference !== expect.reference)
        note(
          `${name}: row ${i + 1} reference ${actual.reference} vs ${expect.reference}`,
        );
      if (actual.date !== expect.date)
        note(`${name}: row ${i + 1} date ${actual.date} vs ${expect.date}`);
      if (actual.minor !== BigInt(expect.minor))
        note(`${name}: row ${i + 1} amount ${actual.minor} vs ${expect.minor}`);
    }
  };
  side('Supplier transactions', expected.supplierRows);
  side('Ledger transactions', expected.ledgerRows);

  // Match membership, not a match count: a swap keeps the count and changes
  // which document was reconciled against which.
  const matches = rowsOf(sheet('Matches')).map((row) => ({
    supplier: refsOf(cell(row, 'D')),
    ledger: refsOf(cell(row, 'G')),
  }));
  const present = new Set(matches.map((m) => linkKey(m.supplier, m.ledger)));
  for (const [supplier, ledger] of expected.requiredLinks ?? [])
    if (!present.has(linkKey(supplier, ledger)))
      note(
        `required link missing: ${supplier.join('+')} -> ${ledger.join('+')}`,
      );
  for (const [supplier, ledger] of expected.forbiddenLinks ?? [])
    if (present.has(linkKey(supplier, ledger)))
      note(
        `forbidden link accepted: ${supplier.join('+')} -> ${ledger.join('+')}`,
      );
  if (
    expected.requiredLinks &&
    matches.length !== expected.requiredLinks.length
  )
    note(
      `accepted ${matches.length} links, expected ${expected.requiredLinks.length}`,
    );

  // References the round says must stay for review, or stay without a
  // counterpart. Reaching the results screen is not an accounting outcome.
  const reviewRefs = new Set(
    rowsOf(sheet('Needs Review')).flatMap((row) => [
      ...refsOf(cell(row, 'C')),
      ...refsOf(cell(row, 'D')),
    ]),
  );
  for (const reference of expected.needsReview ?? [])
    if (![...reviewRefs].some((value) => value.includes(reference)))
      note(`expected ${reference} to stay for review`);
  const unmatched = rowsOf(sheet('Unmatched')).map((row) => ({
    side: String(cell(row, 'B')).trim(),
    reference: String(cell(row, 'E')).trim(),
  }));
  for (const want of expected.unmatched ?? [])
    if (
      !unmatched.some(
        (u) =>
          u.reference === want.reference &&
          (!want.side || u.side.includes(want.side)),
      )
    )
      note(
        `expected ${want.reference} to stay unmatched on ${want.side ?? 'either side'}`,
      );
  if (
    expected.unmatchedCount !== undefined &&
    unmatched.length !== expected.unmatchedCount
  )
    note(
      `unmatched rows ${unmatched.length}, expected ${expected.unmatchedCount}`,
    );

  return {
    reader:
      'audit/reliability/verify-workbook.mjs readOutputWorkbook (OOXML ZIP + SAX + BigInt, no ExcelJS)',
    acceptedLinks: matches.length,
    unmatchedRows: unmatched.length,
    reviewReferences: [...reviewRefs].length,
    problems,
    verified: problems.length === 0,
  };
}

/** The round's pass rule, kept here so it can be tested on its own. A completed
 * case counts only when its declared accounting result was checked and held.
 * An unchecked export, a verifier that could not read the file, and a link count
 * that disagrees with the declared links are all failures, not passes. */
export function caseAccepted(entry, record) {
  if (entry.expect !== 'completed')
    return (
      record.outcome === 'correct-stop' &&
      (!entry.expectReason || entry.expectReason.test(String(record.reason)))
    );
  const expectedLinks = entry.expected?.requiredLinks.length;
  return (
    String(record.outcome).startsWith('completed') &&
    record.verification?.status === 'verified' &&
    (expectedLinks === undefined || record.matched === expectedLinks)
  );
}
