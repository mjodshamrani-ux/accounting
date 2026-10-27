// AR-1 PDF A2: the confirmed scope chosen from a printed customer statement,
// and the pair compared by the AR engine. Each near case differs from a
// passing one in one decisive fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArStatementPdf } from '../lib/reconciliation/ar-statement-pdf.ts';
import {
  reconcileArStatement,
  type ArLegacyReading,
  type ArStatementPdfReading,
} from '../lib/reconciliation/ar.ts';
import { readArFile } from '../lib/reconciliation/ar-source.ts';
import {
  header,
  headings,
  invoice,
  page,
  source,
  text,
  top,
  type Tokens,
} from './helpers/ar-statement-pages.ts';

const SHA = 'a'.repeat(64);
const SCOPE = {
  entity: 'Synthetic Seller Co',
  ledger: 'AR Book',
  customer: 'C0001',
  account: '1200',
  currency: 'SAR',
  start: '2026-09-01',
  end: '2026-09-30',
  confirmed: true,
};
const LEDGER_HEADER =
  'Posting ID,Document type,Own document number,Posting date,Original signed amount,Entity,Ledger,Customer,Account,Currency,Related invoice,Description';
const posted = (posting: string, document: string, customer = 'C0001') =>
  [posting, 'invoice', document, '2026-09-02', '1250.00', 'Synthetic Seller Co', 'AR Book', customer, '1200', 'SAR', '', ''].join(',');
const ledgerReading: ArLegacyReading = {
  sheet: 0,
  header: 0,
  posting: 0,
  kind: 1,
  document: 2,
  date: 3,
  amount: 4,
  entity: 5,
  ledger: 6,
  customer: 7,
  account: 8,
  currency: 9,
  related: 10,
  description: 11,
  role: 'company-ar-ledger',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
};
const statementReading: ArStatementPdfReading = {
  family: 'ar-statement-pdf-1',
  role: 'company-issued-customer-statement',
  perspective: 'seller-receivable',
  basis: 'original-movement',
  confirmed: true,
};
const ledger = (rows: string[]) =>
  readArFile(
    'ledger.csv',
    new TextEncoder().encode([LEDGER_HEADER, ...rows].join('\n') + '\n')
      .buffer as ArrayBuffer,
  );
type Options = {
  scope?: Partial<typeof SCOPE>;
  events?: Parameters<typeof reconcileArStatement>[0]['events'];
  sha?: string;
};
async function compare(pages: Tokens[], rows: string[], options: Options = {}) {
  const reading = readArStatementPdf(source(pages, options.sha ?? SHA));
  return reconcileArStatement({
    files: [
      await ledger(rows),
      { kind: 'ar-statement-pdf', name: 'statement.pdf', sha256: reading.sha256, reading },
    ],
    readings: [ledgerReading, statementReading],
    scope: { ...SCOPE, ...options.scope },
    events: options.events ?? [],
  });
}
type Result = Awaited<ReturnType<typeof compare>>;
const codes = (r: Result) => r.sourceIssues!.map((i) => i.code);
const members = (r: Result) =>
  r.cases.map((c) => [
    c.reason,
    c.ids.map((id) => {
      const row = r.rows.find((x) => x.id === id)!;
      return row.side === 0 ? row.posting : `p${row.pdf!.page}:${row.pdf!.line}`;
    }),
  ]);
const lineOf = (r: Result, document: string) =>
  r.inventory.find((i) => i.side === 1 && i.values[0].includes(document))!.pdf!.line;
const twoCustomers = (second = 'INV-1') =>
  page(
    top(),
    header(730),
    headings(670),
    invoice(655, 'INV-1'),
    header(630, { customer: 'C0002' }),
    headings(570),
    invoice(555, second),
  );

void test('two customers in one print: only the confirmed section is compared', async () => {
  const first = await compare([twoCustomers()], [posted('L1', 'INV-1')]);
  assert.equal(first.status, 'matched');
  assert.deepEqual(members(first), [
    ['exact-own-document', ['L1', `p1:${lineOf(first, 'INV-1')}`]],
  ]);
  assert.equal(first.statement.compared, 0);
  assert.equal(first.statement.outOfScopeLines, 1);
  assert.deepEqual(
    first.inventory.filter((i) => i.kind === 'out-of-scope').map((i) => i.pdf!.section),
    [1],
  );
  // The same print confirmed for the other customer moves the members.
  const second = await compare([twoCustomers()], [posted('L9', 'INV-1', 'C0002')], {
    scope: { customer: 'C0002' },
  });
  assert.equal(second.status, 'matched');
  assert.equal(second.statement.compared, 1);
  assert.deepEqual(
    second.rows.filter((r) => r.side === 1).map((r) => r.pdf!.line),
    [second.inventory.filter((i) => i.side === 1 && i.values[0].includes('INV-1')).at(-1)!.pdf!.line],
  );
});

