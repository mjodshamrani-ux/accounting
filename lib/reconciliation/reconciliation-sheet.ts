import JSZip from 'jszip';
import type { StripCellView, StripNote } from '../alignment-strip-view.ts';
import { reconciliationSheetCopy } from '../i18n/reconciliation-sheet.ts';
import { excelExportText, validateExportText } from './export-text.ts';

/**
 * The reconciliation sheet (UX-6): a first sheet, in the interface's
 * language, added to a workpaper whose evidence sheets are already written.
 * It is added as an extra part: its strings inline in its cells, its styles
 * appended after the evidence's, its name first in the workbook. Every
 * evidence sheet part and the shared strings stay byte for byte as the
 * existing export wrote them; only the workbook-level parts change. The
 * design record is docs/audits/UX-6-RECONCILIATION-SHEET.ar.md.
 */

export type SheetLanguage = 'ar' | 'en';

/** The request's language, or a refusal: nothing else is accepted. */
export function sheetLanguage(value: unknown): SheetLanguage {
  if (value === 'ar' || value === 'en') return value;
  throw new Error('RECONCILIATION_SHEET_LANGUAGE');
}

export type SheetTextStyle =
  | 'title'
  | 'subtitle'
  | 'section'
  | 'head'
  | 'label'
  | 'value'
  | 'hash'
  | 'note';

/** One value per cell: a text, an amount in minor units written in major
 * units at its currency's precision, a count, or a line left for a person to
 * write on (the sign-off). */
export type SheetCell =
  | { text: string; style: SheetTextStyle }
  /** `start`: aligned as the sheet's text is, where the amount stands among
   * words (the strip) rather than in a column of amounts. */
  | { minor: number; decimals: number; start?: true }
  /** Counts stand among words, and align as the sheet's text does. */
  | { count: number }
  | { line: true }
  | null;

export type ReconciliationSheet = {
  name: string;
  language: SheetLanguage;
  /** Column widths in characters, one per column used. */
  widths: number[];
  rows: SheetCell[][];
  /** Rows printed on one page where they fit, each as its first and last
   * row: a section's heading with its rows, a table's heading with its head
   * and first block, then each block of more than one row. */
  keep?: [number, number][];
};

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET = `${REL}/worksheet`;
const SHEET_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

const fail = (detail: string): never => {
  throw new Error(`RECONCILIATION_SHEET_${detail}`);
};
const xml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
/** A text as a cell holds it, escaped as OOXML and XML require; it was
 * checked as every exported text is before anything was built
 * (`checkCells`). */
const cellText = (value: string) => xml(String(excelExportText(value)));
const column = (index: number) => {
  let n = index + 1,
    name = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    name = String.fromCharCode(65 + m) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};
/** A sheet name Excel accepts, not already taken in the workbook. */
function checkName(name: string, taken: string[]) {
  if (
    !name ||
    name.length > 31 ||
    /[[\]:*?/\\]/.test(name) ||
    name.startsWith("'") ||
    name.endsWith("'")
  )
    fail('NAME');
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase()))
    fail('NAME_TAKEN');
}

const AMOUNT_FORMAT = (decimals: number) => {
  const d = decimals ? `.${'0'.repeat(decimals)}` : '';
  return `#,##0${d};-#,##0${d};0${d}`;
};

/** One list of the style sheet (fonts, borders, cell formats, number
 * formats): where it stands, and how many entries it holds, refused unless
 * its count says the same. A writer may add attributes after the count
 * (ExcelJS writes `<fonts count="2" x14ac:knownFonts="1">`). */
function styleList(styles: string, tag: string, child: string) {
  const open = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, 'g');
  const found = [...styles.matchAll(open)];
  if (found.length > 1) fail('STYLES');
  if (!found.length) return null;
  const start = found[0],
    count = /\bcount="(\d+)"/.exec(start[0]);
  const close = styles.indexOf(`</${tag}>`, start.index);
  if (!count || start[0].endsWith('/>') || close < 0) fail('STYLES');
  const body = styles.slice(start.index + start[0].length, close);
  const entries = (body.match(new RegExp(`<${child}(?=[\\s>/])`, 'g')) ?? [])
    .length;
  if (entries !== Number(count![1])) fail('STYLES');
  return { open: start[0], at: start.index, close, entries };
}
/** The list with entries added at its end and its count raised to match. */
function appendTo(styles: string, tag: string, child: string, add: string[]) {
  const list = styleList(styles, tag, child);
  if (!list) return fail('STYLES');
  const open = list.open.replace(
    /\bcount="\d+"/,
    `count="${list.entries + add.length}"`,
  );
  return (
    styles.slice(0, list.at) +
    open +
    styles.slice(list.at + list.open.length, list.close) +
    add.join('') +
    styles.slice(list.close)
  );
}

