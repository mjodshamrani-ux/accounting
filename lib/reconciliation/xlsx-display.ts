import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import type ExcelJS from 'exceljs';
import type { SheetData } from './types.ts';

export function nativeDisplayIssue(
  sheet: SheetData,
  row: number,
  columns: number[],
) {
  return [
    ...(sheet.rowIssues?.[String(row)] ?? []),
    ...columns.flatMap((c) => [
      ...(sheet.cellIssues?.[`${row}:${c + 1}`] ?? []),
      ...(sheet.cellNotes?.[`${row}:${c + 1}`] ?? []),
    ]),
  ].find((issue) => issue.startsWith('XLSX_NATIVE_DISPLAY:'));
}

type SheetDisplay = {
  hidden: boolean;
  zeroRows: Set<number>;
  positiveRows: Set<number>;
  hiddenColumns: Set<number>;
  zeroColumns: Set<number>;
  positiveColumns: Set<number>;
  zeroDefaultRows: boolean;
  zeroDefaultColumns: boolean;
  hideZeros: boolean;
  rowStyles: Map<number, number>;
  columnStyles: Map<number, number>;
  cellStyles: Map<string, number>;
};
const attributes = (tag: import('saxes').SaxesTagNS) =>
  Object.fromEntries(
    Object.values(tag.attributes).map((a) => [a.local, a.value]),
  );
const trueFlag = (v: string | undefined) => v === '1' || v === 'true';
const zero = (v: string | undefined) => v !== undefined && Number(v) === 0;
function parse(
  xml: string,
  visit: (tag: import('saxes').SaxesTagNS) => void,
  close?: (tag: import('saxes').SaxesTagNS) => void,
) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw Error('XLSX_NATIVE_DISPLAY: XML doctype');
  });
  parser.on('opentag', visit);
  if (close) parser.on('closetag', close);
  parser.write(xml).close();
}

/** Called after ZIP/XML budgets are enforced. Reconstruct display facts from
 * bytes; never rewrite values, discard hidden data, or infer money precision.
 * Facts stay scoped to a sheet/cell so flexible mappings retain unused helpers,
 * hidden auxiliary sheets and their existing merged-header certificates.
 */
