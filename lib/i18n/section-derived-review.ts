const copy = {
  ar: {
    open: 'فتح مراجعة اشتقاق مراجع أقسام PDF',
    close: 'إغلاق مراجعة اشتقاق مراجع أقسام PDF',
    title: 'قراءة مشتقة من أقسام PDF بمراجعة صريحة',
    intro:
      'حدد اقتراحات المرجع التي راجعتها، وسجل قرار المراجع، ثم طبّق القرار لإنشاء ملفات مشتقة منفصلة. لا تلحق هذه اللوحة الملفات بالتسوية المالية تلقائياً.',
    source: 'مصدر PDF المحدد',
    supplier: 'المورد',
    ledger: 'دفتر الأستاذ',
    missing:
      'ارفع PDF نصياً أصلياً وحدد أربعة أعمدة متميزة للتاريخ والمرجع والوصف والمبلغ الموقّع.',
    inspect: 'فحص الأصل واقتراح المراجع',
    busy: 'إعادة إثبات الأصل والاختيار…',
    clear: 'مسح المراجعة المشتقة',
    proposals: 'اقتراحات المرجع القابلة للاختيار',
    selected: 'اختيار هذا الاقتراح للمراجعة',
    parent: 'الأصل الصريح',
    target: 'الخلية المستهدفة',
    continuation: 'دليل استمرار الصفحة',
    headers: 'رأس الأعمدة المرحّل',
    headerBands: 'خلايا رأس الأعمدة الأصلية',
    currencyContext: 'سياق العملة من الأصل',
    currency: 'رمز العملة من رأس المبلغ الأصلي',
    precision: 'الدقة المختارة',
    policyPrecision: 'دقة سياسة العملة المحدودة',
    precisionOrigin: 'مصدر الدقة: سياسة العقد المحدودة',
    precisionPolicy:
      'الدقة من السياسة المعلنة وليست من خلية أصلية. يلزم أن تساوي الدقة المختارة في إعدادات المصدر دقة هذه العملة؛ يبقى النطاق المالي غير مؤكد.',
    currencyHeaders: 'كل خلايا رأس المبلغ الأصلي، بما فيها رؤوس الصفحات المعادة',
    originalInterpretation: 'قراءات مبالغ الأصل الملتبسة',
    originalInterpretationGuidance:
      'قارن قراءة النقطة العشرية بقراءة النقطة كتجميع في صفوف الأصل أدناه. اختر قراءة النقطة العشرية صراحة في بطاقة المصدر الأصلية، ثم أعد اختيار المصدر وفحص المراجعة وتحديد الاقتراحات. تغيير القراءة يبطل القرار والإيصال السابقين.',
    originalChoiceNeeded:
      'يلزم اختيار قراءة النقطة العشرية في بطاقة المصدر قبل تسجيل القرار.',
    originalChoiceRecorded:
      'يوجد اختيار لقراءة النقطة العشرية؛ يعاد التحقق من ارتباطه بالأصل والقراءة الحالية عند تسجيل القرار.',
    originalInterpretationAck:
      'راجعت قراءتي النقطة في مبالغ PDF الأصلية وأقر باختيار النقطة العشرية المرتبط بهذا الأصل ودقته، وبأن رمز العملة وحده لا يحسم القراءة.',
    decimalInterpretation: 'النقطة عشرية — وحدات صغرى صحيحة',
    groupingInterpretation: 'النقطة للتجميع — وحدات صغرى صحيحة',
    unreadableInterpretation: 'غير مقروء بهذه الدقة؛ لا يحول إلى مبلغ مفترض',
    rows: 'كل صفوف جدول PDF المحدد',
    questions: 'أسئلة الحدود وأسباب تعذر الاشتقاق',
    unknown: 'غير معلوم',
    none: 'لا توجد اقتراحات قابلة للاختيار.',
    hash: 'بصمة المصدر',
    extraction: 'بصمة الاستخراج',
    revision: 'إصدار الاستخراج',
    selection: 'بصمة اختيار الاقتراحات',
    row: 'الصف',
    page: 'الصفحة',
    sheet: 'الورقة',
    column: 'العمود',
    reviewer: 'اسم المراجع',
    rationale: 'سبب القرار المستند إلى دليل المصدر',
    originalAck: 'راجعت جميع صفوف جدول PDF المحدد مقابل الأصل.',
    rolesAck: 'راجعت دور المرجع والأصل الصريح ودليل الاستمرار لكل اقتراح اخترته.',
    amountsAck: 'تحققت من حفظ مبالغ المصدر الموقعة دون تعديل.',
    derivedAck:
      'أفهم أن CSV قراءة مشتقة منفصلة وأن قرار المرجع ليس اعتماداً مالياً أو إلحاقاً تلقائياً بالتسوية.',
    accept: 'تسجيل قبول الاختيار المراجع',
    reject: 'تسجيل رفض الاختيار',
    receipt: 'قرار المراجع مرتبط بالاختيار الحالي',
    apply: 'تطبيق القرار وإنشاء القراءة المشتقة',
    downloadCsv: 'تنزيل CSV المشتق',
    downloadProvenance: 'تنزيل دليل الاشتقاق JSON',
    downloadOriginal: 'تنزيل PDF الأصلي المحفوظ',
    artifact:
      'قراءة مشتقة صراحة؛ يلزم التحقق المالي المستقل قبل استخدامها في التسوية.',
    error: 'تعذر إثبات المراجعة أو الاشتقاق',
    technical: 'التفاصيل الفنية',
    previous: 'الصفوف السابقة',
    next: 'الصفوف التالية',
    of: 'من',
  },
  en: {
    open: 'Open PDF section derivative review',
    close: 'Close PDF section derivative review',
    title: 'Explicitly reviewed PDF section derivative',
    intro:
      'Select the reference proposals you reviewed, record the reviewer decision, then apply it to create separate derived files. This panel does not automatically attach them to financial reconciliation.',
    source: 'Selected PDF source',
    supplier: 'Supplier',
    ledger: 'Ledger',
    missing:
      'Upload an original native-text PDF with four distinct date, reference, description and signed-amount columns.',
    inspect: 'Inspect original and reference proposals',
    busy: 'Reproving original and selection…',
    clear: 'Clear derivative review',
    proposals: 'Selectable reference proposals',
    selected: 'Select this proposal for review',
    parent: 'Explicit parent',
    target: 'Target cell',
    continuation: 'Page continuation evidence',
    headers: 'Carried column header',
    headerBands: 'Original column header cells',
    currencyContext: 'Currency context from the original',
    currency: 'Currency code from the original amount header',
    precision: 'Selected precision',
    policyPrecision: 'Finite currency policy precision',
    precisionOrigin: 'Precision origin: finite contract policy',
    precisionPolicy:
      'Precision comes from the declared policy, not an original cell. The precision selected in source settings must match this currency policy; financial scope remains unconfirmed.',
    currencyHeaders:
      'All original amount header cells, including repeated page headers',
    originalInterpretation: 'Ambiguous original amount readings',
    originalInterpretationGuidance:
      'Compare decimal-dot and grouping-dot readings in the original rows below. Explicitly choose the decimal-dot reading in the original source card, then select the source again, inspect the review and select proposals. Changing the reading invalidates the previous decision and receipt.',
    originalChoiceNeeded:
      'Choose the decimal-dot reading in the source card before recording a decision.',
    originalChoiceRecorded:
      'A decimal-dot choice is present; its binding to the original and current reading is rechecked when recording a decision.',
    originalInterpretationAck:
      'I reviewed both dot readings in the original PDF amounts and acknowledge the decimal-dot choice bound to this original and precision, and that the currency code alone does not settle the reading.',
    decimalInterpretation: 'Decimal dot — integer minor units',
    groupingInterpretation: 'Grouping dot — integer minor units',
    unreadableInterpretation: 'Unreadable at this precision; no assumed amount',
    rows: 'All rows in the selected PDF table',
    questions: 'Boundary questions and derivation blockers',
    unknown: 'Unknown',
    none: 'No selectable proposals.',
    hash: 'Source hash',
    extraction: 'Extraction hash',
    revision: 'Extraction revision',
    selection: 'Proposal selection hash',
    row: 'Row',
    page: 'Page',
    sheet: 'Sheet',
    column: 'Column',
    reviewer: 'Reviewer name',
    rationale: 'Decision rationale grounded in source evidence',
    originalAck:
      'I reviewed every row in the selected PDF table against the original.',
    rolesAck:
      'I reviewed the reference role, explicit parent and continuation evidence for every selected proposal.',
    amountsAck:
      'I checked that the signed source amounts are preserved without modification.',
    derivedAck:
      'I understand that the CSV is a separate derived reading and that this reference decision is not financial approval or automatic attachment to reconciliation.',
    accept: 'Record acceptance of reviewed selection',
    reject: 'Record rejection of selection',
    receipt: 'Reviewer decision bound to current selection',
    apply: 'Apply decision and create derived reading',
    downloadCsv: 'Download derived CSV',
    downloadProvenance: 'Download derivation provenance JSON',
    downloadOriginal: 'Download preserved original PDF',
    artifact:
      'Explicitly derived reading; independent financial verification is required before reconciliation use.',
    error: 'Review or derivation could not be proven',
    technical: 'Technical details',
    previous: 'Previous rows',
    next: 'Next rows',
    of: 'of',
  },
};
export const sectionDerivedReviewCopy = (lang: 'ar' | 'en') => copy[lang];

