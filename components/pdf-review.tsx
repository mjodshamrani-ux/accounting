import { useEffect, useMemo, useState } from 'react';
import type { SourceFile } from '../lib/reconciliation/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';

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
          <strong>استخراج PDF — {file.pdf!.pages} صفحة</strong>
          <p className="hint">
            {!applied.length
              ? 'قُرئت الصفحة كعمود واحد؛ إن كان الكشف جدولًا فحدد حدود الأعمدة.'
              : file.pdf?.autoColumns
                ? `حُددت ${applied.length + 1} أعمدة تلقائيًا من فراغات الجدول.`
                : `${applied.length + 1} أعمدة بحدود حددتها.`}
            {flagged.length > 0
              ? ` ${flagged.length} صفًا يحتاج نظرك.`
              : ' لم تُرصد مشكلات قراءة في الصفوف.'}
          </p>
        </div>
        <a
          className="inline-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          فتح الأصل
        </a>
      </div>
      <details open>
        <summary>معاينة الجدول المستخرج</summary>
        <div className="preview" style={{ maxHeight: 240 }}>
          <table>
            <thead>
              <tr>
                <th>صف</th>
                {Array.from({ length: applied.length + 1 }, (_, i) => (
                  <th key={i}>{sheet.rows[header]?.[i] || `عمود ${i + 1}`}</th>
                ))}
                <th>ملاحظة</th>
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
                      ? 'قبل الجدول'
                      : rn === header + 1
                        ? 'صف العناوين'
                        : (sheet.rowIssues?.[String(rn)]?.join('؛ ') ?? '')}
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
                الصفحة السابقة
              </Button>
              <span className="muted">
                صفحة {page} من {file.pdf!.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= file.pdf!.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                الصفحة التالية
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
                صفوف سابقة
              </Button>
              <span className="muted">
                {offset + 1}–{Math.min(offset + 50, rows.length)} من{' '}
                {rows.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 50 >= rows.length}
                onClick={() => setOffset((n) => n + 50)}
              >
                صفوف تالية
              </Button>
            </>
          )}
          <button
            type="button"
            className="inline-link"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? 'إخفاء حدود الأعمدة' : 'تعديل حدود الأعمدة'}
          </button>
        </div>
        {open && (
          <div className="stack">
            <label className="field">
              <span>حدود الأعمدة كنسب مئوية من عرض الصفحة</span>
              <Input
                aria-label="حدود أعمدة PDF"
                dir="ltr"
                placeholder="25, 45, 65"
                value={cuts}
                onChange={(e) => setCuts(e.target.value)}
              />
            </label>
            <p className="hint">
              مثلًا 25, 45, 65 تقسم الصفحة إلى أربعة أعمدة. ضع كل حد في الفراغ بين
              عمودين. اتركها فارغة لقراءة الصفحة كعمود واحد.
            </p>
            <div className="actions">
              <Button
                variant="outline"
                size="sm"
                disabled={!pending || !parsed}
                onClick={() => parsed && onApply(parsed)}
              >
                تطبيق وإعادة القراءة
              </Button>
              {pending && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCuts(format(applied))}
                >
                  التراجع عن التعديل
                </Button>
              )}
              {!parsed && (
                <span className="hint warn">
                  استخدم أرقامًا مفصولة بفواصل فقط.
                </span>
              )}
              {parsed && pending && (
                <span className="hint">لم تُطبَّق الحدود الجديدة بعد.</span>
              )}
            </div>
          </div>
        )}
      </details>
      <label className="checkline">
        <Checkbox checked={reviewed} onCheckedChange={onReviewedChange} />
        <span>
          راجعت الجدول أعلاه في كل الصفحات ويطابق الأصل. إعادة القراءة تستلزم
          مراجعة جديدة.
        </span>
      </label>
    </div>
  );
}
