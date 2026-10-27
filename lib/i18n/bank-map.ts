// Copy of the cashbook columns (bank-cashbook-map-1, proposed) in the bank
// workspace. Arabic is the source; English has the same keys. A map only
// says where a cashbook's entries are read; it never matches or approves
// anything, and a map that does not fit its file reads nothing.
import type {
  CashbookMapCode,
  CashbookRole,
} from '../reconciliation/bank-cashbook-map.ts';

type Codes = Record<CashbookMapCode, string>;

const arCodes: Codes = {
  MAP_JSON:
    'الملف ليس خريطة: أكبر من 16 كيلوبايت، أو ليس نص UTF-8، أو ليس JSON، أو ليس كائنًا.',
  MAP_FORMAT: 'ليست خريطة أعمدة لدفتر البنك بهذا الإصدار.',
  MAP_KEYS: 'في الخريطة مفتاح ناقص أو زائد، كعملة أو إشارة.',
  MAP_NAME:
    'اسم الخريطة غير صالح: فارغ، أو أطول من 80 حرفًا، أو فيه رمز تحكم، أو في غير شكله العادي.',
  MAP_HEADER: 'صف العناوين خارج الصفوف من 1 إلى 30.',
  MAP_COLUMN:
    'دور إلزامي بلا عمود، أو عمود خارج 1 إلى 100، أو دوران في عمود واحد.',
  MAP_LABEL:
    'عنوان العمود فارغ أو غير صالح: كل دور يُقرأ من عمود له عنوان في صف العناوين.',
};

const enCodes: Codes = {
  MAP_JSON:
    'The file is not a map: larger than 16 KB, not UTF-8 text, not JSON, or not an object.',
  MAP_FORMAT: 'Not a bank cashbook column map of this version.',
  MAP_KEYS: 'The map has a missing or extra key, such as a currency or a sign.',
  MAP_NAME:
    'The map name is not valid: empty, longer than 80 characters, holding a control character, or not in its normal form.',
  MAP_HEADER: 'The header row is outside rows 1 to 30.',
  MAP_COLUMN:
    'A required role has no column, a column is outside 1 to 100, or two roles share a column.',
  MAP_LABEL:
    'A column label is empty or not valid: each role is read from a column with a label in the header row.',
};

const ar = {
  title: 'أعمدة الدفتر',
  intro:
    'رفضت القراءة المعلنة صف العناوين في هذا الدفتر. اختر صف العناوين وعمود كل دور بيدك، أو خريطة محفوظة باسمها. لا يقترح تراصف دورًا من عنوان، ولا يقرأ بخريطة لا تناسب الملف.',
  withColumns: 'يُقرأ هذا الدفتر بالأعمدة المختارة له.',
  claim:
    'الخريطة تقول أين تُقرأ القيود فقط: لا تطابق شيئًا ولا تعتمده، ولا تثبت أن الدفتر لحساب الكشف؛ المطابقة تُظهر ذلك.',
  roles: {
    date: 'التاريخ',
    voucher: 'السند',
    description: 'البيان',
    reference: 'المرجع',
    receipts: 'المقبوضات',
    payments: 'المدفوعات',
  } satisfies Record<CashbookRole, string>,
  optional: '(اختياري)',
  saved: 'خريطة محفوظة',
  map: 'الخريطة',
  chooseMap: 'اختر خريطة',
  noMaps: 'لا خريطة محفوظة على هذا الجهاز.',
  readMap: 'اقرأ بهذه الخريطة',
  exportMap: 'نزّل الخريطة',
  importMap: 'استورد خريطة (JSON)',
  imported: (name: string) => `استُوردت الخريطة: ${name}`,
  refused: 'رُفضت الخريطة ولم يتغير شيء محفوظ.',
  unreadable: (n: number) =>
    `خرائط محفوظة لا تصح فلا تُعرض: ${n}. امسح الخرائط المحفوظة قبل أن تحفظ خريطة أو تستوردها.`,
  clearMaps: 'امسح الخرائط المحفوظة',
  cleared: 'مُسحت الخرائط المحفوظة على هذا الجهاز.',
  full: 'على هذا الجهاز خمسون خريطة، وهو الحد: احفظ باسم موجود ليُستبدل، أو امسح الخرائط المحفوظة.',
  storage: 'تعذرت الكتابة في تخزين هذا المتصفح، فلم يُحفظ شيء.',
  storageNote:
    'تُحفظ الخرائط في تخزين هذا المتصفح على هذا الجهاز وحده، حتى خمسين، خريطة لكل اسم، وتحمل مواضع الأعمدة وعناوينها فقط. ولا يخرج عنها شيء من الجهاز إلا بملف تنزّله أنت.',
  misfit: 'لا تناسب الخريطة هذا الملف، فلم يُقرأ بها شيء:',
  sheets: (count: number) =>
    `في الملف ${count} أوراق، والقراءة بالأعمدة لورقة واحدة.`,
  headerRow: (row: number) => `الملف أقصر من صف العناوين ${row}.`,
  column: (role: string, cell: string, label: string, found: string) =>
    `${role}: في ${cell} «${found || 'لا شيء'}» لا «${label}».`,
  elsewhere: (cells: string[]) =>
    cells.length
      ? `والعنوان المحفوظ في: ${cells.join('، ')}.`
      : 'ولا يوجد العنوان المحفوظ في أول ثلاثين صفًا.',
  hand: 'اختيار باليد',
  header: 'صف العناوين',
  chooseColumn: 'اختر عمودًا',
  notRead: 'لا يُقرأ',
  empty: '(فارغ)',
  preview: (rows: number) => `أول ${rows} صفوف من الملف`,
  previewColumn: 'الصف',
  readHand: 'اقرأ بهذه الأعمدة',
  saveTitle: 'احفظ الأعمدة التي قُرئ بها الدفتر خريطةً',
  name: 'اسم الخريطة',
  save: 'احفظ الخريطة',
  savedAs: (name: string) => `حُفظت الخريطة على هذا الجهاز: ${name}`,
  replaced: (name: string) => `استُبدلت الخريطة المحفوظة بالاسم نفسه: ${name}`,
  change: 'اختر أعمدة أخرى',
  reading: 'يُقرأ الملف لعرض أعمدته…',
  used: 'الأعمدة التي قُرئ بها الدفتر',
  usedHeaders: ['البند', 'العمود', 'العنوان'],
  usedHeader: 'صف العناوين',
  above: 'صفوف فوق العناوين لم تُقرأ',
  unread: 'عمود لم يُقرأ',
  codes: arCodes,
};