/** A character's width in the sheet's column units, each counted as wide
 * as a digit of the 11-point Calibri the widths are counted in: the style's
 * font size against 11, and for the fingerprint's 8-point Courier New, whose
 * every glyph is 0.6 of its size, 6.4 pixels against the digit's 7. */
const SCALE: Record<SheetTextStyle, number> = {
  title: 16 / 11,
  subtitle: 12 / 11,
  section: 12 / 11,
  head: 1,
  label: 1,
  value: 1,
  hash: 0.92,
  note: 9 / 11,
};
/** One line's height in points, by the style's font size. */
const LINE: Record<SheetTextStyle, number> = {
  title: 22,
  subtitle: 16,
  section: 16,
  head: 15,
  label: 15,
  value: 15,
  hash: 11,
  note: 12,
};
/** Characters a cell shows in a line, counted wide so a row is never
 * written shorter than its text: a wide character (CJK, an emoji, anything
 * beyond the basic plane) two, a combining mark none, any other one. */
function units(text: string) {
  let n = 0;
  for (const ch of text) {
    if (/\p{M}/u.test(ch)) continue;
    const cp = ch.codePointAt(0)!;
    n +=
      cp > 0xffff ||
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xff60)
        ? 2
        : 1;
  }
  return n;
}
/** Lines a text takes when it wraps at a capacity, word by word, a word
 * longer than a line broken across lines. */
function lineCount(text: string, capacity: number) {
  let count = 0;
  for (const paragraph of text.split('\n')) {
    count++;
    let line = 0;
    for (const word of paragraph.split(' ')) {
      const w = units(word);
      if (line && line + 1 + w <= capacity) {
        line += 1 + w;
        continue;
      }
      if (line) count++;
      const extra = Math.max(0, Math.ceil(w / capacity) - 1);
      count += extra;
      line = w - extra * capacity;
    }
  }
  return count;
}
/**
 * Which texts wrap, and how tall their rows are written. A text runs on into
 * the empty cells after it in its row, whole, as the fingerprint must (UX-3
 * fixed it cut on the screen); one longer than that room, or with a line
 * break, wraps in its own cell, and its row is given the height of its
 * lines, since not every reader measures a row (UX-6(b): a reviewer's
 * reason, a long list of members).
 */
function wrapPlan(sheet: ReconciliationSheet) {
  const wrapped = new Set<string>(),
    heights = new Map<number, number>();
  sheet.rows.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      if (!cell || !('text' in cell) || !cell.text) return;
      let room = sheet.widths[c] ?? 0;
      for (
        let next = c + 1;
        next < sheet.widths.length &&
        (!cells[next] ||
          ('text' in cells[next]! && !(cells[next] as { text: string }).text));
        next++
      )
        room += sheet.widths[next];
      const scale = SCALE[cell.style];
      if (
        !cell.text.includes('\n') &&
        units(cell.text) * scale <= room - 1
      )
        return;
      wrapped.add(`${r}:${c}`);
      const capacity = Math.max(
        1,
        Math.floor((sheet.widths[c] ?? 1) / scale) - 1,
      );
      heights.set(
        r,
        Math.max(
          heights.get(r) ?? 15,
          lineCount(cell.text, capacity) * LINE[cell.style] + 2,
        ),
      );
    }),
  );
  return { wrapped, heights };
}

/**
 * Where the printed sheet is broken by hand (UX-6(b)). Excel and LibreOffice
 * break a page wherever the next row does not fit, which left a section's
 * heading, a table's head or half the sign-off at the foot of a page with
 * what it names on the next. A sheet whose rows fit one page is given no
 * break; a longer one is broken above any group of rows that would not fit
 * what is left of its page, where the group fits a page. A4 portrait at the
 * sheet's margins holds 748 points of rows as LibreOffice prints them
 * (measured: a row ending 748.5 points below the top margin fits, one ending
 * at 749 does not); the plan uses 746, so a row two points taller than
 * estimated still fits. A row is as tall as written when its text wraps, 20
 * points for the title and 15 otherwise, as LibreOffice draws them.
 */
