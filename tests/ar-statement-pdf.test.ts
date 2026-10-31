// AR-1 PDF A1: the customer statement reader, on token pages built here.
// Each near case differs from a passing one in one decisive fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readNativePdfWordSource } from '../lib/reconciliation/pdf.ts';
import {
  readArStatementPdf,
  ArStatementReadError,
} from '../lib/reconciliation/ar-statement-pdf.ts';
import {
  detail,
  header,
  headings,
  invoice as printed,
  line,
  page,
  source as pages,
  text,
  top,
  X,
  type Tokens,
} from './helpers/ar-statement-pages.ts';

const source = (...p: Tokens[]) => pages(p);
const invoice = (y: number, document = 'INV-1', amount = '1,250.00') =>
  printed(y, document, amount);
const codes = (r: ReturnType<typeof readArStatementPdf>) => r.errors.map((e) => e.code);

void test('a section continues only on a page that repeats its header in every field', () => {
  const first = page(top(), header(730), headings(670), invoice(655, 'INV-1'));
  const same = page(top(), header(730), headings(670), invoice(655, 'INV-2'));
  const renamed = page(top(), header(730, { name: 'Synthetic Buyer Ltd' }), headings(670), invoice(655, 'INV-2'));
  const one = readArStatementPdf(source(first, same));
  assert.equal(one.sections.length, 1);
  assert.deepEqual(one.sections[0].pages, [1, 2]);
  const two = readArStatementPdf(source(first, renamed));
  assert.equal(two.sections.length, 2);
  assert.deepEqual(two.sections.map((s) => s.scope?.customer), ['C0001', 'C0001']);
});

void test('a line takes its scope from its own section, never from the one before', () => {
  const r = readArStatementPdf(
    source(
      page(
        top(),
        header(730),
        headings(670),
        invoice(655, 'INV-1'),
        header(630, { currency: 'USD' }),
        headings(570),
        invoice(555, 'INV-2'),
      ),
    ),
  );
  const details = r.lines.filter((l) => l.kind === 'detail');
  assert.deepEqual(
    details.map((l) => [l.detail!.document, r.sections[l.section!].scope!.currency]),
    [
      ['INV-1', 'SAR'],
      ['INV-2', 'USD'],
    ],
  );
});

void test('a detail line before any section header is an orphan, and nothing is inherited', () => {
  const r = readArStatementPdf(source(page(top(), headings(730), invoice(715), header(690), headings(630), invoice(615, 'INV-2'))));
  assert.deepEqual(codes(r), ['AR_PDF_ORPHAN_LINE']);
  assert.equal(r.lines.filter((l) => l.kind === 'detail').length, 1);
});

void test('columns come from each section heading line, in its own order', () => {
  const swapped = page(
    top(),
    header(730),
    line(670, [
      [X.date, 'Type'],
      [X.type, 'Date'],
      [X.document, 'Document No'],
      [X.original, 'Original amount'],
    ]),
    line(655, [
      [X.date, 'receipt'],
      [X.type, '2026-09-03'],
      [X.document, 'RC-9'],
      [X.original, '-300.00'],
    ]),
  );
  const d = readArStatementPdf(source(swapped)).lines.find((l) => l.kind === 'detail')!.detail!;
  assert.deepEqual([d.kind, d.date, d.document, d.amount], ['receipt', '2026-09-03', 'RC-9', -30000]);
});

void test('a heading outside the vocabulary or a required heading missing refuses the columns', () => {
  for (const roles of [
    ['Date', 'Type', 'Document No', 'Original amount', 'Customer'],
    ['Date', 'Type', 'Document No', 'Balance'],
  ]) {
    const r = readArStatementPdf(source(page(top(), header(730), headings(670, roles), invoice(655))));
    assert.deepEqual(codes(r), ['AR_PDF_COLUMNS'], roles.join());
    assert.equal(r.lines.filter((l) => l.kind === 'detail').length, 0);
  }
});

void test('a header without one of its four fields is refused, and its lines are not read', () => {
  const r = readArStatementPdf(
    source(page(top(), text(730, 'Customer ID: C0001'), text(718, 'Account: 1200'), text(706, 'Period: 2026-09-01 to 2026-09-30'), headings(670), invoice(655))),
  );
  assert.deepEqual(codes(r), ['AR_PDF_HEADER']);
  assert.equal(r.sections[0].scope, null);
  assert.equal(r.lines.filter((l) => l.kind === 'detail').length, 0);
});

void test('another entity on a later page is a document header error', () => {
  const p = page(top(), header(730), headings(670), invoice(655));
  const r = readArStatementPdf(source(p, page(top('Other Seller LLC'), header(730), headings(670), invoice(655, 'INV-2'))));
  assert.deepEqual(codes(r), ['AR_PDF_DOCUMENT_HEADER']);
  assert.equal(r.document.entity, 'Synthetic Seller Co');
});

