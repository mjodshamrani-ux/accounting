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
    statementWithdrawalsNotInBook: 'Less: statement withdrawals not in the book',
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
  claim:
    'Bank balance from the proved printed statement; book balance declared by the accountant; items from the matching result and the recorded decisions only. Not proof that the books are complete, not a professional opinion, not an approval of the items. Prepared and reviewed are text fields, not a digital signature or an identity check.',
};
export const bankSheetCopy = { ar, en };
export type BankSheetCopy = Copy;