const ONE_PAGE = 748;
const PAGE = 746;
function pageBreaks(
  sheet: ReconciliationSheet,
  heights: Map<number, number>,
) {
  const tall = sheet.rows.map(
    (cells, r) =>
      heights.get(r) ??
      (cells.some((c) => c && 'text' in c && c.style === 'title') ? 20 : 15),
  );
  if (tall.reduce((a, b) => a + b, 0) <= ONE_PAGE) return [];
  const groups = new Map((sheet.keep ?? []).map(([a, b]) => [a, b]));
  const breaks: number[] = [];
  let used = 0;
  tall.forEach((height, r) => {
    const last = groups.get(r);
    if (last !== undefined && used > 0) {
      let group = 0;
      for (let i = r; i <= last; i++) group += tall[i];
      if (used + group > PAGE && group <= PAGE) {
        breaks.push(r);
        used = 0;
      }
    }
    // Past the plan, the reader breaks where the next row does not fit.
    used = used + height > PAGE ? height : used + height;
  });
  return breaks;
}

/** The styles the sheet uses, appended after every existing one, so each
 * index the evidence sheets hold keeps its meaning. */
function appendStyles(
  styles: string,
  sheet: ReconciliationSheet,
  wrapped: Set<string>,
) {
  const size = (tag: string, child: string) =>
    styleList(styles, tag, child)?.entries ?? fail('STYLES');
  const fonts = size('fonts', 'font'),
    borders = size('borders', 'border'),
    xfs = size('cellXfs', 'xf');
  const rtl = sheet.language === 'ar';
  // Fonts appended in this order.
  const fontXml = [
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="16"/><name val="Calibri"/><family val="2"/></font>',
    '<font><sz val="12"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
    '<font><sz val="8"/><name val="Courier New"/><family val="3"/></font>',
    '<font><i/><sz val="9"/><name val="Calibri"/><family val="2"/></font>',
  ];
  const FONT = {
    value: 0,
    title: 1,
    subtitle: 2,
    section: 3,
    head: 4,
    hash: 5,
    note: 6,
  } as const;
  // A light rule under a table's head, and a darker one to sign on.
  const borderXml = [
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FF404040"/></bottom><diagonal/></border>',
  ];
  // Number formats: one per precision the sheet writes.
  const precisions = [
    ...new Set(
      sheet.rows.flatMap((r) =>
        r.flatMap((c) => (c && 'minor' in c ? [c.decimals] : [])),
      ),
    ),
  ].sort((a, b) => a - b);
  const existingIds = [...styles.matchAll(/<numFmt numFmtId="(\d+)"/g)].map(
    (m) => Number(m[1]),
  );
  let nextId = Math.max(163, ...existingIds) + 1;
  const formats = precisions.map((d) => ({ d, id: nextId++ }));
  const formatXml = formats.map(
    (f) =>
      `<numFmt numFmtId="${f.id}" formatCode="${xml(AMOUNT_FORMAT(f.d))}"/>`,
  );
  // A text wraps only where its plan says (`wrapPlan`); elsewhere it runs on
  // into the empty cells beside it.
  const align = (wrap = false) =>
    `<alignment horizontal="${rtl ? 'right' : 'left'}" vertical="top"${wrap ? ' wrapText="1"' : ''} readingOrder="${rtl ? 2 : 1}"/>`;
  const textStyles: SheetTextStyle[] = [
    'title',
    'subtitle',
    'section',
    'head',
    'label',
    'value',
    'hash',
    'note',
  ];
  const xf: string[] = [];
  const index = new Map<string, number>();
  const wrapStyles = new Set(
    [...wrapped].map((at) => {
      const [r, c] = at.split(':').map(Number);
      return (sheet.rows[r][c] as { style: SheetTextStyle }).style;
    }),
  );
  for (const wrap of [false, true])
    for (const s of textStyles) {
      if (wrap && !wrapStyles.has(s)) continue;
      const font = fonts + (s === 'label' ? FONT.value : FONT[s]);
      const border =
        s === 'head' ? ` borderId="${borders}" applyBorder="1"` : '';
      index.set(wrap ? `${s}:wrap` : s, xfs + xf.length);
      xf.push(
        `<xf numFmtId="0" fontId="${font}" fillId="0"${border || ' borderId="0"'} xfId="0" applyFont="1" applyAlignment="1">${align(wrap)}</xf>`,
      );
    }
  // A number keeps a left-to-right reading order in either language, so its
  // sign stays before it («-50.00», never «50.00-»); it aligns where the
  // sheet's text starts. Every number stands at the top of its row, as the
  // text does, level with its label when a text beside it wraps.
  const start = `<alignment horizontal="${rtl ? 'right' : 'left'}" vertical="top" readingOrder="1"/>`;
  for (const f of formats) {
    index.set(`amount:${f.d}`, xfs + xf.length);
    xf.push(
      `<xf numFmtId="${f.id}" fontId="${fonts + FONT.value}" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>`,
    );
    index.set(`amount:${f.d}:start`, xfs + xf.length);
    xf.push(
      `<xf numFmtId="${f.id}" fontId="${fonts + FONT.value}" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1">${start}</xf>`,
    );
  }
  index.set('count', xfs + xf.length);
  xf.push(
    `<xf numFmtId="1" fontId="${fonts + FONT.value}" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1">${start}</xf>`,
  );
  index.set('line', xfs + xf.length);
  xf.push(
    `<xf numFmtId="0" fontId="${fonts + FONT.value}" fillId="0" borderId="${borders + 1}" xfId="0" applyBorder="1"/>`,
  );
  let out = appendTo(styles, 'fonts', 'font', fontXml);
  out = appendTo(out, 'borders', 'border', borderXml);
  out = appendTo(out, 'cellXfs', 'xf', xf);
  if (formats.length) {
    if (styleList(out, 'numFmts', 'numFmt'))
      out = appendTo(out, 'numFmts', 'numFmt', formatXml);
    else {
      const open = /<styleSheet[^>]*>/.exec(out);
      if (!open) fail('STYLES');
      out = out.replace(
        open![0],
        `${open![0]}<numFmts count="${formats.length}">${formatXml.join('')}</numFmts>`,
      );
    }
  }
  return { styles: out, index };
}

