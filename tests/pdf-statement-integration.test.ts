import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, exportWorkbook } from '../lib/reconciliation/io.ts';
import { saveSession, restoreSession } from '../lib/reconciliation/session.ts';
import ExcelJS from 'exceljs';
import { normalizeSource, compare } from '../lib/reconciliation/core.ts';
import { defaultMapping } from '../lib/reconciliation/types.ts';
import type {
  Scope,
  Mapping,
  SourceFile,
} from '../lib/reconciliation/types.ts';

const headings = [
  'Posting Date',
  'Invoice Date',
  'Doc Type',
  'AP Voucher',
  'Supplier Ref',
  'PO / Bank Ref',
  'Description',
  'Debit (SAR)',
  'Credit (SAR)',
  'Running AP Balance',
];
const movements = [
  [
    '03-Apr-2026',
    '01-Apr-2026',
    'AP Invoice',
    'SYN-V17',
    'SYN-I17',
    'SYN-PO8',
    'Synthetic goods',
    '0.00',
    '125.75',
    '625.75',
  ],
  [
    '08-Apr-2026',
    '07-Apr-2026',
    'AP Credit Memo',
    'SYN-V18',
    'SYN-C18',
    'SYN-PO8',
    'Synthetic return',
    '25.50',
    '0.00',
    '600.25',
  ],
  [
    '19-Apr-2026',
    '17-Apr-2026',
    'AP Invoice',
    'SYN-V19',
    'SYN-I19',
    'SYN-PO9',
    'Synthetic goods',
    '0.00',
    '300.10',
    '900.35',
  ],
];

