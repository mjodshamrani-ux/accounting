// Labels of the closing reconciliation sheet (bank-reconciliation-sheet-1,
// proposed), for the workbook and the bank workspace. Arabic is the source;
// English has the same keys. Labels are not content: a sign-off is bound to
// the sheet's figures and items, never to these words.
const ar = {
  title: 'ورقة تسوية البنك',
  sheetName: 'التسوية',
  labels: {
    key: 'المفتاح',
    status: 'الحالة',
    refusal: 'سبب عدم إعداد الورقة',
    currency: 'العملة',
    period: 'الفترة',
    claim: 'حدود الورقة',
  },
  status: {
    draft: 'مسودة: حالات تنتظر قرارك',
    reconciled: 'متوازنة: لا فرق غير مفسر',
    'reconciled-within-tolerance':
      'متوازنة ضمن السماحية المعلنة: الفروق المسموحة ظاهرة، ولا فرق غير مفسر',
    difference: 'فرق غير مفسر',
  },
  refusals: {
    SHEET_STATEMENT_HELD: 'لا ورقة: الكشف موقوف، فلا رصيد بنك مثبت.',
    SHEET_PREVIOUS_REFUSED:
      'لا ورقة: رُفضت الجلسة السابقة المرفقة، فتنقص الورقة بنودها المرحّلة. أزلها أو أرفق الجلسة الصحيحة.',
    SHEET_NO_BOOK_BALANCE: 'لا ورقة: أدخل رصيد الدفتر في نهاية الفترة.',
  },
  bank: 'الرصيد في كشف البنك',
  bankSource: (page: number) => `الرصيد الختامي المطبوع، صفحة ${page}`,
  book: 'الرصيد في الدفتر',
  bookSource: 'معلن من المحاسب، لا مقروء من ملف',
  bookNote: 'مصدر رصيد الدفتر',
  sections: {
    bookReceiptsNotOnStatement: 'يُضاف: قبض في الدفتر ليس في الكشف',
    bookPaymentsNotOnStatement: 'يُطرح: دفع في الدفتر ليس في الكشف',
    statementDepositsNotInBook: 'يُضاف: إيداع في الكشف ليس في الدفتر',
    statementWithdrawalsNotInBook: 'يُطرح: سحب في الكشف ليس في الدفتر',
  },
  total: 'المجموع',
  adjustedBank: 'رصيد البنك المعدل',
  adjustedBook: 'رصيد الدفتر المعدل',
  difference: 'الفرق غير المفسر (البنك المعدل − الدفتر المعدل)',
  origins: {
    unmatched: 'غير مطابق',
    rejected: 'حالة مرفوضة',
    pending: 'ينتظر قرارك',
    carried: 'مرحّل',
  },
  itemHeaders: [
    'الجانب',
    'المعرّف',
    'الفترة',
    'الصفحة أو الصف',
    'التاريخ',
    'المرجع',
    'المبلغ',
    'المبلغ بالوحدات الصغرى',
    'الأصل',
    'رمز الأصل',
    'الحالة',
    'السبب',
    'العمر بنهايات الفترات',
    'بصمة الملف',
  ],
  sides: { statement: 'الكشف', cashbook: 'الدفتر' },
  prepared: 'أعده',
  reviewed: 'راجعه',
  signoffDate: 'التاريخ',
  signoffVoid: 'أُعطي على ورقة سابقة، ولم يعد قائمًا',
  signoffValid: 'قائم على هذه الورقة',
  screen: {
    intro:
      'أدخل رصيد حساب البنك في دفاترك بنهاية فترة الكشف لتُعد الورقة. تسرد الورقة كل بند لم يُصفَّ، ولا تُخفي فرقًا بقيد موازن أو سماحية.',
    balance: 'رصيد الدفتر في نهاية الفترة',
    balanceHint:
      'بعملة الكشف ومنازلها العشرية. موجب: رصيد مدين، أموال لدى البنك. سالب: رصيد دائن، سحب على المكشوف. تعلنه أنت، ولا يُقرأ من ملف.',
    note: 'مصدره (اختياري)',
    language: 'لغة تسميات الورقة في Excel',
    languages: { ar: 'العربية', en: 'English' },
    apply: 'أعد الورقة',
    invalid: {
      book: 'رصيد الدفتر ليس مبلغًا بمنازل عملة الكشف العشرية.',
      note: 'المصدر يحتاج رصيدًا، وحتى 200 حرف بلا محارف تحكم.',
    },
    declared: (note: string) =>
      note ? `معلن من المحاسب: ${note}` : 'معلن من المحاسب، بلا مصدر مذكور',
    signoffs: 'الإعداد والمراجعة',
    signHint:
      'اسم وتاريخ تكتبهما، يرتبطان بمحتوى الورقة المعروضة الآن. إن تغير رصيد أو بند أو قرار بعدها بطلا وظهرا باطلين.',
    name: 'الاسم',
    sign: { prepared: 'سجّل الإعداد', reviewed: 'سجّل المراجعة' },
    none: 'لم يُسجل',
    bridgeHeaders: ['البند', 'المبلغ', 'الأساس'],
    count: (n: number) =>
      n === 0
        ? 'لا بنود'
        : n === 1
          ? 'بند واحد'
          : n === 2
            ? 'بندان'
            : `${n} بنود`,
    itemHeaders: [
      'الجانب',
      'المعرّف',
      'الفترة',
      'الصفحة أو الصف',
      'التاريخ',
      'المرجع',
      'الاتجاه',
      'المبلغ',
      'الأصل',
      'الحالة',
      'السبب',
      'العمر بنهايات الفترات',
    ],
  },
  tolerance: {
    policy: 'السماحية المعلنة: حد الزوج، وحد الفترة، وسببها',
    headers: [
      'الاتجاه',
      'الحالة',
      'حركة الكشف',
      'قيد الدفتر',
      'مبلغ الكشف',
      'بالوحدات الصغرى',
      'مبلغ الدفتر',
      'بالوحدات الصغرى',
      'الأثر في الفرق',
      'بالوحدات الصغرى',
    ],
    section: 'فروق ضمن السماحية المعلنة (أثرها في الفرق)',
    directions: { in: 'قبض', out: 'دفع' },
    unexplained: 'الباقي بلا تفسير (الفرق − المسموح)',
    claim:
      'والسماحية يعلنها المحاسب، وتُذكر كل حالة سمحت بها بمبلغيها وأثرها، ولا تغير مبلغًا ولا تُخفي الباقي بلا تفسير.',
  },
  claim:
    'رصيد البنك من الكشف المطبوع المثبت، ورصيد الدفتر يعلنه المحاسب، والبنود من نتيجة المطابقة والقرارات المسجلة فقط. ليست إثباتًا لاكتمال الدفتر، ولا رأيًا مهنيًا، ولا اعتمادًا للبنود. «أعده» و«راجعه» حقلان نصيان، لا توقيع رقمي ولا تحقق من هوية.',
};
type Copy = typeof ar;
const en: Copy = {
  title: 'Bank reconciliation sheet',
  sheetName: 'Reconciliation',
  labels: {
    key: 'Key',
    status: 'Status',
    refusal: 'Why there is no sheet',
    currency: 'Currency',
    period: 'Period',
    claim: 'What this sheet claims',
  },
  status: {
    draft: 'Draft: cases await your decision',
    reconciled: 'Reconciled: no unexplained difference',
    'reconciled-within-tolerance':
      'Reconciled within the declared tolerance: tolerated differences shown, no unexplained difference',
    difference: 'Unexplained difference',
  },
  refusals: {
    SHEET_STATEMENT_HELD:
      'No sheet: the statement is held, so there is no proved bank balance.',
    SHEET_PREVIOUS_REFUSED:
      'No sheet: the attached previous session was refused, so the sheet would miss its carried items. Remove it or attach the right session.',
    SHEET_NO_BOOK_BALANCE:
      'No sheet: enter the book balance at the period end.',
  },
  bank: 'Balance per bank statement',
  bankSource: (page: number) => `Printed closing balance, page ${page}`,
  book: 'Balance per books',
  bookSource: 'Declared by the accountant, not read from a file',
  bookNote: 'Source of the book balance',
  sections: {
    bookReceiptsNotOnStatement: 'Add: book receipts not on the statement',
    bookPaymentsNotOnStatement: 'Less: book payments not on the statement',
    statementDepositsNotInBook: 'Add: statement deposits not in the book',
    statementWithdrawalsNotInBook:
      'Less: statement withdrawals not in the book',
  },
  total: 'Total',
  adjustedBank: 'Adjusted bank balance',
  adjustedBook: 'Adjusted book balance',
  difference: 'Unexplained difference (adjusted bank − adjusted book)',
  origins: {
    unmatched: 'Unmatched',
    rejected: 'Rejected case',
    pending: 'Awaiting your decision',
    carried: 'Carried',
  },
  itemHeaders: [
    'Side',
    'ID',
    'Period',
    'Page or row',
    'Date',
    'Reference',
    'Amount',
    'Amount minor units',
    'Origin',
    'Origin code',
    'Case',
    'Reason',
    'Age in period ends',
    'Source SHA256',
  ],
  sides: { statement: 'Statement', cashbook: 'Book' },
  prepared: 'Prepared by',
  reviewed: 'Reviewed by',
  signoffDate: 'Date',
  signoffVoid: 'Given on an earlier sheet; no longer current',
  signoffValid: 'Current on this sheet',
  screen: {
    intro:
      "Enter the bank account's balance in your books at the statement period end to build the sheet. It lists every item not cleared and never hides a difference with a balancing entry or a tolerance.",
    balance: 'Book balance at the period end',
    balanceHint:
      'In the statement currency and its decimals. Positive: a debit balance, funds held. Negative: a credit balance, an overdraft. You declare it; it is not read from a file.',
    note: 'Its source (optional)',
    language: "Language of the sheet's labels in Excel",
    languages: { ar: 'العربية', en: 'English' },
    apply: 'Build the sheet',
    invalid: {
      book: "The book balance is not an amount in the statement currency's decimals.",
      note: 'A source needs a balance, and at most 200 characters without control characters.',
    },
    declared: (note: string) =>
      note
        ? `Declared by the accountant: ${note}`
        : 'Declared by the accountant, no source given',
    signoffs: 'Preparation and review',
    signHint:
      'A name and a date you type, bound to the content of the sheet shown now. If a balance, item or decision changes afterwards, they become void and are shown as void.',
    name: 'Name',
    sign: { prepared: 'Record preparation', reviewed: 'Record review' },
    none: 'Not recorded',
    bridgeHeaders: ['Item', 'Amount', 'Basis'],
    count: (n: number) =>
      n === 0 ? 'No items' : n === 1 ? '1 item' : `${n} items`,
    itemHeaders: [
      'Side',
      'ID',
      'Period',
      'Page or row',
      'Date',
      'Reference',
      'Direction',
      'Amount',
      'Origin',
      'Case',
      'Reason',
      'Age in period ends',
    ],
  },
  tolerance: {
    policy: 'Declared tolerance: per pair, per period, and its reason',
    headers: [
      'Direction',
      'Case',
      'Statement movement',
      'Cashbook entry',
      'Statement amount',
      'In minor units',
      'Cashbook amount',
      'In minor units',
      'Effect on the difference',
      'In minor units',
    ],
    section: 'Differences within the declared tolerance (their effect)',
    directions: { in: 'Receipt', out: 'Payment' },
    unexplained: 'Unexplained rest (difference − tolerated)',
    claim:
      'The tolerance is declared by the accountant; every case it clears is listed with both amounts and its effect, and it changes no amount and hides no unexplained rest.',
  },
  claim:
    'Bank balance from the proved printed statement; book balance declared by the accountant; items from the matching result and the recorded decisions only. Not proof that the books are complete, not a professional opinion, not an approval of the items. Prepared and reviewed are text fields, not a digital signature or an identity check.',
};
export const bankSheetCopy = { ar, en };
export type BankSheetCopy = Copy;
