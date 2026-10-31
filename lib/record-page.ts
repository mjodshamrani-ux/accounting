// Which rows of an evidence table one page shows. Fifty rows a page, as every
// table in the workspaces has shown; a table whose rows are much taller or
// shorter keeps the size it has always had (`size`). A page past the end,
// after the rows shrink, shows the last one. Display only: rows are never
// cut, reordered or counted here for any total.
export const RECORD_PAGE = 50;

export function recordPage(length: number, page: number, size = RECORD_PAGE) {
  const pages = Math.max(1, Math.ceil(length / size));
  const at = Math.min(Math.max(0, Math.trunc(page) || 0), pages - 1);
  return {
    pages,
    at,
    from: at * size,
    to: Math.min(length, (at + 1) * size),
  };
}

/** The page that shows row `index`, to return the reader to that row. */
export function pageOfRow(index: number, size = RECORD_PAGE) {
  return Math.floor(Math.max(0, index) / size);
}
