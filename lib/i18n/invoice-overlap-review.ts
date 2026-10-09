const copy = {
  ar: {
    wholeComponentUndo: 'فتح مراجعة التراجع عن المكوّن كاملًا',
    open: 'فتح مراجعة تداخل مجموعات الفواتير',
    close: 'إغلاق مراجعة تداخل مجموعات الفواتير',
    title: 'مراجعة مكونات تداخل الفواتير',
    intro:
      'ورقة مراجعة مستقلة للمجموعات المقبولة وباقي الحركات. ابحث في الورقتين المحددتين وراجع كل المرشحات والصفوف المتبقية قبل تسجيل قرار كامل للمكوّن. تظل مقارنة التطبيق الحالية مستقلة عن هذه الورقة؛ ظهور المرشح لا يعتمد مطابقة.',
    scope: 'نطاق المراجعة',
    selectedSheet: 'الورقة المحددة',
    outsideSheets: 'أوراق أخرى خارج البحث',
    technical: 'التفاصيل الفنية',
    supplier: 'المورد',
    ledger: 'دفتر الأستاذ',
    entity: 'الجهة',
    account: 'الحساب',
    currency: 'العملة',
    scopeCurrency: 'راجع العملة ودقتها في إعدادات المصادر الرئيسية قبل هذه المراجعة.',
    cutoff: 'تاريخ القطع',
    scopeAck:
      'راجعت نطاق المصادر المعروض وجميع صفوف الورقتين المحددتين. هذا الإقرار يخص مراجعة التداخل الحالية فقط.',
    inspect: 'البحث عن التداخل',
    searching: 'إعادة قراءة المصادر والبحث المحدود…',
    cancel: 'إلغاء البحث',
    missing: 'ارفع المصدرين وحدد إعدادات القراءة أولاً.',
    incomplete: 'البحث غير مكتمل؛ لا يمكن اعتماد قرارات مالية منه.',
    empty: 'لا توجد مكونات تداخل ضمن البحث الحالي. هذا لا يثبت المطابقة.',
    reviewer: 'اسم المراجع',
    rationale: 'سبب القرار المستند إلى دليل المصدر',
    component: 'مكوّن التداخل',
    candidates: 'كل المرشحات المتنافسة',
    candidate: 'مرشح',
    accept: 'قبول المجموعة',
    reject: 'رفض المجموعة',
    undecided: 'اختر قراراً صريحاً',
    decisionReason: 'سبب قرار هذا المرشح',
    rows: 'كل صفوف المكوّن',
    inventory: 'حصر كل صفوف الورقتين المحددتين',
    diagnostics: 'مرشحات تشخيصية من بحث غير مكتمل',
    originalRow: 'خلايا الصف الأصلية',
    disposition: 'حالة الصف',
    row: 'الصف',
    sheet: 'الورقة',
    date: 'التاريخ',
    amount: 'المبلغ الدقيق',
    role: 'دور المرجع',
    hash: 'بصمة المصدر',
    identity: 'الهوية',
    residual: 'الصفوف والمبالغ المتبقية',
    unknown: 'غير معلوم',
    total: 'إجمالي المجموعة',
    selected: 'المرجع المختار',
    reasons: 'أسباب المراجعة',
    rowsAck:
      'راجعت كل صفوف هذا المكوّن وكل المرشحات المنافسة والمبالغ المتبقية المعروضة.',
    decisionAck:
      'أصرّح بتسجيل قرارات المجموعات المراجعة لهذا المكوّن كوحدة واحدة. هذه القرارات لا توزّع المبالغ بين صفوف فردية.',
    commit: 'تسجيل قرارات المكوّن كاملة',
    undo: 'التراجع عن قرار المكوّن',
    undoReason: 'سبب التراجع عن المكوّن كله',
    undoAck:
      'أصرّح بإلغاء قرارات هذا المكوّن كلها وإعادة صفوفه إلى الحالة غير المطابقة.',
    receipts: 'سجل القرارات',
    receipt: 'قرار مسجل',
    exportWorkbook: 'تنزيل سجل المراجعة Excel',
    exportSession: 'تنزيل جلسة المراجعة',
    importSession: 'فحص سجل مراجعة محفوظ للأرشفة',
    archived: 'سجل مستورد للأرشفة فقط',
    archiveNote:
      'الملف المحفوظ لا يستعيد قبولاً مالياً. يلزم قرار بشري جديد على المرشحات والصفوف الحالية.',
    accepted: 'مجموعة مقبولة',
    rejected: 'مجموعة مرفوضة',
    unmatched: 'باقٍ دون مطابقة',
    busy: 'جارٍ التحقق من القرار…',
    error: 'تعذر إثبات الإجراء',
    previous: 'الصفوف السابقة',
    next: 'الصفوف التالية',
    of: 'من',
    limits: 'حدود البحث',
  },
  en: {
    wholeComponentUndo: 'Review undo of the complete component',
    open: 'Open invoice overlap review',
    close: 'Close invoice overlap review',
    title: 'Invoice overlap component review',
    intro:
      'An independent review workpaper for accepted groups and remaining movements. Search the two selected sheets and review every candidate and residual row before recording a complete component decision. The current app comparison remains separate from this workpaper; a candidate does not approve a match.',
    scope: 'Review scope',
    selectedSheet: 'Selected sheet',
    outsideSheets: 'Other sheets outside this search',
    technical: 'Technical details',
    supplier: 'Supplier',
    ledger: 'Ledger',
    entity: 'Entity',
    account: 'Account',
    currency: 'Currency',
    scopeCurrency: 'Review the currency and its precision in the main source settings before this review.',
    cutoff: 'Cut-off date',
    scopeAck:
      'I reviewed the displayed source scope and all rows in the two selected sheets. This declaration applies to this overlap review only.',
    inspect: 'Search invoice overlaps',
    searching: 'Rereading sources and running the bounded search…',
    cancel: 'Cancel search',
    missing: 'Upload both sources and set their readings first.',
    incomplete:
      'The search is incomplete; it cannot support financial decisions.',
    empty:
      'No overlap components in this search. This does not establish a match.',
    reviewer: 'Reviewer name',
    rationale: 'Decision rationale grounded in source evidence',
    component: 'Overlap component',
    candidates: 'All competing candidates',
    candidate: 'Candidate',
    accept: 'Accept group',
    reject: 'Reject group',
    undecided: 'Choose an explicit decision',
    decisionReason: 'Rationale for this candidate decision',
    rows: 'All component rows',
    inventory: 'All physical rows in the two selected sheets',
    diagnostics: 'Diagnostic candidates from an incomplete search',
    originalRow: 'Original row cells',
    disposition: 'Row disposition',
    row: 'Row',
    sheet: 'Sheet',
    date: 'Date',
    amount: 'Exact amount',
    role: 'Reference role',
    hash: 'Source hash',
    identity: 'Identity',
    residual: 'Residual rows and amounts',
    unknown: 'Unknown',
    total: 'Group total',
    selected: 'Selected reference',
    reasons: 'Review reasons',
    rowsAck:
      'I reviewed every row in this component, all competing candidates, and the displayed residual amounts.',
    decisionAck:
      'I authorize recording these reviewed group decisions together for the whole component. These decisions do not allocate amounts between individual rows.',
    commit: 'Record complete component decisions',
    undo: 'Undo component decision',
    undoReason: 'Rationale for undoing the entire component',
    undoAck:
      'I authorize undoing this whole component decision and returning its rows to unmatched status.',
    receipts: 'Decision journal',
    receipt: 'Recorded decision',
    exportWorkbook: 'Download review workbook',
    exportSession: 'Download review session',
    importSession: 'Inspect a saved journal for archiving',
    archived: 'Imported archive only',
    archiveNote:
      'A saved file does not restore financial acceptance. Fresh human decisions on current candidates and rows are required.',
    accepted: 'Accepted group',
    rejected: 'Rejected group',
    unmatched: 'Unmatched residual',
    busy: 'Revalidating the decision…',
    error: 'Action could not be proven',
    previous: 'Previous rows',
    next: 'Next rows',
    of: 'of',
    limits: 'Search limits',
  },
};
export const invoiceOverlapReviewCopy = (lang: 'ar' | 'en') => copy[lang];
const integratedCopy = {
  ar: {
    intro: 'تدخل المجموعات التي تعتمدها صراحةً هنا في المقارنة الرئيسية وتملك صفوفها كاملةً. راجع كل المنافسين والباقي قبل قرار المكوّن؛ تساوي المجموع لا يوزّع مبالغ بين الأعضاء ولا يخصص دفعات. العملة ودقتها من إعدادات المصادر الرئيسية.',
    scopeAck: 'راجعت نطاق المقارنة المعروض وكل صفوف الورقتين المحددتين. تأكيد النطاق وحده لا يعتمد مطابقة أو تخصيصًا ماليًا.',
    undoAck: 'أصرّح بإلغاء قرار المكوّن كاملًا وإعادة حساب المقارنة من جميع صفوف المصدر الأصلية.',
    exportWorkbook: 'تنزيل ورقة المقارنة وسجل المجموعات Excel',
  },
  en: {
    intro: 'Groups explicitly approved here become part of the main comparison and own their complete source rows. Review every competitor and residual before a component decision; equal totals do not distribute amounts between members or allocate payments. Currency and precision come from the main source settings.',
    scopeAck: 'I reviewed the displayed comparison scope and all rows in the two selected sheets. Confirming scope alone approves no match or financial allocation.',
    undoAck: 'I authorize undoing the entire component decision and recomputing the comparison from every original source row.',
    exportWorkbook: 'Download the comparison and group journal workbook',
  },
};
export const invoiceOverlapIntegratedCopy = (lang: 'ar' | 'en') => ({ ...copy[lang], ...integratedCopy[lang] });

