import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReconciliationSheet } from '@/lib/reconciliation/reconciliation-sheet';
import { sheetPrint, type PrintCell } from '@/lib/reconciliation/sheet-print';
import './reconciliation-sheet-print.css';

function Cell({ cell }: { cell: PrintCell }) {
  const span = cell.span > 1 ? cell.span : undefined;
  if (cell.kind === 'text')
    return (
      <td colSpan={span} data-sheet-style={cell.style}>
        {cell.style === 'hash' ? <bdi dir="ltr">{cell.text}</bdi> : cell.text}
      </td>
    );
  if (cell.kind === 'amount')
    return (
      <td data-sheet-amount={cell.start ? 'start' : ''}>
        <bdi dir="ltr">{cell.text}</bdi>
      </td>
    );
  if (cell.kind === 'count') return <td data-sheet-count="">{cell.text}</td>;
  // Empty cells say nothing, as in the workbook; the table is never shown
  // on the screen nor read there.
  if (cell.kind === 'line') return <td data-sheet-line="">{''}</td>;
  return <td colSpan={span}>{''}</td>;
}

/**
 * The reconciliation sheet on paper (UX-6(d)): the model the workbook's
 * first sheet is written from, laid out row for row and cell for cell. It is
 * never drawn on the screen; in print it is all that prints (see
 * `reconciliation-sheet-print.css`).
 */
export function SheetPrint({ sheet }: { sheet: ReconciliationSheet | null }) {
  if (!sheet) return null;
  const paper = sheetPrint(sheet);
  return (
    <div
      className="sheet-print"
      data-sheet-print=""
      lang={paper.language}
      dir={paper.language === 'ar' ? 'rtl' : 'ltr'}
    >
      <table>
        <colgroup>
          {paper.widths.map((w, i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        {paper.groups.map((group, g) => (
          <tbody key={g} data-sheet-keep={group.keep ? '' : undefined}>
            {group.rows.map((row, r) =>
              row.length ? (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <Cell key={c} cell={cell} />
                  ))}
                </tr>
              ) : (
                <tr key={r} data-sheet-blank="">
                  <td colSpan={paper.widths.length}>{''}</td>
                </tr>
              ),
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/**
 * The sheet of the result on the screen, composed on the page by the same
 * function the worker writes the workbook's first sheet with. It belongs to
 * the result and language it was composed for, and is given only while they
 * are the ones shown: none while there is no result, and a composition that
 * arrives late for a result no longer shown is dropped. `compose` is defined
 * once, outside the component. `print` waits for the composition, then
 * prints.
 */
export function useSheetPrint<R>(
  result: R | null | undefined,
  language: 'ar' | 'en',
  compose: (result: R, language: 'ar' | 'en') => Promise<ReconciliationSheet>,
) {
  const [composed, setComposed] = useState<{
    result: R;
    language: 'ar' | 'en';
    sheet: ReconciliationSheet;
  } | null>(null);
  const pending = useRef<Promise<ReconciliationSheet | null>>(
    Promise.resolve(null),
  );
  useEffect(() => {
    if (result === null || result === undefined) {
      pending.current = Promise.resolve(null);
      return;
    }
    let current = true;
    pending.current = compose(result, language).then(
      (sheet) => {
        if (!current) return null;
        setComposed({ result, language, sheet });
        return sheet;
      },
      () => null,
    );
    return () => {
      current = false;
    };
  }, [result, language, compose]);
  const sheet =
    composed && composed.result === result && composed.language === language
      ? composed.sheet
      : null;
  const print = useCallback(async () => {
    if (!(await pending.current)) return;
    // The table is drawn before the browser lays the page out for print.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    window.print();
  }, []);
  return { sheet, print };
}