/** Every cell checked before anything is built from it: a text as every
 * exported text is, an amount a safe integer at a precision of 0 to 4, a
 * count a safe integer from 0. */
function checkCells(sheet: ReconciliationSheet) {
  for (const cells of sheet.rows)
    for (const cell of cells) {
      if (!cell || 'line' in cell) continue;
      if ('text' in cell)
        validateExportText(cell.text, 'RECONCILIATION_SHEET_TEXT');
      else if ('minor' in cell) {
        if (!Number.isSafeInteger(cell.minor)) fail('AMOUNT');
        if (
          !Number.isInteger(cell.decimals) ||
          cell.decimals < 0 ||
          cell.decimals > 4
        )
          fail('DECIMALS');
      } else if (!Number.isSafeInteger(cell.count) || cell.count < 0)
        fail('COUNT');
    }
}

function sheetXml(
  sheet: ReconciliationSheet,
  index: Map<string, number>,
  { wrapped, heights }: ReturnType<typeof wrapPlan>,
) {
  const rows: string[] = [];
  let width = 0;
  sheet.rows.forEach((cells, r) => {
    const out: string[] = [];
    cells.forEach((cell, c) => {
      if (!cell) return;
      width = Math.max(width, c + 1);
      const ref = `${column(c)}${r + 1}`;
      if ('text' in cell) {
        if (!cell.text) return;
        const style = wrapped.has(`${r}:${c}`)
          ? `${cell.style}:wrap`
          : cell.style;
        out.push(
          `<c r="${ref}" t="inlineStr" s="${index.get(style)}"><is><t xml:space="preserve">${cellText(cell.text)}</t></is></c>`,
        );
      } else if ('minor' in cell) {
        out.push(
          `<c r="${ref}" s="${index.get(`amount:${cell.decimals}${cell.start ? ':start' : ''}`)}"><v>${cell.minor / 10 ** cell.decimals}</v></c>`,
        );
      } else if ('line' in cell) {
        out.push(`<c r="${ref}" s="${index.get('line')}"/>`);
      } else {
        out.push(
          `<c r="${ref}" s="${index.get('count')}"><v>${cell.count}</v></c>`,
        );
      }
    });
    const height = heights.get(r);
    if (out.length)
      rows.push(
        `<row r="${r + 1}"${height ? ` ht="${height}" customHeight="1"` : ''}>${out.join('')}</row>`,
      );
  });
  const cols = sheet.widths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
    )
    .join('');
  const last = sheet.rows.length || 1;
  // A break stands above the row it names (zero-based).
  const breaks = pageBreaks(sheet, heights);
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<worksheet xmlns="${MAIN}" xmlns:r="${REL}">` +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:${column(Math.max(width, 1) - 1)}${last}"/>` +
    `<sheetViews><sheetView${sheet.language === 'ar' ? ' rightToLeft="1"' : ''} showGridLines="0" workbookViewId="0"/></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
    (breaks.length
      ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map((r) => `<brk id="${r}" max="16383" man="1"/>`).join('')}</rowBreaks>`
      : '') +
    '</worksheet>'
  );
}