const reasons: Record<string, [string, string]> = {
  'scope-unverified': ['النطاق غير مؤكد', 'Scope unverified'],
  'physical-membership-incomplete': [
    'حصر الصفوف غير مكتمل',
    'Physical row inventory incomplete',
  ],
  'unknown-membership': ['عضوية صف غير معلومة', 'Unknown row membership'],
  'identity-competition': ['هوية منافسة', 'Competing identity'],
  'invalid-invoice-member': ['عضو فاتورة غير صالح', 'Invalid invoice member'],
  'date-outside-scope': ['التاريخ خارج النطاق', 'Date outside scope'],
  'same-source': ['المصدر نفسه على الجانبين', 'Same source on both sides'],
  'resource-limit': [
    'حد البحث يمنع إثبات الاكتمال',
    'Search limit prevents complete evidence',
  ],
  'invalid-revision': [
    'إصدار الاستخراج غير صالح',
    'Invalid extraction revision',
  ],
  'overlapping-candidates': [
    'مرشحات تشترك في الصفوف؛ يلزم قرار كامل',
    'Candidates share rows; complete review is required',
  ],
  'unread-competitor': ['صف منافس لم يثبت قراءته', 'Unread competing row'],
  cancelled: [
    'أُلغي البحث؛ لا يمنح اعتماداً',
    'Search cancelled; no acceptance authority',
  ],
  'duplicate-invoice-members': [
    'هوية عضو الفاتورة مكررة',
    'Duplicate invoice member identity',
  ],
};
export const invoiceOverlapReason = (code: string, lang: 'ar' | 'en') =>
  reasons[code]?.[lang === 'ar' ? 0 : 1] ?? code;

