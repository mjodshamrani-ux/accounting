import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arCardBlock,
  arCardHeaders,
  arCardKind,
} from '../lib/ar-scope-card.ts';
import type { ArReading } from '../lib/reconciliation/ar.ts';
import type { SourceFile } from '../lib/reconciliation/types.ts';

// What the receivables card reads of each side (UX-5(d)), on synthetic rows.
const file = (rows: string[][]): SourceFile =>
  ({
    name: 'synthetic.csv',
    sheets: [{ name: 'Sheet1', rows, hiddenRows: [], formulaRows: [] }],
  }) as unknown as SourceFile;
const mapped = (columns: Record<string, number>) =>
  ({
    sheet: 0,
    header: 0,
    posting: 0,
    kind: 1,
    document: 2,
    date: 3,
    amount: 4,
    entity: -1,
    ledger: -1,
    customer: -1,
    account: -1,
    currency: -1,
    related: -1,
    description: -1,
    role: 'company-ar-ledger',
    perspective: 'seller-receivable',
    basis: 'original-movement',
    confirmed: false,
    ...columns,
  }) as unknown as ArReading;
const scopeReading = {
  family: 'ar-scope-details-1',
  sheet: 0,
  header: 15,
} as unknown as ArReading;
const printed = {
  family: 'ar-statement-pdf-1',
} as unknown as ArReading;

void test('a table read row by row names the mapped columns, and no column for an unmapped field', () => {
  const table = file([
    [
      'Posting ID',
      'Document type',
      'Doc',
      'Date',
      'Amount',
      'Entity',
      'Ledger',
      ' Customer ID ',
    ],
    ['P1', 'invoice', 'I1', '2026-09-01', '1', 'E1', 'L1', 'C1'],
  ]);
  const headers = arCardHeaders(table, mapped({ entity: 5, customer: 7 }));
  assert.equal(headers.entity, 'Entity');
  assert.equal(headers.customer, 'Customer ID', 'trimmed as the reader trims');
  assert.equal(headers.ledger, null, 'a column left unmapped is not read');
  assert.equal(headers.start, null, 'no period column in this family');
  assert.equal(headers.end, null);
  assert.equal(arCardBlock(table, mapped({ entity: 5 })), null);
});

void test('a scope block is read between its markers, and a key written twice is not', () => {
  const block = file([
    ['AR_SCOPE', '1'],
    ['Entity', 'E1'],
    ['', ''],
    ['Ledger', 'L1'],
    ['Customer', 'C1'],
    ['Customer', 'C2'],
    ['Period start', '2026-09-01'],
    ['DETAILS', ''],
    ['Period end', '2026-09-30'],
  ]);
  assert.deepEqual(arCardBlock(block, scopeReading), {
    entity: 'E1',
    ledger: 'L1',
    start: '2026-09-01',
  });
  const headers = arCardHeaders(block, scopeReading);
  assert.ok(
    Object.values(headers).every((v) => v === null),
    'a block side is not read row by row',
  );
  assert.equal(
    arCardBlock(file([['Entity', 'E1']]), scopeReading),
    null,
    'no AR_SCOPE marker, no block',
  );
});

void test('a printed statement, or no file, states nothing before the run', () => {
  const pdf = { name: 's.pdf', sheets: [] } as unknown as SourceFile;
  assert.equal(arCardKind(pdf, printed), 'printed');
  assert.equal(arCardKind(null, printed), 'none');
  assert.equal(arCardBlock(pdf, printed), null);
  assert.ok(
    Object.values(arCardHeaders(pdf, printed)).every((v) => v === null),
  );
  // After a run the statement is held without sheets at all.
  const held = { name: 's.pdf' } as unknown as SourceFile;
  assert.equal(arCardBlock(held, printed), null);
  assert.ok(
    Object.values(arCardHeaders(held, printed)).every((v) => v === null),
  );
});
