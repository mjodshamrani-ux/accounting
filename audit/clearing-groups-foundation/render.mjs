// The XLSX writer for CLR-1 focused stories: reads [{path, rows, hidden,
// formulas}] on stdin and writes one sheet of text cells with ExcelJS, the
// story's rows hidden and its formulas set with their cached result.
import ExcelJS from 'exceljs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const jobs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
for (const { path, rows, hidden, formulas } of jobs) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Clearing');
  sheet.addRows(rows);
  for (const r of hidden) sheet.getRow(r).hidden = true;
  for (const [r, c, formula] of formulas) {
    const cell = sheet.getRow(r).getCell(c);
    cell.value = { formula, result: cell.value };
  }
  await book.xlsx.writeFile(path);
}