/**
 * The workpaper with the reconciliation sheet first. The evidence parts are
 * copied as they are; a workbook whose sheets mark a selected tab is refused
 * rather than opened with two tabs grouped.
 */
export async function addReconciliationSheet(
  workpaper: ArrayBuffer,
  sheet: ReconciliationSheet,
): Promise<ArrayBuffer> {
  sheetLanguage(sheet.language);
  checkCells(sheet);
  const zip = await JSZip.loadAsync(workpaper);
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) fail('PART');
    return file!.async('string');
  };
  const workbook = await read('xl/workbook.xml'),
    rels = await read('xl/_rels/workbook.xml.rels'),
    types = await read('[Content_Types].xml'),
    styles = await read('xl/styles.xml');
  const parts = Object.keys(zip.files).filter((n) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
  );
  if (!parts.length) fail('PART');
  for (const name of parts)
    if (/tabSelected="1"/.test(await read(name))) fail('TAB_SELECTED');
  const taken = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(
    (m) =>
      m[1]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
  );
  checkName(sheet.name, taken);
  const part = `sheet${Math.max(...parts.map((n) => Number(/sheet(\d+)\.xml$/.exec(n)![1]))) + 1}.xml`;
  const rid = `rId${Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1}`;
  const sheetId =
    Math.max(
      0,
      ...[...workbook.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1])),
    ) + 1;
  if (!/<sheets>/.test(workbook)) fail('WORKBOOK');
  const plan = wrapPlan(sheet);
  const { styles: nextStyles, index } = appendStyles(
    styles,
    sheet,
    plan.wrapped,
  );
  zip.file(`xl/worksheets/${part}`, sheetXml(sheet, index, plan));
  zip.file('xl/styles.xml', nextStyles);
  zip.file(
    'xl/workbook.xml',
    workbook
      .replace(
        '<sheets>',
        `<sheets><sheet name="${xml(sheet.name)}" sheetId="${sheetId}" r:id="${rid}"/>`,
      )
      // A name tied to a sheet's position keeps its sheet.
      .replace(
        /localSheetId="(\d+)"/g,
        (_, n) => `localSheetId="${Number(n) + 1}"`,
      ),
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    rels.replace(
      '</Relationships>',
      `<Relationship Id="${rid}" Type="${WORKSHEET}" Target="worksheets/${part}"/></Relationships>`,
    ),
  );
  zip.file(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      `<Override PartName="/xl/worksheets/${part}" ContentType="${SHEET_TYPE}"/></Types>`,
    ),
  );
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** The sheet's sections, in the order the design record sets: scope,
 * sources, alignment, the engine's differences, decisions, sign-off, then
 * the engine's claim. A section with nothing in it is not written. */
export type SheetSection =
  | {
      kind: 'pairs';
      title: string;
      /** The evidence sheet the section's values stand in. */
      evidence?: string;
      rows: { label: string; value: SheetCell }[];
    }
  | {
      kind: 'sources';
      title: string;
      evidence: string;
      sources: { role: string; name: string; hash: string }[];
    }
  | {
      kind: 'strip';
      title: string;
      evidence?: string;
      cells: StripCellView[];
      decimals: number;
      /** Each record's own total, as the strip draws it at either end:
       * the record's name, then its total or why it has none. */
      totals?: { label: string; value: SheetCell }[];
      /** Rows the screen shows beside the strip (what is missing). */
      more?: { label: string; value: string }[];
    }
  | {
      kind: 'table';
      title: string;
      evidence: string;
      /** The table's head; none where each row says what it is, as a list
       * of records under each document does. */
      head: string[];
      rows: SheetCell[][];
      /** Rows that belong together on a printed page, as counts in order: a
       * document and its movements. Each row stands alone where none is
       * given. */
      blocks?: number[];
    }
  | { kind: 'signature' }
  | { kind: 'claim'; text: string; evidence: string };

