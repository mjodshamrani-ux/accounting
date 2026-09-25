/** Independent file producers. They never call production extraction/normalization. */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { visibleInputEvidence } from './input-evidence.mjs';
const enc = new TextEncoder();
// Exported for the hard-case evaluator, which checks that kept evidence
// names the header it came from.
export const headers = {
  en: {
    kind: 'Document Type',
    bankReference: 'Bank Reference',
    receiptReference: 'Receipt No',
    poReference: 'PO Reference',
    amountBasis: 'Amount Basis',
    date: 'Date',
    reference: 'Reference',
    description: 'Description',
    amount: 'Amount',
    debit: 'Debit',
    credit: 'Credit',
    currency: 'Currency',
    account: 'Account',
    voucherReference: 'Voucher No',
    batch: 'Batch',
  },
  ar: {
    kind: 'نوع المستند',
    bankReference: 'Bank Reference',
    receiptReference: 'Receipt No',
    poReference: 'PO Reference',
    amountBasis: 'Amount Basis',
    date: 'التاريخ',
    reference: 'المرجع',
    description: 'الوصف',
    amount: 'المبلغ',
    debit: 'مدين',
    credit: 'دائن',
    currency: 'العملة',
    account: 'الحساب',
    voucherReference: 'رقم القيد',
    batch: 'مرجع الدفعة',
  },
};
export function displayMinor(minor, decimals, style = 'dot') {
  if (!Number.isSafeInteger(minor))
    throw new Error('Invalid independent minor amount');
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const normal = decimals
    ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
    : digits;
  let value = (minor < 0 ? '-' : '') + normal;
  if (style === 'comma-decimals') value = value.replace('.', ',');
  if (style === 'parenthesized-credits' && minor < 0) value = `(${normal})`;
  if (style === 'arabic-numerals')
    value = value
      .replace(/[0-9]/g, (n) => '٠١٢٣٤٥٦٧٨٩'[Number(n)])
      .replace('.', '٫');
  return value;
}
function columns(source) {
  if (source.layout.fields) return [...source.layout.fields];
  if (source.layout.columns === 'split')
    return [
      'reference',
      'date',
      'kind',
      'description',
      'debit',
      'credit',
      'currency',
      'account',
    ];
  if (source.layout.columns === 'reordered')
    return [
      'reference',
      'description',
      'date',
      'kind',
      'currency',
      'amount',
      'account',
    ];
  return [
    'date',
    'reference',
    'kind',
    'description',
    'amount',
    'currency',
    'account',
  ];
}
function fieldValue(row, field, source) {
  if (field === 'date' && source.metadata.dateFormat !== 'ymd') {
    const [year, month, day] = row.date.split('-');
    return source.metadata.dateFormat === 'dmy'
      ? `${day}/${month}/${year}`
      : `${month}/${day}/${year}`;
  }
  if (field === 'amount')
    return displayMinor(
      row.minor,
      source.metadata.decimals,
      source.layout.style,
    );
  if (field === 'debit')
    return row.minor >= 0
      ? displayMinor(row.minor, source.metadata.decimals, source.layout.style)
      : '';
  if (field === 'credit')
    return row.minor < 0
      ? displayMinor(-row.minor, source.metadata.decimals, source.layout.style)
      : '';
  if (field === 'description' && source.layout.multiline)
    return row.description.replace(' ', '\n');
  return row[field] ?? '';
}
/** The table a renderer writes, before any file format. Exported so the hard-case
 * harness can run the same table as a logical source without file bytes. */
