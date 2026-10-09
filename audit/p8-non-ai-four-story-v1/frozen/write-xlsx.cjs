// Fixture-only serialization. No product reader, compare, evaluator or browser.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const [repo, input, id, output] = process.argv.slice(2);
const installed = createRequire(path.join(repo, 'package.json'));
const ExcelJS = installed('exceljs');
if (installed('exceljs/package.json').version !== '4.4.0') throw Error('ExcelJS provenance mismatch');
const fixture = JSON.parse(fs.readFileSync(input, 'utf8')).layouts.find(x => x.id === id && x.kind === 'xlsx');
if (!fixture) throw Error('Unknown XLSX wrapper');
const workbook = new ExcelJS.Workbook();
workbook.creator = 'Independent P8 synthetic format wrapper';
workbook.created = workbook.modified = new Date('2026-10-08T00:00:00Z');
const sheet = workbook.addWorksheet('Sheet1');
for (const row of fixture.rows) {
  if (row.length !== 11 || row.some(x => typeof x !== 'string')) throw Error('Source literal shape');
  sheet.addRow(row);
}
sheet.getRow(1).font = { name: 'Calibri', bold: true, size: 11 };
sheet.views = [{ state: 'frozen', ySplit: 1 }];
sheet.columns.forEach((col, index) => { col.width = Math.max(14, ...fixture.rows.map(row => row[index].length + 2)); });
sheet.eachRow(row => row.eachCell({includeEmpty:true}, cell => { cell.numFmt = '@'; }));
workbook.xlsx.writeFile(output).catch(error => { console.error(error); process.exitCode = 1; });
