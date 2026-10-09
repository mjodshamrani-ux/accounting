export type EvidenceQuestion = 'status' | 'amounts' | 'sources' | 'next';
const questions: Record<EvidenceQuestion, [string, string]> = {
  status: ['ما حالة النتيجة؟', 'What is the result status?'],
  amounts: ['ما الأرقام المثبتة؟', 'What are the recorded amounts?'],
  sources: ['ما مصادر النتيجة؟', 'What are the result sources?'],
  next: ['ما الخطوة التالية؟', 'What is the next step?'],
};
export function evidenceQuestionKind(question: string) {
  const text = question.trim().toLowerCase();
  for (const [key, wording] of Object.entries(questions))
    if (wording.some((v) => v.toLowerCase() === text))
      return key as EvidenceQuestion;
  if (['لماذا يوجد فرق؟', 'why is there a difference?'].includes(text))
    return 'amounts';
  return 'unsupported';
}
export const evidenceLabels = {
  status: ['حالة الحساب', 'Calculation status'],
  financial: ['الحالة المالية المحسوبة', 'Calculated financial state'],
  review: ['قرار المراجعة المسجل', 'Recorded review decision'],
  members: ['أعضاء النطاق الفيزيائي', 'Physical scope members'],
  register: ['السجل المرحل', 'Posted register'],
  carrying: ['القيمة الدفترية', 'Carrying amount'],
  cost: ['التكلفة', 'Cost'],
  depreciation: ['الاستهلاك المتراكم', 'Accumulated depreciation'],
  impairment: ['الانخفاض في القيمة', 'Impairment'],
  grossPay: ['إجمالي الأجور', 'Gross pay'],
  deductions: ['استقطاعات الموظفين', 'Employee deductions'],
  employer: ['مساهمة صاحب العمل', 'Employer contribution'],
  'gross-expense': ['مصروف إجمالي الأجور', 'Gross pay expense'],
  'employee-deduction-payable': [
    'التزام استقطاعات الموظفين',
    'Employee deduction payable',
  ],
  'net-payable': ['التزام صافي الرواتب', 'Net payroll payable'],
  'employer-expense': [
    'مصروف مساهمة صاحب العمل',
    'Employer contribution expense',
  ],
  'employer-payable': [
    'التزام مساهمة صاحب العمل',
    'Employer contribution payable',
  ],
  'net-clearing': ['تسوية صافي الرواتب', 'Net payroll clearing'],
  'bank-cash': ['النقدية البنكية للصرف', 'Bank payout cash'],
  errors: ['أسطر المصدر المعيبة', 'Source error rows'],
  diagnostics: ['تشخيصات المصدر', 'Source diagnostics'],
  missing: ['عناصر ناقصة', 'Missing items'],
  pending: ['عناصر لم تعتمد', 'Items without approval'],
  matched: ['علاقات مثبتة', 'Evidenced relationships'],
  rows: ['أسطر المصدر', 'Source rows'],
  active: ['قرارات تخصيص نشطة', 'Active allocation decisions'],
  completeness: [
    'تصريح جرد مقدم ومؤكد',
    'Supplied inventory attestation confirmed',
  ],
  total: ['إجمالي', 'Total'],
  debit: ['مدين', 'Debit'],
  credit: ['دائن', 'Credit'],
  net: ['صافي', 'Net'],
  gross: ['إجمالي المبيعات', 'Gross sales'],
  refunds: ['المردودات', 'Refunds'],
  fees: ['الخصومات المثبتة', 'Evidenced deductions'],
  grossDifference: ['فرق إجمالي المبيعات', 'Gross sales difference'],
  refundDifference: ['فرق المردودات', 'Refund difference'],
  feeDifference: ['فرق الخصومات', 'Deduction difference'],
  netDifference: ['فرق صافي التسوية', 'Settlement net difference'],
  bankDifference: ['فرق التسوية مع البنك', 'Settlement to bank difference'],
  openingDebit: ['افتتاح مدين', 'Opening debit'],
  openingCredit: ['افتتاح دائن', 'Opening credit'],
  periodDebit: ['حركة مدينة', 'Period debit'],
  periodCredit: ['حركة دائنة', 'Period credit'],
  closingDebit: ['ختام مدين', 'Closing debit'],
  closingCredit: ['ختام دائن', 'Closing credit'],
  assets: ['أصول', 'Assets'],
  liabilities: ['التزامات', 'Liabilities'],
  equity: ['حقوق ملكية', 'Equity'],
  equation: [
    'فرق معادلة المركز المالي',
    'Financial position equation difference',
  ],
  rawBank: ['رصيد البنك الخام', 'Raw bank balance'],
  rawCash: ['رصيد النقدية الخام', 'Raw cashbook balance'],
  bankAdjustment: ['بنود تعديل البنك', 'Bank reconciliation items'],
  cashAdjustment: ['بنود تعديل النقدية', 'Cashbook reconciliation items'],
  adjustedBank: ['البنك بعد البنود المثبتة', 'Bank after evidenced items'],
  adjustedCash: [
    'النقدية بعد البنود المثبتة',
    'Cashbook after evidenced items',
  ],
  difference: ['فرق', 'Difference'],
  bank: ['البنك', 'Bank'],
  cash: ['النقدية', 'Cashbook'],
  left: ['المنشأة الأولى', 'First entity'],
  right: ['المنشأة الثانية', 'Second entity'],
  gl: ['الأستاذ العام', 'General ledger'],
  tb: ['ميزان المراجعة', 'Trial balance'],
  ledger: ['دفتر العملاء', 'Receivables ledger'],
  statement: ['كشف العميل', 'Customer statement'],
  calculated: ['محسوب', 'Calculated'],
  reported: ['مقدم', 'Reported'],
  opening: ['افتتاح', 'Opening'],
  closing: ['ختام', 'Closing'],
} as const;
const statuses: Record<string, [string, string]> = {
  'source-error': ['خطأ في المصدر', 'Source error'],
  accepted: [
    'مقبول بقرار مراجعة مسجل',
    'Accepted by a recorded review decision',
  ],
  rejected: [
    'مرفوض بقرار مراجعة مسجل',
    'Rejected by a recorded review decision',
  ],
  missing: ['أدلة ناقصة', 'Missing evidence'],
  difference: ['فروق ظاهرة', 'Differences remain'],
  inconsistent: ['معادلات غير متسقة', 'Inconsistent equations'],
  'needs-review': ['تحتاج مراجعة', 'Needs review'],
  'consistent-with-evidence': [
    'متسق مع الأدلة المؤكدة المقدمة',
    'Consistent with supplied confirmed evidence',
  ],
  'reconciled-with-evidence': [
    'مسوى ضمن الأدلة المؤكدة المقدمة',
    'Reconciled within supplied confirmed evidence',
  ],
  'movements-consistent': [
    'الحركات متسقة ضمن الأدلة المقدمة',
    'Movements consistent within supplied evidence',
  ],
  consistent: [
    'اتساق حسابي في النطاق المحدد',
    'Arithmetic consistency within the stated scope',
  ],
  ready: [
    'الحساب جاهز ولا يمنح اعتمادًا',
    'Calculation ready; no approval conferred',
  ],
  empty: ['لا حركات مقروءة', 'No readable movements'],
};
export function domainEvidenceCopy(lang: 'ar' | 'en') {
  const i = lang === 'ar' ? 0 : 1;
  return {
    title: ['شرح أدلة النتيجة', 'Explain result evidence'][i],
    intro: [
      'شرح حتمي من الحساب الحالي. لا يفترض سببًا للفرق ولا يكتب قيدًا أو يمنح اعتمادًا.',
      'Deterministic explanation from the current calculation. It infers no cause of a difference, posts no entry and grants no approval.',
    ][i],
    verifiedLimit: [
      'أعيدت قراءة الأصول وبصماتها وقورن الحساب بالنتيجة المعروضة. الأرقام قيم مرحلة مقدمة؛ لا يقدر المساعد المخزون أو الأصول ولا يحسب رواتب جديدة ولا يمنح اعتمادًا أو رأيًا في اكتمال المصادر.',
      'Original sources and hashes were reread and the calculation matched the displayed result. Amounts are supplied posted values; the assistant performs no inventory or asset valuation, calculates no new payroll and grants no approval or source completeness opinion.',
    ][i],
    checking: ['جار التحقق من أدلة النتيجة', 'Checking result evidence'][i],
    context: ['سياق الحساب المثبت', 'Evidenced calculation context'][i],
    limit: [
      'الملخص لا يعيد التحقق من أصالة الأصول أو اكتمالها؛ التفاصيل الفيزيائية في جداول المجال.',
      'The summary does not reverify source authenticity or completeness; physical details are in the domain tables.',
    ][i],
    individual: [
      'هذا المجال لا يقدم إجمالي أموال موحدًا. راجع الأرقام لكل بند في جداول المجال؛ لا ينشئ المساعد مجموعًا جديدًا.',
      'This domain supplies no single monetary total. Review each item in the domain tables; the assistant creates no new aggregate.',
    ][i],
    unsupported: [
      'السؤال خارج صيغ الشرح المدعومة. اختر الحالة أو الأرقام أو المصادر أو الخطوة التالية.',
      'This wording is outside the supported explanation questions. Choose status, amounts, sources or next step.',
    ][i],
    stale: [
      'النتيجة لا تطابق الحساب الحالي. أعد الحساب قبل الشرح.',
      'The result differs from the current calculation. Recalculate before asking for an explanation.',
    ][i],
    next: [
      'راجع الأخطاء والناقص والفروق والعضوية في جداول المجال، ثم وثق الأدلة والقرار هناك. الجواب لا يعتمد أي بند ولا يثبت اكتمال الجرد.',
      'Review errors, missing evidence, differences and membership in the domain tables, then document evidence and decisions there. This answer approves no item and proves no inventory completeness.',
    ][i],
    null: ['غير محسوب', 'Not calculated'][i],
    yes: ['نعم', 'Yes'][i],
    no: ['لا', 'No'][i],
    question: ['سؤال عن النتيجة', 'Question about the result'][i],
    ask: ['اسأل', 'Ask'][i],
    file: ['الملف', 'File'][i],
    sheet: ['الورقة', 'Sheet'][i],
    hash: ['بصمة الأصل', 'Source hash'][i],
    labels: Object.fromEntries(
      Object.entries(evidenceLabels).map(([k, v]) => [k, v[i]]),
    ) as Record<keyof typeof evidenceLabels, string>,
    status: (s: string) =>
      statuses[s]?.[i] ?? ['حالة غير مدعومة', 'Unsupported status'][i],
    questions: Object.fromEntries(
      Object.entries(questions).map(([k, v]) => [k, v[i]]),
    ) as Record<EvidenceQuestion, string>,
  };
}
