import { useEffect, useId, useRef, useState } from 'react';
import '../app/document-scene.css';

const PAPER_WIDTH = 164;
const PAPER_HEIGHT = 338;

/** One coordinate system keeps the paper, text and table proportional at every
 * viewport. Both the paper contents and its passage through the portal clip
 * inside their own geometry; no viewport overflow is used to hide mistakes. */
function StatementSheet({
  kind,
  prefix,
}: {
  kind: 'supplier' | 'ledger';
  prefix: string;
}) {
  const supplier = kind === 'supplier';
  const clip = `${prefix}-${kind}-paper`;
  const accent = supplier ? '#386FD4' : '#7951CB';
  const position = supplier
    ? 'translate(116 65) rotate(-6 82 330)'
    : 'translate(282 52) rotate(6 82 330)';
  return (
    <g className={`document-scene__float document-scene__float--${kind}`}>
      <g
        className={`document-scene__sheet document-scene__sheet--${kind}`}
        data-paper-kind={kind}
        transform={position}
      >
        <defs>
          <clipPath id={clip}>
            <rect x="1" y="1" width="162" height="336" rx="9" />
          </clipPath>
        </defs>
        <rect
          className="document-scene__paper-edge"
          x="4"
          y="5"
          width={PAPER_WIDTH}
          height={PAPER_HEIGHT}
          rx="10"
          fill="#EDF0F7"
          stroke="#D8DFEC"
        />
        <rect
          className="document-scene__paper"
          width={PAPER_WIDTH}
          height={PAPER_HEIGHT}
          rx="10"
          fill={`url(#${prefix}-paper)`}
          stroke="#DAE1EC"
          filter={`url(#${prefix}-paper-shadow)`}
        />
        <g className="document-scene__paper-content" clipPath={`url(#${clip})`}>
          <path
            d="M1 11A10 10 0 0 1 11 1H153A10 10 0 0 1 163 11"
            fill="none"
            stroke="#FFFFFF"
          />
          <rect
            x="18"
            y="21"
            width="52"
            height="24"
            rx="6"
            fill={supplier ? '#EEF4FF' : '#F3EEFC'}
          />
          <path
            d="M26 27h6l3 3v9h-9zM32 27v4h3"
            fill="none"
            stroke={accent}
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <text
            className="document-scene__file-type"
            x="40"
            y="36.5"
            direction="ltr"
            textAnchor="start"
            unicodeBidi="isolate"
            fill={accent}
          >
            {supplier ? 'PDF' : 'XLSX'}
          </text>
          <g transform="translate(129 21) scale(.23)">
            <path
              d="M10 39C10 31 14 25 22 21L67 0C71-2 74 0 74 5V14C74 22 70 28 63 32L15 55C12 57 10 55 10 51Z"
              fill={accent}
            />
            <path
              d="M4 80C4 72 8 66 16 62L67 37C71 35 74 37 74 42V51C74 59 70 65 63 69L9 96C6 98 4 96 4 92Z"
              fill="#A8B4CF"
            />
          </g>
          <text
            className="document-scene__paper-title"
            x="146"
            y="76"
            direction="rtl"
            lang="ar"
            textAnchor="start"
          >
            {supplier ? 'كشف المورد' : 'دفتر الحسابات'}
          </text>
          <path
            d="M95 89H146M119 97H146"
            stroke="#CCD4E2"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect
            x="18"
            y="113"
            width="128"
            height="172"
            rx="4"
            fill="#FFFFFF"
            stroke="#E4E8F0"
          />
          <path
            d="M22 113H142Q146 113 146 117V137H18V117Q18 113 22 113Z"
            fill={supplier ? '#F0F5FD' : '#F5F1FC'}
          />
          <path d="M61 113V285M110 113V285" stroke="#E8EBF2" />
          <path d="M18 137H146" stroke="#DEE5EF" />
          {[0, 1, 2].map((column) => (
            <rect
              key={column}
              x={[27, 71, 119][column]}
              y="123"
              width={[24, 28, 18][column]}
              height="3"
              rx="1.5"
              fill={accent}
              opacity="0.55"
            />
          ))}
          {Array.from({ length: 6 }, (_, row) => (
            <g className="document-scene__table-row" key={row}>
              {row > 0 && (
                <path d={`M18 ${137 + row * 24.5}H146`} stroke="#EDF0F5" />
              )}
              <rect
                x="27"
                y={147 + row * 24.5}
                width={row % 2 ? 23 : 18}
                height="2.5"
                rx="1.25"
                fill="#BBC6D8"
              />
              <rect
                x={row % 2 ? 76 : 70}
                y={147 + row * 24.5}
                width={row % 2 ? 23 : 29}
                height="2.5"
                rx="1.25"
                fill="#C9D2E0"
              />
              <rect
                x="120"
                y={147 + row * 24.5}
                width={row % 3 ? 16 : 12}
                height="2.5"
                rx="1.25"
                fill={row === 2 ? accent : '#BBC6D8'}
                opacity={row === 2 ? 0.65 : 1}
              />
            </g>
          ))}
          <path d="M18 307H102" stroke="#D9E0EB" />
          <circle cx="128" cy="307" r="2" fill={accent} opacity="0.5" />
          <circle cx="137" cy="307" r="2" fill="#D4DCE9" />
          <circle cx="146" cy="307" r="2" fill="#D4DCE9" />
        </g>
      </g>
    </g>
  );
}

