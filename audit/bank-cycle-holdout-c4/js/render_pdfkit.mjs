// The G20 statement application: a Node service drawing statements with PDFKit.
//
//   node js/render_pdfkit.mjs <node_modules> <statements.json>
//
// It lays out its own table and draws each line of text through one helper,
// for English and Arabic alike:
// - Order: the line is put in display order by bidi-js (the Unicode
//   Bidirectional Algorithm), right to left as its base direction in an
//   Arabic statement, and cut into runs of one embedding level.
// - Runs: each run is drawn by its own PDFKit text call at the place the
//   runs before it end. PDFKit hands the run to fontkit, which shapes it by
//   the font's OpenType features (Arabic joining, ligatures, kerning) and
//   puts a run of Arabic script right to left: an Arabic word, and also a
//   run of Arabic-Indic digits. So the application gives fontkit each run in
//   the order that comes out as displayed: a run fontkit will turn round is
//   given reversed from its display order. A date in Arabic-Indic digits is
//   five runs: three of digits and two hyphens, which the algorithm sets
//   right to left between them.
// - Features: each call names its features, so PDFKit lays the run out in
//   one fontkit call rather than word by word.
// - Table: columns from the start edge (the right in Arabic), a heading row
//   filled, grey or ruled, rules as a grid, under each row, as stripes or
//   none; descriptions wrapped by word to their cell, each wrapped line
//   ordered by itself; control lines with their label across the first four
//   columns; a continuation in the description column; the footer as the
//   facts number the page. Amounts stand at the end edge of their cells
//   (the right in English); in an Arabic statement every other cell starts
//   at its right edge, and amounts do too unless the style puts them at the
//   end edge, the left.
// The document dates are fixed, so the bytes do not depend on the clock.
import { createRequire } from 'node:module';
import { createWriteStream, readFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';

const require = createRequire(`${process.argv[2]}/`);
const PDFDocument = require('pdfkit');
const bidi = require('bidi-js')();

const STAMP = new Date(Date.UTC(2029, 0, 31, 12, 0, 0));
const PAPER = { A4: ['A4', 'portrait'], Letter: ['LETTER', 'portrait'], 'A4-landscape': ['A4', 'landscape'] };
const WIDTHS = [0.095, 0.095, 0.31, 0.17, 0.11, 0.11, 0.11];
const FEATURES = ['kern', 'liga'];
const STRIPE = '#F1F2F4';
const RULE = '#595959';
const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const r2 = (v) => Math.round(v * 100) / 100;

/** The line in display order, as runs of one embedding level: [{text, level}], each run's text as displayed. */
function runs(text, rtl) {
  const levels = bidi.getEmbeddingLevels(text, rtl ? 'rtl' : 'ltr');
  const chars = [...text];
  const order = chars.map((_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
  }
  const mirrored = bidi.getMirroredCharactersMap(text, levels);
  const out = [];
  for (const i of order) {
    const ch = mirrored.get(i) ?? chars[i];
    const level = levels.levels[i];
    if (out.length && out[out.length - 1].level === level) out[out.length - 1].text += ch;
    else out.push({ text: ch, level });
  }
  return out;
}

/** What fontkit is given for a run displayed as `shown`: reversed when fontkit will set it right to left. */
function forFontkit(shown) {
  return ARABIC_SCRIPT.test(shown) ? [...shown].reverse().join('') : shown;
}

class Statement {
  constructor(job) {
    this.job = job;
    this.rtl = job.layout === 'ar';
    const [size, layout] = PAPER[job.paper];
    this.doc = new PDFDocument({
      size,
      layout,
      margin: 34,
      autoFirstPage: false,
      info: {
        Title: `${job.title} ${job.number}`,
        Author: job.bank,
        Creator: 'G20 statement application (PDFKit)',
        CreationDate: STAMP,
      },
    });
    this.doc.registerFont('400', job.regular);
    this.doc.registerFont('700', job.bold);
    this.size = job.size;
  }

  width(text, weight, size) {
    this.doc.font(weight).fontSize(size);
    return runs(text, this.rtl).reduce(
      (w, run) => w + this.doc.widthOfString(forFontkit(run.text), { features: FEATURES }),
      0,
    );
  }

  /** One line of text in a box from x of `width`, at its start or end edge; the start is the right in Arabic. */
  line(text, x, top, { weight = '400', size = this.size, width, align = 'start', colour = '#000000' } = {}) {
    const doc = this.doc;
    const w = this.width(text, weight, size);
    let pen = x;
    if (width !== undefined) {
      const atRight = (align === 'start') === this.rtl;
      pen = atRight ? x + width - w : x;
    }
    doc.font(weight).fontSize(size).fillColor(colour);
    for (const run of runs(text, this.rtl)) {
      const given = forFontkit(run.text);
      doc.text(given, pen, top, { lineBreak: false, features: FEATURES });
      pen += doc.widthOfString(given, { features: FEATURES });
    }
  }

  wrap(text, width) {
    const lines = [];
    let line = [];
    for (const word of text.split(/\s+/u).filter(Boolean)) {
      const candidate = [...line, word].join(' ');
      if (line.length && this.width(candidate, '400', this.size) > width) {
        lines.push(line.join(' '));
        line = [word];
      } else line.push(word);
    }
    if (line.length) lines.push(line.join(' '));
    return lines.length ? lines : [''];
  }

  columns(left, right) {
    const total = right - left;
    let x = left;
    const out = WIDTHS.map((w) => {
      const c = [x, w * total];
      x += w * total;
      return c;
    });
    return this.rtl ? out.map(([cx, w]) => [left + right - (cx + w), w]) : out;
  }

  amounts(k) {
    if (k < 4) return 'start';
    if (!this.rtl) return 'end';
    return this.job.style.amounts === 'end' ? 'end' : 'start';
  }

  rule(x0, y0, x1, y1, width = 0.5, colour = RULE) {
    this.doc.save().moveTo(x0, y0).lineTo(x1, y1).lineWidth(width).strokeColor(colour).stroke().restore();
  }

  fill(x, y, w, h, colour) {
    this.doc.save().rect(x, y, w, h).fill(colour).restore();
  }

  page(page) {
    const { job, doc } = this;
    const style = job.style;
    doc.addPage();
    const margin = 34;
    const left = margin;
    const right = doc.page.width - margin;
    let y = margin;
    this.line(job.bank, left, y, { weight: '700', size: 13.5, width: right - left });
    y += 19;
    this.line(job.title, left, y, { size: 10.5, width: right - left });
    y += 16;
    this.line(job.account, left, y, { size: 8.2, width: right - left });
    y += 16;
    const cols = this.columns(left, right);
    const pad = 3.2;
    doc.font('400').fontSize(this.size);
    const lh = doc.currentLineHeight();
    const rules = style.rules ?? 'grid';
    const heading = style.heading ?? 'rule';
    const headH = lh + 2 * pad + 1;
    if (heading === 'filled') this.fill(left, y, right - left, headH, `#${job.fill}`);
    if (heading === 'grey') this.fill(left, y, right - left, headH, '#DCDCDC');
    const ink = heading === 'filled' ? '#FFFFFF' : '#000000';
    cols.forEach(([x, w], k) => {
      this.line(job.headers[k], x + pad, y + pad, { weight: '700', width: w - 2 * pad, align: this.amounts(k), colour: ink });
    });
    const top = y;
    y += headH;
    if (heading === 'rule' || rules === 'rows' || rules === 'none') this.rule(left, y, right, y, 0.8, '#000000');
    const bounds = [];
    page.rows.forEach(({ kind, cells }, n) => {
      const rowTop = y;
      let h;
      const stripe = () => {
        if (rules === 'stripes' && n % 2) this.fill(left, y, right - left, h, STRIPE);
      };
      if (kind === 'movement' || kind === 'continuation') {
        const text = kind === 'movement' ? cells[2] : cells[0];
        const wrapped = this.wrap(text, cols[2][1] - 2 * pad);
        h = wrapped.length * lh + 2 * pad;
        stripe();
        wrapped.forEach((part, i) => this.line(part, cols[2][0] + pad, y + pad + i * lh, { width: cols[2][1] - 2 * pad }));
        if (kind === 'movement') {
          cols.forEach(([x, w], k) => {
            if (k !== 2) this.line(cells[k], x + pad, y + pad, { width: w - 2 * pad, align: this.amounts(k) });
          });
        }
      } else {
        h = lh + 2 * pad;
        stripe();
        const spanX = this.rtl ? cols[3][0] : cols[0][0];
        const spanW = cols[0][1] + cols[1][1] + cols[2][1] + cols[3][1];
        this.line(cells[0], spanX + pad, y + pad, { weight: '700', width: spanW - 2 * pad });
        const values = kind === 'label' ? [[6, cells[1]]] : [[4, cells[1]], [5, cells[2]]];
        for (const [k, value] of values) {
          const [x, w] = cols[k];
          this.line(value, x + pad, y + pad, { weight: '700', width: w - 2 * pad, align: this.amounts(k) });
        }
      }
      y += h;
      bounds.push([rowTop, y, kind === 'label' || kind === 'totals']);
      if (rules === 'rows') this.rule(left, y, right, y, 0.4);
    });
    if (rules === 'grid') {
      // Each row's own column edges: a control line's label spans the first
      // four columns, so no edge is drawn through it.
      for (const edge of [top, top + headH, ...bounds.map((b) => b[1])]) this.rule(left, edge, right, edge);
      const every = [...new Set(cols.flatMap(([x, w]) => [r2(x), r2(x + w)]))].sort((a, b) => a - b);
      const inside = new Set([1, 2, 3].map((k) => r2(this.rtl ? cols[k][0] + cols[k][1] : cols[k][0])));
      for (const x of every) this.rule(x, top, x, top + headH);
      for (const [rowTop, rowBottom, spanned] of bounds) {
        for (const x of every) if (!(spanned && inside.has(x))) this.rule(x, rowTop, x, rowBottom);
      }
    }
    if (y > doc.page.height - margin - 20) throw new Error(`${job.id} page ${page.footer}: the table runs off the page`);
    this.line(page.footer, left, doc.page.height - margin - 8, { size: 8, width: right - left, align: 'end' });
  }

  async write() {
    const out = createWriteStream(this.job.out);
    this.doc.pipe(out);
    for (const page of this.job.pages) this.page(page);
    this.doc.end();
    await finished(out);
  }
}

const { statements } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
for (const job of statements) await new Statement(job).write();
