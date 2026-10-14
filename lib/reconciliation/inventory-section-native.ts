import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';
import { prepareXlsxForExcelJs } from './xlsx-namespaces.ts';
import type { SourceFile } from './types.ts';

type XF = { attrs: Record<string, string>; alignment?: Record<string, string> };
type NativeCell = {
  row: number;
  column: number;
  type: string;
  value: string;
  formula: boolean;
  style?: string;
};
const falseFlag = (value: string | undefined) =>
  value === '0' || value === 'false';
const trueFlag = (value: string | undefined) =>
  value === '1' || value === 'true';
const decimalLexeme = (value: string) =>
  /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);

// Called after the shared reader has bounded and validated the original ZIP.
// Source values stay stored XML lexemes. Styles can prove a display conflict,
// never supply a currency, a monetary amount or a computed inventory value.
export async function bindInventorySectionNative(
  file: SourceFile,
): Promise<SourceFile> {
  if (!/\.xlsx$/i.test(file.name) || !file.original || file.sheets.length !== 1)
    throw Error('STOCK_SOURCE');
  const sourceBytes = file.original.slice(0);
  const original = await JSZip.loadAsync(sourceBytes);
  const compatible = await JSZip.loadAsync(
    await prepareXlsxForExcelJs(sourceBytes),
  );
  const sheet = file.sheets[0];
  const globalIssues = new Set<string>();
  const warn = (code: string) => globalIssues.add(code);
  const attrs = (tag: SaxesTagNS): Record<string, string> =>
    Object.fromEntries(
      Object.values(tag.attributes)
        .filter((a) => !a.uri)
        .map((a) => [a.local, a.value]),
    );
  function xml(
    text: string,
    open: (tag: SaxesTagNS) => void,
    close?: (tag: SaxesTagNS) => void,
    characters?: (text: string) => void,
  ) {
    const parser = new SaxesParser({ xmlns: true });
    parser.on('doctype', () => {
      throw Error('STOCK_NATIVE_XML');
    });
    parser.on('opentag', open);
    if (close) parser.on('closetag', close);
    if (characters) parser.on('text', characters);
    parser.write(text).close();
  }
  const sourceParts = Object.keys(original.files).filter((part) =>
    /^xl\/worksheets\/[^/]+\.xml$/.test(part),
  );
  if (sourceParts.length !== 1) warn('UNBOUND_WORKSHEET');
  let relation = '';
  xml(
    await compatible.file('xl/_rels/workbook.xml.rels')!.async('string'),
    (tag) => {
      const a = attrs(tag);
      if (tag.local === 'Relationship' && a.Type?.endsWith('/worksheet')) {
        if (relation) throw Error('STOCK_NATIVE_XML');
        relation = a.Target;
      }
    },
  );
  const part = relation.startsWith('/')
    ? relation.slice(1)
    : `xl/${relation.replace(/^\.\//, '')}`;
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(part) || !compatible.file(part))
    throw Error('STOCK_NATIVE_XML');

  const fonts: Set<string>[] = [],
    fills: Set<string>[] = [],
    xfs: XF[] = [],
    bases: XF[] = [];
  const numberFormats = new Map<number, string>([
    [0, 'General'],
    [1, '0'],
    [2, '0.00'],
    [3, '#,##0'],
    [4, '#,##0.00'],
    [5, '$#,##0'],
    [6, '$#,##0'],
    [7, '$#,##0.00'],
    [8, '$#,##0.00'],
    [37, '#,##0;(#,##0)'],
    [38, '#,##0;[Red](#,##0)'],
    [39, '#,##0.00;(#,##0.00)'],
    [40, '#,##0.00;[Red](#,##0.00)'],
    [41, '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)'],
    [42, '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)'],
    [43, '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)'],
    [44, '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)'],
    [49, '@'],
  ]);
  const styles = compatible.file('xl/styles.xml');
  if (styles) {
    const stack: string[] = [];
    let font: Set<string> | undefined,
      fill: Set<string> | undefined,
      xf: XF | undefined;
    let declaration:
      | { local: string; namespace: string; attribute: string; count: number }
      | undefined;
    const defaultExtensions: Record<string, [string, string, string]> = {
      '{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}': [
        'slicerStyles',
        'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main',
        'defaultSlicerStyle',
      ],
      '{9260A510-F301-46a8-8635-F512D64BE5F5}': [
        'timelineStyles',
        'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main',
        'defaultTimelineStyle',
      ],
    };
    xml(
      await styles.async('string'),
      (tag) => {
        const a = attrs(tag),
          parent = stack.at(-1);
        if (tag.local === 'font' && parent === 'fonts') {
          font = new Set();
          fonts.push(font);
        }
        if (tag.local === 'fill' && parent === 'fills') {
          fill = new Set();
          fills.push(fill);
        }
        if (
          tag.local === 'xf' &&
          (parent === 'cellXfs' || parent === 'cellStyleXfs')
        ) {
          xf = { attrs: a };
          (parent === 'cellXfs' ? xfs : bases).push(xf);
        }
        if (font) {
          if (
            tag.local === 'sz' &&
            (!decimalLexeme(a.val ?? '') ||
              !Number.isFinite(Number(a.val)) ||
              Number(a.val) < 7)
          )
            font.add('NATIVE_FONT_SIZE');
          if (
            [
              'strike',
              'outline',
              'shadow',
              'condense',
              'extend',
              'vertAlign',
              'vanish',
            ].includes(tag.local) &&
            !falseFlag(a.val ?? '1')
          )
            font.add('NATIVE_FONT_EFFECT');
        }
        if (fill && tag.local === 'gradientFill')
          fill.add('NATIVE_STYLE_FEATURE');
        if (xf && tag.local === 'alignment') xf.alignment = a;
        if (tag.local === 'numFmt') {
          const id = Number(a.numFmtId);
          if (Number.isSafeInteger(id) && typeof a.formatCode === 'string')
            numberFormats.set(id, a.formatCode);
        }
        // Producer defaults for absent slicers/timelines do not affect plain
        // cells. Only these empty stylesheet declarations are bounded here;
        // applied, nested and unknown extension content remains diagnostic.
        if (
          tag.local === 'extLst' &&
          (parent !== 'styleSheet' || Object.keys(a).length)
        )
          warn('NATIVE_STYLE_FEATURE');
        else if (stack.includes('extLst')) {
          const known = defaultExtensions[a.uri];
          if (
            parent === 'extLst' &&
            tag.local === 'ext' &&
            known &&
            Object.keys(a).join('|') === 'uri'
          )
            declaration = {
              local: known[0],
              namespace: known[1],
              attribute: known[2],
              count: 0,
            };
          else if (
            parent === 'ext' &&
            declaration &&
            tag.local === declaration.local &&
            tag.uri === declaration.namespace &&
            Object.keys(a).join('|') === declaration.attribute &&
            a[declaration.attribute]
          )
            declaration.count++;
          else warn('NATIVE_STYLE_FEATURE');
        }
        stack.push(tag.local);
      },
      (tag) => {
        stack.pop();
        if (tag.local === 'font') font = undefined;
        if (tag.local === 'fill') fill = undefined;
        if (tag.local === 'xf') xf = undefined;
        if (tag.local === 'ext') {
          if (!declaration || declaration.count !== 1)
            warn('NATIVE_STYLE_FEATURE');
          declaration = undefined;
        }
      },
      (text) => {
        if (stack.includes('extLst') && text.trim())
          warn('NATIVE_STYLE_FEATURE');
      },
    );
  }

  const simpleWorksheet = new Set([
    'worksheet',
    'sheetPr',
    'tabColor',
    'outlinePr',
    'pageSetUpPr',
    'dimension',
    'sheetViews',
    'sheetView',
    'pane',
    'selection',
    'sheetFormatPr',
    'cols',
    'col',
    'sheetData',
    'row',
    'c',
    'v',
    'is',
    't',
    'f',
    'sheetProtection',
    'printOptions',
    'pageMargins',
    'pageSetup',
    'headerFooter',
    'oddHeader',
    'oddFooter',
    'evenHeader',
    'evenFooter',
    'firstHeader',
    'firstFooter',
    'rowBreaks',
    'colBreaks',
    'brk',
    'sheetCalcPr',
    'ignoredErrors',
    'ignoredError',
  ]);
  const shared = compatible.file('xl/sharedStrings.xml');
  const richSharedStrings = new Set<number>();
  let sharedIndex = -1,
    insideSharedString = false;
  if (shared)
    xml(
      await shared.async('string'),
      (tag) => {
        if (tag.local === 'si') {
          sharedIndex++;
          insideSharedString = true;
        }
        if (!['sst', 'si', 't'].includes(tag.local)) {
          if (insideSharedString) richSharedStrings.add(sharedIndex);
          else warn('NATIVE_RICH_TEXT');
        }
      },
      (tag) => {
        if (tag.local === 'si') insideSharedString = false;
      },
    );
  const rowSettings = new Map<number, Record<string, string>>();
  const columnSettings = new Map<number, Record<string, string>>();
  const cells: NativeCell[] = [];
  let defaults: Record<string, string> = {},
    current: NativeCell | null = null;
  let inValue = false,
    hideZeros = false;
  xml(
    await compatible.file(part)!.async('string'),
    (tag) => {
      const a = attrs(tag);
      if (!simpleWorksheet.has(tag.local)) warn('NATIVE_WORKSHEET_FEATURE');
      if (tag.local === 'sheetFormatPr') defaults = a;
      if (tag.local === 'row') rowSettings.set(Number(a.r), a);
      if (tag.local === 'col') {
        const first = Number(a.min),
          last = Number(a.max);
        if (
          !Number.isSafeInteger(first) ||
          !Number.isSafeInteger(last) ||
          first < 1 ||
          last < first
        )
          throw Error('STOCK_NATIVE_XML');
        for (let column = first; column <= Math.min(100, last); column++)
          columnSettings.set(column, a);
      }
      if (tag.local === 'sheetView' && falseFlag(a.showZeros)) hideZeros = true;
      if (tag.local === 'c') {
        const address = /^([A-Z]+)([1-9]\d*)$/.exec(a.r ?? '');
        if (!address) throw Error('STOCK_NATIVE_XML');
        current = {
          row: Number(address[2]),
          column: address[1]
            .split('')
            .reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0),
          type: a.t ?? 'n',
          value: '',
          formula: false,
          ...(a.s === undefined ? {} : { style: a.s }),
        };
      }
      if (tag.local === 'f') {
        warn('NATIVE_FORMULA');
        if (current) current.formula = true;
      }
      if (tag.local === 'v') inValue = true;
    },
    (tag) => {
      if (tag.local === 'v') inValue = false;
      if (tag.local === 'c' && current) {
        const text = sheet.rows[current.row - 1]?.[current.column - 1];
        if (
          current.formula ||
          (typeof text === 'string' && text.trim()) ||
          (current.type === 'n' && current.value !== '')
        )
          cells.push(current);
        current = null;
      }
    },
    (value) => {
      if (inValue && current) current.value += value;
    },
  );

  const index = (
    value: string | undefined,
    count: number,
  ): number | undefined => {
    const raw = value ?? '0';
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) >= count
    ) {
      warn('NATIVE_STYLE_FEATURE');
      return undefined;
    }
    return Number(raw);
  };
  const applied = (cell: NativeCell) => {
    if (!styles) return;
    const position = index(
      cell.style ??
        rowSettings.get(cell.row)?.s ??
        columnSettings.get(cell.column)?.style,
      xfs.length,
    );
    if (position === undefined) return;
    const style = xfs[position],
      baseIndex =
        bases.length || style.attrs.xfId !== undefined
          ? index(style.attrs.xfId, bases.length)
          : undefined;
    const base = baseIndex === undefined ? undefined : bases[baseIndex];
    for (const flag of [
      'applyFont',
      'applyFill',
      'applyNumberFormat',
      'applyAlignment',
    ])
      if (
        style.attrs[flag] !== undefined &&
        !trueFlag(style.attrs[flag]) &&
        !falseFlag(style.attrs[flag])
      )
        warn('NATIVE_STYLE_FEATURE');
    if (
      !base &&
      ['applyFont', 'applyFill', 'applyNumberFormat', 'applyAlignment'].some(
        (flag) => falseFlag(style.attrs[flag]),
      )
    )
      warn('NATIVE_STYLE_FEATURE');
    const inherit = (flag: string, component: string) =>
      falseFlag(style.attrs[flag])
        ? (base?.attrs[component] ?? '0')
        : (style.attrs[component] ?? base?.attrs[component] ?? '0');
    const fontIndex = index(inherit('applyFont', 'fontId'), fonts.length);
    if (fontIndex !== undefined)
      for (const code of fonts[fontIndex]) warn(code);
    const fillIndex = index(inherit('applyFill', 'fillId'), fills.length);
    if (fillIndex !== undefined)
      for (const code of fills[fillIndex]) warn(code);
    const alignment = falseFlag(style.attrs.applyAlignment)
      ? base?.alignment
      : (style.alignment ?? base?.alignment);
    if (
      alignment &&
      ((alignment.textRotation !== undefined &&
        alignment.textRotation !== '0') ||
        (alignment.shrinkToFit !== undefined &&
          !falseFlag(alignment.shrinkToFit)))
    )
      warn('NATIVE_TEXT_LAYOUT');
    return numberFormats.get(Number(inherit('applyNumberFormat', 'numFmtId')));
  };
  const dimension = (value: string | undefined, minimum: number) => {
    if (
      value !== undefined &&
      (!decimalLexeme(value) ||
        !Number.isFinite(Number(value)) ||
        Number(value) < minimum)
    )
      warn('NATIVE_DIMENSION');
  };
  const prefixCurrencies = new Set<string>();
  for (const row of sheet.rows.slice(1)) {
    if (row.every((text) => !text.trim())) continue;
    if (row[0] !== 'Scope') break;
    if (row[1] === 'Currency' && typeof row[2] === 'string')
      prefixCurrencies.add(row[2]);
  }
  const declaredCurrency =
    prefixCurrencies.size === 1 ? [...prefixCurrencies][0] : undefined;
  // Matrix fact roles run horizontally. This marker only scopes a display
  // diagnostic; the accounting parser still validates the complete family.
  const matrix =
    sheet.rows[0]?.[0] === 'Format' && sheet.rows[0]?.[1] === 'INV1A-MATRIX-1';
  const isoCurrency =
    /(?:^|[^A-Z])(SAR|JPY|KWD|USD|EUR|GBP|AED|QAR|BHD|OMR|CNY|INR|CHF|AUD|CAD|HKD|SGD)(?=[^A-Z]|$)/gi;
  const formatSections = (format: string) => {
    const sections = [''];
    let quoted = false,
      escaped = false;
    for (const character of format) {
      if (escaped) {
        sections[sections.length - 1] += character;
        escaped = false;
        continue;
      }
      if (character === '\\') {
        sections[sections.length - 1] += character;
        escaped = true;
        continue;
      }
      if (character === '"') quoted = !quoted;
      if (character === ';' && !quoted) sections.push('');
      else sections[sections.length - 1] += character;
    }
    return sections;
  };
  function currencyDisplay(format: string, cell: NativeCell) {
    // An ordinary numeric number format does not decorate a literal text cell.
    // Its inactive negative/zero sections cannot contradict a positive amount.
    if (cell.type !== 'n' || cell.value === '') return;
    const markers = new Set<string>();
    const sections = formatSections(format),
      zero = /^[+-]?0+(?:\.0+)?$/.test(cell.value);
    const selected =
      sections[
        zero && sections.length > 2
          ? 2
          : cell.value.startsWith('-') && sections.length > 1
            ? 1
            : 0
      ];
    const visible = selected
      .replace(/_.|\*./gu, '')
      .replace(/\\(.)/g, '$1')
      // Direction marks in a format decorate presentation, never source data.
      .replace(/[\u200e\u200f\u061c]/g, '');
    for (const match of visible.matchAll(isoCurrency))
      markers.add(match[1].toUpperCase());
    // Only the exact Arabic currency abbreviations already understood by the
    // native numeric-format reader. General Arabic text is not a currency guess.
    const arabicCurrency: [RegExp, string][] = [
      [/(?:^|[^\p{L}\p{N}])ر\.س\.?(?=[^\p{L}\p{N}]|$)/u, 'SAR'],
      [/(?:^|[^\p{L}\p{N}])د\.ك\.?(?=[^\p{L}\p{N}]|$)/u, 'KWD'],
      [/(?:^|[^\p{L}\p{N}])د\.إ\.?(?=[^\p{L}\p{N}]|$)/u, 'AED'],
    ];
    for (const [label, currency] of arabicCurrency)
      if (label.test(visible)) markers.add(currency);
    const symbols: [string, string[]][] = [
      ['$', ['USD', 'CAD', 'AUD', 'HKD', 'SGD']],
      ['€', ['EUR']],
      ['£', ['GBP']],
      ['¥', ['JPY', 'CNY']],
      ['₹', ['INR']],
      ['₩', ['KRW']],
    ];
    const localeOnly = visible
      .replace(/\[\$-[^\]]*\]/g, '')
      .replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, '$1');
    const hasCurrency =
      markers.size > 0 ||
      symbols.some(([symbol]) => localeOnly.includes(symbol));
    const label = sheet.rows[cell.row - 1]?.[0];
    if (
      hasCurrency &&
      (cell.column === 2 || (matrix && cell.column > 2)) &&
      ['Quantity', 'Quantity precision'].includes(label)
    )
      warn('NATIVE_CURRENCY_ROLE');
    if (
      declaredCurrency &&
      ([...markers].some((marker) => marker !== declaredCurrency) ||
        symbols.some(
          ([symbol, candidates]) =>
            localeOnly.includes(symbol) &&
            !candidates.includes(declaredCurrency),
        ))
    )
      warn('NATIVE_CURRENCY_CONFLICT');
  }
  for (const cell of cells) {
    const text = sheet.rows[cell.row - 1]?.[cell.column - 1];
    // Blank decoration never supplies an identity, amount or source member.
    // Formulas remain an explicit source issue even when their cached value is blank.
    if (
      !(typeof text === 'string' && text.trim()) &&
      !cell.formula &&
      !(cell.type === 'n' && cell.value !== '')
    )
      continue;
    if (!['n', 's', 'inlineStr', 'str'].includes(cell.type))
      warn('NATIVE_CELL_TYPE');
    if (cell.type === 's' && richSharedStrings.has(Number(cell.value)))
      warn('NATIVE_RICH_TEXT');
    const row = rowSettings.get(cell.row),
      column = columnSettings.get(cell.column);
    dimension(row?.ht ?? defaults.defaultRowHeight, 7);
    dimension(column?.width ?? defaults.defaultColWidth, 2);
    if (trueFlag(row?.hidden) || trueFlag(column?.hidden))
      warn('NATIVE_DIMENSION');
    if (trueFlag(defaults.zeroHeight) && row?.ht === undefined)
      warn('NATIVE_DIMENSION');
    const format = applied(cell);
    if (format) currencyDisplay(format, cell);
    if (cell.type !== 'n' || cell.value === '' || cell.formula) continue;
    if (
      !sheet.rows[cell.row - 1] ||
      cell.column > sheet.rows[cell.row - 1].length
    )
      throw Error('STOCK_NATIVE_XML');
    const key = `${cell.row}:${cell.column}`;
    // A Date coercion is not a literal identity or supplied inventory money.
    // Restore the original numeric lexeme for its source trail and mark it unsafe.
    if (!sheet.numericCells?.[key]) warn('NATIVE_NUMERIC_FORMAT');
    sheet.numericCells ??= {};
    sheet.numericCells[key] ??= {
      value: Number(cell.value),
      format: format ?? '',
    };
    if (hideZeros && /^[+-]?0+(?:\.0+)?$/.test(cell.value))
      warn('NATIVE_HIDDEN_ZERO');
    const displayFormats = new Set([
      ...(sheet.numericDisplayFormats?.[key] ?? []),
      ...(format ? [format] : []),
    ]);
    for (const displayFormat of displayFormats) {
      currencyDisplay(displayFormat, cell);
      if (!displayFormat || /^General$/i.test(displayFormat)) continue;
      const sections = formatSections(displayFormat),
        zero = /^[+-]?0+(?:\.0+)?$/.test(cell.value);
      const fixed = sections[zero && sections.length > 2 ? 2 : 0]
        .replace(/_.|\*./gu, '')
        .replace(/"[^"]*"/g, '')
        .replace(/\[\$[^\]]*\]/g, '')
        .replace(/\[(?:Black|Blue|Cyan|Green|Magenta|Red|Yellow)\]/gi, '')
        .replace(/\\([$€£¥() +-])/g, '$1')
        .replace(/[$€£¥₹₩\s]/g, '')
        .trim();
      const decimal = /^[#0,]+(?:\.([#0]+))?$/.exec(fixed);
      if (decimal && /^[0-9]+(?:\.[0-9]+)?$/.test(cell.value)) {
        const fractional = cell.value.split('.')[1] ?? '',
          places = decimal[1]?.length ?? 0;
        if (/[1-9]/.test(fractional.slice(places)))
          warn('NATIVE_NUMBER_ROUNDING');
      }
    }
    sheet.rows[cell.row - 1][cell.column - 1] = cell.value;
  }
  if (globalIssues.size) {
    sheet.rowIssues ??= {};
    sheet.rowIssues['1'] = [
      ...(sheet.rowIssues['1'] ?? []),
      ...[...globalIssues]
        .sort()
        .map((code) => `STOCK_NATIVE_DISPLAY: ${code}`),
    ];
  }
  return file;
}