// Independently authored PDF bytes, never copied from a user's statement.
function wrappedHeaderPdf(
  pages: string[][][] = [movements],
  font: 'Helvetica' | 'Courier' = 'Helvetica',
): ArrayBuffer {
  const x = [20, 110, 200, 290, 380, 470, 560, 730, 820, 910];
  const text = (value: string, left: number, baseline: number) =>
    `BT /F1 8 Tf 1 0 0 1 ${left} ${baseline} Tm (${value.replace(/[\\()]/g, (character) => '\\' + character)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`,
  ];
  const kids: number[] = [];
  pages.forEach((rows, pageIndex) => {
    const pageId = objects.length + 1;
    kids.push(pageId);
    const stream = [
      text(`Synthetic AP report ${pageIndex + 1}`, 20, 750),
      ...headings
        .slice(0, 9)
        .map((heading, column) => text(heading, x[column], 700)),
      text('Running AP', x[9], 704.8),
      text('Balance', x[9] + 6, 695.2),
      ...rows.flatMap((row, index) =>
        row.map((value, column) => text(value, x[column], 675 - index * 22)),
      ),
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let output = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output).buffer;
}

const scope: Scope = {
  supplier: 'Synthetic Supplier',
  entity: 'Synthetic Buyer',
  account: 'SYN-1',
  currency: 'SAR',
  decimals: 2,
  cutoff: '2026-04-30',
  dateWindow: 0,
  confirmed: true,
  coverageConfirmed: false,
};
const mapping = () => ({
  ...defaultMapping(),
  header: 1,
  date: 0,
  reference: 4,
  description: 6,
  debit: 7,
  credit: 8,
  mode: 'split' as const,
  multiplier: -1 as const,
  pdfReviewed: true,
});

for (const font of ['Helvetica', 'Courier'] as const) {
  test(`${font}: real PDF bytes with a three-line AP header retain all ten columns and every movement`, async () => {
    const bytes = wrappedHeaderPdf(undefined, font);
    const file = await readFile('synthetic-ap.pdf', bytes, [], true);
    const sheet = file.sheets[0];
    assert.equal(file.pdf?.autoColumns, true);
    assert.equal(file.pdf?.cuts.length, 9);
    assert.equal(sheet.rows.length, 5);
    assert.deepEqual(sheet.rows[1], headings);
    assert.deepEqual(sheet.rows.slice(2), movements);
    assert.deepEqual(new Uint8Array(file.original!), new Uint8Array(bytes));
    assert.equal(sheet.pdfHeaderFragments?.['2']?.length, 3);
    assert.equal(sheet.pdfHeaderFragments!['2'][0][9], 'Running AP');
    assert.equal(sheet.pdfHeaderFragments!['2'][2][9], 'Balance');
    assert.deepEqual(
      sheet.pdfHeaderFragments!['2'][1].slice(0, 9),
      headings.slice(0, 9),
    );
    for (let row = 2; row <= 5; row++) {
      assert.equal(sheet.rowIssues?.[String(row)], undefined);
      assert.equal(sheet.rowPages?.[String(row)], 1);
    }
    const result = normalizeSource(file, mapping(), scope, 'ledger');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.transactions.map((item) => [
        item.row,
        item.sourcePage,
        item.date,
        item.reference,
        item.amount,
      ]),
      [
        [3, 1, '2026-04-03', 'SYN-I17', 12575],
        [4, 1, '2026-04-08', 'SYN-C18', -2550],
        [5, 1, '2026-04-19', 'SYN-I19', 30010],
      ],
    );
    assert.equal(result.total, 40035);
  });

  test(`${font}: explicit-cut re-read used during export exactly reproduces automatic PDF extraction and accounting provenance`, async () => {
    const initial = await readFile(
      'synthetic-ap.pdf',
      wrappedHeaderPdf(undefined, font),
      [],
      true,
    );
    const reread = await readFile(
      initial.name,
      initial.original!,
      initial.pdf!.cuts,
    );
    assert.deepEqual(reread.sheets, initial.sheets);
    assert.equal(reread.sha256, initial.sha256);
    assert.deepEqual(reread.pdf?.cuts, initial.pdf?.cuts);
    assert.equal(reread.pdf?.autoColumns, undefined);
    assert.deepEqual(
      normalizeSource(reread, mapping(), scope, 'ledger'),
      normalizeSource(initial, mapping(), scope, 'ledger'),
    );
  });

  test(`${font}: multiple PDF pages keep their repeated logical headers, original fragments and exact movement page lineage`, async () => {
    const initial = await readFile(
      'synthetic-ap-two-pages.pdf',
      wrappedHeaderPdf([movements.slice(0, 2), movements.slice(2)], font),
      [],
      true,
    );
    const sheet = initial.sheets[0];
    assert.equal(initial.pdf?.pages, 2);
    assert.equal(initial.pdf?.cuts.length, 9);
    assert.equal(sheet.rows.length, 7);
    assert.deepEqual(sheet.rows[1], headings);
    assert.deepEqual(sheet.rows[5], headings);
    assert.deepEqual([sheet.rows[2], sheet.rows[3], sheet.rows[6]], movements);
    assert.deepEqual(Object.keys(sheet.pdfHeaderFragments ?? {}), ['2', '6']);
    assert.equal(sheet.rowPages?.['3'], 1);
    assert.equal(sheet.rowPages?.['4'], 1);
    assert.equal(sheet.rowPages?.['7'], 2);
    // Header/title exclusions are explicit and auditable; movement rows are never excluded.
    const selected = {
      ...mapping(),
      excluded: {
        '5': 'Reviewed second-page report title',
        '6': 'Reviewed repeated header',
      },
    };
    const result = normalizeSource(initial, selected, scope, 'ledger');
    assert.deepEqual(result.errors, []);
    assert.equal(result.transactions.length, 3);
    assert.deepEqual(
      result.transactions.map((item) => [
        item.row,
        item.sourcePage,
        item.amount,
      ]),
      [
        [3, 1, 12575],
        [4, 1, -2550],
        [7, 2, 30010],
      ],
    );
    const reread = await readFile(
      initial.name,
      initial.original!,
      initial.pdf!.cuts,
    );
    assert.deepEqual(reread.sheets, initial.sheets);
    assert.deepEqual(
      normalizeSource(reread, selected, scope, 'ledger'),
      result,
    );
  });
}

