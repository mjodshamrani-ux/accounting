import { ENGINE_VERSION } from './types.ts';
import { assertSourceFile } from './protocol.ts';
import type { Mapping, SheetData, SourceFile } from './types.ts';

export const IMPORT_PROPOSAL_FIELDS = [
  'date',
  'reference',
  'description',
  'amount',
  'debit',
  'credit',
  'currencyColumn',
] as const;
export type ImportProposalField = (typeof IMPORT_PROPOSAL_FIELDS)[number];
export type ImportProposalPatch = Partial<Pick<Mapping, ImportProposalField>>;
export type ImportCellEvidence = {
  row: number;
  column: number;
  text: string;
  truncated: boolean;
  page?: number;
};
export type ImportIssueEvidence = {
  row: number;
  column?: number;
  messages: string[];
};
export type ImportColumnEvidence = {
  index: number;
  header: ImportCellEvidence;
  samples: ImportCellEvidence[];
  issues: ImportIssueEvidence[];
  issueCount: number;
};
export type ImportProposalContext = {
  sourceHash: string;
  sheet: number;
  header: number;
  baseline: string;
  unresolvedFields: ImportProposalField[];
  columns: ImportColumnEvidence[];
};
export type ImportProposal = {
  sourceHash: string;
  sheet: number;
  header: number;
  baseline: string;
  columns: ImportProposalPatch;
};
export type ImportProposalValidation =
  | {
      ok: true;
      status: 'needs-review';
      proposal: ImportProposal;
      patch: ImportProposalPatch;
      evidence: (ImportColumnEvidence & { field: ImportProposalField })[];
      warnings: string[];
    }
  | { ok: false; code: string; message: string };

// This is a local revision token, not a second content hash or approval. The
// reader's SHA binds the original bytes; PDF cuts bind their current extraction.
// Sorting object keys makes equivalent mapping objects produce the same token.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return (
        typeof key === 'string' &&
        descriptor.enumerable &&
        'value' in descriptor
      );
    })
  );
}

const cellMessages = (
  sheet: SheetData,
  row: number,
  column: number,
  formulaRows: ReadonlySet<number>,
) => [
  ...(sheet.cellIssues?.[`${row}:${column}`] ?? []),
  ...(sheet.referenceIssues?.[`${row}:${column}`] ?? []),
  ...(!sheet.cellIssues && formulaRows.has(row)
    ? ['الصف يحتوي معادلة. يلزم إجراء فحص القراءة الأصلي.']
    : []),
];

function cellEvidence(
  sheet: SheetData,
  row: number,
  column: number,
): ImportCellEvidence {
  const original = sheet.rows[row - 1]?.[column - 1] ?? '';
  return {
    row,
    column,
    text: original.slice(0, 240),
    truncated: original.length > 240,
    ...(sheet.rowPages?.[String(row)]
      ? { page: sheet.rowPages[String(row)] }
      : {}),
  };
}

function columnEvidence(
  sheet: SheetData,
  mapping: Mapping,
  index: number,
  hiddenRows: ReadonlySet<number>,
  formulaRows: ReadonlySet<number>,
): ImportColumnEvidence {
  const samples: ImportCellEvidence[] = [];
  const issues: ImportIssueEvidence[] = [];
  let issueCount = 0;
  for (let i = mapping.header; i < sheet.rows.length; i++) {
    const row = i + 1;
    if (i > mapping.header && mapping.excluded[String(row)]?.trim()) continue;
    const messages = [
      ...(sheet.rowIssues?.[String(row)] ?? []),
      ...cellMessages(sheet, row, index + 1, formulaRows),
      ...(hiddenRows.has(row) ? ['صف مخفي في المصدر.'] : []),
    ];
    if (messages.length) {
      issueCount++;
      if (issues.length < 3)
        issues.push({
          row,
          column: index + 1,
          messages: messages.map((message) => message.slice(0, 240)),
        });
    }
    if (
      i > mapping.header &&
      samples.length < 3 &&
      sheet.rows[i][index]?.trim()
    )
      samples.push(cellEvidence(sheet, row, index + 1));
  }
  return {
    index,
    header: cellEvidence(sheet, mapping.header + 1, index + 1),
    samples,
    issues,
    issueCount,
  };
}

/** Prepare untrusted source excerpts for an on-device model. No data is sent or
 * changed here. Samples explain a proposal; they never validate a whole column.
 */
export function buildImportProposalContext(
  file: SourceFile,
  mapping: Mapping,
): ImportProposalContext | null {
  try {
    assertSourceFile(file);
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) return null;
    const sheet = file.sheets[mapping.sheet];
    if (
      !Number.isInteger(mapping.sheet) ||
      !sheet ||
      !Number.isInteger(mapping.header) ||
      mapping.header < 0 ||
      mapping.header >= sheet.rows.length ||
      !record(mapping.excluded)
    )
      return null;
    const header = sheet.rows[mapping.header];
    const hiddenRows = new Set(sheet.hiddenRows);
    const formulaRows = new Set(sheet.formulaRows);
    if (
      !header.length ||
      IMPORT_PROPOSAL_FIELDS.some(
        (field) =>
          !Number.isInteger(mapping[field]) ||
          mapping[field] < -1 ||
          mapping[field] >= header.length,
      ) ||
      hiddenRows.has(mapping.header + 1) ||
      sheet.rowIssues?.[String(mapping.header + 1)]?.length ||
      (!sheet.cellIssues && formulaRows.has(mapping.header + 1))
    )
      return null;
    const unresolvedFields = IMPORT_PROPOSAL_FIELDS.filter(
      (field) => mapping[field] === -1,
    );
    if (!unresolvedFields.length) return null;
    return {
      sourceHash: file.sha256!,
      sheet: mapping.sheet,
      header: mapping.header,
      baseline: canonical({
        engine: ENGINE_VERSION,
        mapping,
        sourceHash: file.sha256,
        sheetName: sheet.name,
        header,
        rowCount: sheet.rows.length,
        pdf: file.pdf ?? null,
      }),
      unresolvedFields,
      columns: header.map((_, index) =>
        columnEvidence(sheet, mapping, index, hiddenRows, formulaRows),
      ),
    };
  } catch {
    return null;
  }
}

