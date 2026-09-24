import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type {
  VisualDraft,
  VisualDraftInput,
} from '../lib/reconciliation/visual-draft';
import { useI18n } from '@/lib/i18n/context';
import {
  engineText,
  errorText,
  fail,
  uiText,
  type UiText,
} from '@/lib/i18n/text';

/** Experimental extraction view: it never writes native files, mappings or matches. */
export function VisualReader({ candidate }: { candidate?: File | null }) {
  const { t, say } = useI18n();
  const v = t.visualReader;
  const [draft, setDraft] = useState<VisualDraft | null>(null);
  const [busy, setBusy] = useState<UiText | null>(null);
  const [error, setError] = useState<UiText | null>(null);
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
    setBusy(uiText((m) => m.visualReader.preparing));
    setError(null);
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
      if (file.size > 8 * 1024 * 1024)
        fail((m) => m.visualReader.tooLarge);
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
          fail((m) => m.visualReader.pageOrder);
        expectedPages = page.totalPages;
        if (!ocr)
          ocr = await createVisualOcr({
            assetBaseUrl: new URL('.', document.baseURI).href,
            signal: controller.signal,
            onProgress: (status) => {
              if (alive()) setBusy(engineText(status));
            },
          });
        if (alive())
          setBusy(
            uiText((m) =>
              m.visualReader.readingPage(page.page, page.totalPages),
            ),
          );
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
          fail((m) => m.visualReader.overLimits);
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
        setError(errorText(failure, (m) => m.visualReader.failed));
    } finally {
      ocr?.destroy();
      if (job.current === controller) {
        job.current = null;
        setBusy(null);
      }
    }
  }
  function clear() {
    job.current?.abort();
    job.current = null;
    setBusy(null);
    setDraft(null);
    setError(null);
    setSelected('');
  }
  const page = draft?.pages[pageIndex];
  const word = page?.words.find((v) => v.id === selected);
  return (
    <details className="surface pad visual-reader" id="visual-reader">
      <summary>{v.summary}</summary>
      <div className="stack" style={{ paddingTop: 16 }}>
        <p>{v.intro}</p>
        <p className="hint">{v.caution}</p>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <label className="file-button">
            {v.choose}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
              aria-label={v.chooseLabel}
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
              {v.tryCandidate}
            </Button>
          )}
          {(busy || draft || error) && (
            <Button variant="ghost" onClick={clear}>
              {busy ? v.cancel : v.clear}
            </Button>
          )}
        </div>
        <small className="muted">{v.limits}</small>
        {busy && <output>{say(busy)}</output>}
        {error && (
          <p className="notice error" role="alert">
            {say(error)}
          </p>
        )}
        {draft && page && (
          <>
            <output className="notice">
              {v.draftLead}
              <bdi>{draft.source.name}</bdi>
              {v.draftStats(
                draft.pageCount,
                draft.pages.reduce((n, p) => n + p.words.length, 0),
              )}
            </output>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label>
                {v.page}{' '}
                <select
                  aria-label={v.pageLabel}
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
                  {v.confidence(
                    word.confidence === null
                      ? null
                      : Math.round(word.confidence),
                  )}
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
                  alt={v.originalImage(page.page)}
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
              <div className="visual-words" aria-label={v.words}>
                {page.words.length ? (
                  <>
                    <p className="hint">{v.wordsHint}</p>
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
                      <p>{v.firstWords(page.words.length)}</p>
                    )}
                  </>
                ) : (
                  <p>{v.noWords}</p>
                )}
              </div>
            </div>
            <details>
              <summary>{v.details}</summary>
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