/** Decorative illustration only. Its motion has no connection to import,
 * progress, accounting results, source values or matching decisions. */
export function DocumentScene() {
  const prefix = `tarasuf-scene-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
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
        <svg
          className="document-scene__art"
          viewBox="0 0 560 460"
          fill="none"
          focusable="false"
        >
          <defs>
            <linearGradient
              id={`${prefix}-paper`}
              x1="0"
              y1="0"
              x2="164"
              y2="338"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#FFFFFF" />
              <stop offset=".72" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#F8FAFD" />
            </linearGradient>
            <radialGradient id={`${prefix}-ambient`}>
              <stop stopColor="#E8E9FF" stopOpacity=".7" />
              <stop offset="1" stopColor="#F5F8FF" stopOpacity="0" />
            </radialGradient>
            <linearGradient
              id={`${prefix}-rim`}
              x1="95"
              y1="331"
              x2="457"
              y2="405"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#233952" />
              <stop offset=".29" stopColor="#304563" />
              <stop offset=".69" stopColor="#354367" />
              <stop offset="1" stopColor="#182B44" />
            </linearGradient>
            <linearGradient
              id={`${prefix}-front`}
              x1="82"
              y1="350"
              x2="478"
              y2="419"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#102239" />
              <stop offset=".55" stopColor="#182C48" />
              <stop offset="1" stopColor="#0A1B2E" />
            </linearGradient>
            <linearGradient
              id={`${prefix}-light`}
              x1="114"
              y1="346"
              x2="448"
              y2="358"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#2D8CFF" />
              <stop offset=".55" stopColor="#5D74EA" />
              <stop offset="1" stopColor="#9B68ED" />
            </linearGradient>
            <radialGradient id={`${prefix}-well`} cx=".48" cy=".1" r=".85">
              <stop stopColor="#223258" />
              <stop offset=".7" stopColor="#0D1A2E" />
              <stop offset="1" stopColor="#081425" />
            </radialGradient>
            <filter
              id={`${prefix}-paper-shadow`}
              x="-25%"
              y="-12%"
              width="150%"
              height="130%"
            >
              <feDropShadow
                dx="0"
                dy="5"
                stdDeviation="5"
                floodColor="#1E3052"
                floodOpacity=".10"
              />
            </filter>
            <filter
              id={`${prefix}-floor-shadow`}
              x="-25%"
              y="-100%"
              width="150%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="8" />
            </filter>
            <clipPath id={`${prefix}-aperture`}>
              <path d="M0 0H560V343H448C448 366.75 372.78 386 280 386S112 366.75 112 343H0Z" />
            </clipPath>
          </defs>
          <ellipse
            cx="280"
            cy="258"
            rx="252"
            ry="184"
            fill={`url(#${prefix}-ambient)`}
          />
          <ellipse
            cx="280"
            cy="418"
            rx="180"
            ry="15"
            fill="#536596"
            opacity=".12"
            filter={`url(#${prefix}-floor-shadow)`}
          />
          <g className="document-scene__portal-back">
            <path
              d="M82 350C82 315.76 170.65 288 280 288S478 315.76 478 350V369C478 403.24 389.35 431 280 431S82 403.24 82 369Z"
              fill={`url(#${prefix}-front)`}
            />
            <ellipse
              cx="280"
              cy="350"
              rx="198"
              ry="62"
              fill={`url(#${prefix}-rim)`}
              stroke="#304765"
            />
            <ellipse
              cx="280"
              cy="343"
              rx="168"
              ry="43"
              fill={`url(#${prefix}-well)`}
            />
            <ellipse
              cx="280"
              cy="343"
              rx="168"
              ry="43"
              stroke={`url(#${prefix}-light)`}
              strokeWidth="2"
              opacity=".9"
            />
            <path
              d="M131 331C156 310 214 300 280 300S404 310 429 331"
              stroke="#8CA9F6"
              strokeOpacity=".27"
            />
          </g>
          <g
            className="document-scene__papers"
            clipPath={`url(#${prefix}-aperture)`}
          >
            <StatementSheet kind="ledger" prefix={prefix} />
            <StatementSheet kind="supplier" prefix={prefix} />
          </g>
          <g className="document-scene__portal-front">
            <path
              d="M82 350C82 384.24 170.65 412 280 412S478 384.24 478 350V369C478 403.24 389.35 431 280 431S82 403.24 82 369Z"
              fill={`url(#${prefix}-front)`}
            />
            <path
              d="M82 350C82 384.24 170.65 412 280 412S478 384.24 478 350L448 343C448 366.75 372.78 386 280 386S112 366.75 112 343Z"
              fill={`url(#${prefix}-rim)`}
            />
            <path
              d="M112 343C112 366.75 187.22 386 280 386S448 366.75 448 343"
              stroke={`url(#${prefix}-light)`}
              strokeWidth="2.2"
            />
            <path
              d="M88 363C107 391 185 410 280 410S453 391 472 363"
              stroke="#8D9FBF"
              strokeOpacity=".18"
            />
            <path
              d="M235 419H264"
              stroke="#2D8CFF"
              strokeWidth="2"
              strokeLinecap="round"
              opacity=".55"
            />
            <path
              d="M273 420H290"
              stroke="#9360E9"
              strokeWidth="2"
              strokeLinecap="round"
              opacity=".55"
            />
          </g>
        </svg>
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
