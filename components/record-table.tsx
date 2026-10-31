import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { recordTableCopy } from '@/lib/i18n/record-table';
import { recordPage } from '@/lib/record-page';

/** Data attributes a check reads on a pager, a frame or a row. */
export type RecordHook = Record<`data-${string}`, string | undefined>;

/** Turns the pages of one evidence table, and is absent when its rows fit
 * one page. Both buttons are described by the line that names the page and
 * the rows shown, so a closed button says why it is closed; when the first
 * or the last page closes the pressed button, the focus moves to the other
 * button instead of falling to the page. */
export function RecordPager({
  label,
  length,
  page,
  onPage,
  hook,
}: {
  label: string;
  length: number;
  page: number;
  onPage: (page: number) => void;
  hook?: RecordHook;
}) {
  const { lang } = useI18n();
  const copy = recordTableCopy[lang];
  const status = useId();
  const previous = useRef<HTMLButtonElement>(null),
    next = useRef<HTMLButtonElement>(null);
  const { pages, at, from, to } = recordPage(length, page);
  if (pages <= 1) return null;
  const turn = (target: number) => {
    onPage(target);
    if (target === 0) next.current?.focus();
    else if (target === pages - 1) previous.current?.focus();
  };
  return (
    <nav className="record-pager" aria-label={copy.pages(label)} {...hook}>
      <Button
        ref={previous}
        variant="outline"
        disabled={!at}
        aria-describedby={status}
        onClick={() => turn(at - 1)}
      >
        {copy.previous}
      </Button>
      <output id={status}>
        {copy.status(at + 1, pages, from + 1, to, length)}
      </output>
      <Button
        ref={next}
        variant="outline"
        disabled={at + 1 >= pages}
        aria-describedby={status}
        onClick={() => turn(at + 1)}
      >
        {copy.next}
      </Button>
    </nav>
  );
}

// Whether the table is wider than its frame, and on which side columns lie
// out of view. The side is read from where the table sits against the
// frame, so it holds in either reading direction, and is marked on the frame
// itself (data-more-left, data-more-right) as the reader scrolls, without
// drawing the table again. Measured again whenever the frame or the table
// changes size.
function useWider(box: { readonly current: HTMLDivElement | null }) {
  const [wider, setWider] = useState(false);
  useEffect(() => {
    const frame = box.current;
    const table = frame?.firstElementChild;
    if (!frame || !table) return;
    const measure = () => {
      const left = frame.getBoundingClientRect().left + frame.clientLeft,
        right = left + frame.clientWidth,
        inner = table.getBoundingClientRect();
      frame.toggleAttribute('data-more-left', inner.left < left - 1);
      frame.toggleAttribute('data-more-right', inner.right > right + 1);
      setWider(frame.scrollWidth > frame.clientWidth + 1);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(frame);
    watch.observe(table);
    frame.addEventListener('scroll', measure, { passive: true });
    return () => {
      watch.disconnect();
      frame.removeEventListener('scroll', measure);
    };
  }, [box]);
  return wider;
}

type RecordName =
  | { label: string; source?: never }
  | { source: string; label?: never };
type RecordPaging = {
  page?: number;
  onPage?: (page: number) => void;
  pager?: RecordHook;
  frame?: RecordHook;
};

/** One evidence table of the record kit (UX-3): named, framed and paged.
 * Only the rows of the page shown are drawn: `cells` and `mark` run for
 * those rows alone, with each row's index in the whole table. A cell of
 * plain text is isolated, so a reference or a number keeps its own
 * direction; an element isolates itself where it needs to, and a missing
 * value reads as a dash. A table wider than its frame scrolls inside it:
 * the frame then takes the keyboard and says so, and a shade at either edge
 * shows that columns continue. A workspace that must return the reader to a
 * row holds the page with `page` and `onPage`. A table of the rows read
 * from a source is named after the source with `source`, apart from the
 * source's own file input. */
export function RecordRows<T>({
  label,
  source,
  headers,
  rows,
  cells,
  mark,
  page,
  onPage,
  pager,
  frame,
}: RecordName &
  RecordPaging & {
    headers: readonly ReactNode[];
    rows: readonly T[];
    cells: (row: T, index: number) => ReactNode[];
    mark?: (row: T, index: number) => RecordHook | undefined;
  }) {
  const { lang } = useI18n();
  const copy = recordTableCopy[lang];
  const name = label ?? copy.rowsOf(source);
  const [own, setOwn] = useState(0);
  const at = page ?? own;
  const { from, to } = recordPage(rows.length, at);
  const box = useRef<HTMLDivElement>(null);
  const wider = useWider(box);
  return (
    <>
      <div
        ref={box}
        className="record-frame"
        {...frame}
        {...(wider
          ? { role: 'region', tabIndex: 0, 'aria-label': copy.wide(name) }
          : {})}
      >
        <table aria-label={name}>
          <thead>
            <tr>
              {headers.map((header, i) => (
                <th key={i} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(from, to).map((row, i) => (
              <tr key={from + i} {...mark?.(row, from + i)}>
                {cells(row, from + i).map((cell, j) => {
                  const shown =
                    typeof cell === 'string' || typeof cell === 'number' ? (
                      <bdi>{cell}</bdi>
                    ) : (
                      (cell ?? '—')
                    );
                  return <td key={j}>{shown}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RecordPager
        label={name}
        length={rows.length}
        page={at}
        onPage={onPage ?? setOwn}
        hook={pager}
      />
    </>
  );
}

const asCells = (row: ReactNode[]) => row;

/** A record table whose rows are already written as cells, with the data
 * attributes of each row, by its index in the table, in `marks`. */
export function RecordTable({
  marks,
  ...table
}: RecordName &
  RecordPaging & {
    headers: readonly ReactNode[];
    rows: ReactNode[][];
    marks?: (RecordHook | undefined)[];
  }) {
  return (
    <RecordRows<ReactNode[]>
      {...table}
      cells={asCells}
      mark={marks && ((_, index) => marks[index])}
    />
  );
}
