import { useEffect, useId, useRef, useState } from 'react';
import { pageOfRow } from '@/lib/record-page';

type Row = { table: string; at: number };

// The event a thread sends as its drawer opens, naming its own id.
const OPENED = 'evidence-thread-opened';

/**
 * The evidence thread of a workspace (UX-10): which row of which result
 * table has its drawer open, the focus that follows opening it and the way
 * back, and each table's page, so that the way back returns to the row's own
 * page. One drawer at a time: another row replaces it, and opening it
 * closes the drawer of any other thread on the page, such as that of the
 * table above a section panel, with no focus moved. It closes when the
 * workspace is hidden (`shown` false) and when the result changes, so no
 * evidence of an older result stays in view. A row is named by its table and
 * its index in that table.
 */
export function useEvidenceThread(shown: boolean, result: unknown) {
  const [open, setOpen] = useState<Row | null>(null),
    [pages, setPages] = useState<Record<string, number>>({}),
    [seen, setSeen] = useState({ shown, result }),
    [focus, setFocus] = useState<(Row & { to: 'drawer' | 'row' }) | null>(
      null,
    );
  if (seen.shown !== shown || seen.result !== result) {
    setSeen({ shown, result });
    setOpen(null);
    if (seen.result !== result) setPages({});
  }
  const heading = useRef<HTMLHeadingElement>(null),
    id = `evidence-thread-${useId().replace(/:/g, '')}`,
    key = (table: string, at: number) => `${id}-${table}-${at}`,
    isOpen = (table: string, at: number) =>
      open?.table === table && open.at === at;
  useEffect(() => {
    const other = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(null);
    };
    document.addEventListener(OPENED, other);
    return () => document.removeEventListener(OPENED, other);
  }, [id]);
  useEffect(() => {
    if (!focus) return;
    const element =
      focus.to === 'drawer'
        ? heading.current
        : document.querySelector<HTMLElement>(
            `[data-thread-way="${id}-${focus.table}-${focus.at}"]`,
          );
    if (focus.to === 'row') element?.scrollIntoView({ block: 'center' });
    element?.focus({ preventScroll: true });
  }, [focus, id]);
  return {
    open,
    id,
    heading,
    paging: (table: string) => ({
      page: pages[table] ?? 0,
      onPage: (to: number) => setPages((p) => ({ ...p, [table]: to })),
    }),
    show: (table: string, at: number) => {
      document.dispatchEvent(new CustomEvent(OPENED, { detail: id }));
      setOpen({ table, at });
      setFocus({ table, at, to: 'drawer' });
    },
    back: () => {
      if (!open) return;
      setPages((p) => ({ ...p, [open.table]: pageOfRow(open.at) }));
      setFocus({ ...open, to: 'row' });
      setOpen(null);
    },
    way: (table: string, at: number) => ({
      'data-thread-way': key(table, at),
      'aria-expanded': isOpen(table, at),
      'aria-controls': isOpen(table, at) ? id : undefined,
    }),
    mark: (table: string, at: number) =>
      isOpen(table, at) ? { 'data-thread-open': '' } : undefined,
  };
}