void test('a left-to-right line ending in a label is not a label', () => {
  const r = readArStatementPdf(source(page(top(), header(730), headings(670), invoice(655), text(640, 'AR Book :Ledger'))));
  assert.deepEqual(codes(r), ['AR_PDF_LINE']);
  assert.equal(r.document.ledger, 'AR Book');
  assert.equal(r.lines.at(-1)!.kind, 'error');
});

void test('amounts: the sign must suit the type, the decimals the currency', () => {
  const cases: [string, string, string | null][] = [
    ['SAR', '1,250.00', null],
    ['SAR', '-1,250.00', 'AR_DIRECTION'],
    ['SAR', '1,250.000', 'AR_AMOUNT'],
    ['SAR', '1,25,0.00', 'AR_AMOUNT'],
    ['SAR', '0.00', 'AR_AMOUNT'],
    ['KWD', '1,250.000', null],
    ['JPY', '1,250', null],
  ];
  for (const [currency, amount, code] of cases) {
    const r = readArStatementPdf(source(page(top(), header(730, { currency }), headings(670), invoice(655, 'INV-1', amount))));
    assert.deepEqual(codes(r), code ? [code] : [], `${currency} ${amount}`);
  }
});

void test('a value outside every column is a line error, not dropped', () => {
  // Left of the first column: no column holds it.
  const r = readArStatementPdf(source(page(top(), header(730), headings(670), [...invoice(655), ...line(655, [[5, 'X']])])));
  assert.deepEqual(codes(r), ['AR_PDF_LINE']);
  assert.equal(r.lines.find((l) => l.page === 1 && l.kind === 'error')?.code, 'AR_PDF_LINE');
});

void test('a reading issue in the source stops the reading', () => {
  const s = source(page(top(), header(730), headings(670), invoice(655)));
  (s as { readingIssues: unknown[] }).readingIssues = [{ page: 1, line: 9, reasons: ['overlap'] }];
  assert.throws(() => readArStatementPdf(s), (e) => e instanceof ArStatementReadError && e.code === 'READING');
});

void test('the Arabic sealed statement reads its value-first label and its Arabic-Indic digits', async () => {
  const bytes = await readFile(new URL('../audit/ar-statement-foundation/frozen/A12-statement.pdf', import.meta.url));
  const r = readArStatementPdf(await readNativePdfWordSource(Uint8Array.from(bytes).buffer));
  assert.equal(r.layout, 'ar');
  assert.deepEqual(r.document, { entity: 'Synthetic Seller Co', ledger: 'AR Book' });
  assert.deepEqual(r.sections[0].scope, {
    customer: 'C0001',
    account: '1200',
    currency: 'SAR',
    start: '2026-09-01',
    end: '2026-09-30',
  });
  const first = r.lines.find((l) => l.kind === 'detail')!.detail!;
  assert.deepEqual([first.kind, first.document, first.date, first.amount], ['invoice', 'INV-1001', '2026-09-02', 125000]);
  const cn = r.lines.find((l) => l.detail?.document === 'CN-71')!.detail!;
  assert.deepEqual([cn.kind, cn.amount], ['credit-note', -12000]);
});

void test('a date outside its section period, and a header that prints a field twice', () => {
  const late = readArStatementPdf(
    source(page(top(), header(730), headings(670), detail(655, ['2026-10-01', 'invoice', 'INV-1', '1.00', '1.00']))),
  );
  assert.deepEqual(codes(late), ['AR_PERIOD']);
  const twice = readArStatementPdf(
    source(page(top(), header(730), text(670, 'Currency: USD'), headings(650), invoice(635))),
  );
  assert.deepEqual(codes(twice), ['AR_PDF_HEADER']);
});

// Right-to-left pages for the A5 causes: Arabic words in right-to-left
// tokens placed from the right, Latin values in left-to-right ones.
const rtl = (y: number, cells: [x1: number, text: string, width?: number, direction?: string][]) =>
  cells.map(([x1, value, width = value.length * 5, direction]) => ({
    text: value,
    x: x1 - width,
    y,
    width,
    height: 9,
    item: 0,
    direction: direction ?? (/[\p{Script=Arabic}٠-٩]/u.test(value) ? 'rtl' : 'ltr'),
  }));
