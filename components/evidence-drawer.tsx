import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { RecordRows } from '@/components/record-table';
import { evidenceThreadCopy } from '@/lib/i18n/evidence-thread';
import { useI18n } from '@/lib/i18n/context';
import type {
  Thread,
  ThreadCell,
  ThreadPlace,
  ThreadSource,
} from '@/lib/evidence-thread';
import './evidence-drawer.css';

/**
 * The evidence thread (UX-10): the sources the engine names for one row of a
 * result, in a drawer fixed at the inline end of the screen, and below
 * 1024 px a sheet from its bottom. It sits over the page and not in it, so
 * opening and closing it moves nothing. It is not modal: the page stays
 * readable and scrollable, and the focus is not held. It comes in the page
 * order after the table that opened it.
 *
 * Opening it takes the focus to its heading, which the workspace passes as
 * `headingRef`. The way back, by its button or by Escape inside it, closes it
 * and returns the focus to the row: `onBack` does both, since only the
 * workspace knows the row's page. The workspace closes it on a new run, a
 * restored session, a changed file or scope, and a change of type, so no
 * evidence of an older result stays in view. The design record is
 * docs/audits/UX-10-EVIDENCE-THREAD.ar.md.
 */
export function EvidenceDrawer({
  id,
  heading,
  headingRef,
  back,
  onBack,
  amount,
  children,
}: {
  id: string;
  heading: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  back: string;
  onBack: () => void;
  /** The row's amount as the table shows it, when the row has one. */
  amount?: ReactNode;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  const copy = evidenceThreadCopy[lang];
  // Escape inside the drawer is its way back. The listener reads the latest
  // way back, so it is added once for each drawer.
  const drawer = useRef<HTMLElement>(null),
    back$ = useRef(onBack);
  useEffect(() => {
    back$.current = onBack;
  });
  useEffect(() => {
    const element = drawer.current;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      back$.current();
    };
    element?.addEventListener('keydown', escape);
    return () => element?.removeEventListener('keydown', escape);
  }, []);
  return (
    <section
      ref={drawer}
      id={id}
      className="evidence-drawer"
      aria-labelledby={`${id}-heading`}
      data-evidence-drawer=""
    >
      <h2 id={`${id}-heading`} ref={headingRef} tabIndex={-1}>
        {heading}
      </h2>
      <Button variant="outline" onClick={onBack}>
        {back}
      </Button>
      {amount !== undefined && (
        <p className="evidence-drawer__amount">
          {copy.amount}: {amount}
        </p>
      )}
      {children}
    </section>
  );
}

const placeText = (
  place: ThreadPlace,
  copy: (typeof evidenceThreadCopy)['en'],
) =>
  'row' in place
    ? `${copy.row} ${place.row}`
    : `${copy.page} ${place.page}${copy.separator}${copy.line} ${place.line}`;

/**
 * Each source of a thread: its role, file, sheet and place, then its cells
 * as the reader recorded them, the column, its header and the original text,
 * isolated so that mixed scripts keep their order. Nothing is computed or
 * read again here. A source whose cell texts the result does not keep says
 * so, and shows its place alone.
 */
export function ThreadSources({
  thread,
  role,
  field = (c) => c.field,
  extra,
}: {
  thread: Thread;
  /** The source's role, in the workspace's words. */
  role: (source: ThreadSource) => ReactNode;
  /** A cell's header, in the workspace's words. */
  field?: (cell: ThreadCell) => ReactNode;
  /** A column the workspace adds to each cell. */
  extra?: { header: ReactNode; cell: (cell: ThreadCell) => ReactNode };
}) {
  const { lang } = useI18n();
  const copy = evidenceThreadCopy[lang];
  return thread.map((s, i) => {
    const place = placeText(s.place, copy);
    return (
      <section
        key={i}
        className="evidence-drawer__source"
        data-thread-source={s.source}
      >
        <h3>{role(s)}</h3>
        <dl className="evidence-drawer__place">
          <div>
            <dt>{copy.file}</dt>
            <dd>
              <bdi>{s.name}</bdi>
            </dd>
          </div>
          {s.sheet && (
            <div>
              <dt>{copy.sheet}</dt>
              <dd>
                <bdi>{s.sheet}</bdi>
              </dd>
            </div>
          )}
          {'row' in s.place ? (
            <div>
              <dt>{copy.row}</dt>
              <dd data-thread-row={s.place.row}>{s.place.row}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>{copy.page}</dt>
                <dd>{s.place.page}</dd>
              </div>
              <div>
                <dt>{copy.line}</dt>
                <dd>{s.place.line}</dd>
              </div>
            </>
          )}
        </dl>
        {s.cells ? (
          <RecordRows
            label={copy.cellsOf(s.name, place)}
            headers={[
              copy.header,
              copy.column,
              copy.original,
              ...(extra ? [extra.header] : []),
            ]}
            rows={s.cells}
            cells={(c) => [
              field(c),
              c.column,
              c.text,
              ...(extra ? [extra.cell(c)] : []),
            ]}
            wrap={[2]}
          />
        ) : (
          <p className="evidence-drawer__missing">{copy.notKept}</p>
        )}
      </section>
    );
  });
}
