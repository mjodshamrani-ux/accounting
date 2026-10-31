import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
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
  size,
  hook,
}: {
  label: string;
  length: number;
  page: number;
  onPage: (page: number) => void;
  size?: number;
  hook?: RecordHook;
}) {
  const { lang } = useI18n();
  const copy = recordTableCopy[lang];
  const status = useId();
  const previous = useRef<HTMLButtonElement>(null),
    next = useRef<HTMLButtonElement>(null);
  const { pages, at, from, to } = recordPage(length, page, size);
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

/** The frame of a record table. A table wider than it scrolls inside it,
 * and the frame then becomes a region the keyboard reaches, named after the
 * table and saying that it scrolls, with the side where columns lie out of
 * view marked for its shade. A table the kit does not draw keeps its own
 * look and takes the same frame with its own `className`. */
export function RecordFrame({
  name,
  className = 'record-frame',
  style,
  hook,
  children,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
  hook?: RecordHook;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  const copy = recordTableCopy[lang];
  const box = useRef<HTMLDivElement>(null);
  const wider = useWider(box);
  return (
    <div
      ref={box}
      className={className}
      style={style}
      {...hook}
      {...(wider
        ? { role: 'region', tabIndex: 0, 'aria-label': copy.wide(name) }
        : {})}
    >
      {children}
    </div>
  );
}

const focusTarget = (id: string | undefined) =>
  id === undefined ? {} : { id, tabIndex: -1, 'data-decision-item': '' };

type RecordName =
  | { label: string; source?: never }
  | { source: string; label?: never };
type RecordPaging = {
  page?: number;
  onPage?: (page: number) => void;
  size?: number;
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
 * row holds the page with `page` and `onPage`, and a table whose rows are
 * much taller or shorter than most keeps the page size it has always had
 * with `size`. A table of the rows read from a source is named after the
 * source with `source`, apart from the source's own file input; `rowHeader`
 * names the column whose cell heads its row. A row a decision acts on is
 * named by `target`, so that the focus returns to it after the decision
 * (UX-3): it then holds that id and takes the focus from script, not from
 * the keyboard. */
export function RecordRows<T>({
  label,
  source,
  headers,
  rows,
  cells,
  mark,
  rowHeader,
  target,
  page,
  onPage,
  size,
  pager,
  frame,
}: RecordName &
  RecordPaging & {
    headers: readonly ReactNode[];
    rows: readonly T[];
    cells: (row: T, index: number) => ReactNode[];
    mark?: (row: T, index: number) => RecordHook | undefined;
    rowHeader?: number;
    target?: (row: T, index: number) => string | undefined;
  }) {
  const { lang } = useI18n();
  const copy = recordTableCopy[lang];
  const name = label ?? copy.rowsOf(source);
  const [own, setOwn] = useState(0);
  const at = page ?? own;
  const { from, to } = recordPage(rows.length, at, size);
  return (
    <>
      <RecordFrame name={name} hook={frame}>
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
              <tr
                key={from + i}
                {...mark?.(row, from + i)}
                {...focusTarget(target?.(row, from + i))}
              >
                {cells(row, from + i).map((cell, j) => {
                  const shown =
                    typeof cell === 'string' || typeof cell === 'number' ? (
                      <bdi>{cell}</bdi>
                    ) : (
                      (cell ?? '—')
                    );
                  return j === rowHeader ? (
                    <th key={j} scope="row">
                      {shown}
                    </th>
                  ) : (
                    <td key={j}>{shown}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </RecordFrame>
      <RecordPager
        label={name}
        length={rows.length}
        page={at}
        onPage={onPage ?? setOwn}
        size={size}
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