export function sourceTable(source) {
  let fields = columns(source);
  if (source.invalid === 'missing-amount-column')
    fields = fields.filter(
      (field) => !['amount', 'debit', 'credit'].includes(field),
    );
  const labels = headers[source.layout.language] ?? headers.en;
  const title =
    source.metadata.reportType === 'aging'
      ? 'Aging report'
      : source.metadata.reportType === 'open-items'
        ? 'Open items report'
        : 'Transaction statement';
  const rows = [
    [`${source.metadata.supplier} - ${title}`],
    [
      `Entity: ${source.metadata.entity}`,
      `Account: ${source.metadata.account}`,
      `Currency: ${source.metadata.currency}`,
    ],
    [
      source.metadata.periodEvidence === null
        ? `As of: ${source.metadata.cutoff}`
        : `Period: ${source.metadata.periodStart} to ${source.metadata.cutoff}`,
    ],
    [source.metadata.signEvidence],
  ];
  if (source.layout.banner || source.layout.style === 'offset-table')
    rows.push([], []);
  const headerRow = rows.length;
  const header = fields.map((field) =>
    field === 'reference' && source.metadata.referenceHeader === 'Invoice No'
      ? 'Invoice No'
      : labels[field],
  );
  rows.push(header);
  const amountIndex = fields.findIndex(
    (field) => field === 'amount' || field === 'debit',
  );
  const balanceRow = (label, minor) => {
    const row = Array(fields.length).fill('');
    row[fields.indexOf('description')] = label;
    if (amountIndex >= 0)
      row[amountIndex] =
        minor === null
          ? ''
          : displayMinor(minor, source.metadata.decimals, source.layout.style);
    return row;
  };
  if (source.metadata.opening !== null)
    rows.push(balanceRow('Opening balance', source.metadata.opening));
  const expectedRows = [];
  const data = source.invalid === 'empty-file' ? [] : source.rows;
  for (let i = 0; i < data.length; i++) {
    if (
      i > 0 &&
      (source.layout.repeatedHeader ||
        source.layout.style === 'repeated-headers') &&
      i % 4 === 0
    )
      rows.push([...header]);
    if (
      (source.layout.blankRows || source.layout.style === 'blank-rows') &&
      i % 3 === 0
    )
      rows.push([]);
    const row = data[i],
      rendered = fields.map((field) => fieldValue(row, field, source));
    if (i === 0 && source.invalid === 'invalid-amount' && amountIndex >= 0)
      rendered[amountIndex] = '1,2,3.not-money';
    if (i === 0 && source.invalid === 'ambiguous-number' && amountIndex >= 0)
      rendered[amountIndex] = displayMinor(
        row.minor,
        source.metadata.decimals,
        'comma-decimals',
      );
    if (
      i === 0 &&
      source.invalid === 'formula-without-cache' &&
      amountIndex >= 0
    )
      rendered[amountIndex] = '=SUM(1,2)';
    expectedRows.push({
      key: row.key,
      row: rows.length + 1,
      page: 1,
      reference: row.reference,
      date: row.date,
      minor: row.minor,
      description: row.description,
    });
    rows.push(rendered);
  }
  rows.push(balanceRow('Closing balance', source.metadata.closing));
  const bindings = {
    ...Object.fromEntries(
      [
        'date',
        'reference',
        'description',
        'amount',
        'debit',
        'credit',
        'currency',
        'account',
      ].map((field) => [field, fields.indexOf(field)]),
    ),
    header: headerRow,
    mode: source.layout.columns === 'split' ? 'split' : 'signed',
  };
  return { rows, fields, headerRow, bindings, expectedRows };
}
function csvRecords(rows, delimiter = ',', allQuoted = false) {
  return enc.encode(
    '\ufeff' +
      rows
        .map((row) =>
          row
            .map((value) => {
              const s = String(value ?? '');
              return allQuoted || s.includes(delimiter) || /["\r\n]/.test(s)
                ? `"${s.replace(/"/g, '""')}"`
                : s;
            })
            .join(delimiter),
        )
        .join('\r\n'),
  );
}
// Independent delimiter writer intentionally does not call csvRecords.
function delimitedRecords(rows, delimiter) {
  let out = '\ufeff';
  for (let ri = 0; ri < rows.length; ri++) {
    if (ri) out += '\n';
    for (let ci = 0; ci < rows[ri].length; ci++) {
      if (ci) out += delimiter;
      const value = String(rows[ri][ci] ?? '');
      let quoted =
        value.indexOf(delimiter) >= 0 ||
        value.indexOf('"') >= 0 ||
        value.indexOf('\n') >= 0;
      if (quoted) out += '"';
      for (const char of value) out += char === '"' ? '""' : char;
      if (quoted) out += '"';
    }
  }
  return enc.encode(out);
}
async function excelWorkbook(source, table) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date('2026-01-01T00:00:00Z');
  wb.modified = wb.created;
  if (source.layout.extraSheet || source.layout.style === 'multiple-sheets')
    wb.addWorksheet('Read me').addRow([
      'Synthetic statement used for local reliability checks',
    ]);
  const ws = wb.addWorksheet('Transactions');
  for (const row of table.rows) ws.addRow(row);
  ws.views = [{ rightToLeft: source.layout.language === 'ar' }];
  ws.columns = table.fields.map((field) => ({
    width: field === 'description' ? 42 : field === 'reference' ? 32 : 18,
  }));
  if (source.layout.banner) ws.mergeCells(1, 1, 1, table.fields.length);
  for (const expected of table.expectedRows) {
    const original = source.rows.find((row) => row.key === expected.key);
    for (const field of ['amount', 'debit', 'credit']) {
      const column = table.fields.indexOf(field);
      if (column < 0) continue;
      const cell = ws.getCell(expected.row, column + 1);
      if (source.invalid && expected === table.expectedRows[0]) {
        if (source.invalid === 'formula-without-cache')
          cell.value = { formula: 'SUM(1,2)' };
        continue;
      }
      // Native numeric cells test OOXML values, while localized styles stay text.
      if (
        ['arabic-numerals', 'comma-decimals', 'parenthesized-credits'].includes(
          source.layout.style,
        ) ||
        cell.value === ''
      )
        continue;
      const minor = field === 'credit' ? -original.minor : original.minor;
      cell.value = minor / 10 ** source.metadata.decimals;
      cell.numFmt = source.metadata.decimals
        ? '0.' + '0'.repeat(source.metadata.decimals)
        : '0';
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char],
  );
const columnName = (i) => {
  let result = '';
  for (i++; i; i = Math.floor((i - 1) / 26))
    result = String.fromCharCode(65 + ((i - 1) % 26)) + result;
  return result;
};
async function manualOfficeXml(source, table) {
  // Independent implementation of the OOXML package, not an ExcelJS round trip.
  const zip = new JSZip(),
    date = new Date('2026-01-01T00:00:00Z');
  const extraSheet =
    source.layout.extraSheet || source.layout.style === 'multiple-sheets';
  const put = (name, content) => zip.file(name, content, { date });
  put(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      (extraSheet
        ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        : '') +
      '</Types>',
  );
  put(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  put(
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/>' +
      (extraSheet ? '<sheet name="Read me" sheetId="2" r:id="rId2"/>' : '') +
      '</sheets></workbook>',
  );
  put(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      (extraSheet
        ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        : '') +
      '</Relationships>',
  );
  const sheet = table.rows
    .map(
      (row, ri) =>
        `<row r="${ri + 1}">${row.map((value, ci) => (source.invalid === 'formula-without-cache' && ri + 1 === table.expectedRows[0]?.row && ['amount', 'debit'].includes(table.fields[ci]) ? `<c r="${columnName(ci)}${ri + 1}"><f>SUM(1,2)</f></c>` : `<c r="${columnName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`)).join('')}</row>`,
    )
    .join('');
  put(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="${source.layout.language === 'ar' ? 1 : 0}"/></sheetViews><sheetData>${sheet}</sheetData></worksheet>`,
  );
  if (extraSheet)
    put(
      'xl/worksheets/sheet2.xml',
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Synthetic statement used for local reliability checks</t></is></c></row></sheetData></worksheet>',
    );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
const pdfString = (s) =>
  String(s)
    .replace(/[\\()]/g, '\\$&')
    .replace(/[^\x20-\x7E]/g, '?');
function writePdf(pages) {
  const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    ],
    kids = [];
  for (const content of pages) {
    const id = objects.length + 1;
    kids.push(id);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let result = '%PDF-1.4\n',
    offsets = [0];
  objects.forEach((value, i) => {
    offsets.push(enc.encode(result).length);
    result += `${i + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = enc.encode(result).length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(result);
}
function pdfStatement(source) {
  const pdfMoneyStyle =
    source.layout.style === 'arabic-numerals' ? 'dot' : source.layout.style;
  // PDF Unicode rendering is intentionally not claimed; Arabic is tested by CSV/OOXML.
  const fields =
    source.layout.columns === 'reordered'
      ? ['reference', 'date', 'kind', 'description', 'amount']
      : ['date', 'reference', 'kind', 'description', 'amount'];
  if (source.invalid === 'missing-amount-column') fields.pop();
  const positions = [35, 190, 345, 440, 710],
    pageSize = source.layout.pageRows ?? 18;
  const pages = [],
    expectedRows = [],
    visibleText = [];
  const data = source.invalid === 'empty-file' ? [] : source.rows;
  for (let start = 0; start < Math.max(data.length, 1); start += pageSize) {
    const page = pages.length + 1;
    const visible = [
      {
        y: 562,
        values: [
          `${source.metadata.supplier} - ${source.metadata.reportType === 'aging' ? 'Aging report' : source.metadata.reportType === 'open-items' ? 'Open items report' : 'Transaction statement'}`,
        ],
      },
      {
        y: 544,
        values: [
          `Currency: ${source.metadata.currency}  Account: ${source.metadata.account}  Entity: ${source.metadata.entity}`,
        ],
      },
      {
        y: 526,
        values: [
          source.metadata.periodEvidence === null
            ? `As of: ${source.metadata.cutoff}`
            : `Period: ${source.metadata.periodStart} to ${source.metadata.cutoff}`,
        ],
      },
      {
        y: 508,
        values: [
          source.metadata.opening === null
            ? 'Opening balance not available'
            : `Opening balance: ${displayMinor(source.metadata.opening, source.metadata.decimals, pdfMoneyStyle)}`,
        ],
      },
      { y: 492, values: [source.metadata.signEvidence] },
      {
        y: 478,
        values: fields.map((field) =>
          field === 'reference' &&
          source.metadata.referenceHeader === 'Invoice No'
            ? 'Invoice No'
            : headers.en[field],
        ),
      },
    ];
    const chunk = data.slice(start, start + pageSize);
    chunk.forEach((row, i) => {
      const values = fields.map((field) =>
        fieldValue(row, field, {
          ...source,
          layout: {
            ...source.layout,
            style:
              source.layout.style === 'arabic-numerals'
                ? 'dot'
                : source.layout.style,
          },
        }),
      );
      const amountIndex = fields.indexOf('amount');
      if (
        start + i === 0 &&
        source.invalid === 'invalid-amount' &&
        amountIndex >= 0
      )
        values[amountIndex] = 'invalid money';
      if (
        start + i === 0 &&
        source.invalid === 'formula-without-cache' &&
        amountIndex >= 0
      )
        values[amountIndex] = '=SUM(1,2)';
      if (
        start + i === 0 &&
        source.invalid === 'ambiguous-number' &&
        amountIndex >= 0
      )
        values[amountIndex] = displayMinor(
          row.minor,
          source.metadata.decimals,
          'comma-decimals',
        );
      visible.push({ y: 458 - i * 18, values });
      expectedRows.push({
        key: row.key,
        row: 7 + i,
        page,
        reference: row.reference,
        date: row.date,
        minor: row.minor,
        description: row.description,
      });
    });
    visible.push(
      {
        y: 42,
        values: [
          `Closing balance: ${displayMinor(source.metadata.closing, source.metadata.decimals, pdfMoneyStyle)}`,
        ],
      },
      { y: 23, values: [`Page ${page}`] },
    );
    visibleText.push(
      ...visible.map((line, index) => ({
        text: line.values.join(' | '),
        page,
        row: index + 1,
      })),
    );
    let operations = [];
    for (const line of visible)
      for (let ci = 0; ci < line.values.length; ci++) {
        const text = String(line.values[ci]);
        if (
          source.layout.fragments &&
          ci === fields.indexOf('reference') &&
          line.y < 478 &&
          line.y > 42 &&
          text.length > 6
        ) {
          const cut = Math.floor(text.length / 2);
          operations.push(
            `BT /F1 8 Tf 1 0 0 1 ${positions[ci] + cut * 4.8} ${line.y} Tm (${pdfString(text.slice(cut))}) Tj ET`,
            `BT /F1 8 Tf 1 0 0 1 ${positions[ci]} ${line.y} Tm (${pdfString(text.slice(0, cut))}) Tj ET`,
          );
        } else
          operations.push(
            `BT /F1 8 Tf 1 0 0 1 ${positions[ci]} ${line.y} Tm (${pdfString(text)}) Tj ET`,
          );
      }
    if (source.layout.paintReverse) operations.reverse();
    operations.push('0.6 w 35 470 m 795 470 l S');
    pages.push(operations.join('\n'));
  }
  return {
    bytes: writePdf(pages),
    confirmationEvidence: visibleInputEvidence(visibleText, source.name),
    expectedRows,
    headerRow: 5,
    bindings: {
      date: fields.indexOf('date'),
      reference: fields.indexOf('reference'),
      description: fields.indexOf('description'),
      amount: fields.indexOf('amount'),
      debit: -1,
      credit: -1,
      currency: -1,
      account: -1,
      mode: 'signed',
      header: 5,
    },
    pages: pages.length,
    fields,
  };
}
export async function renderSource(source) {
  if (source.invalid === 'corrupt-file')
    return {
      side: source.side,
      name: source.name,
      format: source.format,
      bytes: enc.encode('This is not a valid PDF or XLSX archive.\x00\xff'),
      sheetName: 'Transactions',
      headerRow: 0,
      bindings: {},
      expectedRows: [],
      fields: [],
      expectedRejection: 'corrupt-file',
    };
  if (source.format === 'pdf')
    return {
      side: source.side,
      name: source.name,
      format: 'pdf',
      sheetName: 'PDF',
      ...pdfStatement(source),
    };
  const table = sourceTable(source);
  let bytes;
  if (source.layout.writer === 'exceljs')
    bytes = await excelWorkbook(source, table);
  else if (source.layout.writer === 'ooxml-zip')
    bytes = await manualOfficeXml(source, table);
  else if (source.layout.writer === 'csv-delimited')
    bytes = delimitedRecords(table.rows, source.layout.delimiter ?? ';');
  else
    bytes = csvRecords(
      table.rows,
      source.layout.delimiter ?? ',',
      source.layout.writer === 'csv-quoted',
    );
  return {
    side: source.side,
    name: source.name,
    format: source.format,
    bytes,
    sheetName: source.format === 'xlsx' ? 'Transactions' : 'CSV',
    sheetIndex:
      source.format === 'xlsx' &&
      (source.layout.extraSheet || source.layout.style === 'multiple-sheets') &&
      source.layout.writer === 'exceljs'
        ? 1
        : 0,
    headerRow: table.headerRow,
    bindings: table.bindings,
    expectedRows: table.expectedRows,
    fields: table.fields,
    confirmationEvidence: visibleInputEvidence(
      table.rows.map((row, index) => ({
        text: row.join(' | '),
        row: index + 1,
        page: 1,
      })),
      source.name,
    ),
  };
}
export async function renderCase(spec) {
  return {
    case: spec,
    files: await Promise.all(spec.sources.map(renderSource)),
  };
}
