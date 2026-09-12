import { inferMapping } from './core.ts';
import { defaultMapping } from './types.ts';
import type { Mapping, SheetData, SourceFile } from './types.ts';

export type ImportSelection = {
  mapping: Mapping;
  kind: 'workpaper' | 'unique-table' | 'single-sheet' | 'choose-sheet';
  notice: string;
};

const sameHeader = (sheet: SheetData | undefined, values: string[]) =>
  !!sheet &&
  sheet.rows[0]?.length === values.length &&
  values.every((value, i) => sheet.rows[0][i] === value);

function sourceCopy(sheet: SheetData | undefined): boolean {
  const header = sheet?.rows[0];
  return (
    !!header &&
    header.length > 1 &&
    header[0] === 'صف المصدر' &&
    header.slice(1).every((value, i) => value === `عمود ${i + 1}`)
  );
}

// These signatures identify a useful layout, not the authenticity of a workbook.
// Suggestions never restore exported approvals, balances, or review decisions.
function workpaperSources(file: SourceFile): [number, number] | null {
  const get = (name: string) =>
    file.sheets.find((sheet) => sheet.name === name);
  const settings = get('Run settings');
  if (
    !sameHeader(get('Diagnostics'), ['الرمز', 'التفسير', 'حركات المصدر']) ||
    !sameHeader(settings, ['الحقل', 'القيمة']) ||
    !['Scope', 'Supplier mapping', 'Ledger mapping'].every((key) =>
      settings?.rows.slice(1).some((row) => row[0] === key),
    ) ||
    !sourceCopy(get('Supplier source')) ||
    !sourceCopy(get('Ledger source'))
  )
    return null;
  return [
    file.sheets.findIndex((sheet) => sheet.name === 'Supplier source'),
    file.sheets.findIndex((sheet) => sheet.name === 'Ledger source'),
  ];
}

function hasTable(mapping: Mapping, sheet: SheetData): boolean {
  return (
    mapping.date >= 0 &&
    (mapping.mode === 'signed'
      ? mapping.amount >= 0
      : mapping.debit >= 0 && mapping.credit >= 0) &&
    sheet.rows
      .slice(mapping.header + 1)
      .some((row) => row.some((cell) => cell.trim()))
  );
}

export function selectImportMapping(
  file: SourceFile,
  side: 'supplier' | 'ledger',
): ImportSelection {
  const sources = workpaperSources(file);
  if (sources) {
    const sheet = sources[side === 'supplier' ? 0 : 1];
    return {
      mapping: inferMapping(file, sheet),
      kind: 'workpaper',
      notice: `هذا ملف عمل مُصدَّر من ميزان. اقترحنا ورقة ${file.sheets[sheet].name} التي تحتوي نسخة جدول المصدر. راجع الورقة والأعمدة واتجاه المبالغ؛ لم تُستعد قرارات المطابقة أو الأرصدة أو تأكيدات النطاق السابقة.`,
    };
  }
  const candidates = file.sheets.flatMap((sheet, index) => {
    const mapping = inferMapping(file, index);
    return hasTable(mapping, sheet) ? [mapping] : [];
  });
  if (candidates.length === 1) {
    const mapping = candidates[0];
    return {
      mapping,
      kind: 'unique-table',
      notice: `تم تحميل الملف واقتراح ورقة ${file.sheets[mapping.sheet].name} بحسب عناوين الجدول. راجع الأعمدة والنطاق قبل المطابقة.`,
    };
  }
  if (file.sheets.length === 1) {
    return {
      mapping: inferMapping(file, 0),
      kind: 'single-sheet',
      notice:
        'تم تحميل الملف. حدد صف العناوين ومعنى الأعمدة وراجع البيانات قبل المطابقة.',
    };
  }
  return {
    mapping: { ...defaultMapping(), sheet: -1 },
    kind: 'choose-sheet',
    notice:
      candidates.length > 1
        ? 'تم تحميل الملف، وتوجد عدة أوراق تحتوي جداول محتملة. اختر ورقة المصدر المقصودة صراحة؛ لم يختَر المحرك بينها.'
        : 'تم تحميل الملف. اختر ورقة جدول المصدر ثم حدد صف العناوين ومعنى الأعمدة؛ لم نجد جدولًا واحدًا واضحًا لاقتراحه.',
  };
}

export function getMappedImportIssues(
  file: SourceFile,
  mapping: Mapping,
): { row: number; column?: number; messages: string[] }[] {
  const sheet = file.sheets[mapping.sheet];
  if (!sheet) return [];
  const columns = new Set(
    [
      mapping.date,
      mapping.reference,
      mapping.description,
      mapping.currencyColumn,
      ...(mapping.mode === 'signed'
        ? [mapping.amount]
        : [mapping.debit, mapping.credit]),
    ]
      .filter((column) => column >= 0)
      .map((column) => column + 1),
  );
  const dataRow = (row: number) =>
    Number.isInteger(row) &&
    row > mapping.header + 1 &&
    row <= sheet.rows.length &&
    !mapping.excluded[String(row)]?.trim();
  const issues: { row: number; column?: number; messages: string[] }[] = [
    ...Object.entries(sheet.rowIssues ?? {}).flatMap(([key, messages]) => {
      const row = Number(key);
      return dataRow(row) ? [{ row, messages }] : [];
    }),
    ...Object.entries(sheet.cellIssues ?? {}).flatMap(([key, messages]) => {
      const [row, column] = key.split(':').map(Number);
      return dataRow(row) && columns.has(column)
        ? [{ row, column, messages }]
        : [];
    }),
    ...Object.entries(sheet.referenceIssues ?? {}).flatMap(
      ([key, messages]) => {
        const [row, column] = key.split(':').map(Number);
        return dataRow(row) &&
          mapping.reference >= 0 &&
          column === mapping.reference + 1
          ? [{ row, column, messages }]
          : [];
      },
    ),
  ];
  return issues.sort(
    (a, b) => a.row - b.row || (a.column ?? 0) - (b.column ?? 0),
  );
}
