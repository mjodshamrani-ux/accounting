import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { VisualCellReview } from './visual-cell-review';
import { VisualCropPicker } from './visual-crop-picker';
import { VisualRegionReview } from './visual-region-review';
import { VisualTableReview } from './visual-table-review';
import {
  restoreVisualTable,
  type VisualTable,
} from '@/lib/reconciliation/visual-table';
import {
  createVisualReview,
  confirmVisualCell,
  confirmVisualRegion,
  nextVisualRegionId,
  editVisualRegion,
  removeVisualRegion,
  visualRegions,
  restoreVisualReview,
  saveVisualReview,
  VisualEvidenceError,
  type VisualReview,
  type VisualCell,
} from '@/lib/reconciliation/visual-review';
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
  const [selectedRegion, setSelectedRegion] = useState<{
    id: string;
    region: VisualCell['region'];
  } | null>(null);
  const [review, setReview] = useState<VisualReview | null>(null);
  const [restoredTable, setRestoredTable] = useState<VisualTable | null>(null);
  const [reviewEpoch, setReviewEpoch] = useState(0);
  const [reviewNotice, setReviewNotice] = useState<UiText | null>(null);
  const reviewRef = useRef<VisualReview | null>(null);
  function updateReview(value: VisualReview | null) {
    setRestoredTable(null);
    setReviewEpoch((n) => n + 1);
    reviewRef.current = value;
    setReview(value);
  }
  const reviewError = (failure: unknown) =>
    failure instanceof VisualEvidenceError
      ? uiText((m) => m.visualReview.errors[failure.code])
      : uiText((m) => m.visualReview.failed);
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
    updateReview(null);
    setReviewNotice(null);
    setPageIndex(0);
    setSelected('');
    setSelectedRegion(null);
    let ocr:
      | Awaited<
          ReturnType<
            (typeof import('../lib/reconciliation/visual-ocr-client'))['createVisualOcr']
          >
        >
      | undefined;
    try {
      if (file.size > 8 * 1024 * 1024) fail((m) => m.visualReader.tooLarge);
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
      // Unsupported review families keep their OCR draft. They never acquire
      // a record merely because a file extension says PNG or OCR is confident.
      if (new Uint8Array(buffer)[0] === 137 && result.pageCount === 1) {
        try {
          const linked = await createVisualReview(
            result,
            new Uint8Array(buffer),
          );
          if (alive()) updateReview(linked);
        } catch (failure) {
          if (alive()) setReviewNotice(reviewError(failure));
        }
      }
    } catch (failure) {
      if (alive()) setError(errorText(failure, (m) => m.visualReader.failed));
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
    updateReview(null);
    setReviewNotice(null);
    setError(null);
    setSelected('');
    setSelectedRegion(null);
  }
  async function reviewAction(
    action: 'confirm' | 'save' | 'restore',
    input?: string | File,
  ) {
    if (busy) return;
    const current = reviewRef.current;
    if (action !== 'restore' && !current) return;
    const controller = new AbortController();
    job.current?.abort();
    job.current = controller;
    const alive = () =>
      job.current === controller && !controller.signal.aborted;
    setBusy(
      uiText((m) =>
        action === 'save'
          ? m.visualReview.saving
          : action === 'restore'
            ? m.visualReview.restoring
            : m.visualReview.confirming,
      ),
    );
    setError(null);
    if (action === 'restore') {
      setDraft(null);
      updateReview(null);
      setSelected('');
      setSelectedRegion(null);
      setPageIndex(0);
      setReviewNotice(null);
    }
    try {
      if (action === 'restore') {
        if (!(input instanceof File) || input.size > 16 * 1024 * 1024)
          throw new VisualEvidenceError('limit');
        const bytes = new Uint8Array(await input.arrayBuffer());
        const kind = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        )?.kind;
        const table =
          kind === 'visual-table' ? await restoreVisualTable(bytes) : null;
        const restored = table?.image ?? (await restoreVisualReview(bytes));
        if (alive()) {
          updateReview(restored);
          setRestoredTable(table);
          setDraft(restored.draft);
        }
      } else if (action === 'confirm') {
        if (typeof input !== 'string') throw new VisualEvidenceError('cell');
        const next = await (
          input.startsWith('region:') ? confirmVisualRegion : confirmVisualCell
        )(current!, input, new Date().toISOString());
        if (alive() && reviewRef.current === current) updateReview(next);
      } else {
        const bytes = await saveVisualReview(current!);
        if (alive() && reviewRef.current === current) {
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: 'application/json' }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = `tarasuf-visual-review-${current!.source.sha256.slice(0, 8)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch (failure) {
      if (alive()) setError(reviewError(failure));
    } finally {
      if (job.current === controller) {
        job.current = null;
        setBusy(null);
      }
    }
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
          <label className="file-button">
            {t.visualReview.restore}
            <input
              type="file"
              accept=".json"
              aria-label={t.visualReview.restoreLabel}
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void reviewAction('restore', file);
                e.target.value = '';
              }}
            />
          </label>
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
                    setSelectedRegion(null);
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
              <VisualCropPicker
                key={`${review?.revision ?? draft.source.sha256}:${selectedRegion?.id ?? selected}`}
                image={page.imageDataUrl}
                width={page.width}
                height={page.height}
                alt={v.originalImage(page.page)}
                enabled={!!review}
                disabled={!!busy}
                highlight={selectedRegion?.region ?? word?.bbox}
                editing={selectedRegion?.region}
                onPick={(region, fresh) => {
                  if (!reviewRef.current || busy) return;
                  try {
                    const current = reviewRef.current;
                    const id =
                      !fresh && selectedRegion
                        ? selectedRegion.id
                        : nextVisualRegionId(current);
                    const existing = visualRegions(current).find(
                      (c) => c.id === id,
                    );
                    if (existing) {
                      try {
                        updateReview(
                          editVisualRegion(
                            current,
                            id,
                            existing.role,
                            existing.value,
                            region,
                          ),
                        );
                      } catch (failure) {
                        updateReview(removeVisualRegion(current, id));
                        setError(reviewError(failure));
                      }
                    }
                    setSelected('');
                    setSelectedRegion({ id, region });
                  } catch (failure) {
                    setError(reviewError(failure));
                  }
                }}
              />
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
                        disabled={!!busy}
                        onClick={() => {
                          setSelected(w.id);
                          setSelectedRegion(null);
                        }}
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
            {review ? (
              <div className="visual-review-record stack">
                <h3>{t.visualReview.title}</h3>
                <p>{t.visualReview.intro}</p>
                <output>
                  {t.visualReview.count(
                    review.cells.filter((c) => c.review).length +
                      visualRegions(review).filter((c) => c.review).length,
                    review.cells.length + visualRegions(review).length,
                  )}
                </output>
                {word && !selectedRegion && (
                  <VisualCellReview
                    key={`${review.revision}:${word.id}`}
                    record={review}
                    wordId={word.id}
                    disabled={!!busy}
                    onChange={updateReview}
                    onConfirm={(id) => void reviewAction('confirm', id)}
                    onError={(failure) => setError(reviewError(failure))}
                  />
                )}
                {!!visualRegions(review).length && (
                  <div
                    aria-label={t.visualReview.regionsTitle}
                    className="visual-crop-actions"
                  >
                    {visualRegions(review).map((cell, index) => (
                      <Button
                        key={cell.id}
                        variant="outline"
                        disabled={!!busy}
                        aria-pressed={selectedRegion?.id === cell.id}
                        onClick={() => {
                          setSelected('');
                          setSelectedRegion({
                            id: cell.id,
                            region: cell.region,
                          });
                        }}
                      >
                        {t.visualReview.regionItem(index + 1)}{' '}
                        <bdi>{cell.value}</bdi>
                      </Button>
                    ))}
                  </div>
                )}
                {selectedRegion && (
                  <VisualRegionReview
                    key={`${review.revision}:${selectedRegion.id}:${JSON.stringify(selectedRegion.region)}`}
                    record={review}
                    id={selectedRegion.id}
                    region={selectedRegion.region}
                    disabled={!!busy}
                    onChange={updateReview}
                    onConfirm={(id) => void reviewAction('confirm', id)}
                    onRemove={() => setSelectedRegion(null)}
                    onError={(failure) => setError(reviewError(failure))}
                  />
                )}
                <Button
                  variant="outline"
                  disabled={
                    !!busy ||
                    !(review.cells.length + visualRegions(review).length)
                  }
                  onClick={() => void reviewAction('save')}
                >
                  {t.visualReview.save}
                </Button>
                <VisualTableReview
                  key={reviewEpoch}
                  image={review}
                  initial={restoredTable}
                  disabled={!!busy}
                />
              </div>
            ) : (
              <p className="hint">
                {reviewNotice ? say(reviewNotice) : t.visualReview.family}
              </p>
            )}
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