export async function xlsxDisplayContext(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = async (name: string) => zip.file(name)?.async('string');
  const theme: string[] = [],
    indexed: string[] = [];
  const fonts: Partial<ExcelJS.Font>[] = [],
    fills: ExcelJS.Fill[] = [];
  const xfs: Record<string, string>[] = [],
    bases: Record<string, string>[] = [];
  // Display validation only; literal money and identifier values stay unchanged.
  const numberFormats = new Map<number, string>([
    [0, 'General'],
    [1, '0'],
    [2, '0.00'],
    [3, '#,##0'],
    [4, '#,##0.00'],
    [9, '0%'],
    [10, '0.00%'],
    [11, '0.00E+00'],
    [12, '# ?/?'],
    [13, '# ??/??'],
    [37, '#,##0 ;(#,##0)'],
    [38, '#,##0 ;[Red](#,##0)'],
    [39, '#,##0.00 ;(#,##0.00)'],
    [40, '#,##0.00 ;[Red](#,##0.00)'],
    [49, '@'],
  ]);
  const color = (a: Record<string, string>) => ({
    ...(a.rgb !== undefined ? { argb: a.rgb } : {}),
    ...(a.theme !== undefined ? { theme: Number(a.theme) } : {}),
    ...(a.indexed !== undefined ? { indexed: Number(a.indexed) } : {}),
    ...(a.tint !== undefined ? { tint: Number(a.tint) } : {}),
    ...(a.auto !== undefined ? { auto: trueFlag(a.auto) } : {}),
  });
  const themeXml = await xml('xl/theme/theme1.xml');
  // Theme-less minimal workbooks round-tripped by ExcelJS retain the standard
  // default light/dark roles. Other missing theme colors remain unsupported.
  if (!themeXml) {
    theme[0] = 'FFFFFF';
    theme[1] = '000000';
  }
  if (themeXml) {
    let inside = false,
      slot = -1;
    parse(
      themeXml,
      (tag) => {
        if (tag.local === 'clrScheme') {
          inside = true;
          return;
        }
        if (
          inside &&
          [
            'dk1',
            'lt1',
            'dk2',
            'lt2',
            'accent1',
            'accent2',
            'accent3',
            'accent4',
            'accent5',
            'accent6',
            'hlink',
            'folHlink',
          ].includes(tag.local)
        )
          slot = [
            'lt1',
            'dk1',
            'lt2',
            'dk2',
            'accent1',
            'accent2',
            'accent3',
            'accent4',
            'accent5',
            'accent6',
            'hlink',
            'folHlink',
          ].indexOf(tag.local);
        if (inside && slot >= 0 && ['srgbClr', 'sysClr'].includes(tag.local)) {
          const a = attributes(tag);
          theme[slot] = tag.local === 'sysClr' ? a.lastClr : a.val;
        }
      },
      (tag) => {
        if (tag.local === 'clrScheme') {
          inside = false;
          slot = -1;
        }
      },
    );
  }
  const styleXml = await xml('xl/styles.xml');
  if (styleXml) {
    let inIndexed = false;
    const stack: string[] = [];
    let font: Partial<ExcelJS.Font> | undefined,
      fill: ExcelJS.FillPattern | undefined;
    parse(
      styleXml,
      (tag) => {
        const parent = stack.at(-1),
          a = attributes(tag);
        if (tag.local === 'font' && parent === 'fonts') {
          font = {};
          fonts.push(font);
        }
        if (font && stack.includes('fonts')) {
          if (tag.local === 'color') font.color = color(a);
          if (tag.local === 'sz') font.size = Number(a.val);
        }
        if (tag.local === 'fill' && parent === 'fills') {
          fill = { type: 'pattern', pattern: 'none' };
          fills.push(fill);
        }
        if (fill && stack.includes('fills')) {
          if (tag.local === 'patternFill')
            fill.pattern = (a.patternType ?? 'none') as ExcelJS.FillPatterns;
          if (tag.local === 'fgColor') fill.fgColor = color(a);
          if (tag.local === 'gradientFill')
            fills[fills.length - 1] = {
              type: 'gradient',
              gradient: 'angle',
              degree: 0,
              stops: [],
            };
        }
        if (tag.local === 'xf' && parent === 'cellXfs') xfs.push(a);
        if (tag.local === 'xf' && parent === 'cellStyleXfs') bases.push(a);
        if (tag.local === 'numFmt' && parent === 'numFmts')
          numberFormats.set(Number(a.numFmtId), a.formatCode);
        if (tag.local === 'indexedColors') inIndexed = true;
        if (inIndexed && tag.local === 'rgbColor')
          indexed.push(attributes(tag).rgb);
        stack.push(tag.local);
      },
      (tag) => {
        stack.pop();
        if (tag.local === 'indexedColors') inIndexed = false;
        if (tag.local === 'font') font = undefined;
        if (tag.local === 'fill') fill = undefined;
      },
    );
  }
  const relationships = new Map<string, string>();
  const rels = await xml('xl/_rels/workbook.xml.rels');
  if (rels)
    parse(rels, (tag) => {
      if (tag.local === 'Relationship') {
        const a = attributes(tag);
        if (a.Type.endsWith('/worksheet'))
          relationships.set(
            a.Id,
            new URL(
              a.Target,
              'https://xlsx.invalid/xl/workbook.xml',
            ).pathname.slice(1),
          );
      }
    });
  const sheets = new Map<string, SheetDisplay>();
  const entries: { name: string; path: string; state?: string }[] = [];
  const book = await xml('xl/workbook.xml');
  if (book)
    parse(book, (tag) => {
      if (tag.local === 'sheet') {
        const a = attributes(tag),
          path = relationships.get(a.id);
        if (path) entries.push({ name: a.name, path, state: a.state });
      }
    });
  for (const entry of entries) {
    const info: SheetDisplay = {
      hidden: !!entry.state && entry.state !== 'visible',
      zeroRows: new Set(),
      positiveRows: new Set(),
      hiddenColumns: new Set(),
      zeroColumns: new Set(),
      positiveColumns: new Set(),
      zeroDefaultRows: false,
      zeroDefaultColumns: false,
      hideZeros: false,
      rowStyles: new Map(),
      columnStyles: new Map(),
      cellStyles: new Map(),
    };
    const sheetXml = await xml(entry.path);
    if (!sheetXml) throw Error('XLSX_NATIVE_DISPLAY: missing worksheet');
    parse(sheetXml, (tag) => {
      const a = attributes(tag);
      if (tag.local === 'row' && a.s !== undefined)
        info.rowStyles.set(Number(a.r), Number(a.s));
      if (tag.local === 'c' && a.s !== undefined)
        info.cellStyles.set(a.r, Number(a.s));
      if (tag.local === 'row' && zero(a.ht)) info.zeroRows.add(Number(a.r));
      if (tag.local === 'row' && a.ht !== undefined && Number(a.ht) > 0)
        info.positiveRows.add(Number(a.r));
      if (tag.local === 'sheetFormatPr') {
        info.zeroDefaultRows =
          zero(a.defaultRowHeight) || trueFlag(a.zeroHeight);
        info.zeroDefaultColumns = zero(a.defaultColWidth);
      }
      if (
        tag.local === 'sheetView' &&
        a.showZeros !== undefined &&
        !trueFlag(a.showZeros)
      )
        info.hideZeros = true;
      if (tag.local === 'col') {
        const min = Number(a.min),
          max = Math.min(100, Number(a.max));
        for (let c = Math.max(1, min); c <= max; c++) {
          if (a.style !== undefined) info.columnStyles.set(c, Number(a.style));
          if (zero(a.width)) info.zeroColumns.add(c);
          else if (a.width !== undefined && Number(a.width) > 0) {
            info.positiveColumns.add(c);
            info.zeroColumns.delete(c);
          }
          if (trueFlag(a.hidden)) info.hiddenColumns.add(c);
        }
      }
    });
    sheets.set(entry.name, info);
  }
  const rgb = (
    color:
      | (Partial<ExcelJS.Color> & {
          indexed?: number;
          tint?: number;
          auto?: boolean;
        })
      | undefined,
    fallback: string,
  ): string | undefined => {
    if (!color) return fallback;
    if (color.argb) return color.argb;
    if (color.theme !== undefined) {
      const base = theme[color.theme];
      const tint = (color as Partial<ExcelJS.Color> & { tint?: number }).tint;
      if (tint === undefined || tint === 0) return base;
      if (!base || !Number.isFinite(tint) || tint < -1 || tint > 1)
        return undefined;
      return [0, 2, 4]
        .map((i) => {
          const channel = parseInt(base.slice(-6).slice(i, i + 2), 16);
          const value =
            tint < 0 ? channel * (1 + tint) : channel * (1 - tint) + 255 * tint;
          return Math.round(value).toString(16).padStart(2, '0');
        })
        .join('');
    }
    if (color.indexed !== undefined) {
      if (indexed.length) return indexed[color.indexed]?.slice(-6);
      return (
        [
          '000000',
          'FFFFFF',
          'FF0000',
          '00FF00',
          '0000FF',
          'FFFF00',
          'FF00FF',
          '00FFFF',
          '000000',
          'FFFFFF',
        ][color.indexed] ??
        (color.indexed === 64
          ? '000000'
          : color.indexed === 65
            ? 'FFFFFF'
            : undefined)
      );
    }
    // Excel's automatic text/background colors retain their default roles.
    if ('auto' in color && color.auto) return fallback;
    return undefined;
  };
  const luminance = (value: string | undefined) => {
    if (!value || !/^(?:FF)?[0-9A-F]{6}$/i.test(value)) return undefined;
    const hex = value.slice(-6);
    const channels = [0, 2, 4].map((i) => {
      const n = parseInt(hex.slice(i, i + 2), 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const cache = new WeakMap<object, WeakMap<object, boolean>>();
  const plainFont = {},
    plainFill = {};
  const calculateVisible = (
    font: Partial<ExcelJS.Font> | undefined,
    fill: ExcelJS.Fill | undefined,
  ) => {
    if (
      font?.size !== undefined &&
      (!Number.isFinite(font.size) || font.size <= 0)
    )
      return false;
    let background = 'FFFFFF';
    if (fill) {
      if (fill.type !== 'pattern') return false;
      if (fill.pattern !== 'none' && fill.pattern !== 'gray125') {
        if (fill.pattern !== 'solid') return false;
        const color = rgb(fill.fgColor, background);
        if (!color) return false;
        background = color;
      }
    }
    const fore = luminance(rgb(font?.color, '000000')),
      back = luminance(background);
    if (fore === undefined || back === undefined) return false;
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05) >= 3;
  };
  const visible = (
    font: Partial<ExcelJS.Font> | undefined,
    fill: ExcelJS.Fill | undefined,
  ) => {
    const fontKey = font ?? plainFont,
      fillKey = fill ?? plainFill;
    const byFill = cache.get(fontKey) ?? new WeakMap<object, boolean>();
    if (!cache.has(fontKey)) cache.set(fontKey, byFill);
    const cached = byFill.get(fillKey);
    if (cached !== undefined) return cached;
    const result = calculateVisible(font, fill);
    byFill.set(fillKey, result);
    return result;
  };
  const formatFont = (
    font: Partial<ExcelJS.Font> | undefined,
    format: string | undefined,
    value: unknown,
  ) => {
    const sections = (format ?? '').split(';');
    const section =
      typeof value === 'number'
        ? sections[
            value < 0 && sections.length > 1
              ? 1
              : value === 0 && sections.length > 2
                ? 2
                : 0
          ]
        : sections.length === 1 && sections[0].includes('@')
          ? sections[0]
          : sections[3];
    const match =
      /\[(Black|White|Blue|Cyan|Green|Magenta|Red|Yellow|Color\d+)\]/i.exec(
        section ?? '',
      );
    if (!match) return font;
    const colors: Record<string, string> = {
      black: '000000',
      white: 'FFFFFF',
      blue: '0000FF',
      cyan: '00FFFF',
      green: '00FF00',
      magenta: 'FF00FF',
      red: 'FF0000',
      yellow: 'FFFF00',
    };
    // Unknown indexed format colors abstain; they never prove visibility.
    return {
      ...font,
      color: {
        argb: colors[match[1].toLowerCase()]
          ? `FF${colors[match[1].toLowerCase()]}`
          : '[unsupported]',
      },
    };
  };
  const rawStyles = xfs.map((xf) => {
    const base = bases[Number(xf.xfId ?? 0)];
    // Explicit false delegates the component to the referenced style XF.
    // Omitted flags retain the cell component used by ordinary Excel writers.
    const baseFont = xf.applyFont === '0' || xf.applyFont === 'false';
    const baseFill = xf.applyFill === '0' || xf.applyFill === 'false';
    const baseFormat =
      xf.applyNumberFormat === '0' || xf.applyNumberFormat === 'false';
    const font =
      fonts[
        Number(
          baseFont ? (base?.fontId ?? 0) : (xf.fontId ?? base?.fontId ?? 0),
        )
      ];
    const fill =
      fills[
        Number(
          baseFill ? (base?.fillId ?? 0) : (xf.fillId ?? base?.fillId ?? 0),
        )
      ];
    return {
      font,
      fill,
      numberFormat:
        numberFormats.get(
          Number(
            baseFormat
              ? (base?.numFmtId ?? 0)
              : (xf.numFmtId ?? base?.numFmtId ?? 0),
          ),
        ) ?? '[unsupported]',
      valid:
        !!font && !!fill && (!(baseFont || baseFill || baseFormat) || !!base),
    };
  });
  const effectiveStyle = (
    sheet: string,
    row: number,
    column: number,
    address: string,
    font: Partial<ExcelJS.Font> | undefined,
    fill: ExcelJS.Fill | undefined,
  ) => {
    const info = sheets.get(sheet);
    const index =
      info?.cellStyles.get(address) ??
      info?.rowStyles.get(row) ??
      info?.columnStyles.get(column) ??
      0;
    if (!styleXml) return { font, fill, valid: true, numberFormat: undefined };
    return (
      rawStyles[index] ?? { font, fill, valid: false, numberFormat: undefined }
    );
  };
  return { sheets, visible, effectiveStyle, formatFont };
}
