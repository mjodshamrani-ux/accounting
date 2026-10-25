// G16: the pre-seal cashbook check (cashbook.py) against the product's own
// reading, on every sealed holdout cashbook and on planted workbooks, one
// rule each. The product reads sealed packages and synthetic files only,
// never a holdout draft (DEV-61).
//   node --experimental-strip-types audit/bank-statement-eligibility/measure_cashbook.mjs [--out f.json | --assert f.json]
// --assert fails when today's comparison differs from the recorded one.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, globSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFile } from '../../lib/reconciliation/io.ts';
import { readBankCashbookTable } from '../../lib/reconciliation/bank-statement-match.ts';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const temp = mkdtempSync(join(tmpdir(), 'cashbook-measure-'));
const H = ['Date', 'Voucher', 'Description', 'Reference', 'Receipts', 'Payments'];
async function make(name, edit = () => {}, xml) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cashbook');
  ws.addRow(H);
  ws.addRow(['2027-01-05', 'RV-1', 'Synthetic receipt', 'FT1', '1150.00', null]);
  ws.addRow(['2027-01-06', 'PV-1', 'Synthetic payment', 'FT2', null, '200.00']);
  ws.addRow(['2027-01-07', 'RV-2', 'Synthetic transfer', 'FT3', '75.50', null]);
  edit(ws, wb);
  const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
  if (xml) await xml(zip);
  writeFileSync(join(temp, `${name}.xlsx`), await zip.generateAsync({ type: 'nodebuffer' }));
}
// A planted edit that changes nothing would measure an unplanted case.
const sheetXml = (f) => async (zip) => {
  const p = 'xl/worksheets/sheet1.xml';
  const before = await zip.file(p).async('string');
  const after = f(before);
  if (after === before) throw Error('the planted XML edit did not apply');
  zip.file(p, after);
};
const lexeme = (cell, digits) =>
  sheetXml((s) => s.replace(new RegExp(`(<c r="${cell}"[^>]*><v>)[^<]*(</v>)`), `$1${digits}$2`));
