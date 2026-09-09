import { validateZipContents } from './zip.ts';
import { readPdf } from './pdf.ts';
import ExcelJS from 'exceljs';
import { ENGINE_VERSION, MAX_FILE_BYTES, MAX_ROWS } from './types.ts';
import type { SourceFile, SheetData, Comparison, AuditEvent } from './types.ts';
import { money, compare, normalizeSource } from './core.ts';
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
  return /^(?:0+|#{1,3},##0)(?:\.[0#]+)?$/.test(section);
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
    const extracted = await readPdf(buffer, pdfCuts);
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
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length > 12) throw new Error('الحد 12 ورقة في الملف');
  if (
    workbook.worksheets.reduce((n, s) => n + s.rowCount * s.columnCount, 0) >
    1000000
  )
    throw new Error('إجمالي خلايا المصنف يتجاوز مليون خلية');
  const sheets: SheetData[] = workbook.worksheets.map((sheet) => {
    const numericCells: NonNullable<SheetData['numericCells']> = {};
    const rowIssues: Record<string, string[]> = {};
    const issue = (row: number, message: string) => {
      (rowIssues[row] ??= []).push(message);
    };
    // ExcelJS 4.4 exposes this parsed model field but omits it from Worksheet's declarations.
    const formats = (
      sheet as ExcelJS.Worksheet & {
        conditionalFormattings: ExcelJS.ConditionalFormattingOptions[];
      }
    ).conditionalFormattings;
    const conditionalNumberFormat = formats.some((format) =>
      format.rules.some((rule) => !!rule.style?.numFmt),
    );
    if (
      sheet.rowCount > MAX_ROWS + 30 ||
      sheet.columnCount > 100 ||
      sheet.rowCount * sheet.columnCount > 1000000
    )
      throw new Error('الورقة تتجاوز حدود الصفوف أو الأعمدة');
    const rows: string[][] = [],
      formulaRows: number[] = [],
      hiddenRows: number[] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r),
        values: string[] = [];
      if (row.hidden) hiddenRows.push(r);
      if (conditionalNumberFormat)
        issue(
          r,
          'الورقة تحتوي تنسيق أرقام شرطيًا؛ لا ينفذ المحرك شروط Excel، استخدم نسخة قيم بتنسيق أرقام ثابت موثوق',
        );
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c);
        let text = '';
        const value = cell.value;
        if (cell.isMerged)
          issue(r, 'خلايا مدمجة في صف البيانات؛ استخدم جدولًا دون دمج');
        if (typeof value === 'number')
          numericCells[`${r}:${c}`] = { value, format: cell.numFmt ?? '' };
        if (
          typeof value === 'number' &&
          !transparentNumericFormat(cell.numFmt ?? '', value)
        )
          issue(
            r,
            `تنسيق Excel في ${cell.address} قد يغيّر عرض الإشارة أو القيمة أو المرجع؛ استخدم قيمة صريحة بتنسيق موثوق`,
          );
        if (
          typeof value === 'number' &&
          (!Number.isFinite(value) || Math.abs(value) >= 1e15)
        )
          issue(
            r,
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
            issue(r, 'تاريخ Excel يحتوي وقتًا؛ استخدم تاريخًا صريحًا دون وقت');
          text = value.toISOString().slice(0, 10);
        } else if (typeof value === 'object' && value !== null) {
          if ('formula' in value || 'sharedFormula' in value) {
            formulaRows.push(r);
            text = String('result' in value ? (value.result ?? '') : '');
          } else if ('richText' in value)
            text = value.richText.map((t) => t.text).join('');
          else if ('text' in value) text = String(value.text);
          else if ('error' in value) {
            text = String(value.error);
            issue(r, `خطأ Excel في ${cell.address}: ${text}`);
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
      rowIssues,
      rows,
      formulaRows: [...new Set(formulaRows)],
      hiddenRows,
    };
  });
  if (!sheets.length) throw new Error('الملف لا يحتوي أوراقًا');
  return { name, sheets, original: buffer.slice(0), sha256 };
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
  const add = (
    name: string,
    headers: string[],
    rows: (string | number)[][],
  ) => {
    const sheet = book.addWorksheet(name, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
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
      c.width = i === 0 ? 24 : 30;
    });
    if (headers.length > 1)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
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
  add(
    'Match evidence',
    ['حركة المورد', 'حركة الدفتر', 'دليل المحرك'],
    result.matches.map((m) => [
      m.supplierId,
      m.ledgerId,
      JSON.stringify(m.evidence ?? { rule: 'MANUAL_REVIEW', note: m.note }),
    ]),
  );
  add(
    'Review history',
    ['التوقيت', 'الإجراء', 'حركات المصدر', 'سبب المستخدم'],
    (review.events ?? []).map((e) => [
      e.time,
      e.action,
      e.ids.join(' | '),
      e.note,
    ]),
  );
  add(
    'Numeric cell origins',
    ['الطرف', 'الورقة', 'صف:عمود', 'القيمة الرقمية الأصلية', 'تنسيق Excel'],
    verifiedFiles.flatMap((f, i) => {
      const source = i === 0 ? result.supplier : result.ledger;
      const sheet = f.sheets[source.mapping.sheet];
      return Object.entries(sheet.numericCells ?? {}).map(([cell, meta]) => [
        i === 0 ? 'المورد' : 'الدفتر',
        sheet.name,
        cell,
        String(meta.value),
        meta.format,
      ]);
    }),
  );
  const b = result.bridge;
  add(
    'Summary',
    ['الحقل', 'القيمة'],
    [
      ['الحالة', 'نسخة تجريبية — ورقة عمل للمراجعة وليست اعتمادًا محاسبيًا'],
      ['المورد', result.scope.supplier],
      ['الجهة', result.scope.entity],
      ['الحساب', result.scope.account],
      ['العملة', result.scope.currency],
      ['تاريخ القطع', result.scope.cutoff],
      ['نوع التقرير', result.supplier.mapping.reportType],
      [
        'المطابقات الآلية',
        result.matches.filter((m) => m.kind === 'auto').length,
      ],
      [
        'المطابقات اليدوية',
        result.matches.filter((m) => m.kind === 'manual').length,
      ],
      ['بنود المورد دون مقابل', result.supplierOnly.length],
      ['بنود الدفتر دون مقابل', result.ledgerOnly.length],
      [
        'رصيد المورد',
        result.supplier.closing === null
          ? 'غير متاح'
          : money(result.supplier.closing, dp),
      ],
      [
        'رصيد الدفتر',
        result.ledger.closing === null
          ? 'غير متاح'
          : money(result.ledger.closing, dp),
      ],
      [
        'اتساق رصيد المورد',
        result.supplier.balanceValid ? 'تحقق الاتساق فقط' : 'غير متحقق',
      ],
      [
        'اتساق رصيد الدفتر',
        result.ledger.balanceValid ? 'تحقق الاتساق فقط' : 'غير متحقق',
      ],
      [
        'الجسر',
        b ? 'جسر حسابي؛ لا يثبت أسباب الفروق' : 'غير متاح؛ مقارنة حركات فقط',
      ],
      ['فرق الأرصدة', b ? money(b.delta, dp) : 'غير متاح'],
      ['تعديل فرق الافتتاح', b ? money(b.openingAdjustment, dp) : 'غير متاح'],
      [
        'صافي أثر البنود دون مقابل',
        b ? money(b.itemAdjustment, dp) : 'غير متاح',
      ],
      ['الرصيد المعدل حسابيًا', b ? money(b.adjusted, dp) : 'غير متاح'],
      ['الباقي الحسابي', b ? money(b.residual, dp) : 'غير متاح'],
      [
        'الأسباب المحاسبية',
        'لا يعتمد المحرك أسباب الفروق؛ جميع الآثار غير المفسرة تبقى للمراجعة',
      ],
      [
        'مراجعة المحاسب',
        review.checked
          ? 'أشار المستخدم إلى إتمام المراجعة'
          : 'لم يؤكد المستخدم إتمام المراجعة',
      ],
      ['اسم المراجع', review.name],
      ['ملاحظات المراجع', review.notes],
      ['إصدار المحرك', ENGINE_VERSION],
      [
        'بصمة ملف المورد SHA-256',
        files[0].sha256 ?? 'مثال اصطناعي دون ملف أصلي',
      ],
      [
        'بصمة ملف الدفتر SHA-256',
        files[1].sha256 ?? 'مثال اصطناعي دون ملف أصلي',
      ],
      ['وقت التصدير', new Date().toISOString()],
    ],
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
    t.date,
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
    'Matches',
    ['حركة المورد', 'حركة الدفتر', 'النوع', 'دليل القاعدة', 'ملاحظة المستخدم'],
    result.matches.map((m) => [
      m.supplierId,
      m.ledgerId,
      m.kind,
      m.reason,
      m.note ?? '',
    ]),
  );
  add('Supplier only', txHeaders, result.supplierOnly.map(tx));
  add('Ledger only', txHeaders, result.ledgerOnly.map(tx));
  for (const name of ['Supplier only', 'Ledger only'])
    book.getWorksheet(name)!.getColumn(8).numFmt = dp
      ? '#,##0.' + '0'.repeat(dp)
      : '#,##0';
  add(
    'Suggestions',
    ['حركة المورد', 'مرشحو الدفتر', 'الحالة'],
    Object.entries(result.suggestions)
      .filter(([, ids]) => ids.length)
      .map(([id, ids]) => [
        id,
        ids.join(' | '),
        'اقتراح غير معتمد؛ المبلغ قد يختلف',
      ]),
  );
  add(
    'Rejected links',
    ['رابط الحركتين', 'القرار'],
    result.rejectedPairs.map((pair) => [
      pair,
      'فك المستخدم الربط؛ لا يعاد آليًا في هذه الجلسة',
    ]),
  );
  add(
    'Ambiguities',
    ['معرف الحركة', 'الحالة'],
    result.ambiguousIds.map((id) => [id, 'تكرار مرجع؛ لا حذف تلقائي']),
  );
  add(
    'Bridge items',
    ['الطرف', 'الحركة', 'الأثر للوصول من المورد إلى الدفتر', 'السبب'],
    [
      ...(b && b.openingAdjustment !== 0
        ? [
            [
              'الافتتاح',
              'فرق أرصدة افتتاحية',
              money(b.openingAdjustment, dp),
              'غير مفسر',
            ],
          ]
        : []),
      ...result.supplierOnly.map((t) => [
        'المورد',
        t.id,
        money(-t.amount, dp),
        'لم يوجد مقابل في الملف المقدم؛ السبب غير مثبت',
      ]),
      ...result.ledgerOnly.map((t) => [
        'الدفتر',
        t.id,
        money(t.amount, dp),
        'لم يوجد مقابل في الملف المقدم؛ السبب غير مثبت',
      ]),
    ],
  );
  add(
    'Excluded rows',
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
    'Run settings',
    ['الحقل', 'القيمة'],
    [
      ['Scope', JSON.stringify(result.scope)],
      ['Supplier mapping', JSON.stringify(result.supplier.mapping)],
      ['Ledger mapping', JSON.stringify(result.ledger.mapping)],
      ['Supplier PDF layout', JSON.stringify(files[0].pdf ?? null)],
      ['Ledger PDF layout', JSON.stringify(files[1].pdf ?? null)],
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
      i === 0 ? 'Supplier source' : 'Ledger source',
      [
        'صف المصدر',
        ...Array.from({ length: width }, (_, n) => `عمود ${n + 1}`),
      ],
      sheet.rows.map((row, r) => [r + 1, ...row]),
    );
  });
  add(
    'PDF row origins',
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
  const data = await book.xlsx.writeBuffer();
  return new Uint8Array(data).slice().buffer;
}
