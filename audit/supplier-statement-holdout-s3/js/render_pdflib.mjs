// The S3 statement application: a Node service drawing supplier statements with pdf-lib.
//
//   node js/render_pdflib.mjs <node_modules> <statements.json>
//
// pdf-lib writes a PDF from objects it builds itself; with @pdf-lib/fontkit
// it embeds a TrueType font as a Type0 font, subset, and shapes text by the
// font's OpenType features. The application lays out its own table from the
// job's columns and draws each line of text through one helper, for English
// and Arabic alike:
// - Order: the line is put in display order by bidi-js (the Unicode
//   Bidirectional Algorithm), right to left as its base direction in an
//   Arabic statement, and cut into runs of one embedding level. Each run is
//   drawn by its own drawText call; a run of Arabic script is given to
//   fontkit in reverse of its display order, since fontkit sets it right to
//   left; a bracket at an odd level is drawn as its mirror.
// - Table: columns from the start edge (the right in Arabic) at the job's
//   shares; a heading row filled, grey or ruled; rules as a grid, under each
//   row, as stripes or none; descriptions wrapped by word to their cell;
//   control lines with their label across the text columns before the first
//   amount column; the footer as the facts number the page. Amounts stand at
//   the end edge of their cells (the right in English); in an Arabic
//   statement other cells start at the right, and amounts do too unless the
//   style puts them at the end edge.
// pdf-lib's defaults are kept: object streams, its Producer, its fills and
// rules. The document dates are fixed, so the bytes do not depend on the clock.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(`${process.argv[2]}/`);
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const bidi = require('bidi-js')();

const STAMP = new Date(Date.UTC(2030, 0, 31, 12, 0, 0));
const PAPER = { A4: [595.28, 841.89], Letter: [612, 792], 'A4-landscape': [841.89, 595.28] };
const STRIPE = 'F1F2F4';
const RULE = '595959';
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u;
const r2 = (v) => Math.round(v * 100) / 100;
const colour = (hex) => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255,
  parseInt(hex.slice(4, 6), 16) / 255);