void test('the confirmed scope in two separate sections is a structure error; one section over two pages is not', async () => {
  const repeated = await compare(
    [
      page(
        top(),
        header(730),
        headings(670),
        invoice(655, 'INV-1'),
        header(630, { customer: 'C0002' }),
        headings(570),
        invoice(555, 'INV-9'),
        header(530),
        headings(470),
        invoice(455, 'INV-2'),
      ),
    ],
    [posted('L1', 'INV-1'), posted('L2', 'INV-2')],
  );
  assert.deepEqual(codes(repeated), ['AR_PDF_SCOPE_REPEATED']);
  assert.equal(repeated.status, 'source-error');
  assert.equal(repeated.statement.compared, null);
  assert.equal(repeated.rows.filter((r) => r.side === 1).length, 0);
  assert.deepEqual(
    repeated.cases.map((c) => c.reason),
    ['source-errors', 'source-errors'],
  );
  const refs = repeated.sourceIssues![0].inventoryIds;
  assert.deepEqual(
    refs.map((ref) => repeated.inventory.find((i) => i.inventoryId === ref)!.values[0]),
    ['Customer ID: C0001', 'Customer ID: C0001'],
  );
  assert.equal(repeated.totals[1], null);

  const one = page(top(), header(730), headings(670));
  const continued = await compare(
    [[...one, ...invoice(655, 'INV-1')], [...one, ...invoice(655, 'INV-2')]],
    [posted('L1', 'INV-1'), posted('L2', 'INV-2')],
  );
  assert.deepEqual(codes(continued), []);
  assert.equal(continued.status, 'matched');
  assert.deepEqual(continued.statement.sections[0].pages, [1, 2]);
  assert.deepEqual(continued.totals, [250000, 250000]);
});

void test('no section with the confirmed scope: nothing of the statement is compared', async () => {
  const r = await compare(
    [page(top(), header(730, { customer: 'C0002' }), headings(670), invoice(655, 'INV-1'))],
    [posted('L1', 'INV-1')],
  );
  assert.deepEqual(codes(r), ['AR_PDF_SCOPE_NOT_FOUND']);
  assert.equal(r.status, 'source-error');
  assert.deepEqual(members(r), [['source-errors', ['L1']]]);
  assert.deepEqual(r.sourceIssues![0].inventoryIds, []);
  assert.equal(r.statement.outOfScopeLines, 1);
});

void test('the document header must name the confirmed entity and ledger', async () => {
  for (const [entity, book, expected] of [
    ['Synthetic Seller Co', 'AR Book', []],
    ['Other Seller LLC', 'AR Book', ['AR_PDF_SCOPE_NOT_FOUND']],
    ['Synthetic Seller Co', 'Other Book', ['AR_PDF_SCOPE_NOT_FOUND']],
  ] as const) {
    const r = await compare(
      [page(top(entity, book), header(730), headings(670), invoice(655, 'INV-1'))],
      [posted('L1', 'INV-1')],
    );
    assert.deepEqual(codes(r), expected, `${entity} ${book}`);
    assert.equal(r.status, expected.length ? 'source-error' : 'matched');
  }
});

void test('every field of the section header must equal the confirmed scope', async () => {
  for (const [field, value] of [
    ['customer', 'C0003'],
    ['account', '1300'],
    ['currency', 'USD'],
    ['period', '2026-09-01 to 2026-09-29'],
    ['period', '2026-08-31 to 2026-09-30'],
  ]) {
    const r = await compare(
      [page(top(), header(730, { [field]: value }), headings(670), invoice(655, 'INV-1'))],
      [posted('L1', 'INV-1')],
    );
    assert.deepEqual(codes(r), ['AR_PDF_SCOPE_NOT_FOUND'], `${field} ${value}`);
    assert.equal(r.cases.filter((c) => c.status === 'matched').length, 0);
  }
});

void test('an error in the section of another customer blocks the whole pair', async () => {
  const clean = await compare([twoCustomers('INV-9')], [posted('L1', 'INV-1')]);
  assert.equal(clean.status, 'matched');
  const broken = await compare(
    [
      page(
        top(),
        header(730),
        headings(670),
        invoice(655, 'INV-1'),
        header(630, { customer: 'C0002' }),
        headings(570),
        invoice(555, 'INV-9', '12,50,0.00'),
      ),
    ],
    [posted('L1', 'INV-1')],
  );
  assert.deepEqual(codes(broken), ['AR_AMOUNT']);
  assert.equal(broken.status, 'source-error');
  assert.deepEqual(members(broken), [
    ['source-errors', ['L1', `p1:${lineOf(broken, 'INV-1')}`]],
  ]);
});