const core = (body) => async (zip) => zip.file('docProps/core.xml', body);
const typed = (ws) => {
  for (const [ref, v] of [['E2', 1150], ['F3', 200], ['E4', 75.5]]) {
    ws.getCell(ref).value = v;
    ws.getCell(ref).numFmt = '0.00';
  }
};
const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const D = 'http://purl.org/dc/elements/1.1/', T = 'http://purl.org/dc/terms/';
const planted = [];
const add = async (name, edit, xml) => { await make(name, edit, xml); planted.push(name); };
await add('ok-plain');
await add('ok-typed-0.00', typed);
await add('ok-typed-thousands', (ws) => { typed(ws); for (const r of ['E2', 'F3', 'E4']) ws.getCell(r).numFmt = '#,##0.00'; });
await add('ok-typed-dates', (ws) => { for (const [r, d] of [['A2', 5], ['A3', 6], ['A4', 7]]) { ws.getCell(r).value = new Date(Date.UTC(2027, 0, d)); ws.getCell(r).numFmt = 'yyyy-mm-dd'; } });
await add('ok-builtin-date-14', (ws) => { ws.getCell('A2').value = new Date(Date.UTC(2027, 0, 5)); ws.getCell('A2').numFmt = 'mm-dd-yy'; });
await add('ok-amount-lexeme', (ws) => { ws.getCell('E2').value = 1150; }, lexeme('E2', '1149.9999999999999'));
await add('ok-core-default-namespace', () => {}, core(`<?xml version="1.0" encoding="UTF-8"?><coreProperties xmlns="${CP}" xmlns:dc="${D}" xmlns:dcterms="${T}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>synthetic</dc:creator><lastModifiedBy>synthetic</lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2027-01-31T12:00:00Z</dcterms:created></coreProperties>`));
await add('ok-hidden-row', (ws) => (ws.getRow(3).hidden = true));
await add('ok-padded-reference', (ws) => { ws.getCell('D3').value = 17; ws.getCell('D3').numFmt = '000000'; });
await add('ok-theme-dark-font', (ws) => (ws.getCell('C2').font = { bold: true, color: { theme: 1 } }));
await add('ok-light-fill', (ws) => { ws.getCell('C2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } }; });
await add('ok-date-with-time', (ws) => { ws.getCell('A2').value = new Date(Date.UTC(2027, 0, 5, 9, 30)); ws.getCell('A2').numFmt = 'yyyy-mm-dd hh:mm'; });
await add('ok-boolean-description', (ws) => (ws.getCell('C3').value = true));
await add('cell-white-font', (ws) => (ws.getCell('F3').font = { color: { argb: 'FFFFFFFF' } }));
await add('cell-gray-on-gray', (ws) => { ws.getCell('C2').font = { color: { argb: 'FF808080' } }; ws.getCell('C2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F7F7F' } }; });
await add('cell-hidden-column', (ws) => (ws.getColumn(5).hidden = true));
// ExcelJS writes neither a zero width nor showZeros, so these two are set in the XML.
await add('cell-zero-width', (ws) => (ws.getColumn(3).width = 0), sheetXml((s) => s.replace('<col min="3" max="3"', '<col min="3" max="3" width="0"')));
await add('cell-formula', (ws) => (ws.getCell('E2').value = { formula: '1000+150', result: 1150 }));
await add('cell-error', (ws) => (ws.getCell('C3').value = { error: '#N/A' }));
await add('cell-merge', (ws) => ws.mergeCells('C2:D2'));
await add('cell-voucher-1e19', (ws) => (ws.getCell('B3').value = Number('12345678901234567890')));
await add('cell-reference-format', (ws) => { ws.getCell('D3').value = 17; ws.getCell('D3').numFmt = '0.00'; });
await add('cell-reference-lexeme', (ws) => (ws.getCell('D2').value = 1709.1), lexeme('D2', '1709.0999999999999'));
await add('cell-sign-hidden', (ws) => { ws.getCell('F3').value = -200; ws.getCell('F3').numFmt = '0.00;0.00'; });
await add('cell-text-format', (ws) => (ws.getCell('C2').numFmt = '0;0;0;"x"'));
await add('cell-rich-white-run', (ws) => (ws.getCell('C2').value = { richText: [{ text: 'Synthetic ' }, { text: 'receipt', font: { color: { argb: 'FFFFFFFF' } } }] }));
await add('cell-zero-hidden', (ws) => { ws.getCell('F2').value = 0; ws.views = [{}]; }, sheetXml((s) => s.replace('<sheetView ', '<sheetView showZeros="0" ')));
// A typed zero in the unused amount column: shown as "-" it reads; shown
// empty it is refused like a hidden zero (an owner decision in the G16 report).
const zeros = (format) => (ws) => {
  typed(ws);
  for (const [ref, v] of [['F2', 0], ['E3', 0], ['F4', 0]]) {
    ws.getCell(ref).value = v;
    ws.getCell(ref).numFmt = format;
  }
};
await add('ok-zero-dash', zeros('#,##0.00;-#,##0.00;"-"'));
await add('cell-zero-empty-section', zeros('#,##0.00;-#,##0.00;'));
await add('sheet-hidden', (ws) => (ws.state = 'hidden'));
await add('header-two-sheets', (_, wb) => wb.addWorksheet('Notes').addRow(['synthetic']));
await add('header-extra-column', (ws) => (ws.getCell('G3').value = 'note'));
await add('header-typo', (ws) => (ws.getCell('B1').value = 'Voucher No'));
await add('header-styled-empty-g', (ws) => (ws.getCell('G2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } }));
await add('row-empty', (ws) => { ws.spliceRows(3, 0, []); ws.getCell('A3').value = ''; });
await add('voucher-repeated', (ws) => (ws.getCell('B4').value = 'RV-1'));
await add('date-invalid', (ws) => (ws.getCell('A3').value = '2027-02-30'));
await add('amount-both', (ws) => (ws.getCell('F2').value = '1.00'));
await add('amount-three-decimals', (ws) => { ws.getCell('E2').value = 12.345; ws.getCell('E2').numFmt = '0.000'; });
await add('xlsx-core-unknown-default', () => {}, core(`<?xml version="1.0" encoding="UTF-8"?><coreProperties xmlns="${CP}" xmlns:dc="${D}"><dc:creator>synthetic</dc:creator><appVersion>1</appVersion></coreProperties>`));
await add('xlsx-core-unknown-literal', () => {}, core(`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${D}"><dc:creator>synthetic</dc:creator><cp:appVersion>1</cp:appVersion></cp:coreProperties>`));
await add('ok-core-unclosed', () => {}, core(`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="${CP}"><cp:lastModifiedBy>`));
await add('xlsx-doctype', () => {}, sheetXml((s) => s.replace('?>', '?><!DOCTYPE worksheet>')));
await add('limit-conditional-format', (ws) => ws.addConditionalFormatting({ ref: 'E2:E4', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [1000], style: { font: { bold: true } }, priority: 1 }] }));

async function product(path) {
  try {
    const file = await readFile(path.split('/').pop(), Uint8Array.from(readFileSync(path)).buffer);
    return { refused: null, entries: readBankCashbookTable(file, 'SAR') };
  } catch (e) {
    const m = /BANK_CASHBOOK_([A-Z]+): row (\d+)/.exec(e.message);
    return { refused: { code: m ? m[1] : 'XLSX', row: m ? Number(m[2]) : 0 }, entries: [] };
  }
}
function check(files, ...options) {
  const run = spawnSync('python3', ['-B', 'cashbook.py', ...options, ...files], {
    cwd: import.meta.dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw Error(run.stderr);
  return JSON.parse(run.stdout);
}
const verdict = (r) => (r.refused ? `${r.refused.code} row ${r.refused.row}` : 'read');
const compare = async (files, label) => {
  const checked = check(files);
  const out = [];
  for (const file of files) {
    const p = await product(file), c = checked[file];
    out.push({
      [label]: label === 'file' ? relative(root, file) : file.split('/').pop().replace(/\.xlsx$/, ''),
      product: verdict(p),
      check: verdict(c),
      entries: p.entries.length,
      agree: verdict(p) === verdict(c) && isDeepStrictEqual(p.entries, c.entries),
      // What the check saw, so a case that planted nothing shows as such.
      exercised: c.exercised,
      notes: c.notes,
    });
  }
  return out;
};
try {
  const sealed = globSync(join(root, 'audit/bank-statement-*/frozen/*-cashbook.xlsx')).sort();
  const files = planted.map((name) => join(temp, `${name}.xlsx`));
  const retro = (option) => Object.entries(check(sealed, option))
    .filter(([, r]) => r.refused).map(([f, r]) => `${f.split('/').pop().slice(0, 3)} ${verdict(r)}: ${r.refused.detail}`);
  const report = {
    schema: 'tarasuf-bnk-pdf1-cashbook-check/1',
    question: 'Does the pre-seal check read each cashbook as the product reads it?',
    sealed: await compare(sealed, 'file'),
    planted: await compare(files, 'case'),
    // The check with the reader's rules before G8 and before G15: what it
    // would have refused on the sealed cashbooks.
    retro: { beforeG8: retro('--before-g8'), beforeG15: retro('--before-g15') },
    declaredDifferences: ['limit-conditional-format: the check refuses any conditional format; the product reads one that keeps the cell readable'],
  };
  report.summary = {
    sealed: `${report.sealed.filter((r) => r.agree).length}/${report.sealed.length}`,
    planted: `${report.planted.filter((r) => r.agree).length}/${report.planted.length}`,
    disagreements: report.planted.filter((r) => !r.agree).map((r) => r.case),
  };
  const text = `${JSON.stringify(report, null, 1)}\n`;
  if (flag('--out')) writeFileSync(flag('--out'), text);
  if (flag('--assert')) {
    const recorded = JSON.parse(readFileSync(flag('--assert'), 'utf8'));
    if (!isDeepStrictEqual(recorded, report)) {
      console.error(text);
      throw Error(`the cashbook check no longer reads as recorded in ${flag('--assert')}`);
    }
  }
  console.log(JSON.stringify(report.summary));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
