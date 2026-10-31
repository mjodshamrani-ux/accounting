// G12 statements written by jsPDF with jspdf-autotable, as a web application
// writes them: each page's letterhead by doc.text, its table by autoTable in
// one of autoTable's themes, its footer centred below. jsPDF shapes Arabic
// and orders each line itself. Its bidi engine takes a line as left-to-right
// unless told otherwise, which would put a right-to-left line's segments and
// trailing marks on the wrong side, so a right-to-left statement passes its
// right-to-left mode (logical right-to-left in, visual left-to-right out) to
// every text it writes, autoTable's included. The creation date and file
// identifier are fixed, so the same statements give the same bytes. A
// statement whose table runs onto a page of its own, or a cell autoTable
// breaks inside a word, is an error.
//
//   node render_jspdf.mjs <node_modules dir> <statements.json>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [modules, jobs] = process.argv.slice(2);
const require = createRequire(join(modules, 'package.json'));
const { jsPDF } = require('jspdf');
const { autoTable } = require('jspdf-autotable');

const MARGIN = 36;
const CREATED = new Date(Date.UTC(2026, 9, 23));
// autoTable's grid theme heads its table in white on a light green that
// statements avoid; the grid statements take a darker one. The theme also
// fills each body cell white and strokes its border in one operation
// (re ... B). The product's reader takes a shape filled and stroked at once
// as a drawing over the text inside it and refuses the page, a refusal it
// declares, so a statement drawn that way is not an eligible positive (the
// pre-seal eligibility check found it in the first drafts). The grid
// statements draw their cells stroked only, as autoTable does when a cell
// has no fill colour.
const GRID_HEAD = [18, 110, 96];
const RTL = { isInputVisual: false, isOutputVisual: true, isInputRtl: true, isOutputRtl: false };

function register(doc, font) {
  if (!font.regular) return;
  for (const [style, path] of [['normal', font.regular], ['bold', font.bold]]) {
    const file = `${font.name}-${style}.ttf`;
    doc.addFileToVFS(file, readFileSync(path).toString('base64'));
    doc.addFont(file, font.name, style);
  }
}

function draw(statement) {
  const doc = new jsPDF({
    unit: 'pt', format: statement.paper, orientation: statement.orientation, compress: true,
    putOnlyUsedFonts: true,
  });
  doc.setCreationDate(CREATED);
  doc.setFileId(createHash('md5').update(statement.id).digest('hex').toUpperCase());
  doc.setDocumentProperties({ title: statement.title, creator: 'Tarasuf holdout G12' });
  register(doc, statement.font);
  if (statement.rtl) {
    const text = doc.text.bind(doc);
    doc.text = (lines, x, y, options = {}) => text(lines, x, y, { ...options, ...RTL });
  }
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const usable = width - 2 * MARGIN;
  const total = statement.widths.reduce((a, b) => a + b, 0);
  const columnStyles = Object.fromEntries(statement.widths.map((w, i) => [i, { cellWidth: (w / total) * usable }]));
  statement.pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    let y = MARGIN;
    for (const line of page.lines) {
      doc.setFont(statement.font.name, line.bold ? 'bold' : 'normal');
      doc.setFontSize(line.size);
      y += line.size;
      doc.text(line.text, statement.rtl ? width - MARGIN : MARGIN, y, { align: statement.rtl ? 'right' : 'left' });
      y += line.size * 0.3;
    }
    const cells = (row) => row.map((c) => ({ content: c.content, colSpan: c.colSpan, styles: { halign: c.halign } }));
    autoTable(doc, {
      startY: y + 8,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
      theme: statement.theme,
      head: [cells(page.head)],
      body: page.body.map(cells),
      styles: {
        font: statement.font.name, fontSize: statement.size, cellPadding: statement.padding,
        ...(statement.theme === 'grid' ? { fillColor: false } : {}),
      },
      headStyles: statement.theme === 'grid' ? { fillColor: GRID_HEAD } : {},
      columnStyles,
      willDrawCell: ({ cell }) => {
        const words = (text) => text.split(/\s+/).filter(Boolean).join(' ');
        if (words(String(cell.raw.content)) !== words(cell.text.join(' ')))
          throw Error(`${statement.id}: page ${index + 1}: ${cell.raw.content} broken inside a word`);
      },
    });
    if (doc.internal.getNumberOfPages() !== index + 1)
      throw Error(`${statement.id}: page ${index + 1}'s table ran onto another page`);
    doc.setFont(statement.font.name, 'normal');
    doc.setFontSize(statement.size);
    doc.text(page.footer, width / 2, height - MARGIN + statement.size, { align: 'center' });
  });
  writeFileSync(statement.out, Buffer.from(doc.output('arraybuffer')));
}

for (const statement of JSON.parse(readFileSync(jobs, 'utf8')).statements) draw(statement);
