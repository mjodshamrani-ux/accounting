import { validateZipContents } from './zip.ts';
import { assertNativeAccountingSource } from './source-boundary.ts';
import { prepareXlsxForExcelJs } from './xlsx-namespaces.ts';
import { readPdf } from './pdf.ts';
import ExcelJS from 'exceljs';
import {
  ENGINE_VERSION,
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_SHEETS,
} from './types.ts';
import type {
  SourceFile,
  SheetData,
  Comparison,
  AuditEvent,
  Mapping,
} from './types.ts';
import { compare, normalizeSource } from './core.ts';
import { addCaseWorksheets, parsedSourceLink } from './case-workbook.ts';
import { inferStatementDirection } from './statement-direction.ts';
// Admit only formats whose visible numeric meaning is understood. Native values
// stay exact; unsupported display semantics require source review, never guessing.
function transparentNumericFormat(format: string, value: number): boolean {
  if (!format || /^general$/i.test(format)) return true;
  const sections = format.split(';');
  if (sections.length > 4) return false;
  const index =
    value < 0 && sections.length > 1
      ? 1
      : value === 0 && sections.length > 2
        ? 2
        : 0;
  let section = sections[index].replace(/_.|\*./gu, '');
  const currency = (s: string) =>
    /^(?:[$€£¥₹₩]|SAR|USD|EUR|GBP|AED|KWD|JPY|ر\.س\.?|د\.إ\.?|د\.ك\.?)$/i.test(
      s.replace(/[\u200e\u200f\u061c]/g, '').trim(),
    );
  let understood = true;
  section = section
    .replace(/"([^"]*)"/g, (_, literal: string) => {
      if (!literal.trim()) return '';
      if (value === 0 && literal === '-') return '-';
      if (!currency(literal)) understood = false;
      return '';
    })
    .replace(/\[\$([^\]]*)\]/g, (_, tag: string) => {
      const match = /^(.*)-[0-9a-f]+$/i.exec(tag);
      const symbol = match ? match[1] : tag;
      if (symbol && !currency(symbol)) understood = false;
      return '';
    })
    .replace(/\[(?:Black|Blue|Cyan|Green|Magenta|Red|Yellow)\]/gi, '')
    .replace(/\\([$€£¥() +\-])/g, '$1')
    .replace(/[$€£¥₹₩\s]/g, '');
  if (!understood || /["\\\[\]%]/.test(section)) return false;
  if (/^general$/i.test(section)) return true;
  if (value === 0 && /^-\?*$/.test(section)) return true;
  if (index === 1) {
    if (section.startsWith('-')) section = section.slice(1);
    else if (section.startsWith('(') && section.endsWith(')'))
      section = section.slice(1, -1);
    else return false; // A negative section without a sign hides its sign.
  }
  return /^(?:#*0+|#{1,3},##0)(?:\.[0#]+)?$/.test(section);
}

// ExcelJS returns a { id, formatCode } object for a parsed differential style,
// although its public types describe numFmt as a string.
function conditionalFormatCode(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    'formatCode' in value &&
    typeof value.formatCode === 'string'
  )
    return value.formatCode;
  return '[unsupported]';
}

function numericReference(format: string, value: number): string | null {
  if (!format || /^general$/i.test(format)) return String(value);
  if (/^0+$/.test(format) && Number.isInteger(value)) {
    if (value >= 0) return String(value).padStart(format.length, '0');
    if (format === '0') return String(value);
  }
  return null;
}

function transparentTextFormat(format: string): boolean {
  const sections = format.split(';');
  if (sections.length < 4) return true;
  if (sections.length !== 4) return false;
  return (
    sections[3]
      .replace(/_.|\*./gu, '')
      .replace(/\[(?:Black|Blue|Cyan|Green|Magenta|Red|Yellow)\]/gi, '')
      .trim() === '@'
  );
}

// Conditional formats apply to ranges, not the entire worksheet. Unknown
// range syntax is conservatively treated as applicable, never silently ignored.
function rangeContains(ref: string, row: number, column: number): boolean {
  const colIndex = (letters: string) =>
    [...letters.toUpperCase()].reduce(
      (n, letter) => n * 26 + letter.charCodeAt(0) - 64,
      0,
    );
  return ref.split(/\s+/).some((range) => {
    const clean = range.replace(/\$/g, '');
    const cells = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(clean);
    if (cells)
      return (
        row >= +cells[2] &&
        row <= +(cells[4] ?? cells[2]) &&
        column >= colIndex(cells[1]) &&
        column <= colIndex(cells[3] ?? cells[1])
      );
    const columns = /^([A-Z]+):([A-Z]+)$/i.exec(clean);
    if (columns)
      return column >= colIndex(columns[1]) && column <= colIndex(columns[2]);
    const rows = /^(\d+):(\d+)$/.exec(clean);
    if (rows) return row >= +rows[1] && row <= +rows[2];
    return true;
  });
}
export function validateCellText(text: string): void {
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text) ||
    !text.isWellFormed()
  )
    throw new Error(
      'النص يحتوي محارف تحكم أو Unicode غير صالح لملف Excel؛ صحح المصدر دون حذف صامت',
    );
}
export function parseCSV(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\u0000'))
    throw new Error('ترميز CSV غير مدعوم. استخدم UTF-8');
  validateCellText(text);
  function tokenize(delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [],
      cell = '',
      quoted = false,
      afterQuote = false;
    const endCell = () => {
      if (cell.length > 4096) throw new Error('خلية أطول من الحد المسموح');
      row.push(cell);
      cell = '';
      afterQuote = false;
      if (row.length > 100) throw new Error('الحد 100 عمود');
    };
    const endRow = () => {
      endCell();
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 30)
        throw new Error(`الحد ${MAX_ROWS} حركة تقريبًا مع صفوف العناوين`);
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            afterQuote = true;
          }
        } else cell += c;
      } else if (c === '"') {
        if (cell || afterQuote) throw new Error('علامات اقتباس CSV غير صحيحة');
        quoted = true;
      } else if (c === delimiter) endCell();
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        endRow();
      } else {
        if (afterQuote) throw new Error('نص بعد إغلاق اقتباس CSV');
        cell += c;
      }
    }
    if (quoted) throw new Error('اقتباس CSV غير مغلق');
    if (cell || row.length || afterQuote) endRow();
    return rows;
  }
  const candidates = [',', ';', '\t']
    .map((d) => {
      try {
        const rows = tokenize(d);
        const widths = rows
          .slice(0, 20)
          .filter((r) => r.some(Boolean))
          .map((r) => r.length);
        const score = widths.filter((w) => w > 1).length;
        return { rows, score };
      } catch {
        return { rows: [] as string[][], score: -1 };
      }
    })
    .sort((a, b) => b.score - a.score);
  if (candidates[0].score <= 0)
    throw new Error(
      'لم يُقرأ CSV بأعمدة متعددة؛ استخدم فاصلة أو فاصلة منقوطة أو Tab وترميز UTF-8',
    );
  if (candidates[1].score === candidates[0].score)
    throw new Error(
      'فاصل CSV ملتبس؛ أعد حفظ الملف بفاصل واضح واقتبس القيم التي تحتوي فواصل',
    );
  return candidates[0].rows;
}
export function checkZip(buffer: ArrayBuffer): void {
  const v = new DataView(buffer);
  if (v.byteLength < 22 || v.getUint32(0, true) !== 0x04034b50)
    throw new Error('ملف XLSX غير صالح أو مشفر');
  let eocd = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('أرشيف XLSX غير مكتمل');
  const entries = v.getUint16(eocd + 10, true),
    offset = v.getUint32(eocd + 16, true);
  if (entries > 1000 || entries === 65535 || offset >= v.byteLength)
    throw new Error('ملف XLSX أكثر تعقيدًا من الحد المدعوم');
  let pos = offset,
    total = 0;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > v.byteLength || v.getUint32(pos, true) !== 0x02014b50)
      throw new Error('فهرس XLSX غير صالح');
    const size = v.getUint32(pos + 24, true),
      nameLen = v.getUint16(pos + 28, true),
      extra = v.getUint16(pos + 30, true),
      comment = v.getUint16(pos + 32, true);
    total += size;
    if (total > 32 * 1024 * 1024 || size === 0xffffffff)
      throw new Error('محتوى XLSX بعد فك الضغط يتجاوز 32 MB');
    const name = new TextDecoder().decode(
      new Uint8Array(buffer, pos + 46, nameLen),
    );
    if (/vbaProject|externalLinks/i.test(name))
      throw new Error('الماكرو والروابط الخارجية غير مدعومة');
    pos += 46 + nameLen + extra + comment;
  }
}
export async function readFile(
  name: string,
  buffer: ArrayBuffer,
  pdfCuts?: number[],
  autoPdfColumns = false,
): Promise<SourceFile> {
  if (buffer.byteLength > MAX_FILE_BYTES)
    throw new Error('حجم الملف يتجاوز 8 MB');
  const sha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  if (/\.csv$/i.test(name)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new Error('استخدم CSV بترميز UTF-8');
    }
    return {
      name,
      original: buffer.slice(0),
      sha256,
      sheets: [
        { name: 'CSV', rows: parseCSV(text), formulaRows: [], hiddenRows: [] },
      ],
    };
  }
  if (/\.pdf$/i.test(name)) {
    const extracted = await readPdf(buffer, pdfCuts, autoPdfColumns);
    for (const s of extracted.sheets)
      for (const row of s.rows)
        for (const cell of row) {
          validateCellText(cell);
          if (cell.length > 4096)
            throw new Error(
              'خلية PDF أطول من الحد المسموح؛ تحقق من حدود الأعمدة',
            );
        }
    return { name, original: buffer.slice(0), sha256, ...extracted };
  }
  if (!/\.xlsx$/i.test(name))
    throw new Error('الصيغ المدعومة XLSX وCSV وPDF النصي');
  checkZip(buffer);
  await validateZipContents(buffer);
  const workbook = new ExcelJS.Workbook();
  const numericLexemeIssues = new Map<
    string,
    import('./xlsx-namespaces.ts').NumericLexemeIssue[]
  >();
  await workbook.xlsx.load(
    await prepareXlsxForExcelJs(buffer, numericLexemeIssues),
  );
  if (workbook.worksheets.length > MAX_SHEETS)
    throw new Error(`الحد ${MAX_SHEETS} ورقة في الملف`);
  if (
    workbook.worksheets.reduce((n, s) => n + s.rowCount * s.columnCount, 0) >
    1000000
  )
    throw new Error('إجمالي خلايا المصنف يتجاوز مليون خلية');
  const sheets: SheetData[] = workbook.worksheets.map((sheet) => {
    const numericCells: NonNullable<SheetData['numericCells']> = {};
    const cellIssues: Record<string, string[]> = {};
    const cellNotes: Record<string, string[]> = {};
    const referenceIssues: Record<string, string[]> = {};
    const issue = (row: number, column: number, message: string) => {
      (cellIssues[`${row}:${column}`] ??= []).push(message);
    };
    const note = (row: number, column: number, message: string) => {
      (cellNotes[`${row}:${column}`] ??= []).push(message);
    };
    for (const raw of numericLexemeIssues.get(sheet.name) ?? []) {
      const coordinate = /^([A-Z]+)([1-9]\d*)$/.exec(raw.cell);
      if (!coordinate)
        throw new Error('إحداثيات القيمة الرقمية الأصلية غير مدعومة');
      const column = [...coordinate[1]].reduce(
        (n, char) => n * 26 + char.charCodeAt(0) - 64,
        0,
      );
      issue(
        Number(coordinate[2]),
        column,
        `دقة القيمة الأصلية في ${raw.cell} تتغير عند قراءتها رقمياً؛ راجع المصدر وثبّت المبلغ بدقة العملة قبل اعتماده`,
      );
    }
    // ExcelJS 4.4 exposes this parsed model field but omits it from Worksheet's declarations.
    const formats = (
      sheet as ExcelJS.Worksheet & {
        conditionalFormattings: ExcelJS.ConditionalFormattingOptions[];
      }
    ).conditionalFormattings;
    const conditionalFormats = formats.filter((format) =>
      format.rules.some((rule) => !!rule.style?.numFmt),
    );
    if (
      sheet.rowCount > MAX_ROWS + 30 ||
      sheet.columnCount > 100 ||
      sheet.rowCount * sheet.columnCount > 1000000
    )
      throw new Error('الورقة تتجاوز حدود الصفوف أو الأعمدة');
    const formulaCells: NonNullable<SheetData['formulaCells']> = {};
    const rows: string[][] = [],
      formulaRows: number[] = [],
      hiddenRows: number[] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r),
        values: string[] = [];
      if (row.hidden) hiddenRows.push(r);
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c);
        let text = '';
        const value = cell.value;
        const textValue =
          typeof value === 'string'
            ? value
            : value && typeof value === 'object' && 'richText' in value
              ? value.richText.map((part) => part.text).join('')
              : value && typeof value === 'object' && 'text' in value
                ? String(value.text)
                : undefined;
        const applicableFormats = conditionalFormats
          .filter((format) => rangeContains(format.ref, r, c))
          .flatMap((format) =>
            format.rules
              .filter((rule) => !!rule.style?.numFmt)
              .map((rule) => conditionalFormatCode(rule.style!.numFmt)),
          );
        if (
          textValue &&
          [cell.numFmt ?? '', ...applicableFormats].some(
            (format) => !transparentTextFormat(format),
          )
        )
          issue(
            r,
            c,
            `تنسيق النص في ${cell.address} قد يخفي محتوى الخلية أو يغيّره؛ استخدم نصًا ظاهرًا بتنسيق عام`,
          );
        if (cell.isMerged)
          issue(
            r,
            c,
            `خلية مدمجة في ${cell.address}؛ استخدم جدولًا دون دمج في الأعمدة المختارة`,
          );
        if (
          typeof value === 'number' &&
          applicableFormats.some(
            (format) => !transparentNumericFormat(format, value),
          )
        )
          issue(
            r,
            c,
            `تنسيق أرقام شرطي في ${cell.address} قد يغيّر عرض القيمة؛ استخدم تنسيق أرقام ثابتًا موثوقًا لهذه الخلية`,
          );
        if (typeof value === 'number')
          numericCells[`${r}:${c}`] = { value, format: cell.numFmt ?? '' };
        if (typeof value === 'number') {
          const reference = numericReference(cell.numFmt ?? '', value);
          if (
            reference === null ||
            applicableFormats.some(
              (format) => numericReference(format, value) !== reference,
            )
          )
            referenceIssues[`${r}:${c}`] = [
              `تنسيق المرجع الرقمي في ${cell.address} قد يغيّر نص المعرف؛ احفظ المرجع الظاهر كنص صريح قبل المطابقة`,
            ];
        }
        if (
          typeof value === 'number' &&
          !transparentNumericFormat(cell.numFmt ?? '', value)
        )
          issue(
            r,
            c,
            `تنسيق Excel في ${cell.address} قد يغيّر عرض الإشارة أو القيمة أو المرجع؛ استخدم قيمة صريحة بتنسيق موثوق`,
          );
        if (
          typeof value === 'number' &&
          (!Number.isFinite(value) || Math.abs(value) >= 1e15)
        )
          issue(
            r,
            c,
            `قيمة رقمية قد تفقد الدقة في ${cell.address}؛ احفظ المراجع الطويلة كنص`,
          );
        if (value instanceof Date) {
          if (Number.isNaN(value.getTime()))
            throw new Error('تاريخ Excel غير صالح');
          if (
            value.getUTCHours() ||
            value.getUTCMinutes() ||
            value.getUTCSeconds() ||
            value.getUTCMilliseconds()
          )
            note(
              r,
              c,
              `تاريخ ${cell.address} يحمل وقتًا؛ قُرئ اليوم ${value.toISOString().slice(0, 10)} دون الوقت`,
            );
          text = value.toISOString().slice(0, 10);
        } else if (typeof value === 'object' && value !== null) {
          if ('formula' in value || 'sharedFormula' in value) {
            formulaRows.push(r);
            // Preserve the expression for the separate, restricted balance-only
            // evaluator. Transaction columns still reject formulas below. The
            // getter translates shared formulas to this cell's own coordinates.
            try {
              const formula = cell.formula;
              if (typeof formula === 'string' && formula.trim())
                formulaCells[`${r}:${c}`] = { formula };
            } catch {
              // An unsupported shared expression is not a usable proof.
            }
            issue(
              r,
              c,
              `صيغة Excel في ${cell.address}؛ استخدم قيمة ثابتة موثوقة في العمود المختار أو استبعد الصف مع سبب`,
            );
            text = String('result' in value ? (value.result ?? '') : '');
          } else if ('richText' in value)
            text = value.richText.map((t) => t.text).join('');
          else if ('text' in value) text = String(value.text);
          else if ('error' in value) {
            text = String(value.error);
            issue(r, c, `خطأ Excel في ${cell.address}: ${text}`);
          }
        } else if (
          typeof value === 'number' &&
          /^0{2,}$/.test(cell.numFmt) &&
          Number.isInteger(value) &&
          value >= 0
        )
          text = String(value).padStart(cell.numFmt.length, '0');
        else text = value === null || value === undefined ? '' : String(value);
        validateCellText(text);
        if (text.length > 4096) throw new Error('خلية أطول من الحد المسموح');
        values.push(text);
      }
      rows.push(values);
    }
    return {
      name: sheet.name,
      numericCells,
      formulaCells,
      cellIssues,
      cellNotes,
      referenceIssues,
      rows,
      formulaRows: [...new Set(formulaRows)],
      hiddenRows,
    };
  });
  if (!sheets.length) throw new Error('الملف لا يحتوي أوراقًا');
  return { name, sheets, original: buffer.slice(0), sha256 };
}
export function verifyDirectionEvidence(
  file: SourceFile,
  mapping: Mapping,
  decimals: number,
): Mapping {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))
    throw new Error('إعدادات قراءة المصدر غير صالحة');
  if (mapping.directionEvidence === undefined) return mapping;
  const claimed = mapping.directionEvidence;
  const proven = inferStatementDirection(file, mapping, decimals);
  if (
    !claimed ||
    typeof claimed !== 'object' ||
    Array.isArray(claimed) ||
    !proven ||
    claimed.multiplier !== proven.multiplier ||
    mapping.multiplier !== proven.multiplier ||
    claimed.balanceColumn !== proven.balanceColumn ||
    claimed.checkedRows !== proven.checkedRows
  )
    throw new Error(
      'دليل اتجاه المدين والدائن لا يطابق المصدر؛ أعد التحقق من اتجاه المبالغ',
    );
  return { ...mapping, directionEvidence: proven };
}
export async function exportWorkbook(
  result: Comparison,
  files: [SourceFile, SourceFile],
  review: {
    checked: boolean;
    name: string;
    notes: string;
    events?: AuditEvent[];
  },
): Promise<ArrayBuffer> {
  files.forEach(assertNativeAccountingSource);
  const verifiedFiles = await Promise.all(
    files.map((f) =>
      f.original
        ? readFile(f.name, f.original, f.pdf?.cuts)
        : Promise.resolve(f),
    ),
  );
  for (let i = 0; i < files.length; i++)
    if (files[i].sha256 !== verifiedFiles[i].sha256)
      throw new Error('بصمة الملف لا تطابق الأصل');
  // Re-prove annotations from the original source; never export a stale claim
  // or treat caller-provided explanation text as verified accounting evidence.
  result = {
    ...result,
    supplier: {
      ...result.supplier,
      mapping: verifyDirectionEvidence(
        verifiedFiles[0],
        result.supplier.mapping,
        result.scope.decimals,
      ),
    },
    ledger: {
      ...result.ledger,
      mapping: verifyDirectionEvidence(
        verifiedFiles[1],
        result.ledger.mapping,
        result.scope.decimals,
      ),
    },
  };
  const recomputed = compare(
    normalizeSource(
      verifiedFiles[0],
      result.supplier.mapping,
      result.scope,
      'supplier',
    ),
    normalizeSource(
      verifiedFiles[1],
      result.ledger.mapping,
      result.scope,
      'ledger',
    ),
    result.scope,
    result.matches
      .filter((m) => m.kind === 'manual')
      .map((m) => ({
        supplierId: m.supplierId,
        ledgerId: m.ledgerId,
        note: m.note ?? '',
      })),
    result.rejectedPairs,
  );
  if (JSON.stringify(recomputed) !== JSON.stringify(result))
    throw new Error(
      'النتيجة لا تطابق إعادة الحساب من المصدر؛ أعد المقارنة قبل التصدير',
    );
  const book = new ExcelJS.Workbook();
  book.creator = 'Mizan Local';
  book.created = new Date();
  const dp = result.scope.decimals;
  addCaseWorksheets(book, result, verifiedFiles, review, validateCellText);
  const add = (
    name: string,
    headers: string[],
    rows: ExcelJS.CellValue[][],
  ) => {
    const sheet = book.addWorksheet(name, {
      state: 'hidden',
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.addRow(headers);
    for (const row of rows) {
      for (const value of row)
        if (typeof value === 'string') validateCellText(value);
      sheet.addRow(row);
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF155C4C' },
    };
    sheet.getRow(1).height = 28;
    sheet.columns.forEach((c, i) => {
      c.width = Math.min(
        65,
        Math.max(
          16,
          headers[i].length + 4,
          ...rows
            .slice(0, 50)
            .map((row) => Math.min(45, String(row[i] ?? '').length + 2)),
        ),
      );
    });
    if (headers.length > 1)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, rows.length + 1), column: headers.length },
      };
    sheet.eachRow((row, index) => {
      if (index > 1)
        row.alignment = {
          vertical: 'top',
          wrapText: true,
          readingOrder: 'ltr',
        };
      row.eachCell((cell) => {
        if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
      });
    });
    return sheet;
  };
  add(
    'Diagnostics',
    ['الرمز', 'التفسير', 'حركات المصدر'],
    result.diagnostics.map((d) => [
      d.code,
      d.message,
      d.transactionIds.join(' | '),
    ]),
  );
  const evidenceSheet = add(
    'Match Evidence',
    [
      'Case ID',
      'Classification',
      'Status',
      'Rule',
      'Evidence',
      'Side',
      'Source Row ID',
      'Source Sheet',
      'Source Row',
      'PDF Page',
      'Date',
      'Primary Reference',
      'Document Reference',
      'Voucher Reference',
      'PO Reference',
      'Bank Reference',
      'Receipt Reference',
      'Currency',
      'Amount',
      'Source Link',
      'Reviewer Decision',
      'Reviewer Reason',
    ],
    result.cases.flatMap((c) =>
      [...c.supplierMembers, ...c.ledgerMembers].map((t) => [
        c.caseId,
        c.classification,
        c.status,
        c.matchingRule,
        c.evidence.join('\n'),
        t.side,
        t.id,
        t.sheet,
        t.row,
        t.sourcePage ?? '',
        new Date(`${t.date}T00:00:00.000Z`),
        t.primaryReference || t.reference,
        t.documentReference ?? '',
        t.voucherReference ?? '',
        t.poReference ?? '',
        t.bankReference ?? '',
        t.receiptReference ?? '',
        t.currency ?? result.scope.currency,
        (t.amountMinor ?? t.amount) / 10 ** dp,
        parsedSourceLink(t),
        c.reviewerDecision ?? '',
        c.reviewerReason ?? '',
      ]),
    ),
  );
  evidenceSheet.getColumn(19).numFmt = dp ? '#,##0.' + '0'.repeat(dp) : '#,##0';
  add(
    'Review History',
    ['Timestamp', 'Action', 'Source Row IDs', 'User Reason'],
    (review.events ?? []).map((e) => [
      Number.isFinite(Date.parse(e.time)) ? new Date(e.time) : e.time,
      e.action,
      e.ids.join(' | '),
      e.note,
    ]),
  );
  const numericOrigins = verifiedFiles.flatMap((f, i) => {
    const source = i === 0 ? result.supplier : result.ledger;
    const sheet = f.sheets[source.mapping.sheet];
    return [
      ...Object.entries(sheet.numericCells ?? {}).map(([cell, meta]) => [
        i === 0 ? 'supplier' : 'ledger',
        sheet.name,
        cell,
        meta.value,
        meta.format,
        '',
      ]),
      ...Object.entries(sheet.formulaCells ?? {}).map(([cell, meta]) => [
        i === 0 ? 'supplier' : 'ledger',
        sheet.name,
        cell,
        null,
        '',
        meta.formula,
      ]),
    ];
  });
  if (numericOrigins.length)
    add(
      'Numeric Cell Origins',
      [
        'Side',
        'Source Sheet',
        'Row:Column',
        'Original Numeric Value',
        'Original Excel Format',
        'Original Formula (text; not a trusted cached amount)',
      ],
      numericOrigins,
    );
  const txHeaders = [
    'المعرف',
    'الورقة',
    'صف المصدر',
    'التاريخ',
    'المرجع الأصلي',
    'المرجع الموحد',
    'الوصف',
    'المبلغ الموحد',
    'المبلغ الأصلي',
    'صفحة PDF الأصلية',
  ];
  const tx = (t: Comparison['supplierOnly'][number]) => [
    t.id,
    t.sheet,
    t.row,
    new Date(`${t.date}T00:00:00.000Z`),
    t.reference,
    t.normalizedReference,
    t.description,
    t.amount / 10 ** dp,
    t.originalAmount,
    t.sourcePage ?? '',
  ];
  add('Supplier transactions', txHeaders, result.supplier.transactions.map(tx));
  add('Ledger transactions', txHeaders, result.ledger.transactions.map(tx));
  for (const name of ['Supplier transactions', 'Ledger transactions'])
    book.getWorksheet(name)!.getColumn(8).numFmt = dp
      ? '#,##0.' + '0'.repeat(dp)
      : '#,##0';
  add(
    'Excluded Rows',
    ['الطرف', 'صف المصدر', 'سبب الاستبعاد', 'المحتوى'],
    [
      ...result.supplier.excluded.map((r) => [
        'المورد',
        r.row,
        r.reason,
        JSON.stringify(r.values),
      ]),
      ...result.ledger.excluded.map((r) => [
        'الدفتر',
        r.row,
        r.reason,
        JSON.stringify(r.values),
      ]),
    ],
  );
  add(
    'Run Settings',
    ['الحقل', 'القيمة'],
    [
      ['Scope', JSON.stringify(result.scope)],
      ['Supplier mapping', JSON.stringify(result.supplier.mapping)],
      ['Ledger mapping', JSON.stringify(result.ledger.mapping)],
      ['Supplier PDF layout', JSON.stringify(files[0].pdf ?? null)],
      ['Ledger PDF layout', JSON.stringify(files[1].pdf ?? null)],
      ['Supplier metadata', JSON.stringify(result.supplier.metadata ?? null)],
      ['Ledger metadata', JSON.stringify(result.ledger.metadata ?? null)],
      ['Rejected pairs', JSON.stringify(result.rejectedPairs)],
      ['Ambiguous source rows', JSON.stringify(result.ambiguousIds)],
      ['Candidate links (not approvals)', JSON.stringify(result.suggestions)],
      ['Supplier filename', files[0].name],
      ['Ledger filename', files[1].name],
      ['تحذيرات المورد', result.supplier.warnings.join(' | ')],
      ['تحذيرات الدفتر', result.ledger.warnings.join(' | ')],
      [
        'حفظ البيانات',
        'هذه النسخة تحفظ بيانات داخل ملف Excel المصدر الذي يختاره المستخدم؛ لا تحفظها على خادم',
      ],
    ],
  );
  verifiedFiles.forEach((file, i) => {
    const sheet =
      file.sheets[(i === 0 ? result.supplier : result.ledger).mapping.sheet];
    const width = Math.max(1, ...sheet.rows.map((r) => r.length));
    add(
      i === 0 ? 'Parsed Supplier Source' : 'Parsed Ledger Source',
      [
        'صف المصدر',
        ...Array.from({ length: width }, (_, n) => `عمود ${n + 1}`),
      ],
      sheet.rows.map((row, r) => [r + 1, ...row]),
    );
  });
  add(
    'PDF Row Origins',
    ['الطرف', 'صف الاستخراج', 'صفحة PDF', 'المحتوى المستخرج'],
    verifiedFiles.flatMap((file, i) =>
      file.pdf
        ? file.sheets[0].rows.map((row, r) => [
            i === 0 ? 'المورد' : 'الدفتر',
            r + 1,
            file.sheets[0].rowPages?.[String(r + 1)] ?? '',
            JSON.stringify(row),
          ])
        : [],
    ),
  );
  const headerFragments = verifiedFiles.flatMap((file, side) =>
    file.pdf
      ? Object.entries(file.sheets[0].pdfHeaderFragments ?? {}).flatMap(
          ([row, fragments]) =>
            fragments.flatMap((fragment, line) =>
              fragment.map((text, column) => [
                side === 0 ? 'المورد' : 'الدفتر',
                Number(row),
                file.sheets[0].rowPages?.[row] ?? '',
                line + 1,
                column + 1,
                text,
              ]),
            ),
        )
      : [],
  );
  if (headerFragments.length)
    add(
      'PDF Header Fragments',
      [
        'الطرف',
        'صف العنوان المدمج',
        'صفحة PDF',
        'سطر العنوان الأصلي',
        'عمود المصدر',
        'نص العنوان الأصلي',
      ],
      headerFragments,
    );
  add(
    'Export Metadata',
    ['Field', 'Value'],
    [
      ['Engine version', ENGINE_VERSION],
      ['Supplier SHA-256', verifiedFiles[0].sha256 ?? 'No original file'],
      ['Ledger SHA-256', verifiedFiles[1].sha256 ?? 'No original file'],
      ['Export time', book.created],
      [
        'Workbook mode',
        'Verified snapshot; workbook edits do not change engine decisions',
      ],
      [
        'Parsed source meaning',
        'Extracted cells with original source row numbers, not visual reproductions of the original documents',
      ],
    ],
  );
  const data = await book.xlsx.writeBuffer();
  return new Uint8Array(data).slice().buffer;
}
