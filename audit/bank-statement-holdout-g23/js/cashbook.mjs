// The G23 text XLSX cashbook, written by SheetJS (the xlsx package) as a
// Node service's export: the CSV's headers on the first row, then one entry
// per row, every cell as text, the dates as yyyy-mm-dd and the amounts as
// plain decimals with two places, the other amount cell left empty.
//
//   node js/cashbook.mjs <node_modules> <cashbooks.json>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(`${process.argv[2]}/`);
const XLSX = require('xlsx');

const plain = (minor) => (minor ? `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}` : '');

const { cashbooks } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
for (const book of cashbooks.filter((b) => b.kind === 'text')) {
  const rows = [book.headers];
  for (const e of book.entries) {
    rows.push([e.date, e.voucher, e.description, e.reference, plain(e.receipt), plain(e.payment)]);
  }
  // aoa_to_sheet stores each string as a string cell, as given; an empty
  // amount is left out.
  const sheet = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (v === '' ? null : v))));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cashbook');
  workbook.Props = { Title: 'Cashbook', CreatedDate: new Date(Date.UTC(2030, 0, 31, 12, 0, 0)) };
  XLSX.writeFile(workbook, book.out, { bookType: 'xlsx', compression: true });
}
