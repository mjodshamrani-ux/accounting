import ExcelJS from 'exceljs';
import { readFile } from '../../lib/reconciliation/io.ts';
import { selectImportMapping } from '../../lib/reconciliation/import-selection.ts';
import { suggestFormats } from '../../lib/reconciliation/format-inference.ts';
import { inferStatementDirection } from '../../lib/reconciliation/statement-direction.ts';
import { compare, normalizeSource } from '../../lib/reconciliation/core.ts';
import type {
  Mapping,
  Scope,
  SourceFile,
} from '../../lib/reconciliation/types.ts';

// Public fixture provenance: independently hand-authored fictional movements,
// identifiers and dates. No customer bytes, source-row facts, transformed private
// values, OCR/model output or product-generated oracle are used. This tests the
// accounting conditions; it does not reproduce or certify a private statement.
export const syntheticScope: Scope = {
  supplier: 'Fictional Fixture Vendor',
  entity: 'Fictional Fixture Buyer',
  account: 'SYNTHETIC-AP',
  currency: 'SAR',
  cutoff: '2034-02-28',
  decimals: 2,
  dateWindow: 2,
  confirmed: true,
  coverageConfirmed: false,
};

type Entry = {
  date: string;
  otherDate: string;
  type: string;
  document: string;
  voucher: string;
  po?: string;
  receipt?: string;
  bank?: string;
  amount: number;
  balance: number;
};
// Amounts/balances are literal minor units, computed by hand. Due/invoice date
// differs from posting date; running balance is never a movement amount.
const supplier: Entry[] = [
  {
    date: '03-Feb-2034',
    otherDate: '20-Feb-2034',
    type: 'Invoice',
    document: 'SYN-NATIVE-83-I-A',
    voucher: '',
    amount: 21947,
    balance: 28736,
  },
  {
    date: '05-Feb-2034',
    otherDate: '21-Feb-2034',
    type: 'Credit Note',
    document: 'CN-SYN-NATIVE-83-C',
    voucher: '',
    amount: -1865,
    balance: 26871,
  },
  {
    date: '09-Feb-2034',
    otherDate: '27-Feb-2034',
    type: 'Invoice',
    document: 'SYN-NATIVE-83-GROUP',
    voucher: '',
    po: 'PO-SYN-NATIVE-83-G',
    amount: 14329,
    balance: 41200,
  },
  {
    date: '13-Feb-2034',
    otherDate: '23-Feb-2034',
    type: 'Invoice',
    document: 'SYN-NATIVE-83-VARIANCE',
    voucher: '',
    amount: 8734,
    balance: 49934,
  },
  {
    date: '17-Feb-2034',
    otherDate: '24-Feb-2034',
    type: 'Payment',
    document: '',
    voucher: '',
    receipt: 'RCPT-SYN-NATIVE-83-Q',
    bank: 'BANK-SYN-NATIVE-83-Q',
    amount: -4683,
    balance: 45251,
  },
  {
    date: '23-Feb-2034',
    otherDate: '27-Feb-2034',
    type: 'Invoice',
    document: 'SYN-NATIVE-83-SUPPLIER-ONLY',
    voucher: '',
    amount: 2458,
    balance: 47709,
  },
];
const ledger: Entry[] = [
  {
    date: '04-Feb-2034',
    otherDate: '02-Feb-2034',
    type: 'AP Invoice',
    document: 'SYN-NATIVE-83-I-A',
    voucher: 'AP-SYN-NATIVE-83-A',
    amount: 21947,
    balance: 28736,
  },
  {
    date: '06-Feb-2034',
    otherDate: '04-Feb-2034',
    type: 'AP Credit Memo',
    document: 'CN-SYN-NATIVE-83-C',
    voucher: 'AP-SYN-NATIVE-83-C',
    amount: -1865,
    balance: 26871,
  },
  {
    date: '10-Feb-2034',
    otherDate: '08-Feb-2034',
    type: 'AP Invoice',
    document: 'SYN-NATIVE-83-GROUP',
    voucher: 'AP-SYN-NATIVE-83-G',
    po: 'PO-SYN-NATIVE-83-G',
    amount: 6117,
    balance: 32988,
  },
  {
    date: '10-Feb-2034',
    otherDate: '08-Feb-2034',
    type: 'AP Invoice',
    document: 'SYN-NATIVE-83-GROUP',
    voucher: 'AP-SYN-NATIVE-83-G',
    po: 'PO-SYN-NATIVE-83-G',
    amount: 8212,
    balance: 41200,
  },
  {
    date: '14-Feb-2034',
    otherDate: '12-Feb-2034',
    type: 'AP Invoice',
    document: 'SYN-NATIVE-83-VARIANCE',
    voucher: 'AP-SYN-NATIVE-83-V',
    amount: 8519,
    balance: 49719,
  },
  {
    date: '18-Feb-2034',
    otherDate: '16-Feb-2034',
    type: 'Payment',
    document: '',
    voucher: 'PYM-SYN-NATIVE-83-R',
    bank: 'BANK-SYN-NATIVE-83-R',
    amount: -4683,
    balance: 45036,
  },
  {
    date: '25-Feb-2034',
    otherDate: '24-Feb-2034',
    type: 'AP Invoice',
    document: 'SYN-NATIVE-83-LEDGER-ONLY',
    voucher: 'AP-SYN-NATIVE-83-L',
    amount: 1107,
    balance: 46143,
  },
];
const money = (minor: number) => (minor / 100).toFixed(2);
export const nativeHeaders = (side: 'supplier' | 'ledger') => [
  side === 'supplier' ? 'Date' : 'Posting Date',
  side === 'supplier' ? 'Due Date' : 'Invoice Date',
  'Doc Type',
  'AP Voucher',
  'Document No',
  'PO / Bank Ref',
  'Receipt No',
  'Bank Reference',
  'Description',
  'Debit (SAR)',
  'Credit (SAR)',
  side === 'supplier' ? 'Running Balance' : 'Running AP Balance',
];
function rows(side: 'supplier' | 'ledger') {
  const entries = side === 'supplier' ? supplier : ledger;
  const movement = (entry: Entry) => {
    const debit =
      side === 'supplier'
        ? Math.max(entry.amount, 0)
        : Math.max(-entry.amount, 0);
    const credit =
      side === 'supplier'
        ? Math.max(-entry.amount, 0)
        : Math.max(entry.amount, 0);
    return [
      entry.date,
      entry.otherDate,
      entry.type,
      entry.voucher,
      entry.document,
      entry.po ?? entry.bank ?? '',
      entry.receipt ?? '',
      '',
      entry.type === 'Payment'
        ? 'Fictional bank transfer'
        : 'Fictional movement',
      money(debit),
      money(credit),
      money(entry.balance),
    ];
  };
  return [
    [`Fictional ${side} native statement`],
    ['Period', '01-Feb-2034 - 28-Feb-2034'],
    nativeHeaders(side),
    movement({
      date: '01-Feb-2034',
      otherDate: '01-Feb-2034',
      type: 'Opening Balance',
      document: 'B/F',
      voucher: '',
      amount: 6789,
      balance: 6789,
    }),
    ...entries.map(movement),
    [
      'Closing Balance',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      side === 'supplier' ? '477.09' : '461.43',
    ],
  ];
}