export const invoiceOverlapDisposition = (value: string, lang: 'ar' | 'en') =>
  (
    ({
      movement: ['حركة', 'Movement'],
      'non-movement': ['صف غير حركي', 'Non-movement'],
      excluded: ['مستبعد من القراءة', 'Excluded'],
      error: ['خطأ في القراءة', 'Reading error'],
      unknown: ['حالة غير معلومة', 'Unknown'],
    }) as Record<string, string[]>
  )[value]?.[lang === 'ar' ? 0 : 1] ?? value;

export function invoiceOverlapReviewError(message: string, lang: 'ar' | 'en') {
  if (lang === 'en' || /[\u0600-\u06ff]/.test(message)) return message;
  if (/cancel|invalidated/i.test(message))
    return 'أُبطل العمل الجاري؛ أعد الفحص على المصدر والإعدادات الحالية.';
  if (/disjoint|reused row|overlap/i.test(message))
    return 'تشترك المجموعات المقبولة في صفوف؛ اختر مجموعات مستقلة وراجع كل المنافسين قبل التسجيل.';
  if (/stale|changed|snapshot|revision/i.test(message))
    return 'تغير المصدر أو القراءة أو إصدارها؛ أعد الفحص والمراجعة.';
  if (/Every candidate|Every component|explicit grounded/i.test(message))
    return 'يلزم قرار وسبب صريح لكل مرشح ومراجعة كل صفوف المكوّن والبواقي.';
  if (/Reviewer|rationale/i.test(message))
    return 'يلزم اسم المراجع وسبب القرار المستند إلى دليل المصدر.';
  if (/session|archive|altered/i.test(message))
    return 'تعذر إثبات السجل المحفوظ؛ لا يمنح هذا الملف قبولاً مالياً.';
  if (/membership|incomplete|component/i.test(message))
    return 'تعذر إثبات عضوية كل الصفوف واكتمال المكوّن؛ لا يمكن تجاوز هذا الحد بقرار مراجعة.';
  return 'تعذر إثبات الإجراء من الملفات الأصلية وإعدادات القراءة الحالية. راجع التفاصيل والدليل قبل إعادة المحاولة.';
}
