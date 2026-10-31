// A typed cashbook for G9, written by SheetJS (npm xlsx 0.18.5, Apache-2.0)
// as a company's export would be: dates as day serials from 1899-12-30 with
// a date format, amounts as numbers with a money format (a whole riyal or an
// amount of one decimal is stored as such), text as strings. The workbook's
// creation date is fixed. Called by render.py:
//   node render_sheetjs.mjs <unpacked xlsx package> <cashbook.json> <out.xlsx>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pkg, input, output] = process.argv.slice(2);
const XLSX = await import(pathToFileURL(path.join(pkg, 'xlsx.mjs')).href);
const { headers, entries } = JSON.parse(readFileSync(input, 'utf8'));

const serial = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};
const sheet = {};
const put = (r, c, cell) => {
  sheet[XLSX.utils.encode_cell({ r, c })] = cell;
};
headers.forEach((h, c) => put(0, c, { t: 's', v: h }));
entries.forEach((e, i) => {
  const r = i + 1;
  put(r, 0, { t: 'n', v: serial(e.date), z: 'yyyy-mm-dd' });
  put(r, 1, { t: 's', v: e.voucher });
  put(r, 2, { t: 's', v: e.description });
  if (e.reference) put(r, 3, { t: 's', v: e.reference });
  if (e.receipt) put(r, 4, { t: 'n', v: e.receipt / 100, z: '#,##0.00' });
  if (e.payment) put(r, 5, { t: 'n', v: e.payment / 100, z: '#,##0.00' });
});
sheet['!ref'] = XLSX.utils.encode_range({
  s: { r: 0, c: 0 },
  e: { r: entries.length, c: headers.length - 1 },
});
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, 'Cashbook');
book.Props = { CreatedDate: new Date(Date.UTC(2026, 9, 23)) };
writeFileSync(
  output,
  XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }),
);
