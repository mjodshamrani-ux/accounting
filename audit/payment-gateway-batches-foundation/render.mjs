// The XLSX writer for PG-1 focused stories: reads [{path, rows, hidden}] on
// stdin and writes one sheet of text cells with ExcelJS, the story's rows
// hidden.
import ExcelJS from 'exceljs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const jobs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
for (const { path, rows, hidden } of jobs) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Gateway');
  sheet.addRows(rows);
  for (const r of hidden) sheet.getRow(r).hidden = true;
  await book.xlsx.writeFile(path);
}
