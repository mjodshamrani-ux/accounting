import { useEffect, useState } from 'react';
import type { SourceFile } from '../lib/reconciliation/types';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function PdfReview({
  file,
  onApply,
  onInvalidate,
}: {
  file: SourceFile;
  onApply: (cuts: number[]) => void;
  onInvalidate: () => void;
}) {
  const [cuts, setCuts] = useState(file.pdf!.cuts.join(', '));
  const [page, setPage] = useState(1);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [page, file]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(
      new Blob([file.original!], { type: 'application/pdf' }),
    );
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file.original]);
  useEffect(() => setCuts(file.pdf!.cuts.join(', ')), [file]);
  const sheet = file.sheets[0];
  const rows = sheet.rows
    .map((row, i) => ({ row, rn: i + 1 }))
    .filter((x) => sheet.rowPages?.[String(x.rn)] === page);
  return (
    <div className="pad stack">
      <h3>مراجعة استخراج PDF — {file.pdf!.pages} صفحة</h3>
      <p>
        القراءة نصية محلية. قارن جميع الصفوف بالأصل، خصوصًا الإشارات والكسور وترتيب
        الأعمدة. لا نحذف عناوين الصفحات أو الأرصدة تلقائيًا؛ استبعد الصف غير المالي
        لاحقًا مع توثيق السبب.
      </p>
      <a href={url} target="_blank" rel="noopener noreferrer">
        فتح PDF الأصلي محليًا للمراجعة
      </a>
      <label>
        حدود الأعمدة من يسار الصفحة، كنسب مئوية
        <Input
          aria-label="حدود أعمدة PDF"
          dir="ltr"
          placeholder="20, 45, 75"
          value={cuts}
          onChange={(e) => {
            setCuts(e.target.value);
            onInvalidate();
          }}
        />
      </label>
      <p className="muted">
        مثلًا 20, 45, 75 تقسم عرض الصفحة إلى أربعة أعمدة. ضع الحدود في الفراغات
        بين أعمدة الكشف، ثم افحص الجدول أدناه. النص الذي يعبر حدًا يُعلّم كخطأ
        للمراجعة.
      </p>
      <Button
        variant="outline"
        onClick={() =>
          onApply(
            cuts.trim() ? cuts.split(/[,،]/).map((x) => Number(x.trim())) : [],
          )
        }
      >
        تطبيق حدود الأعمدة وإعادة القراءة
      </Button>
      <div className="actions">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          صفحة PDF السابقة
        </Button>
        <span>
          صفحة {page} من {file.pdf!.pages}
        </span>
        <Button
          variant="outline"
          disabled={page >= file.pdf!.pages}
          onClick={() => setPage((p) => p + 1)}
        >
          صفحة PDF التالية
        </Button>
      </div>
      <div className="preview" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>صف الاستخراج</th>
              {Array.from({ length: file.pdf!.cuts.length + 1 }, (_, i) => (
                <th key={i}>عمود {i + 1}</th>
              ))}
              <th>فحص القراءة</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(offset, offset + 100).map(({ row, rn }) => (
              <tr key={rn}>
                <td>{rn}</td>
                {row.map((text, i) => (
                  <td key={i}>
                    <bdi style={{ whiteSpace: 'pre-wrap' }}>{text}</bdi>
                  </td>
                ))}
                <td>
                  {sheet.rowIssues?.[String(rn)]?.join('؛ ') ??
                    'يحتاج مراجعتك مع الأصل'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 100 && (
        <div className="actions">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 100))}
          >
            الصفوف السابقة
          </Button>
          <span>
            {offset + 1}–{Math.min(offset + 100, rows.length)} من {rows.length}{' '}
            صفًا في الصفحة
          </span>
          <Button
            variant="outline"
            disabled={offset + 100 >= rows.length}
            onClick={() => setOffset((n) => n + 100)}
          >
            الصفوف التالية
          </Button>
        </div>
      )}
    </div>
  );
}
