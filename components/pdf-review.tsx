import { useEffect, useMemo, useState } from 'react';
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
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setPage(1);
    setOpen(false);
  }, [file]);
  useEffect(() => setOffset(0), [page, file, header]);
  useEffect(() => setCuts(format(file.pdf!.cuts)), [file]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(
      new Blob([file.original!], { type: 'application/pdf' }),
    );
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file.original]);
  const sheet = file.sheets[0];
  const rows = useMemo(
    () =>
      sheet.rows
        .map((row, i) => ({ row, rn: i + 1 }))
        .filter(
          (x) => sheet.rowPages?.[String(x.rn)] === page && x.rn > header + 1,
        ),
    [sheet, page, header],
  );
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
            {flagged.length > 0 ? r.flaggedRows(flagged.length) : r.noFlaggedRows}
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
              {!parsed && (
                <span className="hint warn">{r.cutsInvalid}</span>
              )}
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
