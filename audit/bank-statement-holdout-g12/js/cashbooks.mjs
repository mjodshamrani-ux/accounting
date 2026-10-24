// G12 XLSX cashbooks written by ExcelJS, as a Node accounting export writes
// them: a typed cashbook with dates as dates and amounts as numbers (a whole
// riyal or an amount of one decimal stored as such), or a text cashbook with
// every cell a string in text format. The workbook's dates are fixed;
// render.py fixes the zip entries' dates afterwards.
//
//   node cashbooks.mjs <node_modules dir> <cashbooks.json>
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [modules, jobs] = process.argv.slice(2);
const require = createRequire(join(modules, 'package.json'));
const ExcelJS = require('exceljs');

const FIXED = new Date(Date.UTC(2026, 9, 23));
const FIELDS = ['date', 'voucher', 'description', 'reference', 'receipt', 'payment'];

function plain(minor) {
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

async function write(book) {
  const typed = book.kind === 'typed';
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tarasuf holdout G12';
  workbook.created = FIXED;
  workbook.modified = FIXED;
  const sheet = workbook.addWorksheet('Cashbook');
  sheet.addRow(book.headers);
  for (const entry of book.entries) {
    const row = sheet.addRow([]);
    FIELDS.forEach((field, c) => {
      const value = entry[field];
      if (!value) return;
      const cell = row.getCell(c + 1);
      if (typed && c === 0) {
        const [y, m, d] = value.split('-').map(Number);
        cell.value = new Date(Date.UTC(y, m - 1, d));
        cell.numFmt = 'yyyy-mm-dd';
      } else if (typed && c >= 4) {
        cell.value = value / 100;
        cell.numFmt = '#,##0.00';
      } else {
        cell.value = c >= 4 ? plain(value) : String(value);
        if (!typed) cell.numFmt = '@';
      }
    });
  }
  await workbook.xlsx.writeFile(book.out);
}

for (const book of JSON.parse(readFileSync(jobs, 'utf8')).cashbooks) await write(book);
