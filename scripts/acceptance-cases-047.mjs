// Declared case set for the 0.4.7 acceptance round.
//
// What these are: 24 pairs composed for this round from layout combinations
// that did not guide the 0.4.7 fixes. The fixes were diagnosed on C01436,
// C01831 and C03087 and on the generator's comma-decimals scenario; none of
// those layouts is reproduced here.
//
// What these are NOT: a market sample, and not new producers. The writers are
// the ones this repository already uses (ExcelJS, the CSV and PDF helpers), so
// the round exercises new arrangements of known writers. A different seed alone
// would not make a case new, so every entry below differs in layout, not in
// random values.
import ExcelJS from 'exceljs';
import { syntheticPdf } from '../tests/helpers/pdf-fixture.ts';

const utf8 = (text) => Buffer.from(text, 'utf8');
const bom = (text) =>
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(text)]);
const csvType = 'text/csv';
const xlsxType =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbook(build) {
  const book = new ExcelJS.Workbook();
  build(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const money = (minor, decimals = 2) =>
  (minor / 10 ** decimals).toFixed(decimals);

/** A movement set shared by both sides of a pair, so the expected result is
 * arithmetic rather than a copied oracle. */
function movements(seedRefs) {
  return seedRefs.map(([reference, date, minor, kind]) => ({
    reference,
    date,
    minor,
    kind,
  }));
}
const base = movements([
  ['INV-7001', '2026-07-03', 125000, 'Invoice'],
  ['PAY-7002', '2026-07-09', -48000, 'Payment'],
  ['INV-7003', '2026-07-14', 96500, 'Invoice'],
  ['CN-7004', '2026-07-21', -17250, 'Credit Note'],
  ['INV-7005', '2026-07-27', 203400, 'Invoice'],
]);
const shortSet = base.slice(0, 3);
/** The same reference twice on a side, with different dates and equal amounts.
 * The product's rule refuses an automatic link for a reference that is not
 * unique on both sides, so these two copies must stay open on each side while
 * the four unique references still match. */
const duplicated = [...base, { ...base[0], date: '2026-07-05' }];
/** A three-decimal currency whose amounts read only one way. */
const kwd = base.map((m) => ({ ...m, minor: m.minor * 10 }));

const plainCsv = (
  rows,
  { delimiter = ',', quote = false, withBom = false } = {},
) => {
  const cell = (value) =>
    quote ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const text = rows.map((row) => row.map(cell).join(delimiter)).join('\n');
  return withBom ? bom(text) : utf8(text);
};
const table = (set, { header, row }) => [header, ...set.map(row)];
/** Rows the export must carry for one side, in source order, derived from the
 * movements the case was built from rather than from the app. */
const expectedRows = (set) =>
  set.map((m) => ({ reference: m.reference, date: m.date, minor: m.minor }));

/** The reference result for a pair, derived from the product's own rule for an
 * automatic 1:1 link (core.ts, EXACT_REFERENCE_SIGNED_AMOUNT_UNIQUE_V2): the
 * reference must be identical, the signed amount equal, the dates within the
 * window, and the reference UNIQUE on both sides. Anything else must stay for
 * review or without a counterpart -- never be linked to keep a count.
 *
 * It returns the links that must exist, links that must not, and the items that
 * must remain open, so swapping two links cannot pass on the count alone.
 */
function referenceResult(supplierSet, ledgerSet) {
  const count = (set, reference) =>
    set.filter((m) => m.reference === reference).length;
  const requiredLinks = [];
  const forbiddenLinks = [];
  const unmatched = [];
  for (const supplier of supplierSet) {
    const counterparts = ledgerSet.filter(
      (l) => l.reference === supplier.reference,
    );
    const unique =
      count(supplierSet, supplier.reference) === 1 && counterparts.length === 1;
    const equal = unique && counterparts[0].minor === supplier.minor;
    if (equal) requiredLinks.push([[supplier.reference], [supplier.reference]]);
    else if (unique && counterparts.length === 1)
      // Same reference, different signed amount: a counterpart exists, so this
      // is a variance to review, and linking it automatically is not allowed.
      forbiddenLinks.push([[supplier.reference], [supplier.reference]]);
    else if (!counterparts.length)
      // The export writes the transaction's own side value, not a display label.
      unmatched.push({ side: 'supplier', reference: supplier.reference });
    else
      // Duplicated on one side or both: the rule refuses it, so no link between
      // these copies may be accepted.
      forbiddenLinks.push([[supplier.reference], [supplier.reference]]);
  }
  for (const ledger of ledgerSet)
    if (!supplierSet.some((m) => m.reference === ledger.reference))
      unmatched.push({ side: 'ledger', reference: ledger.reference });
  return {
    supplierRows: expectedRows(supplierSet),
    ledgerRows: expectedRows(ledgerSet),
    requiredLinks,
    forbiddenLinks,
    unmatched,
  };
}

const english = {
  header: ['Date', 'Reference', 'Description', 'Amount'],
  row: (m) => [m.date, m.reference, `${m.kind} line`, money(m.minor)],
};
const reordered = {
  header: ['Reference', 'Description', 'Date', 'Amount'],
  row: (m) => [m.reference, `${m.kind} line`, m.date, money(m.minor)],
};
const arabic = {
  header: ['التاريخ', 'المرجع', 'البيان', 'المبلغ'],
  row: (m) => [m.date, m.reference, `سطر ${m.kind}`, money(m.minor)],
};
const splitColumns = {
  header: ['Date', 'Reference', 'Description', 'Debit', 'Credit'],
  row: (m) => [
    m.date,
    m.reference,
    `${m.kind} line`,
    m.minor > 0 ? money(m.minor) : '',
    m.minor < 0 ? money(-m.minor) : '',
  ],
};

async function sheetFile(
  set,
  shape,
  { name, sheetName = 'Movements', banner = [], trailing = [] } = {},
) {
  return {
    name,
    mimeType: xlsxType,
    buffer: await workbook((book) => {
      const sheet = book.addWorksheet(sheetName);
      for (const line of banner) sheet.addRow(line);
      for (const line of table(set, shape)) sheet.addRow(line);
      for (const line of trailing) sheet.addRow(line);
    }),
  };
}
const csvFile = (
  set,
  shape,
  { name, options = {}, banner = [], trailing = [] } = {},
) => ({
  name,
  mimeType: csvType,
  buffer: plainCsv([...banner, ...table(set, shape), ...trailing], options),
});
const pdfFile = (set, shape, { name, pages = 1 } = {}) => {
  const rows = table(set, shape);
  const body = rows.slice(1);
  const perPage = Math.ceil(body.length / pages);
  const sheets = [];
  for (let i = 0; i < pages; i++)
    sheets.push([rows[0], ...body.slice(i * perPage, (i + 1) * perPage)]);
  return {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(syntheticPdf(sheets)),
  };
};

/** Each case declares what makes it new, the scope facts printed on the source,
 * and the arithmetic the export must show. `expect` is the outcome class this
 * round is checking for, not an instruction to the app. */
export async function acceptanceCases() {
  const cases = [];
  const add = (entry) => cases.push(entry);
  const scope = { currency: 'SAR', cutoff: '2026-08-31' };

  add({
    id: 'A01',
    novelty: 'plain CSV both sides, English header order',
    supplier: csvFile(base, english, { name: 'a01-supplier.csv' }),
    ledger: csvFile(base, english, { name: 'a01-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A02',
    novelty: 'CSV with a UTF-8 BOM against a quoted CSV',
    supplier: csvFile(base, english, {
      name: 'a02-supplier.csv',
      options: { withBom: true },
    }),
    ledger: csvFile(base, english, {
      name: 'a02-ledger.csv',
      options: { quote: true },
    }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A03',
    novelty: 'semicolon-delimited CSV against a comma CSV',
    supplier: csvFile(base, english, {
      name: 'a03-supplier.csv',
      options: { delimiter: ';' },
    }),
    ledger: csvFile(base, english, { name: 'a03-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A04',
    novelty: 'reordered columns on the supplier side only',
    supplier: csvFile(base, reordered, { name: 'a04-supplier.csv' }),
    ledger: csvFile(base, english, { name: 'a04-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A05',
    novelty: 'Arabic headers against English headers',
    supplier: csvFile(base, arabic, { name: 'a05-supplier.csv' }),
    ledger: csvFile(base, english, { name: 'a05-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A06',
    novelty: 'debit/credit pair against a signed amount column',
    supplier: csvFile(base, splitColumns, { name: 'a06-supplier.csv' }),
    ledger: csvFile(base, english, { name: 'a06-ledger.csv' }),
    // Split columns with no balance chain: only the report's owner knows which
    // side increases the payable, so the app asks and the answer is recorded.
    scope,
    expect: 'completed',
    debitIncreases: true,
    expected: referenceResult(base, base),
  });
  add({
    id: 'A07',
    novelty: 'a banner above the table on the supplier side',
    supplier: csvFile(base, english, {
      name: 'a07-supplier.csv',
      banner: [['Cedar Trading statement'], ['Currency: SAR'], []],
    }),
    ledger: csvFile(base, english, { name: 'a07-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A08',
    novelty: 'a total line below the table on both sides',
    supplier: csvFile(base, english, {
      name: 'a08-supplier.csv',
      trailing: [
        ['Total', '', '', money(base.reduce((n, m) => n + m.minor, 0))],
      ],
    }),
    ledger: csvFile(base, english, {
      name: 'a08-ledger.csv',
      trailing: [
        ['Total', '', '', money(base.reduce((n, m) => n + m.minor, 0))],
      ],
    }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A09',
    novelty: 'XLSX against CSV',
    supplier: await sheetFile(base, english, { name: 'a09-supplier.xlsx' }),
    ledger: csvFile(base, english, { name: 'a09-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A10',
    novelty: 'XLSX both sides, different sheet names',
    supplier: await sheetFile(base, english, {
      name: 'a10-supplier.xlsx',
      sheetName: 'Statement',
    }),
    ledger: await sheetFile(base, english, {
      name: 'a10-ledger.xlsx',
      sheetName: 'AP Ledger',
    }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A11',
    novelty: 'XLSX with a banner and a trailing note',
    supplier: await sheetFile(base, english, {
      name: 'a11-supplier.xlsx',
      banner: [['Supplier statement'], []],
      trailing: [[], ['This statement contains the movements of the period.']],
    }),
    ledger: csvFile(base, english, { name: 'a11-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base),
  });
  add({
    id: 'A12',
    novelty: 'XLSX debit/credit against XLSX signed',
    supplier: await sheetFile(base, splitColumns, {
      name: 'a12-supplier.xlsx',
    }),
    ledger: await sheetFile(base, english, { name: 'a12-ledger.xlsx' }),
    scope,
    expect: 'completed',
    debitIncreases: true,
    expected: referenceResult(base, base),
  });
  add({
    id: 'A13',
    novelty: 'single-page PDF against CSV',
    supplier: pdfFile(shortSet, english, { name: 'a13-supplier.pdf' }),
    ledger: csvFile(shortSet, english, { name: 'a13-ledger.csv' }),
    scope,
    expect: 'completed',
    pdfReview: true,
    expected: referenceResult(shortSet, shortSet),
  });
  add({
    id: 'A14',
    novelty: 'two-page PDF with the header repeated on page two',
    supplier: pdfFile(base, english, { name: 'a14-supplier.pdf', pages: 2 }),
    ledger: csvFile(base, english, { name: 'a14-ledger.csv' }),
    scope,
    expect: 'completed',
    pdfReview: true,
    expected: referenceResult(base, base),
  });
  add({
    id: 'A15',
    novelty: 'PDF against XLSX',
    supplier: pdfFile(shortSet, english, { name: 'a15-supplier.pdf' }),
    ledger: await sheetFile(shortSet, english, { name: 'a15-ledger.xlsx' }),
    scope,
    expect: 'completed',
    pdfReview: true,
    expected: referenceResult(shortSet, shortSet),
  });
  add({
    id: 'A16',
    novelty: 'PDF with reordered columns',
    supplier: pdfFile(shortSet, reordered, { name: 'a16-supplier.pdf' }),
    ledger: csvFile(shortSet, english, { name: 'a16-ledger.csv' }),
    scope,
    expect: 'completed',
    pdfReview: true,
    expected: referenceResult(shortSet, shortSet),
  });
  add({
    id: 'A17',
    novelty: 'one movement missing from the ledger side',
    supplier: csvFile(base, english, { name: 'a17-supplier.csv' }),
    ledger: csvFile(base.slice(0, -1), english, { name: 'a17-ledger.csv' }),
    scope,
    expect: 'completed',
    expected: referenceResult(base, base.slice(0, -1)),
  });
  add({
    id: 'A18',
    novelty: 'one amount differs between the two sides',
    supplier: csvFile(base, english, { name: 'a18-supplier.csv' }),
    ledger: csvFile(
      base.map((m, i) => (i === 2 ? { ...m, minor: m.minor + 500 } : m)),
      english,
      { name: 'a18-ledger.csv' },
    ),
    scope,
    expect: 'completed',
    expected: referenceResult(
      base,
      base.map((m, i) => (i === 2 ? { ...m, minor: m.minor + 500 } : m)),
    ),
  });
  add({
    id: 'A19',
    novelty: 'a duplicate reference on both sides',
    supplier: csvFile([...base, { ...base[0], date: '2026-07-05' }], english, {
      name: 'a19-supplier.csv',
    }),
    ledger: csvFile([...base, { ...base[0], date: '2026-07-05' }], english, {
      name: 'a19-ledger.csv',
    }),
    scope,
    expect: 'completed',
    expected: referenceResult(duplicated, duplicated),
  });
  add({
    id: 'A20',
    novelty: 'three-decimal currency, unambiguous amounts',
    supplier: csvFile(
      base.map((m) => ({ ...m, minor: m.minor * 10 })),
      {
        header: english.header,
        row: (m) => [m.date, m.reference, `${m.kind} line`, money(m.minor, 3)],
      },
      { name: 'a20-supplier.csv' },
    ),
    ledger: csvFile(
      base.map((m) => ({ ...m, minor: m.minor * 10 })),
      {
        header: english.header,
        row: (m) => [m.date, m.reference, `${m.kind} line`, money(m.minor, 3)],
      },
      { name: 'a20-ledger.csv' },
    ),
    scope: { currency: 'KWD', cutoff: '2026-08-31' },
    expect: 'completed',
    decimals: 3,
    expected: referenceResult(kwd, kwd),
  });
  add({
    id: 'A21',
    novelty: 'three-decimal currency where every amount reads two ways',
    supplier: csvFile(
      [
        {
          reference: 'INV-8001',
          date: '2026-07-04',
          minor: 54321,
          kind: 'Invoice',
        },
        {
          reference: 'INV-8002',
          date: '2026-07-11',
          minor: 12500,
          kind: 'Invoice',
        },
      ],
      {
        header: english.header,
        row: (m) => [m.date, m.reference, `${m.kind} line`, money(m.minor, 3)],
      },
      { name: 'a21-supplier.csv' },
    ),
    ledger: csvFile(
      [
        {
          reference: 'INV-8001',
          date: '2026-07-04',
          minor: 54321,
          kind: 'Invoice',
        },
        {
          reference: 'INV-8002',
          date: '2026-07-11',
          minor: 12500,
          kind: 'Invoice',
        },
      ],
      {
        header: english.header,
        row: (m) => [m.date, m.reference, `${m.kind} line`, money(m.minor, 3)],
      },
      { name: 'a21-ledger.csv' },
    ),
    scope: { currency: 'KWD', cutoff: '2026-08-31' },
    expect: 'blocked-needs-format-choice',
    expectReason: /أكثر من قراءة/,
  });
  add({
    id: 'A22',
    novelty: 'a calendar-impossible date on the supplier side',
    supplier: csvFile([{ ...base[0], date: '2026-02-30' }, base[1]], english, {
      name: 'a22-supplier.csv',
    }),
    ledger: csvFile(base.slice(0, 2), english, { name: 'a22-ledger.csv' }),
    scope,
    expect: 'blocked-unreadable',
    expectReason: /تعذر التحقق من صيغة/,
  });
  add({
    id: 'A23',
    novelty: 'a supplier file with no movement rows at all',
    supplier: csvFile([], english, { name: 'a23-supplier.csv' }),
    ledger: csvFile(base, english, { name: 'a23-ledger.csv' }),
    scope,
    expect: 'blocked-unreadable',
    expectReason: /لا توجد حركات كافية/,
  });
  add({
    id: 'A24',
    novelty: 'a PDF page carrying no extractable text',
    supplier: {
      name: 'a24-supplier.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% not a readable statement\n'),
    },
    ledger: csvFile(base, english, { name: 'a24-ledger.csv' }),
    scope,
    expect: 'blocked-unreadable',
    expectReason: /confirm step disabled|PDF|نص/,
  });
  return cases;
}
