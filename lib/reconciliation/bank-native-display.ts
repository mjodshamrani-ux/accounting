import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import type { SourceFile } from './types.ts';
type Node = { name: string; attrs: Record<string, string>; children: Node[] };
function fail(): never {
  throw Error('BANK_NATIVE_DISPLAY');
}
function parse(xml: string): Node {
  if (xml.length > 1024 * 1024) fail();
  const parser = new SaxesParser({ xmlns: true }),
    stack: Node[] = [];
  let root: Node | undefined,
    count = 0;
  parser.on('doctype', fail);
  parser.on('opentag', (tag) => {
    if (++count > 10000) fail();
    const attrs: Record<string, string> = {};
    for (const a of Object.values(tag.attributes)) {
      if (a.uri === 'http://www.w3.org/2000/xmlns/') continue;
      if (
        a.uri ===
          'http://schemas.openxmlformats.org/markup-compatibility/2006' &&
        a.local === 'Ignorable'
      )
        continue;
      if (
        tag.local === 'fonts' &&
        a.uri ===
          'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac' &&
        a.local === 'knownFonts' &&
        a.value === '1'
      )
        continue;
      const prefix =
        a.uri ===
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
          ? 'r:'
          : a.uri === 'http://www.w3.org/XML/1998/namespace'
            ? 'xml:'
            : '';
      if ((a.uri && !prefix) || Object.hasOwn(attrs, prefix + a.local)) fail();
      attrs[prefix + a.local] = a.value;
    }
    const node = { name: tag.local, attrs, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  return root ?? fail();
}
const child = (node: Node, name: string) =>
  node.children.find((n) => n.name === name);
const shape = (n: Node): string =>
  JSON.stringify([
    n.name,
    Object.entries(n.attrs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    n.children.map(shape).sort(),
  ]);
const expected = (xml: string) => shape(parse(xml));
const index = (v: string | undefined, count: number) => {
  const s = v ?? '0';
  if (!/^\d+$/.test(s) || Number(s) >= count) fail();
  return Number(s);
};
const dimension = (v: string | undefined, min: number, fallback: number) => {
  // Excel parses decimal XML dimensions, whereas Number also accepts hex/binary.
  if (
    v !== undefined &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)
  )
    fail();
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isFinite(n) || n < min) fail();
};
const falseFlag = (v: string | undefined) => {
  if (v !== undefined && !['0', 'false'].includes(v)) fail();
};
const trueFlag = (v: string | undefined) => {
  if (v !== undefined && !['1', 'true'].includes(v)) fail();
};

// Call only after readFile has bounded/validated the ZIP and its XML. This
// canonical bank family supports known plain fonts, backgrounds and dimensions,
// not arbitrary Excel display layers. Source bytes are never rewritten.
export async function assertBankNativeDisplay(
  file: SourceFile,
  plainTextError = 'BANK_NATIVE_DISPLAY',
) {
  if (!/\.xlsx$/i.test(file.name)) return;
  if (!(file.original instanceof ArrayBuffer)) fail();
  const zip = await JSZip.loadAsync(file.original);
  async function part(name: string) {
    const f = zip.file(name) ?? fail();
    return parse(await f.async('string'));
  }
  const styles = await part('xl/styles.xml');
  const fonts = child(styles, 'fonts')?.children ?? [];
  const allowedFonts = new Set([
    expected(
      '<font><color theme="1"/><family val="2"/><scheme val="minor"/><sz val="11"/><name val="Calibri"/></font>',
    ),
    expected('<font><b/></font>'),
  ]);
  if (!fonts.length || fonts.some((font) => !allowedFonts.has(shape(font))))
    fail();
  const shapes = (name: string) => child(styles, name)?.children.map(shape);
  if (
    JSON.stringify(shapes('fills')) !==
      JSON.stringify([
        expected('<fill><patternFill patternType="none"/></fill>'),
        expected('<fill><patternFill patternType="gray125"/></fill>'),
      ]) ||
    JSON.stringify(shapes('borders')) !==
      JSON.stringify([
        expected('<border><left/><right/><top/><bottom/><diagonal/></border>'),
      ]) ||
    JSON.stringify(shapes('cellStyleXfs')) !==
      JSON.stringify([
        expected('<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'),
      ]) ||
    (child(styles, 'numFmts')?.children.length ?? 0) ||
    (child(styles, 'dxfs')?.children.length ?? 0)
  )
    fail();
  const xfs = child(styles, 'cellXfs')?.children ?? [];
  if (!xfs.length) fail();
  for (const xf of xfs) {
    if (
      xf.children.length ||
      Object.keys(xf.attrs).some(
        (k) =>
          ![
            'numFmtId',
            'fontId',
            'fillId',
            'borderId',
            'xfId',
            'applyFont',
            'applyNumberFormat',
          ].includes(k),
      ) ||
      !['0', '2', '14'].includes(xf.attrs.numFmtId ?? '0') ||
      ['fillId', 'borderId', 'xfId'].some((k) => (xf.attrs[k] ?? '0') !== '0')
    )
      fail();
    index(xf.attrs.fontId, fonts.length);
    trueFlag(xf.attrs.applyFont);
    trueFlag(xf.attrs.applyNumberFormat);
  }
  const theme = await part('xl/theme/theme1.xml');
  const colors =
    child(child(theme, 'themeElements') ?? fail(), 'clrScheme') ?? fail();
  for (const [name, system, rgb] of [
    ['dk1', 'windowText', '000000'],
    ['lt1', 'window', 'FFFFFF'],
  ]) {
    const color = child(colors, name) ?? fail();
    if (
      color.children.length !== 1 ||
      shape(color.children[0]) !==
        expected(`<sysClr val="${system}" lastClr="${rgb}"/>`)
    )
      fail();
  }
  const book = await part('xl/workbook.xml');
  falseFlag(child(book, 'workbookPr')?.attrs.date1904);
  for (const sheet of child(book, 'sheets')?.children ?? [])
    if (sheet.attrs.state && sheet.attrs.state !== 'visible') fail();
  const overlays = new Set([
    'picture',
    'drawing',
    'legacyDrawing',
    'legacyDrawingHF',
    'conditionalFormatting',
    'extLst',
    'oleObjects',
    'controls',
    // The plain bank family has no run-level font/display contract. CellXfs
    // alone cannot prove visibility of shared or inline rich text.
  ]);
  const plainText = (name: string) => {
    if (name === 'r' || name === 'rPr') throw Error(plainTextError);
  };
  const shared = zip.file('xl/sharedStrings.xml');
  if (shared) {
    const parser = new SaxesParser({ xmlns: true });
    parser.on('doctype', fail);
    parser.on('opentag', (tag) => {
      plainText(tag.local);
      if (overlays.has(tag.local)) fail();
    });
    parser.write(await shared.async('string')).close();
  }
  for (const entry of Object.values(zip.files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name)) continue;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('doctype', fail);
    parser.on('opentag', (tag) => {
      plainText(tag.local);
      if (overlays.has(tag.local)) fail();
      const a: Record<string, string> = {};
      for (const value of Object.values(tag.attributes))
        if (!value.uri) a[value.local] = value.value;
      if (tag.local === 'sheetFormatPr') {
        falseFlag(a.zeroHeight);
        dimension(a.defaultRowHeight, 15, 15);
        dimension(a.defaultColWidth, 9, 9);
      }
      if (tag.local === 'sheetView') {
        trueFlag(a.showZeros);
        dimension(a.zoomScale, 100, 100);
      }
      if (tag.local === 'row') {
        falseFlag(a.hidden);
        dimension(a.ht, 15, 15);
        if ((xfs[index(a.s, xfs.length)].attrs.numFmtId ?? '0') !== '0') fail();
      }
      if (tag.local === 'col') {
        falseFlag(a.hidden);
        dimension(a.width, 9, 9);
        index(a.style, xfs.length);
      }
      if (tag.local === 'c') index(a.s, xfs.length);
    });
    parser.write(await entry.async('string')).close();
  }
}
