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

/** The styles the sheet uses, appended after every existing one, so each
 * index the evidence sheets hold keeps its meaning. */
function appendStyles(styles: string, sheet: ReconciliationSheet) {
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
  // No text wraps: a row's height is not measured by every reader, so a long
  // text runs on into the empty cells beside it, whole, as the fingerprint
  // must (UX-3 fixed it cut on the screen).
  const align = () =>
    `<alignment horizontal="${rtl ? 'right' : 'left'}" vertical="top" readingOrder="${rtl ? 2 : 1}"/>`;
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
  for (const s of textStyles) {
    const font = fonts + (s === 'label' ? FONT.value : FONT[s]);
    const border = s === 'head' ? ` borderId="${borders}" applyBorder="1"` : '';
    index.set(s, xfs + xf.length);
    xf.push(
      `<xf numFmtId="0" fontId="${font}" fillId="0"${border || ' borderId="0"'} xfId="0" applyFont="1" applyAlignment="1">${align()}</xf>`,
    );
  }
  // A number keeps a left-to-right reading order in either language, so its
  // sign stays before it («-50.00», never «50.00-»); it aligns where the
  // sheet's text starts.
  const start = `<alignment horizontal="${rtl ? 'right' : 'left'}" readingOrder="1"/>`;
  for (const f of formats) {
    index.set(`amount:${f.d}`, xfs + xf.length);
    xf.push(
      `<xf numFmtId="${f.id}" fontId="${fonts + FONT.value}" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>`,
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

function sheetXml(sheet: ReconciliationSheet, index: Map<string, number>) {
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
        out.push(
          `<c r="${ref}" t="inlineStr" s="${index.get(cell.style)}"><is><t xml:space="preserve">${cellText(cell.text)}</t></is></c>`,
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
    if (out.length) rows.push(`<row r="${r + 1}">${out.join('')}</row>`);
  });
  const cols = sheet.widths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
    )
    .join('');
  const last = sheet.rows.length || 1;
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
  const { styles: nextStyles, index } = appendStyles(styles, sheet);
  zip.file(`xl/worksheets/${part}`, sheetXml(sheet, index));
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
      /** Rows the screen shows beside the strip (what is missing). */
      more?: { label: string; value: string }[];
    }
  | {
      kind: 'table';
      title: string;
      evidence: string;
      head: string[];
      rows: SheetCell[][];
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
  const heading = (name: string, evidence?: string) => {
    rows.push([]);
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
    } else if (section.kind === 'sources') {
      if (!section.sources.length) continue;
      heading(section.title, section.evidence);
      for (const s of section.sources) {
        rows.push([text(s.role, 'label'), text(s.name, 'value')]);
        rows.push([text(w.fingerprint, 'note'), text(s.hash, 'hash')]);
      }
    } else if (section.kind === 'strip') {
      heading(section.title, section.evidence);
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
    } else if (section.kind === 'table') {
      if (!section.rows.length) continue;
      heading(section.title, section.evidence);
      rows.push(section.head.map((h) => text(h, 'head')));
      rows.push(...section.rows);
    } else if (section.kind === 'signature') {
      heading(w.signature);
      for (const who of [w.prepared, w.reviewed])
        rows.push([
          text(who, 'label'),
          { line: true },
          text(w.date, 'label'),
          { line: true },
        ]);
    } else {
      heading(w.claim, section.evidence);
      rows.push([text(section.text, 'note')]);
    }
  }
  return { name: w.name, language, widths: WIDTHS, rows };
}
