// The G20 text XLSX cashbook, written by write-excel-file as a Node
// service's export: the CSV's headers on the first row, then one entry per
// row, every cell as text, the dates as yyyy-mm-dd and the amounts as plain
// decimals with two places, the other amount cell left empty.
//
//   node js/cashbook.mjs <node_modules> <cashbooks.json>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(`${process.argv[2]}/`);
const writeXlsxFile = require('write-excel-file/node');

const plain = (minor) => (minor ? `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}` : '');
const text = (value) => ({ type: String, value });

const { cashbooks } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
for (const book of cashbooks.filter((b) => b.kind === 'text')) {
  const rows = [book.headers.map(text)];
  for (const e of book.entries) {
    rows.push(
      [e.date, e.voucher, e.description, e.reference, plain(e.receipt), plain(e.payment)].map((v) => (v ? text(v) : null)),
    );
  }
  await writeXlsxFile(rows, { sheet: 'Cashbook' }).toFile(book.out);
}
