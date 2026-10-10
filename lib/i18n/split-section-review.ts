const copy = {
  en: {
    open: 'Open separate debit / credit PDF section review',
    close: 'Close separate debit / credit PDF section review',
    title: 'PDF sections · separate debit and credit · SAR 2',
    intro:
      'Review the original five literal columns and every movement, including zero amounts. This creates a separate derivative and does not approve or attach it to financial reconciliation.',
    source: 'Choose original PDF',
    supplier: 'Supplier',
    ledger: 'Ledger',
    missing:
      'This family requires a native-text PDF, four explicit column cuts, and Date / Reference / Description / Debit / Credit. OCR, balances, six columns and other currencies are outside this family.',
    context:
      'Reading context: transactions · SAR · 2 decimals · debit minus credit · multiplier 1 · decimal dot · ISO date. Configure the original source mapping explicitly; this panel never changes it.',
    scope: 'The selected financial scope must specify SAR and 2 decimals.',
    inspect: 'Inspect original',
    clear: 'Clear review',
    abort: 'Cancel operation',
    busy: 'Revalidating original and evidence…',
    rows: 'Full original row inventory',
    movements: 'Select every movement (including explicit zero)',
    proposals: 'Reference origin proposals',
    all: 'Select all movements and proposals',
    partial:
      'A complete derivative requires every movement and every required proposal.',
    totals: 'Separate debit / credit total diagnostics',
    proof: 'Original cell evidence',
    reviewer: 'Named reviewer',
    rationale: 'Evidence-based rationale',
    originalRowsReviewed: 'I reviewed every original row against the PDF.',
    referenceRolesReviewed:
      'I reviewed each reference role, parent and page continuation evidence.',
    separateAmountsReviewed:
      'I reviewed both original debit and credit cells, including explicit zeros; blank is not zero.',
    perspectiveReviewed:
      'I explicitly confirm debit minus credit, with multiplier 1.',
    currencyReviewed:
      'I explicitly confirm SAR with 2 decimals and the original Currency: SAR evidence.',
    totalsReviewed:
      'I reviewed debit and credit totals separately, including carry diagnostics; carry is not counted twice.',
    derivedSourceUnderstood:
      'I understand this separate derivative has no financial approval or confirmed scope.',
    accept: 'Record reviewed acceptance',
    reject: 'Record rejection',
    receipt: 'Live decision bound to this review',
    apply: 'Apply live decision',
    artifact:
      'Separate derivative created. Financial approval: false. Scope confirmed: false.',
    csv: 'Download derived CSV',
    archive: 'Save evidence archive',
    workbook: 'Export evidence workbook',
    original: 'Download original PDF',
    restore: 'Restore historical evidence archive',
    historical:
      'Historical evidence only. Restore does not restore a live receipt or permission to apply.',
    error: 'Review could not be validated',
    technical: 'Technical details',
    previous: 'Previous rows',
    next: 'Next rows',
    debit: 'Debit',
    credit: 'Credit',
    net: 'Debit − Credit',
    expected: 'Expected',
    actual: 'Actual',
    minor: 'minor units',
    ready: 'Ready for structural review',
    blocked: 'Derivative blocked',
    row: 'Row',
    page: 'Page',
    column: 'Column',
    classification: 'Classification',
    selection: 'Selection hash',
    hash: 'Source hash',
    extractionHash: 'Extraction hash',
    contextHash: 'Reading context hash',
    sheet: 'Sheet',
    referenceOrigin: 'Reference origin',
    explicitReference: 'Explicit original reference cell',
    derivedReference: 'Reviewed section parent / continuation proposal',
  },
  ar: {
    open: 'فتح مراجعة أقسام PDF بمدين ودائن منفصلين',
    close: 'إغلاق مراجعة أقسام PDF بمدين ودائن منفصلين',
    title: 'أقسام PDF · مدين ودائن منفصلان · SAR بدقة 2',
    intro:
      'راجع الأعمدة الأصلية الخمسة حرفياً وكل حركة بما فيها الصفر. تنشئ هذه اللوحة قراءة مشتقة منفصلة دون اعتماد مالي أو إلحاق تلقائي بالتسوية.',
    source: 'اختر PDF الأصلي',
    supplier: 'المورد',
    ledger: 'دفتر الأستاذ',
    missing:
      'تحتاج هذه العائلة PDF نصياً أصلياً وأربعة حدود أعمدة صريحة: Date / Reference / Description / Debit / Credit. OCR والأرصدة والعمود السادس والعملات الأخرى خارج هذه العائلة.',
    context:
      'سياق القراءة: حركات · SAR · دقة 2 · المدين ناقص الدائن · معامل 1 · نقطة عشرية · تاريخ ISO. اضبط خريطة المصدر الأصلي صراحة؛ لا تغيرها هذه اللوحة.',
    scope: 'يجب أن يحدد النطاق المالي المختار SAR ودقة 2.',
    inspect: 'فحص الأصل',
    clear: 'مسح المراجعة',
    abort: 'إلغاء العملية',
    busy: 'إعادة إثبات الأصل والدليل…',
    rows: 'جرد جميع صفوف الأصل',
    movements: 'اختيار كل حركة بما فيها الصفر الصريح',
    proposals: 'اقتراحات أصل المرجع',
    all: 'اختيار كل الحركات والاقتراحات',
    partial: 'تتطلب القراءة المشتقة الكاملة كل حركة وكل اقتراح لازم.',
    totals: 'تشخيص المجاميع المنفصلة للمدين والدائن',
    proof: 'دليل الخلايا الأصلية',
    reviewer: 'اسم المراجع',
    rationale: 'سبب القرار المستند إلى الدليل',
    originalRowsReviewed: 'راجعت كل صف أصلي مقابل PDF.',
    referenceRolesReviewed: 'راجعت دور كل مرجع والأب ودليل استمرار الصفحة.',
    separateAmountsReviewed:
      'راجعت خليتي المدين والدائن الأصليتين بما فيهما الأصفار الصريحة؛ الفراغ ليس صفراً.',
    perspectiveReviewed: 'أؤكد صراحة منظور المدين ناقص الدائن ومعامل 1.',
    currencyReviewed: 'أؤكد صراحة SAR بدقة 2 ودليل Currency: SAR الأصلي.',
    totalsReviewed:
      'راجعت مجاميع المدين والدائن كلٌ منفصلاً وتشخيص الترحيل دون عده مرتين.',
    derivedSourceUnderstood:
      'أفهم أن هذه القراءة المشتقة المنفصلة لا تحمل اعتماداً مالياً أو نطاقاً مؤكداً.',
    accept: 'تسجيل قبول المراجعة',
    reject: 'تسجيل الرفض',
    receipt: 'قرار حي مرتبط بهذه المراجعة',
    apply: 'تطبيق القرار الحي',
    artifact: 'أُنشئت قراءة مشتقة منفصلة. الاعتماد المالي: لا. تأكيد النطاق: لا.',
    csv: 'تنزيل CSV المشتق',
    archive: 'حفظ أرشيف الدليل',
    workbook: 'تصدير مصنف الدليل',
    original: 'تنزيل PDF الأصلي',
    restore: 'استعادة أرشيف دليل تاريخي',
    historical: 'دليل تاريخي فقط. لا تستعيد الاستعادة إيصالاً حياً أو سلطة تطبيق.',
    error: 'تعذر إثبات المراجعة',
    technical: 'التفاصيل الفنية',
    previous: 'الصفوف السابقة',
    next: 'الصفوف التالية',
    debit: 'المدين',
    credit: 'الدائن',
    net: 'المدين ناقص الدائن',
    expected: 'المتوقع',
    actual: 'المقدم',
    minor: 'وحدات صغرى',
    ready: 'جاهز للمراجعة البنيوية',
    blocked: 'الاشتقاق محجوب',
    row: 'الصف',
    page: 'الصفحة',
    column: 'العمود',
    classification: 'التصنيف',
    selection: 'بصمة الاختيار',
    hash: 'بصمة المصدر',
    extractionHash: 'بصمة الاستخراج',
    contextHash: 'بصمة سياق القراءة',
    sheet: 'الورقة',
    referenceOrigin: 'أصل المرجع',
    explicitReference: 'خلية مرجع أصلية صريحة',
    derivedReference: 'اقتراح أب القسم ومتابعته المراجع',
  },
};
export const splitSectionReviewCopy = (lang: 'ar' | 'en') => copy[lang];
const reasons: Record<string, [string, string]> = {
  SPLIT_CURRENCY: [
    'يلزم تصريح أصل وحيد مطابق للعملة SAR.',
    'The original currency declaration must consistently state SAR.',
  ],
  SPLIT_DATE: [
    'يلزم تاريخ ISO صحيح بين 1900 و2100.',
    'A valid ISO date between 1900 and 2100 is required.',
  ],
  SPLIT_DOUBLE_AMOUNT: [
    'لا يجوز أن يكون المدين والدائن موجبين في الحركة نفسها.',
    'A movement cannot contain positive debit and credit together.',
  ],
  SPLIT_MISSING_SIDE: [
    'يلزم نص مبلغ صريح في كل جانب؛ الفراغ ليس صفراً.',
    'Both amount cells must be explicit; blank is not zero.',
  ],
  SPLIT_MONEY_FORMAT: [
    'صيغة المبلغ خارج العقد؛ لا تصلح القيم تلقائياً.',
    'The amount format is outside this contract; values are not repaired.',
  ],
  SPLIT_MONEY_PRECISION: [
    'المبلغ يتجاوز منزلتين عشريتين.',
    'The amount exceeds two decimal places.',
  ],
  SPLIT_MONEY_LIMIT: [
    'المبلغ أو المجموع يتجاوز حد الموارد المالية.',
    'The amount or total exceeds the financial resource limit.',
  ],
  SPLIT_PAGE_MAP: [
    'خريطة الصفوف والصفحات ناقصة أو غير مطابقة للأصل.',
    'The row and page map is incomplete or does not match the original.',
  ],
  SPLIT_HEADER: [
    'الرأس لا يطابق الأعمدة الخمسة الحرفية.',
    'The header does not match the five literal columns.',
  ],
  SPLIT_PAGE_HEADER: [
    'رأس الصفحة أو تمهيدها لا يطابق العقد.',
    'The page header or preamble does not match the contract.',
  ],
  SPLIT_COLUMNS: [
    'يلزم خمس خلايا وأربعة حدود أعمدة صريحة ثابتة.',
    'Five cells and four fixed explicit column cuts are required.',
  ],
  SPLIT_CONTINUATION: [
    'استمرار القسم غير مثبت في الصفحة الفيزيائية التالية.',
    'Section continuation is not proven on the next physical page.',
  ],
  SPLIT_DUPLICATE_PARENT: [
    'هوية الأب مكررة داخل المصدر.',
    'The parent identity is duplicated within the source.',
  ],
  SPLIT_REFERENCE_CONFLICT: [
    'المرجع الصريح لا يطابق هوية القسم.',
    'The explicit reference conflicts with the section identity.',
  ],
  SPLIT_NO_PARENT: [
    'الحركة بلا أب مفتوح مثبت.',
    'The movement has no proven open parent.',
  ],
  SPLIT_NO_MOVEMENTS: [
    'لا توجد حركات مؤهلة للاشتقاق.',
    'There are no eligible movements to derive.',
  ],
  SPLIT_BALANCE_UNSUPPORTED: [
    'الأرصدة خارج هذه العائلة.',
    'Balances are outside this family.',
  ],
  SPLIT_SECTION_TOTAL: [
    'مجموع القسم لا يطابق المدين والدائن كلٌ منفصلاً.',
    'The section total does not match debit and credit separately.',
  ],
  SPLIT_PAGE_TOTAL: [
    'مجموع الصفحة لا يطابق حركاتها الأصلية.',
    'The page total does not match its original movements.',
  ],
  SPLIT_GRAND_TOTAL: [
    'المجموع العام لا يطابق الحركات الأصلية.',
    'The grand total does not match the original movements.',
  ],
  SPLIT_CARRY_TOTAL: [
    'مبلغ الترحيل لا يطابق المجاميع التراكمية للقسم.',
    'The carry amounts do not match cumulative section totals.',
  ],
  SPLIT_CARRY_ORPHAN: [
    'دليل الترحيل المقابل مفقود أو غير صالح.',
    'The corresponding carry evidence is missing or invalid.',
  ],
  SPLIT_AFTER_GRAND_TOTAL: [
    'يوجد صف بعد إغلاق المجموع العام.',
    'A row appears after the grand total closed the source.',
  ],
  SPLIT_AFTER_PAGE_TOTAL: [
    'توجد حركة بعد مجموع الصفحة.',
    'A movement appears after the page total.',
  ],
  SPLIT_UNKNOWN_ROW: [
    'صف غير مصنف؛ لا يُحذف تلقائياً.',
    'An unclassified row cannot be silently dropped.',
  ],
  SPLIT_SOURCE: [
    'المصدر ليس PDF نصياً أصلياً ضمن هذه العائلة.',
    'The source is not an original native-text PDF in this family.',
  ],
  SPLIT_SOURCE_CHANGED: [
    'تغير الأصل أو سياق القراءة؛ أعد المراجعة.',
    'The original or reading context changed; review again.',
  ],
  SPLIT_SOURCE_HASH: [
    'بصمة بايتات الأصل غير مطابقة.',
    'The original byte hash does not match.',
  ],
  SPLIT_SOURCE_ISSUES: [
    'دليل الاستخراج الأصلي يتضمن مشكلات محجوبة.',
    'The original extraction evidence contains blocking issues.',
  ],
};
export function splitSectionReason(code: string, lang: 'ar' | 'en') {
  return reasons[code]?.[lang === 'ar' ? 0 : 1] ?? copy[lang].error;
}
const kinds: Record<string, string> = {
  unclassified: 'غير مصنف',
  synthetic: 'وسم اصطناعي',
  currency: 'عملة',
  header: 'رأس',
  parent: 'أب',
  continuation: 'متابعة',
  separator: 'فاصل',
  movement: 'حركة',
  'section-total': 'مجموع قسم',
  'page-total': 'مجموع صفحة',
  'grand-total': 'مجموع عام',
  carried: 'مرحل للأمام',
  brought: 'منقول من السابق',
};
export const splitSectionKind = (kind: string, lang: 'ar' | 'en') =>
  lang === 'ar' ? (kinds[kind] ?? kind) : kind;