/** Four columns: wide enough together for a whole SHA-256 fingerprint to run
 * on from the second, for the strip's longest note in the second, and for a
 * section's evidence note in the last two. */
const WIDTHS = [24, 24, 22, 22];

const text = (value: string, style: SheetTextStyle): SheetCell => ({
  text: value,
  style,
});

/**
 * The sheet laid out from its sections, in the interface's language: each
 * value in a cell of its own, a count as a number, an amount as a number at
 * its currency's precision. The words come from the callers, which take
 * them from the catalogues the screen uses.
 */
export function composeSheet(
  language: SheetLanguage,
  { title, sections }: { title: string; sections: SheetSection[] },
): ReconciliationSheet {
  const w = reconciliationSheetCopy[sheetLanguage(language)];
  const rows: SheetCell[][] = [[text(w.name, 'title')], [text(title, 'subtitle')]];
  const keep: [number, number][] = [];
  // From this section's heading to the last row written.
  const whole = () => keep.push([at, rows.length - 1]);
  let at = 0;
  const heading = (name: string, evidence?: string) => {
    rows.push([]);
    at = rows.length;
    rows.push([
      text(name, 'section'),
      null,
      ...(evidence
        ? [text(w.evidence, 'note'), text(evidence, 'note')]
        : []),
    ]);
  };
  // A note on a row of its own: its words in the second column, what it
  // says in the third, running on into the fourth.
  const note = (n: StripNote): SheetCell[] => [
    null,
    text(n.text, 'note'),
    n.value === undefined
      ? null
      : typeof n.value === 'number'
        ? { count: n.value }
        : text(n.value, 'value'),
  ];
  for (const section of sections) {
    if (section.kind === 'pairs') {
      if (!section.rows.length) continue;
      heading(section.title, section.evidence);
      for (const r of section.rows)
        rows.push([text(r.label, 'label'), r.value]);
      whole();
    } else if (section.kind === 'sources') {
      if (!section.sources.length) continue;
      heading(section.title, section.evidence);
      for (const s of section.sources) {
        rows.push([text(s.role, 'label'), text(s.name, 'value')]);
        rows.push([text(w.fingerprint, 'note'), text(s.hash, 'hash')]);
      }
      whole();
    } else if (section.kind === 'strip') {
      heading(section.title, section.evidence);
      for (const t of section.totals ?? [])
        rows.push([text(t.label, 'label'), t.value]);
      for (const cell of section.cells) {
        const value: SheetCell[] =
          cell.value.kind === 'text'
            ? [text(cell.value.text, 'value')]
            : cell.value.kind === 'amount'
              ? [
                  {
                    minor: cell.value.minor,
                    decimals: section.decimals,
                    start: true,
                  },
                ]
              : [
                  { count: cell.value.count },
                  ...(cell.value.of === undefined
                    ? []
                    : [text(w.of, 'value'), { count: cell.value.of }]),
                ];
        rows.push([text(cell.label, 'label'), ...value]);
        for (const n of cell.notes) rows.push(note(n));
      }
      for (const m of section.more ?? [])
        rows.push([text(m.label, 'label'), text(m.value, 'value')]);
      whole();
    } else if (section.kind === 'table') {
      if (!section.rows.length) continue;
      const blocks = section.blocks ?? section.rows.map(() => 1);
      if (blocks.reduce((a, b) => a + b, 0) !== section.rows.length)
        fail('BLOCKS');
      heading(section.title, section.evidence);
      if (section.head.length)
        rows.push(section.head.map((h) => text(h, 'head')));
      // The heading and head go with the first block; a later block of more
      // than one row stays whole.
      let start = at,
        next = 0;
      for (const size of blocks) {
        rows.push(...section.rows.slice(next, next + size));
        next += size;
        if (rows.length - 1 > start) keep.push([start, rows.length - 1]);
        start = rows.length;
      }
    } else if (section.kind === 'signature') {
      heading(w.signature);
      for (const who of [w.prepared, w.reviewed])
        rows.push([
          text(who, 'label'),
          { line: true },
          text(w.date, 'label'),
          { line: true },
        ]);
      whole();
    } else {
      heading(w.claim, section.evidence);
      rows.push([text(section.text, 'note')]);
      whole();
    }
  }
  return { name: w.name, language, widths: WIDTHS, rows, keep };
}
