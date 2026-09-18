import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSource,
  parseMoney,
  repeatedPageMetadataRows,
} from '../lib/reconciliation/core.ts';
import { suggestFormats } from '../lib/reconciliation/format-inference.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../lib/reconciliation/types.ts';

// A statement reprints its banner above the table on every page. PDF.js splits
// that banner into text items, and a fragment past the first column boundary
// lands in the date column (the C01436 diagnosis). The banner is structural, so
// the normalizer excludes it; format inference has to agree, or the statement
// looks unprovable and the app falls back to a default format.
const crossesColumn =
  'نص يعبر حد عمود؛ عدّل حدود أعمدة PDF دون تقسيم الرقم أو المرجع';
const bannerReason =
  'بيانات رأس صفحة متكررة حرفيًا قبل عنوان الجدول المطابق — محفوظة في المصدر';
const scope: Scope = {
  supplier: 'Cedar Trading',
  entity: 'North Distribution',
  account: 'AP-231',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-07-31',
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: true,
};
const mapping: Mapping = {
  ...defaultMapping(),
  header: 4,
  reference: 0,
  date: 1,
  description: 2,
  amount: 3,
  pdfReviewed: true,
};
/** The app normalizes with the proven formats, never with a silent default. */
const read = (file: SourceFile, decimals: Scope['decimals'] = scope.decimals) =>
  normalizeSource(
    file,
    { ...mapping, ...suggestFormats(file, mapping, decimals).patch },
    { ...scope, decimals },
    'supplier',
  );
const banner = (currency = 'SAR') => [
  ['Cedar Trading - Transaction', 'statement', '', ''],
  [
    `Currency: ${currency} Account:`,
    'AP-231 Entity: North Distribution',
    '',
    '',
  ],
  ['Period: 2026-07-01 to', '2026-07-31', '', ''],
  ['Positive amount increases', 'the payable to the supplier', '', ''],
];
const header = ['Reference', 'Date', 'Description', 'Amount'];
const page1 = [
  ['INV-1', '25/07/2026', 'Invoice goods supplied', '839.47'],
  ['PAY-2', '13/07/2026', 'Payment bank transfer', '-581.30'],
];
const page2 = [['INV-3', '20/07/2026', 'Invoice goods supplied', '906.51']];

/** Two printed pages of one statement, with the banner repeated verbatim.
 * `bannerIssues` mirrors what layoutPdfPage records for a title that spans the
 * table: a boundary-crossing note, which is expected and not damage. */
function statement(
  options: {
    secondBanner?: string[][];
    bannerIssues?: string[];
    extraPage2Rows?: string[][];
    repeatHeaderOnPage2?: boolean;
  } = {},
): SourceFile {
  const second = options.secondBanner ?? banner();
  // Every fixture owns its cells: a test that edits an amount must not reach
  // into the next test's statement.
  const rows = [
    ...banner(),
    header,
    ...page1,
    ['Page 1', '', '', ''],
    ...second,
    ...(options.repeatHeaderOnPage2 === false ? [] : [header]),
    ...page2,
    ...(options.extraPage2Rows ?? []),
    ['Page 2', '', '', ''],
  ].map((row) => [...row]);
  const firstPageRows = banner().length + 1 + page1.length + 1;
  const rowIssues: Record<string, string[]> = {};
  const issues = options.bannerIssues ?? [crossesColumn];
  // The banner crosses a column boundary on both printed pages, never only one.
  for (const start of [0, firstPageRows])
    for (let i = 0; i < second.length; i++)
      if (start > 0 || i < banner().length)
        rowIssues[String(start + i + 1)] = [...issues];
  return {
    name: 'supplier-statement.pdf',
    pdf: { cuts: [16.5, 34.6, 50.3, 75.7], pages: 2, autoColumns: true },
    sheets: [
      {
        name: 'PDF',
        rows,
        formulaRows: [],
        hiddenRows: [],
        rowIssues,
        rowPages: Object.fromEntries(
          rows.map((_, i) => [String(i + 1), i < firstPageRows ? 1 : 2]),
        ),
      },
    ],
  };
}

test('046 a repeated page banner no longer blocks the format proof (C01436)', () => {
  const file = statement();
  // The defect it reproduces: "statement" from the page-2 title in the date column.
  assert.equal(file.sheets[0].rows[8][1], 'statement');
  assert.equal(file.sheets[0].rowPages!['9'], 2);
  const formats = suggestFormats(file, mapping, scope.decimals);
  assert.equal(formats.dateFormat.status, 'proven');
  assert.deepEqual(formats.dateFormat.candidates, ['dmy']);
  assert.equal(formats.patch.dateFormat, 'dmy');
  assert.equal(formats.numberFormat.status, 'proven');
  // Three printed movements, not the banner rows, are the evidence.
  assert.equal(formats.dateFormat.checkedValues, 3);
});