/** Checks only the authority, source binding and structural safety of a column
 * suggestion. It deliberately does not certify semantics, arithmetic or a match.
 * Apply through the normal mapping workflow, then run all existing engine checks.
 */
export function verifyImportProposal(
  file: SourceFile,
  mapping: Mapping,
  input: unknown,
): ImportProposalValidation {
  const fail = (code: string, message: string): ImportProposalValidation => ({
    ok: false,
    code,
    message,
  });
  const context = buildImportProposalContext(file, mapping);
  if (!context)
    return fail(
      'unavailable-context',
      'لا يتوفر مصدر وصف عناوين يمكن التحقق منهما لاقتراح الأعمدة. راجع إعدادات الملف.',
    );
  if (
    !record(input) ||
    Object.keys(input).length !== 5 ||
    Object.keys(input).some(
      (key) =>
        !['sourceHash', 'sheet', 'header', 'baseline', 'columns'].includes(key),
    ) ||
    !record(input.columns)
  )
    return fail(
      'invalid-schema',
      'الاقتراح لا يطابق بنية تعيين الأعمدة المسموح بها.',
    );
  if (
    input.sourceHash !== context.sourceHash ||
    input.sheet !== context.sheet ||
    input.header !== context.header ||
    input.baseline !== context.baseline
  )
    return fail(
      'stale-context',
      'تغيّر المصدر أو تغيّرت إعدادات قراءته. اطلب اقتراحًا جديدًا.',
    );
  const keys = Object.keys(input.columns);
  if (
    !keys.length ||
    keys.some(
      (key) => !IMPORT_PROPOSAL_FIELDS.includes(key as ImportProposalField),
    )
  )
    return fail(
      'invalid-columns',
      'لا يسمح الاقتراح إلا بأعمدة غير محددة من القائمة المعتمدة.',
    );
  const sheet = file.sheets[mapping.sheet];
  const formulaRows = new Set(sheet.formulaRows);
  const patch: ImportProposalPatch = {};
  for (const field of keys as ImportProposalField[]) {
    const column = input.columns[field];
    if (mapping[field] !== -1)
      return fail('known-column', 'لا يمكن للاقتراح استبدال عمود محدد سابقًا.');
    if (
      typeof column !== 'number' ||
      !Number.isInteger(column) ||
      column < 0 ||
      column >= context.columns.length
    )
      return fail('invalid-column-index', 'الاقتراح يشير إلى عمود غير موجود.');
    if (cellMessages(sheet, mapping.header + 1, column + 1, formulaRows).length)
      return fail(
        'unsafe-header',
        'توجد مشكلة في قراءة عنوان العمود المقترح، لذلك لا يمكن الاعتماد عليه دليلًا.',
      );
    patch[field] = column;
  }
  // Match the engine invariant, including description; an unused mode's columns
  // also cannot be silently repurposed by a model.
  const columns = IMPORT_PROPOSAL_FIELDS.map(
    (field) => patch[field] ?? mapping[field],
  ).filter((column) => column >= 0);
  if (new Set(columns).size !== columns.length)
    return fail('duplicate-columns', 'لا يمكن تعيين العمود نفسه لأكثر من حقل.');
  if (
    sheet.hiddenRows.some(
      (row) =>
        row > mapping.header + 1 &&
        row <= sheet.rows.length &&
        !mapping.excluded[String(row)]?.trim() &&
        (sheet.rows[row - 1].some((value) => value.trim()) ||
          sheet.rowIssues?.[String(row)]?.length),
    )
  )
    return fail(
      'hidden-source-rows',
      'توجد صفوف بيانات مخفية. راجع تعيين الأعمدة يدويًا مع المصدر.',
    );
  const evidence = (keys as ImportProposalField[]).map((field) => ({
    field,
    ...context.columns[patch[field]!],
  }));
  return {
    ok: true,
    status: 'needs-review',
    proposal: {
      sourceHash: context.sourceHash,
      sheet: context.sheet,
      header: context.header,
      baseline: context.baseline,
      columns: { ...patch },
    },
    patch,
    evidence,
    warnings: [
      'اقتراح الأعمدة يحتاج إلى مراجعتك. قابلية قراءة الأرقام لا تثبت أن العمود يمثل مبلغًا محاسبيًا أو أن تفسير معناه صحيح.',
      'هذا الفحص لا يعتمد قراءة الحركات أو إشارات المبالغ أو الأرصدة أو المطابقات. بعد تطبيق الاقتراح، تبقى فحوص المحرك ومراجعة PDF مطلوبة.',
      ...(evidence.some((item) => item.issueCount > 0)
        ? [
            'توجد ملاحظات قراءة في الأعمدة المقترحة. لم تُحذف هذه الملاحظات ولم يتجاوزها الاقتراح.',
          ]
        : []),
    ],
  };
}
