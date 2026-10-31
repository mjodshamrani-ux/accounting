// The words of the shared evidence table (UX-3): its pages and its frame.
const en = {
  previous: 'Previous page',
  next: 'Next page',
  pages: (label: string) => `Pages of ${label}`,
  status: (page: number, pages: number, from: number, to: number, of: number) =>
    `Page ${page} of ${pages} · rows ${from}–${to} of ${of}`,
  wide: (label: string) => `${label}, wider than its frame: scroll inside it`,
  rowsOf: (source: string) => `Rows of ${source}`,
};

const ar: typeof en = {
  previous: 'الصفحة السابقة',
  next: 'الصفحة التالية',
  pages: (label) => `صفحات ${label}`,
  status: (page, pages, from, to, of) =>
    `الصفحة ${page} من ${pages} · الصفوف ${from}–${to} من ${of}`,
  wide: (label) => `${label}، أعرض من إطاره: مرّر داخله`,
  rowsOf: (source) => `صفوف ${source}`,
};

export const recordTableCopy = { en, ar };
