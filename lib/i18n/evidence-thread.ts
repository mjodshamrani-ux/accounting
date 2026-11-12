// The words of the evidence thread (UX-10): where each source the engine
// names for a row is, and its cells as the reader recorded them. A workspace
// keeps its own words for its heading, its fields and its way back.
const en = {
  // The way in from a row of a comparison table, the drawer's heading and
  // the way back, where the workspace has no words of its own for them.
  way: 'Review source rows',
  heading: 'Source rows',
  back: 'Back to the row in its table',
  file: 'File',
  sheet: 'Sheet',
  row: 'Row',
  page: 'Page',
  line: 'Line',
  separator: ', ',
  amount: 'Amount in the table',
  header: 'Column header',
  column: 'Column',
  original: 'Original text',
  cellsOf: (name: string, place: string) => `Cells of ${name}, ${place}`,
  notKept:
    'The result does not keep the text of this record’s cells. Its place is shown above.',
};

const ar: typeof en = {
  way: 'راجع صفوف المصدر',
  heading: 'صفوف المصدر',
  back: 'عُد إلى الصف في جدوله',
  file: 'الملف',
  sheet: 'الورقة',
  row: 'الصف',
  page: 'الصفحة',
  line: 'السطر',
  separator: '، ',
  amount: 'المبلغ في الجدول',
  header: 'رأس العمود',
  column: 'العمود',
  original: 'النص الأصلي',
  cellsOf: (name: string, place: string) => `خلايا ${name}، ${place}`,
  notKept: 'النتيجة لا تحفظ نصوص خلايا هذا السجل. وموضعه مذكور أعلاه.',
};

export const evidenceThreadCopy = { en, ar };