test('046 inference and the normalizer classify the same banner rows', () => {
  const file = statement();
  const marked = repeatedPageMetadataRows(file, file.sheets[0], mapping);
  assert.deepEqual(
    [...marked].sort((a, b) => a - b),
    [9, 10, 11, 12],
  );
  const result = read(file);
  for (const row of marked) {
    const excluded = result.excluded.find((e) => e.row === row);
    assert.ok(excluded, `row ${row} must be excluded, not read as a movement`);
    assert.equal(excluded!.reason, bannerReason);
  }
  assert.equal(result.errors.length, 0);
  assert.equal(result.transactions.length, 3);
});

test('046 no movement is deleted while the banner and footer are cleaned', () => {
  const file = statement();
  const result = read(file);
  assert.deepEqual(
    result.transactions.map((t) => t.reference),
    ['INV-1', 'PAY-2', 'INV-3'],
  );
  // Every source row keeps a decided fate: movement, or a recorded exclusion.
  const decided = new Set([
    ...result.transactions.map((t) => t.row),
    ...result.excluded.map((e) => e.row),
    ...result.errors.map((e) => e.row),
  ]);
  for (let row = 1; row <= file.sheets[0].rows.length; row++)
    assert.ok(decided.has(row), `row ${row} vanished from the extraction`);
});

test('046 a banner-shaped row carrying a movement stays a movement', () => {
  // Counter-case: same text as the banner's first line, but with a date and an
  // amount on it. An amount/identity pair is never page furniture.
  const file = statement({
    secondBanner: [
      ['Cedar Trading - Transaction', '18/07/2026', 'statement fee', '12.50'],
      ...banner().slice(1),
    ],
    bannerIssues: [crossesColumn],
  });
  const marked = repeatedPageMetadataRows(file, file.sheets[0], mapping);
  assert.ok(!marked.has(9), 'a dated, priced row must not be read as a banner');
  const result = read(file);
  assert.ok(
    result.transactions.some((t) => t.row === 9 && t.amount === 1250) ||
      result.errors.some((e) => e.row === 9),
    'the row must be read or reported, never silently dropped',
  );
});

test('046 a banner that is not repeated verbatim is not treated as one', () => {
  const file = statement({
    secondBanner: [
      ['Cedar Trading - Transaction', 'statement (continued)', '', ''],
      ...banner().slice(1),
    ],
  });
  assert.ok(!repeatedPageMetadataRows(file, file.sheets[0], mapping).has(9));
  const changedCurrency = statement({ secondBanner: banner('KWD') });
  assert.ok(
    !repeatedPageMetadataRows(
      changedCurrency,
      changedCurrency.sheets[0],
      mapping,
    ).has(10),
    'a banner line whose currency changed is evidence, not furniture',
  );
});

test('046 without a repeated table header the page prefix is not structural', () => {
  const file = statement({ repeatHeaderOnPage2: false });
  assert.equal(repeatedPageMetadataRows(file, file.sheets[0], mapping).size, 0);
  assert.equal(
    suggestFormats(file, mapping, scope.decimals).dateFormat.status,
    'invalid',
    'an unexplained page prefix must keep the source in review',
  );
});

test('046 a damaged banner row still stops the format proof', () => {
  // Only the boundary-crossing note is expected furniture. Overlapping text is
  // real damage, so the proof must not quietly step over the row.
  const file = statement({
    bannerIssues: [
      crossesColumn,
      'تتداخل نصوص من صفوف متجاورة، لذلك لا يمكن التحقق من صحة القراءة.',
    ],
  });
  assert.ok(repeatedPageMetadataRows(file, file.sheets[0], mapping).has(9));
  const formats = suggestFormats(file, mapping, scope.decimals);
  assert.equal(formats.dateFormat.status, 'invalid');
  assert.equal(formats.numberFormat.status, 'invalid');
  const result = read(file);
  assert.ok(
    result.errors.some((e) => e.row === 9),
    'the damaged row must be reported rather than excluded as a banner',
  );
});