// Minimal text-only PDF with explicit physical columns and a valid xref.
// ASCII fixture deliberately does not claim Arabic glyph/bidi coverage.
function statementPdf(data: string[][]) {
  const escape = (value: string) => value.replace(/[\\()]/g, (c) => '\\' + c);
  const stream = data
    .flatMap((row, index) =>
      row.map(
        (value, column) =>
          `BT /F1 7 Tf 1 0 0 1 ${20 + column * 140} ${750 - index * 24} Tm (${escape(value)}) Tj ET`,
      ),
    )
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1740 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output).buffer;
}

async function statement(
  side: 'supplier' | 'ledger',
  extension: 'xlsx' | 'pdf',
) {
  const data = rows(side);
  let bytes: ArrayBuffer;
  if (extension === 'xlsx') {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Fictional native statement');
    data.forEach((row, index) => {
      sheet.getRow(index + 1).values = row.map((value, column) =>
        index >= 3 && column >= 9 && value !== '' ? Number(value) : value,
      );
    });
    for (const column of [10, 11, 12])
      sheet.getColumn(column).numFmt = '#,##0.00';
    const buffer = await book.xlsx.writeBuffer();
    bytes = new Uint8Array(buffer).buffer;
  } else bytes = statementPdf(data);
  // These are the fixture author's physical column boundaries, analogous to
  // reviewed PDF cuts. Automatic layout discovery has separate public tests.
  const cuts =
    extension === 'pdf'
      ? Array.from(
          { length: 11 },
          (_, column) => (((column + 1) * 140 + 10) / 1740) * 100,
        )
      : undefined;
  return readFile(`fictional-native-${side}.${extension}`, bytes, cuts);
}

export async function loadPublicSyntheticNative(extension: 'xlsx' | 'pdf') {
  const files: [SourceFile, SourceFile] = await Promise.all([
    statement('supplier', extension),
    statement('ledger', extension),
  ]);
  const selections = files.map((file, side) =>
    selectImportMapping(file, side === 0 ? 'supplier' : 'ledger'),
  );
  const formats = files.map((file, side) =>
    suggestFormats(file, selections[side].mapping, 2),
  );
  const proofs = files.map((file, side) =>
    inferStatementDirection(
      file,
      { ...selections[side].mapping, ...formats[side].patch },
      2,
    ),
  );
  if (proofs.some((proof) => !proof))
    throw new Error(
      'Synthetic balance direction must be provable from fixture bytes',
    );
  const mappings = files.map((_, side) => ({
    ...selections[side].mapping,
    ...formats[side].patch,
    multiplier: proofs[side]!.multiplier,
    directionEvidence: proofs[side]!,
    pdfReviewed: extension === 'pdf',
  })) as [Mapping, Mapping];
  const sources = files.map((file, side) =>
    normalizeSource(
      file,
      mappings[side],
      syntheticScope,
      side === 0 ? 'supplier' : 'ledger',
    ),
  );
  return {
    extension,
    files,
    mappings,
    selections,
    formats,
    proofs,
    result: compare(sources[0], sources[1], syntheticScope),
  };
}