const arTop = () => [
  ...rtl(780, [[560, 'كشف حساب']]),
  ...rtl(766, [[560, 'Synthetic Seller Co :صادر عن', 140, 'rtl']]),
  ...rtl(754, [[560, 'AR Book :الدفتر', 80, 'rtl']]),
];
const arHeader = (period = '٢٠٢٦-٠٩-٠١ إلى ٢٠٢٦-٠٩-٣٠') => [
  ...rtl(730, [[560, 'C0001 :رقم العميل', 90, 'rtl']]),
  ...rtl(718, [[560, '١٢٠٠ :الحساب', 70, 'rtl']]),
  ...rtl(706, [[560, 'SAR :العملة', 60, 'rtl']]),
  ...rtl(694, [[560, `الفترة: ${period}`, 160, 'rtl']]),
];
// Amount headings end-aligned (left in a right-to-left table), the balance
// heading narrower than the amounts under it.
const arHeadings = (y: number) =>
  rtl(y, [
    [560, 'التاريخ'],
    [470, 'النوع'],
    [400, 'رقم المستند'],
    [265, 'المبلغ الأصلي', 65],
    [117, 'الرصيد', 17],
  ]);

void test('a period that ends before it starts proves no scope, in either layout', () => {
  const en = (period: string) =>
    readArStatementPdf(source(page(top(), header(730, { period }), headings(670), invoice(655))));
  assert.deepEqual(codes(en('2026-09-30 to 2026-09-01')), ['AR_PDF_HEADER']);
  assert.equal(en('2026-09-30 to 2026-09-01').sections[0].scope, null);
  assert.deepEqual(en('2026-09-01 to 2026-09-30').sections[0].scope?.start, '2026-09-01');
  const ar = (period: string) => readArStatementPdf(source(page(arTop(), arHeader(period), arHeadings(670))));
  assert.equal(ar('٢٠٢٦-٠٩-٠١ إلى ٢٠٢٦-٠٩-٣٠').layout, 'ar');
  assert.deepEqual(
    [ar('٢٠٢٦-٠٩-٠١ إلى ٢٠٢٦-٠٩-٣٠').sections[0].scope?.start, ar('٢٠٢٦-٠٩-٠١ إلى ٢٠٢٦-٠٩-٣٠').sections[0].scope?.end],
    ['2026-09-01', '2026-09-30'],
  );
  assert.deepEqual(codes(ar('٢٠٢٦-٠٩-٣٠ إلى ٢٠٢٦-٠٩-٠١')), ['AR_PDF_HEADER']);
});

void test('a minus set apart on the reading side of its amount is read with it, in a right-to-left table', () => {
  // The digits start under their end-aligned heading; the minus, a run of
  // its own touching them on the right, lies beyond the narrow heading:
  // in no column (as in A5 B08), or where the next column starts.
  const receipt = (balance: [x1: number, text: string, width?: number, direction?: string][]) =>
    readArStatementPdf(
      source(
        page(
          arTop(),
          arHeader(),
          arHeadings(670),
          rtl(655, [
            [560, '٢٠٢٦-٠٩-٠٣', 50, 'rtl'],
            [470, 'قبض'],
            [400, 'RC-9'],
            [230, '٣٠٠٫٠٠', 30],
            [233.1, '-', 3, 'ltr'],
            ...balance,
          ]),
        ),
      ),
    );
  const detail = (r: ReturnType<typeof readArStatementPdf>) => r.lines.find((l) => l.kind === 'detail')?.detail;
  for (const balance of [
    [[117.1, '٣٠٠٫٠٠', 17.1], [120.35, '-', 3, 'ltr']],
    [[130, '٣٠٠٫٠٠', 30], [133.1, '-', 3, 'ltr']],
  ] as [number, string, number?, string?][][]) {
    const read = receipt(balance);
    assert.deepEqual(codes(read), [], JSON.stringify(balance));
    assert.deepEqual([detail(read)?.amount, detail(read)?.balanceText], [-30000, '-٣٠٠٫٠٠']);
  }
  // Near cases: a minus clear of the number is not its sign, and stays where
  // it falls; a minus on the other side of the digits reads after them.
  assert.deepEqual(codes(receipt([[130, '٣٠٠٫٠٠', 30], [136, '-', 3, 'ltr']])), ['AR_AMOUNT']);
  const after = receipt([[130, '٣٠٠٫٠٠', 30], [99.9, '-', 3, 'ltr']]);
  assert.deepEqual([codes(after), detail(after)?.balanceText], [[], '٣٠٠٫٠٠-']);
  // Even where a minus on the far side falls in the next column, it is not
  // taken as the sign of the amount it touches.
  const invoice = readArStatementPdf(
    source(
      page(
        arTop(),
        arHeader(),
        arHeadings(670),
        rtl(655, [
          [560, '٢٠٢٦-٠٩-٠٣', 50, 'rtl'],
          [470, 'فاتورة'],
          [400, 'INV-9'],
          [148.5, '٣٠٠٫٠٠', 30],
          [118.4, '-', 3, 'ltr'],
        ]),
      ),
    ),
  );
  assert.deepEqual([codes(invoice), detail(invoice)?.amount], [[], 30000]);
});