test('046 an amount landing in the neighbouring reference keeps the source in review', () => {
  // Column drift: page 2 repeats the banner, but a movement's amount is read
  // into the reference cell. The proof must not report a clean statement.
  const file = statement({
    extraPage2Rows: [
      ['INV-4 451.00', '21/07/2026', 'Invoice goods supplied', ''],
    ],
  });
  const row = file.sheets[0].rows.length - 1;
  file.sheets[0].rowIssues![String(row)] = [
    crossesColumn,
    'توجد نصوص متداخلة، لذلك لا يمكن التحقق من صحة القراءة.',
  ];
  const formats = suggestFormats(file, mapping, scope.decimals);
  assert.equal(formats.numberFormat.status, 'invalid');
  assert.match(formats.numberFormat.reason, new RegExp(String(row)));
});

test('046 a thousand-fold separator reading is never proven silently', () => {
  // A three-decimal currency: 54.321 is 54 dinars 321 fils under a dot reading
  // and 54,321 dinars under a comma reading. Both parse the whole column, so the
  // choice stays with the accountant instead of defaulting a 1000x error in.
  const file = statement();
  const sheet = file.sheets[0];
  for (const [row, amount] of [
    [6, '839.469'],
    [7, '-581.300'],
    [14, '906.510'],
  ] as const)
    sheet.rows[row - 1][3] = amount;
  const formats = suggestFormats(file, mapping, 3);
  assert.equal(formats.numberFormat.status, 'ambiguous');
  assert.deepEqual(formats.numberFormat.candidates, ['dot', 'comma']);
  assert.equal(formats.patch.numberFormat, undefined);
  // The two readings differ by exactly a thousand, which is the damage avoided.
  assert.equal(
    parseMoney('839.469', 'comma', 3),
    parseMoney('839.469', 'dot', 3) * 1000,
  );
  // The date column of the same statement is still proven; one unprovable
  // column must not discard the evidence the rest of the source does carry.
  assert.equal(formats.dateFormat.status, 'proven');
});

test('046 a balance line is recognised before the number format is known', () => {
  // "Closing balance: -3,57" only parses under a comma reading, but the comma
  // reading is what this pass has to establish. Judging the line by the default
  // dot reading hides it, and the hidden line then invalidates its own column.
  const file = statement();
  const sheet = file.sheets[0];
  for (const [row, amount] of [
    [6, '839,47'],
    [7, '-581,30'],
    [14, '906,51'],
  ] as const)
    sheet.rows[row - 1][3] = amount;
  sheet.rows.splice(14, 0, ['Closing balance: -3,57', '', '', '']);
  sheet.rowPages!['15'] = 2;
  sheet.rowPages!['16'] = 2;
  const formats = suggestFormats(file, mapping, scope.decimals);
  assert.equal(formats.numberFormat.status, 'proven');
  assert.deepEqual(formats.numberFormat.candidates, ['comma']);
  assert.equal(formats.patch.numberFormat, 'comma');
  // The balance line is evidence about structure, never a movement.
  const result = read(file);
  assert.equal(result.transactions.length, 3);
  assert.ok(result.excluded.some((e) => e.row === 15));
});

test('046 a malformed balance amount is not excused by trying other readings', () => {
  // Counter-case: no supported reading parses "1.2.3", so the line stays a row
  // with a problem instead of being waved through as a balance line.
  const file = statement();
  const sheet = file.sheets[0];
  sheet.rows.splice(14, 0, ['Closing balance: 1.2.3', '', '', '']);
  sheet.rowPages!['15'] = 2;
  sheet.rowPages!['16'] = 2;
  const formats = suggestFormats(file, mapping, scope.decimals);
  assert.equal(formats.numberFormat.status, 'invalid');
  assert.match(
    formats.numberFormat.reason,
    /1\.2\.3|صيغ متعارضة|قيم غير صالحة/,
  );
});

test('046 a dated, referenced movement is never taken for a balance line', () => {
  // Counter-case for widening the reading: a row with its own date, reference
  // and amount has more than one cell, so no reading can classify it away.
  const file = statement();
  const sheet = file.sheets[0];
  sheet.rows.splice(14, 0, [
    'Closing balance',
    '19/07/2026',
    'Invoice goods supplied',
    '77,10',
  ]);
  sheet.rowPages!['15'] = 2;
  sheet.rowPages!['16'] = 2;
  const before = suggestFormats(file, mapping, scope.decimals);
  assert.notEqual(before.numberFormat.status, 'proven');
  const result = read(file);
  assert.ok(
    result.transactions.some((t) => t.row === 15) ||
      result.errors.some((e) => e.row === 15),
    'the row must be read or reported, never classified away',
  );
});
