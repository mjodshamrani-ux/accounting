import type { Mapping, Scope, SourceFile, SourceResult } from './types.ts';

const key = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();
const genericAccount =
  /^(?:account|account no\.?|account number|الحساب|رقم الحساب)$/i;
const agingTitle =
  /(?:^|\s[-–—|:]\s)(?:(?:accounts? payable|supplier|vendor|aged payable)\s+)?ag(?:e?ing|ed)(?:\s+(?:report|analysis|summary|payables?|balances?))?(?:\s+report)?$|^(?:تقرير\s+)?(?:أعمار|اعمار)\s+(?:الديون|الذمم|الموردين)(?:\s+الدائنة)?$/i;

/** A declared report kind is source evidence, never overridden by a UI default. */
export function enforceDeclaredReport(
  file: SourceFile,
  mapping: Mapping,
  result: SourceResult,
) {
  const sheet = file.sheets[mapping.sheet];
  const title = sheet.rows
    .slice(0, mapping.header)
    .find((row) =>
      agingTitle.test(
        [...new Set(row.map((v) => v.trim()).filter(Boolean))].join(' '),
      ),
    );
  if (title)
    result.errors.push({
      row: 0,
      message:
        'هذا تقرير أعمار ديون وليس كشف حركات أو بنود مفتوحة قابلًا للمقارنة بهذه الإعدادات. استخدم كشف الحركات أو تقرير البنود المفتوحة التفصيلي.',
    });
}

/** Generic Account labels have no role. Record them without equating customer IDs and vendor IDs. */
export function collectGenericAccounts(
  file: SourceFile,
  mapping: Mapping,
  scope: Scope,
  result: SourceResult,
) {
  const sheet = file.sheets[mapping.sheet];
  const columns = sheet.rows[mapping.header].flatMap((label, i) =>
    genericAccount.test(label.trim()) ? [i] : [],
  );
  const observations: { value: string; row: number; column?: number }[] = [];
  for (const tx of result.transactions)
    for (const column of columns) {
      observations.push({
        value: sheet.rows[tx.row - 1][column]?.trim() ?? '',
        row: tx.row,
        column: column + 1,
      });
    }
  // A prefix is required: descriptions containing the word Account do not qualify.
  for (let i = 0; i < mapping.header; i++) {
    const line = [
      ...new Set(sheet.rows[i].map((v) => v.trim()).filter(Boolean)),
    ].join(' ');
    // Only a metadata line beginning with a known field qualifies. PDF extraction
    // may split that line at transaction-column boundaries.
    if (
      !/^(?:account(?: no\.?| number)?|currency|entity|legal entity|الحساب|رقم الحساب|العملة|الكيان)\s*[:：]/i.test(
        line,
      )
    )
      continue;
    const match =
      /(?:^|\s)(?:account(?: no\.?| number)?|الحساب|رقم الحساب)\s*[:：]\s*(.+?)(?=\s+(?:currency|entity|legal entity|العملة|الكيان)\s*[:：]|$)/i.exec(
        line,
      );
    if (match) observations.push({ value: match[1].trim(), row: i + 1 });
  }
  if (!observations.length) return;
  const values = new Set(observations.map((o) => key(o.value)));
  const unsafe = observations.some(
    (o) =>
      !o.value ||
      (o.column &&
        (sheet.cellIssues?.[`${o.row}:${o.column}`]?.length ||
          sheet.referenceIssues?.[`${o.row}:${o.column}`]?.length)),
  );
  if (
    unsafe ||
    values.size !== 1 ||
    (scope.account && !values.has(key(scope.account)))
  ) {
    result.errors.push({
      row: 0,
      message:
        'رقم الحساب في المصدر يحتاج توضيحًا: يوجد تعارض أو أكثر من حساب، أو أنه يختلف عن الحساب المؤكد. لا نفترض أن حساب العميل لدى المورد هو رمز المورد في دفاترك.',
    });
  }
  for (const o of observations)
    result.metadata?.evidence.push({
      field: 'genericAccount',
      value: o.value,
      originalValue: o.value,
      sheet: sheet.name,
      row: o.row,
      column: o.column,
      method: 'literal',
    });
}

export function assertGenericAccountsCompatible(
  a: SourceResult,
  b: SourceResult,
) {
  const values = (s: SourceResult) =>
    new Set(
      s.metadata?.evidence
        .filter((e) => e.field === 'genericAccount')
        .map((e) => key(String(e.value))),
    );
  const left = values(a),
    right = values(b);
  if (left.size === 1 && right.size === 1 && [...left][0] !== [...right][0]) {
    throw new Error(
      'رقما الحساب في الملفين مختلفان ودورهما غير محدد. وضّح نطاق الحساب قبل المطابقة؛ فقد يكون أحدهما حساب العميل والآخر رمز المورد.',
    );
  }
}
