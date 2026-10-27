// SUP-2 S3: a statement header that strings its labelled fields on one line
// with a separator between them, "Customer: … · Currency: SAR · Period: …".
// Each value ends where the separator before the next label begins; the
// separator is not part of the value. Before, "Currency" read "SAR ·", the
// declared currency was invalid, and every automatic match was stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, normalizeSource } from '../lib/reconciliation/core.ts';
import { readFile } from '../lib/reconciliation/io.ts';
import { selectImportMapping } from '../lib/reconciliation/import-selection.ts';
import type { Scope } from '../lib/reconciliation/types.ts';
import { syntheticPdf } from './helpers/pdf-fixture.ts';

const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Buyer',
  account: 'AP',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const X = [30, 172, 315, 452];
const text = (x: number, y: number, value: string) =>
  `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${value.replace(/[\\()]/g, (c) => '\\' + c)}) Tj ET`;
// The header is written as a PDF string as it is given: the fixture's font is
// a standard Type1 font, where the middle dot is code \264 and the bullet \267.
const raw = (x: number, y: number, pdfString: string) =>
  `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${pdfString}) Tj ET`;
const statement = (header: string) =>
  syntheticPdf(
    [[]],
    9,
    [
      raw(30, 780, header),
      ...['Date', 'Invoice No', 'Amount', 'Description'].map((v, i) => text(X[i], 750, v)),
      ...['2026-07-02', 'INV-301', '1,250.00', 'Steel'].map((v, i) => text(X[i], 730, v)),
      ...['2026-07-09', 'INV-302', '480.10', 'Bolts'].map((v, i) => text(X[i], 710, v)),
    ].join('\n'),
  );
const ledger = new TextEncoder().encode(
  'Date,Reference,Amount\r\n2026-07-02,INV-301,1250.00\r\n2026-07-09,INV-302,480.10\r\n',
).buffer as ArrayBuffer;

async function run(header: string) {
  const pdf = await readFile('header.pdf', statement(header), [24, 48, 71]);
  const book = await readFile('ledger.csv', ledger);
  const a = normalizeSource(
    pdf,
    { ...selectImportMapping(pdf, 'supplier').mapping, pdfReviewed: true },
    scope,
    'supplier',
  );
  const b = normalizeSource(book, selectImportMapping(book, 'ledger').mapping, scope, 'ledger');
  return { a, result: compare(a, b, scope) };
}

void test('S3 labelled header fields separated by a middle dot, a bar or a semicolon keep their values', async () => {
  for (const separator of ['\\264', '|', ';', '\\267']) {
    const { a, result } = await run(
      `Customer: Synthetic Buyer ${separator} Account: C-1001 ${separator} Currency: SAR ${separator} Period: 2026-07-01 to 2026-07-31`,
    );
    assert.equal(a.metadata?.currency, 'SAR', separator);
    assert.equal(a.metadata?.entityName, 'Synthetic Buyer', separator);
    assert.ok(!a.warnings.some((w) => w.startsWith('CURRENCY_INVALID')), separator);
    assert.equal(result.matches.length, 2, separator);
  }
});

void test('S3 near cases: a currency that is not a code stays invalid and stops automatic matching', async () => {
  for (const header of [
    'Customer: Synthetic Buyer · Currency: SAR riyal · Period: 2026-07-01 to 2026-07-31',
    'Customer: Synthetic Buyer · Currency: · · Period: 2026-07-01 to 2026-07-31',
  ]) {
    const { a, result } = await run(header);
    assert.notEqual(a.metadata?.currency, 'SAR', header);
    assert.equal(result.matches.length, 0, header);
  }
});