export function sectionDerivedReviewError(message: string, lang: 'ar' | 'en') {
  if (lang === 'en' || /[\u0600-\u06ff]/.test(message)) return message;
  if (
    /original.*(interpretation|ambigu|dot)|format.*choice|number.*interpretation/i.test(
      message,
    )
  )
    return 'يلزم اختيار تنسيق أصلي صريح مرتبط بهذا PDF ودقته وإقرار مراجعة قراءتي النقطة؛ اختر القراءة في بطاقة المصدر ثم أعد الفحص والمراجعة.';
  if (/precision|decimal.*policy|currency.*policy/i.test(message))
    return 'يلزم أن تساوي الدقة المختارة دقة سياسة العملة المثبتة برأس المبلغ الأصلي؛ راجع إعدادات المصدر ثم أعد الفحص.';
  if (/changed|stale|revision|hash/i.test(message))
    return 'تغير الأصل أو الاستخراج أو الاختيار؛ أعد الفحص وسجل قراراً مرتبطاً بالقراءة الحالية.';
  if (/Reviewer|rationale/i.test(message))
    return 'يلزم اسم المراجع وسبب القرار المستند إلى دليل المصدر.';
  if (/receipt|review decision|acknowledgement|live session/i.test(message))
    return 'يلزم قرار صريح صالح من هذه الجلسة وإقرارات المراجعة المطلوبة؛ أعد مراجعة الاختيار الحالي.';
  if (/boundaries|movement|unselected|reference/i.test(message))
    return 'لم يثبت مرجع كل حركة أو حدود القسم من الأصل؛ راجع كل الصفوف والاقتراحات قبل إنتاج قراءة مشتقة.';
  if (/signed transactions|columns|header|overrides|currency/i.test(message))
    return 'الاشتقاق محدود بجدول أصلي ذي أربعة أعمدة صريحة للتاريخ والمرجع والوصف والمبلغ الموقّع، دون تغييرات سياق أو أرصدة.';
  return 'تعذر إثبات المراجعة أو الاشتقاق من PDF الأصلي وإعدادات القراءة الحالية. راجع التفاصيل والدليل.';
}