/** The line in display order, as runs of one embedding level: [{text, level}]. */
function runs(text, rtl) {
  const levels = bidi.getEmbeddingLevels(text, rtl ? 'rtl' : 'ltr');
  const chars = [...text];
  const order = chars.map((_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
  }
  // bidi-js 1.0.3 reads the levels array itself here, not the result object.
  const mirrored = bidi.getMirroredCharactersMap(text, levels.levels);
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
  constructor(job, doc, fonts) {
    this.job = job;
    this.doc = doc;
    this.fonts = fonts;
    this.rtl = job.language === 'ar';
    this.size = job.size;
  }

  width(text, weight, size) {
    const font = this.fonts[weight];
    return runs(text, this.rtl).reduce((w, run) => w + font.widthOfTextAtSize(forFontkit(run.text), size), 0);
  }

  /** One line of text whose top is `top`, in a box from x of `width`, at its start or end edge; the start is
   * the right in Arabic. Text wider than its box is refused, not drawn over the next cell. */
  line(text, x, top, { weight = '400', size = this.size, width, align = 'start', ink = '000000' } = {}) {
    if (!text) return;
    const font = this.fonts[weight];
    const w = this.width(text, weight, size);
    if (width !== undefined && w > width + 0.001) throw new Error(`${this.job.id}: ${JSON.stringify(text)} is wider than its cell`);
    let pen = x;
    if (width !== undefined) {
      const atRight = (align === 'start') === this.rtl;
      pen = atRight ? x + width - w : x;
    }
    const baseline = this.height - top - font.heightAtSize(size, { descender: false });
    for (const run of runs(text, this.rtl)) {
      const given = forFontkit(run.text);
      this.page.drawText(given, { x: pen, y: baseline, size, font, color: colour(ink) });
      pen += font.widthOfTextAtSize(given, size);
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
    const out = this.job.columns.map((c) => {
      const box = [x, c.share * total];
      x += c.share * total;
      return box;
    });
    return this.rtl ? out.map(([cx, w]) => [left + right - (cx + w), w]) : out;
  }

  align(k) {
    if (!this.job.columns[k].amount) return 'start';
    if (!this.rtl) return 'end';
    return this.job.style.amounts === 'end' ? 'end' : 'start';
  }

  rule(x0, y0, x1, y1, thickness = 0.5, ink = RULE) {
    this.page.drawLine({ start: { x: x0, y: this.height - y0 }, end: { x: x1, y: this.height - y1 }, thickness,
      color: colour(ink) });
  }

  fill(x, y, w, h, ink) {
    this.page.drawRectangle({ x, y: this.height - y - h, width: w, height: h, color: colour(ink) });
  }

  draw(page) {
    const { job } = this;
    const style = job.style;
    const [width, height] = PAPER[job.paper];
    this.page = this.doc.addPage([width, height]);
    this.height = height;
    const margin = 34;
    const left = margin;
    const right = width - margin;
    let y = margin;
    this.line(job.preamble[0], left, y, { weight: '700', size: 13.5, width: right - left });
    y += 19;
    this.line(job.preamble[1], left, y, { size: 10.5, width: right - left });
    y += 16;
    this.line(job.preamble[2], left, y, { size: 8.2, width: right - left });
    y += 16;
    const cols = this.columns(left, right);
    const desc = job.columns.findIndex((c) => c.key === 'desc');
    const firstAmount = job.columns.findIndex((c) => c.amount);
    const pad = 3.2;
    const lh = this.fonts['400'].heightAtSize(this.size) * 1.08;
    const rules = style.rules ?? 'grid';
    const heading = style.heading ?? 'rule';
    const headH = lh + 2 * pad + 1;
    if (heading === 'filled') this.fill(left, y, right - left, headH, job.fill);
    if (heading === 'grey') this.fill(left, y, right - left, headH, 'DCDCDC');
    const ink = heading === 'filled' ? 'FFFFFF' : '000000';
    cols.forEach(([x, w], k) => {
      this.line(job.columns[k].heading, x + pad, y + pad, { weight: '700', width: w - 2 * pad, align: this.align(k), ink });
    });
    const top = y;
    y += headH;
    if (heading === 'rule' || rules === 'rows' || rules === 'none') this.rule(left, y, right, y, 0.8, '000000');
    const bounds = [];
    page.rows.forEach((row, n) => {
      const rowTop = y;
      let h;
      const stripe = () => {
        if (rules === 'stripes' && n % 2) this.fill(left, y, right - left, h, STRIPE);
      };
      if (row.kind === 'movement') {
        const wrapped = this.wrap(row.cells[desc], cols[desc][1] - 2 * pad);
        h = wrapped.length * lh + 2 * pad;
        stripe();
        wrapped.forEach((part, i) => this.line(part, cols[desc][0] + pad, y + pad + i * lh, { width: cols[desc][1] - 2 * pad }));
        cols.forEach(([x, w], k) => {
          if (k !== desc) this.line(row.cells[k], x + pad, y + pad, { width: w - 2 * pad, align: this.align(k) });
        });
      } else {
        h = lh + 2 * pad;
        stripe();
        const span = cols.slice(0, firstAmount);
        const spanX = this.rtl ? span[span.length - 1][0] : span[0][0];
        const spanW = span.reduce((s, [, w]) => s + w, 0);
        this.line(row.label, spanX + pad, y + pad, { weight: '700', width: spanW - 2 * pad });
        for (const [k, value] of Object.entries(row.values)) {
          const [x, w] = cols[Number(k)];
          this.line(value, x + pad, y + pad, { weight: '700', width: w - 2 * pad, align: this.align(Number(k)) });
        }
      }
      y += h;
      bounds.push([rowTop, y, row.kind === 'control']);
      if (rules === 'rows') this.rule(left, y, right, y, 0.4);
    });
    if (rules === 'grid') {
      // Each row's own column edges: a control line's label spans the text
      // columns, so no edge is drawn through it.
      for (const edge of [top, top + headH, ...bounds.map((b) => b[1])]) this.rule(left, edge, right, edge);
      const every = [...new Set(cols.flatMap(([x, w]) => [r2(x), r2(x + w)]))].sort((a, b) => a - b);
      const inside = new Set(cols.slice(1, firstAmount).map(([x, w]) => r2(this.rtl ? x + w : x)));
      for (const x of every) this.rule(x, top, x, top + headH);
      for (const [rowTop, rowBottom, spanned] of bounds) {
        for (const x of every) if (!(spanned && inside.has(x))) this.rule(x, rowTop, x, rowBottom);
      }
    }
    if (y > height - margin - 20) throw new Error(`${job.id} page ${page.footer}: the table runs off the page`);
    this.line(page.footer, left, height - margin - 8, { size: 8, width: right - left, align: 'end' });
  }
}

const { statements } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
for (const job of statements) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {
    400: await doc.embedFont(readFileSync(job.regular), { subset: true }),
    700: await doc.embedFont(readFileSync(job.bold), { subset: true }),
  };
  doc.setTitle(`${job.preamble[1]} ${job.account}`);
  doc.setAuthor(job.preamble[0]);
  doc.setCreator('S3 statement application (pdf-lib)');
  doc.setCreationDate(STAMP);
  doc.setModificationDate(STAMP);
  const statement = new Statement(job, doc, fonts);
  for (const page of job.pages) statement.draw(page);
  writeFileSync(job.out, await doc.save());
}
