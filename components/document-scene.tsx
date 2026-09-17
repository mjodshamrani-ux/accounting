import { useEffect, useRef, useState } from 'react';
import '../app/document-scene.css';

function StatementSheet({ kind }: { kind: 'supplier' | 'ledger' }) {
  const supplier = kind === 'supplier';
  return (
    <div className={`document-scene__float document-scene__float--${kind}`}>
      <div className={`document-scene__sheet document-scene__sheet--${kind}`}>
        <div className="document-scene__paper-edge" />
        <div className="document-scene__sheet-header">
          <span className="document-scene__file-type" dir="ltr">
            <svg viewBox="0 0 18 22" fill="none">
              <path d="M3 1.5h8l4 4v15H3z" />
              <path d="M11 1.5v5h4M6 11h6M6 14.5h6" />
            </svg>
            {supplier ? 'PDF' : 'XLSX'}
          </span>
          <span className="document-scene__paper-mark">
            <i />
            <i />
          </span>
        </div>
        <div className="document-scene__sheet-title" dir="rtl">
          {supplier ? 'كشف المورد' : 'دفتر الحسابات'}
        </div>
        <div className="document-scene__subtitle-lines">
          <i />
          <i />
        </div>
        <div className="document-scene__table">
          <div className="document-scene__table-head">
            <i />
            <i />
            <i />
          </div>
          {Array.from({ length: 5 }, (_, row) => (
            <div className="document-scene__table-row" key={row}>
              <i />
              <i />
              <i />
            </div>
          ))}
        </div>
        <div className="document-scene__sheet-footer">
          <i />
          <span />
          <i />
        </div>
      </div>
    </div>
  );
}

/** Decorative illustration only. Its motion has no connection to import,
 * progress, accounting results, source values or matching decisions. */
export function DocumentScene() {
  const element = useRef<HTMLElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updatePreference();
    updateVisibility();
    preference.addEventListener('change', updatePreference);
    document.addEventListener('visibilitychange', updateVisibility);
    const target = element.current;
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            ([entry]) => setInView(entry.isIntersecting),
            { threshold: 0.12 },
          );
    if (observer && target) observer.observe(target);
    else setInView(true);
    return () => {
      observer?.disconnect();
      preference.removeEventListener('change', updatePreference);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const running = inView && pageVisible && !paused && !reducedMotion;
  return (
    <figure
      className="document-scene"
      ref={element}
      data-running={running ? 'true' : 'false'}
    >
      <div className="document-scene__stage" aria-hidden="true">
        <div className="document-scene__halo" />
        <div className="document-scene__orbit document-scene__orbit--outer" />
        <div className="document-scene__orbit document-scene__orbit--inner" />
        <svg
          className="document-scene__ribbon"
          viewBox="0 0 180 100"
          fill="none"
        >
          <path
            className="document-scene__ribbon-back"
            d="M8 43 99 9l65 28v21L99 31 8 65z"
          />
          <path
            className="document-scene__ribbon-front"
            d="m8 65 91-34 65 27-91 34z"
          />
          <path
            className="document-scene__ribbon-blue"
            d="m8 65 91-34 12 5-91 34z"
          />
          <path
            className="document-scene__ribbon-purple"
            d="m139 47 12 5-91 34-12-5z"
          />
        </svg>
        <StatementSheet kind="ledger" />
        <StatementSheet kind="supplier" />
        <div className="document-scene__scan">
          <span />
        </div>
        <span className="document-scene__spark document-scene__spark--blue" />
        <span className="document-scene__spark document-scene__spark--purple" />
      </div>
      <figcaption className="document-scene__caption" dir="rtl">
        <span>تصوّر توضيحي</span>
        <span
          className="document-scene__caption-separator"
          aria-hidden="true"
        />
        <button
          type="button"
          className="document-scene__motion-toggle"
          disabled={reducedMotion}
          aria-pressed={paused || reducedMotion}
          aria-label={
            reducedMotion
              ? 'حركة المشهد متوقفة حسب تفضيل تقليل الحركة'
              : paused
                ? 'تشغيل حركة المشهد التوضيحي'
                : 'إيقاف حركة المشهد التوضيحي'
          }
          onClick={() => setPaused((value) => !value)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {paused || reducedMotion ? (
              <path d="m5 3 8 5-8 5Z" />
            ) : (
              <path d="M4.5 3v10M11.5 3v10" />
            )}
          </svg>
          {reducedMotion
            ? 'الحركة متوقفة'
            : paused
              ? 'تشغيل الحركة'
              : 'إيقاف الحركة'}
        </button>
      </figcaption>
    </figure>
  );
}
