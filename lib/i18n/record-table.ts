// The words of the shared evidence table (UX-3): its pages, its frame and
// the line that stands for it when it has no row; and the line that names
// the empty sections of a result together (UX-4).
const en = {
  previous: 'Previous page',
  next: 'Next page',
  pages: (label: string) => `Pages of ${label}`,
  status: (page: number, pages: number, from: number, to: number, of: number) =>
    `Page ${page} of ${pages} · rows ${from}–${to} of ${of}`,
  wide: (label: string) => `${label}, wider than its frame: scroll inside it`,
  rowsOf: (source: string) => `Rows of ${source}`,
  none: (label: string) => `${label}: none`,
  // The one line that names the empty sections of a result (UX-4).
  nothing: 'none',
  nothingIn: 'Nothing in',
};

const ar: typeof en = {
  previous: 'الصفحة السابقة',
  next: 'الصفحة التالية',
  pages: (label) => `صفحات ${label}`,
  status: (page, pages, from, to, of) =>
    `الصفحة ${page} من ${pages} · الصفوف ${from}–${to} من ${of}`,
  wide: (label) => `${label}، أعرض من إطاره: مرّر داخله`,
  rowsOf: (source) => `صفوف ${source}`,
  none: (label) => `${label}: لا شيء`,
  nothing: 'لا شيء',
  nothingIn: 'لا شيء في',
};

export const recordTableCopy = { en, ar };
