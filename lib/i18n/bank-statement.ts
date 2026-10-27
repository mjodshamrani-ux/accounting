// Copy for the bank statement path of the bank workspace
// (bank-statement-native-1). Arabic is the source; English has the same keys.
const ar = {
  modeTitle: 'نوع مصدر البنك',
  modes: {
    movements: 'ملف حركات بقالب التسوية',
    statement: 'كشف البنك كما يصدره البنك',
  },
  modeHints: {
    movements: 'CSV أو XLSX بهوية التسوية وأدوار الحركات',
    statement: 'PDF نصي أو جدول CSV أو XLSX، مع دفتر النقدية',
  },
  statement: 'كشف البنك',
  cashbook: 'دفتر النقدية',
  statementHint:
    'PDF نصي كما يصدره البنك، أو جدول CSV أو XLSX بالأعمدة: Date، Value Date، Description، Reference، Withdrawal، Deposit، Balance.',
  cashbookHint:
    'CSV أو XLSX بالأعمدة: Date، Voucher، Description، Reference، Receipts، Payments، وقيد واحد في كل صف.',
  pdfScope:
    'العملة والفترة من رأس الكشف المطبوع، ويثبت اكتماله ترقيم الصفحات والرصيد الختامي المطبوع.',
  tableScope:
    'الجدول لا يطبع عملته وفترته، ولا يثبت اكتماله وحده. حدد العملة والفترة، وأدخل الرصيد الختامي من كشف البنك.',
  currency: 'العملة',
  chooseCurrency: 'اختر العملة',
  periodStart: 'بداية الفترة',
  periodEnd: 'نهاية الفترة',
  closing: 'الرصيد الختامي في كشف البنك',
  closingHint:
    'أدخله من كشف البنك المطبوع أو المعتمد، لا من هذا الملف. يثبت اكتمال الجدول إن ساوى رصيده الأخير.',
  closingInvalid: 'اكتب المبلغ بمنازل العملة العشرية كاملة، مثل 1250.00',
  compare: 'طابق الكشف بالدفتر',
  claim:
    'مطابقة حركات الكشف بدفتر النقدية فقط. لا جسر أرصدة، ولا رسوم أو تحويل عملات مستنتج، ولا إثبات أصالة الكشف.',
  claimWithSheet:
    'مطابقة حركات الكشف بدفتر النقدية، وورقة التسوية أدناه: رصيد البنك من الكشف المطبوع المثبت، ورصيد الدفتر يعلنه المحاسب. لا رسوم أو تحويل عملات مستنتج، ولا إثبات لاكتمال الدفاتر أو لأصالة الكشف.',
  status: {
    held: 'الكشف محجوز ولم تُطابق أي حركة',
    'needs-review': 'حالات تنتظر قرارك',
    reviewed: 'كل الحالات آلية أو مقررة',
  },
  held: {
    'confirm-closing':
      'الجدول لا يطبع رصيدًا ختاميًا، فلا يثبت اكتماله. أدخل الرصيد الختامي من كشف البنك ثم طابق من جديد.',
    'closing-differs':
      'الرصيد الختامي المدخل لا يساوي رصيد الملف. راجع المبلغ أو الملف.',
    'no-period': 'حدد فترة الكشف ثم طابق من جديد.',
    'balance-broken': 'سلسلة الرصيد في الكشف لا تتصل:',
    'incomplete-pages': 'صفحات الكشف ناقصة أو خارج الترتيب:',
    other: 'لم يثبت اكتمال الكشف:',
  },
  heldCounts: (statement: number, cashbook: number) =>
    `حُجزت ${statement} حركة في الكشف و${cashbook} قيدًا في الدفتر دون مطابقة.`,
  counts: (automatic: number, review: number, outstanding: number) =>
    `مطابقات آلية: ${automatic} · تحتاج قرارك: ${review} · بنود معلقة: ${outstanding}`,
  summary: 'الكشف كما قُرئ',
  summaryHeaders: ['البند', 'القيمة'],
  summaryRows: {
    format: 'الصيغة',
    currency: 'العملة',
    period: 'الفترة',
    pages: 'الصفحات',
    opening: 'الرصيد الافتتاحي',
    closingPrinted: 'الرصيد الختامي',
    withdrawals: 'مجموع السحب',
    deposits: 'مجموع الإيداع',
    completeness: 'إثبات الاكتمال',
  },
  completeness: {
    printed: 'ترقيم الصفحات والرصيد الختامي المطبوع',
    'confirmed-closing': 'رصيد ختامي أكده المحاسب',
    unproven: 'غير مثبت',
  },
  review: 'حالات تحتاج قرارك',
  automatic: 'مطابقات آلية بمرجع صريح',
  caseHeaders: [
    'الحالة',
    'السبب',
    'المرجع',
    'حركات الكشف',
    'قيود الدفتر',
    'الوضع',
    'القرار',
  ],
  reasons: {
    reference: 'مرجع صريح متطابق',
    'direction-conflict': 'تعارض الاتجاه',
    'amount-difference': 'فرق في المبلغ',
    'date-gap': 'تباعد التاريخ أكثر من ثلاثة أيام',
    'duplicate-reference': 'مرجع مكرر',
    'amount-date-suggestion': 'اقتراح بالمبلغ والتاريخ دون مرجع',
    'ambiguous-amount-date': 'أكثر من مرشح بالمبلغ والتاريخ',
    'carried-repeated': 'بند مرحّل سُجل مرة أخرى في جانبه',
    'carried-restated': 'بند مرحّل أُعيد قيده بمبلغ أو تاريخ أو اتجاه آخر',
    'carried-reference': 'بند مرحّل بمرجعه ومبلغه',
    'carried-amount-difference': 'بند مرحّل بمرجعه ومبلغ آخر',
    'carried-ambiguous': 'أكثر من مقابل لبند مرحّل',
    'carried-amount-suggestion': 'اقتراح بالمبلغ لبند مرحّل',
  },
  caseStatus: {
    'matched-automatic': 'مطابقة آلية',
    'needs-review': 'تنتظر القرار',
    'matched-accepted': 'قبلها المحاسب',
    rejected: 'رفضها المحاسب',
  },
  accept: 'اقبل',
  reject: 'ارفض',
  undo: 'تراجع',
  note: 'سبب القرار',
  noteHint: 'يُسجل السبب مع القرار في الجلسة وفي Excel، ولا يُتخذ قرار دونه.',
  acceptLimit:
    'القبول متاح للاقتراح بالمبلغ والتاريخ ولتباعد التاريخ تحت مرجع واحد فقط. فرق المبلغ وتعارض الاتجاه والمجموعات المتعددة تُرفض أو تبقى للمراجعة. وفي البنود المرحّلة يُقبل تقابل المرجع واقتراح المبلغ فقط.',
  priorSession: 'جلسة الفترة السابقة (اختياري)',
  priorSessionHint:
    'ملف جلسة كشف حفظته تراصف للفترة التي تسبق هذا الكشف مباشرة. تُعاد من أصولها، وتُرحّل بنودها المعلقة دليلًا مرشحًا لا اعتمادًا، ولا يُصفّى بند مرحّل آليًا.',
  priorSessionRemove: 'أزل الجلسة السابقة',
  priorAccepted: (name: string, n: number) =>
    `قُبلت الجلسة السابقة ${name}. البنود المرحّلة منها: ${n}.`,
  priorRefused: {
    ROLL_PREVIOUS_UNREADABLE:
      'لا تُقرأ الجلسة السابقة من أصولها: صيغة أو بصمة أو قرار لا يُقبل، أو سلسلة جلساتها لا تتصل.',
    ROLL_PREVIOUS_HELD: 'كشف الفترة السابقة محجوز، فلا بنود معلقة تُرحّل منه.',
    ROLL_PREVIOUS_UNDECIDED:
      'في الفترة السابقة حالة تنتظر قرارًا، فلم تُغلق ولا يُرحّل منها شيء.',
    ROLL_CURRENCY: 'عملة الفترة السابقة غير عملة هذا الكشف.',
    ROLL_NOT_CONSECUTIVE:
      'الفترة السابقة لا تنتهي في اليوم السابق لبداية هذا الكشف.',
    ROLL_OPENING:
      'الرصيد الافتتاحي لهذا الكشف لا يساوي الرصيد الختامي المطبوع للفترة السابقة.',
  },
  priorRefusedNote: 'لم يُرحّل شيء، وطوبقت الفترة كما لو لم تُرفق جلسة سابقة.',
  carriedCases: 'حالات بنود مرحّلة تحتاج قرارك',
  carriedCaseHeaders: [
    'الحالة',
    'السبب',
    'البند المرحّل',
    'حركات الكشف',
    'قيود الدفتر',
    'الوضع',
    'القرار',
  ],
  carriedItems: 'البنود المرحّلة من الفترة السابقة',
  carriedItemHeaders: [
    'البند',
    'الجانب',
    'الفترة',
    'الموضع',
    'التاريخ',
    'المرجع',
    'الاتجاه',
    'المبلغ',
    'الأصل',
    'العمر',
    'عند نهاية الفترة',
  ],
  priorRejectedIn: (id: string) => `رُفضت في ${id} من فترتها`,
  pageOnly: (page: number) => `صفحة ${page}`,
  stillCarried: (age: number) => `يبقى مرحّلًا بعمر ${age}`,
  inCase: 'في حالة لم تُرفض',
  outstanding: 'بنود معلقة',
  outstandingHeaders: [
    'الجانب',
    'المعرف',
    'الأصل',
    'التاريخ',
    'المرجع',
    'الاتجاه',
    'المبلغ',
    'الموضع',
  ],
  sides: { statement: 'الكشف', cashbook: 'الدفتر' },
  unmatched: 'بلا مقابل',
  rejectedIn: (id: string) => `رُفضت في ${id}`,
  directions: { in: 'إيداع أو قبض', out: 'سحب أو دفع' },
  timing: 'تاريخ قيمة خارج الفترة',
  timingHeaders: ['الحركة', 'التاريخ', 'تاريخ القيمة', 'الموضع'],
  lines: 'أسطر الكشف كما قُرئت',
  lineHeaders: [
    'السطر',
    'النوع',
    'الصفحة',
    'عناصر النص',
    'الحركة',
    'التاريخ',
    'تاريخ القيمة',
    'البيان',
    'المرجع',
    'السحب',
    'الإيداع',
    'الرصيد',
  ],
  lineKinds: {
    opening: 'رصيد افتتاحي',
    'brought-forward': 'رصيد منقول من الصفحة السابقة',
    movement: 'حركة',
    continuation: 'تكملة بيان',
    'page-totals': 'إجمالي الصفحة',
    'carried-forward': 'رصيد منقول إلى الصفحة التالية',
    closing: 'رصيد ختامي',
    totals: 'إجمالي الكشف',
  },
  decisions: 'سجل القرارات',
  decisionHeaders: ['القرار', 'النوع', 'الحالة', 'الوقت على الجهاز', 'السبب'],
  decisionTypes: { accept: 'قبول', reject: 'رفض', undo: 'تراجع' },
  pageCitation: (page: number, items: string) => `صفحة ${page}، عناصر ${items}`,
  rowCitation: (row: string) => `صف ${row}`,
  save: 'احفظ جلسة الكشف',
  export: 'نزّل ورقة عمل الكشف',
  exportNote:
    'ملف Excel يتضمن الكشف والدفتر الأصليين وأدلة المراجعة كاملة، فشاركه بقدر ما تشارك الأصلين.',
  previous: 'السابق',
  next: 'التالي',
  errors: {
    'statement-reading':
      'تعذرت قراءة نص PDF بأمان. قد يكون ممسوحًا ضوئيًا أو نصه مقصوصًا؛ لا يُقرأ PDF مصوَّر.',
    'statement-layout':
      'لم تُعرف بنية الكشف: رأس الجدول أو ترويسة الصفحات لا تطابق صيغة مدعومة.',
    'statement-scope': 'رأس الكشف لا يذكر عملة واحدة وفترة واحدة.',
    'statement-line': 'سطر في الكشف لا يطابق صيغة معلنة.',
    cashbook: 'دفتر النقدية لا يطابق الأعمدة المعلنة.',
    'source-hash': 'تغير ملف بعد اختياره. اختره من جديد.',
    session: 'ملف الجلسة غير صالح أو تالف.',
    'scope-choice': 'النطاق المحدد لا يناسب هذا النوع من الكشف.',
    decision: 'لم يُقبل القرار. طابق من جديد ثم أعد المحاولة.',
    sheet:
      'لم تُقبل مدخلات الورقة: رصيد أو مصدر أو اسم أو تاريخ بصيغة لا تقبلها الجلسة.',
    other: 'لم تكتمل العملية ولم تصدر نتيجة جديدة.',
  },
  errorDetail: 'التفصيل',
};