void test('an unreadable header is its own error, never a missing scope, and its lines join it', async () => {
  const partial = (y: number, customer: string) => [
    ...text(y, `Customer ID: ${customer}`),
    ...text(y - 12, 'Account: 1200'),
    ...text(y - 24, 'Period: 2026-09-01 to 2026-09-30'),
  ];
  const absent = await compare(
    [page(top(), partial(730, 'C0002'), headings(670), invoice(655, 'INV-1'))],
    [posted('L1', 'INV-1')],
  );
  assert.deepEqual(codes(absent), ['AR_PDF_HEADER']);

  const beside = await compare(
    [
      page(
        top(),
        header(730),
        headings(670),
        invoice(655, 'INV-1'),
        partial(630, 'C0002'),
        headings(570),
        invoice(555, 'INV-9'),
        invoice(540, 'INV-8'),
      ),
    ],
    [posted('L1', 'INV-1')],
  );
  assert.deepEqual(codes(beside), ['AR_PDF_HEADER']);
  assert.equal(beside.status, 'source-error');
  assert.equal(beside.statement.compared, 0);
  assert.deepEqual(
    beside.sourceIssues![0].inventoryIds.map(
      (ref) => beside.inventory.find((i) => i.inventoryId === ref)!.values[0],
    ),
    ['Customer ID: C0002', ...['INV-9', 'INV-8'].map((d) => `2026-09-02 invoice ${d} 1,250.00 1,250.00`)],
  );
});

void test('decisions bind to this statement reading', async () => {
  const rows = [posted('L1', 'INV-1')];
  const pages = [page(top(), header(730), headings(670), invoice(655, 'INV-1'))];
  const r = await compare(pages, rows);
  const ids = r.cases[0].ids;
  const event = (context: string, action: 'accept' | 'reopen') => ({
    context,
    at: '2026-10-27T08:00:00.000Z',
    action,
    ids,
    note: 'Reviewed against the printed statement',
  });
  const reopened = await compare(pages, rows, { events: [event(r.context, 'reopen')] });
  assert.deepEqual(
    reopened.cases.map((c) => [c.status, c.reason]),
    [['review', 'reopened']],
  );
  // The same decision against another statement's bytes is refused.
  await assert.rejects(
    compare(pages, rows, { events: [event(r.context, 'reopen')], sha: 'b'.repeat(64) }),
    /AR_DECISION/,
  );
  // A blocked pair cannot be accepted by hand.
  const blocked = await compare(
    [page(top(), header(730), headings(670), invoice(655, 'INV-1'), invoice(640, 'INV-7', '0.00'))],
    rows,
  );
  assert.equal(blocked.status, 'source-error');
  await assert.rejects(
    compare(
      [page(top(), header(730), headings(670), invoice(655, 'INV-1'), invoice(640, 'INV-7', '0.00'))],
      rows,
      { events: [{ ...event(blocked.context, 'accept'), ids: blocked.cases.find((c) => c.document === 'INV-1')!.ids }] },
    ),
    /AR_DECISION/,
  );
});

void test('the statement reading must be the one made from these bytes, and confirmed', async () => {
  const reading = readArStatementPdf(
    source([page(top(), header(730), headings(670), invoice(655, 'INV-1'))], SHA),
  );
  const file = await ledger([posted('L1', 'INV-1')]);
  const input = () => ({
    files: [file, { kind: 'ar-statement-pdf' as const, name: 'statement.pdf', sha256: SHA, reading }] as [
      typeof file,
      { kind: 'ar-statement-pdf'; name: string; sha256: string; reading: typeof reading },
    ],
    readings: [ledgerReading, statementReading] as [ArLegacyReading, ArStatementPdfReading],
    scope: SCOPE,
    events: [],
  });
  assert.equal(reconcileArStatement(input()).status, 'matched');
  const other = input();
  other.files[1] = { ...other.files[1], sha256: 'c'.repeat(64) };
  assert.throws(() => reconcileArStatement(other), /AR_SOURCE/);
  const unconfirmed = input();
  unconfirmed.readings[1] = { ...statementReading, confirmed: false };
  assert.throws(() => reconcileArStatement(unconfirmed), /AR_READING/);
  const buyer = input();
  buyer.readings[1] = { ...statementReading, perspective: 'buyer-payable' as never };
  assert.throws(() => reconcileArStatement(buyer), /AR_READING/);
  const notLedger = input();
  (notLedger.readings as unknown[])[0] = { ...ledgerReading, family: 'ar-scope-details-1' };
  assert.throws(() => reconcileArStatement(notLedger), /AR_READING/);
});

void test('an unconfirmed scope keeps every printed line, as an error', async () => {
  const pages = [page(top(), header(730), headings(670), invoice(655, 'INV-1'))];
  const r = await compare(pages, [posted('L1', 'INV-1')], { scope: { confirmed: false } as never });
  assert.equal(r.version, 'ar-statement-pdf-1');
  assert.equal(r.status, 'source-error');
  const printed = r.inventory.filter((i) => i.side === 1);
  assert.equal(printed.length, readArStatementPdf(source(pages, SHA)).lines.length);
  assert.ok(printed.every((i) => i.kind === 'error' && i.error === 'AR_SCOPE'));
});