for (const font of ['Helvetica', 'Courier'] as const) {
  test(`${font}: export and session restoration re-prove wrapped-header cells and page provenance from original PDF bytes`, async () => {
    const supplier = await readFile(
      'synthetic-supplier.csv',
      new TextEncoder().encode(
        'Date,Reference,Amount\n03-Apr-2026,SYN-I17,125.75\n08-Apr-2026,SYN-C18,-25.50\n19-Apr-2026,SYN-I19,300.10',
      ).buffer,
    );
    const ledger = await readFile(
      'synthetic-ap-audit.pdf',
      wrappedHeaderPdf([movements.slice(0, 2), movements.slice(2)], font),
      [],
      true,
    );
    const files: [SourceFile, SourceFile] = [supplier, ledger];
    const mappings: [Mapping, Mapping] = [
      { ...defaultMapping(), date: 0, reference: 1, amount: 2 },
      {
        ...mapping(),
        excluded: {
          '5': 'Reviewed second-page report title',
          '6': 'Reviewed repeated header',
        },
      },
    ];
    const result = compare(
      normalizeSource(supplier, mappings[0], scope, 'supplier'),
      normalizeSource(ledger, mappings[1], scope, 'ledger'),
      scope,
    );
    assert.equal(result.matches.length, 3);
    assert.equal(result.supplierOnly.length, 0);
    assert.equal(result.ledgerOnly.length, 0);
    const expectedSheet = structuredClone(ledger.sheets[0]);
    const expectedFragments = Object.entries(
      expectedSheet.pdfHeaderFragments!,
    ).flatMap(([row, fragments]) =>
      fragments.flatMap((fragment, line) =>
        fragment.map((text, column) => [
          'الدفتر',
          Number(row),
          expectedSheet.rowPages![row],
          line + 1,
          column + 1,
          text,
        ]),
      ),
    );
    assert.equal(expectedFragments.length, 60);
    // A stale caller-supplied annotation must never enter the audit workbook.
    ledger.sheets[0].pdfHeaderFragments!['2'][0][9] =
      'FORGED HEADER ANNOTATION';
    const review = {
      checked: true,
      name: 'Synthetic Reviewer',
      notes: 'Synthetic review of both pages',
    };
    const bytes = await exportWorkbook(result, files, review);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const fragments = workbook.getWorksheet('PDF Header Fragments');
    assert.ok(fragments);
    assert.equal(fragments.rowCount, 61);
    assert.deepEqual(
      Array.from(
        { length: 6 },
        (_, index) => fragments.getRow(1).getCell(index + 1).value,
      ),
      [
        'الطرف',
        'صف العنوان المدمج',
        'صفحة PDF',
        'سطر العنوان الأصلي',
        'عمود المصدر',
        'نص العنوان الأصلي',
      ],
    );
    const exported = Array.from({ length: fragments.rowCount - 1 }, (_, row) =>
      Array.from(
        { length: 6 },
        (_, column) =>
          fragments.getRow(row + 2).getCell(column + 1).value ?? '',
      ),
    );
    assert.deepEqual(exported, expectedFragments);
    assert.equal(
      exported.some((row) => row.includes('FORGED HEADER ANNOTATION')),
      false,
    );
    assert.deepEqual(
      exported
        .filter((row) => row[5] === 'Running AP')
        .map((row) => row.slice(1, 5)),
      [
        [2, 1, 1, 10],
        [6, 2, 1, 10],
      ],
    );
    assert.deepEqual(
      exported
        .filter((row) => row[5] === 'Balance')
        .map((row) => row.slice(1, 5)),
      [
        [2, 1, 3, 10],
        [6, 2, 3, 10],
      ],
    );

    const session = await saveSession({
      files,
      mappings,
      scope,
      decisions: [],
      rejected: [],
      events: [],
      review,
    });
    const restored = await restoreSession(session);
    assert.deepEqual(restored.result, result);
    assert.deepEqual(restored.files[1].sheets[0], expectedSheet);
    assert.deepEqual(restored.files[1].pdf?.cuts, ledger.pdf?.cuts);
    assert.equal(restored.files[1].sha256, ledger.sha256);
    assert.deepEqual(
      new Uint8Array(restored.files[1].original!),
      new Uint8Array(ledger.original!),
    );
    assert.equal(restored.mappings[1].pdfReviewed, true);
    assert.equal(restored.mappings[1].multiplier, -1);
    assert.equal(restored.review.checked, false);
    const restoredWorkbook = new ExcelJS.Workbook();
    await restoredWorkbook.xlsx.load(
      await exportWorkbook(restored.result, restored.files, restored.review),
    );
    const restoredFragments = restoredWorkbook.getWorksheet(
      'PDF Header Fragments',
    )!;
    assert.deepEqual(
      Array.from({ length: restoredFragments.rowCount - 1 }, (_, row) =>
        Array.from(
          { length: 6 },
          (_, column) =>
            restoredFragments.getRow(row + 2).getCell(column + 1).value ?? '',
        ),
      ),
      expectedFragments,
    );
  });
}