const en: typeof ar = {
  modeTitle: 'Bank source type',
  modes: {
    movements: 'Movement file in the settlement template',
    statement: 'Bank statement as the bank issues it',
  },
  modeHints: {
    movements: 'CSV or XLSX with settlement identity and movement roles',
    statement: 'Native-text PDF or a CSV or XLSX table, with the cashbook',
  },
  statement: 'Bank statement',
  cashbook: 'Cashbook',
  statementHint:
    'A native-text PDF as the bank issues it, or a CSV or XLSX table with the columns Date, Value Date, Description, Reference, Withdrawal, Deposit and Balance.',
  cashbookHint:
    'CSV or XLSX with the columns Date, Voucher, Description, Reference, Receipts and Payments, one entry per row.',
  pdfScope:
    'Currency and period come from the printed statement heading; page numbers and the printed closing balance prove completeness.',
  tableScope:
    'A table prints neither its currency nor its period, and cannot prove its own completeness. Choose the currency and period, and enter the closing balance from the bank statement.',
  currency: 'Currency',
  chooseCurrency: 'Choose the currency',
  periodStart: 'Period start',
  periodEnd: 'Period end',
  closing: 'Closing balance on the bank statement',
  closingHint:
    'Enter it from the printed or authorised bank statement, not from this file. It proves the table complete when it equals the table’s last balance.',
  closingInvalid:
    'Write the amount with all of the currency’s decimals, such as 1250.00',
  compare: 'Match the statement to the cashbook',
  claim:
    'Statement-to-cashbook movement matching only. No balance bridge, no inferred fees or currency conversion, and no proof of statement authenticity.',
  claimWithSheet:
    'Statement-to-cashbook movement matching, and the reconciliation sheet below: the bank balance from the proved printed statement, the book balance declared by the accountant. No inferred fees or currency conversion, and no proof that the books are complete or that the statement is authentic.',
  status: {
    held: 'The statement is held and nothing was matched',
    'needs-review': 'Cases await your decision',
    reviewed: 'Every case is automatic or decided',
  },
  held: {
    'confirm-closing':
      'The table prints no closing balance, so its completeness is unproven. Enter the closing balance from the bank statement and match again.',
    'closing-differs':
      'The closing balance entered does not equal the file’s balance. Check the amount or the file.',
    'no-period': 'Set the statement period and match again.',
    'balance-broken': 'The statement’s balance chain does not connect:',
    'incomplete-pages': 'Statement pages are missing or out of order:',
    other: 'The statement’s completeness is not proved:',
  },
  heldCounts: (statement: number, cashbook: number) =>
    `${statement} statement movements and ${cashbook} cashbook entries were held unmatched.`,
  counts: (automatic: number, review: number, outstanding: number) =>
    `Automatic matches: ${automatic} · Awaiting your decision: ${review} · Outstanding items: ${outstanding}`,
  summary: 'The statement as read',
  summaryHeaders: ['Item', 'Value'],
  summaryRows: {
    format: 'Format',
    currency: 'Currency',
    period: 'Period',
    pages: 'Pages',
    opening: 'Opening balance',
    closingPrinted: 'Closing balance',
    withdrawals: 'Total withdrawals',
    deposits: 'Total deposits',
    completeness: 'Completeness proof',
  },
  completeness: {
    printed: 'Page numbers and the printed closing balance',
    'confirmed-closing': 'A closing balance confirmed by the accountant',
    unproven: 'Not proved',
  },
  review: 'Cases needing your decision',
  automatic: 'Automatic matches by explicit reference',
  caseHeaders: [
    'Case',
    'Reason',
    'Reference',
    'Statement movements',
    'Cashbook entries',
    'Status',
    'Decision',
  ],
  reasons: {
    reference: 'Identical explicit reference',
    'direction-conflict': 'Direction conflict',
    'amount-difference': 'Amount difference',
    'date-gap': 'Dates more than three days apart',
    'duplicate-reference': 'Repeated reference',
    'amount-date-suggestion': 'Amount and date suggestion without a reference',
    'ambiguous-amount-date': 'Several candidates by amount and date',
    'carried-repeated': 'Carried item recorded again on its own side',
    'carried-restated':
      'Carried item restated with another amount, date or direction',
    'carried-reference': 'Carried item with its reference and amount',
    'carried-amount-difference':
      'Carried item with its reference and another amount',
    'carried-ambiguous': 'More than one counterpart for a carried item',
    'carried-amount-suggestion': 'Amount suggestion for a carried item',
  },
  caseStatus: {
    'matched-automatic': 'Automatic match',
    'needs-review': 'Awaiting decision',
    'matched-accepted': 'Accepted by the accountant',
    rejected: 'Rejected by the accountant',
  },
  accept: 'Accept',
  reject: 'Reject',
  undo: 'Undo',
  note: 'Reason for the decision',
  noteHint:
    'The reason is recorded with the decision in the session and in Excel; no decision is taken without one.',
  acceptLimit:
    'Accepting is available only for an amount and date suggestion or a date gap under one reference. An amount difference, a direction conflict and groups of several members are rejected or stay for review. For carried items, only a reference pairing and an amount suggestion can be accepted.',
  priorSession: 'Previous period session (optional)',
  priorSessionHint:
    'A statement session file Tarasuf saved for the period just before this statement. It is replayed from its originals; its outstanding items are carried as candidate evidence, not approval, and no carried item is cleared automatically.',
  priorSessionRemove: 'Remove the previous session',
  priorAccepted: (name: string, n: number) =>
    `The previous session ${name} was accepted. Items carried from it: ${n}.`,
  priorRefused: {
    ROLL_PREVIOUS_UNREADABLE:
      'The previous session cannot be read from its originals: its format, a fingerprint or a decision is refused, or its chain of sessions does not connect.',
    ROLL_PREVIOUS_HELD:
      'The previous period’s statement is held, so it has no outstanding items to carry.',
    ROLL_PREVIOUS_UNDECIDED:
      'A case in the previous period awaits a decision, so it is not closed and nothing is carried.',
    ROLL_CURRENCY:
      'The previous period is in another currency than this statement.',
    ROLL_NOT_CONSECUTIVE:
      'The previous period does not end the day before this statement starts.',
    ROLL_OPENING:
      'This statement’s opening balance differs from the previous period’s printed closing balance.',
  },
  priorRefusedNote:
    'Nothing was carried; the period was matched as if no previous session were attached.',
  carriedCases: 'Carried item cases awaiting your decision',
  carriedCaseHeaders: [
    'Case',
    'Reason',
    'Carried item',
    'Statement movements',
    'Cashbook entries',
    'Status',
    'Decision',
  ],
  carriedItems: 'Items carried from the previous period',
  carriedItemHeaders: [
    'Item',
    'Side',
    'Period',
    'Location',
    'Date',
    'Reference',
    'Direction',
    'Amount',
    'Origin',
    'Age',
    'At the period end',
  ],
  priorRejectedIn: (id: string) => `Rejected in ${id} of its period`,
  pageOnly: (page: number) => `Page ${page}`,
  stillCarried: (age: number) => `Still carried, age ${age}`,
  inCase: 'In a case not rejected',
  outstanding: 'Outstanding items',
  outstandingHeaders: [
    'Side',
    'ID',
    'Origin',
    'Date',
    'Reference',
    'Direction',
    'Amount',
    'Location',
  ],
  sides: { statement: 'Statement', cashbook: 'Cashbook' },
  unmatched: 'No counterpart',
  rejectedIn: (id: string) => `Rejected in ${id}`,
  directions: { in: 'Deposit or receipt', out: 'Withdrawal or payment' },
  timing: 'Value date outside the period',
  timingHeaders: ['Movement', 'Date', 'Value date', 'Location'],
  lines: 'Statement lines as read',
  lineHeaders: [
    'Line',
    'Kind',
    'Page',
    'Text items',
    'Movement',
    'Date',
    'Value date',
    'Description',
    'Reference',
    'Withdrawal',
    'Deposit',
    'Balance',
  ],
  lineKinds: {
    opening: 'Opening balance',
    'brought-forward': 'Balance brought forward',
    movement: 'Movement',
    continuation: 'Description continued',
    'page-totals': 'Page totals',
    'carried-forward': 'Balance carried forward',
    closing: 'Closing balance',
    totals: 'Statement totals',
  },
  decisions: 'Decision log',
  decisionHeaders: ['Decision', 'Type', 'Case', 'Device time', 'Reason'],
  decisionTypes: { accept: 'Accept', reject: 'Reject', undo: 'Undo' },
  pageCitation: (page: number, items: string) => `Page ${page}, items ${items}`,
  rowCitation: (row: string) => `Row ${row}`,
  save: 'Save the statement session',
  export: 'Download the statement workpaper',
  exportNote:
    'The Excel file includes the original statement and cashbook and the complete review evidence; share it as you would the originals.',
  previous: 'Previous',
  next: 'Next',
  errors: {
    'statement-reading':
      'The PDF text could not be read safely. It may be scanned or its text clipped; image PDFs are not read.',
    'statement-layout':
      'The statement layout was not recognised: the table header or page heading does not match a supported layout.',
    'statement-scope':
      'The statement heading does not state one currency and one period.',
    'statement-line': 'A statement line does not match a declared form.',
    cashbook: 'The cashbook does not match the declared columns.',
    'source-hash': 'A file changed after it was chosen. Choose it again.',
    session: 'The session file is not valid or is damaged.',
    'scope-choice': 'The scope does not fit this kind of statement.',
    decision: 'The decision was not taken. Match again and retry.',
    sheet:
      'The sheet inputs were not taken: a balance, source, name or date in a form the session does not admit.',
    other: 'The operation did not complete and no new result was produced.',
  },
  errorDetail: 'Detail',
};

export const bankStatementCopy = { ar, en };