const en: typeof ar = {
  title: 'Cashbook columns',
  intro:
    "The declared reading refused this cashbook's header row. Choose the header row and a column for each role by hand, or a saved map by its name. Tarasuf proposes no role from a label, and reads nothing with a map that does not fit the file.",
  withColumns: 'This cashbook is read with the columns chosen for it.',
  claim:
    "A map only says where entries are read: it matches and approves nothing, and does not prove that the cashbook belongs to the statement's account; the matching shows whether it does.",
  roles: {
    date: 'Date',
    voucher: 'Voucher',
    description: 'Description',
    reference: 'Reference',
    receipts: 'Receipts',
    payments: 'Payments',
  },
  optional: '(optional)',
  saved: 'A saved map',
  map: 'Map',
  chooseMap: 'Choose a map',
  noMaps: 'No map is saved on this device.',
  readMap: 'Read with this map',
  exportMap: 'Download the map',
  importMap: 'Import a map (JSON)',
  imported: (name: string) => `Map imported: ${name}`,
  refused: 'The map was refused and nothing saved changed.',
  unreadable: (n: number) =>
    `Saved maps that are not valid and not offered: ${n}. Clear the saved maps before saving or importing a map.`,
  clearMaps: 'Clear the saved maps',
  cleared: 'The saved maps on this device were cleared.',
  full: 'This device holds fifty maps, the limit: save under an existing name to replace it, or clear the saved maps.',
  storage: "This browser's storage could not be written, so nothing was saved.",
  storageNote:
    "Maps are kept in this browser's storage on this device only, at most fifty, one per name, and hold column positions and labels only. Nothing about them leaves the device except a file you download.",
  misfit: 'The map does not fit this file, so nothing was read with it:',
  sheets: (count: number) =>
    `The file has ${count} sheets; a reading with columns reads one.`,
  headerRow: (row: number) => `The file is shorter than header row ${row}.`,
  column: (role: string, cell: string, label: string, found: string) =>
    `${role}: ${cell} holds “${found || 'nothing'}”, not “${label}”.`,
  elsewhere: (cells: string[]) =>
    cells.length
      ? `The saved label is at: ${cells.join(', ')}.`
      : 'The saved label is not in the first thirty rows.',
  hand: 'By hand',
  header: 'Header row',
  chooseColumn: 'Choose a column',
  notRead: 'Not read',
  empty: '(empty)',
  preview: (rows: number) => `The file's first ${rows} rows`,
  previewColumn: 'Row',
  readHand: 'Read with these columns',
  saveTitle: 'Save the columns the cashbook was read with as a map',
  name: 'Map name',
  save: 'Save the map',
  savedAs: (name: string) => `Map saved on this device: ${name}`,
  replaced: (name: string) =>
    `The saved map of the same name was replaced: ${name}`,
  change: 'Choose other columns',
  reading: 'Reading the file to show its columns…',
  used: 'Columns the cashbook was read with',
  usedHeaders: ['Item', 'Column', 'Label'],
  usedHeader: 'Header row',
  above: 'Rows above the header, not read',
  unread: 'Column not read',
  codes: enCodes,
};

export const bankMapCopy = { ar, en };
