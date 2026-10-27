// Write one M4 cashbook with exceljs 4.4.0, from the spec stories.py
// describes: sheets of rows, a cell a string or {n, fmt} for a typed number,
// merges as A1 ranges, hidden columns 1-based. exceljs makes its own shared
// strings, styles and document properties.
//   node audit/bank-map-holdout-m4/write_exceljs.mjs spec.json out.xlsx
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const [specPath, out] = process.argv.slice(2);
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const book = new ExcelJS.Workbook();
book.creator = 'Tarasuf synthetic M4';
book.created = new Date('2026-10-27T00:00:00Z');
book.modified = new Date('2026-10-27T00:00:00Z');
for (const s of spec.sheets) {
  const ws = book.addWorksheet(s.name);
  s.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === '') return;
      const target = ws.getCell(r + 1, c + 1);
      if (typeof cell === 'object') {
        target.value = Number(cell.n);
        if (cell.fmt) target.numFmt = cell.fmt;
      } else target.value = cell;
    });
  });
  for (const m of s.merges ?? []) ws.mergeCells(m);
  for (const c of s.hidden ?? []) ws.getColumn(c).hidden = true;
}
await book.xlsx.writeFile(out);
