import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { SourceFile } from '../lib/reconciliation/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { useI18n } from '@/lib/i18n/context';

const format = (cuts: number[]) => cuts.join(', ');
// Accept either comma, the Arabic comma, or spaces between the boundaries.
function parseCuts(text: string): number[] | null {
  const parts = text
    .split(/[,،\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const values = parts.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values;
}

class OriginalPdfUrl {
  private value = '';
  constructor(private original: ArrayBuffer) {}
  getSnapshot = () => this.value;
  subscribe = (notify: () => void) => {
    const value = URL.createObjectURL(
      new Blob([this.original], { type: 'application/pdf' }),
    );
    this.value = value;
    notify();
    return () => {
      if (this.value === value) this.value = '';
      URL.revokeObjectURL(value);
    };
  };
}

export function PdfReview({
  file,
  header,
  reviewed,
  onReviewedChange,
  onApply,
  onDraftChange,
}: {
  file: SourceFile;
  header: number;
  reviewed: boolean;
  onReviewedChange: (value: boolean) => void;
  onApply: (cuts: number[]) => void;
  onDraftChange: (pending: boolean) => void;
}) {
  const { t, engineText } = useI18n();
  const r = t.pdfReview;
  const applied = file.pdf!.cuts;
  const [cuts, setCuts] = useState(format(applied));
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState('1');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState({ file, page, header });
  if (reading.file !== file) {
    setReading({ file, page: 1, header });
    setPage(1);
    setPageDraft('1');
    setOffset(0);
    setOpen(false);
    setCuts(format(applied));
  } else if (reading.page !== page || reading.header !== header) {
    setReading({ file, page, header });
    setOffset(0);
    if (reading.page !== page) setPageDraft(String(page));
  }
  const originalUrl = useMemo(
    () => new OriginalPdfUrl(file.original!),
    [file.original],
  );
  const url = useSyncExternalStore(
    originalUrl.subscribe,
    originalUrl.getSnapshot,
    () => '',
  );
  const sheet = file.sheets[0];
  const rowsByPage = useMemo(() => {
    const pages = new Map<number, { row: string[]; rn: number }[]>();
    sheet.rows.forEach((row, i) => {
      const rn = i + 1;
      const rowPage = sheet.rowPages?.[String(rn)];
      if (rowPage === undefined || rn <= header + 1) return;
      const rows = pages.get(rowPage) ?? [];
      rows.push({ row, rn });
      pages.set(rowPage, rows);
    });
    return pages;
  }, [sheet, header]);
  const rows = rowsByPage.get(page) ?? [];
  const requestedPage = Number(pageDraft);
  const validPage =
    /^\d+$/.test(pageDraft) &&
    Number.isSafeInteger(requestedPage) &&
    requestedPage >= 1 &&
    requestedPage <= file.pdf!.pages;
  const jumpToPage = () => {
    if (validPage) setPage(requestedPage);
  };
  // Derived from the text in the field, never from a flag that only a reload
  // clears: retyping the applied value leaves nothing pending.
  const parsed = parseCuts(cuts);
  const pending = !parsed || format(parsed) !== format(applied);
  useEffect(() => {
    onDraftChange(pending);
  }, [pending, onDraftChange]);
  const flagged = useMemo(
    () =>
      Object.entries(sheet.rowIssues ?? {}).filter(
        ([rn]) => Number(rn) > header + 1,
      ),
    [sheet, header],
  );
  return (
    <div className="panel stack">
      <div className="summary-head">
        <div>
          <strong>{r.heading}</strong>
          <p className="hint">
            {r.pages(file.pdf!.pages)}{' '}
            {!applied.length
              ? r.singleColumn
              : file.pdf?.autoColumns
                ? r.autoColumns(applied.length + 1)
                : r.chosenColumns(applied.length + 1)}
            {flagged.length > 0
              ? r.flaggedRows(flagged.length)
              : r.noFlaggedRows}
          </p>
        </div>
        <a
          className="inline-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {r.openOriginal}
        </a>
      </div>
      <details open>
        <summary>{r.tableSummary}</summary>
        <div className="preview" style={{ maxHeight: 240 }}>
          <table>
            <thead>
              <tr>
                <th>{r.rowColumn}</th>
                {Array.from({ length: applied.length + 1 }, (_, i) => (
                  <th key={i}>{sheet.rows[header]?.[i] || r.column(i + 1)}</th>
                ))}
                <th>{r.noteColumn}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(offset, offset + 50).map(({ row, rn }) => (
                <tr key={rn}>
                  <td>{rn}</td>
                  {row.map((text, i) => (
                    <td key={i}>
                      <bdi style={{ whiteSpace: 'pre-wrap' }}>{text}</bdi>
                    </td>
                  ))}
                  <td>
                    {rn < header + 1
                      ? r.beforeTable
                      : rn === header + 1
                        ? r.headerRow
                        : (sheet.rowIssues?.[String(rn)]
                            ?.map(engineText)
                            .join(t.common.listSeparator) ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="actions">
          {file.pdf!.pages > 1 && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {r.previousPage}
              </Button>
              <span className="muted">{r.pageOf(page, file.pdf!.pages)}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= file.pdf!.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {r.nextPage}
              </Button>
              <label className="field">
                <span>{r.jumpPage}</span>
                <Input
                  type="number"
                  min={1}
                  max={file.pdf!.pages}
                  step={1}
                  dir="ltr"
                  aria-label={r.jumpPage}
                  aria-invalid={!!pageDraft && !validPage}
                  value={pageDraft}
                  style={{ width: 90 }}
                  onChange={(event) => setPageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      jumpToPage();
                    }
                  }}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={!validPage || requestedPage === page}
                onClick={jumpToPage}
              >
                {r.goToPage}
              </Button>
            </>
          )}
          {rows.length > 50 && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 50))}
              >
                {r.previousRows}
              </Button>
              <span className="muted">
                {r.rangeOf(
                  offset + 1,
                  Math.min(offset + 50, rows.length),
                  rows.length,
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 50 >= rows.length}
                onClick={() => setOffset((n) => n + 50)}
              >
                {r.nextRows}
              </Button>
            </>
          )}
          <button
            type="button"
            className="inline-link"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? r.hideCuts : r.editCuts}
          </button>
        </div>
        {open && (
          <div className="stack">
            <label className="field">
              <span>{r.cutsField}</span>
              <Input
                aria-label={r.cutsLabel}
                dir="ltr"
                placeholder="25, 45, 65"
                value={cuts}
                onChange={(e) => setCuts(e.target.value)}
              />
            </label>
            <p className="hint">{r.cutsHint}</p>
            <div className="actions">
              <Button
                variant="outline"
                size="sm"
                disabled={!pending || !parsed}
                onClick={() => parsed && onApply(parsed)}
              >
                {r.applyCuts}
              </Button>
              {pending && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCuts(format(applied))}
                >
                  {r.undoCuts}
                </Button>
              )}
              {!parsed && <span className="hint warn">{r.cutsInvalid}</span>}
              {parsed && pending && (
                <span className="hint">{r.cutsPending}</span>
              )}
            </div>
          </div>
        )}
      </details>
      <label className="checkline">
        <Checkbox checked={reviewed} onCheckedChange={onReviewedChange} />
        <span>{r.reviewed}</span>
      </label>
    </div>
  );
}
