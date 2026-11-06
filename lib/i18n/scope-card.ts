// The card «ما فهمناه من ملفاتك» (UX-5(d)): what the files say about the
// declared scope, each value with where it came from, and one confirmation.
export const scopeCardCopy = {
  ar: {
    title: 'ما فهمناه من ملفاتك',
    fields: 'الحقول ومن أين جاءت',
    // Each source that has the column, with the rows read in it.
    fromFile: (header: string, read: { label: string; rows: number }[]) =>
      `من الملف: العمود ${header} · ${read.map((r) => `${r.label}: الصفوف ${r.rows}`).join(' · ')}`,
    byDefault: 'افتراضي، ليس في الملفات',
    fromYou: 'من إدخالك',
    fromHandoff: 'من المقارنة التي جئت منها',
    fromHandoffSame: (
      header: string,
      read: { label: string; rows: number }[],
    ) =>
      `من المقارنة التي جئت منها، ومثلها في الملف: العمود ${header} · ${read.map((r) => `${r.label}: الصفوف ${r.rows}`).join(' · ')}`,
    fromHandoffOther: 'من المقارنة التي جئت منها، وفي الملفات غيرها',
    differs: 'لم تتفق الصفوف، فاكتب القيمة',
    blank: 'العمود فارغ في الملفات، فاكتب القيمة',
    absent: 'ليس في الملفات، فاكتب القيمة',
    unusable: (value: string) =>
      `في الملفات «${value}»، وهذا الحقل لا يقبلها، فاكتب القيمة`,
    onlyShown:
      'في الملفات غير القيمة المعروضة، وهذه المقارنة لا تقبل غيرها، فصحح الملفات',
    quote: (value: string) => `«${value || 'فارغ'}»`,
    valueIn: (source: string, rows: number) => `في ${source}: ${rows}`,
    unknown: '؟',
  },
  en: {
    title: 'What we understood from your files',
    fields: 'Fields and where they come from',
    fromFile: (header: string, read: { label: string; rows: number }[]) =>
      `From the file: column ${header} · ${read.map((r) => `${r.label}: rows ${r.rows}`).join(' · ')}`,
    byDefault: 'Default, not in the files',
    fromYou: 'Your entry',
    fromHandoff: 'From the comparison you came from',
    fromHandoffSame: (
      header: string,
      read: { label: string; rows: number }[],
    ) =>
      `From the comparison you came from, and the same in the file: column ${header} · ${read.map((r) => `${r.label}: rows ${r.rows}`).join(' · ')}`,
    fromHandoffOther:
      'From the comparison you came from; the files hold something else',
    differs: 'The rows disagree, so enter the value',
    blank: 'The column is empty in the files, so enter the value',
    absent: 'Not in the files, so enter the value',
    unusable: (value: string) =>
      `The files hold “${value}”, which this field does not take, so enter the value`,
    onlyShown:
      'The files hold something other than the value shown, and this comparison takes only that value, so correct the files',
    quote: (value: string) => `“${value || 'empty'}”`,
    valueIn: (source: string, rows: number) => `in ${source}: ${rows}`,
    unknown: '?',
  },
};
