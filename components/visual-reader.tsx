import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type {
  VisualDraft,
  VisualDraftInput,
} from '../lib/reconciliation/visual-draft';

/** Experimental extraction view: it never writes native files, mappings or matches. */
export function VisualReader({ candidate }: { candidate?: File | null }) {
  const [draft, setDraft] = useState<VisualDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const job = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      job.current?.abort();
    },
    [],
  );
  async function read(file?: File) {
    if (!file || busy) return;
    const sourceName = file.name;
    const controller = new AbortController();
    job.current?.abort();
    job.current = controller;
    const alive = () =>
      job.current === controller && !controller.signal.aborted;
    setBusy('إعداد القراءة البصرية على جهازك…');
    setError('');
    setDraft(null);
    setPageIndex(0);
    setSelected('');
    let ocr:
      | Awaited<
          ReturnType<
            (typeof import('../lib/reconciliation/visual-ocr-client'))['createVisualOcr']
          >
        >
      | undefined;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('الحد 8 MB للملف.');
      const buffer = await file.arrayBuffer();
      controller.signal.throwIfAborted();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const [
        { createVisualOcr },
        { createVisualDraft },
        { VISUAL_ENGINE },
        { renderVisualImage, pngDataUrl },
      ] = await Promise.all([
        import('../lib/reconciliation/visual-ocr-client'),
        import('../lib/reconciliation/visual-draft'),
        import('../lib/reconciliation/visual-assets'),
        import('../lib/reconciliation/visual-image'),
      ]);
      controller.signal.throwIfAborted();
      const pages: VisualDraftInput['pages'] = [];
      let expectedPages = 0;
      let retainedImageChars = 0,
        retainedWords = 0,
        retainedCharacters = 0;
      async function consume(page: {
        page: number;
        totalPages: number;
        width: number;
        height: number;
        png: Blob;
      }) {
        controller.signal.throwIfAborted();
        if (
          page.page !== pages.length + 1 ||
          page.totalPages < 1 ||
          page.totalPages > 5 ||
          (expectedPages && expectedPages !== page.totalPages)
        )
          throw new Error('تسلسل الصفحات البصرية غير مكتمل.');
        expectedPages = page.totalPages;
        if (!ocr)
          ocr = await createVisualOcr({
            assetBaseUrl: new URL('.', document.baseURI).href,
            signal: controller.signal,
            onProgress: (status) => {
              if (alive()) setBusy(status);
            },
          });
        if (alive())
          setBusy(`قراءة الصفحة ${page.page} من ${page.totalPages} على جهازك…`);
        const blocks = await ocr.recognize(
          new Uint8Array(await page.png.arrayBuffer()),
        );
        controller.signal.throwIfAborted();
        const inputPage = {
          page: page.page,
          width: page.width,
          height: page.height,
          imageDataUrl: await pngDataUrl(page.png),
          blocks,
        };
        // Validate each page before retaining the next one; full-document
        // limits must stop accumulation rather than only reject at the end.
        const validatedPage = createVisualDraft(
          {
            source: { name: sourceName, sha256: hash },
            expectedPages: 1,
            engine: VISUAL_ENGINE,
            pages: [{ ...inputPage, page: 1 }],
          },
          hash,
        ).pages[0];
        retainedImageChars += inputPage.imageDataUrl.length;
        retainedWords += validatedPage.words.length;
        retainedCharacters += validatedPage.words.reduce(
          (sum, word) => sum + word.text.length,
          0,
        );
        if (
          retainedImageChars > 50 * 1024 * 1024 ||
          retainedWords > 20_000 ||
          retainedCharacters > 2_000_000
        )
          throw new Error('تجاوز المستند حدود المسودة البصرية المحلية.');
        pages.push({
          ...inputPage,
          blocks: [
            { paragraphs: [{ lines: [{ words: validatedPage.words }] }] },
          ],
        });
      }
      if (new TextDecoder().decode(buffer.slice(0, 5)) === '%PDF-') {
        const { renderVisualPdf } =
          await import('../lib/reconciliation/visual-renderer');
        await renderVisualPdf(buffer, consume, { signal: controller.signal });
      } else await consume(await renderVisualImage(buffer, controller.signal));
      const result = createVisualDraft(
        {
          source: { name: sourceName, sha256: hash },
          expectedPages,
          engine: VISUAL_ENGINE,
          pages,
        },
        hash,
      );
      if (alive()) setDraft(result);
    } catch (failure) {
      if (alive())
        setError(
          failure instanceof Error
            ? failure.message
            : 'تعذرت القراءة البصرية؛ استخدم نسخة نصية أو Excel.',
        );
    } finally {
      ocr?.destroy();
      if (job.current === controller) {
        job.current = null;
        setBusy('');
      }
    }
  }
  function clear() {
    job.current?.abort();
    job.current = null;
    setBusy('');
    setDraft(null);
    setError('');
    setSelected('');
  }
  const page = draft?.pages[pageIndex];
  const word = page?.words.find((v) => v.id === selected);
  return (
    <details className="surface pad visual-reader" id="visual-reader">
      <summary>مساعد قراءة الصور — تجريبي</summary>
      <div className="stack" style={{ paddingTop: 16 }}>
        <p>
          يقرأ صور PNG وJPEG وPDF الممسوح محليًا بالعربية والإنجليزية، ويعرض
          الكلمات مع موضعها في الأصل.
        </p>
        <p className="hint">
          هذه مسودة غير متحققة. لا تدخل أرقامها في المطابقات أو ملف Excel، ولا
          تعني درجة التعرف صحة الرقم محاسبيًا. استخدم Excel أو PDF نصيًا لإكمال
          التسوية حاليًا. الأرقام العربية الشرقية تحتاج مراجعة بصرية كاملة؛ دقتها
          الآلية غير موثوقة بعد.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <label className="file-button">
            اختيار صورة أو PDF للقراءة
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
              aria-label="ملف للقراءة البصرية"
              disabled={!!busy}
              onChange={(event) => {
                void read(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          {candidate && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void read(candidate)}
            >
              قراءة الملف المتعذر بصريًا
            </Button>
          )}
          {(busy || draft || error) && (
            <Button variant="ghost" onClick={clear}>
              {busy ? 'إلغاء القراءة البصرية' : 'مسح المسودة البصرية'}
            </Button>
          )}
        </div>
        <small className="muted">
          حتى 8 MB و5 صفحات PDF. قد يحتاج أول تشغيل وقتًا لتحميل مكونات القراءة
          من نفس الموقع؛ محتوى الملف يبقى على جهازك. المعالجة لا تدعم جميع تراكيب
          PDF بعد.
        </small>
        {busy && <output>{busy}</output>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {draft && page && (
          <>
            <output className="notice">
              مسودة بصرية غير متحققة: <bdi>{draft.source.name}</bdi> ·{' '}
              {draft.pageCount} صفحة ·{' '}
              {draft.pages.reduce((n, p) => n + p.words.length, 0)} كلمة. لم تُضف
              إلى التسوية.
            </output>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label>
                الصفحة{' '}
                <select
                  aria-label="صفحة المسودة البصرية"
                  value={pageIndex}
                  onChange={(e) => {
                    setPageIndex(Number(e.target.value));
                    setSelected('');
                  }}
                >
                  {draft.pages.map((p, i) => (
                    <option key={p.page} value={i}>
                      {p.page}
                    </option>
                  ))}
                </select>
              </label>
              {word && (
                <small>
                  تقدير OCR للتعرف:{' '}
                  {word.confidence === null
                    ? 'غير متاح'
                    : `${Math.round(word.confidence)}%`}{' '}
                  — لا يمثل تحققًا محاسبيًا.
                </small>
              )}
            </div>
            <div className="visual-draft-grid">
              <div
                style={{
                  position: 'relative',
                  alignSelf: 'start',
                  border: '1px solid var(--border)',
                  lineHeight: 0,
                }}
              >
                {/* Local document pixels must never use a remote image optimizer. */}
                {/* oxlint-disable-next-line next/no-img-element */}
                <img
                  src={page.imageDataUrl}
                  alt={`أصل الصفحة ${page.page} من المسودة البصرية`}
                  style={{ width: '100%', height: 'auto' }}
                />
                {word && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      border: '2px solid #d97706',
                      background: '#f59e0b20',
                      pointerEvents: 'none',
                      left: `${(word.bbox.x0 / page.width) * 100}%`,
                      top: `${(word.bbox.y0 / page.height) * 100}%`,
                      width: `${((word.bbox.x1 - word.bbox.x0) / page.width) * 100}%`,
                      height: `${((word.bbox.y1 - word.bbox.y0) / page.height) * 100}%`,
                    }}
                  />
                )}
              </div>
              <div className="visual-words" aria-label="الكلمات المستخرجة">
                {page.words.length ? (
                  <>
                    <p className="hint">
                      اضغط كلمة لعرض موضعها. راجع الإشارات والفواصل في الأصل.
                    </p>
                    {page.words.slice(0, 1000).map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className="visual-word"
                        aria-pressed={selected === w.id}
                        onClick={() => setSelected(w.id)}
                      >
                        <bdi>{w.text}</bdi>
                      </button>
                    ))}
                    {page.words.length > 1000 && (
                      <p>
                        تُعرض أول 1000 كلمة من {page.words.length} في هذه
                        المعاينة؛ لا تمثل مراجعة كاملة للصفحة.
                      </p>
                    )}
                  </>
                ) : (
                  <p>لم تُستخرج كلمات. هذا لا يثبت أن الصفحة فارغة.</p>
                )}
              </div>
            </div>
            <details>
              <summary>تفاصيل المصدر والقراءة</summary>
              <p dir="ltr" style={{ overflowWrap: 'anywhere' }}>
                SHA-256: {draft.source.sha256}
                <br />
                Tesseract.js {draft.engine.version} · eng+ara · unverified
              </p>
            </details>
          </>
        )}
      </div>
    </details>
  );
}
